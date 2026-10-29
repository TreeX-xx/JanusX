// Note: .agents/notes/workbench/plugin-contract-v1.md — isolated, offline native carriers.
import { session, shell, WebContentsView, MessageChannelMain, BrowserWindow, screen, type Session, type MessagePortMain } from 'electron'
import { z } from 'zod'
import { BrowserOAuthBridge, type BrowserOAuth, type OAuthFallback } from './browser-oauth'
import { extname, join } from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { createServer, type Server } from 'node:net'
import type { JsonValue, NativeHandler } from '@janusx/plugin-sdk'
import { PluginError } from '@janusx/plugin-sdk'
import type { PluginMount, PluginBounds } from '../../shared/ipc/plugins'
import type { PluginService } from './service'
import { PluginWindowLayout, fitPluginWindow } from './window-layout'

const mime: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon' }
interface Carrier { mount: PluginMount; view: WebContentsView; port?: MessagePortMain; attached?: BrowserWindow; inspector?: BrowserWindow
  plugin?: string; browserRevision?: number; browser?: { view: WebContentsView; rect?: PluginBounds; url: string; bridge?: BrowserOAuthBridge; fallback?: OAuthFallback; externalError?: boolean; loadError?: boolean }
  window?: BrowserWindow; windowKey?: string; layoutKey?: string; layoutTimer?: ReturnType<typeof setTimeout>; windowPending?: boolean }

