import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, writeFile, readFile, readdir, rename, rm, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WorkspaceStateStore } from '../../src/main/storage/workspace-state'
import { WORKSPACE_STORAGE_CHANNELS as channels } from '../../src/shared/ipc/workspace-storage'

const host = vi.hoisted(() => ({ profile: '', terminals: [] as any[], tasks: new Map(), retire: vi.fn(), store: undefined as WorkspaceStateStore | undefined, handlers: new Map<string, (...args: any[]) => Promise<any>>() }))
vi.mock('electron', () => ({ app: { getPath: () => host.profile }, ipcMain: { handle: (key: string, fn: any) => host.handlers.set(key, fn) } }))
vi.mock('../../src/main/storage/service', () => ({ workspaceStateStore: () => host.store!, startWorkspaceMaintenance: vi.fn(), requestWorkspaceMaintenance: vi.fn() }))
vi.mock('../../src/main/terminal/manager', () => ({ terminalManager: { listInstances: () => host.terminals } }))
vi.mock('../../src/main/project/runner/service', () => ({ getProjectRunner: () => ({ getAllRunning: () => host.tasks }) }))
vi.mock('../../src/main/notifications/retire-legacy-hooks', () => ({ retireLegacyHooks: (...args: unknown[]) => host.retire(...args) }))
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
  host.terminals = []; host.tasks.clear(); host.retire.mockReset()
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
  await expect(host.handlers.get(channels.retireHooks)!({ sender: { id: 99 } })).rejects.toThrow('application windows')
  expect(host.retire).not.toHaveBeenCalled()
})

it('passes only host-resolved cleanup locations and rejects running terminals or tasks', async () => {
  host.retire.mockImplementation(async (_locations, unused) => { unused(); return { commands: 0, files: [], retained: [] } })
  host.terminals = [{ status: 'running' }]
  await expect(call(channels.retireHooks, { homeDir: cwd })).rejects.toThrow('Close terminals')
  host.terminals = [{ status: 'exited' }]; host.tasks.set('task', {})
  await expect(call(channels.retireHooks)).rejects.toThrow('Close terminals')
  host.tasks.clear()
  expect(await call(channels.retireHooks)).toEqual({ commands: 0, files: [], retained: [] })
  expect(host.retire.mock.calls[0][0]).toMatchObject({ userDataDir: host.profile })
  expect(host.retire.mock.calls[0][0].homeDir).not.toBe(cwd)
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

it('exposes guarded maintenance operations and validates relocation selection', async () => {
  const items = await call(channels.data)
  expect(items).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'Project', workspaceIds: ['w'] }), expect.objectContaining({ status: 'offline', workspaceIds: ['offline'] })]))
  await expect(call(channels.cleanup, '../escape', 'everything')).rejects.toThrow('selection')
  await expect(call(channels.relocate, items[0].id, null)).rejects.toThrow('relocation')
  await expect(host.handlers.get(channels.data)!({ sender: { id: 99 } })).rejects.toThrow('application windows')
  await expect(call(channels.measure, cwd)).rejects.toThrow('registered')
  await expect(call(channels.cleanup, '../escape', 'logs')).rejects.toThrow('registered')
})

it('updates every local record sharing a relocated directory and retains its storage id', async () => {
  await call(channels.migrate, ['w'])
  const item = (await call(channels.data)).find((item: any) => item.workspaceIds.includes('w'))
  const directory = join(host.profile, 'janusx', 'workspaces')
  await writeFile(join(directory, 'duplicate.json'), JSON.stringify({ id: 'duplicate', name: 'Duplicate', path: cwd }))
  const moved = join(base, 'renamed'); await rename(cwd, moved)
  await call(channels.relocate, item.id, moved)
  for (const id of ['w', 'duplicate']) expect(JSON.parse(await readFile(join(directory, `${id}.json`), 'utf8')).path).toBe(moved)
  expect((await host.store!.resolve(moved)).root).toBe(item.target)
})

it('reattaches only intact detached data, then rejects clearing its associated launch settings', async () => {
  await call(channels.migrate, ['w'])
  const item = (await call(channels.data)).find((item: any) => item.workspaceIds.includes('w'))
  const directory = join(host.profile, 'janusx', 'workspaces')
  await rm(join(directory, 'w.json'))
  expect((await call(channels.data)).find((row: any) => row.id === item.id).status).toBe('detached')
  await writeFile(join(item.target, 'unknown.json'), 'keep')
  await expect(call(channels.cleanup, item.id, 'all')).rejects.toThrow('Unknown private file')
  expect((await call(channels.data)).find((row: any) => row.id === item.id).status).toBe('failed')
  await call(channels.restore, item.id)
  const restored = (await call(channels.data)).find((row: any) => row.id === item.id)
  expect(restored.status).toBe('associated'); expect(restored.workspaceIds).toHaveLength(1)
  expect(await readdir(directory)).toHaveLength(3)
  await expect(call(channels.cleanup, item.id, 'all')).rejects.toThrow('Remove the workspace')
  await expect(call(channels.restore, item.id)).rejects.toThrow('reattachment')
})
