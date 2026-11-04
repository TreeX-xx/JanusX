import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { AutomationService, type AutomationPorts } from '../../src/main/automations/service'
import { git } from '../../src/main/automations/git'
import { atomicJson } from '../../src/main/automations/storage'
import * as storage from '../../src/main/automations/storage'
import { nextOccurrence } from '../../src/main/automations/schedule'
import { automationInputSchema, dailyReviewTemplate, reminderTemplate, type AutomationRun } from '../../src/shared/automations'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { vi.restoreAllMocks(); for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })
async function fixture(review?: AutomationPorts['review']) {
  const directory = await mkdtemp(join(tmpdir(), 'janusx-automation-test-')), root = join(directory, 'repo'), ledger = join(directory, 'ledger')
  cleanups.push(async () => { if (!resolve(directory).startsWith(resolve(tmpdir()))) throw new Error('Unsafe cleanup'); await rm(directory, { recursive: true, force: true }) })
  await mkdir(root); await git(root, ['init', '-b', 'main']); await git(root, ['config', 'user.name', 'Automation Test']); await git(root, ['config', 'user.email', 'test@example.invalid'])
  const commit = async (content: string) => { await writeFile(join(root, 'example.ts'), content); await git(root, ['add', '--', 'example.ts']); await git(root, ['commit', '-m', 'fixture']); return (await git(root, ['rev-parse', 'HEAD'])).trim() }
  const base = await commit('export const count = 1\n')
  const now = { value: Date.parse('2026-11-02T10:00:00Z') }
  const reviewFn = vi.fn(review ?? (async (_task, _definition, context) => ({ summary: 'Reviewed', coveredFiles: context.files, incomplete: false, findings: [] })))
  const ports: AutomationPorts = { resolveWorkspace: async id => id === 'project' ? root : undefined, review: reviewFn, changed: vi.fn(), completed: vi.fn(), now: () => now.value }
  const service = new AutomationService(ledger, ports); await service.initialize(false); cleanups.push(() => service.stop())
  const input = { ...dailyReviewTemplate('project'), providerId: 'provider', modelId: 'model' }
  const card = await service.save(input)
  return { service, root, directory, ledger, ports, reviewFn, commit, card, base, input, now }
}
async function finished(service: AutomationService, run: AutomationRun) {
  await vi.waitFor(() => expect(service.history(run.definitionId).find(item => item.id === run.id)?.finishedAt).toBeTruthy(), { timeout: 10000, interval: 10 })
  return service.history(run.definitionId).find(item => item.id === run.id)!
}

