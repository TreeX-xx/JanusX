import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { parsePluginManifest, PLUGIN_CAPABILITIES } from '../../packages/plugin-sdk/src'
import { PluginService } from '../../src/main/plugins/service'
import { PluginWindowLayout, fitPluginWindow } from '../../src/main/plugins/window-layout'
import { PluginRuntime } from '../../src/main/plugins/runtime'

vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  class Contents extends EventEmitter {
    destroyed = false; url = ''; id = Math.random(); options: unknown; handler: unknown
    setWebRTCIPHandlingPolicy() {} setWindowOpenHandler(handler: unknown) { this.handler = handler }
    async loadURL(url: string) { this.url = url }
    getURL() { return this.url } isDestroyed() { return this.destroyed }
    close() { this.destroyed = true } postMessage() {} setDevToolsWebContents() {} openDevTools() {}
  }
  class View {
    webContents = new Contents(); bounds = {}; constructor(public options: unknown) {}
    setBackgroundColor() {} setBounds(bounds: unknown) { this.bounds = bounds }
  }
  class Window extends EventEmitter {
    static all: Window[] = []
    destroyed = false; visible = false; minimized = false; focused = false
    webContents = new Contents(); children: View[] = []; bounds: any
    contentView = { addChildView: (view: View) => this.children.push(view), removeChildView: (view: View) => { this.children = this.children.filter(item => item !== view) } }
    constructor(public options: any) { super(); this.bounds = { x: options.x ?? 0, y: options.y ?? 0, width: options.width ?? 720, height: options.height ?? 520 }; Window.all.push(this) }
    isDestroyed() { return this.destroyed } isVisible() { return this.visible } isMinimized() { return this.minimized } isFocused() { return this.focused }
    show() { this.visible = true; this.emit('show') } hide() { this.visible = false; this.emit('hide') }
    focus() { this.focused = true; this.emit('focus') } restore() { this.minimized = false; this.emit('restore') }
    getContentSize() { return [this.bounds.width, this.bounds.height] }
    getNormalBounds() { return this.bounds } setMenu() {}
    destroy() { if (this.destroyed) return; this.destroyed = true; this.emit('closed') }
    close() { this.emit('close'); this.destroy() }
  }
  const session = { fromPartition: () => ({ setProxy: async () => {}, enableNetworkEmulation() {}, setPermissionRequestHandler() {}, setPermissionCheckHandler() {},
    setDevicePermissionHandler() {}, on() {}, webRequest: { onBeforeRequest() {} }, protocol: { handle() {} } }) }
  return { session, WebContentsView: View, BrowserWindow: Window, MessageChannelMain: class {},
    screen: { getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1200, height: 800 } }), getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1200, height: 800 } }) } }
})
import { BrowserWindow } from 'electron'
const cleanups: Array<() => unknown> = []
afterEach(async () => { vi.restoreAllMocks(); for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); (BrowserWindow as any).all = [] })
async function manifest() {
  const data = JSON.parse(await readFile('packages/plugin-sdk/template/manifest.json', 'utf8'))
  data.capabilities.required.push('views.window'); data.permissions.push({ name: 'ui.windows' })
  data.contributes.views.push({ id: 'float', title: 'Project utility', location: 'window', scope: 'project', instancePolicy: 'single', entry: 'dist/index.html' },
    { id: 'app', title: 'Application utility', location: 'window', scope: 'application', instancePolicy: 'single', entry: 'dist/index.html' })
  return parsePluginManifest(JSON.stringify(data))
}
async function fixture() {
  const data = await manifest(); const directory = await mkdtemp(join(tmpdir(), 'janusx-plugin-windows-')); cleanups.push(() => rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }))
  const source = join(directory, 'source'); await mkdir(join(source, 'dist'), { recursive: true })
  await writeFile(join(source, 'manifest.json'), JSON.stringify(data)); await writeFile(join(source, 'dist/index.html'), '<p>Utility</p>'); await writeFile(join(source, 'dist/summary.html'), '<p>Summary</p>')
  const root = join(directory, 'root'); const other = join(directory, 'other'); await mkdir(root); await mkdir(other)
  let runtime!: PluginRuntime
  const service = new PluginService({ directory: join(directory, 'profile'), resolveProject: async (_id, scope) => ({ root: scope ?? root, name: 'Project' }), changed: vi.fn(), event: vi.fn(), openView: vi.fn(), toast: vi.fn(), closed: id => runtime?.close(id) })
  const failed = vi.fn(); const layout = new PluginWindowLayout(join(directory, 'layout.json'), failed)
  const host = new BrowserWindow({ width: 1200, height: 800 }); runtime = new PluginRuntime(service, () => host, layout)
  cleanups.push(() => { service.dispose(); runtime.dispose() })
  await service.initialize(); await service.setDevelopment(true); await service.import(source, 'linked'); await service.enable(data.id, ['a']); await service.setContext('a', root, 'en', { id: '', tokens: {} })
  const open = (view = 'float') => runtime.openWindow(data.id, view, 'a', root)
  const windows = () => (BrowserWindow as any).all.filter((item: any) => item !== host && !item.destroyed) as any[]
  return { data, directory, source, root, other, service, runtime, layout, failed, host, open, windows }
}