export class PluginRuntime {
  private carriers = new Map<string, Carrier>()
  private sessions = new Map<string, Promise<Session>>()
  private browserSessions = new WeakSet<Session>()
  private partition = randomUUID()
  private proxy?: Promise<{ server: Server; port: number }>
  private windows = new Map<string, Carrier>()
  private opening = new Map<string, { projectId: string | null; scopePath: string | null; promise: Promise<void> }>()
  private covered = true
  constructor(private service: PluginService, private getWindow: () => BrowserWindow | null, private layout?: PluginWindowLayout) {}
  // Note: .agents/notes/workbench/plugin-contract-v1.md — window ownership never transfers plugin privileges.
  openWindow(plugin: string, view: string, projectId: string | null, scopePath: string | null): Promise<void> {
    const definition = this.service.windowView(plugin, view)
    const key = `${plugin}/${view}`
    const existing = this.windows.get(key)
    if (existing?.window && !existing.window.isDestroyed()) {
      this.service.inspect(existing.mount.instanceId, existing.mount.binding)
      return this.service.validateWindowContext(existing.mount.instanceId, existing.mount.binding, projectId, scopePath).then(() => {
        if (!this.covered && existing.window && !existing.window.isDestroyed()) { existing.window.restore(); existing.window.show(); existing.window.focus() }
        else existing.windowPending = true
      })
    }
    const pending = this.opening.get(key)
    if (pending) {
      if (definition.scope === 'project' && (pending.projectId !== projectId || pending.scopePath !== scopePath)) throw new PluginError('STALE_CONTEXT', 'Window context changed during creation.')
      return pending.promise
    }
    const own = [...this.windows.keys(), ...this.opening.keys()].filter(key => key.startsWith(`${plugin}/`)).length
    if (this.windows.size + this.opening.size >= 16 || own >= 4) throw new PluginError('RATE_LIMITED', 'Plugin window limit reached.')
    const operation = (async () => {
      const mount = await this.service.mount(plugin, view, definition.scope === 'project' ? projectId : null, definition.scope === 'project' ? scopePath : null)
      try {
        await this.layout?.initialize()
        await this.create(plugin, mount)
        this.service.inspect(mount.instanceId, mount.binding)
        const carrier = this.carriers.get(mount.instanceId)!
        const layoutKey = createHash('sha256').update(JSON.stringify([plugin, view, mount.context.project?.rootId ?? 'application'])).digest('hex')
        const saved = this.layout?.get(layoutKey)
        const area = saved ? screen.getDisplayMatching(saved).workArea : screen.getPrimaryDisplay().workArea
        const bounds = fitPluginWindow(saved, area)
        const window = new BrowserWindow({ ...bounds, minWidth: 320, minHeight: 240, maxWidth: 2400, maxHeight: 1800,
          title: definition.title, show: false, autoHideMenuBar: true, backgroundColor: '#f5f2e8',
          webPreferences: { partition: `janusx-plugin-window-${this.partition}`, sandbox: true, contextIsolation: true, nodeIntegration: false } })
        window.setMenu(null)
        window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
        window.webContents.on('will-navigate', event => event.preventDefault())
        window.webContents.on('will-frame-navigate', event => event.preventDefault())
        carrier.window = window; carrier.windowKey = key; carrier.layoutKey = layoutKey; carrier.windowPending = true
        this.windows.set(key, carrier)
        const update = () => this.updateWindow(carrier)
        window.on('resize', () => { update(); this.saveWindowLater(carrier) })
        window.on('move', () => this.saveWindowLater(carrier))
        window.on('show', update); window.on('hide', update); window.on('focus', update)
        window.on('blur', update); window.on('minimize', update); window.on('restore', update)
        window.on('close', () => this.saveWindow(carrier))
        window.on('closed', () => this.service.close(mount.instanceId, mount.binding))
        update()
      } catch (cause) { this.service.close(mount.instanceId); throw cause }
    })().finally(() => this.opening.delete(key))
    this.opening.set(key, { projectId, scopePath, promise: operation })
    return operation
  }
  setCovered(covered: boolean): void {
    this.covered = covered
    for (const carrier of this.windows.values()) this.updateWindow(carrier)
    if (covered) for (const carrier of this.carriers.values()) carrier.inspector?.hide()
  }
  private updateWindow(carrier: Carrier): void {
    const window = carrier.window
    if (!window || window.isDestroyed()) return
    try {
      this.service.inspect(carrier.mount.instanceId, carrier.mount.binding)
      if (!this.covered && carrier.windowPending) { carrier.windowPending = false; window.show(); window.focus() }
      const visible = !this.covered && window.isVisible() && !window.isMinimized()
      this.service.active(carrier.mount.instanceId, carrier.mount.binding, visible && window.isFocused())
      if (!visible) { this.detach(carrier); return }
      if (carrier.attached !== window) { this.detach(carrier); window.contentView.addChildView(carrier.view); carrier.attached = window }
      const [width, height] = window.getContentSize()
      carrier.view.setBounds({ x: 0, y: 0, width, height })
    } catch { this.close(carrier.mount.instanceId) }
  }
  private saveWindowLater(carrier: Carrier): void {
    clearTimeout(carrier.layoutTimer)
    carrier.layoutTimer = setTimeout(() => this.saveWindow(carrier), 200)
  }
  private saveWindow(carrier: Carrier): void {
    clearTimeout(carrier.layoutTimer)
    if (carrier.window && !carrier.window.isDestroyed() && carrier.layoutKey) void this.layout?.save(carrier.layoutKey, carrier.window.getNormalBounds())
  }
  private privateSession(plugin: string): Promise<Session> {
    let pending = this.sessions.get(plugin)
    if (!pending) {
      pending = (async () => {
        const isolated = session.fromPartition(`janusx-plugin-${this.partition}-${plugin}`, { cache: false })
        // WebRTC bypasses webRequest/CSP. Force TCP through an unreachable proxy,
        // disallow direct UDP, and put this private network context offline.
        const sink = await (this.proxy ??= new Promise((resolve, reject) => {
          const server = createServer(socket => socket.destroy())
          server.once('error', reject)
          server.listen(0, '127.0.0.1', () => resolve({ server, port: (server.address() as { port: number }).port }))
        }))
        await isolated.setProxy({ mode: 'fixed_servers', proxyRules: `http=127.0.0.1:${sink.port};https=127.0.0.1:${sink.port};socks=socks5://127.0.0.1:${sink.port}`, proxyBypassRules: '<-loopback>' })
        isolated.enableNetworkEmulation({ offline: true })
        isolated.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
        isolated.setPermissionCheckHandler(() => false)
        isolated.setDevicePermissionHandler(() => false)
        isolated.on('will-download', event => event.preventDefault())
        isolated.webRequest.onBeforeRequest((details, callback) => {
          const carrier = [...this.carriers.values()].find(item => item.view.webContents.id === details.webContentsId)
          const allowed = Boolean(carrier && (details.url === carrier.mount.url || this.service.frameMatchesResource(carrier.mount.url, details.url))
            && this.service.resource(details.url))
          if (!allowed) this.service.log('RESOURCE_DENIED')
          callback({ cancel: !allowed })
        })
        isolated.protocol.handle('janusx-plugin', request => {
          const resource = this.service.resource(request.url)
          if (!resource || request.method !== 'GET') return new Response('Unavailable', { status: 404 })
          const prefix = request.url.slice(0, request.url.indexOf('/', request.url.indexOf('/g/') + 3) + 1)
          return new Response(new Uint8Array(resource.bytes), { headers: {
            'Content-Type': mime[extname(resource.path)] ?? 'application/octet-stream', 'Access-Control-Allow-Origin': '*',
            'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store', 'X-DNS-Prefetch-Control': 'off',
            'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), usb=(), serial=(), payment=(), clipboard-read=(), clipboard-write=()',
            'Content-Security-Policy': `default-src 'none'; script-src ${prefix}; style-src ${prefix} 'unsafe-inline'; img-src ${prefix} data:; connect-src 'none'; frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; sandbox allow-scripts`,
          } })
        })
        return isolated
      })()
      this.sessions.set(plugin, pending)
    }
    return pending
  }
  async create(plugin: string, mount: PluginMount): Promise<void> {
    const isolated = await this.privateSession(plugin)
    this.service.inspect(mount.instanceId, mount.binding)
    const view = new WebContentsView({ webPreferences: { session: isolated, sandbox: true, contextIsolation: true, nodeIntegration: false,
      nodeIntegrationInSubFrames: false, webSecurity: true, webviewTag: false, spellcheck: false, preload: join(__dirname, '../../preload/plugin.cjs') } })
    const carrier: Carrier = { mount, view, plugin }
    this.carriers.set(mount.instanceId, carrier)
    view.setBackgroundColor('#00000000')
    const contents = view.webContents
    contents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp')
    contents.setWindowOpenHandler(() => ({ action: 'deny' }))
    contents.on('will-navigate', event => { event.preventDefault(); this.service.log('NAVIGATION_DENIED', { pluginId: plugin, instanceId: mount.instanceId }) })
    contents.on('will-frame-navigate', event => event.preventDefault())
    contents.on('render-process-gone', () => this.service.failView(mount.instanceId, mount.binding))
    let connected = false
    contents.on('did-finish-load', () => {
      if (connected) { this.service.failView(mount.instanceId, mount.binding); return }
      try {
        if (contents.getURL() !== mount.url) throw new Error('Unexpected plugin document')
        this.service.bind(mount.instanceId, mount.binding)
        const { port1, port2 } = new MessageChannelMain()
        carrier.port = port1; connected = true
        port1.on('close', () => {
          // Host-driven teardown removes the carrier first; an unexpected peer
          // disconnect must revoke the unusable page and its "connected" state.
          if (this.carriers.get(mount.instanceId) === carrier) this.service.failView(mount.instanceId, mount.binding)
        })
        let count = 0; let since = Date.now()
        port1.on('message', event => {
          if (Date.now() - since >= 1000) { since = Date.now(); count = 0 }
          if (++count > 128) return
          void this.service.call(mount.instanceId, mount.binding, event.data).then(response => {
            if (response && this.carriers.get(mount.instanceId) === carrier) port1.postMessage(response)
          }).catch(() => {})
        })
        port1.start()
        contents.postMessage('janusx:plugin-port', { contextRevision: mount.context.revision }, [port2])
      } catch { this.service.failView(mount.instanceId, mount.binding) }
    })
    void contents.loadURL(mount.url).catch(() => this.service.failView(mount.instanceId, mount.binding))
  }
  send(id: string, packet: JsonValue): void {
    try { this.carriers.get(id)?.port?.postMessage(packet) } catch { /* A crashed document may close its port before the process event. */ }
  }
  /** Trusted native service requests a separate online guest; that guest never receives the plugin port. */
  async browserCall(plugin: string, method: string, input: Record<string, JsonValue>, native: NativeHandler): Promise<JsonValue> {
    const owner = z.string().uuid().parse(input.owner)
    const carrier = this.carriers.get(owner)
    if (!carrier || carrier.plugin !== plugin || carrier.window) throw new PluginError('INSTANCE_CLOSED', 'Browser owner is unavailable.')
    this.service.inspect(owner, carrier.mount.binding)
    if (method === 'desktop.browser.close') { this.closeBrowser(carrier); return null }
    if (method === 'desktop.browser.status') {
      return { fallback: carrier.browser?.fallback as unknown as JsonValue ?? null,
        externalError: carrier.browser?.externalError ?? false,
        error: carrier.browser?.loadError || carrier.browser?.view.webContents.isDestroyed() || false }
    }
    if (method === 'desktop.browser.bounds') {
      const rect = z.object({ x: z.number().finite().nonnegative(), y: z.number().finite().nonnegative(), width: z.number().finite().nonnegative(), height: z.number().finite().nonnegative() }).strict().parse(input.rect)
      if (carrier.browser) { carrier.browser.rect = rect; this.layoutBrowser(carrier) }
      return null
    }
    if (method !== 'desktop.browser.open') throw new PluginError('UNKNOWN_METHOD', 'Unknown browser operation.')
    const url = new URL(z.string().max(2048).parse(input.url))
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search) throw new PluginError('INVALID_REQUEST', 'Unsupported service URL.')
    if (carrier.browser?.url === url.href && !carrier.browser.loadError && !carrier.browser.view.webContents.isDestroyed()) return null
    this.closeBrowser(carrier)
    const revision = carrier.browserRevision
    const identity = createHash('sha256').update(url.origin).digest('hex').slice(0, 24)
    // Keep the legacy CPA login partition for the same origin; all new providers get a private profile.
    const partition = plugin === 'official.cpa' ? `persist:janusx-cpa-${identity}` : `persist:janusx-plugin-browser-${plugin}-${identity}`
    const online = session.fromPartition(partition)
    await online.setProxy({ mode: input.direct === true ? 'direct' : 'system' })
    this.service.inspect(owner, carrier.mount.binding)
    if (this.carriers.get(owner) !== carrier || carrier.browserRevision !== revision) throw new PluginError('INSTANCE_CLOSED', 'Browser owner closed or changed.')
    const view = new WebContentsView({ webPreferences: { session: online, sandbox: true, contextIsolation: true, nodeIntegration: false, nodeIntegrationInSubFrames: false, webSecurity: true, webviewTag: false } })
    const browser: NonNullable<Carrier['browser']> = { view, url: url.href }
    carrier.browser = browser
    online.setPermissionRequestHandler((_web, _permission, callback) => callback(false))
    online.setPermissionCheckHandler(() => false)
    online.setDevicePermissionHandler(() => false)
    if (!this.browserSessions.has(online)) {
      online.on('will-download', event => event.preventDefault())
      this.browserSessions.add(online)
    }
    view.webContents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp')
    const oauth = input.oauth ? z.object({ prefix: z.string().startsWith('/').max(200), auth: z.string().startsWith('/').max(200),
      status: z.string().startsWith('/').max(200), session: z.string().startsWith('/').max(200),
      providers: z.record(z.object({ port: z.number().int().min(1024).max(65535), urls: z.array(z.string().url()).max(4) }).strict()).refine(value => Object.keys(value).length <= 8),
    }).strict().parse(input.oauth) as BrowserOAuth : undefined
    const external = (target: string) => {
      let address: URL
      try { address = new URL(target) } catch { return }
      if (!['http:', 'https:'].includes(address.protocol) || address.username || address.password) return
      browser.bridge?.observeAuthorization(target)
      browser.externalError = false
      void shell.openExternal(target).catch(() => { browser.externalError = true })
    }
    if (oauth) browser.bridge = new BrowserOAuthBridge(online, url.origin, fallback => { browser.fallback = fallback }, oauth,
      undefined, async (state, signal) => {
        const result = await native('browser.oauth-status', { input: { state }, project: null }, signal)
        return typeof result === 'string' ? result : undefined
      })
    view.webContents.setWindowOpenHandler(({ url: target }) => { external(target); return { action: 'deny' } })
    const navigation = (event: Electron.Event, target: string) => {
      let address: URL
      try { address = new URL(target) } catch { event.preventDefault(); return }
      const authorize = oauth && Object.values(oauth.providers).some(provider => provider.urls.includes(address.origin + address.pathname))
      if (authorize) { event.preventDefault(); external(target) }
      else if (address.origin !== url.origin || !['http:', 'https:'].includes(address.protocol) || address.username || address.password) event.preventDefault()
    }
    view.webContents.on('will-navigate', navigation)
    view.webContents.on('will-redirect', navigation)
    view.webContents.on('will-frame-navigate', event => navigation(event, event.url))
    view.webContents.on('render-process-gone', () => { browser.loadError = true })
    // Browser bounds remain empty until the plugin explicitly allocates its content rectangle.
    void view.webContents.loadURL(url.href).catch(() => { browser.loadError = true })
    return null
  }
  closeBrowsers(plugin: string): void {
    for (const carrier of this.carriers.values()) if (carrier.plugin === plugin) this.closeBrowser(carrier)
  }
  private closeBrowser(carrier: Carrier): void {
    carrier.browserRevision = (carrier.browserRevision ?? 0) + 1
    const browser = carrier.browser
    if (!browser) return
    carrier.browser = undefined
    try { carrier.attached?.contentView.removeChildView(browser.view) } catch { /* Window closed. */ }
    browser.bridge?.dispose()
    if (!browser.view.webContents.isDestroyed()) browser.view.webContents.close({ waitForBeforeUnload: false })
  }
  private layoutBrowser(carrier: Carrier): void {
    const browser = carrier.browser
    if (!browser || !carrier.attached) return
    const parent = carrier.view.getBounds(), rect = browser.rect
    const x = Math.min(parent.width, Math.round(rect?.x ?? 0)), y = Math.min(parent.height, Math.round(rect?.y ?? 0))
    const width = Math.max(0, Math.min(parent.width - x, Math.round(rect?.width ?? 0)))
    const height = Math.max(0, Math.min(parent.height - y, Math.round(rect?.height ?? 0)))
    if (!width || !height) { try { carrier.attached.contentView.removeChildView(browser.view) } catch { /* Already hidden. */ }; return }
    browser.view.setBounds({ x: parent.x + x, y: parent.y + y, width, height })
    carrier.attached.contentView.addChildView(browser.view)
  }
  setBounds(id: string, binding: string, bounds: PluginBounds): void {
    this.service.inspect(id, binding)
    const carrier = this.carriers.get(id); const window = this.getWindow()
    if (!carrier || carrier.window || !window || window.isDestroyed()) return
    const [width, height] = window.getContentSize()
    const x = Math.max(0, Math.min(width, Math.round(bounds.x))); const y = Math.max(0, Math.min(height, Math.round(bounds.y)))
    const clipped = { x, y, width: Math.max(0, Math.min(width - x, Math.round(bounds.width))), height: Math.max(0, Math.min(height - y, Math.round(bounds.height))) }
    if (!clipped.width || !clipped.height) { this.detach(carrier); return }
    if (carrier.attached !== window) { this.detach(carrier); window.contentView.addChildView(carrier.view); carrier.attached = window }
    carrier.view.setBounds(clipped)
    this.layoutBrowser(carrier)
  }
  inspect(id: string, binding: string): void {
    this.service.inspect(id, binding)
    const carrier = this.carriers.get(id)
    if (!carrier) return
    if (carrier.inspector && !carrier.inspector.isDestroyed()) { carrier.inspector.show(); carrier.inspector.focus(); return }
    // DevTools' trusted frontend has its own Session; it must not relax the
    // plugin Session's deny-all resource policy to load inspector assets.
    const inspector = new BrowserWindow({ width: 900, height: 650, webPreferences: { partition: `janusx-plugin-inspector-${this.partition}`,
      sandbox: true, nodeIntegration: false, contextIsolation: true } })
    carrier.inspector = inspector
    inspector.on('closed', () => { carrier.inspector = undefined })
    carrier.view.webContents.setDevToolsWebContents(inspector.webContents)
    carrier.view.webContents.openDevTools({ mode: 'detach' })
  }
  private detach(carrier: Carrier): void {
    try { if (carrier.browser) carrier.attached?.contentView.removeChildView(carrier.browser.view) } catch { /* Already hidden. */ }
    try { carrier.attached?.contentView.removeChildView(carrier.view) } catch { /* Host may already be gone. */ }
    carrier.attached = undefined
  }
  close(id: string): void {
    const carrier = this.carriers.get(id)
    if (!carrier) return
    this.closeBrowser(carrier)
    this.carriers.delete(id); this.saveWindow(carrier); carrier.port?.close(); this.detach(carrier)
    if (carrier.windowKey && this.windows.get(carrier.windowKey) === carrier) this.windows.delete(carrier.windowKey)
    if (carrier.window && !carrier.window.isDestroyed()) carrier.window.destroy()
    if (carrier.inspector && !carrier.inspector.isDestroyed()) carrier.inspector.destroy()
    if (!carrier.view.webContents.isDestroyed()) carrier.view.webContents.close({ waitForBeforeUnload: false })
  }
  dispose(): void {
    for (const id of [...this.carriers.keys()]) this.close(id)
    void this.proxy?.then(sink => sink.server.close()).catch(() => {})
  }
}
