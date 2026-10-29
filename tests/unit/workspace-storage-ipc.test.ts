import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WorkspaceStateStore } from '../../src/main/storage/workspace-state'
import { WORKSPACE_STORAGE_CHANNELS as channels } from '../../src/shared/ipc/workspace-storage'

const host = vi.hoisted(() => ({ profile: '', store: undefined as WorkspaceStateStore | undefined, handlers: new Map<string, (...args: any[]) => Promise<any>>() }))
vi.mock('electron', () => ({ app: { getPath: () => host.profile }, ipcMain: { handle: (key: string, fn: any) => host.handlers.set(key, fn) } }))
vi.mock('../../src/main/storage/service', () => ({ workspaceStateStore: () => host.store! }))
import { registerWorkspaceStorageHandlers } from '../../src/main/ipc/workspace-storage-handlers'

let base: string, cwd: string
const call = (channel: string, ...args: unknown[]) => host.handlers.get(channel)!({ sender: { id: 7 } }, ...args)
beforeEach(async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), 'janus-storage-ipc-')))
  cwd = join(base, 'project'); host.profile = join(base, 'profile')
  await mkdir(join(cwd, '.janusX'), { recursive: true })
  await writeFile(join(cwd, '.janusX/janusX.launch.json'), JSON.stringify({ configurations: [] }))
  const records = join(host.profile, 'janusx/workspaces'); await mkdir(records, { recursive: true })
  for (const item of [{ id: 'w', name: 'Project', path: cwd }, { id: 'offline', name: 'Offline', path: join(base, 'offline') }, { id: 'remote', name: 'Remote', path: '/remote/repo', runtime: { kind: 'ssh' } }]) {
    await writeFile(join(records, `${item.id}.json`), JSON.stringify(item))
  }
  host.store = new WorkspaceStateStore(host.profile)
  host.handlers.clear()
  registerWorkspaceStorageHandlers(() => [{ isDestroyed: () => false, webContents: { id: 7 } }] as any)
})
afterEach(async () => { await rm(base, { recursive: true, force: true }) })

it('lists registered local, offline and unsupported remote workspaces without auto migration', async () => {
  const migrate = vi.spyOn(host.store!, 'migrate')
  const view = await call(channels.list)
  expect(view.prompt).toBe(true)
  expect(view.items).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: 'w', status: 'pending', source: join(cwd, '.janusX') }),
    expect.objectContaining({ id: 'offline', status: 'offline' }),
    expect.objectContaining({ id: 'remote', status: 'unsupported' }),
  ]))
  expect(migrate).not.toHaveBeenCalled()
  await call(channels.dismiss)
  host.store = new WorkspaceStateStore(host.profile)
  expect((await call(channels.list)).prompt).toBe(false)
})

it('authorizes application windows and accepts only registered IDs', async () => {
  await expect(host.handlers.get(channels.list)!({ sender: { id: 99 } })).rejects.toThrow('application windows')
  await expect(call(channels.migrate, [cwd])).rejects.toThrow('registered')
  await expect(call(channels.migrate, [null])).rejects.toThrow('selection')
})

it('deduplicates selection and reports per-workspace failure without blocking other items', async () => {
  const migrate = vi.spyOn(host.store!, 'migrate').mockRejectedValueOnce(new Error('disk full'))
  const items = await call(channels.migrate, ['w', 'remote', 'offline', 'w'])
  expect(items).toHaveLength(3)
  expect(items.find((item: any) => item.id === 'w')).toMatchObject({ status: 'failed', error: expect.stringContaining('disk full') })
  expect(migrate).toHaveBeenCalledTimes(1)
  migrate.mockRestore()
  expect(await call(channels.migrate, ['w'])).toEqual([expect.objectContaining({ status: 'migrated' })])
})
