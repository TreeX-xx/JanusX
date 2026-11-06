import { randomUUID } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { afterEach, describe, expect, it } from 'vitest'
import type { SuperAgentWorkerSnapshot } from '../../src/shared/superagent-worker'
import { conversationState } from '../../src/main/terminal/conversation-session'
import type { SuperAgentWorkers } from '../../src/main/janus/superagent/workers'
import type { SuperAgentStore } from '../../src/main/janus/superagent/store'
import { SuperAgentScheduler } from '../../src/main/janus/superagent/scheduler'
import { SuperAgentSchedulingStore } from '../../src/main/janus/superagent/scheduling-store'
import { createWork, superAgentFixture, workspace, submission } from '../helpers/superagent-fixture'

function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done }); return { promise, resolve } }

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
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close() })
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
})
