// Note: native-session accounting — see .agents/notes/terminal/requirements/usage-telemetry-single-source.md
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { UsageLedgerPage, UsageLedgerQuery, UsageObservation, UsageRecord, UsageSessionStatus, UsageTokens, UsageSourceCheckpoint } from '../../shared/usage'

const FIELDS = ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'totalTokens'] as const
const MAX_PAGE = 2000
const MAX_RANGE = 367 * 86_400_000
function validTokens(value: UsageTokens): boolean {
  return FIELDS.every(field => value[field] === undefined || (Number.isSafeInteger(value[field]) && value[field]! >= 0))
    && value.inputTokens !== undefined && value.outputTokens !== undefined && value.totalTokens !== undefined
    && value.totalTokens === value.inputTokens + value.outputTokens + (value.cacheReadTokens ?? 0) + (value.cacheWriteTokens ?? 0)
}
/** Older Codex mappings folded cache writes into fresh input. */
function withoutCodexWrites(tokens: UsageTokens): UsageTokens {
  return { ...tokens, inputTokens: tokens.inputTokens + (tokens.cacheWriteTokens ?? 0), cacheWriteTokens: undefined }
}
function sameTokens(left: UsageTokens, right: UsageTokens): boolean {
  return FIELDS.every(field => left[field] === right[field])
}
interface SessionState extends UsageSessionStatus {
  codexCacheWrites?: true
  codexEventModels?: true
  counters?: UsageTokens
  model?: string
  sourceIdentity?: string
  sourceSize?: number
  sourceHash?: string
  /** Fixed at first record: a session never switches accounting mode, so a
   *  corpus event replay can never double-count an existing baseline. */
  mode?: 'events' | 'cumulative'
}

/** SQLite commits dedup identities, baselines and deltas together, including across processes. */
export class UsageLedger {
  private database?: DatabaseSync
  private databasePath?: string
  constructor(private readonly filePath: () => string) {}
  close(): void {
    this.database?.close()
    this.database = undefined
    this.databasePath = undefined
  }

  private open(): DatabaseSync {
    const path = this.filePath()
    if (this.database && this.databasePath === path) return this.database
    this.close()
    mkdirSync(dirname(path), { recursive: true })
    const database = new DatabaseSync(path)
    try {
      const version = database.prepare('PRAGMA user_version').get() as { user_version: number }
      if (version.user_version > 1) throw new Error('Unsupported usage ledger version')
      // A contended background write retries on the next pass, rather than
      // freezing Electron's event loop for three seconds. Durability is unchanged.
      database.exec('PRAGMA busy_timeout=100; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;')
      if (version.user_version === 0) database.exec(`
        BEGIN IMMEDIATE;
        CREATE TABLE IF NOT EXISTS sessions (key TEXT PRIMARY KEY, data TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS identities (key TEXT PRIMARY KEY, tokens TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS records (id INTEGER PRIMARY KEY, engine TEXT NOT NULL, at REAL NOT NULL, data TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS records_time ON records(at, id);
        CREATE INDEX IF NOT EXISTS records_engine_time ON records(engine, at, id);
        CREATE INDEX IF NOT EXISTS records_session ON records(engine, json_extract(data,'$.sessionId'), at, id);
        PRAGMA user_version=1;
        COMMIT;
      `)
      this.database = database
      database.exec("CREATE INDEX IF NOT EXISTS sessions_native_identity ON sessions(json_extract(key,'$[0]'), json_extract(key,'$[2]'))")
      this.databasePath = path
      return database
    } catch (error) { database.close(); throw error }
  }

