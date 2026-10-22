import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink, link, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { PluginService } from '../../src/main/plugins/service'
import { readPluginFile, readPluginPackage } from '../../src/main/plugins/files'
import { createPluginClient } from '../../packages/plugin-sdk/src/client'
import { PluginStorage } from '../../src/main/plugins/storage'

const cleanups: Array<() => Promise<unknown> | void> = []
afterEach(async () => { vi.useRealTimers(); for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'janusx-p2-unit-'))
  cleanups.push(() => rm(directory, { recursive: true, force: true }))
  const source = join(directory, 'source')
  await mkdir(join(source, 'dist'), { recursive: true })
  const manifest = JSON.parse(await readFile('packages/plugin-sdk/template/manifest.json', 'utf8'))
  await writeFile(join(source, 'manifest.json'), JSON.stringify(manifest))
  await writeFile(join(source, 'dist/index.html'), '<p>test</p>')
  await writeFile(join(source, 'dist/summary.html'), '<p>summary</p>')
  const root = join(directory, 'project')
  const rootB = join(directory, 'project-b')
  await mkdir(root); await mkdir(rootB)
  await writeFile(join(root, 'README.md'), 'project A')
  await writeFile(join(rootB, 'README.md'), 'project B')
  const events: Array<{ id: string; packet: any }> = []
  const deps = { directory: join(directory, 'profile'),
    resolveProject: async (id: string) => ({ root: id === 'a' ? root : rootB, name: id }),
    changed: vi.fn(), event: (id: string, packet: unknown) => events.push({ id, packet }), openView: vi.fn(), toast: vi.fn() }
  const service = new PluginService(deps)
  cleanups.push(() => service.dispose())
  await service.initialize()
  const prepare = async () => {
    await service.import(source, 'linked'); await service.setDevelopment(true); await service.enable(manifest.id, ['a', 'b'])
    await service.setContext('a', root, 'en', { id: 'dark', tokens: {} })
  }
  let request = 0
  const call = (mount: Awaited<ReturnType<PluginService['mount']>>, method: string, params: unknown = {}) => service.call(mount.instanceId, mount.binding,
    { protocol: 1, type: 'request', requestId: String(++request), method, params, contextRevision: mount.context.revision }) as Promise<any>
  return { directory, source, manifest, root, rootB, deps, service, events, prepare, call }
}

describe('P2 source and filesystem boundaries', () => {
  it('takes immutable static snapshots and rejects junctions, hardlinks and oversize reads', async () => {
    const { source, root, rootB } = await fixture()
    const pkg = await readPluginPackage(source)
    await writeFile(join(source, 'dist/index.html'), 'changed')
    expect(pkg.files.get('dist/index.html')?.toString()).toBe('<p>test</p>')
    await symlink(rootB, join(root, 'outside'), process.platform === 'win32' ? 'junction' : 'dir')
    await expect(readPluginFile(root, 'outside/README.md', 1024)).rejects.toMatchObject({ code: 'INVALID_PACKAGE_PATH' })
    await link(join(rootB, 'README.md'), join(root, 'hard.md'))
    await expect(readPluginFile(root, 'hard.md', 1024)).rejects.toMatchObject({ code: 'INVALID_PACKAGE_PATH' })
    await expect(readPluginFile(root, 'README.md', 2)).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' })
  })
  it.each([
    ['MANIFEST_INVALID', (m: any) => { m.badField = true }],
    ['INCOMPATIBLE_API', (m: any) => { m.engines.pluginApi = '^9.0.0' }],
    ['UNSUPPORTED_PERMISSION', (m: any) => { m.permissions.push({ name: 'terminal.register' }) }],
    ['INVALID_PACKAGE_PATH', (m: any) => { m.contributes.views[0].entry = '../index.html' }],
    ['ENTRY_NOT_FOUND', (m: any) => { m.contributes.views[0].entry = 'dist/missing.html' }],
  ])('rejects %s before registration', async (code, update) => {
    const { source, manifest, service } = await fixture()
    update(manifest); await writeFile(join(source, 'manifest.json'), JSON.stringify(manifest))
    await expect(service.import(source, 'linked')).rejects.toMatchObject({ code })
    expect(service.snapshot().plugins).toEqual([])
  })
  it('enforces static resource budgets with no partial registration', async () => {
    const { source, service } = await fixture()
    await writeFile(join(source, 'dist/large.js'), Buffer.alloc(5 * 1024 * 1024 + 1))
    await expect(service.import(source, 'copied')).rejects.toMatchObject({ code: 'PACKAGE_LIMIT_EXCEEDED' })
    expect(service.snapshot().plugins).toEqual([])
  })
})

