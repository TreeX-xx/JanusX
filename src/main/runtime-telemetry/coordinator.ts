import { app } from 'electron'
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import type { RuntimeTelemetryRequest, RuntimeTelemetrySnapshot } from '../../shared/ipc/system'
import { getRuntimeTelemetrySnapshot } from './history'
import { scanNativeSessionCorpus } from './corpus-scan'
import { findCorrelatedSession } from './session-attribution'
import { UsageLedger } from './usage-ledger'
import type { UsageLedgerPage, UsageLedgerQuery } from '../../shared/usage'
import { sourceVersion } from './source-version'

type TelemetryEngine = Exclude<NonNullable<RuntimeTelemetryRequest['preset']>, 'shell'>

/** First corpus pass waits for app boot; later passes are cheap cursor checks. */
const CORPUS_INITIAL_DELAY_MS = 20_000
const CORPUS_INTERVAL_MS = 5 * 60_000
/** Correlation is IO per unbound terminal; the context bar tolerates this lag. */
const ATTRIBUTION_INTERVAL_MS = 15_000
const ACTIVITY_THROTTLE_MS = 1_000
const SNAPSHOT_RECHECK_MS = 30_000
const MAX_CACHED_SNAPSHOTS = 128

interface ModelSegment {
  model?: string
  contextWindowTokens?: number
  startedAt: number
}

interface TerminalLedgerEntry {
  engine: TelemetryEngine
  sessionId: string
  compactionCount?: number
  modelSegments: ModelSegment[]
  updatedAt: number
  /** Only independently correlated native-session bindings are reusable. */
  source: 'correlated'
}

interface TelemetryLedger {
  version: 1
  terminals: Record<string, TerminalLedgerEntry>
}

/**
 * Owns the one-to-one relationship between a JanusX terminal and an external
 * CLI session. Renderer requests can read this state but can never establish
 * it, which prevents concurrent terminals in the same cwd from sharing data.
 */
export class TerminalContextCoordinator {
  private readonly entries = new Map<string, TerminalLedgerEntry>()
  private readonly sessionOwners = new Map<string, string>()
  private loaded = false
  private readonly requests = new Map<string, RuntimeTelemetryRequest>()
  private readonly codexHomes = new Map<string, string>()
  private readonly listeners = new Map<string, (snapshot: RuntimeTelemetrySnapshot) => void>()
  private readonly pending = new Map<string, Promise<RuntimeTelemetrySnapshot | null>>()
  private readonly snapshots = new Map<string, { key: string; version: string; at: number; snapshot: RuntimeTelemetrySnapshot }>()
  private pollTimer?: ReturnType<typeof setInterval>
  private corpusTimer?: ReturnType<typeof setInterval>
  private corpusInitialTimer?: ReturnType<typeof setTimeout>
  private corpusPending?: Promise<unknown>
  private readonly corpusAbort = new AbortController()
  private stopping = false
  private shutdownFlight?: Promise<void>
  private corpusScanning = false
  private lastAttributionAt = 0
  private attributionBusy = false
  /** Per-terminal pty activity and first-seen time, for hook-free attribution. */
  private readonly activity = new Map<string, number>()
  private readonly startedAt = new Map<string, number>()
  private readonly usageLedger = new UsageLedger(() => join(app.getPath('userData'), 'janusx', 'usage-ledger.sqlite'))
  private usageError?: string
  private readonly failedSessions = new Map<string, string>()

  trackTerminal(terminalId: string, preset: RuntimeTelemetryRequest['preset'], cwd: string, notify?: (snapshot: RuntimeTelemetrySnapshot) => void, codexHome?: string): void {
    if (this.stopping || !preset || preset === 'shell') return
    if (preset === 'codex' && codexHome) this.codexHomes.set(terminalId, codexHome)
    this.requests.set(terminalId, { terminalId, preset, cwd })
    if (!this.startedAt.has(terminalId)) this.startedAt.set(terminalId, Date.now())
    if (notify) this.listeners.set(terminalId, notify)
    if (!this.pollTimer) {
      this.pollTimer = setInterval(() => {
        for (const request of this.requests.values()) {
          if (this.pending.has(request.terminalId!)) continue
          void this.getSnapshot(request).then(snapshot => {
            if (snapshot && this.requests.get(request.terminalId!) === request) this.listeners.get(request.terminalId!)?.(snapshot)
          }).catch(error => this.reportUsageError(error))
        }
        // Session attribution is independent of hook delivery.
        if (Date.now() - this.lastAttributionAt >= ATTRIBUTION_INTERVAL_MS && !this.attributionBusy) {
          this.lastAttributionAt = Date.now()
          void this.runAttributionPass()
        }
      }, 10_000)
      this.pollTimer.unref()
    }
  }

