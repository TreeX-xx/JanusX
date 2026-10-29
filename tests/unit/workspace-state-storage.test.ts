import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, access, rename, symlink, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { createHash } from 'node:crypto'
import { configureWorkspaceStorage, resolveWorkspaceStorage, CheckpointManager, workspaceIo, useWorkspaceStorage, commandLogReadTool, assertWorkspaceStorageAvailable } from '@janus-agent/agent-core'
import { WorkspaceStateStore } from '../../src/main/storage/workspace-state'
import ProjectConfig from '../../src/main/project/config/project-config'
import { ProjectType } from '../../src/shared/ipc/project'
import { ProjectRunner } from '../../src/main/project/runner/runner'

const faults = vi.hoisted(() => ({ unlink: '' }))
vi.mock('node:fs/promises', async original => {
  const actual = await original<typeof import('node:fs/promises')>()
  return { ...actual, unlink: async (path: string) => {
    if (faults.unlink && path.endsWith(faults.unlink)) throw Object.assign(new Error('simulated cleanup failure'), { code: 'EACCES' })
    return actual.unlink(path)
  } }
})

let base: string, cwd: string, profile: string
const launch = { version: '0.1.0', projectName: 'fixture', projectType: ProjectType.Custom, configurations: [] }
beforeEach(async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), 'janus-storage-')))
  cwd = join(base, 'project'); profile = join(base, 'profile')
  await mkdir(cwd); faults.unlink = ''
})
afterEach(async () => {
  faults.unlink = ''; configureWorkspaceStorage()
  await vi.waitFor(() => expect((workspaceIo as unknown as { outstanding: number }).outstanding).toBe(0))
  if (!relative(await realpath(tmpdir()), base).startsWith('janus-storage-')) throw new Error('Unexpected test fixture')
  await rm(base, { recursive: true, force: true })
})
async function legacy() {
  const old = join(cwd, '.janusX')
  await mkdir(join(old, 'logs'), { recursive: true })
  await writeFile(join(old, 'janusX.launch.json'), JSON.stringify(launch))
  await writeFile(join(old, 'logs', 'cmd-old.log'), 'old command output')
  return old
}
const noFile = async (path: string) => expect(access(path)).rejects.toThrow()