describe('automation durable incremental review', () => {
  it.each(['task', 'card'])('deleting an active and queued %s cancels only its work and suppresses late completion writes', async kind => {
    const release = new Map<string, () => void>(), aborted = new Set<string>()
    const f = await fixture(async (_task, definition, context, signal) => {
      await new Promise<void>(resolve => {
        release.set(definition.id, resolve)
        signal.addEventListener('abort', () => { aborted.add(definition.id) }, { once: true })
      })
      return { summary: 'Late result', coveredFiles: context.files, incomplete: false, findings: [] }
    })
    // Make cleanup safe even if an assertion fails while the fake executor is blocked.
    cleanups.push(async () => { for (const done of release.values()) done() })
    const keep = await f.service.save(f.input)
    await f.commit('export const count = 2\n')
    await f.service.run(f.card.id, 'active-delete')
    const keptRun = await f.service.run(keep.id, 'active-keep')
    await vi.waitFor(() => expect(f.reviewFn).toHaveBeenCalledTimes(2), { timeout: 10000 })
    const queued = await f.service.save({ ...reminderTemplate('Queued reminder'), cardId: f.card.cardId })
    expect((await f.service.run(queued.id, 'queued-delete')).state).toBe('queued')
    if (kind === 'task') await f.service.remove(queued.id, queued.revision)
    const deletion = kind === 'task' ? f.service.remove(f.card.id, f.card.revision) : f.service.removeCard(f.card.cardId!, f.service.listCards().find(card => card.id === f.card.cardId)!.revision)
    await vi.waitFor(() => expect(aborted.has(f.card.id)).toBe(true))
    expect(aborted.has(keep.id)).toBe(false)
    expect(f.service.history(f.card.id)).toEqual([])
    await expect(f.service.run(f.card.id, 'active-delete')).rejects.toThrow('not found')
    release.get(f.card.id)!(); await deletion
    expect(f.ports.completed).not.toHaveBeenCalled()
    release.get(keep.id)!(); expect((await finished(f.service, keptRun)).state).toBe('succeeded')
    await f.service.stop()
    await expect(readFile(join(f.ledger, f.card.id, 'definition.json'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(join(f.ledger, queued.id, 'definition.json'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(join(f.root, 'example.ts'), 'utf8')).toBe('export const count = 2\n')
    expect(f.ports.completed).toHaveBeenCalledTimes(1)
  })
  it('records provider rejection without retry, fallback, or cursor advancement', async () => {
    const f = await fixture(async () => { throw new Error('Request rejected in accordance with our terms of use and policies.') })
    await f.commit('export const count = 2\n')
    const run = await finished(f.service, await f.service.run(f.card.id, 'rejected'))
    expect(run.state).toBe('failed'); expect(run.reason).toContain('Request rejected')
    expect(f.reviewFn).toHaveBeenCalledOnce(); expect((await f.service.preview(f.input, f.card.id)).base).toBe(f.base)
  })
  it('keeps a completed report recoverable when the cursor disk write fails', async () => {
    const f = await fixture(); const head = await f.commit('export const count = 2\n')
    const write = storage.atomicJson; let failed = false
    vi.spyOn(storage, 'atomicJson').mockImplementation(async (path, value) => {
      if (!failed && path.endsWith('cursor.json') && Boolean((value as { lastRunId?: string }).lastRunId)) { failed = true; throw new Error('Injected cursor IO failure') }
      return write(path, value)
    })
    const run = await finished(f.service, await f.service.run(f.card.id, 'one'))
    expect(run.state).toBe('succeeded'); expect(run.report?.incomplete).toBe(false)
    expect((await f.service.preview(f.input, f.card.id)).base).toBe(f.base)
    await f.service.stop(); vi.restoreAllMocks()
    const restored = new AutomationService(f.ledger, f.ports); await restored.initialize(false); cleanups.push(() => restored.stop())
    expect((await restored.preview(f.input, f.card.id)).base).toBe(head)
  })
  it('anchors an unrun draft at first enable but preserves an explicit historical baseline', async () => {
    const f = await fixture(); const head = await f.commit('export const count = 2\n')
    await f.service.save({ ...f.input, enabled: true }, f.card.id, 1)
    expect((await f.service.preview(f.input, f.card.id)).base).toBe(head)
    const historical = await f.service.save(f.input, undefined, undefined, f.base)
    await f.service.save({ ...f.input, enabled: true }, historical.id, 1)
    expect((await f.service.preview(f.input, historical.id)).base).toBe(f.base)
  })
  it('anchors a new definition at HEAD, performs no model work without commits and deduplicates requests after restart', async () => {
    const f = await fixture()
    const run = await finished(f.service, await f.service.run(f.card.id, 'one'))
    expect(run.reason).toBe('no_changes'); expect(f.reviewFn).not.toHaveBeenCalled()
    await f.service.stop()
    const restarted = new AutomationService(f.ledger, f.ports); await restarted.initialize(false); cleanups.push(() => restarted.stop())
    expect((await restarted.run(f.card.id, 'one')).id).toBe(run.id)
  })
  it('uses immutable commit content, preserves dirty work and advances the cursor even when findings exist', async () => {
    const f = await fixture(async (_task, _definition, context) => ({ summary: context.contents['example.ts'], coveredFiles: context.files, incomplete: false,
      findings: [{ severity: 'warning', category: 'quality', path: 'example.ts', line: 1, evidence: 'count = 2', suggestion: 'Explain the value' }] }))
    const head = await f.commit('export const count = 2\n'); await writeFile(join(f.root, 'example.ts'), 'USER DIRTY WORK\n')
    const run = await finished(f.service, await f.service.run(f.card.id, 'one'))
    expect(run.state).toBe('succeeded'); expect(run.report?.verdict).toBe('findings'); expect(run.head).toBe(head)
    expect(run.report?.summary).toContain('count = 2'); expect(await readFile(join(f.root, 'example.ts'), 'utf8')).toBe('USER DIRTY WORK\n')
    expect((await f.service.preview(f.input, f.card.id)).base).toBe(head)
  })
  it('does not advance on partial; pauses after two incomplete runs and recovers through explicit baseline selection', async () => {
    const f = await fixture(async () => ({ summary: 'Incomplete', coveredFiles: [], incomplete: true, findings: [] }))
    const head = await f.commit('export const count = 2\n')
    const first = await finished(f.service, await f.service.run(f.card.id, 'one'))
    expect(first.report?.incomplete).toBe(true); expect(first.cursorCommitted).toBe(false)
    expect((await finished(f.service, await f.service.run(f.card.id, 'two'))).state).toBe('needs_attention')
    expect((await f.service.preview(f.input, f.card.id)).base).toBe(f.base)
    expect((await f.service.run(f.card.id, 'three')).reason).toContain('needs_attention')
    await f.service.save(f.input, f.card.id, 1, head)
    expect((await finished(f.service, await f.service.run(f.card.id, 'four'))).reason).toBe('no_changes')
  })
  it('preserves the cursor on invalid findings, missing coverage, and executor errors', async () => {
    const f = await fixture(async () => ({ summary: 'Invalid', coveredFiles: ['unrelated.ts'], incomplete: false, findings: [] }))
    await f.commit('export const count = 2\n')
    expect((await finished(f.service, await f.service.run(f.card.id, 'one'))).state).toBe('failed')
    expect((await f.service.preview(f.input, f.card.id)).base).toBe(f.base)
  })
  it('cancels in-flight work and skips overlapping runs without changing the baseline', async () => {
    const f = await fixture(async (_task, _definition, _context, signal) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })))
    await f.commit('export const count = 2\n'); const run = await f.service.run(f.card.id, 'one')
    await vi.waitFor(() => expect(f.reviewFn).toHaveBeenCalledOnce(), { timeout: 10000, interval: 10 })
    expect((await f.service.run(f.card.id, 'two')).reason).toBe('overlapping')
    await f.service.cancel(run.id); expect((await finished(f.service, run)).state).toBe('cancelled')
    expect((await f.service.preview(f.input, f.card.id)).base).toBe(f.base)
  })
  it('pins the definition revision and head while later edits/commits cannot overwrite a new baseline', async () => {
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const f = await fixture(async (_task, _definition, context) => { await gate; return { summary: 'Reviewed', coveredFiles: context.files, incomplete: false, findings: [] } })
    cleanups.push(async () => { release() })
    const head = await f.commit('export const count = 2\n'); const run = await f.service.run(f.card.id, 'one')
    await vi.waitFor(() => expect(f.reviewFn).toHaveBeenCalledOnce(), { timeout: 10000, interval: 10 })
    const nextHead = await f.commit('export const count = 3\n')
    await f.service.save({ ...f.input, name: 'Edited' }, f.card.id, 1, nextHead)
    await expect(f.service.save(f.input, f.card.id, 1)).rejects.toThrow('revision_conflict')
    release(); const result = await finished(f.service, run)
    expect(result.snapshot.revision).toBe(1); expect(result.head).toBe(head); expect(result.reason).toContain('cursor_conflict')
    expect((await f.service.preview(f.input, f.card.id)).base).toBe(nextHead)
  })
  it('blocks diverged history without model calls', async () => {
    const f = await fixture(); await git(f.root, ['checkout', '--orphan', 'replacement'])
    await f.commit('export const count = 9\n'); await git(f.root, ['branch', '-f', 'main', 'HEAD'])
    const run = await finished(f.service, await f.service.run(f.card.id, 'one'))
    expect(run.state).toBe('needs_attention'); expect(run.reason).toContain('baseline_conflict'); expect(f.reviewFn).not.toHaveBeenCalled()
  })
  it('recovers report-before-cursor and cursor-before-final-state interruptions idempotently', async () => {
    const f = await fixture(); const head = await f.commit('export const count = 2\n')
    const run = await finished(f.service, await f.service.run(f.card.id, 'one')); await f.service.stop()
    const path = join(f.ledger, f.card.id)
    await atomicJson(join(path, 'cursor.json'), run.cursor)
    await atomicJson(join(path, 'runs', `${run.id}.json`), { ...run, state: 'running', cursorCommitted: false, cursorApplied: false, finishedAt: undefined })
    const restored = new AutomationService(f.ledger, f.ports); await restored.initialize(false); cleanups.push(() => restored.stop())
    expect((await restored.preview(f.input, f.card.id)).base).toBe(head); expect(restored.history(f.card.id)[0].state).toBe('succeeded')
    await restored.stop()
    await atomicJson(join(path, 'runs', `${run.id}.json`), { ...run, state: 'running', cursorCommitted: false, cursorApplied: false, finishedAt: undefined })
    const twice = new AutomationService(f.ledger, f.ports); await twice.initialize(false); cleanups.push(() => twice.stop())
    expect(twice.history(f.card.id)[0].cursorCommitted).toBe(true); expect(twice.history(f.card.id)[0].reason).toBeUndefined()
  })
  it('restores a partially persisted definition edit and marks unfinished runs interrupted', async () => {
    const f = await fixture(); const run = await finished(f.service, await f.service.run(f.card.id, 'one')); await f.service.stop()
    await atomicJson(join(f.ledger, f.card.id, 'edit.json'), { definition: { ...f.card, name: 'Recovered edit', revision: 2 }, cursor: run.cursor })
    await atomicJson(join(f.ledger, f.card.id, 'runs', `${run.id}.json`), { ...run, state: 'queued', finishedAt: undefined })
    const restored = new AutomationService(f.ledger, f.ports); await restored.initialize(false); cleanups.push(() => restored.stop())
    expect(restored.list()[0].name).toBe('Recovered edit'); expect(restored.history(f.card.id)[0].state).toBe('interrupted')
  })
  it('persists missed and due occurrences without duplicate dispatch after concurrent ticks', async () => {
    const f = await fixture(); await f.service.save({ ...f.input, enabled: true }, f.card.id, 1)
    f.now.value = Date.parse('2026-11-02T15:00:00Z')
    await Promise.all([f.service.tick(), f.service.tick()])
    expect(f.service.history(f.card.id)).toHaveLength(1); expect(f.service.history(f.card.id)[0].reason).toBe('missed')
    f.now.value = Date.parse('2026-11-03T13:10:00Z'); await f.service.tick()
    const due = f.service.history(f.card.id).find(run => run.reason !== 'missed')!
    expect((await finished(f.service, due)).reason).toBe('no_changes')
    expect(f.reviewFn).not.toHaveBeenCalled()
  })
})

describe('automation input and scheduling contracts', () => {
  it('rejects arbitrary commands, forward bindings and invalid zones', () => {
    const input = { ...dailyReviewTemplate('project'), providerId: 'p', modelId: 'm' }
    expect(automationInputSchema.safeParse({ ...input, timezone: 'invalid' }).success).toBe(false)
    expect(automationInputSchema.safeParse({ ...input, tasks: [input.tasks[0], { id: 'shell', kind: 'command', command: 'npm test', input: 'range' }, ...input.tasks.slice(1)] }).success).toBe(false)
    expect(automationInputSchema.safeParse({ ...input, tasks: input.tasks.map(task => task.id === 'review' ? { ...task, input: 'report' } : task) }).success).toBe(false)
  })
  it('computes daily, weekday, weekly and manual schedules in their IANA zone', () => {
    const input = { ...dailyReviewTemplate(), enabled: true }
    expect(nextOccurrence(input, Date.parse('2026-11-02T10:00:00Z'))).toBe('2026-11-02T13:00:00.000Z')
    expect(nextOccurrence({ ...input, schedule: 'weekdays' }, Date.parse('2026-11-06T14:00:00Z'))).toBe('2026-11-09T13:00:00.000Z')
    expect(nextOccurrence({ ...input, schedule: 'weekly', weekday: 0 }, Date.parse('2026-11-02T10:00:00Z'))).toBe('2026-11-08T13:00:00.000Z')
    expect(nextOccurrence({ ...input, schedule: 'manual' }, Date.now())).toBeNull()
    expect(nextOccurrence({ ...input, timezone: 'America/New_York', time: '01:30' }, Date.parse('2026-11-01T05:30:00Z'))).toBe('2026-11-02T06:30:00.000Z')
  })
})
