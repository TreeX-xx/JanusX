import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink, link, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import * as nodeFiles from 'node:fs/promises'
import { PluginService } from '../../src/main/plugins/service'
import { configurePluginFileSystem, readPluginFile, readPluginPackage } from '../../src/main/plugins/files'
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
    resolveProject: async (id: string, scopePath: string | null = null) => ({ root: scopePath ?? (id === 'a' ? root : rootB), name: id }),
    worktrees: async (_id: string) => [{ root, name: 'Main', branch: 'main' as string | null, isMain: true }],
    changed: vi.fn(), event: (id: string, packet: unknown) => events.push({ id, packet }), openView: vi.fn(), workbenchAction: vi.fn(), toast: vi.fn() }
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

it('requires an explicit project grant before resolving roots or mounting, while keeping application views available', async () => {
  const f = await fixture()
  f.manifest.contributes.views.find((view: any) => view.id === 'summary').scope = 'application'
  f.manifest.contributes.island[0].actions = ['open-desk', 'open-island']
  await writeFile(join(f.source, 'manifest.json'), JSON.stringify(f.manifest))
  await f.prepare()
  await f.service.enable(f.manifest.id, [])
  const resolveProject = vi.spyOn(f.deps, 'resolveProject')
  await expect(f.service.mount(f.manifest.id, 'desk', 'a', f.root)).rejects.toMatchObject({ code: 'PATH_NOT_GRANTED' })
  expect(resolveProject).not.toHaveBeenCalled()
  expect(f.service.snapshot().plugins[0].runtime?.pages ?? 0).toBe(0)
  const app = await f.service.mount(f.manifest.id, 'summary', null, null)
  f.service.bind(app.instanceId, app.binding)
  expect(await f.call(app, 'workspace.readText', { path: 'README.md' })).toMatchObject({ ok: false, error: { code: 'CONTEXT_UNAVAILABLE' } })
  await f.service.enable(f.manifest.id, ['a'])
  const mount = await f.service.mount(f.manifest.id, 'desk', 'a', f.root)
  f.service.bind(mount.instanceId, mount.binding)
  expect(await f.call(mount, 'workspace.readText', { path: 'README.md' })).toMatchObject({ ok: true, result: { text: 'project A' } })
  await f.service.setContext('b', f.rootB, 'en', { id: '', tokens: {} })
  await expect(f.service.mount(f.manifest.id, 'desk', 'b', f.rootB)).rejects.toMatchObject({ code: 'PATH_NOT_GRANTED' })
})

