import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import { UsageLedger } from '../../src/main/runtime-telemetry/usage-ledger'
import type { UsageObservation, UsageTokens } from '../../src/shared/usage'
const openLedgers: InstanceType<typeof UsageLedger>[] = []
function createLedger(...args: ConstructorParameters<typeof UsageLedger>) {
  const value = new UsageLedger(...args)
  openLedgers.push(value)
  return value
}

let directory: string
let file: string
let ledger: UsageLedger
const counts = (input: number, output = 0): UsageTokens => ({ inputTokens: input, outputTokens: output, cacheReadTokens: 0, totalTokens: input + output })
const sample = (at: number, input: number, sessionId = 's1'): UsageObservation => ({ engine: 'codex', namespace: '/native', sessionId, collectedAt: at, mode: 'cumulative', counters: counts(input), model: 'm1' })
const events = (at: number, sessionId = 's1'): UsageObservation => ({ engine: 'claude', namespace: '/native', sessionId, collectedAt: at, mode: 'events', events: [{ ...counts(10, 5), id: 'response-1', at: 1000, model: 'm1' }] })
const all = () => ledger.list({ start: 0, end: 20_000 })

beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'janusx-usage-ledger-')); file = join(directory, 'usage.sqlite'); ledger = createLedger(() => file) })
afterEach(async () => { for (const value of openLedgers.splice(0)) value.close(); await rm(directory, { recursive: true, force: true }) })