describe('P2 authorization, lifecycle and persistent data', () => {
  it.each(['enable', 'reload', 'restore'] as const)('refuses a registered linked root replaced by a junction during %s', async operation => {
    const f = await fixture(); await f.prepare()
    f.service.dispose()
    const service = new PluginService(f.deps); cleanups.push(() => service.dispose())
    const replacement = join(f.directory, 'replacement')
    await rename(f.source, replacement)
    await symlink(replacement, f.source, process.platform === 'win32' ? 'junction' : 'dir')
    await service.initialize()
    if (operation === 'restore') {
      expect(service.snapshot().plugins[0]).toMatchObject({ state: 'error', error: 'SOURCE_UNAVAILABLE' })
      await expect(service.mount(f.manifest.id, 'details', 'a', f.root)).rejects.toMatchObject({ code: 'SOURCE_UNAVAILABLE' })
    } else {
      const action = operation === 'enable' ? service.enable(f.manifest.id, ['a']) : service.reload(f.manifest.id)
      await expect(action).rejects.toMatchObject({ code: 'RESOURCE_CHANGED' })
    }
  })
  it('registers without execution, requires development mode and rejects duplicate identities', async () => {
    const { source, service, manifest } = await fixture()
    await service.import(source, 'linked')
    expect(service.snapshot().plugins[0].state).toBe('disabled')
    await expect(service.enable(manifest.id, ['a'])).rejects.toMatchObject({ code: 'DEVELOPMENT_MODE_REQUIRED' })
    await expect(service.import(source, 'copied')).rejects.toMatchObject({ code: 'DUPLICATE_PLUGIN' })
  })
  it('binds exact requests and roots; repeated identical context sync preserves both views', async () => {
    const { prepare, service, manifest, root, rootB, call } = await fixture()
    await prepare()
    const a = await service.mount(manifest.id, 'details', 'a', root)
    service.bind(a.instanceId, a.binding)
    await service.setContext('a', root, 'en', { id: 'dark', tokens: {} })
    const b = await service.mount(manifest.id, 'summary', 'a', root)
    service.bind(b.instanceId, b.binding)
    expect(await call(a, 'workspace.readText', { path: 'README.md' })).toMatchObject({ ok: true, result: { text: 'project A' } })
    expect(await call(a, 'workspace.readText', { path: 'other.txt' })).toMatchObject({ ok: false, error: { code: 'PATH_NOT_GRANTED' } })
    expect(await call(a, 'terminal.register')).toMatchObject({ ok: false, error: { code: 'UNKNOWN_METHOD' } })
    await service.setContext('b', rootB, 'en', { id: 'dark', tokens: {} })
    await expect(call(a, 'workspace.getContext')).rejects.toMatchObject({ code: 'INSTANCE_CLOSED' })
    expect(service.resource(a.url)).toBeNull()
  })
  it('persists scoped KV, supports atomic watch/CAS, retains data on uninstall and requires new grants', async () => {
    const f = await fixture(); await f.prepare()
    const a = await f.service.mount(f.manifest.id, 'details', 'a', f.root); f.service.bind(a.instanceId, a.binding)
    const b = await f.service.mount(f.manifest.id, 'summary', 'a', f.root); f.service.bind(b.instanceId, b.binding)
    const watched = await f.call(b, 'storage.watch', { keys: ['memo'] })
    expect(watched.result.values.memo).toEqual({ found: false, revision: 0 })
    const results = await Promise.all([f.call(a, 'storage.set', { key: 'memo', value: 'one', expectedRevision: 0 }), f.call(b, 'storage.set', { key: 'memo', value: 'two', expectedRevision: 0 })])
    expect(results.filter(item => item.ok)).toHaveLength(1)
    expect(results.find(item => !item.ok).error.code).toBe('STORAGE_CONFLICT')
    await new Promise(resolve => setTimeout(resolve, 120))
    expect(f.events.find(event => event.packet.event === 'storage')?.packet.payload.memo).toMatchObject({ found: true, revision: 1 })
    f.service.dispose()
    const restored = new PluginService(f.deps); cleanups.push(() => restored.dispose()); await restored.initialize()
    expect(restored.snapshot().plugins[0]).toMatchObject({ enabled: true, state: 'ready' })
    await restored.setContext('a', f.root, 'en', { id: 'dark', tokens: {} })
    const c = await restored.mount(f.manifest.id, 'details', 'a', f.root); restored.bind(c.instanceId, c.binding)
    const get = await restored.call(c.instanceId, c.binding, { protocol: 1, type: 'request', requestId: 'get', method: 'storage.get', params: { key: 'memo' }, contextRevision: c.context.revision }) as any
    expect(get.result.value).toBe('one')
    await restored.uninstall(f.manifest.id)
    await restored.import(f.source, 'linked')
    expect(restored.snapshot().plugins[0]).toMatchObject({ enabled: false, state: 'disabled' })
    await restored.enable(f.manifest.id, ['a'])
    const retained = await restored.mount(f.manifest.id, 'details', 'a', f.root); restored.bind(retained.instanceId, retained.binding)
    const invoke = (mount: typeof retained) => restored.call(mount.instanceId, mount.binding, { protocol: 1, type: 'request', requestId: 'get', method: 'storage.get', params: { key: 'memo' }, contextRevision: mount.context.revision }) as Promise<any>
    expect((await invoke(retained)).result).toMatchObject({ value: 'one' })
    await restored.deleteData(f.manifest.id)
    const deleted = await restored.mount(f.manifest.id, 'details', 'a', f.root); restored.bind(deleted.instanceId, deleted.binding)
    expect((await invoke(deleted)).result).toEqual({ found: false, revision: 0 })
    expect(await readFile(join(f.source, 'manifest.json'), 'utf8')).toContain(f.manifest.id)
  })
  it('blocks permission increases and invalid sources, revokes resource URLs, and development off persists disabled intent', async () => {
    const f = await fixture(); await f.prepare()
    const a = await f.service.mount(f.manifest.id, 'details', 'a', f.root); f.service.bind(a.instanceId, a.binding)
    f.manifest.permissions.find((item: any) => item.name === 'workspace.files.read').paths.push('extra.md')
    await writeFile(join(f.source, 'manifest.json'), JSON.stringify(f.manifest)); await f.service.reload(f.manifest.id)
    expect(f.service.snapshot().plugins[0]).toMatchObject({ state: 'blocked', error: 'PERMISSION_RECONFIRM_REQUIRED' })
    expect(f.service.resource(a.url)).toBeNull()
    await expect(f.service.mount(f.manifest.id, 'details', 'a', f.root)).rejects.toMatchObject({ code: 'PERMISSION_RECONFIRM_REQUIRED' })
    await f.service.enable(f.manifest.id, ['a'])
    await writeFile(join(f.source, 'manifest.json'), '{bad'); await expect(f.service.reload(f.manifest.id)).rejects.toMatchObject({ code: 'MANIFEST_INVALID' })
    await expect(f.service.mount(f.manifest.id, 'details', 'a', f.root)).rejects.toMatchObject({ code: 'SOURCE_UNAVAILABLE' })
    await f.service.setDevelopment(false); await f.service.setDevelopment(true)
    expect(f.service.snapshot().plugins[0].enabled).toBe(false)
  })
  it('three handshake timeouts disable only the faulty plugin', async () => {
    const f = await fixture(); await f.prepare(); vi.useFakeTimers()
    for (let i = 0; i < 3; i++) { await f.service.mount(f.manifest.id, 'details', 'a', f.root); await vi.advanceTimersByTimeAsync(10_001) }
    expect(f.service.snapshot().plugins[0]).toMatchObject({ enabled: false, failures: 3, error: 'VIEW_LOAD_FAILED' })
  })
  it('revokes an in-flight read before root resolution completes and refuses forged bindings', async () => {
    const f = await fixture(); await f.prepare()
    const mount = await f.service.mount(f.manifest.id, 'details', 'a', f.root)
    await expect(f.call(mount, 'app.getInfo')).rejects.toMatchObject({ code: 'INVALID_SENDER' })
    f.service.bind(mount.instanceId, mount.binding)
    await expect(f.service.call(mount.instanceId, 'forged', {})).rejects.toMatchObject({ code: 'INSTANCE_CLOSED' })
    const reading = f.call(mount, 'workspace.readText', { path: 'README.md' })
    let release!: () => void
    f.deps.resolveProject = async () => { await new Promise<void>(resolve => { release = resolve }); return { root: f.rootB, name: 'b' } }
    const switching = f.service.setContext('b', f.rootB, 'en', { id: '', tokens: {} })
    expect(f.service.resource(mount.url)).toBeNull()
    expect(await reading).toMatchObject({ ok: false, error: { code: 'INSTANCE_CLOSED' } })
    release(); await switching
  })
  it('keeps application, project roots and plugin identities in separate storage namespaces', async () => {
    const f = await fixture()
    f.manifest.contributes.views.find((view: any) => view.id === 'summary').scope = 'application'
    await writeFile(join(f.source, 'manifest.json'), JSON.stringify(f.manifest)); await f.prepare()
    const app = await f.service.mount(f.manifest.id, 'summary', null, null); f.service.bind(app.instanceId, app.binding)
    expect(await f.call(app, 'workspace.readText', { path: 'README.md' })).toMatchObject({ ok: false, error: { code: 'CONTEXT_UNAVAILABLE' } })
    await f.call(app, 'storage.set', { key: 'memo', value: 'application' })
    const a = await f.service.mount(f.manifest.id, 'details', 'a', f.root); f.service.bind(a.instanceId, a.binding)
    expect(await f.call(a, 'storage.get', { key: 'memo' })).toMatchObject({ result: { found: false } })
    await f.call(a, 'storage.set', { key: 'memo', value: 'root-a' })
    await f.service.setContext('b', f.rootB, 'zh-CN', { id: '', tokens: {} })
    const b = await f.service.mount(f.manifest.id, 'details', 'b', f.rootB); f.service.bind(b.instanceId, b.binding)
    expect(await f.call(b, 'storage.get', { key: 'memo' })).toMatchObject({ result: { found: false } })
    expect(await f.call(app, 'storage.get', { key: 'memo' })).toMatchObject({ result: { value: 'application' } })
    const storage = new PluginStorage(join(f.directory, 'private-test'))
    await storage.mutate('first', 'application', 'memo', 'one', 0, () => {})
    expect(await storage.get('second', 'application', 'memo')).toEqual({ found: false, revision: 0 })
  })
  it('enforces storage quota and disk failure without replacing the previous committed value', async () => {
    const f = await fixture(); const path = join(f.directory, 'quota'); const storage = new PluginStorage(path)
    await storage.mutate('one', 'a', 'memo', 'retained', 0, () => {})
    await expect(storage.mutate('one', 'a', 'oversize', 'x'.repeat(1024 * 1024), undefined, () => {})).rejects.toMatchObject({ code: 'STORAGE_QUOTA_EXCEEDED' })
    expect(await storage.get('one', 'a', 'memo')).toMatchObject({ value: 'retained', revision: 1 })
    const blocked = join(f.directory, 'blocked'); await writeFile(blocked, 'file')
    await expect(new PluginStorage(blocked).mutate('one', 'a', 'memo', 'lost', undefined, () => {})).rejects.toMatchObject({ code: 'STORAGE_UNAVAILABLE' })
    const invalid = () => { throw Object.assign(new Error('revoked'), { code: 'INSTANCE_CLOSED' }) }
    await expect(storage.mutate('one', 'a', 'memo', 'lost', undefined, invalid)).rejects.toMatchObject({ code: 'INSTANCE_CLOSED' })
    expect(await storage.get('one', 'a', 'memo')).toMatchObject({ value: 'retained', revision: 1 })
  })
  it('cancels only matching pending requests and rejects duplicate IDs and excess calls', async () => {
    const f = await fixture(); await f.prepare()
    const a = await f.service.mount(f.manifest.id, 'details', 'a', f.root); f.service.bind(a.instanceId, a.binding)
    const packet = { protocol: 1, type: 'request', requestId: 'read', method: 'workspace.readText', params: { path: 'README.md' }, contextRevision: a.context.revision }
    const read = f.service.call(a.instanceId, a.binding, packet)
    await f.service.call(a.instanceId, a.binding, { protocol: 1, type: 'cancel', requestId: 'read' })
    expect(await read).toMatchObject({ ok: false, error: { code: 'CANCELLED' } })
    expect(await f.service.call(a.instanceId, a.binding, packet)).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } })
    const results = []
    for (let i = 0; i < 31; i++) results.push(await f.call(a, 'app.getInfo'))
    expect(results.at(-1)).toMatchObject({ ok: false, error: { code: 'RATE_LIMITED' } })
  })
})