describe('plugin-owned workbench frame', () => {
  it('retains only opted-in pages, revokes the old scope immediately and rejects late reads across worktree/project switches', async () => {
    const f = await fixture()
    f.manifest.capabilities.required.push('views.workbench.frame', 'views.workbench.rebind')
    f.manifest.contributes.views.find((view: any) => view.id === 'desk').frame = 'plugin'
    await writeFile(join(f.source, 'manifest.json'), JSON.stringify(f.manifest)); await f.prepare()
    const mount = await f.service.mount(f.manifest.id, 'desk', 'a', f.root)
    f.service.bind(mount.instanceId, mount.binding)
    await f.call(mount, 'app.getInfo')
    await f.call(mount, 'storage.set', { key: 'memo', value: 'original' })
    let release!: () => void
    const resolve = f.deps.resolveProject
    f.deps.resolveProject = async (id, path) => { await new Promise<void>(done => { release = done }); return resolve(id, path) }
    const switching = f.service.setContext('a', f.rootB, 'en', { id: '', tokens: {} })
    await expect(f.call(mount, 'workspace.readText', { path: 'README.md' })).rejects.toMatchObject({ code: 'STALE_CONTEXT' })
    expect(f.service.resource(mount.url)).not.toBeNull()
    expect(f.events.filter(event => event.packet.event === 'invalidated')).toHaveLength(0)
    expect(f.events.at(-1)?.packet).toMatchObject({ event: 'scope', payload: { transitioning: true } })
    release(); await switching
    const worktree = f.events.findLast(event => event.packet.event === 'scope' && event.packet.payload.workspace)!.packet.payload.workspace
    expect(worktree.project.rootId).not.toBe(mount.context.project!.rootId)
    expect(await f.call(mount, 'storage.set', { key: 'memo', value: 'late-write' })).toMatchObject({ ok: false, error: { code: 'STALE_CONTEXT' } })
    const current = { ...mount, context: worktree }
    expect(await f.call(current, 'workspace.readText', { path: 'README.md' })).toMatchObject({ ok: true, result: { text: 'project B' } })
    expect(await f.call(current, 'storage.get', { key: 'memo' })).toMatchObject({ result: { found: false } })
    f.deps.resolveProject = resolve
    await f.service.setContext('b', f.rootB, 'en', { id: '', tokens: {} })
    const project = f.events.findLast(event => event.packet.event === 'scope' && event.packet.payload.workspace)!.packet.payload.workspace
    expect(project.project.projectId).toBe('b')
    expect(await f.call({ ...mount, context: project }, 'workspace.readText', { path: 'README.md' })).toMatchObject({ ok: true, result: { text: 'project B' } })
    expect(f.service.snapshot().plugins[0].runtime?.pages).toBe(1)
    await f.service.setContext('ungranted', f.root, 'en', { id: '', tokens: {} })
    expect(f.service.resource(mount.url)).toBeNull()
  })
  it('closes retained pages when the selected root cannot be resolved', async () => {
    const f = await fixture()
    f.manifest.capabilities.required.push('views.workbench.frame', 'views.workbench.rebind')
    f.manifest.contributes.views.find((view: any) => view.id === 'desk').frame = 'plugin'
    await writeFile(join(f.source, 'manifest.json'), JSON.stringify(f.manifest)); await f.prepare()
    const mount = await f.service.mount(f.manifest.id, 'desk', 'a', f.root)
    f.service.bind(mount.instanceId, mount.binding); await f.call(mount, 'app.getInfo')
    f.deps.resolveProject = async () => { throw new Error('Root unavailable') }
    await expect(f.service.setContext('a', f.rootB, 'en', { id: '', tokens: {} })).rejects.toThrow('Root unavailable')
    expect(f.service.resource(mount.url)).toBeNull()
    expect(f.events.at(-1)?.packet.event).toBe('invalidated')
  })
  async function framed(worktrees = false) {
    const f = await fixture()
    f.manifest.capabilities.required.push('views.workbench.frame')
    if (worktrees) f.manifest.capabilities.required.push('views.workbench.worktrees')
    f.manifest.contributes.views.find((view: any) => view.id === 'desk').frame = 'plugin'
    await writeFile(join(f.source, 'manifest.json'), JSON.stringify(f.manifest))
    await f.prepare()
    const mount = await f.service.mount(f.manifest.id, 'desk', 'a', f.root)
    f.service.bind(mount.instanceId, mount.binding)
    return { ...f, mount }
  }
  it('lists only granted project identities and routes close/switch through the host', async () => {
    const f = await framed()
    expect(f.mount.context.workbenchFrame).toBe(true)
    expect(await f.call(f.mount, 'views.getFrame')).toMatchObject({ ok: true, result: { projectId: 'a', projects: [{ id: 'a', name: 'a' }, { id: 'b', name: 'b' }] } })
    expect(await f.call(f.mount, 'views.requestFrame', { action: 'selectProject', projectId: 'ungranted' })).toMatchObject({ ok: false, error: { code: 'PERMISSION_DENIED' } })
    expect(f.deps.workbenchAction).not.toHaveBeenCalled()
    expect(await f.call(f.mount, 'views.requestFrame', { action: 'selectProject', projectId: 'b' })).toMatchObject({ ok: true, result: { requested: true } })
    expect(f.deps.workbenchAction).toHaveBeenLastCalledWith(expect.objectContaining({ pluginId: f.manifest.id, viewId: 'desk', currentProjectId: 'a', root: f.root, projectId: 'b' }))
    expect(await f.call(f.mount, 'views.requestFrame', { action: 'close' })).toMatchObject({ ok: true })
    const page = await f.service.mount(f.manifest.id, 'details', 'a', f.root)
    f.service.bind(page.instanceId, page.binding)
    expect(await f.call(page, 'views.getFrame')).toMatchObject({ ok: false, error: { code: 'PERMISSION_DENIED' } })
    expect(await f.call(page, 'views.requestFrame', { action: 'close' })).toMatchObject({ ok: false, error: { code: 'PERMISSION_DENIED' } })
  })
  it('does not dispatch a project switch that finishes resolving after revocation', async () => {
    const f = await framed()
    let release!: () => void
    f.deps.resolveProject = async () => { await new Promise<void>(resolve => { release = resolve }); return { root: f.rootB, name: 'b' } }
    const switching = f.call(f.mount, 'views.requestFrame', { action: 'selectProject', projectId: 'b' })
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    await f.service.disable(f.manifest.id)
    release()
    expect(await switching).toMatchObject({ ok: false })
    expect(f.deps.workbenchAction).not.toHaveBeenCalled()
  })
  it('switches only to a current worktree identity and invalidates the previous checkout page', async () => {
    const f = await framed(true)
    f.deps.worktrees = async () => [{ root: f.root, name: 'Main', branch: 'main', isMain: true },
      { root: f.rootB, name: 'Feature checkout', branch: 'feature', isMain: false }]
    const id = (root: string) => createHash('sha256').update(root).digest('hex')
    const frame = await f.call(f.mount, 'views.getFrame')
    expect(frame).toMatchObject({ ok: true, result: { worktreeId: id(f.root), worktrees: [
      { id: id(f.root), branch: 'main', isMain: true }, { id: id(f.rootB), branch: 'feature', isMain: false },
    ] } })
    expect(JSON.stringify(frame)).not.toContain(f.root)
    expect(await f.call(f.mount, 'views.requestFrame', { action: 'selectWorktree', worktreeId: '0'.repeat(64) }))
      .toMatchObject({ ok: false, error: { code: 'CONTEXT_UNAVAILABLE' } })
    expect(f.deps.workbenchAction).not.toHaveBeenCalled()
    expect(await f.call(f.mount, 'views.requestFrame', { action: 'selectWorktree', worktreeId: id(f.rootB) })).toMatchObject({ ok: true })
    expect(f.deps.workbenchAction).toHaveBeenLastCalledWith(expect.objectContaining({ currentProjectId: 'a', root: f.root, scopePath: f.rootB }))
    await f.service.setContext('a', f.rootB, 'en', { id: 'dark', tokens: {} })
    await expect(f.call(f.mount, 'views.getFrame')).rejects.toThrow('Plugin instance is unavailable')
    const switched = await f.service.mount(f.manifest.id, 'desk', 'a', f.rootB)
    f.service.bind(switched.instanceId, switched.binding)
    expect(switched.context.project?.rootId).not.toBe(f.mount.context.project?.rootId)
    expect(await f.call(switched, 'workspace.readText', { path: 'README.md' })).toMatchObject({ ok: true, result: { text: 'project B' } })
  })
  it('rejects a removed worktree and a list that completes after revocation', async () => {
    const f = await framed(true)
    const id = createHash('sha256').update(f.rootB).digest('hex')
    expect(await f.call(f.mount, 'views.requestFrame', { action: 'selectWorktree', worktreeId: id })).toMatchObject({ ok: false })
    let release!: () => void
    f.deps.worktrees = async () => {
      await new Promise<void>(resolve => { release = resolve })
      return [{ root: f.rootB, name: 'Feature', branch: 'feature', isMain: false }]
    }
    const switching = f.call(f.mount, 'views.requestFrame', { action: 'selectWorktree', worktreeId: id })
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    await f.service.disable(f.manifest.id)
    release()
    expect(await switching).toMatchObject({ ok: false })
    expect(f.deps.workbenchAction).not.toHaveBeenCalled()
  })
})