  record(observation: UsageObservation): void {
    if (!observation.namespace || !observation.sessionId || !Number.isFinite(observation.collectedAt)) throw new Error('Invalid usage observation')
    const database = this.open()
    try {
      database.exec('BEGIN IMMEDIATE')
      // A copied/moved source is the same accounting stream only when native
      // event identities and counters prove overlap. Never merge solely by path or id.
      const exact = database.prepare('SELECT key FROM sessions WHERE key=?').get(JSON.stringify([observation.engine, observation.namespace, observation.sessionId]))
      if (!exact) {
        const candidates = database.prepare("SELECT key, data FROM sessions WHERE json_extract(key,'$[0]')=? AND json_extract(key,'$[2]')=?").all(observation.engine, observation.sessionId) as Array<{ key: string; data: string }>
        if (candidates.length) {
          const compatible = candidates.filter(candidate => {
            const namespace = (JSON.parse(candidate.key) as string[])[1]
            const state = JSON.parse(candidate.data) as SessionState
            if (observation.mode === 'cumulative') return !!observation.sourceHash && observation.sourceHash === state.sourceHash
            let overlap = false
            for (const event of observation.events ?? []) {
              const prior = database.prepare('SELECT tokens FROM identities WHERE key=?').get(JSON.stringify([observation.engine, namespace, event.id])) as { tokens: string } | undefined
              if (!prior) continue
              if (!sameTokens(JSON.parse(prior.tokens) as UsageTokens, event)) return false
              overlap = true
            }
            return overlap
          })
          if (compatible.length !== 1) throw new Error(`Conflicting history sources for ${observation.engine} session ${observation.sessionId}`)
          observation = { ...observation, namespace: (JSON.parse(compatible[0].key) as string[])[1] }
        }
      }
      const key = JSON.stringify([observation.engine, observation.namespace, observation.sessionId])
      const stored = database.prepare('SELECT data FROM sessions WHERE key=?').get(key) as { data: string } | undefined
      const previous = stored ? JSON.parse(stored.data) as SessionState : undefined
      if (previous && observation.collectedAt < previous.updatedAt) { database.exec('COMMIT'); return }
      const state: SessionState = previous ?? { engine: observation.engine, sessionId: key, coverageStart: observation.collectedAt, updatedAt: observation.collectedAt }
      const insertRecord = database.prepare('INSERT INTO records(engine, at, data) VALUES (?, ?, ?)')
      const append = (tokens: UsageTokens, at: number, timeBasis: 'event' | 'sample', model?: string, intervalStart?: number, eventId?: string) => {
        if (tokens.totalTokens === 0) return
        const record: UsageRecord = { ...tokens, id: '', engine: observation.engine, sessionId: key, at, timeBasis, model, intervalStart, eventId }
        insertRecord.run(record.engine, at, JSON.stringify(record))
      }
      // Counter regressions/changed event identities remain paused until source-backed recovery.
      if (state.issue?.startsWith('counter-') || state.issue === 'event-changed') {
        database.exec('COMMIT'); return
      }
      // Mode is fixed at first sighting (legacy rows infer it from their shape):
      // the terminal path may baseline a session the corpus scanner already
      // event-imported, and honouring both would double-count every later turn.
      const lockedMode = previous === undefined
        ? observation.mode
        : state.mode ?? (state.counters ? 'cumulative' : 'events')
      if (lockedMode !== observation.mode) { database.exec('COMMIT'); return }
      state.mode = lockedMode
      state.issue = observation.issue
      if (!observation.issue && observation.mode === 'events') {
        const findIdentity = database.prepare('SELECT tokens FROM identities WHERE key=?')
        const insertIdentity = database.prepare('INSERT INTO identities(key, tokens) VALUES (?, ?)')
        for (const event of observation.events ?? []) {
          if (!event.id || !validTokens(event)) { state.issue = 'invalid-event'; continue }
          const identity = JSON.stringify([observation.engine, observation.namespace, event.id])
          const prior = findIdentity.get(identity) as { tokens: string } | undefined
          const tokens: UsageTokens = { inputTokens: event.inputTokens, outputTokens: event.outputTokens, cacheReadTokens: event.cacheReadTokens, cacheWriteTokens: event.cacheWriteTokens, totalTokens: event.totalTokens }
          if (prior) {
            const oldTokens = JSON.parse(prior.tokens) as UsageTokens
            const legacyCodex = observation.engine === 'codex' && oldTokens.cacheWriteTokens === undefined
              && sameTokens(oldTokens, withoutCodexWrites(tokens))
            // Preserve already booked history; a newly available breakdown is
            // not changed consumption and must not pause later event imports.
            if (!sameTokens(oldTokens, tokens) && !legacyCodex) state.issue = 'event-changed'
            else if (legacyCodex && tokens.cacheWriteTokens !== undefined) {
              // Old records predate stored event identities. Locate one matching
              // booked event, preserve its id/date/model, and only repartition
              // its input. Identical events are upgraded one record at a time.
              const rows = database.prepare(`SELECT id, data FROM records WHERE engine='codex'
                AND json_extract(data,'$.sessionId')=? AND json_extract(data,'$.inputTokens')=?
                AND json_extract(data,'$.outputTokens')=? AND json_extract(data,'$.cacheReadTokens') IS ?
                AND json_extract(data,'$.cacheWriteTokens') IS NULL AND json_extract(data,'$.totalTokens')=?
                AND (? IS NULL OR at=?) ORDER BY id LIMIT 2`)
                .all(key, oldTokens.inputTokens, oldTokens.outputTokens, oldTokens.cacheReadTokens ?? null,
                  oldTokens.totalTokens, event.at ?? null, event.at ?? null) as Array<{ id: number; data: string }>
              const row = rows[0]
              if (row) {
                const booked = JSON.parse(row.data) as UsageRecord
                // Include already repartitioned rows when checking ownership:
                // upgrading an earlier identical row must not make this one
                // appear unambiguous merely because its write split is old.
                const candidates = event.model && event.at !== undefined ? database.prepare(`SELECT id FROM records WHERE engine='codex' AND at=?
                  AND json_extract(data,'$.sessionId')=? AND json_extract(data,'$.timeBasis')='event'
                  AND (json_extract(data,'$.eventId') IS NULL OR json_extract(data,'$.eventId')=?)
                  AND json_extract(data,'$.inputTokens')+COALESCE(json_extract(data,'$.cacheWriteTokens'),0)=?
                  AND json_extract(data,'$.outputTokens')=? AND json_extract(data,'$.cacheReadTokens') IS ?
                  AND json_extract(data,'$.totalTokens')=? LIMIT 2`)
                  .all(event.at, key, event.id, oldTokens.inputTokens, oldTokens.outputTokens,
                    oldTokens.cacheReadTokens ?? null, oldTokens.totalTokens) as Array<{ id: number }> : []
                const model = candidates.length === 1 && candidates[0].id === row.id && booked.timeBasis === 'event' && event.at !== undefined
                  && (!booked.eventId || booked.eventId === event.id) && !booked.model && event.model
                  ? { model: event.model, eventId: event.id } : {}
                database.prepare('UPDATE records SET data=? WHERE id=?')
                  .run(JSON.stringify({ ...booked, ...tokens, ...model }), row.id)
                database.prepare('UPDATE identities SET tokens=? WHERE key=?').run(JSON.stringify(tokens), identity)
              }
            }
            if (sameTokens(oldTokens, tokens) && event.model && event.at !== undefined && event.totalTokens > 0) {
              // Legacy records lack an event-to-record link. Only enrich one
              // unambiguous exact-time/count match, never a latest-model guess.
              const rows = database.prepare(`SELECT id,data FROM records WHERE engine=? AND at=?
                AND json_extract(data,'$.sessionId')=? AND json_extract(data,'$.timeBasis')='event'
                AND (json_extract(data,'$.eventId') IS NULL OR json_extract(data,'$.eventId')=?)
                AND json_extract(data,'$.inputTokens')=? AND json_extract(data,'$.outputTokens')=?
                AND json_extract(data,'$.cacheReadTokens') IS ? AND json_extract(data,'$.cacheWriteTokens') IS ?
                AND json_extract(data,'$.totalTokens')=? LIMIT 2`)
                .all(observation.engine, event.at, key, event.id, tokens.inputTokens, tokens.outputTokens,
                  tokens.cacheReadTokens ?? null, tokens.cacheWriteTokens ?? null, tokens.totalTokens) as Array<{ id: number; data: string }>
              if (rows.length === 1 && !(JSON.parse(rows[0].data) as UsageRecord).model) database.prepare('UPDATE records SET data=? WHERE id=?')
                .run(JSON.stringify({ ...JSON.parse(rows[0].data) as UsageRecord, model: event.model, eventId: event.id }), rows[0].id)
            }
            continue
          }
          insertIdentity.run(identity, JSON.stringify(tokens))
          const exact = event.at !== undefined && Number.isFinite(event.at) && event.at > 0 && event.at <= observation.collectedAt
          const at = exact ? event.at! : observation.collectedAt
          state.coverageStart = Math.min(state.coverageStart, at)
          append(tokens, at, exact ? 'event' : 'sample', event.model, undefined, event.id)
        }
        // Complete-byte cursor lets the corpus scanner skip unchanged files.
        if (observation.sourceSize !== undefined) state.sourceSize = observation.sourceSize
      } else if (!observation.issue && observation.mode === 'cumulative') {
        const next = observation.counters
        const changedSource = state.sourceIdentity !== undefined && observation.sourceIdentity !== state.sourceIdentity
        const truncatedSource = state.sourceSize !== undefined && observation.sourceSize !== undefined && observation.sourceSize < state.sourceSize
        const rewrittenSource = state.sourceHash !== undefined && observation.sourcePrefixHash !== state.sourceHash
        if (changedSource || truncatedSource || rewrittenSource) state.issue = 'counter-source-changed'
        else if (!next || !validTokens(next)) state.issue = 'invalid-counter'
        else if (state.counters) {
          const baseline = state.counters
          // The first upgraded interval has no historical write baseline.
          // Keep it unsplit, then use the native write counter from here on.
          const comparable = observation.engine === 'codex' && baseline.cacheWriteTokens === undefined
            ? withoutCodexWrites(next) : next
          const regressed = FIELDS.some(field => baseline[field] !== undefined && (comparable[field] === undefined || comparable[field]! < baseline[field]!))
          if (regressed) state.issue = 'counter-regressed'
          else {
            const delta = Object.fromEntries(FIELDS.map(field => [field, comparable[field] === undefined || baseline[field] === undefined ? undefined : comparable[field]! - baseline[field]!])) as unknown as UsageTokens
            if (!validTokens(delta)) state.issue = 'counter-fields-changed'
            else {
              const changedModel = observation.modelChangedAt !== undefined && observation.modelChangedAt > state.updatedAt
              append(delta, observation.collectedAt, 'sample', !changedModel && state.model === observation.model ? observation.model : undefined, state.updatedAt)
              state.counters = next
            }
          }
        } else state.counters = next // First observation establishes coverage; it is never today's consumption.
        state.model = observation.model
        state.sourceIdentity = observation.sourceIdentity
        state.sourceSize = observation.sourceSize
        state.sourceHash = observation.sourceHash
      }
      if (observation.engine === 'codex' && !state.issue) state.codexCacheWrites = true
      if (observation.engine === 'codex' && observation.mode === 'events' && !state.issue) state.codexEventModels = true
      state.updatedAt = observation.collectedAt
      database.prepare('INSERT OR REPLACE INTO sessions(key, data) VALUES (?, ?)').run(key, JSON.stringify(state))
      database.exec('COMMIT')
    } catch (error) {
      try { database.exec('ROLLBACK') } catch { /* transaction may not have started */ }
      throw error
    }
  }

