import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPluginClient, parsePluginManifest, validatePluginCall, type PluginConfiguration, type PluginManifest } from '../../packages/plugin-sdk/src/index'
import { PluginService } from '../../src/main/plugins/service'
import { PluginConfigurationStore } from '../../src/main/plugins/configuration'
import type { PluginConfigurationState } from '../../src/shared/ipc/plugins'

const cleanups: Array<() => unknown> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })
async function manifest(): Promise<PluginManifest> {
  const value = JSON.parse(await readFile('packages/plugin-sdk/template/manifest.json', 'utf8'))
  value.permissions.push({ name: 'configuration.read' })
  value.capabilities.required.push('configuration.settings')
  value.contributes.settings = [
    { key: 'label', title: 'Reference label', type: 'string', default: 'Reference', scope: 'project', minLength: 1, maxLength: 40 },
    { key: 'enabled', title: 'Show details', type: 'boolean', default: true, scope: 'project' },
    { key: 'limit', title: 'Item limit', type: 'number', default: 10, minimum: 1, maximum: 100, integer: true, scope: 'project' },
    { key: 'style', title: 'Display style', type: 'enum', default: 'compact', options: ['compact', 'full'], scope: 'application' },
  ]
  return parsePluginManifest(JSON.stringify(value))
}
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'janusx-settings-'))
  cleanups.push(() => rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }))
  const source = join(directory, 'source'); const root = join(directory, 'project'); const other = join(directory, 'other'); const tree = join(directory, 'tree')
  await Promise.all([mkdir(join(source, 'dist'), { recursive: true }), mkdir(root), mkdir(other), mkdir(tree)])
  const value = await manifest()
  await writeFile(join(source, 'manifest.json'), JSON.stringify(value))
  await writeFile(join(source, 'dist/index.html'), '<p>settings</p>'); await writeFile(join(source, 'dist/summary.html'), '<p>summary</p>')
  const deps = { directory: join(directory, 'profile'), resolveProject: async (id: string, path: string | null) => {
    const selected = id === 'a' ? root : other
    if (path && path !== selected && !(id === 'a' && path === tree)) throw new Error('Unregistered root')
    return { root: path ?? selected, name: id }
  }, changed: vi.fn(), event: vi.fn(), openView: vi.fn(), toast: vi.fn() }
  const service = new PluginService(deps); cleanups.push(() => service.dispose())
  await service.initialize(); await service.import(source, 'linked'); await service.setDevelopment(true); await service.enable(value.id, ['a', 'b'])
  await service.setContext('a', root, 'en', { id: 'dark', tokens: {} })
  const mount = async (view = 'details') => {
    const page = await service.mount(value.id, view, 'a', root); service.bind(page.instanceId, page.binding); return page
  }
  let sequence = 0
  const call = (page: Awaited<ReturnType<typeof mount>>, method: string, params = {}) => service.call(page.instanceId, page.binding,
    { protocol: 1, type: 'request', requestId: String(++sequence), method, params, contextRevision: page.context.revision }) as Promise<any>
  const get = (projectId: string | null = null, scopePath: string | null = null) => service.getConfiguration(value.id, projectId, scopePath) as Promise<PluginConfiguration>
  const update = (expectedRevision: string, patch: Record<string, string | number | boolean | null>, projectId: string | null = null, scopePath: string | null = null, reset = false) => service.updateConfiguration({
    type: 'configurationUpdate', id: value.id, projectId, scopePath, expectedRevision, patch, reset,
  }) as Promise<PluginConfiguration>
  return { directory, source, root, tree, other, value, service, deps, mount, call, get, update }
}