describe('persistent native usage accounting', () => {
  it('deduplicates a copied source and continues a moved history only with matching native events', () => {
    ledger.record(events(2000))
    ledger.record({ ...events(3000), namespace: '/backup' })
    expect(all().records).toHaveLength(1)
    ledger.record({ ...events(4000), namespace: '/moved', events: [...events(4000).events!, { ...counts(2, 1), id: 'response-2', at: 4000 }] })
    expect(all().records.reduce((sum, item) => sum + item.totalTokens, 0)).toBe(18)
    expect(() => ledger.record({ ...events(5000), namespace: '/conflict', events: [{ ...counts(99), id: 'response-1', at: 1000 }] })).toThrow('Conflicting history sources')
    expect(all().records.reduce((sum, item) => sum + item.totalTokens, 0)).toBe(18)
  })
  it('enriches a source-matched legacy model without changing ids, dates, tokens or known models', () => {
    const observation: UsageObservation = { ...events(2000), engine: 'codex', events: [{ ...counts(10, 5), id: 'response-1', at: 1000 }] }
    ledger.record(observation)
    // Older records had no native event linkage.
    const database = new DatabaseSync(file)
    database.exec("UPDATE records SET data=json_remove(data,'$.eventId')")
    database.close()
    const before = all().records[0]
    ledger.record({ ...observation, collectedAt: 3000, events: [{ ...observation.events![0], model: 'model-a' }] })
    expect(all().records).toEqual([{ ...before, model: 'model-a', eventId: 'response-1' }])
    ledger.record({ ...observation, collectedAt: 4000, events: [{ ...observation.events![0], model: 'model-b' }] })
    expect(all().records).toEqual([{ ...before, model: 'model-a', eventId: 'response-1' }])
  })
  it('does not guess model ownership for ambiguous legacy records or mismatched token counts', () => {
    const observation: UsageObservation = { ...events(2000), engine: 'codex', events: [
      { ...counts(10), id: 'a', at: 1000, model: 'known' }, { ...counts(10), id: 'b', at: 1000 },
    ] }
    ledger.record(observation)
    const database = new DatabaseSync(file)
    database.exec("UPDATE records SET data=json_remove(data,'$.eventId')")
    database.close()
    const before = all().records
    ledger.record({ ...observation, collectedAt: 3000, events: [{ ...counts(10), id: 'a', at: 1000, model: 'candidate' }] })
    expect(all().records).toEqual(before)
    ledger.record({ ...observation, collectedAt: 4000, events: [{ ...counts(20), id: 'b', at: 1000, model: 'candidate' }] })
    expect(all().records).toEqual(before)
    expect(all().hasIssues).toBe(true)
  })
  it('adds models during a simultaneous legacy Codex cache-write upgrade', () => {
    ledger.record({ ...events(2000), engine: 'codex', events: [{ ...counts(10, 5), id: 'a', at: 1000 }] })
    const before = all().records[0]
    ledger.record({ ...events(3000), engine: 'codex', events: [{ ...counts(3, 5), cacheWriteTokens: 7, totalTokens: 15, id: 'a', at: 1000, model: 'model-a' }] })
    expect(all().records).toEqual([{ ...before, inputTokens: 3, cacheWriteTokens: 7, model: 'model-a' }])
    expect(all().hasIssues).toBe(false)
  })
  it('keeps ambiguous models unknown across successive legacy cache-write upgrades', () => {
    ledger.record({ ...events(2000), engine: 'codex', events: [
      { ...counts(10, 5), id: 'a', at: 1000 }, { ...counts(10, 5), id: 'b', at: 1000 },
    ] })
    const database = new DatabaseSync(file)
    database.exec("UPDATE records SET data=json_remove(data,'$.eventId')")
    database.close()
    const replay: UsageObservation = { ...events(3000), engine: 'codex', events: [
      { ...counts(3, 5), cacheWriteTokens: 7, totalTokens: 15, id: 'a', at: 1000, model: 'model-a' },
      { ...counts(3, 5), cacheWriteTokens: 7, totalTokens: 15, id: 'b', at: 1000, model: 'model-b' },
    ] }
    ledger.record(replay)
    ledger.record({ ...replay, collectedAt: 4000 })
    expect(all().records.map(row => row.model)).toEqual([undefined, undefined])
    expect(all().records.map(row => [row.inputTokens, row.cacheWriteTokens, row.totalTokens])).toEqual([[3, 7, 15], [3, 7, 15]])
  })
  it('continues legacy Codex cumulative accounting when the write breakdown becomes available', () => {
    ledger.record(sample(1000, 100))
    ledger.record({ ...sample(2000, 120), counters: { ...counts(40), cacheWriteTokens: 80, totalTokens: 120 } })
    ledger.record({ ...sample(3000, 150), counters: { ...counts(50), cacheWriteTokens: 100, totalTokens: 150 } })
    expect(all().hasIssues).toBe(false)
    expect(all().records.map(row => row.totalTokens)).toEqual([20, 30])
    expect(all().records[0].cacheWriteTokens).toBeUndefined()
    expect(all().records[1]).toMatchObject({ inputTokens: 10, cacheWriteTokens: 20 })
  })
  it('accepts newly split Codex event identities without double-booking legacy records', () => {
    ledger.record({ ...events(2000), engine: 'codex' })
    ledger.record({ ...events(3000), engine: 'codex', events: [
      { ...counts(3, 5), cacheWriteTokens: 7, totalTokens: 15, id: 'response-1', at: 1000 },
      { ...counts(2), cacheWriteTokens: 8, totalTokens: 10, id: 'response-2', at: 2000 },
    ] })
    expect(all().hasIssues).toBe(false)
    expect(all().records.map(row => row.totalTokens)).toEqual([15, 10])
    expect(all().records[0]).toMatchObject({ inputTokens: 3, cacheWriteTokens: 7, at: 1000 })
    expect(all().records[1].cacheWriteTokens).toBe(8)
    ledger.record({ ...events(4000), engine: 'codex', events: [{ ...counts(3, 5), cacheWriteTokens: 7, totalTokens: 15, id: 'response-1', at: 1000 }] })
    expect(all().records).toHaveLength(2)
  })
  it('seeds first cumulative observation, deduplicates polls and resumes after restart', () => {
    ledger.record(sample(1000, 100))
    expect(all().records).toEqual([])
    ledger.record(sample(2000, 120))
    ledger.record(sample(2000, 120))
    ledger.close()
    ledger = createLedger(() => file)
    ledger.record(sample(3000, 125))
    expect(all().records.map(row => row.totalTokens)).toEqual([20, 5])
    expect(all().records[0]).toMatchObject({ timeBasis: 'sample', intervalStart: 1000, at: 2000 })
  })
  it('keeps independent baselines when switching and returning to sessions', () => {
    ledger.record(sample(1000, 100, 'a'))
    ledger.record(sample(2000, 400, 'b'))
    ledger.record(sample(3000, 110, 'a'))
    ledger.record(sample(4000, 420, 'b'))
    expect(all().records.map(row => row.totalTokens)).toEqual([10, 20])
  })
  it('ignores out-of-order results and pauses regressed counters without counting recovery', () => {
    ledger.record(sample(2000, 100))
    ledger.record(sample(1000, 80))
    ledger.record(sample(3000, 80))
    ledger.record(sample(4000, 110))
    expect(all().records).toEqual([])
    expect(all().sessions[0].issue).toBe('counter-regressed')
  })
  it('does not attribute an interval spanning different models to the latest model', () => {
    ledger.record(sample(1000, 100))
    ledger.record({ ...sample(2000, 120), model: 'm2' })
    expect(all().records[0].model).toBeUndefined()
  })
  it('deduplicates copied response identities across forked sessions and restarts', () => {
    ledger.record(events(2000))
    ledger.close()
    ledger = createLedger(() => file)
    ledger.record(events(3000, 'fork'))
    expect(all().records).toHaveLength(1)
    expect(all().records[0]).toMatchObject({ totalTokens: 15, timeBasis: 'event', at: 1000, cacheReadTokens: 0 })
  })
  it('keeps consumed events when a branch disappears and records new branches', () => {
    ledger.record(events(2000))
    ledger.record({ ...events(3000), events: [{ ...counts(20), id: 'new-branch', at: 2500 }] })
    expect(all().records.reduce((sum, record) => sum + record.totalTokens, 0)).toBe(35)
  })
  it('quarantines changed usage for an existing response rather than importing it twice', () => {
    ledger.record(events(2000))
    ledger.record({ ...events(3000), events: [{ ...counts(20), id: 'response-1' }] })
    expect(all().records).toHaveLength(1)
    expect(all().sessions[0].issue).toBe('event-changed')
  })
  it('uses sample time for missing timestamps without inventing an event time', () => {
    ledger.record({ ...events(2000), events: [{ ...counts(10), id: 'untimed' }] })
    expect(all().records[0]).toMatchObject({ at: 2000, timeBasis: 'sample' })
  })
  it('rolls back identities and deltas together when an insert fails', () => {
    all()
    let database = new DatabaseSync(file)
    database.exec("CREATE TRIGGER fail_insert BEFORE INSERT ON records BEGIN SELECT RAISE(ABORT,'test failure'); END")
    database.close()
    expect(() => ledger.record(events(2000))).toThrow('test failure')
    database = new DatabaseSync(file)
    expect(database.prepare('SELECT COUNT(*) AS n FROM identities').get()).toMatchObject({ n: 0 })
    database.exec('DROP TRIGGER fail_insert')
    database.close()
    ledger.record(events(3000))
    expect(all().records).toHaveLength(1)
  })
  it('keeps the old cumulative baseline when writing a delta fails', () => {
    ledger.record(sample(1000, 100))
    const database = new DatabaseSync(file)
    database.exec("CREATE TRIGGER fail_insert BEFORE INSERT ON records BEGIN SELECT RAISE(ABORT,'test failure'); END")
    expect(() => ledger.record(sample(2000, 120))).toThrow('test failure')
    database.exec('DROP TRIGGER fail_insert')
    database.close()
    ledger.close()
    ledger = createLedger(() => file)
    ledger.record(sample(3000, 125))
    expect(all().records).toHaveLength(1)
    expect(all().records[0]).toMatchObject({ totalTokens: 25, intervalStart: 1000, at: 3000 })
  })
  it('retains event dates and sample intervals when collection crosses midnight or resumes offline', () => {
    const midnight = Date.parse('2026-10-13T00:00:00Z')
    ledger.record({ ...events(midnight + 1000), events: [{ ...counts(10), id: 'before-midnight', at: midnight - 1000 }] })
    ledger.record(sample(midnight - 2000, 100))
    ledger.close()
    ledger = createLedger(() => file)
    ledger.record(sample(midnight + 86_400_000, 150))
    const rows = ledger.list({ start: midnight - 4000, end: midnight + 86_400_000 }).records
    expect(rows[0]).toMatchObject({ at: midnight - 1000, timeBasis: 'event' })
    expect(rows[1]).toMatchObject({ totalTokens: 50, at: midnight + 86_400_000, intervalStart: midnight - 2000, timeBasis: 'sample' })
  })
  it('keeps pagination fixed while earlier historical events are concurrently imported', () => {
    ledger.record(events(2000))
    ledger.record({ ...events(3000), events: [{ ...counts(20), id: 'second', at: 1500 }] })
    const first = ledger.list({ start: 0, end: 4000, limit: 1 })
    ledger.record({ ...events(3500), events: [{ ...counts(100), id: 'late-import', at: 500 }] })
    const next = ledger.list({ start: 0, end: 4000, limit: 1, offset: first.nextOffset, throughId: first.throughId })
    expect([...first.records, ...next.records].map(row => row.totalTokens)).toEqual([15, 20])
  })
  it('rejects invalid counts and does not turn missing cache fields into zero', () => {
    ledger.record({ ...events(2000), events: [{ ...counts(10), id: 'invalid', totalTokens: -1 }] })
    expect(all().records).toEqual([])
    ledger.record({ ...events(3000), events: [{ inputTokens: 10, outputTokens: 0, totalTokens: 10, id: 'no-cache' }] })
    expect(all().records[0].cacheReadTokens).toBeUndefined()
  })
  it('does not treat unknown source counts as a baseline and validates query bounds', () => {
    ledger.record({ ...sample(1000, 10), counters: undefined, issue: 'unsupported-source' })
    expect(all().sessions[0].issue).toBe('unsupported-source')
    ledger.record(sample(2000, 100))
    expect(all().records).toEqual([])
    expect(() => ledger.list({ start: NaN, end: 1 })).toThrow('Invalid usage date range')
    expect(() => ledger.list({ start: 0, end: 400 * 86_400_000 })).toThrow('Invalid usage date range')
  })
  it('preserves corrupt and future-version databases and reports them', () => {
    writeFileSync(file, 'corrupted ledger')
    expect(() => all()).toThrow()
  })
  it('refuses future schema versions without overwriting them', () => {
    const database = new DatabaseSync(file)
    database.exec('PRAGMA user_version=99')
    database.close()
    expect(() => all()).toThrow('Unsupported usage ledger version')
    const preserved = new DatabaseSync(file, { readOnly: true })
    expect(preserved.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: 99 })
    preserved.close()
  })
  it('pauses when a native counter source is replaced or truncated', () => {
    ledger.record({ ...sample(1000, 100), sourceIdentity: 'file-1', sourceSize: 1000 })
    ledger.record({ ...sample(2000, 120), sourceIdentity: 'file-2', sourceSize: 2000 })
    expect(all().records).toEqual([])
    expect(all().sessions[0].issue).toBe('counter-source-changed')
  })
  it('preserves same-model intervals as unknown if the model changed away and back', () => {
    ledger.record(sample(1000, 100))
    ledger.record({ ...sample(2000, 120), modelChangedAt: 1500 })
    expect(all().records[0].model).toBeUndefined()
  })
  it('reports missing sources and clears the issue on a verified retry', () => {
    ledger.record(sample(1000, 100))
    ledger.markMissing('codex', 's1')
    expect(all().hasIssues).toBe(true)
    ledger.record(sample(2000, 110))
    expect(all().hasIssues).toBe(false)
    expect(all().records[0].totalTokens).toBe(10)
  })
})
