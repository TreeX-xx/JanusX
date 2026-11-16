import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { appendFile, mkdir, mkdtemp, rm, writeFile, utimes } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const context = vi.hoisted(() => ({ homeDir: '' }))
vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>()
  return { ...actual, homedir: () => context.homeDir, default: { ...actual.default, homedir: () => context.homeDir } }
})
const { getRuntimeTelemetrySnapshot } = await import('../../src/main/runtime-telemetry/history')
const { UsageLedger } = await import('../../src/main/runtime-telemetry/usage-ledger')
const { collectCodexEvents } = await import('../../src/main/runtime-telemetry/history-usage')
const openLedgers: InstanceType<typeof UsageLedger>[] = []
function createLedger(...args: ConstructorParameters<typeof UsageLedger>) {
  const value = new UsageLedger(...args)
  openLedgers.push(value)
  return value
}
beforeEach(async () => {
  for (const key of ['CLAUDE_CONFIG_DIR', 'CODEX_HOME', 'PI_CODING_AGENT_DIR', 'PI_CODING_AGENT_SESSION_DIR']) vi.stubEnv(key, undefined)
  context.homeDir = await mkdtemp(join(tmpdir(), 'janusx-usage-source-'))
})
afterEach(async () => { vi.unstubAllEnvs(); for (const value of openLedgers.splice(0)) value.close(); await rm(context.homeDir, { recursive: true, force: true }) })
const now = () => new Date().toISOString()
const claude = (id: string, input: number, extra: object = {}) => ({ timestamp: now(), sessionId: 's1', message: { id, role: 'assistant', stop_reason: 'end_turn', model: 'm', usage: { input_tokens: input, output_tokens: 0, cache_read_input_tokens: 0 } }, ...extra })