describe('declarative plugin configuration', () => {
  it('validates bounded, unambiguous declarative renames without scripts, chains or live source keys', async () => {
    const value = await manifest()
    value.capabilities.required.push('configuration.migrations')
    value.contributes.settingMigrations = [{ from: 'old-label', to: 'label' }]
    expect(parsePluginManifest(JSON.stringify(value)).contributes.settingMigrations).toHaveLength(1)
    for (const migrations of [
      [{ from: 'label', to: 'enabled' }], [{ from: 'old', to: 'missing' }],
      [{ from: 'constructor', to: 'label' }], [{ from: 'old', to: 'label', script: 'run()' }],
      [{ from: 'old', to: 'label' }, { from: 'other', to: 'label' }],
      [{ from: 'old', to: 'label' }, { from: 'old', to: 'enabled' }],
      [{ from: 'old', to: 'next' }, { from: 'next', to: 'label' }],
    ]) expect(() => parsePluginManifest(JSON.stringify({ ...value, contributes: { ...value.contributes, settingMigrations: migrations } }))).toThrow()
    const unsupported = structuredClone(value); unsupported.capabilities.required = unsupported.capabilities.required.filter(item => item !== 'configuration.migrations')
    expect(() => parsePluginManifest(JSON.stringify(unsupported))).toThrow()
    expect(() => validatePluginCall(value, 'configuration.migrate', {})).toThrow()
  })
  it('previews and explicitly migrates one layer atomically, preserving conflicts and notifying bound pages', async () => {
    const f = await fixture()
    const app = await f.get(); await f.update(app.revision, { label: 'App old', enabled: false, limit: 7, style: 'full' })
    const local = await f.get('a', f.root); await f.update(local.revision, { label: 'Local old', limit: 8 }, 'a', f.root)
    const upgraded = structuredClone(f.value)
    upgraded.capabilities.required.push('configuration.migrations')
    upgraded.contributes.settings![0].key = 'name'
    upgraded.contributes.settings![1].key = 'visible'
    upgraded.contributes.settings![2].key = 'maximum'
    upgraded.contributes.settings![3].key = 'mode'
    upgraded.contributes.settingMigrations = [{ from: 'label', to: 'name' }, { from: 'enabled', to: 'visible' }, { from: 'limit', to: 'maximum' }, { from: 'style', to: 'mode' }]
    const limit = upgraded.contributes.settings![2]; if (limit.type === 'number') limit.minimum = 9
    await writeFile(join(f.source, 'manifest.json'), JSON.stringify(upgraded)); await f.service.reload(f.value.id)
    let preview = await f.get() as PluginConfigurationState
    expect(preview.migrations).toEqual([
      { from: 'label', to: 'name', status: 'ready' }, { from: 'enabled', to: 'visible', status: 'ready' },
      { from: 'limit', to: 'maximum', status: 'incompatible' }, { from: 'style', to: 'mode', status: 'ready' },
    ])
    const page = await f.mount(); await f.call(page, 'configuration.watch'); f.deps.event.mockClear()
    const migrate = (revision: string, projectId: string | null = null, scopePath: string | null = null) => f.service.updateConfiguration({ type: 'configurationUpdate',
      id: f.value.id, projectId, scopePath, expectedRevision: revision, patch: {}, reset: false, migrate: true }) as Promise<PluginConfigurationState>
    const migrated = await migrate(preview.revision)
    expect(migrated.values).toMatchObject({ name: 'App old', visible: false, mode: 'full', maximum: 10 })
    expect(migrated.issues).toEqual(['limit'])
    expect(f.deps.event.mock.calls.some(([, packet]) => (packet as any).event === 'configuration' && (packet as any).payload.values.name === 'App old')).toBe(true)
    await expect(migrate(preview.revision)).rejects.toMatchObject({ code: 'CONFIGURATION_CONFLICT' })
    preview = await f.get('a', f.root) as PluginConfigurationState
    expect(preview.values.name).toBe('App old'); expect(preview.migrations[0]).toMatchObject({ from: 'label', status: 'ready' })
    const project = await migrate(preview.revision, 'a', f.root)
    expect(project.values.name).toBe('Local old'); expect((await f.get()).values.name).toBe('App old')
    expect((await f.get('a', f.tree)).values.name).toBe('App old')
    await expect(migrate(project.revision, 'a', f.root)).rejects.toMatchObject({ code: 'INVALID_REQUEST' })
    const publicSnapshot = await f.call(page, 'configuration.get')
    expect(publicSnapshot.result).not.toHaveProperty('migrations')
    expect(publicSnapshot.result.values).not.toHaveProperty('label')
    const beforeRuleChange = await f.get()
    const changedRules = structuredClone(upgraded); changedRules.contributes.settingMigrations!.pop()
    await writeFile(join(f.source, 'manifest.json'), JSON.stringify(changedRules)); await f.service.reload(f.value.id)
    await expect(migrate(beforeRuleChange.revision)).rejects.toMatchObject({ code: 'CONFIGURATION_CONFLICT' })
    // A destination explicitly saved by the user is never replaced, even by an old invalid value.
    const store = new PluginConfigurationStore(join(f.directory, 'isolated'))
    const initial = await store.run(() => store.get(f.value, null))
    await store.run(() => store.update(f.value, null, initial.revision, { label: 'Old' }, false, () => {}))
    const before = await store.run(() => store.get(upgraded, null))
    await store.run(() => store.update(upgraded, null, before.revision, { name: 'User choice' }, false, () => {}))
    const occupied = await store.run(() => store.management(upgraded, null))
    expect(occupied.migrations).toEqual([{ from: 'label', to: 'name', status: 'occupied' }])
    await expect(store.run(() => store.update(upgraded, null, occupied.revision, { name: 'Replace' }, false, () => {}, true))).rejects.toMatchObject({ code: 'INVALID_REQUEST' })
    expect((await store.run(() => store.management(upgraded, null))).values.name).toBe('User choice')
    // An application-only destination cannot consume an old project value.
    const oldProject = await store.run(() => store.get(f.value, 'project'))
    await store.run(() => store.update(f.value, 'project', oldProject.revision, { label: 'Local' }, false, () => {}))
    const appOnly = structuredClone(upgraded); appOnly.contributes.settings![0].scope = 'application'
    const scopePreview = await store.run(() => store.management(appOnly, 'project'))
    expect(scopePreview.migrations).toEqual([{ from: 'label', to: 'name', status: 'incompatible' }])
    await expect(store.run(() => store.update(appOnly, 'project', scopePreview.revision, {}, false, () => {}, true))).rejects.toMatchObject({ code: 'INVALID_REQUEST' })
    // Reopening the store preserves successful moves and blocked source values.
    const reopened = new PluginConfigurationStore(join(f.directory, 'profile/configuration'))
    const persisted = await reopened.run(() => reopened.management(changedRules, null))
    expect(persisted.values.name).toBe('App old'); expect(persisted.issues).toEqual(['limit'])
    const staleLayer = await store.run(() => store.management(upgraded, 'another-project'))
    await expect(store.run(() => store.update(upgraded, 'another-project', staleLayer.revision, {}, false, () => { throw new Error('revoked') }, true))).rejects.toThrow('revoked')
  })
  it('opens only own declared configuration from an active instance, with a shared plugin cooldown', async () => {
    const f = await fixture()
    const original = await manifest()
    expect(() => validatePluginCall(original, 'configuration.open', {})).toThrow()
    const navigation = structuredClone(original)
    navigation.capabilities.required.push('configuration.open')
    navigation.contributes.views.push({ ...navigation.contributes.views[0], id: 'application', scope: 'application' })
    expect(() => parsePluginManifest(JSON.stringify(navigation), { apiVersion: '1.0.0', capabilities: ['configuration.settings'] })).toThrow()
    const noSettings = structuredClone(navigation); delete noSettings.contributes.settings
    expect(() => parsePluginManifest(JSON.stringify(noSettings))).toThrow()
    for (const params of [{ pluginId: 'other.plugin' }, { scope: 'project' }, { projectId: 'b' }, { path: '/secret' }]) {
      expect(() => validatePluginCall(navigation, 'configuration.open', params)).toThrow()
    }
    await writeFile(join(f.source, 'manifest.json'), JSON.stringify(navigation))
    await f.service.reload(f.value.id)
    const page = await f.mount()
    expect(page.context.configurationNavigation).toBe(true)
    f.service.active(page.instanceId, page.binding, false)
    expect((await f.call(page, 'configuration.open')).error.code).toBe('CONTEXT_UNAVAILABLE')
    expect(f.deps.event).not.toHaveBeenCalled()
    f.service.active(page.instanceId, page.binding, true)
    expect((await f.call(page, 'configuration.open')).result).toEqual({ opened: true })
    expect(f.deps.event).toHaveBeenCalledWith(page.instanceId, { type: 'openConfiguration', pluginId: f.value.id, scope: 'project' })
    const second = await f.mount('summary')
    expect((await f.call(second, 'configuration.open')).error.code).toBe('RATE_LIMITED')
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 10_001)
    try {
      const application = await f.mount('application')
      expect((await f.call(application, 'configuration.open')).result).toEqual({ opened: true })
      expect(f.deps.event).toHaveBeenLastCalledWith(application.instanceId, { type: 'openConfiguration', pluginId: f.value.id, scope: 'application' })
    } finally { clock.mockRestore() }
    await f.service.disable(f.value.id)
    await expect(f.call(page, 'configuration.open')).rejects.toMatchObject({ code: 'INSTANCE_CLOSED' })
  })
  it('validates field types, defaults, bounds, keys, required capabilities and read permission', async () => {
    const original = await manifest()
    for (const change of [
      (m: any) => { m.contributes.settings[0].default = '' },
      (m: any) => { m.contributes.settings[0].key = 'constructor' },
      (m: any) => { m.contributes.settings[0].secret = true },
      (m: any) => { m.contributes.settings[1].default = 'true' },
      (m: any) => { m.contributes.settings[2].minimum = 50 },
      (m: any) => { m.contributes.settings[2].default = 1.5 },
      (m: any) => { m.contributes.settings[3].default = 'unknown' },
      (m: any) => { m.contributes.settings.push(m.contributes.settings[0]) },
      (m: any) => { m.permissions = m.permissions.filter((p: any) => p.name !== 'configuration.read') },
      (m: any) => { m.capabilities.required = m.capabilities.required.filter((c: string) => c !== 'configuration.settings') },
    ]) { const copy = structuredClone(original); change(copy); expect(() => parsePluginManifest(JSON.stringify(copy))).toThrow() }
    expect(() => parsePluginManifest(JSON.stringify(original), { apiVersion: '1.0.0', capabilities: [] })).toThrow()
    const noRead = structuredClone(original); noRead.permissions = noRead.permissions.filter(p => p.name !== 'configuration.read')
    expect(() => validatePluginCall(noRead, 'configuration.get', {})).toThrow()
    expect(() => validatePluginCall(original, 'configuration.get', { projectId: 'b' })).toThrow()
    expect(() => validatePluginCall(original, 'configuration.set', { label: 'unsafe' })).toThrow()
  })
  it('resolves defaults, application inheritance and isolated project/worktree overrides', async () => {
    const f = await fixture(); const initial = await f.get()
    expect(initial.values).toEqual({ label: 'Reference', enabled: true, limit: 10, style: 'compact' })
    const application = await f.update(initial.revision, { label: 'Global', enabled: false, limit: 15, style: 'full' })
    const project = await f.get('a', f.root)
    expect(project.values).toEqual(application.values); expect(project.overrides).toEqual({})
    const updated = await f.update(project.revision, { label: 'Project A' }, 'a', f.root)
    expect(updated.values.label).toBe('Project A'); expect(updated.inherited.label).toBe('Global')
    expect((await f.get('b', f.other)).values.label).toBe('Global')
    expect((await f.get('a', f.tree)).values.label).toBe('Global')
    expect((await f.get()).values.label).toBe('Global')
    await expect(f.update(updated.revision, { style: 'compact' }, 'a', f.root)).rejects.toMatchObject({ code: 'INVALID_REQUEST' })
    await expect(f.get('unapproved', f.root)).rejects.toMatchObject({ code: 'PERMISSION_DENIED' })
    await expect(f.get('a', f.other)).rejects.toThrow()
  })
  it('rejects invalid values and competing writes; parent changes invalidate an old project form', async () => {
    const f = await fixture(); const initial = await f.get()
    for (const patch of [{ label: '' }, { limit: 101 }, { limit: 1.2 }, { enabled: 'true' }, { style: 'bad' }, { undeclared: 1 }]) {
      await expect(f.update(initial.revision, patch)).rejects.toMatchObject({ code: 'INVALID_REQUEST' })
    }
    const project = await f.get('a', f.root)
    const writes = await Promise.allSettled([f.update(initial.revision, { label: 'First' }), f.update(initial.revision, { label: 'Second' })])
    expect(writes[0].status).toBe('fulfilled'); expect(writes[1]).toMatchObject({ status: 'rejected', reason: { code: 'CONFIGURATION_CONFLICT' } })
    await expect(f.update(project.revision, { label: 'Stale override' }, 'a', f.root)).rejects.toMatchObject({ code: 'CONFIGURATION_CONFLICT' })
    expect((await f.get()).values.label).toBe('First')
  })
  it('resets fields and scopes; disable/restart/uninstall preserve data and explicit delete clears it', async () => {
    const f = await fixture(); let app = await f.get()
    app = await f.update(app.revision, { label: 'Persisted' })
    let project = await f.get('a', f.root)
    project = await f.update(project.revision, { label: 'Local', enabled: false }, 'a', f.root)
    project = await f.update(project.revision, { label: null }, 'a', f.root)
    expect(project.values.label).toBe('Persisted'); expect(project.overrides).toEqual({ enabled: false })
    project = await f.update(project.revision, {}, 'a', f.root, true)
    expect(project.overrides).toEqual({}); expect(project.values.enabled).toBe(true)
    await f.service.disable(f.value.id)
    expect((await f.get()).values.label).toBe('Persisted')
    const restored = new PluginService(f.deps); cleanups.push(() => restored.dispose()); await restored.initialize()
    expect(await restored.getConfiguration(f.value.id, null, null)).toMatchObject({ values: { label: 'Persisted' } })
    restored.dispose()
    await f.service.uninstall(f.value.id); await f.service.import(f.source, 'linked')
    expect((await f.get()).values.label).toBe('Persisted')
    await f.service.deleteData(f.value.id)
    expect((await f.get()).values.label).toBe('Reference')
  })
  it('diagnoses incompatible upgraded values without deleting the persisted data', async () => {
    const f = await fixture(); const initial = await f.get()
    await f.update(initial.revision, { label: 'old value', limit: 80 })
    f.value.contributes.settings![0] = { key: 'label', title: 'New count', type: 'number', default: 2, scope: 'project' }
    f.value.contributes.settings = f.value.contributes.settings!.filter(setting => setting.key !== 'limit')
    await writeFile(join(f.source, 'manifest.json'), JSON.stringify(f.value)); await f.service.reload(f.value.id, true)
    const upgraded = await f.get()
    expect(upgraded.values.label).toBe(2); expect(upgraded.issues.sort()).toEqual(['label', 'limit'])
    await expect(f.update(initial.revision, { label: 3 })).rejects.toMatchObject({ code: 'CONFIGURATION_CONFLICT' })
    const directory = join(f.directory, 'profile/configuration')
    const [plugin] = await readdir(directory); const [file] = await readdir(join(directory, plugin))
    expect(await readFile(join(directory, plugin, file), 'utf8')).toContain('old value')
    expect((await f.update(upgraded.revision, { enabled: false })).issues).toContain('label')
  })
  it('atomically subscribes and publishes effective settings to both views, without crossing scope', async () => {
    const f = await fixture(); const first = await f.mount(); const second = await f.mount('summary')
    expect(first.context.configuration).toBe(true)
    for (const page of [first, second]) expect(await f.call(page, 'configuration.watch')).toMatchObject({ ok: true, result: { configuration: { values: { label: 'Reference' } }, subscriptionId: expect.any(String) } })
    let application = await f.get()
    application = await f.update(application.revision, { label: 'Live application' })
    let notifications = f.deps.event.mock.calls.filter(([, packet]) => (packet as any).event === 'configuration')
    expect(notifications.map(([id]) => id).sort()).toEqual([first.instanceId, second.instanceId].sort())
    expect((notifications[0][1] as any).payload.values.label).toBe('Live application')
    const project = await f.get('a', f.root); await f.update(project.revision, { label: 'Live project' }, 'a', f.root)
    f.deps.event.mockClear()
    await f.update(application.revision, { label: 'New application' })
    notifications = f.deps.event.mock.calls.filter(([, packet]) => (packet as any).event === 'configuration')
    expect((notifications[0][1] as any).payload.values.label).toBe('Live project')
    await f.service.setContext('b', f.other, 'en', { id: 'dark', tokens: {} })
    await expect(f.call(first, 'configuration.get')).rejects.toMatchObject({ code: 'INSTANCE_CLOSED' })
  })
  it('rejects a delayed configuration write after plugin revocation', async () => {
    const f = await fixture(); const application = await f.get()
    let release!: () => void
    const store = (f.service as any).configuration as PluginConfigurationStore
    const blocked = store.run(() => new Promise<void>(resolve => { release = resolve }))
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    const updating = f.update(application.revision, { label: 'late' })
    const rejected = expect(updating).rejects.toMatchObject({ code: 'STALE_CONTEXT' })
    await f.service.disable(f.value.id); release(); await blocked; await rejected
    expect((await f.get()).values.label).toBe('Reference')
  })
  it('keeps application pages on application values while project pages observe their own overrides', async () => {
    const f = await fixture()
    f.value.contributes.views.find(view => view.id === 'summary')!.scope = 'application'
    f.value.contributes.island![0].actions = f.value.contributes.island![0].actions!.filter(action => action !== 'open-summary')
    await writeFile(join(f.source, 'manifest.json'), JSON.stringify(f.value)); await f.service.reload(f.value.id, true)
    const application = await f.mount('summary'); const project = await f.mount()
    expect(application.context.project).toBeNull()
    await f.call(application, 'configuration.watch'); await f.call(project, 'configuration.watch')
    const local = await f.get('a', f.root); f.deps.event.mockClear()
    await f.update(local.revision, { label: 'Only project' }, 'a', f.root)
    const notifications = f.deps.event.mock.calls.filter(([, packet]) => (packet as any).event === 'configuration')
    expect(notifications.map(([id]) => id)).toEqual([project.instanceId])
    expect(await f.call(application, 'configuration.get')).toMatchObject({ ok: true, result: { values: { label: 'Reference' } } })
    expect(await f.call(project, 'configuration.get')).toMatchObject({ ok: true, result: { values: { label: 'Only project' } } })
  })
  it('fails closed on corrupt storage and never replaces it with defaults', async () => {
    const f = await fixture(); const application = await f.get()
    await f.update(application.revision, { label: 'Keep me' })
    const directory = join(f.directory, 'profile/configuration')
    const [plugin] = await readdir(directory); const [name] = await readdir(join(directory, plugin))
    const path = join(directory, plugin, name)
    await writeFile(path, '{broken')
    await expect(f.get()).rejects.toMatchObject({ code: 'STORAGE_UNAVAILABLE' })
    await expect(f.update(application.revision, { label: 'Overwrite' })).rejects.toMatchObject({ code: 'STORAGE_UNAVAILABLE' })
    expect(await readFile(path, 'utf8')).toBe('{broken')
  })
  it('keeps a committed application update successful when a subscriber scope is corrupt', async () => {
    const f = await fixture(); const project = await f.get('a', f.root)
    await f.update(project.revision, { label: 'Project subscriber' }, 'a', f.root)
    const page = await f.mount(); await f.call(page, 'configuration.watch')
    const directory = join(f.directory, 'profile/configuration')
    const [plugin] = await readdir(directory); const [name] = await readdir(join(directory, plugin))
    await writeFile(join(directory, plugin, name), '{broken')
    const application = await f.get()
    expect(await f.update(application.revision, { label: 'Committed application' })).toMatchObject({ values: { label: 'Committed application' } })
    expect(f.service.snapshot().logs).toContainEqual(expect.objectContaining({ code: 'STORAGE_UNAVAILABLE', method: 'configuration.watch' }))
  })
  it('folds events arriving before the SDK watch response into its returned snapshot and unsubscribes', async () => {
    const channel = new MessageChannel(); const client = createPluginClient(channel.port1, 1)
    cleanups.push(() => { client.close(); channel.port2.close() })
    const configuration = { values: { label: 'old' }, overrides: {}, inherited: {}, revision: 'old', issues: [] }
    channel.port2.onmessage = event => {
      if (event.data.method !== 'configuration.watch') return
      channel.port2.postMessage({ protocol: 1, type: 'event', event: 'configuration', subscriptionId: 'sub', payload: { ...configuration, values: { label: 'fresh' }, revision: 'fresh' } })
      channel.port2.postMessage({ protocol: 1, type: 'response', requestId: event.data.requestId, ok: true, result: { configuration, subscriptionId: 'sub' } })
    }
    const listener = vi.fn(); const result = await client.api.configuration.watch(listener)
    expect(result.configuration.values.label).toBe('fresh'); result.unsubscribe()
    channel.port2.postMessage({ protocol: 1, type: 'event', event: 'configuration', subscriptionId: 'sub', payload: configuration })
    await new Promise(resolve => setTimeout(resolve, 10)); expect(listener).not.toHaveBeenCalled()
  })
})
