import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, writeFile, readFile, rm, access, rename, realpath, utimes, readdir, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { workspaceIo, useWorkspaceStorage, configureWorkspaceStorageEvents } from '@janus-agent/agent-core'
import { WorkspaceStateStore, WORKSPACE_RETENTION_MS as AGE } from '../../src/main/storage/workspace-state'

const faults = vi.hoisted(() => ({ unlink: '', rmdir: '' }))
vi.mock('node:fs/promises', async original => {
  const actual = await original<typeof import('node:fs/promises')>()
  return { ...actual,
    unlink: async (path: string) => { if (faults.unlink && path.endsWith(faults.unlink)) throw new Error('test unlink failure'); return actual.unlink(path) },
    rmdir: async (path: string) => { if (faults.rmdir && path.endsWith(faults.rmdir)) throw new Error('test rmdir failure'); return actual.rmdir(path) },
  }
})
let base: string, cwd: string, profile: string, store: WorkspaceStateStore
const records = () => [{ id: 'w', name: 'Project', path: cwd }]
const gone = async (path: string) => expect(access(path)).rejects.toThrow()
beforeEach(async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), 'janus-lifecycle-')))
  cwd = join(base, 'project'); profile = join(base, 'profile')
  await mkdir(cwd); store = new WorkspaceStateStore(profile)
})
afterEach(async () => {
  faults.unlink = ''; faults.rmdir = ''; configureWorkspaceStorageEvents()
  await vi.waitFor(() => expect((workspaceIo as any).outstanding).toBe(0))
  await rm(base, { recursive: true, force: true })
})
async function registered() {
  const storage = await store.resolve(cwd, true)
  await store.sync(records())
  return { ...storage, id: (await store.data(records()))[0].id }
}
async function log(path: string, time: number) {
  await mkdir(join(path, 'logs'), { recursive: true })
  const file = join(path, 'logs', 'command.log')
  await writeFile(file, 'logs'); await utimes(file, new Date(time), new Date(time))
  return file
}

it('derives the last association, preserves original expiry after restart, and reattaches', async () => {
  const { id } = await registered(), now = Date.now()
  await store.sync([...records(), { ...records()[0], id: 'duplicate' }])
  const duplicate = [{ ...records()[0], id: 'duplicate' }]
  await store.sync(duplicate, now)
  expect((await store.data(duplicate))[0].status).toBe('associated')
  await store.sync([], now); store = new WorkspaceStateStore(profile)
  await store.sync([], now + AGE / 2)
  expect((await store.data([]))[0]).toMatchObject({ id, detachedAt: new Date(now).toISOString(), expiresAt: new Date(now + AGE).toISOString() })
  await store.sync(records())
  expect((await store.data(records()))[0]).toMatchObject({ id, status: 'associated' })
  expect((await store.data(records()))[0].detachedAt).toBeUndefined()
})

it('keeps offline records and tool storage, but separates a replaced directory', async () => {
  const original = await registered()
  await rename(cwd, join(base, 'moved')); await store.sync(records())
  expect((await store.data(records()))[0]).toMatchObject({ status: 'offline' })
  expect((await store.data(records()))[0].detachedAt).toBeUndefined()
  await mkdir(cwd); await store.sync(records())
  const items = await store.data(records())
  expect(items.find(item => item.id === original.id)).toMatchObject({ status: 'detached', workspaceIds: [] })
  expect(items.find(item => item.id !== original.id)?.workspaceIds).toEqual(['w'])
  const tool = join(base, 'tool'); await mkdir(tool)
  const toolRoot = (await store.resolve(tool, true)).root
  await store.sync([], Date.now() + AGE)
  expect(JSON.parse(await readFile(join(toolRoot, 'manifest.json'), 'utf8')).detachedAt).toBeUndefined()
})

it('recognizes ownership of a P2 registry entry during an offline upgrade', async () => {
  const storage = await store.resolve(cwd, true)
  await rename(cwd, join(base, 'offline'))
  store = new WorkspaceStateStore(profile); await store.sync(records())
  expect((await store.data(records()))[0].status).toBe('offline')
  await store.sync([])
  expect(JSON.parse(await readFile(join(storage.root, 'manifest.json'), 'utf8')).detachedAt).toBeTruthy()
})

