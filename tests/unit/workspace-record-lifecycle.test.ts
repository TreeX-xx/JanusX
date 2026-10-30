import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, readFile, readdir, rm, realpath, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { workspaceIo } from '@janus-agent/agent-core'
import { WORKSPACE_CHANNELS as channels } from '../../src/shared/ipc/workspace'
import { WorkspaceStateStore } from '../../src/main/storage/workspace-state'

const host = vi.hoisted(() => ({ profile: '', handlers: new Map<string, (...args: any[]) => Promise<any>>() }))
vi.mock('electron', () => ({ app: { getPath: () => host.profile }, ipcMain: { handle: (id: string, fn: any) => host.handlers.set(id, fn) }, BrowserWindow: class {}, dialog: {}, shell: {} }))
let base: string, cwd: string, store: WorkspaceStateStore
const call = (channel: string, ...args: any[]) => host.handlers.get(channel)!({}, ...args)
beforeEach(async () => {
  vi.resetModules(); host.handlers.clear()
  base = await realpath(await mkdtemp(join(tmpdir(), 'janus-record-lifecycle-')))
  cwd = join(base, 'project'); host.profile = join(base, 'profile'); await mkdir(cwd)
  store = new WorkspaceStateStore(host.profile)
})
afterEach(async () => {
  await vi.waitFor(() => expect((workspaceIo as any).outstanding).toBe(0))
  await rm(base, { recursive: true, force: true })
})
async function register(failSync = false) {
  const events: string[] = []
  const { registerWorkspaceHandlers } = await import('../../src/main/ipc/handlers')
  registerWorkspaceHandlers(() => null, {
    authorizeRendererAction: async () => true,
    beforeWorkspaceDelete: async () => {
      await workspaceIo.run(cwd, async () => { events.push('flushed') })
    },
    storageChanged: async () => {
      if (failSync) throw new Error('registry unavailable')
      const directory = join(host.profile, 'janusx', 'workspaces')
      const records = []
      for (const file of await readdir(directory)) records.push(JSON.parse(await readFile(join(directory, file), 'utf8')))
      await store.sync(records); events.push('sync')
    },
  })
  return events
}

it('flushes task I/O before acquiring the deletion transaction and starts only the last association countdown', async () => {
  const events = await register(), storage = await store.resolve(cwd, true)
  const first = await call(channels.create, { name: 'First', path: cwd })
  const second = await call(channels.create, { name: 'Second', path: cwd })
  expect(await call(channels.delete, first.id)).toEqual({ success: true })
  expect(JSON.parse(await readFile(join(storage.root, 'manifest.json'), 'utf8')).detachedAt).toBeUndefined()
  expect(await call(channels.delete, second.id)).toEqual({ success: true })
  expect(JSON.parse(await readFile(join(storage.root, 'manifest.json'), 'utf8')).detachedAt).toBeTruthy()
  expect(events).toEqual(['sync', 'sync', 'flushed', 'sync', 'flushed', 'sync'])
  await access(cwd)
})

it('keeps display rename separate from a directory relocation and retains storage identity', async () => {
  await register(); const storage = await store.resolve(cwd, true)
  const first = await call(channels.create, { name: 'First', path: cwd })
  const updated = await call(channels.update, first.id, { name: 'Renamed', path: base })
  expect(updated).toMatchObject({ name: 'Renamed', path: cwd })
  expect((await store.resolve(cwd)).root).toBe(storage.root)
})

it('does not report an already committed deletion as failed when lifecycle sync fails', async () => {
  await register(true)
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  try {
    const first = await call(channels.create, { name: 'First', path: cwd })
    expect(await call(channels.delete, first.id)).toEqual({ success: true })
    await expect(access(join(host.profile, 'janusx', 'workspaces', `${first.id}.json`))).rejects.toThrow()
    expect(error).toHaveBeenCalled()
  } finally { error.mockRestore() }
})