describe('P7 plugin window lifecycle', () => {
  it('requires explicit window permission and capability and rejects old hosts', async () => {
    const data = await manifest()
    expect(() => parsePluginManifest(JSON.stringify({ ...data, permissions: data.permissions.filter(item => item.name !== 'ui.windows') }))).toThrow()
    expect(() => parsePluginManifest(JSON.stringify({ ...data, capabilities: { ...data.capabilities, required: data.capabilities.required.filter(item => item !== 'views.window') } }))).toThrow()
    expect(() => parsePluginManifest(JSON.stringify(data), { apiVersion: '1.0.0', capabilities: PLUGIN_CAPABILITIES.filter(item => item !== 'views.window') })).toThrow()
  })
  it('coalesces opens into one isolated single-instance window and defers showing until uncovered', async () => {
    const f = await fixture(); await Promise.all([f.open(), f.open(), f.open()])
    expect(f.windows()).toHaveLength(1); const window = f.windows()[0]
    expect(window.visible).toBe(false); expect(window.children).toHaveLength(0)
    f.runtime.setCovered(false); expect(window.visible).toBe(true); expect(window.children).toHaveLength(1)
    expect(window.options.title).toContain(f.data.id); expect(window.options.webPreferences).toMatchObject({ sandbox: true, nodeIntegration: false, contextIsolation: true })
    expect(window.options.webPreferences).not.toHaveProperty('preload'); expect(window.options).not.toHaveProperty('alwaysOnTop')
    expect(window.children[0].options.webPreferences).toMatchObject({ sandbox: true, nodeIntegration: false, contextIsolation: true })
    await f.open(); expect(f.windows()).toHaveLength(1)
    const entry = [...(f.runtime as any).carriers.values()][0]
    f.runtime.setBounds(entry.mount.instanceId, entry.mount.binding, { x: 12, y: 12, width: 3, height: 3 })
    expect(window.children[0].bounds).toEqual({ x: 0, y: 0, width: 720, height: 520 })
  })
  it('covers all window content and restores it without revoking the page, and minimizes without closing', async () => {
    const f = await fixture(); f.runtime.setCovered(false); await f.open(); const window = f.windows()[0]
    const id = [...(f.runtime as any).carriers.keys()][0]
    f.runtime.setCovered(true); expect(window.children).toHaveLength(0); expect((f.service as any).instances.get(id).context.active).toBe(false)
    f.runtime.setCovered(false); expect(window.children).toHaveLength(1)
    window.minimized = true; window.emit('minimize'); expect(window.children).toHaveLength(0)
    window.restore(); expect(window.children).toHaveLength(1); expect((f.service as any).instances.size).toBe(1)
  })
  it('closes the instance and restores only geometry when explicitly reopened', async () => {
    const f = await fixture(); f.runtime.setCovered(false); await f.open(); const first = f.windows()[0]; const firstId = [...(f.runtime as any).carriers.keys()][0]
    first.bounds = { x: 85, y: 65, width: 640, height: 450 }; first.close()
    expect((f.service as any).instances.size).toBe(0); expect((f.runtime as any).carriers.size).toBe(0)
    await f.open(); expect(f.windows()[0].bounds).toEqual(first.bounds); expect([...(f.runtime as any).carriers.keys()][0]).not.toBe(firstId)
  })
  it('revokes project windows on worktree changes but keeps application windows alive', async () => {
    const f = await fixture(); f.runtime.setCovered(false); await f.open(); await f.open('app')
    await f.service.setContext('a', f.other, 'en', { id: '', tokens: {} })
    expect(f.windows()).toHaveLength(1); expect(f.windows()[0].options.title).toContain('Application utility')
    await expect(f.open()).rejects.toThrow()
    await f.runtime.openWindow(f.data.id, 'float', 'a', f.other); expect(f.windows()).toHaveLength(2)
    const window = f.windows().find(item => item.options.title.includes('Project utility'))
    expect(window.bounds).toEqual({ x: 240, y: 140, width: 720, height: 520 })
  })
  it.each(['disable', 'reload', 'development', 'uninstall', 'closeAll', 'failure'])('cleans windows and native contents on %s', async kind => {
    const f = await fixture(); await f.open(); const entry = [...(f.runtime as any).carriers.values()][0]
    if (kind === 'disable') await f.service.disable(f.data.id)
    if (kind === 'reload') await f.service.reload(f.data.id, true)
    if (kind === 'development') await f.service.setDevelopment(false)
    if (kind === 'uninstall') await f.service.uninstall(f.data.id)
    if (kind === 'closeAll') f.service.closeAll()
    if (kind === 'failure') f.service.failView(entry.mount.instanceId, entry.mount.binding)
    expect(f.windows()).toHaveLength(0); expect(entry.view.webContents.destroyed).toBe(true)
    expect((f.runtime as any).carriers.size).toBe(0); expect((f.service as any).instances.size).toBe(0)
  })
  it('rejects missing/ordinary views and stale requests instead of focusing a different project window', async () => {
    const f = await fixture(); expect(() => f.open('missing')).toThrow(); expect(() => f.open('details')).toThrow()
    await f.open(); await expect(f.runtime.openWindow(f.data.id, 'float', 'other', f.root)).rejects.toThrow()
    await expect(f.runtime.openWindow(f.data.id, 'float', 'a', f.other)).rejects.toThrow()
    expect(f.windows()).toHaveLength(1)
  })
  it('does not coalesce another project into a pending window creation', async () => {
    const f = await fixture(); const pending = f.open()
    expect(() => f.runtime.openWindow(f.data.id, 'float', 'other', f.root)).toThrow('Window context changed during creation.')
    expect(() => f.runtime.openWindow(f.data.id, 'float', 'a', f.other)).toThrow('Window context changed during creation.')
    await pending; expect(f.windows()).toHaveLength(1)
  })
  it('rejects activation changes during layout initialization without creating a late window', async () => {
    const f = await fixture(); const original = f.layout.initialize.bind(f.layout)
    vi.spyOn(f.layout, 'initialize').mockImplementation(async () => { await original(); await f.service.disable(f.data.id); await f.service.enable(f.data.id, ['a']) })
    await expect(f.open()).rejects.toThrow(); expect(f.windows()).toHaveLength(0); expect((f.runtime as any).carriers.size).toBe(0)
  })
  it('rejects a pending mount after the main host closes or navigates', async () => {
    const f = await fixture(); const pending = f.open()
    f.service.closeAll()
    await expect(pending).rejects.toThrow('Context changed while mounting.')
    expect(f.windows()).toHaveLength(0); expect((f.service as any).instances.size).toBe(0)
  })
  it('requires reauthorization when a window contribution changes with unchanged permissions', async () => {
    const f = await fixture(); f.data.contributes.views.find(view => view.id === 'float')!.scope = 'application'
    await writeFile(join(f.source, 'manifest.json'), JSON.stringify(f.data)); await f.service.reload(f.data.id)
    expect(f.service.snapshot().plugins[0].error).toBe('PERMISSION_RECONFIRM_REQUIRED'); expect(() => f.open()).toThrow()
  })
  it('enforces a four-window plugin budget including creation in progress', async () => {
    const f = await fixture(); const base = f.data.contributes.views.find(view => view.id === 'app')!
    f.data.contributes.views.push(...Array.from({ length: 5 }, (_, index) => ({ ...base, id: `utility-${index}` })))
    await writeFile(join(f.source, 'manifest.json'), JSON.stringify(f.data)); await f.service.reload(f.data.id); await f.service.enable(f.data.id, ['a'])
    const pending = Array.from({ length: 4 }, (_, index) => f.open(`utility-${index}`))
    expect(() => f.open('utility-4')).toThrow('Plugin window limit reached.')
    await Promise.all(pending); expect(f.windows()).toHaveLength(4)
    f.windows()[0].close(); await f.open('utility-4'); expect(f.windows()).toHaveLength(4)
  })
  it('persists validated geometry across store instances, clamps removed displays and falls back on corruption', async () => {
    const f = await fixture(); await f.layout.initialize(); const key = 'a'.repeat(64); const bounds = { x: 1700, y: -500, width: 900, height: 600 }
    await f.layout.save(key, bounds); const restored = new PluginWindowLayout(join(f.directory, 'layout.json'), f.failed); await restored.initialize()
    expect(restored.get(key)).toEqual(bounds); expect(fitPluginWindow(restored.get(key), { x: 0, y: 0, width: 800, height: 500 })).toEqual({ x: 0, y: 0, width: 800, height: 500 })
    await restored.save('invalid-key', bounds); await restored.save(key, { ...bounds, width: Number.NaN }); expect(restored.get(key)).toEqual(bounds)
    await writeFile(join(f.directory, 'layout.json'), '{bad'); const corrupt = new PluginWindowLayout(join(f.directory, 'layout.json'), f.failed); await corrupt.initialize()
    expect(corrupt.get(key)).toBeUndefined(); expect(f.failed).toHaveBeenCalledOnce()
  })
})
