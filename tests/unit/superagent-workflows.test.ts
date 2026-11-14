import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { lstat, mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SuperAgentWorkflows } from '@janus-agent/janus-agent/superagent/workflows'
import { SuperAgentWorkflowStore, validateWorkflowGraph } from '@janus-agent/janus-agent/superagent/workflow-store'
import { workflowCheckpoint } from '@janus-agent/janus-agent/superagent/workflow-checkpoint'
import type { SuperAgentWorkflowPlan } from '../../src/shared/superagent-workflow'
import type { SuperAgentWorkerSnapshot } from '../../src/shared/superagent-worker'
import type { SuperAgentWorkers } from '../../src/main/janus/superagent/workers'
import type { SuperAgentStore } from '../../src/main/janus/superagent/store'
import type { SuperAgentEnvironments } from '../../src/main/janus/superagent/environments'
import { SuperAgentScheduler } from '../../src/main/janus/superagent/scheduler'
import { conversationState } from '../../src/main/terminal/conversation-session'
import { superAgentFixture, submission, workspace } from '../helpers/superagent-fixture'

class Native {
  rows = new Map<string, SuperAgentWorkerSnapshot>()
  starts: string[] = []
  listeners = new Set<(row: SuperAgentWorkerSnapshot) => void>()
  constructor(private store: SuperAgentStore, private path: string) {}
  subscribe(listener: (row: SuperAgentWorkerSnapshot) => void) { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  setContinuation() {}
  snapshots(scope: string) { return [...this.rows.values()].filter(row => row.workspaceId === scope).map(row => structuredClone(row)) }
  publish(row: SuperAgentWorkerSnapshot) { for (const listener of this.listeners) listener(structuredClone(row)) }
  async start(workspaceId: string, workId: string) {
    const detail = await this.store.workDetail(workspaceId, workId), id = randomUUID(), conversation = conversationState(id, 'codex')
    conversation.connection = 'ready'; conversation.threadId = randomUUID(); conversation.turnId = randomUUID()
    await this.store.recordExecution(workspaceId, { executionId: id, instanceId: id, workId, cwd: this.path, expectedRevision: detail.work.revision,
      providerSessionId: conversation.threadId, nativeTurnId: conversation.turnId })
    const row: SuperAgentWorkerSnapshot = { workspaceId, workId, executionId: id, instanceId: id, conversationId: 'conversation-a', phase: 'running', conversation, disabledExtensions: [], stopConfirmed: false }
    this.rows.set(workId, row)
    for (const delivery of detail.deliveries.filter(row => row.status === 'pending')) await this.store.updateDelivery(workspaceId, { deliveryId: delivery.id, executionId: id, status: 'delivered' })
    this.starts.push(workId); this.publish(row); return row
  }
  async append() { throw new Error('Not used by this fixture') }
  async stopWork(_scope: string, workId: string) { const row = this.rows.get(workId); if (row) { row.stopConfirmed = true; row.phase = 'stopped'; this.publish(row) } }
  async settleReady(scope: string, workId: string) { await this.stopWork(scope, workId); const row = this.rows.get(workId)!; row.phase = 'ready'; this.publish(row) }
  async report(workId: string, kind: 'ready' | 'failure', revision?: number) {
    const row = this.rows.get(workId)!, detail = await this.store.workDetail(row.workspaceId, workId)
    await this.store.recordReport(row.workspaceId, { reportId: randomUUID(), executionId: row.executionId, kind, summary: kind === 'ready' ? 'Delivered' : 'Test failed', text: 'Reproducible report with evidence', assignmentRevision: revision ?? detail.work.assignment?.revision })
    row.phase = kind === 'ready' ? 'ready' : 'idle'; row.conversation.turnId = null; this.publish(row)
  }
}
const poll: typeof expect.poll = (actual, options) => expect.poll(actual, { timeout: 10000, ...options })
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close() })
async function setup() {
  const f = await superAgentFixture(); cleanups.push(f.dispose)
  const checkout = join(f.root, 'checkout'); await mkdir(checkout)
  const git = (args: string[]) => execFileSync('git', args, { cwd: checkout, windowsHide: true, stdio: 'pipe' })
  git(['init', '-b', 'test']); git(['config', 'user.name', 'Fixture']); git(['config', 'user.email', 'fixture@example.test'])
  await writeFile(join(checkout, 'app.txt'), 'initial'); git(['add', '.']); git(['commit', '-m', 'fixture'])
  const scope = { ...workspace, workspacePath: checkout }
  const native = new Native(f.store, checkout), scheduler = new SuperAgentScheduler(f.store, native as unknown as SuperAgentWorkers)
  await scheduler.initialize()
  const bindings: Array<{ workId: string; checkout: { path: string }; removedAt: null }> = []
  const environments = { store: { snapshot: async () => ({ environments: bindings }) } } as unknown as SuperAgentEnvironments
  const workflows = new SuperAgentWorkflows(f.store, scheduler, native as unknown as SuperAgentWorkers, environments, async (work, inputId) => {
    if (!bindings.some(row => row.workId === work.id)) bindings.push({ workId: work.id, checkout: { path: checkout }, removedAt: null })
    await scheduler.request(scope.workspaceId, work.id, inputId)
  })
  cleanups.push(async () => { await workflows.close(); await scheduler.close() })
  const snapshot = async () => (await workflows.snapshot(scope.workspaceId)).workflows[0]
  return { ...f, checkout, scope, native, scheduler, workflows, snapshot,
    async plan(nodes?: SuperAgentWorkflowPlan['nodes']) {
      const receipt = await f.store.receiveInput(scope, submission('Arrange one developer and one tester'))
      return workflows.create(scope.workspaceId, { inputId: receipt.input.id, key: 'feature', title: 'Feature delivery', goal: 'Implement and verify', nodes: nodes ?? [
        { key: 'dev', role: 'develop', label: 'Developer', title: 'Implement', goal: 'Change app.txt', dependencies: [] },
        { key: 'test', role: 'test', label: 'Tester', title: 'Verify', goal: 'Verify app.txt without editing source', dependencies: ['dev'] },
      ] })
    },
    async control(action: 'pause' | 'resume' | 'stop') {
      if (action === 'pause') await poll(async () => (await snapshot()).nodes.some(node => node.state === 'running'), { timeout: 10000 }).toBe(true)
      const flow = await snapshot(); return workflows.control({ workspaceId: scope.workspaceId, workflowId: flow.id, expectedRevision: flow.revision, action })
    },
  }
}

