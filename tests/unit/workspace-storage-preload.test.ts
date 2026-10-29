import { expect, it, vi } from 'vitest'
import { WORKSPACE_STORAGE_CHANNELS as channels, type WorkspaceStorageAPI } from '../../src/shared/ipc/workspace-storage'
const host = vi.hoisted(() => ({ invoke: vi.fn(), api: undefined as { workspaceStorage: WorkspaceStorageAPI } | undefined }))
vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: (_key: string, api: typeof host.api) => { host.api = api } },
  ipcRenderer: { invoke: host.invoke, send: vi.fn(), on: vi.fn(), removeListener: vi.fn() },
}))

it('exposes only list, explicit migration and dismissal over typed storage channels', async () => {
  await import('../../src/preload/index')
  expect(Object.keys(host.api!.workspaceStorage).sort()).toEqual(['dismiss', 'list', 'migrate'])
  await host.api!.workspaceStorage.list()
  await host.api!.workspaceStorage.migrate(['w'])
  await host.api!.workspaceStorage.dismiss()
  expect(host.invoke.mock.calls).toEqual([[channels.list], [channels.migrate, ['w']], [channels.dismiss]])
})
