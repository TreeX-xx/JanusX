import { afterEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { InstalledPlugin } from '../../src/shared/ipc/plugins'
import type { PluginService } from '../../src/main/plugins/service'
import { NativeDesktop } from '../../src/main/plugins/native-desktop'
import { PluginRuntime } from '../../src/main/plugins/runtime'

const h = vi.hoisted(() => ({ external: vi.fn(async () => {}), copy: vi.fn(), open: vi.fn(async () => ''),
  encrypted: true, proxy: vi.fn(async () => 'http://127.0.0.1:1234'), closeProxy: vi.fn(), sessions: new Map<string, any>() }))
vi.mock('../../src/main/lib/host-proxy', () => ({ HostProxy: class { start = h.proxy; close = h.closeProxy }, hostProxyEnvironment: () => ({ NO_PROXY: 'localhost' }) }))
vi.mock('../../src/main/config/service', () => ({ configService: { get: async () => ({ cpaSettings: { mode: 'external', managementUrl: 'localhost:8317' } }) } }))
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  class Contents extends EventEmitter {
    destroyed = false; url = ''; handler: any
    setWebRTCIPHandlingPolicy() {} setWindowOpenHandler(handler: any) { this.handler = handler }
    loadURL = vi.fn(async (url: string) => { this.url = url })
    isDestroyed() { return this.destroyed } close() { this.destroyed = true }
  }
  class View { webContents = new Contents(); bounds: any = {}; constructor(public options: any) {} setBounds(rect: any) { this.bounds = rect } getBounds() { return this.bounds } }
  return { WebContentsView: View, shell: { openExternal: h.external, openPath: h.open }, clipboard: { writeText: h.copy },
    app: { getPath: () => 'C:/test-profile' }, safeStorage: { isEncryptionAvailable: () => h.encrypted, getSelectedStorageBackend: () => 'keyring',
      encryptString: (text: string) => Buffer.from('encrypted:' + text), decryptString: (value: Buffer) => value.toString().slice(10) },
    session: { fromPartition: (partition: string) => {
      if (!h.sessions.has(partition)) h.sessions.set(partition, { setProxy: vi.fn(async () => {}), setPermissionRequestHandler: vi.fn(), setPermissionCheckHandler: vi.fn(),
        setDevicePermissionHandler: vi.fn(), on: vi.fn(), webRequest: { onBeforeRequest: vi.fn(), onCompleted: vi.fn(), onErrorOccurred: vi.fn() } })
      return h.sessions.get(partition)
    } },
  }
})
import { WebContentsView } from 'electron'
afterEach(() => { vi.clearAllMocks(); h.sessions.clear(); h.encrypted = true })