  /** Called from the pty data path; throttled so chatty output is one write. */
  noteTerminalActivity(terminalId: string, at: number): void {
    const previous = this.activity.get(terminalId)
    if (previous !== undefined && at - previous < ACTIVITY_THROTTLE_MS) return
    this.activity.set(terminalId, at)
  }

  /**
   * Runs one attribution sweep now. The poll timer drives it on a cadence;
   * terminal creation can also call it so a fresh terminal binds within one IO
   * cycle instead of waiting out the interval. Awaited by callers that need the
   * result, and re-entrant calls collapse onto the in-flight pass.
   */
  async runAttributionPass(): Promise<void> {
    if (this.attributionBusy) return
    this.attributionBusy = true
    try { await this.attributeUnboundTerminals() } finally { this.attributionBusy = false }
  }

  private async attributeUnboundTerminals(): Promise<void> {
    this.load()
    const candidates = new Map<string, { engine: TelemetryEngine; sessionId: string; request: RuntimeTelemetryRequest }>()
    const claims = new Map<string, number>()
    for (const request of this.requests.values()) {
      const terminalId = request.terminalId
      const preset = request.preset
      if (!terminalId || !preset || preset === 'shell' || !request.cwd) continue
      if (this.entries.has(terminalId)) continue
      const startedAt = this.startedAt.get(terminalId)
      const lastActivityAt = this.activity.get(terminalId)
      if (startedAt === undefined || lastActivityAt === undefined) continue
      try {
        const candidate = await findCorrelatedSession({
          engine: preset,
          cwd: request.cwd,
          terminalStartedAt: startedAt,
          lastActivityAt,
          codexHome: this.codexHomes.get(terminalId),
        })
        if (candidate && this.requests.get(terminalId) === request) {
          candidates.set(terminalId, { engine: preset, sessionId: candidate.sessionId, request })
          const key = this.sessionKey(preset, candidate.sessionId)
          claims.set(key, (claims.get(key) ?? 0) + 1)
        }
      } catch (error) {
        this.reportUsageError(error)
      }
    }
    // Competing terminals do not gain ownership just because they were visited first.
    for (const [terminalId, candidate] of candidates) {
      if (claims.get(this.sessionKey(candidate.engine, candidate.sessionId)) !== 1) continue
      if (this.requests.get(terminalId) === candidate.request) this.bindSession(terminalId, candidate.engine, candidate.sessionId)
    }
  }

  async releaseTerminal(terminalId: string): Promise<void> {
    const request = this.requests.get(terminalId)
    this.requests.delete(terminalId)
    this.listeners.delete(terminalId)
    const bound = this.entries.get(terminalId)
    try {
      if (this.stopping) await this.pending.get(terminalId)
      else if (request) await this.getSnapshot(request)
    }
    catch (error) { this.reportUsageError(error) }
    finally { if (this.entries.get(terminalId) === bound) this.unbindTerminal(terminalId) }
  }

  /**
   * Hook-free usage accounting: scans every native session store on a timer,
   * independent of terminals. A pass with zero open terminals still imports
   * history, which is what closed terminals and never-opened sessions need.
   */
  startCorpusScan(): void {
    if (this.stopping || this.corpusTimer) return
    const run = () => {
      if (this.stopping || this.corpusScanning) return
      this.corpusScanning = true
      this.corpusPending = scanNativeSessionCorpus({
        ledger: this.usageLedger,
        signal: this.corpusAbort.signal,
        checkpointLookup: (engine, namespace, nativeId) => {
          try { return this.usageLedger.sourceCheckpoint(engine, namespace, nativeId) }
          catch (error) {
            this.failedSessions.set(this.sessionKey(engine, nativeId), error instanceof Error ? error.message : String(error))
            return undefined
          }
        },
      }).catch(error => { if (!this.corpusAbort.signal.aborted) this.reportUsageError(error) })
        .finally(() => { this.corpusScanning = false })
    }
    this.corpusInitialTimer = setTimeout(run, CORPUS_INITIAL_DELAY_MS)
    this.corpusInitialTimer.unref?.()
    this.corpusTimer = setInterval(run, CORPUS_INTERVAL_MS)
    this.corpusTimer.unref()
  }

  listUsage(query: UsageLedgerQuery): UsageLedgerPage {
    if (this.stopping) return { records: [], sessions: [], error: 'Usage collection is shutting down' }
    try { return { ...this.usageLedger.list(query), warning: this.usageError ?? this.failedSessions.values().next().value } }
    catch (error) { this.reportUsageError(error); return { records: [], sessions: [], error: this.usageError } }
  }

  private reportUsageError(error: unknown): void {
    this.usageError = error instanceof Error ? error.message : String(error)
    console.error('Usage ledger:', this.usageError)
  }

