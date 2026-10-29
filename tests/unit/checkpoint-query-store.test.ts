import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ list: vi.fn(), handlers: new Set<(event: any) => void>() }))
vi.mock('../../src/renderer/src/stores/workspace', () => ({ useWorkspaceStore: { getState: () => ({
  activeWorkspaceId: 'w', workspaces: [{ id: 'w', path: '/project' }],
}) } }))
import { useCheckpointStore as store } from '../../src/renderer/src/stores/checkpoint'
const gate = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r }); return { resolve, promise } }
beforeEach(() => {
  mocks.list.mockReset(); mocks.handlers.clear()
  vi.stubGlobal('window', { electron: { checkpoint: {
    list: mocks.list, onEvent: (fn: (e: any) => void) => { mocks.handlers.add(fn); return () => mocks.handlers.delete(fn) },
  } } })
  store.getState().clearWorkspaceScope()
})

describe('checkpoint query coalescing', () => {
  it('shares identical in-flight requests and prevents older filters overwriting the latest', async () => {
    const first = gate<any[]>(), second = gate<any[]>()
    mocks.list.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const a = store.getState().fetchCheckpoints({ cwd: '/project', terminalId: 'a' })
    const b = store.getState().fetchCheckpoints({ cwd: '/project', terminalId: 'a' })
    const c = store.getState().fetchCheckpoints({ cwd: '/project', terminalId: 'b' })
    expect(mocks.list).toHaveBeenCalledTimes(2)
    second.resolve([{ id: 'new' }]); await c
    first.resolve([{ id: 'old' }]); await Promise.all([a, b])
    expect(store.getState().checkpoints).toEqual([{ id: 'new' }])
  })
  it('turns an event burst into one active request and one follow-up, without timers', async () => {
    const first = gate<any[]>(), second = gate<any[]>()
    mocks.list.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const unsubscribe = store.getState().subscribeToEvents()
    const emit = () => mocks.handlers.forEach(fn => fn({ type: 'created' }))
    for (let i = 0; i < 100; i++) emit()
    expect(mocks.list).toHaveBeenCalledTimes(1)
    first.resolve([])
    await vi.waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2))
    second.resolve([])
    await vi.waitFor(() => expect(store.getState().loading).toBe(false))
    expect(mocks.list).toHaveBeenCalledTimes(2)
    unsubscribe()
  })
})