describe('P3 Island broker and lifecycle', () => {
  const status = { title: 'Reading reference', state: 'running', progress: 25, badge: 'README', preview: { text: '<script>untrusted text</script>', rows: [{ label: 'Files', value: '1' }] } }
  const publisher = async (f: Awaited<ReturnType<typeof fixture>>, view = 'details') => {
    const mount = await f.service.mount(f.manifest.id, view, 'a', f.root)
    f.service.bind(mount.instanceId, mount.binding)
    await f.call(mount, 'app.getInfo')
    return mount
  }
  it('publishes bounded data, coalesces updates and only runs declared actions', async () => {
    const f = await fixture(); await f.prepare(); const mount = await publisher(f)
    f.deps.changed.mockClear()
    expect(await f.call(mount, 'island.update', { id: 'reference', status })).toMatchObject({ ok: true })
    expect(await f.call(mount, 'island.update', { id: 'reference', status: { ...status, progress: 50 } })).toMatchObject({ ok: true })
    expect(f.deps.changed).not.toHaveBeenCalled()
    await new Promise(resolve => setTimeout(resolve, 125))
    expect(f.deps.changed).toHaveBeenCalledTimes(1)
    expect(f.service.snapshot().island).toMatchObject([{ pluginId: f.manifest.id, instanceId: mount.instanceId, projectId: 'a', status: { progress: 50 } }])
    f.service.islandAction(f.manifest.id, 'reference', mount.instanceId, 'open-desk')
    expect(f.deps.openView).toHaveBeenLastCalledWith(f.manifest.id, 'desk')
    expect(() => f.service.islandAction(f.manifest.id, 'reference', mount.instanceId, 'open-details')).toThrow('Island action is unavailable')
    expect(() => f.service.islandAction('other.plugin', 'reference', mount.instanceId, 'open-desk')).toThrow()
    const snapshot = f.service.snapshot(); snapshot.island![0].status.title = 'tampered'
    expect(f.service.snapshot().island![0].status.title).toBe(status.title)
  })
  it('revokes status and stale actions immediately on close and project/worktree changes', async () => {
    const f = await fixture(); await f.prepare(); let mount = await publisher(f)
    await f.call(mount, 'island.update', { id: 'reference', status })
    f.service.close(mount.instanceId)
    expect(f.service.snapshot().island).toEqual([])
    expect(() => f.service.islandAction(f.manifest.id, 'reference', mount.instanceId, 'open-desk')).toThrow()
    mount = await publisher(f); await f.call(mount, 'island.update', { id: 'reference', status })
    let release!: () => void
    f.deps.resolveProject = async () => { await new Promise<void>(resolve => { release = resolve }); return { root: f.rootB, name: 'tree' } }
    const switching = f.service.setContext('a', f.rootB, 'en', { id: 'dark', tokens: {} })
    expect(f.service.snapshot().island).toEqual([])
    expect(() => f.service.islandAction(f.manifest.id, 'reference', mount.instanceId, 'open-desk')).toThrow()
    release(); await switching
  })
  it.each(['disable', 'reload', 'failView', 'deleteData'] as const)('cleans Island data on %s', async action => {
    const f = await fixture(); await f.prepare(); const mount = await publisher(f)
    await f.call(mount, 'island.update', { id: 'reference', status })
    if (action === 'failView') f.service.failView(mount.instanceId, mount.binding)
    else if (action === 'reload') await f.service.reload(f.manifest.id, true)
    else await f.service[action](f.manifest.id)
    expect(f.service.snapshot().island).toEqual([])
  })
  it('keeps the latest publisher alive when another page closes and rejects stale clear/actions', async () => {
    const f = await fixture(); await f.prepare(); const first = await publisher(f); const second = await publisher(f, 'summary')
    await f.call(first, 'island.update', { id: 'reference', status })
    await f.call(second, 'island.update', { id: 'reference', status: { ...status, title: 'New publisher' } })
    expect(await f.call(first, 'island.update', { id: 'reference', status: null })).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } })
    expect(() => f.service.islandAction(f.manifest.id, 'reference', first.instanceId, 'open-desk')).toThrow()
    f.service.close(first.instanceId)
    expect(f.service.snapshot().island![0].instanceId).toBe(second.instanceId)
    expect(await f.call(second, 'island.update', { id: 'reference', status: null })).toMatchObject({ ok: true })
    expect(f.service.snapshot().island).toEqual([])
  })
  it('rate limits each plugin across publishers and rejects undeclared/oversized status', async () => {
    const f = await fixture(); await f.prepare(); const mount = await publisher(f)
    for (const params of [{ id: 'other', status }, { id: 'reference', status: { ...status, progress: 101 } },
      { id: 'reference', status: { ...status, html: '<img>' } }, { id: 'reference', status: { ...status, title: 'x'.repeat(81) } },
      { id: 'reference', status: { ...status, badge: '\u202etxt' } }]) {
      expect(await f.call(mount, 'island.update', params)).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } })
    }
    for (let i = 0; i < 10; i++) expect(await f.call(mount, 'island.update', { id: 'reference', status })).toMatchObject({ ok: true })
    expect(await f.call(mount, 'island.update', { id: 'reference', status })).toMatchObject({ ok: false, error: { code: 'RATE_LIMITED' } })
  })
  it('separates application publishers and clears them when development mode closes', async () => {
    const f = await fixture()
    f.manifest.contributes.views.find((view: any) => view.id === 'summary').scope = 'application'
    f.manifest.contributes.island[0].actions = ['open-desk', 'open-island']
    f.manifest.contributes.island.push({ id: 'global', title: 'Global', scope: 'application' })
    await writeFile(join(f.source, 'manifest.json'), JSON.stringify(f.manifest)); await f.prepare()
    const mount = await f.service.mount(f.manifest.id, 'summary', null, null); f.service.bind(mount.instanceId, mount.binding)
    expect(await f.call(mount, 'island.update', { id: 'reference', status })).toMatchObject({ ok: false, error: { code: 'CONTEXT_UNAVAILABLE' } })
    expect(await f.call(mount, 'island.update', { id: 'global', status })).toMatchObject({ ok: true })
    await f.service.setContext('b', f.rootB, 'en', { id: 'dark', tokens: {} })
    expect(f.service.snapshot().island).toMatchObject([{ projectId: null, id: 'global' }])
    await f.service.setDevelopment(false)
    expect(f.service.snapshot().island).toEqual([])
  })
  it('bounds the global queue at 32 entries and releases capacity when publishers close', async () => {
    const f = await fixture(); await f.service.initialize(); await f.service.setDevelopment(true)
    await f.service.setContext('a', f.root, 'en', { id: 'dark', tokens: {} })
    const mounts: Awaited<ReturnType<PluginService['mount']>>[] = []
    for (let i = 0; i < 9; i++) {
      const manifest = structuredClone(f.manifest); manifest.id = `example.queue-${i}`
      manifest.contributes.island = Array.from({ length: 4 }, (_, n) => ({ id: `item-${n}`, title: `Item ${n}`, scope: 'project' }))
      await writeFile(join(f.source, 'manifest.json'), JSON.stringify(manifest))
      await f.service.import(f.source, 'copied'); await f.service.enable(manifest.id, ['a'])
      const mount = await f.service.mount(manifest.id, 'details', 'a', f.root); f.service.bind(mount.instanceId, mount.binding); mounts.push(mount)
      if (i < 8) for (let n = 0; n < 4; n++) expect(await f.call(mount, 'island.update', { id: `item-${n}`, status })).toMatchObject({ ok: true })
    }
    expect(f.service.snapshot().island).toHaveLength(32)
    expect(await f.call(mounts[8], 'island.update', { id: 'item-0', status })).toMatchObject({ ok: false, error: { code: 'RATE_LIMITED' } })
    expect(await f.call(mounts[0], 'island.update', { id: 'item-0', status: { ...status, progress: 99 } })).toMatchObject({ ok: true })
    f.service.close(mounts[0].instanceId)
    expect(await f.call(mounts[8], 'island.update', { id: 'item-0', status })).toMatchObject({ ok: true })
    expect(f.service.snapshot().island).toHaveLength(29)
  })
})

