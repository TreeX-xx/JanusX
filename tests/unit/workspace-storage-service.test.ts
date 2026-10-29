import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

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
afterEach(async () => { await rm(base, { recursive: true, force: true }) })

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
