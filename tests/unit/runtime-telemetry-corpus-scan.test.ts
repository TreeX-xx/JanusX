import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile, stat } from 'fs/promises'
import { DatabaseSync } from 'node:sqlite'
import { zstdCompressSync } from 'node:zlib'
import { join } from 'path'
import { tmpdir } from 'os'

const testContext = vi.hoisted(() => ({ homeDir: '' }))

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>()
  return {
    ...actual,
    default: { ...actual.default, homedir: () => testContext.homeDir },
  }
})

const { scanNativeSessionCorpus } = await import('../../src/main/runtime-telemetry/corpus-scan')
const { UsageLedger } = await import('../../src/main/runtime-telemetry/usage-ledger')
const { getRuntimeTelemetrySnapshot } = await import('../../src/main/runtime-telemetry/history')
const openLedgers: InstanceType<typeof UsageLedger>[] = []
function createLedger(...args: ConstructorParameters<typeof UsageLedger>) {
  const value = new UsageLedger(...args)
  openLedgers.push(value)
  return value
}

let ledger: InstanceType<typeof UsageLedger>
let ledgerPath: string

async function writeCodexRollout(sessionId: string, events: Array<{ at: string; input: number; cached: number; written?: number; output: number; total: number }>, options: { archived?: boolean; inheritedFromOrdinal?: number } = {}) {
  const root = join(testContext.homeDir, '.codex', options.archived ? 'archived_sessions' : 'sessions', '2026', '10', '14')
  await mkdir(root, { recursive: true })
  const lines = [JSON.stringify({
    timestamp: '2026-10-14T06:00:00.000Z',
    ordinal: 0,
    type: 'session_meta',
    payload: options.inheritedFromOrdinal === undefined
      ? { id: sessionId, cwd: 'C:/repo' }
      : { id: sessionId, cwd: 'C:/repo', forked_from_id: 'parent-thread', subagent_history_start_ordinal: options.inheritedFromOrdinal },
  })]
  // Real rollouts accumulate total_token_usage across events while
  // last_token_usage stays per request.
  const running = { input: 0, cached: 0, written: 0, output: 0, total: 0 }
  events.forEach((event, index) => {
    running.input += event.input
    running.cached += event.cached
    running.written += event.written ?? 0
    running.output += event.output
    running.total += event.total
    lines.push(JSON.stringify({
      timestamp: event.at,
      ordinal: index + 1,
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: {
          last_token_usage: {
            input_tokens: event.input,
            cached_input_tokens: event.cached,
            cache_write_input_tokens: event.written,
            output_tokens: event.output,
            total_tokens: event.total,
          },
          total_token_usage: {
            input_tokens: running.input,
            cached_input_tokens: running.cached,
            cache_write_input_tokens: event.written === undefined ? undefined : running.written,
            output_tokens: running.output,
            total_tokens: running.total,
          },
        },
      },
    }))
  })
  await writeFile(join(root, `rollout-2026-10-14T06-00-00-${sessionId}.jsonl`), lines.join('\n'))
}

function readRecords() {
  const page = ledger.list({ start: Date.parse('2026-01-01T00:00:00Z'), end: Date.parse('2027-01-01T00:00:00Z'), limit: 2000 })
  return page.records
}

const dshLine = (value: object) => JSON.stringify(value) + '\n'
const dshReply = (seq: number, output: number) => dshLine({ type: 'assistant/message', seq, time: Date.parse('2026-10-11T08:01:00Z') + seq, data: {
  message: { source: { model: 'requested', replayState: { response: { responseModel: 'served' } } } },
  usage: { inputTokens: 448, outputTokens: output, cacheReadTokens: 5504, reasoningTokens: 5, totalTokens: 5952 + output },
} })