  bindSession(terminalId: string, engine: TelemetryEngine, sessionId?: string, source: 'correlated' = 'correlated'): boolean {
    if (source !== 'correlated') return false
    if (this.stopping) return false
    const normalizedSessionId = sessionId?.trim()
    if (!terminalId || !normalizedSessionId) return false
    this.load()

    const owner = this.sessionOwners.get(this.sessionKey(engine, normalizedSessionId))
    if (owner && owner !== terminalId) return false

    const previous = this.entries.get(terminalId)
    if (previous?.sessionId === normalizedSessionId && previous.engine === engine) {
      return true
    }
    if (previous) this.sessionOwners.delete(this.sessionKey(previous.engine, previous.sessionId))
    this.snapshots.delete(terminalId)

    this.entries.set(terminalId, {
      engine,
      sessionId: normalizedSessionId,
      modelSegments: [],
      updatedAt: Date.now(),
      source,
    })
    this.sessionOwners.set(this.sessionKey(engine, normalizedSessionId), terminalId)
    this.persist()
    return true
  }

  unbindTerminal(terminalId: string): void {
    if (!terminalId) return
    this.load()
    this.requests.delete(terminalId)
    this.codexHomes.delete(terminalId)
    this.listeners.delete(terminalId)
    this.activity.delete(terminalId)
    this.startedAt.delete(terminalId)
    this.snapshots.delete(terminalId)
    if (this.requests.size === 0 && this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = undefined }
    const entry = this.entries.get(terminalId)
    if (!entry) return
    this.entries.delete(terminalId)
    this.sessionOwners.delete(this.sessionKey(entry.engine, entry.sessionId))
    this.persist()
  }

  getSnapshot(request: RuntimeTelemetryRequest): Promise<RuntimeTelemetrySnapshot | null> {
    if (this.stopping) return Promise.resolve(null)
    const key = request.terminalId ?? ''
    const pending = (this.pending.get(key) ?? Promise.resolve(null)).catch(() => null).then(() => this.readSnapshot(request))
    this.pending.set(key, pending)
    void pending.finally(() => { if (this.pending.get(key) === pending) this.pending.delete(key) }).catch(() => {})
    return pending
  }

  shutdown(): Promise<void> {
    if (this.shutdownFlight) return this.shutdownFlight
    clearInterval(this.pollTimer)
    clearInterval(this.corpusTimer)
    clearTimeout(this.corpusInitialTimer)
    this.corpusAbort.abort()
    // Terminal exit callbacks may still be arriving. Queue the final complete
    // samples before refusing new work; releaseTerminal drains these same reads.
    this.snapshots.clear()
    for (const request of this.requests.values()) void this.getSnapshot(request).catch(error => this.reportUsageError(error))
    this.stopping = true
    this.shutdownFlight = Promise.allSettled([...this.pending.values(), this.corpusPending]).then(() => {
      this.usageLedger.close()
      this.snapshots.clear()
      this.requests.clear()
      this.listeners.clear()
    })
    return this.shutdownFlight
  }