describe('durable Worker workflows', () => {
  it('rejects duplicate, missing and cyclic dependency keys before creating work', () => {
    expect(() => validateWorkflowGraph([{ key: 'a', dependencies: [] }, { key: 'a', dependencies: [] }])).toThrow('Duplicate')
    expect(() => validateWorkflowGraph([{ key: 'a', dependencies: ['missing'] }])).toThrow('Unknown')
    expect(() => validateWorkflowGraph([{ key: 'a', dependencies: ['b'] }, { key: 'b', dependencies: ['a'] }])).toThrow('cycle')
  })
  it('starts the developer only, hands off the actual checkout and completes after the tester stops', async () => {
    const f = await setup(), flow = await f.plan(), [dev, test] = flow.nodes
    await poll(() => f.native.starts).toEqual([dev.workId])
    expect((await f.scheduler.snapshot(f.scope.workspaceId)).entries).toHaveLength(1)
    await writeFile(join(f.checkout, 'app.txt'), 'developed')
    await f.native.report(dev.workId!, 'ready')
    await poll(async () => ({ starts: f.native.starts, diagnostic: (await f.snapshot()).diagnostic }), { timeout: 10000 }).toEqual({ starts: [dev.workId, test.workId], diagnostic: undefined })
    const tester = await f.store.workDetail(f.scope.workspaceId, test.workId!)
    expect(tester.work.environmentSelection).toMatchObject({ path: f.checkout, includeChanges: true })
    expect((await f.snapshot()).nodes[1].checkpoint?.sha256).toHaveLength(64)
    await f.native.report(test.workId!, 'ready')
    await poll(async () => (await f.snapshot()).state).toBe('completed')
    expect((await f.snapshot()).history).toHaveLength(2)
  })
  it('pauses future steps and resumes without restarting a completed developer', async () => {
    const f = await setup(), flow = await f.plan(), [dev, test] = flow.nodes
    await poll(() => f.native.starts.length).toBe(1); await f.control('pause')
    await f.native.report(dev.workId!, 'ready')
    await poll(async () => (await f.snapshot()).nodes[0].state).toBe('done')
    expect(f.native.starts).toEqual([dev.workId]); expect(await f.workflows.admission(f.scope.workspaceId, test.workId!)).toBe(false)
    await f.control('resume'); await poll(() => f.native.starts).toEqual([dev.workId, test.workId])
  })
  it('shares capacity between independent nodes and preserves queued work on pause', async () => {
    const f = await setup(); await f.scheduler.configure(1)
    const flow = await f.plan(['a', 'b', 'c'].map(key => ({ key, role: 'develop', label: key, title: key, goal: key, dependencies: [] })))
    await poll(() => f.native.starts.length).toBe(1); await f.control('pause')
    await f.native.report(flow.nodes[0].workId!, 'ready')
    await poll(async () => (await f.snapshot()).nodes[0].state).toBe('done')
    expect(f.native.starts.length).toBe(1)
    expect((await f.scheduler.snapshot(f.scope.workspaceId)).paused).toBe(2)
    await f.control('resume'); await poll(() => f.native.starts).toEqual(flow.nodes.slice(0, 2).map(node => node.workId))
  })
  it('stops only its own children, including dependency-waiting work', async () => {
    const f = await setup(), flow = await f.plan()
    const receipt = await f.store.receiveInput(f.scope, submission('Unrelated'))
    const other = await f.store.createWork(f.scope.workspaceId, { creationId: randomUUID(), sourceInputId: receipt.input.id, title: 'Other', goal: 'Other' })
    await f.scheduler.request(f.scope.workspaceId, other.id, receipt.input.id)
    await poll(() => f.native.starts.length).toBe(2); await f.control('stop')
    await poll(async () => (await f.snapshot()).state).toBe('stopped')
    expect(f.native.rows.get(other.id)?.stopConfirmed).toBe(false)
    expect((await f.store.workDetail(f.scope.workspaceId, flow.nodes[1].workId!)).deliveries.every(row => row.status === 'cancelled')).toBe(true)
  })
  it('updates a paused queue entry for supplemental input without losing its FIFO position', async () => {
    const f = await setup(); await f.scheduler.configure(1)
    const flow = await f.plan(['a', 'b'].map(key => ({ key, role: 'develop', label: key, title: key, goal: key, dependencies: [] })))
    await poll(() => f.native.starts.length).toBe(1); await f.control('pause')
    const second = flow.nodes[1].workId!, before = (await f.scheduler.snapshot(f.scope.workspaceId)).entries.find(row => row.workId === second)!
    const receipt = await f.store.receiveInput(f.scope, submission('Additional explicit constraint'))
    await f.store.prepareDispatch(f.scope.workspaceId, second, receipt.input.id, { goal: 'b with additional constraint', constraints: ['Preserve current behavior'], backgroundInputIds: [flow.sourceInputId] })
    await f.native.report(flow.nodes[0].workId!, 'ready'); await poll(async () => (await f.snapshot()).nodes[0].state).toBe('done')
    await f.control('resume'); await poll(() => f.native.starts.length).toBe(2)
    const after = (await f.scheduler.snapshot(f.scope.workspaceId)).entries.find(row => row.workId === second)!
    expect(after.order).toBe(before.order); expect(after.inputId).toBe(receipt.input.id)
    await f.native.report(second, 'ready'); await poll(async () => (await f.snapshot()).state).toBe('completed')
  })
  it('repairs once after a failed test, then blocks a second failure', async () => {
    const f = await setup(), flow = await f.plan(), [dev, test] = flow.nodes
    await poll(() => f.native.starts.length).toBe(1); await f.native.report(dev.workId!, 'ready')
    await poll(() => f.native.starts.length).toBe(2); await f.native.report(test.workId!, 'failure')
    await poll(() => f.native.starts).toEqual([dev.workId, test.workId, dev.workId])
    await f.native.report(dev.workId!, 'ready'); await poll(() => f.native.starts.length).toBe(4)
    await f.native.report(test.workId!, 'failure'); await poll(async () => (await f.snapshot()).state).toBe('blocked')
    expect((await f.snapshot()).repairRound).toBe(1); expect(f.native.starts.length).toBe(4)
  })
  it('does not revive a stopped dependency-waiting child when its developer finishes', async () => {
    const f = await setup(), flow = await f.plan(), [dev, test] = flow.nodes
    await poll(() => f.native.starts.length).toBe(1)
    await f.workflows.stopChild(f.scope.workspaceId, test.workId!)
    const detail = await f.store.workDetail(f.scope.workspaceId, test.workId!)
    await f.store.controlWork(f.scope.workspaceId, test.workId!, detail.work.revision, 'stop')
    await f.scheduler.cancel(f.scope.workspaceId, test.workId!)
    await f.native.report(dev.workId!, 'ready')
    await poll(async () => (await f.snapshot()).nodes[0].state).toBe('done')
    expect((await f.snapshot()).state).toBe('blocked'); expect(f.native.starts).toEqual([dev.workId])
    await f.control('resume'); await poll(() => f.native.starts).toEqual([dev.workId, test.workId])
  })
  it('does not advance on a stale assignment report', async () => {
    const f = await setup(), flow = await f.plan()
    await poll(() => f.native.starts.length).toBe(1); await f.native.report(flow.nodes[0].workId!, 'ready', 999)
    await poll(async () => (await f.scheduler.snapshot(f.scope.workspaceId)).occupied).toBe(0)
    expect((await f.snapshot()).nodes[1].state).toBe('waiting'); expect(f.native.starts.length).toBe(1)
  })
  it('blocks a verification report if source bytes changed during testing', async () => {
    const f = await setup(), flow = await f.plan()
    await poll(() => f.native.starts.length).toBe(1); await f.native.report(flow.nodes[0].workId!, 'ready')
    await poll(() => f.native.starts.length).toBe(2); await writeFile(join(f.checkout, 'app.txt'), 'changed during test')
    await f.native.report(flow.nodes[1].workId!, 'ready')
    await poll(async () => (await f.snapshot()).state).toBe('blocked')
    expect((await f.snapshot()).diagnostic).toContain('Code changed')
  })
  it('restores active plans as interrupted without replay and preserves corrupted records', async () => {
    const f = await setup(); await f.plan()
    const restored = new SuperAgentWorkflowStore(f.root)
    expect((await restored.snapshot()).workflows[0].state).toBe('interrupted')
    await f.workflows.close(); await writeFile(restored.path, '{damaged')
    await expect(new SuperAgentWorkflowStore(f.root).snapshot()).rejects.toThrow('preserved')
    expect(await readFile(restored.path, 'utf8')).toBe('{damaged')
  })
  it('identifies dirty and untracked handoff bytes without writing Git history', async () => {
    const f = await setup(), before = await workflowCheckpoint(f.checkout)
    await writeFile(join(f.checkout, 'untracked.txt'), 'new')
    expect((await workflowCheckpoint(f.checkout)).sha256).not.toBe(before.sha256)
  })
  it('frames file boundaries so concatenating a removed file cannot preserve the checkpoint', async () => {
    const f = await setup(), extra = join(f.checkout, 'zz-extra.txt')
    await writeFile(extra, 'payload')
    const before = await workflowCheckpoint(f.checkout), metadata = await lstat(extra)
    await writeFile(join(f.checkout, 'app.txt'), 'initial' + JSON.stringify(['zz-extra.txt', metadata.mode]) + 'payload')
    await unlink(extra)
    expect((await workflowCheckpoint(f.checkout)).sha256).not.toBe(before.sha256)
  })
})