  list(query: UsageLedgerQuery): UsageLedgerPage {
    if (!Number.isFinite(query.start) || !Number.isFinite(query.end) || query.end < query.start || query.end - query.start > MAX_RANGE) throw new Error('Invalid usage date range')
    const limit = Math.min(MAX_PAGE, Math.max(1, Math.trunc(query.limit ?? MAX_PAGE)))
    const offset = Math.max(0, Math.trunc(query.offset ?? 0))
    if (!Number.isFinite(limit) || !Number.isFinite(offset)) throw new Error('Invalid usage page')
    const database = this.open()
    try {
      database.exec('BEGIN')
      const throughId = query.throughId ?? Number((database.prepare('SELECT COALESCE(MAX(id),0) AS id FROM records').get() as { id: number }).id)
      if (!Number.isSafeInteger(throughId) || throughId < 0) throw new Error('Invalid usage cursor')
      const rows = database.prepare('SELECT id, data FROM records WHERE at>=? AND at<=? AND id<=? AND (? IS NULL OR engine=?) ORDER BY at,id LIMIT ? OFFSET ?')
        .all(query.start, query.end, throughId, query.engine ?? null, query.engine ?? null, limit + 1, offset) as Array<{ id: number; data: string }>
      const statusFilter = "json_extract(data,'$.coverageStart')<=? AND (? IS NULL OR json_extract(data,'$.engine')=?)"
      const scope = [query.end, query.engine ?? null, query.engine ?? null]
      const summary = database.prepare(`SELECT MIN(json_extract(data,'$.coverageStart')) AS coverageStart, MAX(json_extract(data,'$.issue') IS NOT NULL) AS hasIssues FROM sessions WHERE ${statusFilter}`).get(...scope) as { coverageStart: number | null; hasIssues: number | null }
      const sessions = (database.prepare(`SELECT data FROM sessions WHERE ${statusFilter} ORDER BY key LIMIT 2000`).all(...scope) as Array<{ data: string }>).map(row => JSON.parse(row.data) as UsageSessionStatus)
        .map(({ engine, sessionId, coverageStart, updatedAt, issue }) => ({ engine, sessionId, coverageStart, updatedAt, issue }))
      database.exec('COMMIT')
      return { records: rows.slice(0, limit).map(row => ({ ...JSON.parse(row.data) as UsageRecord, id: String(row.id) })), sessions, coverageStart: summary.coverageStart ?? undefined, hasIssues: Boolean(summary.hasIssues), throughId, nextOffset: rows.length > limit ? offset + limit : undefined }
    } catch (error) {
      try { database.exec('ROLLBACK') } catch { /* transaction may not have started */ }
      throw error
    }
  }

