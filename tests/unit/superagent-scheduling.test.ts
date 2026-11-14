import { randomUUID } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SuperAgentWorkerSnapshot } from '../../src/shared/superagent-worker'
import { conversationState } from '../../src/main/terminal/conversation-session'
import type { SuperAgentWorkers } from '../../src/main/janus/superagent/workers'
import type { SuperAgentStore } from '../../src/main/janus/superagent/store'
import { SuperAgentScheduler } from '../../src/main/janus/superagent/scheduler'
import { SuperAgentSchedulingStore } from '../../src/main/janus/superagent/scheduling-store'
import { createWork, superAgentFixture, workspace, otherWorkspace, submission } from '../helpers/superagent-fixture'

function deferred() { let resolve!: () => void, reject!: (error: Error) => void; const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail }); return { promise, resolve, reject } }

/** Deterministic native boundary: real durable store/queue, independently controlled starts/exits. */
class Executions {
  rows = new Map<string, SuperAgentWorkerSnapshot>()
  starts: string[] = []
  appends: string[] = []
  maximum = 0
  exits = new Map<string, Promise<void>>()
  stopReceipts = new Map<string, Promise<void>>()
  rejectedExit = new Set<string>()
  listeners = new Set<(state: SuperAgentWorkerSnapshot) => void>()
  constructor(private store: SuperAgentStore) {}
  subscribe(listener: (state: SuperAgentWorkerSnapshot) => void) { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  setContinuation() {}
  snapshots(scope: string) { return [...this.rows.values()].filter(row => row.workspaceId === scope).map(row => structuredClone(row)) }
  publish(row: SuperAgentWorkerSnapshot) { for (const listener of this.listeners) listener(structuredClone(row)) }
  live() { return [...this.rows.values()].filter(row => !row.stopConfirmed).length }
  async start(workspaceId: string, workId: string) {
    const detail = await this.store.workDetail(workspaceId, workId)
    const id = randomUUID(), state = conversationState(id, 'codex')
    state.connection = 'ready'; state.threadId = randomUUID(); state.turnId = randomUUID()
    await this.store.recordExecution(workspaceId, { executionId: id, instanceId: id, workId, cwd: workspace.workspacePath + '/' + workId, expectedRevision: detail.work.revision,
      providerSessionId: state.threadId, nativeTurnId: state.turnId })
    const row: SuperAgentWorkerSnapshot = { workspaceId, workId, executionId: id, instanceId: id, conversationId: 'conversation-a', phase: 'running',
      conversation: state, disabledExtensions: [], stopConfirmed: false }
    this.rows.set(workId, row); this.starts.push(workId); this.maximum = Math.max(this.maximum, this.live())
    for (const delivery of detail.deliveries.filter(row => row.status === 'pending')) await this.store.updateDelivery(workspaceId, { deliveryId: delivery.id, executionId: id, status: 'delivered' })
    this.publish(row); return structuredClone(row)
  }
  async append(input: { workspaceId: string; workId: string; eventId: string; executionId: string; conversationId: string; text: string }) {
    const detail = await this.store.workDetail(input.workspaceId, input.workId)
    const delivery = detail.deliveries.find(row => detail.inputs.find(value => value.id === row.inputId)?.eventId === input.eventId)!
    this.appends.push(input.workId)
    if (this.rows.get(input.workId)!.phase !== 'waiting') await this.store.updateDelivery(input.workspaceId, { deliveryId: delivery.id, executionId: input.executionId, status: 'delivered' })
    return structuredClone(this.rows.get(input.workId)!)
  }
  async stopWork(_workspaceId: string, workId: string) {
    const row = this.rows.get(workId)
    if (!row || row.stopConfirmed) return
    row.phase = 'stopping'; this.publish(row)
    await this.exits.get(workId)
    if (this.rejectedExit.has(workId)) { row.phase = 'failed'; this.publish(row); throw new Error('Exit unknown') }
    row.phase = 'stopped'; row.stopConfirmed = true; this.publish(row)
    await this.stopReceipts.get(workId)
  }
  async settleReady(workspaceId: string, workId: string) { await this.stopWork(workspaceId, workId); const row = this.rows.get(workId)!; row.phase = 'ready'; this.publish(row) }
  state(workId: string, phase: SuperAgentWorkerSnapshot['phase']) {
    const row = this.rows.get(workId)!; row.phase = phase
    if (phase === 'idle' || phase === 'ready') row.conversation.turnId = null
    this.publish(row)
  }
}

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { vi.restoreAllMocks(); for (const close of cleanups.splice(0).reverse()) await close() })
async function setup(count: number) {
  const fixture = await superAgentFixture(); cleanups.push(fixture.dispose)
  const workers = new Executions(fixture.store), scheduler = new SuperAgentScheduler(fixture.store, workers as unknown as SuperAgentWorkers)
  cleanups.push(() => scheduler.close())
  const works = []
  for (let i = 0; i < count; i++) works.push(await createWork(fixture.store, 'Work ' + i))
  return { ...fixture, workers, scheduler, works,
    async arrange(index: number) { const work = works[index]; return scheduler.request(workspace.workspaceId, work.id, work.sourceInputId) },
    async stop(index: number, closed = false) {
      const work = (await fixture.store.workDetail(workspace.workspaceId, works[index].id)).work
      await fixture.store.controlWork(workspace.workspaceId, work.id, work.revision, closed ? 'close' : 'stop')
      await scheduler.cancel(workspace.workspaceId, work.id, closed)
    }, snapshot: () => scheduler.snapshot(workspace.workspaceId) }
}