describe('P2 source and filesystem boundaries', () => {
  it('rejects a real parent-directory replacement between path validation and open', async () => {
    const f = await fixture()
    const parent = join(f.root, 'files'); await mkdir(parent)
    await writeFile(join(parent, 'README.md'), 'original')
    let replaced = false
    configurePluginFileSystem({ ...nodeFiles, open: (async (...args: Parameters<typeof nodeFiles.open>) => {
      if (!replaced && args[0] === join(parent, 'README.md')) {
        replaced = true
        await rename(parent, join(f.root, 'original-files'))
        await symlink(f.rootB, parent, process.platform === 'win32' ? 'junction' : 'dir')
      }
      return nodeFiles.open(...args)
    }) as typeof nodeFiles.open })
    try { await expect(readPluginFile(f.root, 'files/README.md', 1024)).rejects.toMatchObject({ code: 'RESOURCE_CHANGED' }) }
    finally { configurePluginFileSystem(nodeFiles) }
    expect(replaced).toBe(true)
  })
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
    expect(restored.snapshot().plugins[0]).toMatchObject({ enabled: false, state: 'disabled' })
    await restored.enable(f.manifest.id, ['a'])
    await restored.setContext('a', f.root, 'en', { id: 'dark', tokens: {} })
    const deleted = await restored.mount(f.manifest.id, 'details', 'a', f.root); restored.bind(deleted.instanceId, deleted.binding)
    const readDeleted = (mount: typeof deleted) => restored.call(mount.instanceId, mount.binding, { protocol: 1, type: 'request', requestId: 'deleted', method: 'storage.get', params: { key: 'memo' }, contextRevision: mount.context.revision }) as Promise<any>
    expect((await readDeleted(deleted)).result).toEqual({ found: false, revision: 0 })
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
  it('counts crashes after successful handshakes and publishes live page and bridge counts', async () => {
    const f = await fixture(); await f.prepare(); vi.useFakeTimers()
    for (let failure = 1; failure <= 3; failure++) {
      const mount = await f.service.mount(f.manifest.id, 'details', 'a', f.root)
      expect(f.service.snapshot().plugins[0].runtime).toEqual({ pages: 1, connected: 0, ready: 0 })
      f.service.bind(mount.instanceId, mount.binding)
      expect(f.service.snapshot().plugins[0].runtime).toEqual({ pages: 1, connected: 1, ready: 0 })
      expect(await f.call(mount, 'app.getInfo')).toMatchObject({ ok: true })
      expect(f.service.snapshot().plugins[0]).toMatchObject({ state: 'active', failures: failure - 1, runtime: { pages: 1, connected: 1, ready: 1 } })
      await vi.advanceTimersByTimeAsync(1000)
      f.service.failView(mount.instanceId, mount.binding)
      expect(f.service.snapshot().plugins[0]).toMatchObject({ failures: failure, runtime: { pages: 0, connected: 0, ready: 0 } })
    }
    expect(f.service.snapshot().plugins[0]).toMatchObject({ enabled: false, state: 'disabled', failures: 3 })
    await vi.advanceTimersByTimeAsync(30_000)
    expect(f.service.snapshot().plugins[0].failures).toBe(3)
  })
  it.each(['close', 'disable', 'recover'] as const)('resets failures only after a live stable recovery, with %s', async action => {
    const f = await fixture(); await f.prepare(); vi.useFakeTimers()
    const first = await f.service.mount(f.manifest.id, 'details', 'a', f.root)
    f.service.failView(first.instanceId, first.binding)
    const retry = await f.service.mount(f.manifest.id, 'details', 'a', f.root)
    f.service.bind(retry.instanceId, retry.binding); await f.call(retry, 'app.getInfo')
    await vi.advanceTimersByTimeAsync(29_999)
    expect(f.service.snapshot().plugins[0].failures).toBe(1)
    if (action === 'close') {
      f.deps.changed.mockClear(); f.service.close(retry.instanceId)
      expect(f.deps.changed).toHaveBeenCalled()
      expect(f.service.snapshot().plugins[0]).toMatchObject({ state: 'ready', runtime: { pages: 0, connected: 0, ready: 0 } })
    } else if (action === 'disable') await f.service.disable(f.manifest.id)
    await vi.advanceTimersByTimeAsync(1)
    expect(f.service.snapshot().plugins[0].failures).toBe(action === 'recover' ? 0 : 1)
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
  it('discards a real opened-file read completed after switching to a new root and instance', async () => {
    const f = await fixture(); await f.prepare()
    const old = await f.service.mount(f.manifest.id, 'details', 'a', f.root); f.service.bind(old.instanceId, old.binding)
    let opened!: () => void; let release!: () => void
    const started = new Promise<void>(resolve => { opened = resolve })
    const released = new Promise<void>(resolve => { release = resolve })
    configurePluginFileSystem({ ...nodeFiles, open: (async (...args: Parameters<typeof nodeFiles.open>) => {
      const handle = await nodeFiles.open(...args)
      if (args[0] === join(f.root, 'README.md')) { opened(); await released }
      return handle
    }) as typeof nodeFiles.open })
    try {
      const late = f.call(old, 'workspace.readText', { path: 'README.md' })
      await started
      await f.service.setContext('b', f.rootB, 'en', { id: '', tokens: {} })
      const current = await f.service.mount(f.manifest.id, 'details', 'b', f.rootB); f.service.bind(current.instanceId, current.binding)
      release()
      expect(await late).toMatchObject({ ok: false, error: { code: 'INSTANCE_CLOSED' } })
      expect(await f.call(current, 'workspace.readText', { path: 'README.md' })).toMatchObject({ ok: true, result: { text: 'project B' } })
      expect(f.service.resource(old.url)).toBeNull()
    } finally { release(); configurePluginFileSystem(nodeFiles) }
  })
  it('keeps application, project roots and plugin identities in separate storage namespaces', async () => {
    const f = await fixture()
    f.manifest.contributes.views.find((view: any) => view.id === 'summary').scope = 'application'
    f.manifest.contributes.island[0].actions = ['open-desk', 'open-island']
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
  it('keeps its context listener while cancelling pending scope work and updating the request revision', async () => {
    const channel = new MessageChannel(), client = createPluginClient(channel.port1, 1)
    cleanups.push(() => { client.close(); channel.port2.close() })
    const packets: any[] = []
    channel.port2.onmessage = event => {
      const packet = event.data; packets.push(packet)
      if (packet.method === 'context.subscribe') channel.port2.postMessage({ protocol: 1, type: 'response', requestId: packet.requestId, ok: true, result: { subscriptionId: 'context' } })
      if (packet.method === 'app.getInfo') channel.port2.postMessage({ protocol: 1, type: 'response', requestId: packet.requestId, ok: true, result: {} })
    }
    const listener = vi.fn(); await client.api.context.subscribe(listener)
    const pending = client.api.workspace.readText({ path: 'README.md' })
    const rejected = expect(pending).rejects.toMatchObject({ code: 'STALE_CONTEXT' })
    channel.port2.postMessage({ protocol: 1, type: 'event', event: 'scope', contextRevision: 2, payload: { transitioning: true } })
    await rejected
    await expect(client.api.app.getInfo()).rejects.toMatchObject({ code: 'STALE_CONTEXT' })
    channel.port2.postMessage({ protocol: 1, type: 'event', event: 'scope', contextRevision: 3, payload: { transitioning: false, workspace: { revision: 3 } } })
    await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(2))
    await client.api.app.getInfo()
    expect(packets.at(-1)).toMatchObject({ contextRevision: 3 })
  })
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