describe('native session source accounting', () => {
  it('attributes Codex requests to their preceding turn model, including switches and missing contexts', () => {
    const event = (ordinal: number) => ({ type: 'event_msg', ordinal, timestamp: '2026-10-14T06:00:00Z', payload: {
      type: 'token_count', info: { total_token_usage: { input_tokens: ordinal * 10, cached_input_tokens: 0, output_tokens: 0, total_tokens: ordinal * 10 } },
    } })
    const observation = collectCodexEvents('/native', 's1', [
      event(1), { type: 'turn_context', payload: { model: 'model-a' } }, event(2),
      { type: 'turn_context', payload: { model: 'model-b' } }, event(3),
      { type: 'turn_context', payload: {} }, event(4),
    ], Date.parse('2026-10-14T07:00:00Z'))
    expect(observation.issue).toBeUndefined()
    expect(observation.events?.map(event => event.model)).toEqual([undefined, 'model-a', 'model-b', undefined])
    expect(observation.events?.map(event => event.totalTokens)).toEqual([10, 10, 10, 10])
  })
  it('counts Codex growth with unchanged mtime and rejects rewritten prefixes', async () => {
    const directory = join(context.homeDir, '.codex', 'sessions', '2026', '10', '13')
    await mkdir(directory, { recursive: true })
    const sessionId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    const file = join(directory, `rollout-${sessionId}.jsonl`)
    const tokenCount = (input: number) => JSON.stringify({ type: 'event_msg', payload: { type: 'token_count', info: { last_token_usage: { total_tokens: input }, total_token_usage: { input_tokens: input, output_tokens: 0, cached_input_tokens: 0, total_tokens: input } } } })
    const turn = (model: string, at: number) => JSON.stringify({ type: 'turn_context', timestamp: new Date(at).toISOString(), payload: { model } })
    const original = [JSON.stringify({ type: 'session_meta', payload: { id: sessionId, cwd: 'C:/repo', marker: 'old' } }), turn('m1', Date.now() - 5000), tokenCount(50), ''].join('\n')
    await writeFile(file, original)
    const ledger = createLedger(() => join(context.homeDir, 'usage.sqlite'))
    const collect = async () => {
      const snapshot = await getRuntimeTelemetrySnapshot({ preset: 'codex', cwd: 'C:/repo', sessionId }, (engine, namespace, id) => ledger.sourceCheckpoint(engine, namespace, id))
      ledger.record(snapshot!.usageObservation!)
    }
    await collect()
    await appendFile(file, turn('m1', Date.now()) + '\n' + tokenCount(60) + '\n')
    const frozen = new Date('2026-10-13T00:00:00Z')
    await utimes(file, frozen, frozen)
    await collect()
    let page = ledger.list({ start: Date.now() - 60_000, end: Date.now() })
    expect(page.records.map(record => record.totalTokens)).toEqual([10])
    expect(page.records[0].model).toBe('m1')
    const changedAt = Date.now() - 1000
    await appendFile(file, turn('m2', changedAt - 1) + '\n' + turn('m1', changedAt) + '\n')
    const switched = await getRuntimeTelemetrySnapshot({ preset: 'codex', cwd: 'C:/repo', sessionId })
    expect(switched?.usageObservation?.modelChangedAt).toBe(changedAt)
    await writeFile(file, original.replace('"old"', '"new"') + tokenCount(70) + '\n')
    await collect()
    page = ledger.list({ start: Date.now() - 60_000, end: Date.now() })
    expect(page.hasIssues).toBe(true)
    expect(page.sessions[0].issue).toBe('counter-source-changed')
    expect(page.records.map(record => record.totalTokens)).toEqual([10])
  })
  it('reads long Claude sessions completely and deduplicates repeated content blocks', async () => {
    const directory = join(context.homeDir, '.claude', 'projects', 'C--repo')
    await mkdir(directory, { recursive: true })
    const file = join(directory, 's1.jsonl')
    const padding = JSON.stringify({ text: 'x'.repeat(20_000) }) + '\n'
    await writeFile(file, padding + JSON.stringify(claude('msg1', 100)) + '\n' + padding.repeat(15) + JSON.stringify(claude('msg2', 10)) + '\n')
    const request = { preset: 'claude' as const, cwd: 'C:/repo', sessionId: 's1' }
    const ledger = createLedger(() => join(context.homeDir, 'usage.sqlite'))
    const first = await getRuntimeTelemetrySnapshot(request)
    expect(first?.totalTokens).toBe(110)
    ledger.record(first!.usageObservation!)
    await appendFile(file, padding.repeat(15) + JSON.stringify(claude('msg3', 5)) + '\n' + JSON.stringify(claude('msg3', 5)) + '\n')
    const second = await getRuntimeTelemetrySnapshot(request)
    expect(second?.totalTokens).toBe(115)
    ledger.record(second!.usageObservation!)
    const page = ledger.list({ start: Date.now() - 60_000, end: Date.now() })
    expect(page.records.reduce((sum, record) => sum + record.totalTokens, 0)).toBe(115)
    expect(page.records).toHaveLength(3)
  })
  it('retries a half-written Claude line and never uses row UUIDs as response identities', async () => {
    const directory = join(context.homeDir, '.claude', 'projects', 'C--repo')
    await mkdir(directory, { recursive: true })
    const file = join(directory, 's1.jsonl')
    const line = JSON.stringify(claude('msg2', 10))
    await writeFile(file, JSON.stringify(claude('msg1', 5)) + '\n' + line.slice(0, 50))
    const request = { preset: 'claude' as const, cwd: 'C:/repo', sessionId: 's1' }
    expect((await getRuntimeTelemetrySnapshot(request))?.usageObservation?.events).toHaveLength(1)
    await appendFile(file, line.slice(50) + '\n')
    expect((await getRuntimeTelemetrySnapshot(request))?.usageObservation?.events).toHaveLength(2)
    const value = claude('unused', 100)
    const { id: _id, ...message } = value.message
    await appendFile(file, JSON.stringify({ ...value, uuid: 'row-only', message }) + '\n')
    expect((await getRuntimeTelemetrySnapshot(request))?.usageObservation?.issue).toBe('missing-event-identity')
  })
  it('uses all consumed Pi branches for the ledger while current context follows the leaf', async () => {
    const directory = join(context.homeDir, '.pi', 'agent', 'sessions', '---C--repo--')
    await mkdir(directory, { recursive: true })
    const sessionId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    const file = join(directory, `${sessionId}.jsonl`)
    const assistant = (id: string, input: number) => ({ type: 'message', id, parentId: 'root', timestamp: now(), message: { role: 'assistant', model: 'm', usage: { input, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: input } } })
    await writeFile(file, [JSON.stringify({ type: 'session', id: sessionId, cwd: 'C:/repo', timestamp: now() }), JSON.stringify({ type: 'message', id: 'root', parentId: null, message: { role: 'user' } }), JSON.stringify(assistant('a1', 100))].join('\n'))
    const request = { preset: 'pi' as const, cwd: 'C:/repo', sessionId }
    const first = await getRuntimeTelemetrySnapshot(request)
    const ledger = createLedger(() => join(context.homeDir, 'usage.sqlite'))
    ledger.record(first!.usageObservation!)
    await appendFile(file, '\n' + JSON.stringify(assistant('a2', 20)))
    const second = await getRuntimeTelemetrySnapshot(request)
    expect(second?.contextTokens).toBe(20)
    expect(second?.confidence).toBe('estimated')
    ledger.record(second!.usageObservation!)
    expect(ledger.list({ start: Date.now() - 60_000, end: Date.now() }).records.reduce((sum, record) => sum + record.totalTokens, 0)).toBe(120)
  })
})
