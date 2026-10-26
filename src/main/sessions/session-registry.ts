// Note: stable session identity over volatile terminal ids for workspace
// session cards, scoped checkpoints, and Continue handoff — see
// .agents/notes/sessions/workspace-sessions-v1.md
// Note: external provider sessions import by transcript backfill — see
// .agents/notes/sessions/records/external-session-backfill.md
import { randomUUID } from 'node:crypto'
import { copyFile, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'
import { SerialQueue, writeFileAtomic } from '../lib/atomic-file'
import { isEnvironmentInjectionText } from './transcript-kernel'
import { parseRuntimeResource } from '../../shared/workspace-runtime'
import type {
  AgentSessionDetail,
  AgentSessionStatus,
  AgentSessionSummary,
  AgentSessionTurnKind,
  SessionFilter,
  SessionTurnRecord,
  ShellRestoreManifest,
  TranscriptTurn,
} from '../../shared/ipc/session'

export interface AgentSessionRecord extends AgentSessionDetail {
  transcriptTurnCount?: number
  shell?: string
  preset?: string
  command?: string
  args?: string[]
  lastPrompt: string
  checkpointIds: string[]
}

export interface ImportExternalSessionInput {
  workspaceId?: string
  engine: string
  cwd: string
  providerSessionId: string
  transcriptPath: string
  firstPrompt: string
  lastExcerpt?: string
  turnCount: number
  preview?: TranscriptTurn[]
  createdAt?: string
  updatedAt?: string
}

interface SessionStoreDocument {
  version: 1
  sessions: AgentSessionRecord[]
}

const STORE_FILE = 'agent-sessions.json'
const LAYOUT_FILE = 'shell-restore.json'
const MAX_SESSIONS = 200
const MAX_TURNS_PER_SESSION = 50
const MAX_RESTORE_TERMINALS = 10

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A stored first prompt that is empty or environment context, never a question. */
function isStaleFirstPrompt(value: string | undefined): boolean {
  return !value?.trim() || isEnvironmentInjectionText(value)
}

export class AgentSessionRegistry {
  private readonly sessions = new Map<string, AgentSessionRecord>()
  private readonly terminalToSession = new Map<string, string>()
  private readonly pendingTurnStart = new Map<string, string>()
  private readonly pendingTurnPrompt = new Map<string, string>()
  private readonly writeQueue = new SerialQueue()
  private changeListener?: (sessionId?: string) => void
  private loadTask: Promise<void> | null = null
  private loadOk = false
  // Bulk-import suppression: scans import hundreds of rows; each row must
  // not emit its own session:event or the panel refetches per row, and must
  // not persist on its own either — a per-row persist stringifies the whole
  // store and stalls the main process for the length of the scan.
  // beginBatch/endBatch collapse one bulk pass into a single notify and a
  // single store write.
  // See .agents/notes/sessions/records/session-flicker-storm.md
  // See .agents/notes/sessions/records/session-open-stall.md
  private batchDepth = 0
  private batchDirty = false
  private batchPersistDirty = false

  constructor(private readonly userDataDir?: string) {}

  setChangeListener(listener?: (sessionId?: string) => void): void {
    this.changeListener = listener
  }

  /** Collapse the notifies of one bulk pass into a single event. */
  beginBatch(): void {
    this.batchDepth += 1
  }

  endBatch(): void {
    if (this.batchDepth <= 0) return
    this.batchDepth -= 1
    if (this.batchDepth > 0) return
    const persistNow = this.batchPersistDirty
    const notifyNow = this.batchDirty
    this.batchPersistDirty = false
    this.batchDirty = false
    if (persistNow) this.persist()
    if (notifyNow) this.notify()
  }

  private notify(sessionId?: string): void {
    if (this.batchDepth > 0) {
      this.batchDirty = true
      return
    }
    try {
      this.changeListener?.(sessionId)
    } catch (err) {
      console.error('[sessions] change listener failed:', err)
    }
  }

  private storePath(): string {
    const base = this.userDataDir ?? app.getPath('userData')
    return join(base, 'janusx', STORE_FILE)
  }

  /** Load persisted sessions; corrupt files recover to empty without failing. */
  load(): Promise<void> {
    return this.ensureLoaded()
  }

  private ensureLoaded(): Promise<void> {
    return (this.loadTask ??= this.doLoad())
  }

  private async doLoad(): Promise<void> {
    try {
      const raw = await readFile(this.storePath(), 'utf-8')
      const document = JSON.parse(raw) as Partial<SessionStoreDocument>
      if (!isRecord(document) || !Array.isArray(document.sessions)) {
        console.error('[sessions] store has unexpected shape; writes paused to protect disk state')
        return
      }
      for (const entry of document.sessions) {
        if (!isRecord(entry) || typeof entry.id !== 'string' || typeof entry.cwd !== 'string') continue
        const record = entry as unknown as AgentSessionRecord
        this.sessions.set(record.id, {
          ...record,
          terminalIds: Array.isArray(record.terminalIds) ? record.terminalIds : [],
          turns: Array.isArray(record.turns) ? record.turns.slice(-MAX_TURNS_PER_SESSION) : [],
          checkpointIds: Array.isArray(record.checkpointIds) ? record.checkpointIds : [],
          archived: record.archived === true,
          external: record.external === true || undefined,
        })
      }
      // Rebuild the terminal binding the map lost on restart: records carry it,
      // and later records win, so a taken-over terminal points at its owner.
      for (const record of this.sessions.values()) {
        for (const terminalId of record.terminalIds) {
          this.terminalToSession.set(terminalId, record.id)
        }
      }
      this.dropEmptyOrphans()
      this.loadOk = true
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
        // Fresh start: no store yet, writes proceed.
        this.loadOk = true
        return
      }
      console.error('[sessions] store failed to load; writes paused to protect disk state')
    }
  }

  private persist(): void {
    // One bulk pass writes once at endBatch instead of per row: every write
    // stringifies the full store on the main thread, and a scan's hundreds of
    // per-row writes stalled all IPC (including the panel's first list) behind
    // them. Imports inside a batch are re-derivable from transcripts, so the
    // deferred snapshot costs nothing extra on a crash.
    // See .agents/notes/sessions/records/session-open-stall.md
    if (this.batchDepth > 0) {
      this.batchPersistDirty = true
      return
    }
    this.persistNow()
  }

  private persistNow(): void {
    // Mutations gate on load so a fresh process never clobbers disk state
    // it has not read yet; a failed load pauses writes instead of
    // overwriting possibly valid data with a partial view.
    void this.ensureLoaded()
      .then(() => {
        if (!this.loadOk) {
          console.error('[sessions] persist refused: store failed to load')
          return undefined
        }
        return this.writeQueue.run(async () => {
          const path = this.storePath()
          // One-level rollback copy; failures here never block the write.
          await copyFile(path, `${path}.prev`).catch(() => undefined)
          const document: SessionStoreDocument = {
            version: 1,
            sessions: Array.from(this.sessions.values()),
          }
          await writeFileAtomic(path, `${JSON.stringify(document, null, 2)}\n`)
        })
      })
      .catch((err) => console.error('[sessions] persist failed:', err))
  }

  /** Drain pending persists (tests and shutdown paths). */
  flush(): Promise<void> {
    // Shutdown can land mid-batch; the deferred snapshot must still reach
    // disk before the process exits.
    if (this.batchPersistDirty) {
      this.batchPersistDirty = false
      this.persistNow()
    }
    return this.ensureLoaded().then(() => this.writeQueue.run(() => Promise.resolve()))
  }

  private layoutPath(): string {
    const base = this.userDataDir ?? app.getPath('userData')
    return join(base, 'janusx', LAYOUT_FILE)
  }

  /**
   * One-shot cold-restore manifest: shell terminals per workspace, never
   * agents. Consumed once on boot, then cleared by the caller.
   */
  async saveLayout(manifest: ShellRestoreManifest): Promise<void> {
    const clean: ShellRestoreManifest = {
      version: 1,
      savedAt: new Date().toISOString(),
      workspaces: manifest.workspaces
        .filter((entry) => typeof entry.workspaceId === 'string' && Array.isArray(entry.terminals))
        .map((entry) => ({
          workspaceId: entry.workspaceId,
          terminals: entry.terminals
            .filter((terminal) => typeof terminal.cwd === 'string' && terminal.cwd)
            .slice(0, MAX_RESTORE_TERMINALS)
            .map((terminal) => ({
              ...(typeof terminal.id === 'string' && /^[a-zA-Z0-9_-]{1,160}$/.test(terminal.id) ? { id: terminal.id } : {}),
              ...(typeof terminal.shell === 'string' ? { shell: terminal.shell.slice(0, 4096) } : {}),
              cwd: terminal.cwd,
              preset: typeof terminal.preset === 'string' ? terminal.preset : 'shell',
              name: typeof terminal.name === 'string' ? terminal.name.slice(0, 80) : 'shell',
            })),
        }))
        .filter((entry) => entry.terminals.length > 0),
    }
    await writeFileAtomic(this.layoutPath(), `${JSON.stringify(clean, null, 2)}\n`)
  }

  async getLayout(): Promise<ShellRestoreManifest | null> {
    try {
      const raw = await readFile(this.layoutPath(), 'utf-8')
      const parsed = JSON.parse(raw) as Partial<ShellRestoreManifest>
      if (parsed.version !== 1 || !Array.isArray(parsed.workspaces)) return null
      return parsed as ShellRestoreManifest
    } catch {
      return null
    }
  }

  async clearLayout(): Promise<void> {
    await rm(this.layoutPath(), { force: true }).catch(() => undefined)
  }

  /**
   * Bind a terminal to a session row, minting one at most once per terminal.
   *
   * Why idempotent: Continue and Resume pre-create the row to carry its origin
   * (continuedFrom / provider session identity) before the terminal lifecycle
   * runs, and the lifecycle mints its own row for every agent terminal. Minting
   * twice for one terminalId left the first row orphaned on screen as a second
   * identical card. Reuse the bound row and fill only its blanks instead.
   */
  createSession(input: {
    terminalId: string
    workspaceId: string
    engine: string
    cwd: string
    shell?: string
    preset?: string
    command?: string
    args?: string[]
    branch?: string
    providerSessionId?: string
    transcriptPath?: string
    continuedFrom?: string
    /** Native recovery copies display history without borrowing source checkpoints. */
    historyFrom?: string
  }): AgentSessionRecord {
    const boundId = this.terminalToSession.get(input.terminalId)
    const bound = boundId ? this.sessions.get(boundId) : undefined
    if (bound) return this.mergeSessionOrigin(bound, input)

    const now = new Date().toISOString()
    const history = input.historyFrom ? this.sessions.get(input.historyFrom) : undefined
    const record: AgentSessionRecord = {
      id: randomUUID(),
      workspaceId: input.workspaceId,
      engine: input.engine,
      cwd: input.cwd,
      branch: input.branch,
      shell: input.shell,
      preset: input.preset,
      command: input.command,
      args: input.args,
      firstPrompt: history?.firstPrompt ?? '',
      lastPrompt: history?.lastPrompt ?? '',
      turnCount: history?.turnCount ?? 0,
      checkpointCount: 0,
      status: 'active',
      providerSessionId: input.providerSessionId,
      transcriptPath: input.transcriptPath,
      continuedFrom: input.continuedFrom,
      terminalIds: [input.terminalId],
      turns: (history?.turns ?? []).map((turn) => ({ ...turn, id: randomUUID(), checkpointId: undefined })),
      checkpointIds: [],
      createdAt: now,
      updatedAt: now,
      archived: false,
    }
    this.sessions.set(record.id, record)
    this.terminalToSession.set(input.terminalId, record.id)
    this.prune()
    this.persist()
    this.notify(record.id)
    return record
  }

  /** Fill a reused row's blanks from a later create; never overwrite a value. */
  private mergeSessionOrigin(
    record: AgentSessionRecord,
    input: {
      branch?: string
      providerSessionId?: string
      transcriptPath?: string
      continuedFrom?: string
    },
  ): AgentSessionRecord {
    let changed = false
    if (!record.branch && input.branch) {
      record.branch = input.branch
      changed = true
    }
    if (!record.providerSessionId && input.providerSessionId) {
      record.providerSessionId = input.providerSessionId
      changed = true
    }
    if (!record.transcriptPath && input.transcriptPath) {
      record.transcriptPath = input.transcriptPath
      changed = true
    }
    if (!record.continuedFrom && input.continuedFrom) {
      record.continuedFrom = input.continuedFrom
      changed = true
    }
    if (!changed) return record
    record.updatedAt = new Date().toISOString()
    this.persist()
    this.notify(record.id)
    return record
  }

  /**
   * Drop rows a taken-over terminal left behind.
   *
   * Only empty ones go: a row whose every terminal now belongs to another row
   * and which never recorded a prompt, turn, or checkpoint has nothing to
   * recover. Rows with content stay even when orphaned, and external imports
   * (no terminalIds) are never candidates.
   */
  private dropEmptyOrphans(): void {
    const orphans = Array.from(this.sessions.values()).filter((record) => {
      if (record.external === true) return false
      if (record.archived) return false
      if (record.terminalIds.length === 0) return false
      if (record.firstPrompt || record.lastPrompt) return false
      if (record.turns.length > 0 || record.checkpointIds.length > 0) return false
      return record.terminalIds.every((id) => this.terminalToSession.get(id) !== record.id)
    })
    if (orphans.length === 0) return
    for (const record of orphans) this.sessions.delete(record.id)
    this.persist()
    this.notify()
  }

  sessionIdForTerminal(terminalId: string): string | null {
    return this.terminalToSession.get(terminalId) ?? null
  }

  /** Transcript path persisted for the terminal session, if any. */
  transcriptPathForTerminal(terminalId: string): string | undefined {
    const record = this.recordForTerminal(terminalId)
    return record?.transcriptPath
  }

  /** Provider session id persisted for the terminal session, if any. */
  providerSessionIdForTerminal(terminalId: string): string | undefined {
    const record = this.recordForTerminal(terminalId)
    return record?.providerSessionId
  }

  noteTerminal(terminalId: string, sessionId: string): void {
    const record = this.sessions.get(sessionId)
    if (!record) return
    if (!record.terminalIds.includes(terminalId)) record.terminalIds.push(terminalId)
    this.terminalToSession.set(terminalId, sessionId)
    record.updatedAt = new Date().toISOString()
    this.persist()
  }

  notePrompt(terminalId: string, prompt: string): void {
    const record = this.recordForTerminal(terminalId)
    if (!record || !prompt.trim()) return
    if (!record.firstPrompt) record.firstPrompt = prompt
    record.lastPrompt = prompt
    record.status = 'active'
    this.pendingTurnStart.set(record.id, new Date().toISOString())
    // Question snapshot source: consumed once by recordTurnEnd so the turn
    // owns its prompt even after checkpoint prune.
    this.pendingTurnPrompt.set(record.id, prompt)
    record.updatedAt = new Date().toISOString()
    this.persist()
    // Card-visible mutation (first prompt, active status): push session:event
    // so the panel refreshes on submit, not only on turn end.
    this.notify(record.id)
  }

  noteCheckpoint(terminalId: string, checkpointId: string): void {
    const record = this.recordForTerminal(terminalId)
    if (!record) return
    if (!record.checkpointIds.includes(checkpointId)) {
      record.checkpointIds.push(checkpointId)
      record.checkpointCount = record.checkpointIds.length
    }
    record.updatedAt = new Date().toISOString()
    this.persist()
    // Card-visible mutation (checkpoint count): push session:event so the
    // panel refreshes on checkpoint creation, not only on turn end.
    this.notify(record.id)
  }

  /**
   * Drops checkpoint ids that no longer exist in storage (restore prune,
   * retention caps) so the card count matches the session-scoped list.
   * Turn records keep their own checkpoint references and never shrink here.
   */
  retainCheckpoints(sessionId: string, liveIds: Set<string>): void {
    const record = this.sessions.get(sessionId)
    if (!record) return
    const kept = record.checkpointIds.filter((id) => liveIds.has(id))
    if (kept.length === record.checkpointIds.length) return
    record.checkpointIds = kept
    record.checkpointCount = kept.length
    record.updatedAt = new Date().toISOString()
    this.persist()
  }

  noteProviderSession(terminalId: string, providerSessionId?: string, transcriptPath?: string): void {
    const record = this.recordForTerminal(terminalId)
    if (!record) return
    // Hot path: every hook payload carrying a session id lands here. Emit
    // session:event only when a card-visible field actually changes, otherwise
    // each tool call would refetch and reorder the panel.
    let changed = false
    if (providerSessionId && record.providerSessionId !== providerSessionId) {
      record.providerSessionId = providerSessionId
      changed = true
    }
    if (transcriptPath && record.transcriptPath !== transcriptPath) {
      record.transcriptPath = transcriptPath
      changed = true
    }
    if (!changed) return
    // A late provider identity may already own an external row from the boot
    // or panel scan: absorb it instead of leaving two cards for one
    // conversation.
    if (this.absorbExternalRow(record)) changed = true
    if (!changed) return
    record.updatedAt = new Date().toISOString()
    this.persist()
    this.notify(record.id)
  }

  /**
   * Whether two rows describe the same conversation seen twice.
   *
   * Only a shared key counts. A hook-owned row and a scan row can both
   * describe one conversation before either side holds the other's key, but
   * merging on proximity alone would swallow two conversations a user started
   * in one directory moments apart. The hook row stays authoritative and
   * absorbs the scan row once it can prove identity; a hook row that never
   * learns one is a payload-layer gap, not a merge to guess at.
   */
  private sameConversation(
    hookRow: AgentSessionRecord,
    scanRow: Pick<AgentSessionRecord, 'external' | 'engine' | 'providerSessionId' | 'transcriptPath' | 'cwd'>,
  ): boolean {
    if (hookRow.external === true) return false
    if (scanRow.external !== true) return false
    if (hookRow.engine !== scanRow.engine) return false
    if (parseRuntimeResource(hookRow.cwd)?.workspaceId !== parseRuntimeResource(scanRow.cwd)?.workspaceId) return false
    if (hookRow.providerSessionId && hookRow.providerSessionId === scanRow.providerSessionId) {
      return true
    }
    return Boolean(hookRow.transcriptPath && hookRow.transcriptPath === scanRow.transcriptPath)
  }

  /** Merge the external row of the same conversation into a hook-owned row. */
  private absorbExternalRow(record: AgentSessionRecord): boolean {
    const duplicate = Array.from(this.sessions.values()).find((other) =>
      this.sameConversation(record, other),
    )
    if (!duplicate) return false
    if (!record.providerSessionId && duplicate.providerSessionId) {
      record.providerSessionId = duplicate.providerSessionId
    }
    if (!record.firstPrompt && duplicate.firstPrompt) {
      record.firstPrompt = duplicate.firstPrompt
      if (!record.lastPrompt) record.lastPrompt = duplicate.firstPrompt
    }
    if (!record.transcriptPath && duplicate.transcriptPath) {
      record.transcriptPath = duplicate.transcriptPath
    }
    if (record.turns.length === 0 && duplicate.turns.length > 0) {
      record.turns = duplicate.turns
    }
    if (duplicate.createdAt < record.createdAt) record.createdAt = duplicate.createdAt
    if (duplicate.updatedAt > record.updatedAt) record.updatedAt = duplicate.updatedAt
    this.sessions.delete(duplicate.id)
    return true
  }

  /** True while a submit prompt or hook turn awaits its end record. */
  hasPendingTurn(terminalId: string): boolean {
    const record = this.recordForTerminal(terminalId)
    if (!record) return false
    return this.pendingTurnPrompt.has(record.id) || this.pendingTurnStart.has(record.id)
  }

  recordTurnEnd(
    terminalId: string,
    kind: AgentSessionTurnKind,
    checkpointId?: string,
    excerpt?: string,
  ): void {
    const record = this.recordForTerminal(terminalId)
    if (!record) return
    const now = new Date().toISOString()
    const prompt = this.pendingTurnPrompt.get(record.id)
    this.pendingTurnPrompt.delete(record.id)
    const turn: SessionTurnRecord = {
      id: randomUUID(),
      kind,
      checkpointId: checkpointId ?? record.checkpointIds.at(-1),
      startedAt: this.pendingTurnStart.get(record.id) ?? now,
      endedAt: now,
      ...(prompt ? { prompt } : {}),
      ...(excerpt ? { excerpt } : {}),
    }
    this.pendingTurnStart.delete(record.id)
    record.turns.push(turn)
    if (record.turns.length > MAX_TURNS_PER_SESSION) {
      record.turns.splice(0, record.turns.length - MAX_TURNS_PER_SESSION)
    }
    record.turnCount += 1
    record.status = kind === 'done' ? 'done' : kind
    record.updatedAt = now
    this.persist()
    this.notify(record.id)
  }

  noteBranch(terminalId: string, branch: string): void {
    const record = this.recordForTerminal(terminalId)
    if (!record || !branch || record.branch === branch) return
    record.branch = branch
    record.updatedAt = new Date().toISOString()
    this.persist()
    this.notify(record.id)
  }

  /** Process exit is lifecycle evidence, not an invented provider conversation turn. */
  noteProcessExit(terminalId: string, exitCode: number): void {
    const record = this.recordForTerminal(terminalId)
    if (!record) return
    record.status = exitCode === 0 ? 'done' : 'failed'
    record.updatedAt = new Date().toISOString()
    this.persist()
    this.notify(record.id)
  }

  detachTerminal(terminalId: string): void {
    this.terminalToSession.delete(terminalId)
    this.persist()
  }

  /**
   * A terminal that never came up leaves no row behind: archive whatever it
   * bound, then release the binding. Detaching alone stranded a live-looking
   * card pointing at a terminal that does not exist.
   */
  discardTerminal(terminalId: string): void {
    const sessionId = this.terminalToSession.get(terminalId)
    this.terminalToSession.delete(terminalId)
    if (sessionId) {
      const record = this.sessions.get(sessionId)
      if (record) {
        record.archived = true
        record.updatedAt = new Date().toISOString()
        this.notify(record.id)
      }
    }
    this.persist()
  }

  /**
   * Import a provider transcript as a read-only external session. Hook-owned
   * sessions stay the source of truth: when the same engine plus provider id
   * already exists as a live session, the import only backfills a missing
   * transcript path and never overwrites turns. Repeat scans match on the
   * same key and refresh excerpt, count, and timestamps without duplicating.
   */
  importExternalSession(input: ImportExternalSessionInput): AgentSessionRecord {
    const engine = input.engine.trim()
    const cwd = input.cwd.trim()
    const providerSessionId = input.providerSessionId.trim()
    const transcriptPath = input.transcriptPath.trim()
    if (!engine || !cwd || !providerSessionId || !transcriptPath) {
      throw new Error('importExternalSession requires engine, cwd, providerSessionId, and transcriptPath')
    }
    const now = new Date().toISOString()
    const createdAt = toImportTimestamp(input.createdAt) ?? toImportTimestamp(input.updatedAt) ?? now
    const updatedAt = toImportTimestamp(input.updatedAt) ?? toImportTimestamp(input.createdAt) ?? now
    const firstPrompt = input.firstPrompt.trim()
    const lastExcerpt = input.lastExcerpt?.trim() ? input.lastExcerpt.trim() : undefined
    const turnCount = Number.isFinite(input.turnCount) ? Math.max(0, Math.floor(input.turnCount)) : 0

    const scanIdentity = {
      external: true as const,
      cwd,
      engine,
      providerSessionId,
      transcriptPath,
    }
    const existing =
      Array.from(this.sessions.values()).find(
        (record) => record.engine === engine && record.providerSessionId === providerSessionId
          && parseRuntimeResource(record.cwd)?.workspaceId === parseRuntimeResource(cwd)?.workspaceId,
      ) ??
      // A hook-owned row may know the transcript before it learns the provider
      // id, or never learn it at all. Match on either shared key so the same
      // conversation never becomes two cards.
      Array.from(this.sessions.values()).find((record) => this.sameConversation(record, scanIdentity))
    if (existing) {
      if (existing.external !== true) {
        let changed = false
        if (!existing.providerSessionId) {
          existing.providerSessionId = providerSessionId
          changed = true
        }
        if (!existing.transcriptPath) {
          existing.transcriptPath = transcriptPath
          existing.updatedAt = updatedAt > existing.updatedAt ? updatedAt : existing.updatedAt
          changed = true
        }
        // Hook-owned rows whose prompt never reached submit-line stay
        // titleless, and pre-fix rows can carry the AGENTS.md injection as
        // their title; the transcript first question heals both without
        // touching recorded turns.
        if (firstPrompt && isStaleFirstPrompt(existing.firstPrompt)) {
          existing.firstPrompt = firstPrompt
          if (isStaleFirstPrompt(existing.lastPrompt)) existing.lastPrompt = firstPrompt
          changed = true
        }
        // Provider prose/counts may advance in an outside terminal without
        // hooks. Keep that projection separate from run status and turn ids.
        if (this.updateTranscriptProjection(existing, input, updatedAt, turnCount)) changed = true
        if (changed) {
          this.persist()
          this.notify(existing.id)
        }
        return existing
      }
      let changed = false
      if (this.updateTranscriptProjection(existing, input, updatedAt, turnCount)) changed = true
      // Transcript is display truth for external rows: a rescan heals stale
      // first prompts (pre-fix rows stored the AGENTS.md injection as title)
      // and keeps the seed turns in step with the healed question.
      if (firstPrompt && (isStaleFirstPrompt(existing.firstPrompt) || existing.firstPrompt !== firstPrompt)) {
        const previous = existing.firstPrompt
        existing.firstPrompt = firstPrompt
        if (isStaleFirstPrompt(existing.lastPrompt) || existing.lastPrompt === previous) {
          existing.lastPrompt = firstPrompt
        }
        for (const turn of existing.turns) {
          if (turn.prompt === previous) turn.prompt = firstPrompt
        }
        changed = true
      }
      // Rescan recomputes the count instead of only growing it, so a
      // compacted or rewritten transcript stops presenting a stale total.
      if (existing.turnCount !== turnCount) {
        existing.turnCount = turnCount
        changed = true
      }
      if (existing.transcriptPath !== transcriptPath) {
        existing.transcriptPath = transcriptPath
        changed = true
      }
      if (updatedAt > existing.updatedAt) {
        existing.updatedAt = updatedAt
        changed = true
      }
      // Refresh the seed turns in place: question on the prompt seed, tail
      // answer on the excerpt seed, never one hybrid pair.
      const promptSeed = existing.turns.find((turn) => turn.prompt)
      const excerptSeed = existing.turns.find((turn) => turn.excerpt)
      if (excerptSeed && lastExcerpt && excerptSeed.excerpt !== lastExcerpt) {
        excerptSeed.excerpt = lastExcerpt
        excerptSeed.endedAt = existing.updatedAt
        changed = true
      }
      if (!excerptSeed && lastExcerpt) {
        existing.turns.push({ id: randomUUID(), kind: 'done', startedAt: updatedAt, endedAt: updatedAt, excerpt: lastExcerpt })
        changed = true
      }
      if (firstPrompt && existing.turns.length > 0 && (!promptSeed || isStaleFirstPrompt(promptSeed.prompt))) {
        const target = promptSeed ?? existing.turns[0]
        target.prompt = firstPrompt
        changed = true
      }
      if (changed) {
        this.persist()
        this.notify(existing.id)
      }
      return existing
    }

    const record: AgentSessionRecord = {
      id: randomUUID(),
      workspaceId: input.workspaceId ?? '',
      engine,
      cwd,
      branch: undefined,
      shell: undefined,
      preset: undefined,
      command: undefined,
      args: undefined,
      firstPrompt,
      lastPrompt: firstPrompt,
      turnCount,
      checkpointCount: 0,
      status: 'done',
      providerSessionId,
      transcriptPath,
      continuedFrom: undefined,
      terminalIds: [],
      // Two seed turns keep the question and the tail answer apart instead
      // of one hybrid pair that misreads as a single exchange.
      turns: [
        ...(firstPrompt
          ? [
              {
                id: randomUUID(),
                kind: 'done' as const,
                startedAt: createdAt,
                endedAt: createdAt,
                prompt: firstPrompt,
              },
            ]
          : []),
        ...(lastExcerpt
          ? [
              {
                id: randomUUID(),
                kind: 'done' as const,
                startedAt: updatedAt,
                endedAt: updatedAt,
                excerpt: lastExcerpt,
              },
            ]
          : []),
      ],
      checkpointIds: [],
      createdAt,
      updatedAt,
      archived: false,
      external: true,
    }
    this.updateTranscriptProjection(record, input, updatedAt, turnCount)
    this.sessions.set(record.id, record)
    this.prune()
    this.persist()
    this.notify(record.id)
    return record
  }

  private updateTranscriptProjection(record: AgentSessionRecord, input: ImportExternalSessionInput, updatedAt: string, count: number): boolean {
    if (!input.preview || (record.transcriptUpdatedAt && updatedAt < record.transcriptUpdatedAt)) return false
    let changed = false
    if (record.transcriptTurnCount !== count || JSON.stringify(record.transcriptPreview) !== JSON.stringify(input.preview)
      || record.transcriptUpdatedAt !== updatedAt) {
      record.transcriptTurnCount = count
      record.transcriptPreview = input.preview
      record.transcriptUpdatedAt = updatedAt
      changed = true
    }
    if (updatedAt > record.updatedAt) {
      record.updatedAt = updatedAt
      changed = true
    }
    return changed
  }

  setPendingHandoff(
    sessionId: string,
    handoff: string | undefined,
    state?: 'unconfirmed' | 'failed',
  ): void {
    const record = this.sessions.get(sessionId)
    if (!record) return
    if (handoff === undefined) {
      delete record.pendingHandoff
      delete record.pendingHandoffState
    } else {
      record.pendingHandoff = handoff
      if (state) record.pendingHandoffState = state
      else delete record.pendingHandoffState
    }
    record.updatedAt = new Date().toISOString()
    this.persist()
    this.notify(record.id)
  }

  archiveSession(sessionId: string): boolean {
    const record = this.sessions.get(sessionId)
    if (!record) return false
    record.archived = true
    record.updatedAt = new Date().toISOString()
    this.persist()
    this.notify(record.id)
    return true
  }

  /** Archive every session owned by a removed worktree path. */
  archiveSessionsByCwd(cwd: string): string[] {
    const ids: string[] = []
    for (const record of this.sessions.values()) {
      if (record.cwd === cwd && !record.archived) {
        record.archived = true
        record.updatedAt = new Date().toISOString()
        ids.push(record.id)
      }
    }
    if (ids.length > 0) {
      this.persist()
      this.notify()
    }
    return ids
  }

  getSession(sessionId: string): AgentSessionRecord | null {
    return this.sessions.get(sessionId) ?? null
  }

  listSessions(filter?: SessionFilter): AgentSessionSummary[] {
    return Array.from(this.sessions.values())
      .filter((record) => {
        if (!filter?.includeArchived && record.archived) return false
        if (filter?.workspaceId && record.workspaceId !== filter.workspaceId) return false
        if (filter?.cwd && !matchesCwdScope(record.cwd, filter.cwd)) return false
        if (filter?.engine && record.engine !== filter.engine) return false
        return true
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((record) => toSummary(record))
  }

  private recordForTerminal(terminalId: string): AgentSessionRecord | null {
    const sessionId = this.terminalToSession.get(terminalId)
    if (!sessionId) return null
    return this.sessions.get(sessionId) ?? null
  }

  private prune(): void {
    if (this.sessions.size <= MAX_SESSIONS) return
    const ordered = Array.from(this.sessions.values()).sort((a, b) =>
      a.updatedAt.localeCompare(b.updatedAt),
    )
    for (const record of ordered.slice(0, this.sessions.size - MAX_SESSIONS)) {
      this.sessions.delete(record.id)
    }
  }
}

function toSummary(record: AgentSessionRecord): AgentSessionSummary {
  return {
    id: record.id,
    workspaceId: record.workspaceId,
    engine: record.engine,
    cwd: record.cwd,
    branch: record.branch,
    firstPrompt: record.firstPrompt,
    turnCount: record.external ? record.turnCount : Math.max(record.turnCount, record.transcriptTurnCount ?? 0),
    checkpointCount: record.checkpointIds.length,
    status: toStatus(record),
    providerSessionId: record.providerSessionId,
    transcriptPath: record.transcriptPath,
    continuedFrom: record.continuedFrom,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    archived: record.archived,
    ...(record.external === true ? { external: true } : {}),
  }
}

function normalizeCwd(value: string): string {
  if (parseRuntimeResource(value)) return value.replace(/\/+$/g, '')
  return value.replace(/\\/g, '/').replace(/\/+$/g, '').toLowerCase()
}

/**
 * Exact match still wins; external sessions may live under a child path of a
 * workspace scope, so fall back to a path-boundary prefix after normalizing
 * separators, trailing slashes, and case. No substring fallback: a sibling
 * directory sharing a name prefix must never leak into the scope.
 */
function matchesCwdScope(recordCwd: string, scopeCwd: string): boolean {
  if (recordCwd === scopeCwd) return true
  const record = normalizeCwd(recordCwd)
  const scope = normalizeCwd(scopeCwd)
  if (!record || !scope) return false
  if (record === scope) return true
  return record.startsWith(`${scope}/`)
}

function toStatus(record: AgentSessionRecord): AgentSessionStatus {
  return record.status
}

function toImportTimestamp(value?: string): string | undefined {
  if (!value) return undefined
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) return undefined
  return new Date(parsed).toISOString()
}

export const agentSessionRegistry = new AgentSessionRegistry()
