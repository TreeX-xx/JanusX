import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkflowXAPI, WorkflowXSnapshot } from '../../src/shared/ipc/workflowx'
import { WORKFLOWX_CHANNELS } from '../../src/shared/ipc/workflowx'
import { useWorkflowXStore } from '../../src/renderer/src/stores/workflowx'

const mocks = vi.hoisted(() => ({ detect: vi.fn(), open: vi.fn(), invoke: vi.fn(), expose: vi.fn(), handle: vi.fn() }))
vi.mock('@janus-agent/node-hosts', () => ({ detectWorkflowX: mocks.detect }))
vi.mock('electron', () => ({
  ipcMain: { handle: mocks.handle }, shell: { openExternal: mocks.open },
  ipcRenderer: { invoke: mocks.invoke, on: vi.fn(), send: vi.fn() },
  contextBridge: { exposeInMainWorld: mocks.expose },
}))
import { registerWorkflowXHandlers } from '../../src/main/ipc/workflowx-handlers'

const snapshot = (workspaceId: string | null, status: WorkflowXSnapshot['status'] = 'detected'): WorkflowXSnapshot => ({ workspaceId, status, sources: [], checkedAt: Date.now() })
beforeEach(() => { vi.clearAllMocks(); useWorkflowXStore.getState().invalidate(); useWorkflowXStore.setState({ snapshot: null, workspaceId: null, checking: false }) })
afterEach(() => vi.unstubAllGlobals())

describe('WorkflowX IPC', () => {
  const sender = { isDestroyed: () => false }
  const resolveWorkspaceRoot = vi.fn(async (id: string) => id === 'known' ? '/registered/project' : undefined)
  const register = () => {
    registerWorkflowXHandlers({ getAllowedWindows: () => [{ isDestroyed: () => false, webContents: sender }] as never, resolveWorkspaceRoot })
    return Object.fromEntries(mocks.handle.mock.calls) as Record<string, (...args: unknown[]) => Promise<unknown>>
  }
  it('preload exposes the typed contract', async () => {
    await import('../../src/preload/index')
    const api = (mocks.expose.mock.calls[0][1] as { workflowx: WorkflowXAPI }).workflowx
    await api.detect(null, true)
    await api.openRepository()
    expect(mocks.invoke.mock.calls).toEqual([[WORKFLOWX_CHANNELS.detect, null, true], [WORKFLOWX_CHANNELS.openRepository]])
  })
  it('detects global scope, resolves registered roots, caches and forces refresh', async () => {
    mocks.detect.mockResolvedValue({ status: 'detected', sources: [], checkedAt: Date.now() })
    const detect = register()[WORKFLOWX_CHANNELS.detect]
    await expect(detect({ sender }, null)).resolves.toMatchObject({ workspaceId: null, status: 'detected' })
    expect(mocks.detect).toHaveBeenLastCalledWith({ workspacePath: undefined })
    await detect({ sender }, 'known')
    expect(mocks.detect).toHaveBeenLastCalledWith({ workspacePath: '/registered/project' })
    await detect({ sender }, 'known')
    expect(mocks.detect).toHaveBeenCalledTimes(2)
    await detect({ sender }, 'known', true)
    expect(mocks.detect).toHaveBeenCalledTimes(3)
  })
  it('rejects untrusted senders and paths without scanning; redacts operational errors', async () => {
    const detect = register()[WORKFLOWX_CHANNELS.detect]
    await expect(detect({ sender: {} }, null)).resolves.toMatchObject({ unavailable: true })
    await expect(detect({ sender }, '/arbitrary/path')).resolves.toMatchObject({ unavailable: true })
    expect(mocks.detect).not.toHaveBeenCalled()
    mocks.detect.mockRejectedValue(new Error('private token and raw exception'))
    const result = await detect({ sender }, null)
    expect(result).toMatchObject({ status: 'uncertain', unavailable: true })
    expect(JSON.stringify(result)).not.toContain('private')
  })
  it('opens only the fixed WorkflowX repository for an authorized sender', async () => {
    const open = register()[WORKFLOWX_CHANNELS.openRepository]
    expect(await open({ sender: {} })).toBe(false)
    expect(mocks.open).not.toHaveBeenCalled()
    expect(await open({ sender }, 'https://untrusted.invalid')).toBe(true)
    expect(mocks.open).toHaveBeenCalledWith('https://github.com/TreeX-xx/WorkFlowX')
    mocks.open.mockRejectedValueOnce(new Error('browser unavailable'))
    expect(await open({ sender })).toBe(false)
  })
})

describe('WorkflowX renderer state', () => {
  it('discards old workspace replies and clears the old status during switching', async () => {
    const pending = new Map<string | null, (result: WorkflowXSnapshot) => void>()
    vi.stubGlobal('window', { electron: { workflowx: { detect: (id: string | null) => new Promise(resolve => pending.set(id, resolve)) } } })
    useWorkflowXStore.setState({ snapshot: snapshot('a'), workspaceId: 'a' })
    const a = useWorkflowXStore.getState().check('a')
    const b = useWorkflowXStore.getState().check('b')
    expect(useWorkflowXStore.getState().snapshot).toBeNull()
    pending.get('b')!(snapshot('b', 'missing')); await b
    pending.get('a')!(snapshot('a')); await a
    expect(useWorkflowXStore.getState().snapshot).toMatchObject({ workspaceId: 'b', status: 'missing' })
  })
  it('returns uncertain on transport failure without surfacing raw error text', async () => {
    vi.stubGlobal('window', { electron: { workflowx: { detect: vi.fn().mockRejectedValue(new Error("Error invoking remote method 'workflowx:detect'")) } } })
    await useWorkflowXStore.getState().check(null)
    expect(useWorkflowXStore.getState().snapshot).toMatchObject({ status: 'uncertain', unavailable: true })
    expect(useWorkflowXStore.getState().checking).toBe(false)
  })
  it('invalidates an in-flight reply on unmount and permits later global detection', async () => {
    let resolve!: (value: WorkflowXSnapshot) => void
    const detect = vi.fn(() => new Promise<WorkflowXSnapshot>(done => { resolve = done }))
    vi.stubGlobal('window', { electron: { workflowx: { detect } } })
    const request = useWorkflowXStore.getState().check(null)
    useWorkflowXStore.getState().invalidate()
    resolve(snapshot(null)); await request
    expect(useWorkflowXStore.getState().snapshot).toBeNull()
    detect.mockResolvedValueOnce(snapshot(null))
    await useWorkflowXStore.getState().check(null)
    expect(useWorkflowXStore.getState().snapshot?.status).toBe('detected')
  })
})