  private async readSnapshot(request: RuntimeTelemetryRequest): Promise<RuntimeTelemetrySnapshot | null> {
    this.load()
    const bound = request.terminalId ? this.entries.get(request.terminalId) : undefined
    const preset = request.preset
    if (bound && bound.engine !== preset) return null

    // A renderer-supplied id is accepted only when it matches the main-process
    // binding. This also makes restored windows safe after renderer reloads.
    const sessionId = bound?.sessionId
    // Restoring the same native session must not redefine its accounting or context range.
    const codexHome = request.terminalId ? this.codexHomes.get(request.terminalId) : undefined
    const cacheKey = JSON.stringify([preset, sessionId, request.cwd, codexHome])
    const cached = request.terminalId ? this.snapshots.get(request.terminalId) : undefined
    if (bound && cached && cached.key === cacheKey && Date.now() - cached.at < SNAPSHOT_RECHECK_MS) {
      const info = cached.snapshot.filePath ? await stat(cached.snapshot.filePath).catch(() => null) : null
      if (request.terminalId && this.entries.get(request.terminalId) !== bound) return null
      if (info && sourceVersion(info) === cached.version) return {
        ...cached.snapshot, observedAt: Date.now(), sessionBinding: 'correlated',
      }
    }
    if (request.terminalId) this.snapshots.delete(request.terminalId)
    const snapshot = await getRuntimeTelemetrySnapshot({ ...request, codexHome, sessionId, startedAt: bound ? undefined : request.startedAt }, (engine, namespace, nativeId) => {
      try { return this.usageLedger.sourceCheckpoint(engine, namespace, nativeId) }
      catch (error) {
        this.failedSessions.set(this.sessionKey(engine, nativeId), error instanceof Error ? error.message : String(error))
        return undefined
      }
    })
    if (request.terminalId && this.entries.get(request.terminalId) !== bound) return null
    if (!snapshot) {
      if (bound) {
        try { this.usageLedger.markMissing(bound.engine, bound.sessionId) }
        catch (error) { this.reportUsageError(error) }
      }
      return null
    }

    const { usageObservation, sourceVersion: version, ...telemetry } = snapshot

    if (!bound) return telemetry
    if (snapshot.sessionId && snapshot.sessionId !== bound.sessionId) return null
    if (usageObservation && usageObservation.sessionId === bound.sessionId) {
      const key = this.sessionKey(bound.engine, bound.sessionId)
      try { this.usageLedger.record(usageObservation); this.failedSessions.delete(key); this.usageError = undefined }
      catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        this.failedSessions.set(key, message)
        console.error('Usage ledger:', message)
      }
    }
    const exact: RuntimeTelemetrySnapshot = {
      ...telemetry,
      observedAt: Date.now(),
      sessionId: bound.sessionId,
      sessionBinding: 'correlated',
    }
    this.recordSnapshot(request.terminalId!, bound, exact)
    if (request.terminalId && version && exact.filePath && !usageObservation?.issue
      && !this.failedSessions.has(this.sessionKey(bound.engine, bound.sessionId))) {
      this.snapshots.delete(request.terminalId)
      this.snapshots.set(request.terminalId, { key: cacheKey, version, at: Date.now(), snapshot: exact })
      if (this.snapshots.size > MAX_CACHED_SNAPSHOTS) this.snapshots.delete(this.snapshots.keys().next().value!)
    }
    return exact
  }

  private recordSnapshot(terminalId: string, entry: TerminalLedgerEntry, snapshot: RuntimeTelemetrySnapshot): void {
    let changed = false
    if (snapshot.compactionCountConfidence === 'exact' && snapshot.compactionCount !== undefined && entry.compactionCount !== snapshot.compactionCount) {
      entry.compactionCount = snapshot.compactionCount
      changed = true
    }

    const model = snapshot.detectedModel
    const window = snapshot.contextWindowTokens
    const latest = entry.modelSegments.at(-1)
    if ((model || window !== undefined) && (!latest || latest.model !== model || latest.contextWindowTokens !== window)) {
      entry.modelSegments.push({ model, contextWindowTokens: window, startedAt: snapshot.modelChangedAt ?? snapshot.observedAt ?? Date.now() })
      // A malformed or very long-running source must not grow this metadata without bound.
      if (entry.modelSegments.length > 64) entry.modelSegments.splice(0, entry.modelSegments.length - 64)
      changed = true
    }

    if (changed) {
      entry.updatedAt = Date.now()
      this.entries.set(terminalId, entry)
      this.persist()
    }
  }

  private load(): void {
    if (this.loaded) return
    this.loaded = true
    try {
      const raw = readFileSync(this.filePath(), 'utf8')
      const ledger = JSON.parse(raw) as TelemetryLedger
      if (ledger.version !== 1 || !ledger.terminals || typeof ledger.terminals !== 'object') return
      for (const [terminalId, entry] of Object.entries(ledger.terminals)) {
        // Historical hook/unknown origins cannot become independent evidence on upgrade.
        if (!entry || !entry.sessionId || !entry.engine || entry.source !== 'correlated') continue
        const owner = this.sessionOwners.get(this.sessionKey(entry.engine, entry.sessionId))
        if (owner) continue
        this.entries.set(terminalId, { ...entry, modelSegments: Array.isArray(entry.modelSegments) ? entry.modelSegments : [] })
        this.sessionOwners.set(this.sessionKey(entry.engine, entry.sessionId), terminalId)
      }
    } catch {
      // Telemetry persistence is an optimization; an unavailable user-data path
      // must not make terminals or provider hooks fail.
    }
  }

  private persist(): void {
    try {
      const filePath = this.filePath()
      mkdirSync(dirname(filePath), { recursive: true })
      const terminals = Object.fromEntries(this.entries)
      const temporaryPath = `${filePath}.tmp`
      writeFileSync(temporaryPath, JSON.stringify({ version: 1, terminals } satisfies TelemetryLedger), 'utf8')
      renameSync(temporaryPath, filePath)
    } catch {
      // Keep the in-memory exact binding even when persistence is unavailable.
    }
  }

  private filePath(): string {
    const userData = app.getPath('userData')
    return join(userData, 'janusx', 'terminal-context-ledger.json')
  }

  private sessionKey(engine: TelemetryEngine, sessionId: string): string {
    return `${engine}:${sessionId}`
  }
}

export const terminalContextCoordinator = new TerminalContextCoordinator()