  markMissing(engine: string, sessionId: string): void {
    const database = this.open()
    database.prepare("UPDATE sessions SET data=json_set(data,'$.issue','source-unavailable') WHERE json_extract(key,'$[0]')=? AND json_extract(key,'$[2]')=? AND json_extract(data,'$.issue') IS NULL").run(engine, sessionId)
  }

  sourceCheckpoint(engine: string, namespace: string, sessionId: string): UsageSourceCheckpoint | undefined {
    const database = this.open()
    const row = database.prepare('SELECT data FROM sessions WHERE key=?').get(JSON.stringify([engine, namespace, sessionId])) as { data: string } | undefined
    if (!row) return undefined
    const { sourceSize, sourceHash, updatedAt, model, mode, counters } = JSON.parse(row.data) as SessionState
    return { sourceSize, sourceHash, updatedAt, model, mode: mode ?? (counters ? 'cumulative' : 'events') }
  }

  /** Corpus scanner pre-flight: accounting mode already locked for a session, plus its read cursor. */
  sessionState(engine: string, namespace: string, sessionId: string): { mode: 'events' | 'cumulative'; sourceSize?: number } | undefined {
    const database = this.open()
    const row = database.prepare('SELECT data FROM sessions WHERE key=?').get(JSON.stringify([engine, namespace, sessionId])) as { data: string } | undefined
    if (!row) return undefined
    const { counters, mode, sourceSize, codexCacheWrites, codexEventModels } = JSON.parse(row.data) as SessionState
    const lockedMode = mode ?? (counters ? 'cumulative' : 'events')
    // Re-read old events once for source-backed model/caching enrichment.
    return { mode: lockedMode, sourceSize: engine === 'codex' && (!codexCacheWrites || (lockedMode === 'events' && !codexEventModels)) ? undefined : sourceSize }
  }
}
