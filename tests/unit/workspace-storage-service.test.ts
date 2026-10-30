import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { useWorkspaceStorage, configureWorkspaceStorageEvents, workspaceIo } from '@janus-agent/agent-core'

const host = vi.hoisted(() => ({ profile: '', terminals: [] as any[], tasks: new Map<string, any>() }))
vi.mock('electron', () => ({ app: { getPath: () => host.profile } }))
vi.mock('../../src/main/terminal/manager', () => ({ terminalManager: { listInstances: () => host.terminals } }))
vi.mock('../../src/main/project/runner/service', () => ({ getProjectRunner: () => ({ getAllRunning: () => host.tasks }) }))
let base: string, cwd: string
beforeEach(async () => {
  vi.resetModules(); host.terminals = []; host.tasks.clear()
  base = await realpath(await mkdtemp(join(tmpdir(), 'janus-storage-service-')))
  cwd = join(base, 'project'); host.profile = join(base, 'profile')
  await mkdir(join(cwd, '.janusX'), { recursive: true })
  await writeFile(join(cwd, '.janusX/janusX.launch.json'), JSON.stringify({ configurations: [] }))
})
afterEach(async () => {
  vi.clearAllTimers(); vi.useRealTimers(); configureWorkspaceStorageEvents()
  await vi.waitFor(() => expect((workspaceIo as any).outstanding).toBe(0))
  await rm(base, { recursive: true, force: true })
})

it('refuses active child terminals and allows migration after they exit', async () => {
  const { workspaceStateStore } = await import('../../src/main/storage/service')
  host.terminals = [{ status: 'running', config: { cwd: join(cwd, 'src') } }]
  await expect(workspaceStateStore().migrate(cwd)).rejects.toThrow('Close workspace terminals')
  host.terminals[0].status = 'exited'
  await workspaceStateStore().migrate(cwd)
  expect((await workspaceStateStore().inspect(cwd, 'w', 'p')).status).toBe('migrated')
})

it('refuses running launch tasks even when their config has no explicit cwd', async () => {
  const { workspaceStateStore } = await import('../../src/main/storage/service')
  host.tasks.set(`${cwd}::dev::123`, { config: {} })
  await expect(workspaceStateStore().migrate(cwd)).rejects.toThrow('Close workspace terminals')
  host.tasks.clear()
  await workspaceStateStore().migrate(cwd)
})

it('coalesces notifications and schedules only the next expiry without rescanning on every release', async () => {
  const service = await import('../../src/main/storage/service')
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  const store = service.workspaceStateStore(), start = Date.now()
  const maintain = vi.spyOn(store, 'maintain').mockResolvedValue(start + 10_000)
  service.startWorkspaceMaintenance(async () => [])
  await vi.waitFor(() => expect(maintain).toHaveBeenCalledTimes(1))
  await vi.advanceTimersByTimeAsync(0)
  for (let i = 0; i < 20; i++) useWorkspaceStorage(cwd)()
  await vi.advanceTimersByTimeAsync(9000)
  expect(maintain).toHaveBeenCalledTimes(1)
  maintain.mockResolvedValue(undefined)
  await vi.advanceTimersByTimeAsync(1000)
  await vi.waitFor(() => expect(maintain).toHaveBeenCalledTimes(2))
  await vi.advanceTimersByTimeAsync(60_000)
  expect(maintain).toHaveBeenCalledTimes(2)
})

it('retries deferred work on release without repeatedly polling an already expired time', async () => {
  const service = await import('../../src/main/storage/service'), store = service.workspaceStateStore()
  const maintain = vi.spyOn(store, 'maintain').mockImplementation(async () => { store.hasDeferredMaintenance = true; return undefined })
  service.startWorkspaceMaintenance(async () => [])
  await vi.waitFor(() => expect(maintain).toHaveBeenCalledTimes(1))
  useWorkspaceStorage(cwd)()
  await vi.waitFor(() => expect(maintain).toHaveBeenCalledTimes(2))
  store.hasDeferredMaintenance = false
})
