import { randomUUID } from 'node:crypto'
import { expect, it, vi } from 'vitest'
import { createCoordinator } from '../../plugins/superagent/src/coordinator'
import { NativePluginService } from '../../src/main/plugins/native-service'
import { SuperAgentRemoval } from '../../src/main/janus/superagent/removal'
import type { SuperAgentService } from '../../src/main/janus/superagent/service'

it('waits for host cleanup even after an unexpected native exit and preserves a failed stop receipt', async () => {
  const native = new NativePluginService({ spawn: () => { throw new Error('unused') }, host: async () => null, stopped: vi.fn() })
  const cleanup = vi.fn(async () => { throw new Error('ownership unconfirmed') })
  vi.spyOn(native, 'active', 'get').mockReturnValue(true)
  native.ownCleanup(cleanup)
  native.stop('SERVICE_EXITED')
  expect(native.signal.aborted).toBe(true)
  await expect(native.shutdown()).rejects.toThrow('ownership unconfirmed')
  await expect(native.shutdown()).rejects.toThrow('ownership unconfirmed')
  expect(cleanup).toHaveBeenCalledOnce()
})

function fixture() {
  const lifetime = new AbortController(), workId = randomUUID()
  let phase = 'waiting', observe = () => {}
  const entries = [{ workId: 'queued', workspaceId: 'project', status: 'queued' }]
  const coordinator = createCoordinator()
  const native = { get active() { return !lifetime.signal.aborted }, signal: lifetime.signal,
    call: (method: string, input: never) => coordinator.call(method, input, lifetime.signal) } as NativePluginService
  const scheduler = { setAdmissionGuard: vi.fn(), ledger: { snapshot: async () => ({ entries }) },
    cancelMany: vi.fn(), kick: vi.fn() }
  const service = { scheduler, workers: { snapshots: () => [{ workId, workspaceId: 'project', phase }],
    subscribe: (listener: () => void) => { observe = listener; return () => {} } },
    store: { workDetail: async (_workspace: string, id: string) => ({ work: { title: id } }), workspaceIds: async () => ['project'] } } as unknown as SuperAgentService
  const removal = new SuperAgentRemoval(service, native)
  return { scheduler, removal, workId, guard: () => scheduler.setAdmissionGuard.mock.calls[0][0]('project', workId, true),
    finish: () => { phase = 'ready'; observe() }, crash: () => lifetime.abort() }
}

it('freezes automatic dispatch while a running worker waits for approval, then cancels queued work', async () => {
  const f = fixture()
  expect(await f.guard()).toBe(true)
  const choose = vi.fn(async () => 'wait' as const)
  const waiting = f.removal.prepare(choose)
  await vi.waitFor(() => expect(choose).toHaveBeenCalledOnce())
  expect(await f.guard()).toBe(false)
  expect(f.removal.admission.signal.aborted).toBe(true)
  expect(f.scheduler.cancelMany).not.toHaveBeenCalled()
  f.finish()
  expect(await waiting).toBe(true)
  expect(f.scheduler.cancelMany).toHaveBeenCalledWith([{ workspaceId: 'project', workId: 'queued', closed: false }], expect.any(Function))
})
it('unfreezes on cancel, stops immediately on request and discards an obsolete wait after a crash', async () => {
  const f = fixture()
  expect(await f.removal.prepare(async () => 'cancel')).toBe(false)
  expect(f.removal.admission.signal.aborted).toBe(false)
  expect(await f.guard()).toBe(true)
  expect(await f.removal.prepare(async () => 'stop')).toBe(true)
  expect(await f.guard()).toBe(false)
  const other = fixture()
  const wait = other.removal.prepare(async () => 'wait')
  await vi.waitFor(() => expect(other.removal.admission.signal.aborted).toBe(true))
  other.crash()
  await expect(wait).rejects.toThrow()
  expect(other.scheduler.cancelMany).not.toHaveBeenCalled()
})

it('checks persisted workflow dependencies before dequeue and preserves paused active steering', async () => {
  const plugin = createCoordinator(), signal = new AbortController().signal
  const check = (state: string, dependencies: string[], live = false, launching = true) => plugin.call('scheduler.admit',
    { version: 1, workId: 'w', workspaceId: 'p', live, launching, preparing: false,
      node: { flow: state, state: live ? 'running' : 'queued', dependencies } }, signal)
  expect(await check('running', ['done', 'waiting'])).toBe(false)
  expect(await check('running', ['done'])).toBe(true)
  expect(await check('paused', ['done'], true, false)).toBe(true)
  expect(await check('paused', ['done'], true)).toBe(false)
})