describe('public SDK port client', () => {
  it('folds early watch events into the snapshot and discards older revisions', async () => {
    const channel = new MessageChannel(); const client = createPluginClient(channel.port1, 1)
    cleanups.push(() => { client.close(); channel.port2.close() })
    channel.port2.onmessage = event => {
      if (event.data.method !== 'storage.watch') return
      channel.port2.postMessage({ protocol: 1, type: 'event', subscriptionId: 'watch', event: 'storage', contextRevision: 1, payload: { memo: { found: true, value: 'new', revision: 2 } } })
      channel.port2.postMessage({ protocol: 1, type: 'response', requestId: event.data.requestId, ok: true, result: { subscriptionId: 'watch', values: { memo: { found: true, value: 'old', revision: 1 } } } })
    }
    const listener = vi.fn(); const watch = await client.api.storage.watch({ keys: ['memo'] }, listener)
    expect(watch.values.memo).toMatchObject({ value: 'new', revision: 2 })
    for (const revision of [1, 3, 3]) channel.port2.postMessage({ protocol: 1, type: 'event', subscriptionId: 'watch', event: 'storage', contextRevision: 1, payload: { memo: { found: true, value: 'latest', revision } } })
    await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(1))
    expect(listener.mock.calls[0][0].memo.revision).toBe(3)
    watch.unsubscribe()
  })
  it('dispatches through its port, cancels requests and drops replies after close', async () => {
    const channel = new MessageChannel()
    const client = createPluginClient(channel.port1, 3)
    cleanups.push(() => { client.close(); channel.port2.close() })
    const packets: any[] = []
    channel.port2.onmessage = event => {
      packets.push(event.data)
      if (event.data.method === 'app.getInfo') channel.port2.postMessage({ protocol: 1, type: 'response', requestId: event.data.requestId, ok: true, result: { pluginApiVersion: '1.0.0' }, contextRevision: 3 })
    }
    expect(await client.api.app.getInfo()).toMatchObject({ pluginApiVersion: '1.0.0' })
    const controller = new AbortController()
    const pending = client.api.workspace.getContext({ signal: controller.signal })
    controller.abort()
    await expect(pending).rejects.toMatchObject({ code: 'CANCELLED' })
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(packets.some(packet => packet.type === 'cancel')).toBe(true)
    client.close()
    await expect(client.api.app.getInfo()).rejects.toMatchObject({ code: 'INSTANCE_CLOSED' })
  })
})
