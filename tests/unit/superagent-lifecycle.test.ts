import { randomUUID } from 'node:crypto'
import { readFile, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SuperAgentWorkers } from '../../src/main/janus/superagent/workers'
import { SuperAgentService } from '../../src/main/janus/superagent/service'
import { SuperAgentLifecycleStore, WORKER_IDLE_MS } from '../../src/main/janus/superagent/lifecycle-store'
import type { SuperAgentEnvironments, SuperAgentEnvironmentLease } from '../../src/main/janus/superagent/environments'
import type { SuperAgentStore } from '../../src/main/janus/superagent/store'
import { ManagedEngineFixture } from '../helpers/superagent-managed-fixture'
import { superAgentFixture, workspace, otherWorkspace, submission } from '../helpers/superagent-fixture'
import { writeRecordAtomic } from '../../src/main/janus/superagent/persistence'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { vi.restoreAllMocks(); for (const close of cleanups.splice(0).reverse()) await close() })
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(yes => { resolve = yes }); return { promise, resolve } }

/** Real records, lifecycle, scheduler and loopback MCP; native/Git effects have explicit controllable seams. */
async function fixture() {
  const f = await superAgentFixture(); cleanups.push(f.dispose)
  const mcpEntry = join(f.root, 'worker-mcp.js'); await writeFile(mcpEntry, '')
  const clock = { now: 1000, idleMs: WORKER_IDLE_MS, backend: 'codex' as 'codex' | 'claude' }
  const recovery = { terminate: vi.fn(async (_tree: Array<{ pid: number; started: string }>) => {}), reboot: vi.fn(async (_after: number) => { throw new Error('Previous execution stop is unconfirmed; restart Windows') }) }
  const runtime = (store: SuperAgentStore = f.store, lifecycle?: SuperAgentLifecycleStore) => {
    let guard: () => Promise<readonly string[]> = async () => []
    const leases = new Map<string, SuperAgentEnvironmentLease>(), bindings = new Map<string, any>(), engines: ManagedEngineFixture[] = []
    const environment = {
      store: { snapshot: async () => ({ environments: [...bindings.values()], operations: [] }) },
      setExecutionGuard: (read: typeof guard) => { guard = read },
      acquire: async (workspaceId: string, workId: string) => {
        const path = join(f.root, workId)
        if ((await guard()).includes(path)) throw new Error('Environment remains occupied by unconfirmed execution')
        const checkout = { path, commonDir: join(path, '.git'), gitDir: join(path, '.git'), repositoryIdentity: 'a'.repeat(64), directoryIdentity: 'b'.repeat(64), branch: 'main', head: 'c'.repeat(40) }
        const lease = { id: randomUUID(), workspaceId, workId, environmentId: randomUUID(), workspacePath: workspace.workspacePath, checkout } as SuperAgentEnvironmentLease
        leases.set(lease.id, lease); bindings.set(workId, { id: lease.environmentId, workId, workspaceId, checkout, removedAt: null })
        return lease
      },
      validateLease: vi.fn(async (id: string) => { const lease = leases.get(id); if (!lease) throw new Error('No lease'); return lease }),
      release: vi.fn(async (id: string) => { leases.delete(id) }), close: async () => {},
    } as unknown as SuperAgentEnvironments
    const workers = new SuperAgentWorkers(store, environment, f.root,
      async backend => ({ backend: backend ?? clock.backend, command: 'fixture', env: {}, mcpCommand: process.execPath, mcpEntry }),
      (_id, publish) => { const engine = new ManagedEngineFixture(publish); engines.push(engine); return engine }, 2 ** 30, () => clock.now, lifecycle, recovery, () => clock.idleMs)
    const service = new SuperAgentService(store, async scope => scope === workspace.workspaceId ? workspace.workspacePath : otherWorkspace.workspacePath, environment, workers)
    cleanups.push(async () => { await service.close().catch(() => undefined) })
    const current = (workId: string, scope = workspace.workspaceId) => workers.snapshots(scope).find(row => row.workId === workId)!
    const create = async (scope = workspace, workerBackend?: 'codex' | 'claude') => {
      await service.scheduler!.initialize()
      const { input } = await store.receiveInput(scope, { ...submission(), workspaceId: scope.workspaceId })
      return store.createWork(scope.workspaceId, { workerBackend, creationId: randomUUID(), sourceInputId: input.id, title: 'Lifecycle work', goal: 'Preserve requirements and current code' })
    }
    const start = async (work: Awaited<ReturnType<typeof create>>) => {
      await service.scheduler!.request(work.workspaceId, work.id, work.sourceInputId)
      await expect.poll(() => current(work.id, work.workspaceId)?.phase).toBe('running')
      return engines.at(-1)!
    }
    const ready = async (workId: string, engine: ManagedEngineFixture) => {
      await engine.tool('report_work', { reportId: randomUUID(), kind: 'ready', summary: 'Ready', text: 'Saved result and checks.' }); engine.end()
      await expect.poll(() => current(workId)?.stopConfirmed).toBe(true)
      await expect.poll(() => current(workId)?.phase).toBe('ready')
    }
    return { workers, service, engines, current, create, start, ready, environment, store }
  }
  return { ...f, clock, runtime, recovery }
}