describe('corpus usage scan', () => {
  it('imports DSH frames once, prefers the latest format and waits for the end of a fork seed', async () => {
    const home = join(testContext.homeDir, 'custom-dsh')
    vi.stubEnv('DSH_HOME', home)
    const dir = join(home, 'sessions', 'work', 'session-child')
    await mkdir(dir, { recursive: true })
    const header = { type: 'session', id: 'child', version: 4, isSeeded: true }
    await writeFile(join(dir, 'session.v3.jsonl'), dshLine({ ...header, version: 3, isSeeded: false }) + dshReply(3, 999))
    const file = join(dir, 'session.v4.jsonl.zstd')
    await writeFile(file, Buffer.concat([zstdCompressSync(dshLine(header)), zstdCompressSync(dshReply(1, 90))]))
    await scanNativeSessionCorpus({ ledger })
    expect(readRecords()).toEqual([])
    const completed = zstdCompressSync(dshLine({ type: 'session/end-seed', seq: 2, data: { inherited: true } }) + dshReply(3, 203))
    const next = zstdCompressSync(dshReply(4, 38))
    await appendFile(file, Buffer.concat([completed, next.subarray(0, -2)]))
    await scanNativeSessionCorpus({ ledger })
    expect(readRecords()).toEqual([expect.objectContaining({ engine: 'dsh', totalTokens: 6155, outputTokens: 203, model: 'served', timeBasis: 'event' })])
    await appendFile(file, next.subarray(-2))
    await scanNativeSessionCorpus({ ledger })
    expect(readRecords().map(r => r.outputTokens)).toEqual([203, 38])
    expect((await scanNativeSessionCorpus({ ledger })).skipped).toBe(1)
  })

  it('keeps DSH version-zero seed events with the parent and retains history across a corrupt file', async () => {
    const dir = join(testContext.homeDir, '.dsh', 'sessions', 'workspace', 'child')
    await mkdir(dir, { recursive: true })
    const file = join(dir, 'session.jsonl')
    const original = dshLine({ type: 'session', id: 'child', version: 0, seedLength: 2 }) + dshReply(1, 99) + dshReply(2, 17)
    await writeFile(file, original)
    await scanNativeSessionCorpus({ ledger })
    expect(readRecords().map(r => r.outputTokens)).toEqual([17])
    await appendFile(file, 'corrupt\n' + dshReply(3, 11))
    expect((await scanNativeSessionCorpus({ ledger })).unavailable).toBe(1)
    expect(readRecords().map(r => r.outputTokens)).toEqual([17])
    await writeFile(file, original + dshReply(3, 11))
    await scanNativeSessionCorpus({ ledger })
    expect(readRecords().map(r => r.outputTokens)).toEqual([17, 11])
  })
  it('retains legacy handling of valid Codex files containing no accounting records', async () => {
    const id = 'aaaaaaaa-1111-4111-8111-111111111111'
    const root = join(testContext.homeDir, '.codex', 'sessions')
    await mkdir(root, { recursive: true })
    await writeFile(join(root, `rollout-fixture-${id}.jsonl`), '{"type":"response_item","payload":{"text":"body only"}}\n')
    const summary = await scanNativeSessionCorpus({ ledger })
    expect(summary).toMatchObject({ scanned: 1, recorded: 1, unavailable: 0 })
    expect(readRecords()).toEqual([])
  })

  it('imports unbound OpenCode requests with native timestamps, cache counts and reasoning, then deduplicates replays', async () => {
    const root = join(testContext.homeDir, '.local', 'share', 'opencode')
    await mkdir(root, { recursive: true })
    const path = join(root, 'opencode.db')
    const db = new DatabaseSync(path)
    db.exec(`CREATE TABLE session(id TEXT PRIMARY KEY,directory TEXT,time_updated INTEGER);
      CREATE TABLE message(id TEXT PRIMARY KEY,session_id TEXT,time_created INTEGER,time_updated INTEGER,data TEXT);
      CREATE INDEX message_session ON message(session_id);`)
    const at = Date.parse('2026-10-14T06:00:00Z')
    db.prepare('INSERT INTO session VALUES (?,?,?)').run('oc1', 'C:/repo', at)
    const insert = db.prepare('INSERT INTO message VALUES (?,?,?,?,?)')
    const data = (completed: boolean, model = 'model-a') => JSON.stringify({ role: 'assistant', modelID: model, time: { created: at, completed: completed ? at + 1000 : undefined }, tokens: { input: 10, output: 5, reasoning: 3, cache: { read: 20, write: 2 } } })
    insert.run('m1', 'oc1', at, at + 1000, data(true))
    insert.run('m2', 'oc1', at, at + 1000, data(false, 'model-b'))
    await scanNativeSessionCorpus({ ledger })
    expect(readRecords()).toHaveLength(1)
    expect(readRecords()[0]).toMatchObject({ engine: 'opencode', model: 'model-a', inputTokens: 10, outputTokens: 8, cacheReadTokens: 20, cacheWriteTokens: 2, totalTokens: 40, at: at + 1000, timeBasis: 'event' })
    await scanNativeSessionCorpus({ ledger })
    expect(readRecords()).toHaveLength(1)
    db.prepare('UPDATE message SET data=? WHERE id=?').run(data(true, 'model-b'), 'm2')
    db.close()
    await scanNativeSessionCorpus({ ledger })
    expect(readRecords()).toHaveLength(2)
    const snapshot = await getRuntimeTelemetrySnapshot({ preset: 'opencode', cwd: 'C:/repo', sessionId: 'oc1' })
    expect(snapshot).toMatchObject({ totalTokens: 80, contextTokens: 32, outputTokens: 16 })
    ledger.record(snapshot!.usageObservation!)
    expect(readRecords()).toHaveLength(2)
    expect(await getRuntimeTelemetrySnapshot({ preset: 'opencode', cwd: 'C:/other', sessionId: 'oc1' })).toBeNull()
  })

  it('reads OpenCode v2 without replaying migrated v1 sessions and keeps compaction usage', async () => {
    const root = join(testContext.homeDir, '.local', 'share', 'opencode')
    await mkdir(root, { recursive: true })
    const db = new DatabaseSync(join(root, 'opencode.db'))
    db.exec(`CREATE TABLE session(id TEXT PRIMARY KEY,directory TEXT,time_updated INTEGER);
      CREATE TABLE message(id TEXT PRIMARY KEY,session_id TEXT,time_created INTEGER,time_updated INTEGER,data TEXT);
      CREATE TABLE session_v2(id TEXT PRIMARY KEY,directory TEXT,time_updated INTEGER);
      CREATE TABLE session_message(id TEXT PRIMARY KEY,session_id TEXT,seq INTEGER,type TEXT,time_updated INTEGER,data TEXT);
      CREATE TABLE kv(key TEXT PRIMARY KEY,value TEXT);`)
    const at = Date.parse('2026-10-14T06:00:00Z')
    db.prepare('INSERT INTO session VALUES (?,?,?)').run('same', 'C:/repo', at)
    db.prepare('INSERT INTO session_v2 VALUES (?,?,?)').run('same', 'C:/repo', at)
    const data = { model: { id: 'v2-model' }, time: { completed: at }, tokens: { input: 10, output: 2, reasoning: 1, cache: { read: 0, write: 0 } } }
    db.prepare('INSERT INTO message VALUES (?,?,?,?,?)').run('old', 'same', at, at, JSON.stringify({ ...data, role: 'assistant' }))
    const insert = db.prepare('INSERT INTO session_message VALUES (?,?,?,?,?,?)')
    insert.run('new', 'same', 1, 'assistant', at, JSON.stringify(data))
    insert.run('compact', 'same', 2, 'compaction', at, JSON.stringify({ ...data, model: undefined }))
    await scanNativeSessionCorpus({ ledger })
    expect(readRecords()).toHaveLength(2)
    expect(readRecords().every(row => row.model === 'v2-model' && row.outputTokens === 3)).toBe(true)
    db.prepare('INSERT INTO kv VALUES (?,?)').run('migration.v1-v2', JSON.stringify({ phase: 'completed' }))
    db.prepare('INSERT INTO session VALUES (?,?,?)').run('stale-only', 'C:/repo', at)
    db.prepare('INSERT INTO message VALUES (?,?,?,?,?)').run('stale', 'stale-only', at, at, JSON.stringify({ ...data, role: 'assistant' }))
    db.close()
    await scanNativeSessionCorpus({ ledger })
    expect(readRecords()).toHaveLength(2)
  })

  it('retains an existing OpenCode cumulative baseline instead of replaying its historical events', async () => {
    const root = join(testContext.homeDir, '.local', 'share', 'opencode')
    await mkdir(root, { recursive: true })
    const path = join(root, 'opencode.db')
    const db = new DatabaseSync(path)
    db.exec(`CREATE TABLE session(id TEXT PRIMARY KEY,directory TEXT,time_updated INTEGER,tokens_input INTEGER,tokens_output INTEGER,tokens_cache_read INTEGER,tokens_cache_write INTEGER);
      CREATE TABLE message(id TEXT PRIMARY KEY,session_id TEXT,time_created INTEGER,time_updated INTEGER,data TEXT);`)
    const at = Date.parse('2026-10-14T06:00:00Z')
    const counters = { inputTokens: 10, outputTokens: 5, cacheReadTokens: 20, cacheWriteTokens: 2, totalTokens: 37 }
    ledger.record({ engine: 'opencode', namespace: path, sessionId: 'old', collectedAt: at, mode: 'cumulative', counters, model: 'm' })
    db.prepare('INSERT INTO session VALUES (?,?,?,?,?,?,?)').run('old', 'C:/repo', at + 1000, 20, 10, 40, 4)
    db.prepare('INSERT INTO message VALUES (?,?,?,?,?)').run('reply', 'old', at, at + 1000, JSON.stringify({ role: 'assistant', modelID: 'm', time: { completed: at + 1000 }, tokens: { input: 20, output: 10, cache: { read: 40, write: 4 } } }))
    db.close()
    await scanNativeSessionCorpus({ ledger, now: at + 2000 })
    expect(readRecords()).toHaveLength(1)
    expect(readRecords()[0]).toMatchObject({ ...counters, timeBasis: 'sample', model: 'm' })
    await scanNativeSessionCorpus({ ledger, now: at + 3000 })
    expect(readRecords()).toHaveLength(1)
  })
  it('preserves verified source hashes when a cumulative session moves between terminal and corpus reads', async () => {
    const id = 'cccccccc-1111-4111-8111-111111111111'
    await writeCodexRollout(id, [{ at: '2026-10-14T06:01:00Z', input: 10, cached: 0, output: 0, total: 10 }])
    const snapshot = await getRuntimeTelemetrySnapshot({ preset: 'codex', cwd: 'C:/repo', sessionId: id })
    ledger.record(snapshot!.usageObservation!)
    const file = snapshot!.filePath!
    const count = (input: number) => JSON.stringify({ type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: input, cached_input_tokens: 0, output_tokens: 0, total_tokens: input } } } })
    await appendFile(file, '\n' + count(20) + '\n{"unfinished":')
    await scanNativeSessionCorpus({ ledger })
    await appendFile(file, 'true}\n' + count(25) + '\n')
    await scanNativeSessionCorpus({ ledger })
    let page = ledger.list({ start: Date.now() - 60_000, end: Date.now() + 1000 })
    expect(page.hasIssues).toBe(false)
    expect(page.records.map(value => value.totalTokens)).toEqual([10, 5])
    const before = await readFile(file, 'utf8')
    await writeFile(file, before.replace('"input_tokens":10', '"input_tokens":11') + '\n')
    await scanNativeSessionCorpus({ ledger })
    page = ledger.list({ start: Date.now() - 60_000, end: Date.now() + 1000 })
    expect(page.sessions[0].issue).toBe('counter-source-changed')
    expect(page.records.map(value => value.totalTokens)).toEqual([10, 5])
  })
  it('stops between files on cancellation and resumes without losing or double-counting usage', async () => {
    const events = [{ at: '2026-10-14T06:01:00Z', input: 10, cached: 0, output: 0, total: 10 }]
    await writeCodexRollout('aaaaaaaa-1111-4111-8111-111111111111', events)
    await writeCodexRollout('bbbbbbbb-1111-4111-8111-111111111111', events)
    const controller = new AbortController()
    const record = ledger.record.bind(ledger)
    const cancel = vi.spyOn(ledger, 'record').mockImplementation(observation => { record(observation); controller.abort() })
    await expect(scanNativeSessionCorpus({ ledger, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    cancel.mockRestore()
    expect((await scanNativeSessionCorpus({ ledger })).skipped).toBe(1)
    const page = ledger.list({ start: Date.parse('2026-10-14'), end: Date.parse('2026-10-15') })
    expect(page.records.map(value => value.totalTokens)).toEqual([10, 10])
  })
  beforeEach(async () => {
    vi.stubEnv('CODEX_HOME', '')
    vi.stubEnv('DSH_HOME', '')
    testContext.homeDir = await mkdtemp(join(tmpdir(), 'janusx-corpus-'))
    ledgerPath = join(testContext.homeDir, 'ledger', 'usage-ledger.sqlite')
    ledger = createLedger(() => ledgerPath)
  })

  afterEach(async () => {
    for (const value of openLedgers.splice(0)) value.close()
    vi.unstubAllEnvs()
    await rm(testContext.homeDir, { recursive: true, force: true })
  })

  it('accumulates native Codex writes, preserves totals and skips inherited writes', async () => {
    const events = [
      { at: '2026-10-14T06:01:00Z', input: 1000, cached: 200, written: 700, output: 100, total: 1100 },
      { at: '2026-10-14T06:02:00Z', input: 500, cached: 300, written: 150, output: 50, total: 550 },
    ]
    await writeCodexRollout('01a88888-8888-4888-8888-888888888888', events)
    await writeCodexRollout('01a99999-9999-4999-8999-999999999999', events, { inheritedFromOrdinal: 2 })
    await scanNativeSessionCorpus({ ledger, now: Date.parse('2026-10-14T07:00:00Z') })
    expect(readRecords().map(row => [row.inputTokens, row.cacheWriteTokens, row.totalTokens])).toEqual([
      [100, 700, 1100], [50, 150, 550], [50, 150, 550],
    ])
    await scanNativeSessionCorpus({ ledger, now: Date.parse('2026-10-14T07:05:00Z') })
    expect(readRecords()).toHaveLength(3)
  })

  it('backfills unchanged legacy event history once without changing record ids or dates', async () => {
    const sessionId = '01a88888-8888-4888-8888-888888888888'
    const namespace = join(testContext.homeDir, '.codex')
    const at = Date.parse('2026-10-14T06:01:00Z')
    await writeCodexRollout(sessionId, [{ at: new Date(at).toISOString(), input: 1000, cached: 200, written: 700, output: 100, total: 1100 }])
    const file = join(namespace, 'sessions', '2026', '10', '14', `rollout-2026-10-14T06-00-00-${sessionId}.jsonl`)
    ledger.record({ engine: 'codex', namespace, sessionId, collectedAt: at + 1000, mode: 'events', sourceSize: (await stat(file)).size,
      events: [{ id: `${sessionId}#1`, at, inputTokens: 800, cacheReadTokens: 200, outputTokens: 100, totalTokens: 1100 }] })
    const before = readRecords()[0]
    // Simulate a stored session created before cache-write mapping existed.
    const database = new DatabaseSync(ledgerPath)
    database.prepare("UPDATE sessions SET data=json_remove(data,'$.codexCacheWrites') WHERE key=?").run(JSON.stringify(['codex', namespace, sessionId]))
    database.close()
    const scan = await scanNativeSessionCorpus({ ledger, now: at + 2000 })
    expect(scan.recorded).toBe(1)
    expect(readRecords()).toHaveLength(1)
    expect(readRecords()[0]).toMatchObject({ id: before.id, at: before.at, inputTokens: 100, cacheWriteTokens: 700, totalTokens: 1100 })
    expect(ledger.list({ start: at - 1000, end: at + 3000 }).hasIssues).toBe(false)
    expect((await scanNativeSessionCorpus({ ledger, now: at + 3000 })).skipped).toBe(1)
  })

  it('rereads unchanged Codex files once to enrich legacy event models, then resumes skipping', async () => {
    const sessionId = '01a88888-8888-4888-8888-888888888888'
    const namespace = join(testContext.homeDir, '.codex')
    const at = Date.parse('2026-10-14T06:01:00Z')
    await writeCodexRollout(sessionId, [{ at: new Date(at).toISOString(), input: 10, cached: 0, output: 0, total: 10 }])
    const file = join(namespace, 'sessions', '2026', '10', '14', `rollout-2026-10-14T06-00-00-${sessionId}.jsonl`)
    const lines = (await readFile(file, 'utf8')).split('\n')
    lines.splice(1, 0, JSON.stringify({ type: 'turn_context', payload: { model: 'model-a' } }))
    await writeFile(file, lines.join('\n'))
    ledger.record({ engine: 'codex', namespace, sessionId, collectedAt: at + 1000, mode: 'events', sourceSize: (await stat(file)).size,
      events: [{ id: `${sessionId}#1`, at, inputTokens: 10, cacheReadTokens: 0, outputTokens: 0, totalTokens: 10 }] })
    const before = readRecords()[0]
    const database = new DatabaseSync(ledgerPath)
    database.exec("UPDATE sessions SET data=json_remove(data,'$.codexEventModels')")
    database.exec("UPDATE records SET data=json_remove(data,'$.eventId')")
    database.close()
    expect((await scanNativeSessionCorpus({ ledger, now: at + 2000 })).recorded).toBe(1)
    expect(readRecords()).toEqual([{ ...before, model: 'model-a' }])
    expect((await scanNativeSessionCorpus({ ledger, now: at + 3000 })).skipped).toBe(1)
    expect(readRecords()).toHaveLength(1)
  })

  it('imports a never-opened codex session by event time and dedups re-scans', async () => {
    await writeCodexRollout('01a11111-1111-4111-8111-111111111111', [
      { at: '2026-10-14T06:01:00.000Z', input: 1000, cached: 200, output: 100, total: 1100 },
      { at: '2026-10-14T06:05:00.000Z', input: 500, cached: 0, output: 50, total: 550 },
    ])

    const first = await scanNativeSessionCorpus({ ledger, now: Date.parse('2026-10-14T07:00:00Z') })
    expect(first.recorded).toBe(1)
    expect(first.skipped).toBe(0)

    const records = readRecords()
    expect(records).toHaveLength(2)
    // Real event times, not the scan time.
    expect(records.map(record => record.at)).toEqual([Date.parse('2026-10-14T06:01:00Z'), Date.parse('2026-10-14T06:05:00Z')])
    expect(records.map(record => record.timeBasis)).toEqual(['event', 'event'])
    // Codex counts cache reads inside input_tokens; only reads are split out.
    expect(records[0]).toMatchObject({ inputTokens: 800, cacheReadTokens: 200, outputTokens: 100, totalTokens: 1100 })
    expect(records[1]).toMatchObject({ inputTokens: 500, cacheReadTokens: 0, outputTokens: 50, totalTokens: 550 })

    const second = await scanNativeSessionCorpus({ ledger, now: Date.parse('2026-10-14T07:05:00Z') })
    // Unchanged file: cursor hit, nothing re-read or re-recorded.
    expect(second.recorded).toBe(0)
    expect(second.skipped).toBe(1)
    expect(readRecords()).toHaveLength(2)
  })

  it('keeps an existing cumulative baseline and records only later deltas', async () => {
    await writeCodexRollout('01a22222-2222-4222-8222-222222222222', [
      { at: '2026-10-14T06:01:00.000Z', input: 1000, cached: 0, output: 100, total: 1100 },
    ])

    // The bound-terminal path baselines the session first (cumulative mode).
    ledger.record({
      engine: 'codex',
      namespace: join(testContext.homeDir, '.codex'),
      sessionId: '01a22222-2222-4222-8222-222222222222',
      mode: 'cumulative',
      counters: { inputTokens: 1000, outputTokens: 100, totalTokens: 1100 },
      collectedAt: Date.parse('2026-10-14T06:02:00Z'),
    })

    const scan = await scanNativeSessionCorpus({ ledger, now: Date.parse('2026-10-14T07:00:00Z') })
    expect(scan.recorded).toBe(1)
    // Baseline already covered the first turn: nothing new to record.
    expect(readRecords()).toHaveLength(0)

    await writeCodexRollout('01a22222-2222-4222-8222-222222222222', [
      { at: '2026-10-14T06:01:00.000Z', input: 1000, cached: 0, output: 100, total: 1100 },
      { at: '2026-10-14T06:30:00.000Z', input: 400, cached: 0, output: 60, total: 460 },
    ])
    const growth = await scanNativeSessionCorpus({ ledger, now: Date.parse('2026-10-14T07:05:00Z') })
    expect(growth.recorded).toBe(1)
    const records = readRecords()
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({ inputTokens: 400, outputTokens: 60, totalTokens: 460, timeBasis: 'sample' })
  })

  it('locks accounting mode so an event-imported session is never double-counted by the terminal path', async () => {
    await writeCodexRollout('01a33333-3333-4333-8333-333333333333', [
      { at: '2026-10-14T06:01:00.000Z', input: 1000, cached: 0, output: 100, total: 1100 },
    ])
    await scanNativeSessionCorpus({ ledger, now: Date.parse('2026-10-14T07:00:00Z') })
    expect(readRecords()).toHaveLength(1)

    // A later cumulative observation for the same session must be ignored.
    ledger.record({
      engine: 'codex',
      namespace: join(testContext.homeDir, '.codex'),
      sessionId: '01a33333-3333-4333-8333-333333333333',
      mode: 'cumulative',
      counters: { inputTokens: 1000, outputTokens: 100, totalTokens: 1100 },
      collectedAt: Date.parse('2026-10-14T07:10:00Z'),
    })
    expect(readRecords()).toHaveLength(1)

    await writeCodexRollout('01a33333-3333-4333-8333-333333333333', [
      { at: '2026-10-14T06:01:00.000Z', input: 1000, cached: 0, output: 100, total: 1100 },
      { at: '2026-10-14T06:40:00.000Z', input: 300, cached: 0, output: 30, total: 330 },
    ])
    await scanNativeSessionCorpus({ ledger, now: Date.parse('2026-10-14T07:15:00Z') })
    const records = readRecords()
    expect(records).toHaveLength(2)
    expect(records[1]).toMatchObject({ inputTokens: 300, outputTokens: 30, totalTokens: 330 })
  })

  it('imports claude transcripts with stable response identities', async () => {
    const projectDir = join(testContext.homeDir, '.claude', 'projects', 'C--repo')
    await mkdir(projectDir, { recursive: true })
    await writeFile(join(projectDir, 'claude-session-1.jsonl'), [
      JSON.stringify({
        timestamp: '2026-10-10T09:00:00Z',
        sessionId: 'claude-session-1',
        message: { id: 'resp-1', role: 'assistant', stop_reason: 'end_turn', model: 'claude-sonnet-4-6', usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 300 } },
      }),
      JSON.stringify({
        timestamp: '2026-10-10T09:05:00Z',
        sessionId: 'claude-session-1',
        message: { id: 'resp-2', role: 'assistant', stop_reason: 'end_turn', model: 'claude-sonnet-4-6', usage: { input_tokens: 150, output_tokens: 30, cache_read_input_tokens: 500 } },
      }),
    ].join('\n'))

    const scan = await scanNativeSessionCorpus({ ledger, now: Date.parse('2026-10-14T07:00:00Z') })
    expect(scan.recorded).toBe(1)
    const records = readRecords()
    expect(records).toHaveLength(2)
    expect(records.map(record => record.at)).toEqual([Date.parse('2026-10-10T09:00:00Z'), Date.parse('2026-10-10T09:05:00Z')])
    expect(records[0]).toMatchObject({ inputTokens: 100, outputTokens: 20, cacheReadTokens: 300, totalTokens: 420 })

    await scanNativeSessionCorpus({ ledger, now: Date.parse('2026-10-14T07:05:00Z') })
    expect(readRecords()).toHaveLength(2)
  })

  it('waits for a Claude stop reason across scans and counts a completed reply once', async () => {
    const dir = join(testContext.homeDir, '.claude', 'projects', 'C--repo')
    await mkdir(dir, { recursive: true })
    const path = join(dir, 's1.jsonl')
    const row = (output: number, stop?: string | null) => JSON.stringify({
      sessionId: 's1', timestamp: '2026-10-10T09:00:00Z',
      message: { role: 'assistant', id: 'reply', stop_reason: stop, usage: { input_tokens: 10, output_tokens: output } },
    }) + '\n'
    await writeFile(path, row(6) + row(8, null))
    await scanNativeSessionCorpus({ ledger })
    expect(readRecords()).toEqual([])
    await appendFile(path, row(403, 'tool_use') + row(403, 'tool_use') + row(6))
    await scanNativeSessionCorpus({ ledger })
    expect(readRecords().map(r => r.totalTokens)).toEqual([413])
    expect((await scanNativeSessionCorpus({ ledger })).skipped).toBe(1)
  })

  it.each(['exact', 'wrong time', 'missing booked response', 'conflicting final', 'another changed booking'] as const)(
    'replays an unchanged quarantined Claude transcript with %s evidence', async scenario => {
      const namespace = join(testContext.homeDir, '.claude')
      const dir = join(namespace, 'projects', 'C--repo')
      await mkdir(dir, { recursive: true })
      const path = join(dir, 's1.jsonl')
      const at = Date.parse('2026-10-10T09:00:00Z')
      const row = (id: string, delta: number, output: number, stop?: string) => JSON.stringify({
        timestamp: new Date(at + delta).toISOString(), sessionId: 's1',
        message: { role: 'assistant', model: 'm', id, stop_reason: stop, usage: { input_tokens: 10, output_tokens: output } },
      })
      const lines = [row('reply', scenario === 'wrong time' ? 1 : 0, 6), row('reply', 2000, 403, 'tool_use'), row('later', 3000, 50, 'end_turn')]
      if (scenario === 'conflicting final') lines.push(row('reply', 4000, 405, 'end_turn'))
      if (scenario === 'another changed booking') lines.push(row('other', 4000, 19, 'end_turn'))
      await writeFile(path, lines.join('\n') + '\n')
      const sourceSize = (await stat(path)).size
      const event = { id: 'reply', model: 'm', at, inputTokens: 10, outputTokens: 6, totalTokens: 16 }
      const previous = [event]
      if (scenario === 'missing booked response') previous.push({ ...event, id: 'lost' })
      if (scenario === 'another changed booking') previous.push({ ...event, id: 'other' })
      ledger.record({ engine: 'claude', namespace, sessionId: 's1', mode: 'events', collectedAt: at + 5000, events: previous })
      const original = readRecords()
      // Old builds wrote a size cursor and a quarantine without the offending id.
      const db = new DatabaseSync(ledgerPath)
      db.prepare("UPDATE sessions SET data=json_set(data,'$.sourceSize',?,'$.issue','event-changed')").run(sourceSize)
      db.close()
      const scan = await scanNativeSessionCorpus({ ledger })
      expect(scan.recorded).toBe(1)
      const page = ledger.list({ start: at - 1, end: Date.now(), engine: 'claude' })
      if (scenario === 'exact') {
        expect(page.hasIssues).toBe(false)
        expect(page.records).toEqual([{ ...original[0], outputTokens: 403, totalTokens: 413 }, expect.objectContaining({ eventId: 'later', at: at + 3000, totalTokens: 60 })])
        expect((await scanNativeSessionCorpus({ ledger })).skipped).toBe(1)
        await appendFile(path, row('new', 6000, 100, 'end_turn') + '\n')
        await scanNativeSessionCorpus({ ledger })
        expect(readRecords().map(r => r.outputTokens)).toEqual([403, 50, 100])
      } else {
        expect(page.sessions[0].issue).toBe('event-changed')
        expect(page.records).toEqual(original)
      }
    })

  it('scans archived codex sessions and ignores non-rollout files', async () => {
    await writeCodexRollout('01a44444-4444-4444-8444-444444444444', [
      { at: '2026-08-01T06:01:00.000Z', input: 700, cached: 0, output: 70, total: 770 },
    ], { archived: true })
    const noiseDir = join(testContext.homeDir, '.codex', 'sessions', '2026', '10', '14')
    await mkdir(noiseDir, { recursive: true })
    await writeFile(join(noiseDir, 'history.jsonl'), JSON.stringify({ type: 'session_meta' }))

    const scan = await scanNativeSessionCorpus({ ledger, now: Date.parse('2026-10-14T07:00:00Z') })
    expect(scan.recorded).toBe(1)
    expect(scan.scanned).toBe(1)
    const records = readRecords()
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({ totalTokens: 770, at: Date.parse('2026-08-01T06:01:00Z') })
  })

  it('imports pi sessions under their root namespace and keeps abandoned branches', async () => {
    const root = join(testContext.homeDir, '.pi', 'agent', 'sessions')
    await mkdir(root, { recursive: true })
    await writeFile(join(root, 'pi-session-1.jsonl'), [
      JSON.stringify({ type: 'session', id: 'pi-session-1', cwd: 'C:/repo', timestamp: '2026-10-11T08:00:00Z' }),
      JSON.stringify({ type: 'message', id: 'm1', parentId: null, timestamp: '2026-10-11T08:01:00Z', message: { role: 'assistant', model: 'pi-model', usage: { input: 100, output: 10, cacheRead: 5, cacheWrite: 2, totalTokens: 117 } } }),
      JSON.stringify({ type: 'message', id: 'm2', parentId: 'm1', timestamp: '2026-10-11T08:02:00Z', message: { role: 'assistant', model: 'pi-model', usage: { input: 120, output: 12, cacheRead: 6, cacheWrite: 3, totalTokens: 141 } } }),
    ].join('\n'))

    const scan = await scanNativeSessionCorpus({ ledger, now: Date.parse('2026-10-14T07:00:00Z') })
    expect(scan.recorded).toBe(1)
    const records = readRecords()
    expect(records).toHaveLength(2)
    expect(records.map(record => record.at)).toEqual([Date.parse('2026-10-11T08:01:00Z'), Date.parse('2026-10-11T08:02:00Z')])
    expect(records[1]).toMatchObject({ inputTokens: 120, outputTokens: 12, cacheReadTokens: 6, cacheWriteTokens: 3, totalTokens: 141 })
  })

  it('leaves forked-thread inherited history with the parent file', async () => {
    // Ordinals 1-2 are the parent's, copied into this subagent rollout; only
    // ordinals >= subagent_history_start_ordinal are this thread's own usage.
    await writeCodexRollout('01a55555-5555-4555-8555-555555555555', [
      { at: '2026-10-14T06:01:00.000Z', input: 900, cached: 800, output: 90, total: 990 },
      { at: '2026-10-14T06:02:00.000Z', input: 0, cached: 0, output: 0, total: 0 },
      { at: '2026-10-14T06:03:00.000Z', input: 300, cached: 0, output: 30, total: 330 },
    ], { inheritedFromOrdinal: 3 })

    const scan = await scanNativeSessionCorpus({ ledger, now: Date.parse('2026-10-14T07:00:00Z') })
    expect(scan.recorded).toBe(1)
    const records = readRecords()
    // Only the thread's own turn; the parent's 990 stays in the parent file.
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({ inputTokens: 300, outputTokens: 30, totalTokens: 330, at: Date.parse('2026-10-14T06:03:00Z') })
  })

  it('keeps per-session ordinal identities from colliding across sessions', async () => {
    await writeCodexRollout('01a66666-6666-4666-8666-666666666666', [
      { at: '2026-10-14T06:01:00.000Z', input: 100, cached: 0, output: 10, total: 110 },
    ])
    await writeCodexRollout('01a77777-7777-4777-8777-777777777777', [
      { at: '2026-10-14T06:02:00.000Z', input: 200, cached: 0, output: 20, total: 220 },
    ])

    const scan = await scanNativeSessionCorpus({ ledger, now: Date.parse('2026-10-14T07:00:00Z') })
    expect(scan.recorded).toBe(2)
    const records = readRecords()
    expect(records).toHaveLength(2)
    expect(records.map(record => record.totalTokens).sort()).toEqual([110, 220])
    const page = ledger.list({ start: Date.parse('2026-01-01T00:00:00Z'), end: Date.parse('2027-01-01T00:00:00Z'), limit: 100 })
    expect(page.sessions.every(session => session.issue === undefined)).toBe(true)
  })
})