it('relocates the same directory without copying and rejects a different directory', async () => {
  const { id, root } = await registered()
  const manifest = await readFile(join(root, 'manifest.json'), 'utf8')
  const moved = join(base, 'renamed'); await rename(cwd, moved)
  const commits = vi.fn(async () => {})
  await expect(store.relocate(id, base, commits)).rejects.toThrow('IDENTITY_MISMATCH')
  expect(commits).not.toHaveBeenCalled()
  await store.relocate(id, moved, commits)
  expect(commits).toHaveBeenCalledWith(cwd, moved)
  expect((await store.resolve(moved)).root).toBe(root)
  expect(JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'))).toEqual({ ...JSON.parse(manifest), path: moved })
})

it('repairs a partial relocation from its journal after restart', async () => {
  const { id, root } = await registered(), old = cwd, moved = join(base, 'renamed')
  await rename(cwd, moved)
  await expect(store.relocate(id, moved, async () => { throw new Error('partial record write') })).rejects.toThrow('partial')
  await expect(store.resolve(moved, true)).rejects.toThrow('relocation is pending')
  store = new WorkspaceStateStore(profile); store.completeRelocation = vi.fn(async () => {})
  await store.sync([{ ...records()[0], path: moved }, { id: 'other', name: 'Other', path: old }])
  expect(store.completeRelocation).toHaveBeenCalledWith(old, moved)
  expect((await store.resolve(moved)).root).toBe(root)
  expect(JSON.parse(await readFile(join(store.root, 'registry.json'), 'utf8')).entries[0].relocatingTo).toBeUndefined()
})

it('expires logs by metadata, keeps launch config and skips repeated scans before expiry', async () => {
  const { root, launchPath } = await registered(), now = Date.now()
  const file = await log(root, now - AGE - 1000); await writeFile(launchPath, 'config')
  expect(await store.maintain(records(), now)).toBeUndefined()
  await gone(file); expect(await readFile(launchPath, 'utf8')).toBe('config')
  const scan = vi.spyOn(store as any, 'retainSnapshots')
  await store.maintain(records(), now + 10); expect(scan).not.toHaveBeenCalled()
  await log(root, now); await store.resolve(cwd, true)
  const next = await store.maintain(records(), now + AGE - 1000)
  expect(Math.abs(next! - (now + AGE))).toBeLessThan(1000)
  await access(file)
})

it('uses the migration time once and ordinary upgrades do not extend expiry', async () => {
  const old = join(cwd, '.janusX'); await log(old, Date.now() - AGE * 2)
  await store.migrate(cwd)
  const storage = await store.resolve(cwd), start = Date.parse(storage.retentionStartedAt!)
  expect(await store.maintain(records(), start + 100)).toBeCloseTo(start + AGE, -1)
  store = new WorkspaceStateStore(profile); await store.maintain(records(), start + AGE + 100)
  await gone(join(storage.logsPath, 'command.log'))
  expect((await store.resolve(cwd)).retentionStartedAt).toBe(storage.retentionStartedAt)
})

it('preserves migration receipt copies until explicit legacy cleanup can finish', async () => {
  const old = join(cwd, '.janusX'); await log(old, Date.now() - AGE * 2)
  faults.unlink = 'command.log'
  await expect(store.migrate(cwd)).rejects.toThrow('unlink failure')
  faults.unlink = ''
  const storage = await store.resolve(cwd), future = Date.now() + AGE * 2
  await store.maintain(records(), future)
  await access(join(storage.logsPath, 'command.log'))
  await store.migrate(cwd)
  await store.maintain(records(), future)
  await gone(join(storage.logsPath, 'command.log'))
})

it('defers active descendants and blocks new users while deletion yields', async () => {
  const { id, root } = await registered(), now = Date.now()
  const file = await log(root, now - AGE - 1000), release = useWorkspaceStorage(join(cwd, 'child'))
  await store.maintain(records(), now)
  expect(store.hasDeferredMaintenance).toBe(true); await access(file)
  await expect(store.cleanup(id, 'logs')).rejects.toThrow('commands')
  release(); await store.maintain(records(), now); await gone(file)
  const original = (store as any).removeTree.bind(store)
  vi.spyOn(store as any, 'removeTree').mockImplementation(async (path: string) => {
    expect(() => useWorkspaceStorage(cwd)).toThrow('migration')
    await expect(store.resolve(cwd, true)).rejects.toThrow('migration')
    return original(path)
  })
  await store.cleanup(id, 'logs')
})

it('persists purge intent, prevents reattachment and resumes after final-directory interruption', async () => {
  const { id, root } = await registered(), now = Date.now()
  await writeFile(join(cwd, 'source.txt'), 'source'); await log(root, now); await store.sync([], now)
  faults.unlink = 'command.log'
  await expect(store.cleanup(id, 'all')).rejects.toThrow('unlink failure')
  store = new WorkspaceStateStore(profile)
  await expect(store.resolve(cwd, true)).rejects.toThrow('removal')
  await store.sync(records())
  await expect(store.relocate(id, cwd, async () => {})).rejects.toThrow('removal')
  faults.unlink = ''; faults.rmdir = id
  await expect(store.cleanup(id, 'all')).rejects.toThrow('rmdir failure')
  await rm(join(root, 'manifest.json'), { force: true }); faults.rmdir = ''; store = new WorkspaceStateStore(profile)
  await store.maintain([], now); await gone(root)
  expect(await store.data([])).toEqual([])
  expect(await readFile(join(cwd, 'source.txt'), 'utf8')).toBe('source')
})

it('preserves unknown files and redirected private data', async () => {
  const { id, root } = await registered(); await store.sync([])
  await writeFile(join(root, 'unknown.json'), 'keep')
  await expect(store.cleanup(id, 'all')).rejects.toThrow('Unknown private file')
  await access(join(root, 'unknown.json')); await rm(join(root, 'unknown.json'))
  await mkdir(join(base, 'outside')); await writeFile(join(base, 'outside', 'keep.log'), 'keep')
  await symlink(join(base, 'outside'), join(root, 'logs'), process.platform === 'win32' ? 'junction' : 'dir')
  await expect(store.cleanup(id, 'logs')).rejects.toThrow('Linked')
  expect(await readFile(join(base, 'outside', 'keep.log'), 'utf8')).toBe('keep')
})

it('expires detached private data without touching project or legacy files', async () => {
  const { root } = await registered(), now = Date.now()
  await mkdir(join(cwd, '.janusX')); await writeFile(join(cwd, '.janusX', 'unknown'), 'keep'); await store.sync([], now)
  expect(await store.maintain([], now + AGE - 1)).toBe(now + AGE); await access(root)
  await store.maintain([], now + AGE); await gone(root)
  expect(await readFile(join(cwd, '.janusX', 'unknown'), 'utf8')).toBe('keep')
})

it('retains five old snapshots and resumes interrupted orphan blob collection', async () => {
  const { root } = await registered(), now = Date.now(), directory = join(root, 'checkpoints')
  await mkdir(join(directory, 'blobs'), { recursive: true })
  for (let i = 0; i < 42; i++) {
    const hash = i.toString(16).padStart(40, '0')
    await writeFile(join(directory, `cp${i}.json`), JSON.stringify({ schemaVersion: 2, createdAt: new Date(now - AGE * 2 + i).toISOString(), filesSnapshot: { a: { hash } } }))
    await writeFile(join(directory, 'blobs', hash), 'content')
  }
  faults.unlink = '0'.repeat(40); await store.maintain(records(), now)
  expect((await readdir(directory)).filter(file => file.startsWith('cp'))).toHaveLength(5)
  faults.unlink = ''; store = new WorkspaceStateStore(profile); await store.maintain(records(), now)
  expect(await readdir(join(directory, 'blobs'))).toHaveLength(5)
  expect(JSON.parse(await readFile(join(directory, 'index.json'), 'utf8')).checkpointIds).toHaveLength(5)
})

it('caps fresh snapshots at forty and leaves malformed metadata and blobs untouched', async () => {
  const { root } = await registered(), now = Date.now(), directory = join(root, 'checkpoints')
  await mkdir(join(directory, 'blobs'), { recursive: true })
  for (let i = 0; i < 42; i++) await writeFile(join(directory, `cp${i}.json`), JSON.stringify({ schemaVersion: 2, createdAt: new Date(now + i).toISOString(), filesSnapshot: {} }))
  await store.maintain(records(), now)
  expect((await readdir(directory)).filter(file => file.startsWith('cp'))).toHaveLength(40)
  await writeFile(join(directory, 'unknown.json'), JSON.stringify({ schemaVersion: 3 }))
  const blob = join(directory, 'blobs', 'f'.repeat(40)); await writeFile(blob, 'keep')
  store = new WorkspaceStateStore(profile); await store.maintain(records(), now + AGE * 2)
  await access(blob)
  expect((await readdir(directory)).filter(file => file.startsWith('cp'))).toHaveLength(40)
  expect((await store.data(records()))[0]).toMatchObject({ status: 'failed', error: expect.stringContaining('Unknown snapshot') })
})

it('yields large cleanup batches to foreground work in another workspace', async () => {
  const { root, id } = await registered(); await mkdir(join(root, 'logs'))
  for (let i = 0; i < 96; i++) await writeFile(join(root, 'logs', `${i}.log`), 'x')
  const events: string[] = []
  const cleanup = store.cleanup(id, 'logs').then(() => { events.push('cleanup') })
  const foreground = workspaceIo.run(join(base, 'another'), async () => { events.push('foreground') })
  await Promise.all([cleanup, foreground]); expect(events).toEqual(['foreground', 'cleanup'])
})