describe('configurable Worker admission', () => {
  it('uses global admission FIFO independent of input creation order and broadcasts changed positions to both scopes', async () => {
    const f = await setup(1); await f.scheduler.configure(1)
    const receipt = await f.store.receiveInput(otherWorkspace, { ...submission(), workspaceId: otherWorkspace.workspaceId })
    const foreign = await f.store.createWork(otherWorkspace.workspaceId, { creationId: randomUUID(), sourceInputId: receipt.input.id, title: 'Foreign', goal: 'Foreign' })
    f.works.push(await createWork(f.store, 'Admitted before the older foreign input'))
    await f.arrange(0); await f.arrange(1)
    expect(receipt.input.sequence).toBeLessThan((await f.store.workDetail(workspace.workspaceId, f.works[1].id)).inputs[0].sequence)
    await f.scheduler.request(otherWorkspace.workspaceId, foreign.id, receipt.input.id)
    const a = await f.snapshot(), b = await f.scheduler.snapshot(otherWorkspace.workspaceId)
    expect(a.queued).toBe(2)
    expect(a.entries.find(row => row.workId === f.works[1].id)?.queuePosition).toBe(1)
    expect(b.entries[0].queuePosition).toBe(2)
    expect(b.entries.every(row => row.workspaceId === otherWorkspace.workspaceId)).toBe(true)
    const events: string[] = []; f.scheduler.subscribe(scope => events.push(scope))
    await f.stop(0)
    await expect.poll(() => f.workers.starts).toEqual([f.works[0].id, f.works[1].id])
    expect(events).toContain(workspace.workspaceId); expect(events).toContain(otherWorkspace.workspaceId)
    expect((await f.scheduler.snapshot(otherWorkspace.workspaceId)).entries[0].queuePosition).toBe(1)
  })

  it('changes priority without preemption, preserving FIFO among equal priorities', async () => {
    const f = await setup(4); await f.scheduler.configure(1)
    for (let i = 0; i < 4; i++) await f.arrange(i)
    for (const index of [2, 3]) {
      const row = (await f.snapshot()).entries[index]
      await f.scheduler.control({ workspaceId: workspace.workspaceId, workId: row.workId, expectedVersion: row.queueVersion, action: 'priority', priority: 'high' })
    }
    expect(f.workers.starts).toEqual([f.works[0].id])
    expect((await f.snapshot()).entries.slice(1).map(row => row.queuePosition)).toEqual([3, 1, 2])
    await f.stop(0); await expect.poll(() => f.workers.starts.at(-1)).toBe(f.works[2].id)
    await f.stop(2); await expect.poll(() => f.workers.starts.at(-1)).toBe(f.works[3].id)
    expect(f.workers.maximum).toBe(1)
  })

  it('ages background work to high after 30 minutes and runs it before newer high work', async () => {
    const f = await setup(3); await f.scheduler.configure(1); await f.arrange(0)
    const now = Date.now(), clock = vi.spyOn(Date, 'now').mockReturnValue(now)
    let row = await f.arrange(1)
    await f.scheduler.control({ workspaceId: workspace.workspaceId, workId: row.workId, expectedVersion: row.queueVersion, action: 'priority', priority: 'background' })
    clock.mockReturnValue(now + 15 * 60_000)
    expect((await f.snapshot()).entries[1].effectivePriority).toBe('normal')
    clock.mockReturnValue(now + 30 * 60_000)
    row = await f.arrange(2)
    await f.scheduler.control({ workspaceId: workspace.workspaceId, workId: row.workId, expectedVersion: row.queueVersion, action: 'priority', priority: 'high' })
    expect((await f.snapshot()).entries[1]).toMatchObject({ priority: 'background', effectivePriority: 'high', queuePosition: 1 })
    await f.stop(0); await expect.poll(() => f.workers.starts.at(-1)).toBe(f.works[1].id)
  })

  it('preserves a paused position through supplemental input and approval; resume uses the original FIFO order', async () => {
    const f = await setup(3); await f.scheduler.configure(1)
    await f.arrange(0); const initial = await f.arrange(1); await f.arrange(2)
    await f.scheduler.control({ workspaceId: workspace.workspaceId, workId: initial.workId, expectedVersion: initial.queueVersion, action: 'pause' })
    const receipt = await f.store.receiveInput(workspace, submission('Supplement while paused'))
    await f.store.routeInput(workspace.workspaceId, receipt.input.id, initial.workId)
    let row = await f.scheduler.request(workspace.workspaceId, initial.workId, receipt.input.id)
    expect(row).toMatchObject({ status: 'paused', order: initial.order, priority: 'normal' })
    expect((await f.snapshot()).paused).toBe(1)
    const operation = randomUUID()
    await f.scheduler.request(workspace.workspaceId, initial.workId, receipt.input.id, operation)
    await f.scheduler.approval(workspace.workspaceId, initial.workId, operation, true)
    row = (await f.snapshot()).entries[1]
    expect(row.status).toBe('paused')
    await expect(f.scheduler.control({ workspaceId: workspace.workspaceId, workId: row.workId, expectedVersion: initial.queueVersion, action: 'resume' })).rejects.toThrow('changed')
    await f.scheduler.control({ workspaceId: workspace.workspaceId, workId: row.workId, expectedVersion: row.queueVersion, action: 'resume' })
    expect((await f.snapshot()).entries[1]).toMatchObject({ status: 'queued', order: initial.order, queuePosition: 1 })
    await f.stop(0); await expect.poll(() => f.workers.starts.at(-1)).toBe(initial.workId)
    await expect(f.scheduler.control({ workspaceId: workspace.workspaceId, workId: initial.workId, expectedVersion: row.queueVersion, action: 'pause' })).rejects.toThrow('no longer waiting')
  })

  it('skips paused work, cancels pending deliveries without closing history, and rejects forged queue controls', async () => {
    const f = await setup(3); await f.scheduler.configure(1)
    for (let i = 0; i < 3; i++) await f.arrange(i)
    let row = (await f.snapshot()).entries[1]
    await f.scheduler.control({ workspaceId: workspace.workspaceId, workId: row.workId, expectedVersion: row.queueVersion, action: 'pause' })
    await f.stop(0); await expect.poll(() => f.workers.starts.at(-1)).toBe(f.works[2].id)
    row = (await f.snapshot()).entries[1]
    const control = { workspaceId: workspace.workspaceId, workId: row.workId, expectedVersion: row.queueVersion, action: 'cancel' }
    await expect(f.scheduler.control({ ...control, workspaceId: otherWorkspace.workspaceId })).rejects.toThrow('no longer waiting')
    await expect(f.scheduler.control({ ...control, action: 'priority', priority: 'urgent' })).rejects.toThrow()
    await expect(f.scheduler.control({ ...control, executionId: randomUUID() })).rejects.toThrow()
    await f.scheduler.control(control)
    const detail = await f.store.workDetail(workspace.workspaceId, row.workId)
    expect(detail.work.closedAt).toBeNull(); expect(detail.inputs).toHaveLength(1)
    expect(detail.deliveries.every(delivery => delivery.status === 'cancelled')).toBe(true)
    expect((await f.snapshot()).entries[1].status).toBe('cancelled')
    await f.stop(2); expect(f.workers.starts).not.toContain(row.workId)
  })

  it('migrates the old ledger and retains queue preferences without executing restored pauses', async () => {
    const f = await setup(2); await f.scheduler.configure(1); await f.arrange(0)
    const row = await f.arrange(1)
    await f.scheduler.control({ workspaceId: workspace.workspaceId, workId: row.workId, expectedVersion: row.queueVersion, action: 'pause' })
    await f.scheduler.close()
    const restored = await new SuperAgentSchedulingStore(f.store.directory).snapshot()
    expect(restored.version).toBe(2); expect(restored.entries[1]).toMatchObject({ status: 'interrupted', paused: false, priority: 'normal' })
    const legacy = JSON.parse(await readFile(f.scheduler.ledger.path, 'utf8'))
    legacy.version = 1; delete legacy.nextOrder
    for (const item of legacy.entries) { item.status = 'queued'; item.order = 1; delete item.priority; delete item.queueVersion; delete item.queuedAt; delete item.paused }
    await writeFile(f.scheduler.ledger.path, JSON.stringify(legacy))
    const migrated = new SuperAgentSchedulingStore(f.store.directory)
    expect((await migrated.snapshot()).entries.map(item => item.order)).toEqual([1, 2])
    await migrated.change(() => {})
    expect(JSON.parse(await readFile(f.scheduler.ledger.path, 'utf8'))).toMatchObject({ version: 2, nextOrder: 3 })
  })

  it.each([1, 2, 4])('uses the same queue at N=%i, isolates supplements/stops, and counts native waits', async capacity => {
    const f = await setup(capacity + 1)
    await f.scheduler.configure(capacity)
    await Promise.all(f.works.map((_, index) => f.arrange(index)))
    await expect.poll(() => f.workers.starts.length).toBe(capacity)
    expect((await f.snapshot()).entries.at(-1)?.status).toBe('queued')
    f.workers.state(f.works[0].id, 'waiting')
    await expect.poll(async () => (await f.snapshot()).entries[0].status).toBe('waiting')
    expect((await f.snapshot()).occupied).toBe(capacity)
    const receipt = await f.store.receiveInput(workspace, submission('Supplement only A'))
    await f.store.routeInput(workspace.workspaceId, receipt.input.id, f.works[0].id)
    await f.scheduler.request(workspace.workspaceId, f.works[0].id, receipt.input.id)
    await expect.poll(() => f.workers.appends).toEqual([f.works[0].id])
    expect(f.workers.starts).toHaveLength(capacity)
    await f.stop(capacity - 1)
    await expect.poll(() => f.workers.starts.length).toBe(capacity + 1)
    expect(f.workers.maximum).toBe(capacity)
    for (const work of f.works.slice(0, capacity - 1)) expect(f.workers.rows.get(work.id)?.stopConfirmed).toBe(false)
  })

  it('releases ready capacity only after process-tree exit, and never infers ready from an idle turn', async () => {
    const f = await setup(2); await f.scheduler.configure(1)
    await f.arrange(0); await f.arrange(1)
    await expect.poll(() => f.workers.starts.length).toBe(1)
    f.workers.state(f.works[0].id, 'idle')
    await expect.poll(async () => (await f.snapshot()).entries[0].status).toBe('idle')
    expect(f.workers.starts).toHaveLength(1)
    const exit = deferred(); f.workers.exits.set(f.works[0].id, exit.promise)
    f.workers.state(f.works[0].id, 'ready')
    await expect.poll(async () => (await f.snapshot()).entries[0].status).toBe('stopping')
    expect((await f.snapshot()).occupied).toBe(1); expect(f.workers.starts).toHaveLength(1)
    exit.resolve()
    await expect.poll(() => f.workers.starts.length).toBe(2)
    expect((await f.snapshot()).entries[0].status).toBe('ready')
    expect(f.workers.maximum).toBe(1)
  })

  it('does not let a late stop receipt release the slot of a new execution of the same work', async () => {
    const f = await setup(2); await f.scheduler.configure(1); await f.arrange(0)
    await expect.poll(() => f.workers.starts.length).toBe(1)
    const receipt = deferred(); f.workers.stopReceipts.set(f.works[0].id, receipt.promise)
    await f.stop(0)
    await expect.poll(() => f.workers.rows.get(f.works[0].id)?.stopConfirmed).toBe(true)
    const input = await f.store.receiveInput(workspace, submission('Explicitly continue A'))
    await f.store.routeInput(workspace.workspaceId, input.input.id, f.works[0].id)
    await f.scheduler.request(workspace.workspaceId, f.works[0].id, input.input.id)
    await expect.poll(() => f.workers.starts.length).toBe(2)
    await f.arrange(1)
    receipt.resolve()
    await f.scheduler.configure(1)
    expect((await f.snapshot()).occupied).toBe(1)
    expect((await f.snapshot()).entries[1].status).toBe('queued')
    expect(f.workers.starts).toHaveLength(2)
    expect(f.workers.maximum).toBe(1)
  })

  it('increases capacity without changing admission logic; validates settings and never replays restored queue', async () => {
    const f = await setup(4); expect((await f.snapshot()).maxConcurrentWorkers).toBe(2)
    for (const value of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '4']) await expect(f.scheduler.configure(value)).rejects.toThrow()
    await f.scheduler.configure(1)
    for (let i = 0; i < 4; i++) await f.arrange(i)
    await expect.poll(() => f.workers.starts.length).toBe(1)
    await f.scheduler.configure(4)
    await expect.poll(() => f.workers.starts.length).toBe(4)
    await expect(f.scheduler.configure(2)).rejects.toThrow('reducing capacity')
    const restoredWorkers = new Executions(f.store), restored = new SuperAgentScheduler(f.store, restoredWorkers as unknown as SuperAgentWorkers)
    cleanups.push(() => restored.close())
    const snapshot = await restored.snapshot(workspace.workspaceId)
    expect(snapshot.maxConcurrentWorkers).toBe(4); expect(snapshot.occupied).toBe(0)
    expect(snapshot.entries.every(row => row.status === 'interrupted')).toBe(true)
    expect(restoredWorkers.starts).toEqual([])
  })

  it('deduplicates racing arrangements, rejects stale queued decisions and preserves unconfirmed stop occupancy', async () => {
    const f = await setup(3); await f.scheduler.configure(1)
    await Promise.all([f.arrange(0), f.arrange(0), f.arrange(1), f.arrange(2)])
    await expect.poll(() => f.workers.starts.length).toBe(1)
    await f.stop(1, true)
    f.workers.rejectedExit.add(f.works[0].id); await f.stop(0)
    await expect.poll(async () => (await f.snapshot()).entries[0].diagnostic).toContain('Exit unknown')
    expect((await f.snapshot()).occupied).toBe(1)
    expect(f.workers.starts).toEqual([f.works[0].id])
    expect((await f.snapshot()).entries[1].status).toBe('closed')
  })

  it('does not launch after an ambiguous ledger write and preserves damaged/unsupported records', async () => {
    const f = await setup(1)
    const bad = new SuperAgentSchedulingStore(f.root, async () => { throw new Error('disk unavailable') })
    const scheduler = new SuperAgentScheduler(f.store, f.workers as unknown as SuperAgentWorkers, bad)
    cleanups.push(() => scheduler.close())
    await expect(scheduler.request(workspace.workspaceId, f.works[0].id, f.works[0].sourceInputId)).rejects.toThrow('disk unavailable')
    expect(f.workers.starts).toEqual([])
    await f.scheduler.configure(3)
    expect(JSON.parse(await readFile(f.scheduler.ledger.path, 'utf8')).maxConcurrentWorkers).toBe(3)
    const damaged = '{"version":999,"unrecognized":"preserve"}'
    await writeFile(f.scheduler.ledger.path, damaged)
    await expect(new SuperAgentSchedulingStore(f.root).snapshot()).rejects.toThrow('original file preserved')
    expect(await readFile(f.scheduler.ledger.path, 'utf8')).toBe(damaged)
  })

  it.each([false, true])('synchronizes stop retry diagnostics while preserving native failure (closed=%s)', async closed => {
    const f = await setup(1); await f.arrange(0)
    const work = f.works[0]
    await expect.poll(() => f.workers.starts.length).toBe(1)
    f.workers.rejectedExit.add(work.id); await f.stop(0)
    await expect.poll(async () => (await f.snapshot()).entries[0].diagnostic).toContain('Exit unknown')
    expect((await f.snapshot()).occupied).toBe(1)
    f.workers.rejectedExit.delete(work.id)
    // A real execution failure survives successful cleanup; a cleanup-only failure disappears.
    const failure = closed ? 'Codex exited (7). Original execution failure' : undefined
    f.workers.rows.get(work.id)!.diagnostic = failure
    await f.stop(0, closed)
    await expect.poll(async () => (await f.snapshot()).occupied).toBe(0)
    await expect.poll(async () => (await f.snapshot()).entries[0].diagnostic).toBe(failure)
    expect((await f.snapshot()).entries[0].status).toBe(closed ? 'closed' : 'stopped')
    expect(JSON.parse(await readFile(f.scheduler.ledger.path, 'utf8')).entries[0].diagnostic).toBe(failure)
  })

  it('repairs persisted terminal diagnostics only with matching confirmed execution evidence, without replay', async () => {
    const f = await setup(6); await f.scheduler.configure(6)
    for (let i = 0; i < 6; i++) await f.arrange(i)
    await expect.poll(() => f.workers.starts.length).toBe(6)
    for (let i = 0; i < 6; i++) await f.stop(i)
    await expect.poll(async () => (await f.snapshot()).occupied).toBe(0)
    await f.scheduler.close()
    await f.scheduler.ledger.change(data => {
      for (const row of data.entries) { row.status = 'stopped'; row.diagnostic = 'Old unconfirmed stop' }
      data.entries[1].status = 'closed'
      data.entries[4].status = 'blocked'
    })
    const workers = new Executions(f.store)
    for (const [id, row] of f.workers.rows) workers.rows.set(id, { ...structuredClone(row), restored: true })
    workers.rows.get(f.works[1].id)!.diagnostic = 'Original execution failure'
    workers.rows.get(f.works[2].id)!.executionId = randomUUID()
    workers.rows.get(f.works[3].id)!.stopConfirmed = false
    workers.rows.delete(f.works[5].id)
    const scheduler = new SuperAgentScheduler(f.store, workers as unknown as SuperAgentWorkers)
    cleanups.push(() => scheduler.close())
    const result = await scheduler.snapshot(workspace.workspaceId)
    expect(result.entries.map(row => row.diagnostic)).toEqual([
      undefined, 'Original execution failure', 'Old unconfirmed stop', 'Old unconfirmed stop', 'Old unconfirmed stop', 'Old unconfirmed stop',
    ])
    expect(result.entries[1].status).toBe('closed')
    expect(result.occupied).toBe(1)
    expect(workers.starts).toEqual([])
    expect(workers.appends).toEqual([])
    expect(JSON.parse(await readFile(scheduler.ledger.path, 'utf8')).entries.map((row: { diagnostic?: string }) => row.diagnostic))
      .toEqual(result.entries.map(row => row.diagnostic))
    expect((await scheduler.snapshot(workspace.workspaceId)).revision).toBe(result.revision)
  })

  it.each(['success', 'failure'] as const)('ignores a late %s stop receipt after a new execution has its own diagnostic', async outcome => {
    const f = await setup(2); await f.scheduler.configure(1); await f.arrange(0)
    await expect.poll(() => f.workers.starts.length).toBe(1)
    const work = f.works[0], receipt = deferred()
    f.workers.stopReceipts.set(work.id, receipt.promise)
    await f.stop(0)
    await expect.poll(() => f.workers.rows.get(work.id)?.stopConfirmed).toBe(true)
    const input = await f.store.receiveInput(workspace, submission('Start a new execution'))
    await f.store.routeInput(workspace.workspaceId, input.input.id, work.id)
    await f.scheduler.request(workspace.workspaceId, work.id, input.input.id)
    await expect.poll(() => f.workers.starts.length).toBe(2)
    const native = f.workers.rows.get(work.id)!
    native.diagnostic = 'New execution failure'; f.workers.state(work.id, 'failed')
    await expect.poll(async () => (await f.snapshot()).entries[0].diagnostic).toBe(native.diagnostic)
    await f.arrange(1)
    if (outcome === 'success') receipt.resolve(); else receipt.reject(new Error('Old stop receipt failure'))
    await f.scheduler.kick()
    expect((await f.snapshot()).occupied).toBe(1)
    expect((await f.snapshot()).entries[0]).toMatchObject({ executionId: native.executionId, status: 'failed', diagnostic: 'New execution failure' })
    expect((await f.snapshot()).entries[1].status).toBe('queued')
    expect(f.workers.starts).toHaveLength(2)
  })

  it('requests every native stop even when saving the selected controls fails', async () => {
    const f = await setup(2)
    await f.arrange(0); await f.arrange(1)
    await expect.poll(() => f.workers.starts.length).toBe(2)
    const stop = vi.spyOn(f.workers, 'stopWork')
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(f.scheduler.cancelMany(f.works.map(work => ({ workspaceId: work.workspaceId, workId: work.id, closed: false })),
      async () => { throw new Error('Control write failed') })).rejects.toThrow('Control write failed')
    expect(stop.mock.calls.map(([, workId]) => workId)).toEqual(f.works.map(work => work.id))
    await expect.poll(() => [...f.workers.rows.values()].every(row => row.stopConfirmed)).toBe(true)
    await expect.poll(async () => (await f.snapshot()).occupied).toBe(0)
    expect((await f.snapshot()).diagnostic).toContain('Control write failed')
    expect(f.workers.starts).toHaveLength(2)
  })
})