describe('profile workspace storage and explicit legacy migration', () => {
  it('discovers without disk writes, persists new identity only on first write, and survives restart', async () => {
    let store = new WorkspaceStateStore(profile)
    const first = await store.resolve(cwd)
    expect(first.root).toContain('workspace-state')
    await noFile(profile); await noFile(join(cwd, '.janusX'))
    await store.resolve(cwd, true)
    store = new WorkspaceStateStore(profile)
    expect((await store.resolve(cwd)).root).toBe(first.root)
    expect((await store.inspect(cwd, 'w', 'Renamed display')).target).toBe(first.root)
  })

  it('keeps old storage until explicit migration, verifies copy, switches and removes empty legacy folders', async () => {
    const old = await legacy(), store = new WorkspaceStateStore(profile)
    expect((await store.resolve(cwd)).root).toBe(old)
    const item = await store.inspect(cwd, 'w', 'project')
    expect(item.status).toBe('pending'); expect(item.categories).toEqual(['janusX.launch.json', 'logs'])
    await noFile(profile)
    await store.migrate(cwd)
    const target = await store.resolve(cwd)
    expect(target.root).toBe(item.target)
    expect(JSON.parse(await readFile(target.launchPath, 'utf8'))).toEqual(launch)
    expect(await readFile(join(target.logsPath, 'cmd-old.log'), 'utf8')).toBe('old command output')
    await noFile(old)
    expect((await new WorkspaceStateStore(profile).inspect(cwd, 'w', 'project')).status).toBe('migrated')
  })

  it('preserves unknown files, Hook assets and unrecognized files inside supported folders', async () => {
    const old = await legacy(), store = new WorkspaceStateStore(profile)
    await mkdir(join(old, 'hooks')); await writeFile(join(old, 'hooks', 'sender.js'), 'hook')
    await writeFile(join(old, 'custom.txt'), 'user data'); await writeFile(join(old, 'logs', 'unknown.txt'), 'keep')
    await mkdir(join(old, 'logs', 'unknown', 'empty'), { recursive: true })
    await symlink(base, join(old, 'logs', 'unknown', 'linked'), process.platform === 'win32' ? 'junction' : 'dir')
    await store.migrate(cwd)
    expect(await readFile(join(old, 'custom.txt'), 'utf8')).toBe('user data')
    expect(await readFile(join(old, 'hooks', 'sender.js'), 'utf8')).toBe('hook')
    expect(await readFile(join(old, 'logs', 'unknown.txt'), 'utf8')).toBe('keep')
    await noFile(join((await store.resolve(cwd)).logsPath, 'unknown.txt'))
    await access(join(old, 'logs/unknown/empty'))
  })

  it('resumes interrupted copies after restart without deleting sources or overwriting conflicts', async () => {
    const old = await legacy(), store = new WorkspaceStateStore(profile)
    const digest = (store as any).digest.bind(store)
    vi.spyOn(store as any, 'digest').mockImplementation(async (path: string, target?: string) => {
      if (target?.includes('cmd-old.log')) throw new Error('disk full')
      return digest(path, target)
    })
    await expect(store.migrate(cwd)).rejects.toThrow('disk full')
    expect((await store.resolve(cwd)).root).toBe(old)
    expect(await readFile(join(old, 'logs', 'cmd-old.log'), 'utf8')).toBe('old command output')
    const fresh = new WorkspaceStateStore(profile)
    await fresh.migrate(cwd)
    expect((await fresh.inspect(cwd, 'w', 'p')).status).toBe('migrated')
  })

  it('retains both sides of a conflicting destination', async () => {
    const old = await legacy(), store = new WorkspaceStateStore(profile)
    const item = await store.inspect(cwd, 'w', 'p')
    await mkdir(item.target, { recursive: true }); await writeFile(join(item.target, 'launch.json'), 'newer')
    await expect(store.migrate(cwd)).rejects.toThrow('conflict')
    expect(await readFile(join(item.target, 'launch.json'), 'utf8')).toBe('newer')
    expect((await store.resolve(cwd)).root).toBe(old)
  })

  it('yields during a large log migration so a foreground operation in another workspace can run', async () => {
    const old = await legacy(), store = new WorkspaceStateStore(profile), events: string[] = []
    await writeFile(join(old, 'logs', 'cmd-old.log'), Buffer.alloc(256 * 1024, 120))
    const digest = (store as any).digest.bind(store)
    let foreground: Promise<void> | undefined
    vi.spyOn(store as any, 'digest').mockImplementation(async (path: string, target?: string) => {
      if (!foreground && target?.includes('cmd-old.log')) {
        foreground = workspaceIo.run(join(base, 'another-workspace'), async () => { events.push('foreground') })
      }
      return digest(path, target)
    })
    await store.migrate(cwd); events.push('migrated'); await foreground
    expect(events).toEqual(['foreground', 'migrated'])
    expect(await readFile(join((await store.resolve(cwd)).logsPath, 'cmd-old.log'))).toHaveLength(256 * 1024)
  })

  it('commits before cleanup, retries cleanup only and never resets retention or resurrects old data', async () => {
    const old = await legacy(), store = new WorkspaceStateStore(profile)
    faults.unlink = 'cmd-old.log'
    await expect(store.migrate(cwd)).rejects.toThrow('cleanup failure')
    const first = await store.resolve(cwd)
    expect(first.root).not.toBe(old); expect(first.retentionStartedAt).toBeTruthy()
    expect((await store.inspect(cwd, 'w', 'p')).status).toBe('cleanup-pending')
    await writeFile(first.launchPath, 'updated after switch')
    faults.unlink = ''
    const fresh = new WorkspaceStateStore(profile)
    await fresh.migrate(cwd)
    const second = await fresh.resolve(cwd)
    expect(second.retentionStartedAt).toBe(first.retentionStartedAt)
    expect(await readFile(second.launchPath, 'utf8')).toBe('updated after switch')
    await noFile(old)
    await fresh.migrate(cwd)
    expect((await fresh.resolve(cwd)).retentionStartedAt).toBe(first.retentionStartedAt)
  })

  it('rejects changed sources before committing and retains every original', async () => {
    const old = await legacy(), store = new WorkspaceStateStore(profile)
    const digest = (store as any).digest.bind(store)
    let changed = false
    vi.spyOn(store as any, 'digest').mockImplementation(async (path: string, target?: string) => {
      const result = await digest(path, target)
      if (!changed && target?.endsWith('.migration-tmp')) { changed = true; await writeFile(path, 'changed during copy') }
      return result
    })
    await expect(store.migrate(cwd)).rejects.toThrow()
    expect((await store.resolve(cwd)).root).toBe(old)
    await access(join(old, 'janusX.launch.json'))
  })

  it('retains malformed launch data and incomplete checkpoint references', async () => {
    const old = await legacy(), store = new WorkspaceStateStore(profile)
    await writeFile(join(old, 'janusX.launch.json'), '{bad')
    await expect(store.migrate(cwd)).rejects.toThrow()
    expect((await store.resolve(cwd)).root).toBe(old)
    await writeFile(join(old, 'janusX.launch.json'), JSON.stringify(launch))
    // The previous copied invalid file is a conflict, rather than silently overwritten on retry.
    const target = (await store.inspect(cwd, 'w', 'p')).target
    await rm(join(target, 'launch.json'))
    await mkdir(join(old, 'checkpoints'))
    await writeFile(join(old, 'checkpoints', 'cp.json'), JSON.stringify({ id: 'cp', terminalId: 't', conversationIndex: 1, createdAt: '2020-01-01', engine: 'manual', branch: 'main', prompt: '', schemaVersion: 2, filesSnapshot: { a: { hash: 'a'.repeat(40) } } }))
    await expect(store.migrate(cwd)).rejects.toThrow('missing blob')
    await access(join(old, 'checkpoints', 'cp.json'))
  })

  it('keeps an offline directory distinct from a new project replacing the same path', async () => {
    const store = new WorkspaceStateStore(profile)
    const initial = await store.resolve(cwd, true)
    await rename(cwd, join(base, 'moved')); await mkdir(cwd)
    expect((await store.resolve(cwd, true)).root).not.toBe(initial.root)
    expect((await store.inspect(join(base, 'missing'), 'w', 'offline')).status).toBe('offline')
  })

  it('discards cached checkpoints when a different directory replaces the same path', async () => {
    const store = new WorkspaceStateStore(profile), manager = new CheckpointManager()
    configureWorkspaceStorage((path, write) => store.resolve(path, write))
    await writeFile(join(cwd, 'a.txt'), 'old project')
    const old = await manager.createCheckpoint({ cwd, terminalId: 't', engine: 'manual', prompt: 'old project' })
    await vi.waitFor(() => expect((workspaceIo as unknown as { outstanding: number }).outstanding).toBe(0))
    await rename(cwd, join(base, 'moved')); await mkdir(cwd)
    expect(await manager.listCheckpoints({ cwd })).toEqual([])
    await expect(manager.restoreCheckpoint(old.id, cwd)).rejects.toThrow()
  })

  it('shares migration gates and checkpoint cache identity through directory aliases', async () => {
    await legacy()
    const alias = join(base, 'alias'); await symlink(cwd, alias, process.platform === 'win32' ? 'junction' : 'dir')
    const store = new WorkspaceStateStore(profile)
    const release = useWorkspaceStorage(alias)
    await expect(store.migrate(cwd)).rejects.toThrow('commands'); release()
    configureWorkspaceStorage((path, write) => store.resolve(path, write))
    const manager = new CheckpointManager()
    await manager.initialize(alias)
    await store.migrate(cwd)
    await writeFile(join(cwd, 'a.txt'), 'after migration')
    await manager.createCheckpoint({ cwd: alias, terminalId: 't', engine: 'manual', prompt: 'alias' })
    await noFile(join(cwd, '.janusX'))
    expect(await manager.listCheckpoints({ cwd })).toHaveLength(1)
  })

  it('refuses unknown storage schema and leaves legacy data intact', async () => {
    const old = await legacy(), store = new WorkspaceStateStore(profile)
    const item = await store.inspect(cwd, 'w', 'p')
    await mkdir(item.target, { recursive: true })
    await writeFile(join(item.target, 'manifest.json'), JSON.stringify({ schema: 2, storageId: item.target.split(/[\\/]/).at(-1), path: cwd }))
    await expect(store.migrate(cwd)).rejects.toThrow('manifest')
    await access(join(old, 'janusX.launch.json'))
    expect(JSON.parse(await readFile(join(item.target, 'manifest.json'), 'utf8')).schema).toBe(2)
  })

  it('isolates profiles and worktrees, and persists notice dismissal without tying it to app version', async () => {
    const store = new WorkspaceStateStore(profile), other = join(base, 'worktree')
    await mkdir(other)
    const initial = await store.resolve(cwd, true)
    expect((await store.resolve(other, true)).root).not.toBe(initial.root)
    expect((await new WorkspaceStateStore(join(base, 'other-profile')).resolve(cwd)).root).not.toBe(initial.root)
    expect(await store.promptDismissed()).toBe(false)
    await store.dismissPrompt()
    expect(await new WorkspaceStateStore(profile).promptDismissed()).toBe(true)
  })

  it('rejects redirected source and destination directories without touching linked contents', async () => {
    const outside = join(base, 'outside'); await mkdir(outside)
    await writeFile(join(outside, 'janusX.launch.json'), JSON.stringify(launch))
    await symlink(outside, join(cwd, '.janusX'), process.platform === 'win32' ? 'junction' : 'dir')
    const store = new WorkspaceStateStore(profile)
    await expect(store.migrate(cwd)).rejects.toThrow('Linked')
    await access(join(outside, 'janusX.launch.json'))
  })

  it('refuses migration while a command writer holds storage', async () => {
    await legacy()
    const store = new WorkspaceStateStore(profile), release = useWorkspaceStorage(cwd)
    await expect(store.migrate(cwd)).rejects.toThrow('commands')
    release(); await store.migrate(cwd)
  })

  it('blocks new commands during migration and serializes same-workspace config writes after switching', async () => {
    await legacy()
    let signal!: () => void, resume!: () => void
    const entered = new Promise<void>(resolve => { signal = resolve })
    const pause = new Promise<void>(resolve => { resume = resolve })
    const store = new WorkspaceStateStore(profile, async () => { signal(); await pause })
    configureWorkspaceStorage((path, write) => store.resolve(path, write))
    const migrating = store.migrate(cwd)
    await entered
    expect(() => assertWorkspaceStorageAvailable(cwd)).toThrow('migration')
    expect(() => assertWorkspaceStorageAvailable(join(cwd, 'src'))).toThrow('migration')
    const writing = ProjectConfig.write(cwd, { ...launch, projectName: 'after migration' })
    resume()
    await migrating; await writing
    expect((await ProjectConfig.read(cwd))?.projectName).toBe('after migration')
    expect(() => assertWorkspaceStorageAvailable(cwd)).not.toThrow()
    await noFile(join(cwd, '.janusX'))
  })

  it('preserves historical creation dates but restarts age retention exactly once for migrated checkpoints', async () => {
    await legacy()
    const before = new CheckpointManager()
    await writeFile(join(cwd, 'source.txt'), 'restorable')
    const cp = await before.createCheckpoint({ cwd, terminalId: 't', engine: 'manual', prompt: 'old' })
    await vi.waitFor(() => expect((workspaceIo as unknown as { outstanding: number }).outstanding).toBe(0))
    const old = join(cwd, '.janusX/checkpoints')
    for (let i = 0; i < 7; i++) {
      const record = { ...cp, id: `old-${i}`, conversationIndex: i + 1, createdAt: `2020-01-0${i + 1}T00:00:00Z` }
      await writeFile(join(old, `${record.id}.json`), JSON.stringify(record))
    }
    await rm(join(old, `${cp.id}.json`))
    const manager = new CheckpointManager(), store = new WorkspaceStateStore(profile, async path => { before.releaseWorkspace(path); manager.releaseWorkspace(path) })
    await store.migrate(cwd)
    configureWorkspaceStorage((path, write) => store.resolve(path, write))
    expect((await manager.listCheckpoints({ cwd })).every(item => item.createdAt.startsWith('2020'))).toBe(true)
    await manager.createCheckpoint({ cwd, terminalId: 't', engine: 'manual', prompt: 'new' })
    expect(await manager.listCheckpoints({ cwd })).toHaveLength(8)
    const started = (await store.resolve(cwd)).retentionStartedAt
    expect((await new WorkspaceStateStore(profile).resolve(cwd)).retentionStartedAt).toBe(started)
    await writeFile(join(cwd, 'source.txt'), 'changed after migration')
    const restarted = new CheckpointManager()
    await restarted.restoreCheckpoint('old-0', cwd)
    expect(await readFile(join(cwd, 'source.txt'), 'utf8')).toBe('restorable')
  })

  it('rejects linked destination children before writing outside the storage root', async () => {
    await legacy()
    const store = new WorkspaceStateStore(profile), outside = join(base, 'outside')
    await mkdir(outside)
    const item = await store.inspect(cwd, 'w', 'p')
    await mkdir(item.target, { recursive: true })
    await symlink(outside, join(item.target, 'logs'), process.platform === 'win32' ? 'junction' : 'dir')
    await expect(store.migrate(cwd)).rejects.toThrow('Linked')
    expect(await readdir(outside)).toEqual([])
    await access(join(cwd, '.janusX/logs/cmd-old.log'))
  })

  it('uses new paths for launch config, real checkpoint restore and bounded private log reads', async () => {
    const manager = new CheckpointManager(), store = new WorkspaceStateStore(profile, async path => manager.releaseWorkspace(path))
    configureWorkspaceStorage((path, write) => store.resolve(path, write))
    await ProjectConfig.write(cwd, launch)
    expect(await ProjectConfig.read(cwd)).toEqual(expect.objectContaining({ projectName: 'fixture' }))
    await writeFile(join(cwd, 'a.txt'), 'original')
    const cp = await manager.createCheckpoint({ cwd, terminalId: 't', engine: 'manual', prompt: 'capture' })
    await writeFile(join(cwd, 'a.txt'), 'changed')
    await manager.restoreCheckpoint(cp.id, cwd)
    expect(await readFile(join(cwd, 'a.txt'), 'utf8')).toBe('original')
    const storage = await resolveWorkspaceStorage(cwd)
    await mkdir(storage.logsPath); await writeFile(join(storage.logsPath, 'cmd-x.log'), '123456789')
    const context = { workspaceId: 'w', workspaceRoot: cwd, signal: new AbortController().signal }
    expect(await commandLogReadTool.execute({ workspaceId: 'w', logId: 'cmd-x.log', maxBytes: 4 }, context)).toMatchObject({ text: '1234', nextOffset: 4, truncated: true })
    await expect(commandLogReadTool.execute({ workspaceId: 'w', logId: '../manifest.json' }, context)).rejects.toThrow()
    await expect(commandLogReadTool.execute({ workspaceId: 'other', logId: 'cmd-x.log' }, context)).rejects.toThrow()
    const outside = join(base, 'outside-logs'); await mkdir(outside)
    await writeFile(join(outside, 'cmd-x.log'), 'outside private content')
    await rename(storage.logsPath, `${storage.logsPath}-original`)
    await symlink(outside, storage.logsPath, process.platform === 'win32' ? 'junction' : 'dir')
    await expect(commandLogReadTool.execute({ workspaceId: 'w', logId: 'cmd-x.log' }, context)).rejects.toThrow('Linked')
    await noFile(join(cwd, '.janusX'))
  })

  it('keeps shell background logs under the workspace storage even with a child cwd', async () => {
    const store = new WorkspaceStateStore(profile), runner = new ProjectRunner(5)
    configureWorkspaceStorage((path, write) => store.resolve(path, write))
    const child = join(cwd, 'src'); await mkdir(child)
    const started = await runner.runAdhoc({ cwd: child, storageRoot: cwd, program: process.execPath, args: ['-e', 'setTimeout(()=>console.log("shell-private-log"),150)'] })
    try {
      await expect(store.migrate(cwd)).rejects.toThrow('commands')
      await vi.waitFor(() => expect(runner.getExited(started.projectId)).not.toBeNull())
      await vi.waitFor(() => expect((workspaceIo as unknown as { outstanding: number }).outstanding).toBe(0))
      expect(await readFile(started.logPath!, 'utf8')).toContain('shell-private-log')
      expect(started.logPath!.startsWith((await store.resolve(cwd)).logsPath)).toBe(true)
      await noFile(join(cwd, '.janusX')); await noFile(join(child, '.janusX'))
    } finally { if (runner.getRunning(started.projectId)) await runner.stop(started.projectId) }
  })

  it('inherits a private launch config into a worktree while resolving relative cwd inside that worktree', async () => {
    const store = new WorkspaceStateStore(profile), runner = new ProjectRunner(5)
    configureWorkspaceStorage((path, write) => store.resolve(path, write))
    const worktree = join(base, 'worktree'); await mkdir(join(worktree, 'src'), { recursive: true })
    await ProjectConfig.write(cwd, { ...launch, configurations: [{ name: 'dev', type: ProjectType.Custom, request: 'launch', program: process.execPath, args: ['-e', 'setTimeout(()=>{},60000)'], cwd: 'src' }] })
    try {
      const handle = await runner.run(worktree, 'dev', { inheritFrom: cwd })
      expect(handle.config.cwd).toBe('src')
      expect((await store.resolve(worktree)).root).not.toBe((await store.resolve(cwd)).root)
      await noFile(join(cwd, '.janusX')); await noFile(join(worktree, '.janusX'))
    } finally { await runner.stopAll(500) }
  })
})
