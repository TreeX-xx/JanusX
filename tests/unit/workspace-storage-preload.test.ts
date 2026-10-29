import { expect, it, vi } from 'vitest'
import { WORKSPACE_STORAGE_CHANNELS as channels, type WorkspaceStorageAPI } from '../../src/shared/ipc/workspace-storage'
const host = vi.hoisted(() => ({ invoke: vi.fn(), api: undefined as { workspaceStorage: WorkspaceStorageAPI } | undefined }))
vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: (_key: string, api: typeof host.api) => { host.api = api } },
  ipcRenderer: { invoke: host.invoke, send: vi.fn(), on: vi.fn(), removeListener: vi.fn() },
}))

it('exposes typed migration and maintenance channels with exact payloads', async () => {
  await import('../../src/preload/index')
  expect(Object.keys(host.api!.workspaceStorage).sort()).toEqual(['cleanup', 'data', 'dismiss', 'list', 'measure', 'migrate', 'relocate', 'restore'])
  await host.api!.workspaceStorage.list()
  await host.api!.workspaceStorage.migrate(['w'])
  await host.api!.workspaceStorage.dismiss()
  await host.api!.workspaceStorage.data()
  await host.api!.workspaceStorage.measure('s')
  await host.api!.workspaceStorage.cleanup('s', 'logs')
  await host.api!.workspaceStorage.relocate('s', 'D:/moved')
  await host.api!.workspaceStorage.restore('s')
  expect(host.invoke.mock.calls).toEqual([[channels.list], [channels.migrate, ['w']], [channels.dismiss], [channels.data], [channels.measure, 's'], [channels.cleanup, 's', 'logs'], [channels.relocate, 's', 'D:/moved'], [channels.restore, 's']])
})