describe('P6 resident lifecycle and explicit recovery', () => {
  it('preserves native exit diagnostics across failed close and releases capacity after an explicit stop retry', async () => {
    const f = await fixture(), r = f.runtime(), work = await r.create(), engine = await r.start(work)
    engine.exit = vi.fn().mockRejectedValue(new Error('Owned descendant still running'))
    engine.options!.onEvent!({ method: 'janus/transportError', params: { message: 'Codex exited (7). native failure' } })
    engine.state.connection = 'disconnected'; engine.state.error = 'Codex exited (7). native failure'; engine.changed()
    await expect.poll(() => r.current(work.id)?.phase).toBe('failed')
    expect(r.current(work.id).diagnostic).toContain('Codex exited (7). native failure')
    expect(r.current(work.id).diagnostic).toContain('Owned descendant still running')
    expect((await r.service.workerLog(work.workspaceId, r.current(work.id).executionId)).text).toContain('Codex exited (7). native failure')
    const detail = await r.store.workDetail(work.workspaceId, work.id)
    await r.service.controlWork({ workspaceId: work.workspaceId, conversationId: submission().conversationId,
      workId: work.id, expectedRevision: detail.work.revision, action: 'close' })
    await expect.poll(() => (engine.exit as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2)
    await expect.poll(() => r.current(work.id)?.phase).toBe('failed')
    expect((await r.store.workDetail(work.workspaceId, work.id)).work.closedAt).not.toBeNull()
    expect((await r.service.scheduleSnapshot(work.workspaceId)).occupied).toBe(1)
    const diagnostic = r.current(work.id).diagnostic!
    expect(diagnostic.split('Codex exited (7)')).toHaveLength(2)
    expect((await r.workers.lifecycle.snapshot())[0].diagnostic).toBe(diagnostic)
    engine.exit = vi.fn().mockResolvedValue(undefined)
    await r.service.controlWorker({ workspaceId: work.workspaceId, workId: work.id, executionId: r.current(work.id).executionId, type: 'stop' })
    await expect.poll(() => r.current(work.id)?.stopConfirmed).toBe(true)
    await expect.poll(async () => (await r.service.scheduleSnapshot(work.workspaceId)).occupied).toBe(0)
    expect(r.current(work.id).diagnostic).toBe('Codex exited (7). native failure')
    await expect.poll(async () => (await r.service.scheduleSnapshot(work.workspaceId)).entries[0].diagnostic).toBe('Codex exited (7). native failure')
    expect(r.environment.release).toHaveBeenCalledOnce()
  })

  it('retries an earlier failed worker stop during application close and releases only after confirmation', async () => {
    const f = await fixture(), r = f.runtime(), work = await r.create(), engine = await r.start(work)
    engine.exit = vi.fn().mockRejectedValueOnce(new Error('native stop denied')).mockResolvedValue(undefined)
    await expect(r.workers.stopWork(work.workspaceId, work.id)).rejects.toThrow('native stop denied')
    expect(r.current(work.id).stopConfirmed).toBe(false)
    expect(r.environment.release).not.toHaveBeenCalled()
    await r.service.close()
    expect(engine.exit).toHaveBeenCalledTimes(2)
    expect(r.current(work.id).stopConfirmed).toBe(true)
    expect(r.environment.release).toHaveBeenCalledOnce()
  })

  it('mixes engines under the shared capacity and pins continuations and restored identities', async () => {
    const f = await fixture(), r = f.runtime()
    await r.service.configureCapacity(2)
    const a = await r.create(), first = await r.start(a)
    const b = await r.create(workspace, 'claude'), second = await r.start(b)
    f.clock.backend = 'claude'
    expect(r.current(a.id).conversation.engine).toBe('codex')
    expect(r.current(b.id).conversation.engine).toBe('claude')
    await r.ready(a.id, first); await r.ready(b.id, second)
    const thread = r.current(a.id).conversation.threadId
    await r.service.continueWorker({ ...submission('Continue original engine'), workId: a.id })
    await expect.poll(() => r.engines[2]?.options?.worker?.backend).toBe('codex')
    expect(r.engines[2].options?.threadId).toBe(thread)
    await r.service.close()
    const restored = f.runtime(f.createStore().store)
    const states = await restored.service.workerSnapshots(workspace.workspaceId)
    expect(states.find(row => row.workId === b.id)?.conversation.engine).toBe('claude')
  })

  it('applies increased and reduced idle policy to existing ready instances without resetting elapsed time', async () => {
    const f = await fixture(), r = f.runtime(), work = await r.create(), engine = await r.start(work)
    await r.ready(work.id, engine)
    const idleSince = r.current(work.id).idleSince!
    f.clock.idleMs = WORKER_IDLE_MS * 2
    f.clock.now = idleSince + WORKER_IDLE_MS
    await r.workers.sweep()
    expect(r.current(work.id).idleSince).toBe(idleSince)
    f.clock.idleMs = NaN
    await expect(r.workers.sweep()).rejects.toThrow('Invalid Worker idle timeout')
    expect(r.current(work.id)).toBeDefined()
    f.clock.idleMs = WORKER_IDLE_MS / 2
    await r.workers.sweep()
    expect(r.current(work.id)).toBeUndefined()
  })

  it('restores a ready idle deadline across app restart without extending it or launching anything', async () => {
    const f = await fixture(), r = f.runtime(), work = await r.create(), engine = await r.start(work)
    await r.ready(work.id, engine)
    const idleSince = r.current(work.id).idleSince!
    f.clock.now += WORKER_IDLE_MS / 2; await r.service.close()
    const reopened = f.runtime(f.createStore().store)
    expect((await reopened.service.workerSnapshots(workspace.workspaceId))[0]).toMatchObject({ phase: 'ready', idleSince, restored: true })
    await reopened.service.workCard(workspace.workspaceId, work.id)
    f.clock.now = idleSince + WORKER_IDLE_MS; await reopened.workers.sweep()
    expect(reopened.current(work.id)).toBeUndefined(); expect(reopened.engines).toHaveLength(0)
    expect((await reopened.workers.lifecycle.snapshot())[0].retiredAt).toBe(f.clock.now)
    const again = f.runtime(f.createStore().store)
    expect(await again.service.workerSnapshots(workspace.workspaceId)).toEqual([])
  })

  it('keeps a new queued input resident when it races the retirement write', async () => {
    const f = await fixture(), r = f.runtime(); await r.service.configureCapacity(1)
    const a = await r.create(), first = await r.start(a); await r.ready(a.id, first)
    const b = await r.create(), second = await r.start(b)
    const update = r.workers.lifecycle.update.bind(r.workers.lifecycle), gate = deferred(), entered = deferred()
    vi.spyOn(r.workers.lifecycle, 'update').mockImplementation(async (...args) => {
      if (args[2].retiredAt !== undefined) { entered.resolve(); await gate.promise }
      return update(...args)
    })
    f.clock.now += WORKER_IDLE_MS; await second.tool('__heartbeat')
    const sweeping = r.workers.sweep(); await entered.promise
    await r.service.continueWorker({ ...submission('Input racing retirement'), workId: a.id })
    gate.resolve(); await sweeping
    expect(r.current(a.id)).toMatchObject({ phase: 'ready', idleSince: undefined })
    expect((await r.workers.lifecycle.snapshot()).find(row => row.workId === a.id)?.retiredAt).toBeUndefined()
    expect(r.engines).toHaveLength(2)
  })

  it('releases the original reservation when retirement precedes the scheduler settlement receipt', async () => {
    const f = await fixture(), r = f.runtime(); await r.service.configureCapacity(1)
    const work = await r.create(), engine = await r.start(work), gate = deferred()
    const settle = r.workers.settleReady.bind(r.workers)
    vi.spyOn(r.workers, 'settleReady').mockImplementation(async (...args) => { await settle(...args); await gate.promise })
    try {
      await r.ready(work.id, engine)
      expect((await r.service.scheduleSnapshot(workspace.workspaceId)).occupied).toBe(1)
      f.clock.now += WORKER_IDLE_MS; await r.workers.sweep()
      expect(r.current(work.id)).toBeUndefined()
      await r.service.continueWorker({ ...submission('Continue after retirement, before receipt'), workId: work.id })
      expect(r.engines).toHaveLength(1)
      gate.resolve()
      await expect.poll(() => r.current(work.id)?.phase).toBe('running')
      expect(r.engines).toHaveLength(2)
      expect((await r.service.scheduleSnapshot(workspace.workspaceId)).occupied).toBe(1)
    } finally { gate.resolve() }
  })

  it('stops owned processes even when persistence fails and never releases an unrecorded stop', async () => {
    const f = await fixture(); let failWrites = false
    const lifecycle = new SuperAgentLifecycleStore(f.root, async (path, text) => {
      if (failWrites) throw new Error('disk unavailable')
      await writeRecordAtomic(path, text)
    })
    const r = f.runtime(f.store, lifecycle), work = await r.create(), engine = await r.start(work)
    const dispose = vi.spyOn(engine, 'dispose'); failWrites = true
    await expect(r.service.close()).rejects.toThrow()
    expect(dispose).toHaveBeenCalled(); expect(r.environment.release).not.toHaveBeenCalled()
    expect((await lifecycle.snapshot())[0].stopConfirmed).toBe(false)
  })

  it.each(['disconnected', 'closed'] as const)('treats unexpected %s control transport as failure without a model retry', async connection => {
    const f = await fixture(), r = f.runtime(), work = await r.create(), engine = await r.start(work)
    engine.state.connection = connection; engine.changed()
    await expect.poll(() => r.current(work.id).stopConfirmed).toBe(true)
    expect(r.current(work.id).phase).toBe('failed')
    expect(r.current(work.id).diagnostic).toContain('control connection')
    await r.workers.sweep(); expect(r.engines).toHaveLength(1); expect(engine.inputs).toHaveLength(1)
  })

  it('retires only after 30 minutes from confirmed ready, ignores reads, retains originals and resumes the native thread', async () => {
    const f = await fixture(), r = f.runtime(), work = await r.create(), engine = await r.start(work)
    const exit = deferred(); engine.exit = () => exit.promise
    await engine.tool('report_work', { reportId: randomUUID(), kind: 'ready', summary: 'Ready', text: 'Historical implementation' }); engine.end()
    await expect.poll(() => r.current(work.id).phase).toBe('stopping')
    f.clock.now += WORKER_IDLE_MS * 2; await r.workers.sweep()
    expect(r.current(work.id).stopConfirmed).toBe(false)
    exit.resolve(); await expect.poll(() => r.current(work.id).idleSince).toBe(f.clock.now)
    const idleSince = r.current(work.id).idleSince!, threadId = engine.state.threadId
    f.clock.now += WORKER_IDLE_MS - 1
    await r.service.workCard(workspace.workspaceId, work.id); await r.service.listWorks(workspace.workspaceId); await r.workers.sweep()
    expect(r.current(work.id).idleSince).toBe(idleSince)
    f.clock.now++; await r.workers.sweep()
    expect(r.workers.snapshots(workspace.workspaceId)).toEqual([])
    const saved = await r.store.workDetail(workspace.workspaceId, work.id)
    expect(saved.reports).toHaveLength(1); expect(saved.executions[0].providerSessionId).toBe(threadId)
    expect((await r.store.readResource(workspace.workspaceId, saved.inputs[0].resourceId)).text).toBe('Implement the requested feature')
    expect(saved.work.closedAt).toBeNull()
    await r.service.continueWorker({ ...submission('Continue the old feature'), workId: work.id })
    await expect.poll(() => r.engines.length).toBe(2)
    await expect.poll(() => r.current(work.id)?.phase).toBe('running')
    expect(r.engines[1].options?.threadId).toBe(threadId)
    expect(r.current(work.id).executionId).not.toBe(saved.executions[0].id)
    expect(r.current(work.id).idleSince).toBeUndefined()
  })

  it('leaves queued supplements outside the idle timer and starts a fresh timer only after their new execution finishes', async () => {
    const f = await fixture(), r = f.runtime(); await r.service.configureCapacity(1)
    const a = await r.create(), first = await r.start(a); await r.ready(a.id, first)
    const b = await r.create(), second = await r.start(b)
    await r.service.continueWorker({ ...submission('A late constraint'), workId: a.id })
    expect(r.current(a.id).idleSince).toBeUndefined()
    f.clock.now += WORKER_IDLE_MS + 1; await second.tool('__heartbeat'); await r.workers.sweep()
    expect(r.current(a.id)).toBeDefined(); expect(r.engines).toHaveLength(2)
    await r.service.controlWork({ workspaceId: workspace.workspaceId, conversationId: 'conversation-a', workId: b.id,
      expectedRevision: (await r.store.workDetail(workspace.workspaceId, b.id)).work.revision, action: 'stop' })
    await expect.poll(() => r.engines.length).toBe(3)
    await expect.poll(() => r.current(a.id).phase).toBe('running')
    await r.ready(a.id, r.engines[2]); expect(r.current(a.id).idleSince).toBe(f.clock.now)
  })

  it('restores history and pending input without a process, model turn, permanent close or replay', async () => {
    const f = await fixture(), r = f.runtime(), work = await r.create(), engine = await r.start(work)
    engine.state.approvals = [{ id: 'approval', kind: 'command', description: 'Native decision' }]; engine.changed()
    await r.service.continueWorker({ ...submission('Pending before shutdown'), workId: work.id })
    await expect.poll(async () => (await r.store.workDetail(workspace.workspaceId, work.id)).deliveries.at(-1)?.status).toBe('pending')
    await r.service.close()
    const reopened = f.runtime(f.createStore().store)
    const states = await reopened.service.workerSnapshots(workspace.workspaceId)
    expect(states[0]).toMatchObject({ phase: 'interrupted', restored: true, stopConfirmed: true })
    expect((await reopened.service.scheduleSnapshot(workspace.workspaceId)).entries[0].status).toBe('interrupted')
    await reopened.workers.sweep(); expect(reopened.engines).toHaveLength(0)
    const detail = await reopened.store.workDetail(workspace.workspaceId, work.id)
    expect(detail.work.closedAt).toBeNull(); expect(detail.deliveries.at(-1)?.status).toBe('pending')
    await expect(reopened.service.startWorker(workspace.workspaceId, work.id)).rejects.toThrow(/new explicit input|Restored input/)
    // Reinstall only the already bound environment in this deterministic Git seam.
    const fresh = await reopened.service.submitInput(submission('Explicitly continue after reopening'))
    await reopened.store.routeInput(workspace.workspaceId, fresh.input.id, work.id)
    await reopened.service.scheduler!.request(workspace.workspaceId, work.id, fresh.input.id)
    await expect.poll(() => reopened.current(work.id)?.phase).toBe('running')
    expect(reopened.engines[0].options?.threadId).toBe(engine.state.threadId)
    expect(reopened.engines[0].inputs).toHaveLength(1)
  })

  it('retains unconfirmed stops across restart, occupies capacity and blocks reuse without pretending to restore controls', async () => {
    const f = await fixture(), r = f.runtime(), work = await r.create(), engine = await r.start(work)
    engine.exit = async () => { throw new Error('Owned process exit unconfirmed') }
    await expect(r.workers.stopWork(workspace.workspaceId, work.id)).rejects.toThrow('unconfirmed')
    await r.service.close().catch(() => undefined)
    const reopened = f.runtime(f.createStore().store)
    expect((await reopened.service.workerSnapshots(workspace.workspaceId))[0]).toMatchObject({ phase: 'interrupted', stopConfirmed: false, restored: true })
    expect((await reopened.service.scheduleSnapshot(workspace.workspaceId)).occupied).toBe(1)
    await expect(reopened.environment.acquire(workspace.workspaceId, work.id)).rejects.toThrow('occupied')
    f.clock.now += WORKER_IDLE_MS * 4; await reopened.workers.sweep()
    expect(reopened.current(work.id)).toBeDefined(); expect(reopened.engines).toHaveLength(0)
    await expect(reopened.workers.stopWork(workspace.workspaceId, work.id)).rejects.toThrow('unconfirmed')
  })

  it.skipIf(process.platform !== 'win32')('retries a restored owned tree and releases capacity only after native and durable confirmation', async () => {
    const f = await fixture(), r = f.runtime(), work = await r.create(), engine = await r.start(work)
    const stop = f.recovery.terminate.mockRejectedValue(new Error('Owned PID 48852 is still running')), reboot = f.recovery.reboot
    const tree = [{ pid: 48852, started: '123456789' }]
    engine.exit = async () => { await engine.options!.onProcessTree!(tree); throw new Error('Access denied: PID 48852') }
    await expect(r.workers.stopWork(workspace.workspaceId, work.id)).rejects.toThrow('Access denied')
    expect((await r.workers.lifecycle.snapshot())[0]).toMatchObject({ processTree: tree, hostDrained: true, stopConfirmed: false })
    await r.service.close().catch(() => undefined)
    const reopened = f.runtime(f.createStore().store)
    expect((await reopened.service.workerSnapshots(workspace.workspaceId))[0].diagnostic).toContain('PID 48852')
    await expect(reopened.workers.stopWork(workspace.workspaceId, work.id)).rejects.toThrow('still running')
    expect((await reopened.service.scheduleSnapshot(workspace.workspaceId)).occupied).toBe(1)
    await expect(reopened.environment.acquire(workspace.workspaceId, work.id)).rejects.toThrow('occupied')
    stop.mockResolvedValue(undefined)
    await reopened.workers.stopWork(workspace.workspaceId, work.id)
    await expect.poll(async () => (await reopened.service.scheduleSnapshot(workspace.workspaceId)).occupied).toBe(0)
    expect(reopened.current(work.id)).toMatchObject({ phase: 'stopped', stopConfirmed: true, restored: true })
    expect((await reopened.workers.lifecycle.snapshot())[0].stopConfirmed).toBe(true)
    expect(reopened.engines).toHaveLength(0)
    expect(stop).toHaveBeenLastCalledWith(tree)
    expect(reboot).toHaveBeenCalledTimes(1)
    await reopened.environment.acquire(workspace.workspaceId, work.id)
  })

  it.skipIf(process.platform !== 'win32')('releases a legacy unconfirmed record only after a verified Windows reboot', async () => {
    const f = await fixture(), r = f.runtime(), work = await r.create(), engine = await r.start(work)
    const reboot = f.recovery.reboot.mockResolvedValue(undefined), stop = f.recovery.terminate
    engine.exit = async () => { throw new Error('Legacy process tree unconfirmed') }
    await expect(r.workers.stopWork(workspace.workspaceId, work.id)).rejects.toThrow('unconfirmed')
    await r.service.close().catch(() => undefined)
    const reopened = f.runtime(f.createStore().store)
    await reopened.service.workerSnapshots(workspace.workspaceId)
    await reopened.workers.stopWork(workspace.workspaceId, work.id)
    expect(reboot).toHaveBeenCalledWith(f.clock.now)
    expect(stop).not.toHaveBeenCalled()
    expect(reopened.current(work.id).stopConfirmed).toBe(true)
    expect(reopened.engines).toHaveLength(0)
  })

  it.skipIf(process.platform !== 'win32')('does not trust native exit evidence when host writes were not drained', async () => {
    const f = await fixture(), r = f.runtime(), work = await r.create(), engine = await r.start(work)
    const stop = f.recovery.terminate
    engine.exit = async () => { throw new Error('unconfirmed') }
    await expect(r.workers.stopWork(workspace.workspaceId, work.id)).rejects.toThrow('unconfirmed')
    await r.service.close().catch(() => undefined)
    await r.workers.lifecycle.update(work.id, r.current(work.id).executionId, { processTree: [{ pid: 48852, started: '123' }], hostDrained: false })
    const reopened = f.runtime(f.createStore().store)
    await expect(reopened.workers.stopWork(workspace.workspaceId, work.id)).rejects.toThrow('unconfirmed')
    expect(stop).not.toHaveBeenCalled()
    expect((await reopened.workers.lifecycle.snapshot())[0].stopConfirmed).toBe(false)
  })

  it('does not mistake normal native waiting for loss, but stops on a missing MCP heartbeat without replaying pending input', async () => {
    const f = await fixture(), r = f.runtime(), work = await r.create(), engine = await r.start(work)
    engine.state.approvals = [{ id: 'approval', kind: 'command', description: 'Waiting for user' }]; engine.changed()
    await r.service.continueWorker({ ...submission('Keep this pending'), workId: work.id })
    f.clock.now += WORKER_IDLE_MS * 3; await engine.tool('__heartbeat'); await r.workers.sweep()
    expect(r.current(work.id).phase).toBe('waiting'); expect(r.engines).toHaveLength(1)
    f.clock.now += 20_001; await r.workers.sweep()
    expect(r.current(work.id)).toMatchObject({ phase: 'failed', stopConfirmed: true })
    expect(r.current(work.id).diagnostic).toContain('MCP')
    expect((await r.store.workDetail(workspace.workspaceId, work.id)).deliveries.at(-1)?.status).toBe('pending')
    await r.workers.sweep(); expect(engine.inputs).toHaveLength(1); expect(r.engines).toHaveLength(1)
  })

  it('preserves a corrupt lifecycle file and refuses launch instead of silently losing process ownership', async () => {
    const f = await fixture(), corrupt = '{"version":999,"entries":[]}'
    await writeFile(join(f.root, 'lifecycle.json'), corrupt)
    const r = f.runtime()
    await expect(r.service.workerSnapshots(workspace.workspaceId)).rejects.toThrow('preserved')
    expect(await readFile(join(f.root, 'lifecycle.json'), 'utf8')).toBe(corrupt)
    expect(r.engines).toHaveLength(0)
  })

  it('freezes an entire stop-all set, revokes old decisions and leaves a later explicit continuation possible', async () => {
    const f = await fixture(), r = f.runtime(); await r.service.configureCapacity(1)
    const a = await r.create(), first = await r.start(a), b = await r.create()
    await r.service.scheduler!.request(workspace.workspaceId, b.id, b.sourceInputId)
    const exit = deferred(); first.exit = () => exit.promise
    const input = await r.service.submitInput(submission('Stop all work in this workspace'))
    const decision = { inputId: input.input.id, action: 'stop-all' as const, scope: 'workspace' as const }
    const result = await r.service.routeDecision(workspace.workspaceId, decision)
    expect(result).toMatchObject({ action: 'stop-all', requested: true, targets: expect.any(Array) })
    expect((result as any).targets).toHaveLength(2)
    await expect(r.service.routeDecision(workspace.workspaceId, decision)).resolves.toEqual(result)
    expect(r.current(a.id).stopConfirmed).toBe(false); expect(r.engines).toHaveLength(1)
    expect((await r.store.workDetail(workspace.workspaceId, b.id)).deliveries[0].status).toBe('cancelled')
    await expect(r.service.routeDecision(workspace.workspaceId, { inputId: b.sourceInputId, action: 'new', key: 'late', title: 'Late', goal: 'Must not launch' })).rejects.toThrow('predates stop-all')
    await expect(first.tool('report_work', { reportId: randomUUID(), kind: 'ready', summary: 'Late', text: 'Late report' })).rejects.toThrow()
    exit.resolve(); await expect.poll(() => r.current(a.id).stopConfirmed).toBe(true)
    expect(r.engines).toHaveLength(1)
    expect((await r.store.workDetail(workspace.workspaceId, a.id)).work.closedAt).toBeNull()
    await r.service.continueWorker({ ...submission('Explicitly resume A only'), workId: a.id })
    await expect.poll(() => r.engines.length).toBe(2)
  })

  it('scopes stop-all to the workspace unless all-workspaces is explicitly selected', async () => {
    const f = await fixture(), r = f.runtime(), a = await r.create(), b = await r.create(otherWorkspace)
    await r.start(a); await r.start(b)
    const first = await r.service.submitInput(submission('Stop this workspace'))
    await r.service.routeDecision(workspace.workspaceId, { action: 'stop-all', inputId: first.input.id, scope: 'workspace' })
    await expect.poll(() => r.current(a.id).stopConfirmed).toBe(true)
    expect(r.current(b.id, otherWorkspace.workspaceId).phase).toBe('running')
    const all = await r.service.submitInput(submission('Stop across all workspaces'))
    await r.service.routeDecision(workspace.workspaceId, { action: 'stop-all', inputId: all.input.id, scope: 'all-workspaces' })
    await expect.poll(() => r.current(b.id, otherWorkspace.workspaceId).stopConfirmed).toBe(true)
  })

  it('does not cancel the retirement deadline of an already settled result when stopping all execution', async () => {
    const f = await fixture(), r = f.runtime(), work = await r.create(), engine = await r.start(work)
    await r.ready(work.id, engine)
    await expect.poll(async () => (await r.service.scheduleSnapshot(workspace.workspaceId)).entries[0].status).toBe('ready')
    const idleSince = r.current(work.id).idleSince
    const input = await r.service.submitInput(submission('Stop all active execution'))
    const result = await r.service.routeDecision(workspace.workspaceId, { action: 'stop-all', inputId: input.input.id, scope: 'workspace' })
    expect(result).toMatchObject({ targets: [] })
    expect(r.current(work.id)).toMatchObject({ phase: 'ready', idleSince })
    f.clock.now += WORKER_IDLE_MS; await r.workers.sweep()
    expect(r.current(work.id)).toBeUndefined()
  })

  it.each(['input', 'report'] as const)('checks the saved %s original before authorizing missing-history reconstruction', async kind => {
    const f = await fixture(), r = f.runtime(), work = await r.create(), engine = await r.start(work)
    await r.ready(work.id, engine)
    const nativeStart = ManagedEngineFixture.prototype.startManaged
    vi.spyOn(ManagedEngineFixture.prototype, 'startManaged').mockImplementation(async function (options) {
      await options.onMissingThread!(); return nativeStart.call(this, { ...options, threadId: undefined })
    })
    await r.service.continueWorker({ ...submission('Continue without native history'), workId: work.id })
    await expect.poll(() => r.current(work.id).phase).toBe('running')
    expect(r.current(work.id).recovery).toBe('rebuilt')
    expect(r.engines[1].inputs[0].text).toContain('Native history is missing')
    expect(r.engines[1].inputs[0].text).toContain('read_work and original resources before dependent actions')
    await r.ready(work.id, r.engines[1])
    const detail = await r.store.workDetail(workspace.workspaceId, work.id)
    const resource = detail.resources.find(row => row.id === (kind === 'input' ? detail.inputs[0].resourceId : detail.reports.at(-1)!.resourceId))!
    await rm(join(f.root, 'resources', `${resource.id}.txt`))
    if (kind === 'input') {
      // Dispatch now validates supplied background originals before admitting a new execution.
      await expect(r.service.continueWorker({ ...submission('Try with missing critical original'), workId: work.id })).rejects.toThrow('resource unavailable')
      expect(r.engines).toHaveLength(2)
      expect(r.current(work.id).stopConfirmed).toBe(true)
      return
    }
    await r.service.continueWorker({ ...submission('Try with missing critical original'), workId: work.id })
    await expect.poll(() => r.current(work.id).phase).toBe('failed')
    expect(r.current(work.id).diagnostic).toContain('required original')
    expect(r.engines.at(-1)!.inputs).toHaveLength(0)
  })
})