function fixture() {
  const inspect = vi.fn(), service = { inspect } as unknown as PluginService
  const runtime = new PluginRuntime(service, () => null), owner = randomUUID()
  const parent = new WebContentsView(); parent.setBounds({ x: 100, y: 60, width: 600, height: 400 })
  const children = new Set(), contentView = { addChildView: (view: unknown) => children.add(view), removeChildView: (view: unknown) => children.delete(view) }
  const carrier: any = { plugin: 'official.cpa', mount: { instanceId: owner, binding: 'binding' }, view: parent, attached: { contentView } }
  ;(runtime as any).carriers.set(owner, carrier)
  const native = vi.fn(async () => null)
  const call = (method: string, input: any = {}) => runtime.browserCall('official.cpa', `desktop.browser.${method}`, { ...input, owner }, native)
  return { runtime, carrier, children, owner, call, inspect, native }
}
describe('trusted native desktop and isolated browser', () => {
  it('requires a live owning page for terminal access and restricts service links to local HTTP', async () => {
    const f = fixture(), openBrowser = vi.fn()
    const desktop = new NativeDesktop({ manifest: { id: 'official.docker', capabilities: { required: ['desktop.native', 'desktop.containers'] } } } as InstalledPlugin, () => f.runtime, () => null as never, openBrowser)
    const call = (method: string, value: any) => desktop.call(method, value, new AbortController().signal)
    await expect(call('desktop.terminal.read', { owner: f.owner, id: 'unknown' })).rejects.toMatchObject({ code: 'INSTANCE_CLOSED' })
    await expect(call('desktop.service.open', { url: 'https://example.test/' })).rejects.toMatchObject({ code: 'INVALID_REQUEST' })
    await expect(call('desktop.service.open', { url: 'file:///etc/passwd' })).rejects.toMatchObject({ code: 'INVALID_REQUEST' })
    await call('desktop.service.open', { url: 'http://127.0.0.1:8080/' })
    expect(openBrowser).toHaveBeenCalledWith('http://127.0.0.1:8080/')
    desktop.dispose()
  })
  it('authorizes desktop callbacks explicitly and shares one proxy until activation disposal', async () => {
    const f = fixture(), record = { manifest: { id: 'official.cpa', capabilities: { required: ['runtime.native', 'desktop.native'] } } } as InstalledPlugin
    const desktop = new NativeDesktop(record, () => f.runtime, () => ({ call: f.native }) as never)
    expect(await desktop.call('desktop.encrypt', { text: 'fixture-key' }, new AbortController().signal)).toBe(Buffer.from('encrypted:fixture-key').toString('base64'))
    await Promise.all([desktop.call('desktop.proxy', null, new AbortController().signal), desktop.call('desktop.proxy', null, new AbortController().signal)])
    expect(h.proxy).toHaveBeenCalledOnce()
    expect(h.closeProxy).not.toHaveBeenCalled()
    desktop.dispose()
    expect(h.closeProxy).toHaveBeenCalledOnce()
    await expect(desktop.call('desktop.proxy', null, new AbortController().signal)).rejects.toMatchObject({ code: 'SERVICE_STOPPED' })
    const denied = new NativeDesktop({ manifest: { capabilities: { required: ['runtime.native'] } } } as InstalledPlugin, () => f.runtime, () => null as never)
    await expect(denied.call('desktop.encrypt', { text: 'key' }, new AbortController().signal)).rejects.toMatchObject({ code: 'PERMISSION_DENIED' })
  })
  it('rejects unsafe URLs and paths, restricts legacy mapping and refuses unprotected encryption', async () => {
    const f = fixture(), desktop = new NativeDesktop({ manifest: { id: 'other.plugin', capabilities: { required: ['desktop.native'] } } } as InstalledPlugin, () => f.runtime, () => null as never)
    const call = (method: string, value: any) => desktop.call(method, value, new AbortController().signal)
    expect(await call('desktop.legacy', {})).toBeNull()
    await expect(call('desktop.external', { url: 'file:///secret' })).rejects.toMatchObject({ code: 'INVALID_REQUEST' })
    await expect(call('desktop.openPath', { path: 'C:/secret' })).rejects.toMatchObject({ code: 'PATH_NOT_GRANTED' })
    await call('desktop.openPath', { path: join('C:/test-profile/janusx/plugins/data/other.plugin/native', 'components/cpa.log') })
    expect(h.open).toHaveBeenCalledOnce()
    h.encrypted = false
    await expect(call('desktop.encrypt', { text: 'fixture' })).rejects.toMatchObject({ code: 'ENCRYPTION_UNAVAILABLE' })
    desktop.dispose()
  })
  it('uses a separate sandbox with no preload or bridge and preserves the legacy origin login partition', async () => {
    const f = fixture()
    await f.call('open', { url: 'http://127.0.0.1:8317/management.html', direct: true })
    const browser = f.carrier.browser
    expect(browser.view.options.webPreferences).toMatchObject({ sandbox: true, nodeIntegration: false, contextIsolation: true })
    expect(browser.view.options.webPreferences).not.toHaveProperty('preload')
    expect([...h.sessions.keys()][0]).toMatch(/^persist:janusx-cpa-[a-f0-9]{24}$/)
    expect([...h.sessions.values()][0].setProxy).toHaveBeenCalledWith({ mode: 'direct' })
    expect(f.children.size).toBe(0)
    await f.call('bounds', { rect: { x: 5, y: 30, width: 900, height: 500 } })
    expect(browser.view.bounds).toEqual({ x: 105, y: 90, width: 595, height: 370 })
    expect(f.children.has(browser.view)).toBe(true)
    await f.call('bounds', { rect: { x: 0, y: 0, width: 0, height: 0 } })
    expect(f.children.size).toBe(0)
    f.runtime.closeBrowsers('official.cpa')
    expect(browser.view.webContents.destroyed).toBe(true)
    expect(f.native).not.toHaveBeenCalled()
  })
  it('denies stale or foreign owners and cancels an opening guest when the page closes', async () => {
    const f = fixture()
    await expect(f.runtime.browserCall('other.plugin', 'desktop.browser.open', { owner: f.owner, url: 'http://localhost' }, f.native)).rejects.toMatchObject({ code: 'INSTANCE_CLOSED' })
    const first = f.call('open', { url: 'http://localhost:8317' })
    await f.call('close')
    await expect(first).rejects.toMatchObject({ code: 'INSTANCE_CLOSED' })
    expect(f.carrier.browser).toBeUndefined()
  })
  it('blocks navigation outside the management origin and routes only HTTP links externally', async () => {
    const f = fixture()
    await f.call('open', { url: 'http://localhost:8317/management.html' })
    const contents = f.carrier.browser.view.webContents
    const event = { preventDefault: vi.fn() }
    contents.emit('will-navigate', event, 'file:///secret')
    expect(event.preventDefault).toHaveBeenCalledOnce()
    contents.emit('will-navigate', event, 'http://localhost:8317/login')
    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(contents.handler({ url: 'javascript:alert(1)' })).toEqual({ action: 'deny' })
    expect(h.external).not.toHaveBeenCalled()
    contents.handler({ url: 'https://example.test/help' })
    expect(h.external).toHaveBeenCalledWith('https://example.test/help')
    await f.call('close')
  })
  it('recovers a failed guest on reopen without duplicating session listeners', async () => {
    const f = fixture()
    await f.call('open', { url: 'http://localhost:8317' })
    const first = f.carrier.browser
    first.view.webContents.emit('render-process-gone')
    expect(await f.call('status')).toMatchObject({ error: true })
    await f.call('open', { url: 'http://localhost:8317' })
    expect(f.carrier.browser).not.toBe(first)
    expect(first.view.webContents.destroyed).toBe(true)
    expect([...h.sessions.values()][0].on).toHaveBeenCalledOnce()
    await f.call('close')
  })
})
