import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { parsePluginManifest, validatePluginCall } from '../../packages/plugin-sdk/src'
import { PluginService } from '../../src/main/plugins/service'

const cleanup: Array<() => Promise<unknown>> = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'plugin-handoff-'))
  cleanup.push(() => rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }))
  const root = join(directory, 'project'), source = join(directory, 'source'), profile = join(root, 'private-host')
  await mkdir(root); await mkdir(source); await mkdir(profile); await mkdir(join(source, 'dist'))
  const data = JSON.parse(await readFile('packages/plugin-sdk/template/manifest.json', 'utf8'))
  data.permissions.push({ name: 'ui.workspace' }); data.capabilities.required.push('workspace.handoff')
  const manifest = parsePluginManifest(JSON.stringify(data))
  await writeFile(join(source, 'manifest.json'), JSON.stringify(manifest))
  await writeFile(join(source, 'dist/index.html'), '<p>Handoff</p>')
  await writeFile(join(source, 'dist/summary.html'), '<p>Handoff</p>')
  const content = 'Original Note', hash = createHash('sha256').update(content).digest('hex')
  await writeFile(join(root, 'README.md'), content)
  const event = vi.fn(), handoff = vi.fn()
  const service = new PluginService({ directory: join(directory, 'state'), protectedDirectories: [profile],
    resolveProject: async () => ({ root, name: 'Project' }), changed() {}, event, workspaceHandoff: handoff, openView() {}, toast() {} })
  cleanup.push(() => service.dispose())
  await service.initialize(); await service.setDevelopment(true); await service.import(source, 'linked'); await service.enable(manifest.id, ['project'])
  await service.setContext('project', root, 'en', { id: 'dark', tokens: {} })
  const page = await service.mount(manifest.id, 'details', 'project', root); service.bind(page.instanceId, page.binding)
  const call = (method: string, params: unknown) => service.call(page.instanceId, page.binding, { protocol: 1, type: 'request', requestId: randomUUID(), method, params, contextRevision: page.context.revision }) as Promise<any>
  return { service, page, call, event, handoff, hash, root, directory, manifest }
}

it('opens only the requested file version and keeps canonical paths off the plugin port', async () => {
  const f = await fixture()
  expect(await f.call('workspace.openDocument', { path: 'README.md', expectedVersion: f.hash })).toMatchObject({ ok: true, result: { requested: true } })
  expect(f.handoff).toHaveBeenCalledWith({ type: 'openDocument', pluginId: f.manifest.id, projectId: 'project', root: f.root, path: 'README.md' })
  expect(f.event.mock.calls.some(call => JSON.stringify(call).includes(f.root))).toBe(false)
  expect((await f.call('workspace.openDocument', { path: 'README.md', expectedVersion: f.hash })).error.code).toBe('RATE_LIMITED')
})

it('rejects changed source, inactive pages, undeclared handoffs and terminal control sequences', async () => {
  const f = await fixture()
  await writeFile(join(f.root, 'README.md'), 'External edit')
  expect((await f.call('workspace.openDocument', { path: 'README.md', expectedVersion: f.hash })).error.code).toBe('RESOURCE_CHANGED')
  for (const text of ['\x1b[201~danger', '\x03', '\x85', '']) expect((await f.call('workspace.proposeTerminal', { text })).error.code).toBe('INVALID_REQUEST')
  f.service.active(f.page.instanceId, f.page.binding, false)
  expect((await f.call('workspace.proposeTerminal', { text: 'Read the project' })).error.code).toBe('CONTEXT_UNAVAILABLE')
  const denied = { ...f.manifest, permissions: f.manifest.permissions.filter(item => item.name !== 'ui.workspace') }
  expect(() => validatePluginCall(denied, 'workspace.proposeTerminal', { text: 'Read the project' })).toThrow()
  expect(f.handoff).not.toHaveBeenCalled()
})

it.each(['../outside.txt', '.env', 'private-host/secret.txt', 'linked/outside.txt'])('rejects outside, sensitive and host data path %s', async path => {
  const f = await fixture()
  await writeFile(join(f.directory, 'outside.txt'), 'Original Note')
  await writeFile(join(f.root, 'private-host/secret.txt'), 'Original Note')
  await symlink(f.directory, join(f.root, 'linked'), 'junction')
  expect((await f.call('workspace.openDocument', { path, expectedVersion: f.hash })).ok).toBe(false)
  expect(f.handoff).not.toHaveBeenCalled()
})

it('proposes only an editable host draft, without launching a terminal or exposing a command API', async () => {
  const f = await fixture()
  expect(await f.call('workspace.proposeTerminal', { text: 'Goal\nRead and implement the Note.' })).toMatchObject({ ok: true, result: { proposed: true } })
  expect(f.handoff).toHaveBeenCalledWith(expect.objectContaining({ type: 'terminalDraft', projectId: 'project', text: 'Goal\nRead and implement the Note.' }))
  expect((await f.call('workspace.proposeTerminal', { text: 'Another task' })).error.code).toBe('RATE_LIMITED')
  expect((await f.call('terminal.execute', { command: 'arbitrary' })).error.code).toBe('UNKNOWN_METHOD')
})
