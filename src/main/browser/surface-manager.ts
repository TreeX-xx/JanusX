// Note: native browsing and control targets — see .agents/notes/desktop/browser-surface.md
import { BrowserWindow, WebContentsView, shell } from 'electron'
import { randomUUID } from 'node:crypto'
import {
  type BrowserAgentControlEvent,
  type BrowserBounds,
  type BrowserCarrier,
  type BrowserResult,
  type BrowserSurfaceState,
  type CreateBrowserSurfaceRequest,
} from '../../shared/ipc/browser'
import { createStandaloneBrowserWindow } from '../windows/browser-window'

interface BrowserTab {
  tabId: string
  view: WebContentsView
  requestedUrl: string
  /** 最近一次主框架加载失败的错误描述；undefined 表示没有失败。 */
  loadError?: string
}

interface BrowserSurface {
  surfaceId: string
  carrier: BrowserCarrier
  tabs: Map<string, BrowserTab>
  activeTabId: string | null
  bounds: BrowserBounds | null
  standaloneWindow: BrowserWindow | null
  agentControlled: boolean
  options: BrowserSurfaceOptions
  /*-- 让位瞬间的冻结帧：detach 前 capturePage 的进行中结果，getHiddenFrame 等它 --*/
  hiddenFrame: Promise<string | null> | null
}

/** Host-owned profile, never accepted from the browser IPC request. */
export interface BrowserSurfaceOptions {
  partition?: string
  httpOnly?: boolean
  /** Content-only service hosts have no tab strip for popup pages. */
  externalPopups?: boolean
  openExternalUrl?: (url: string) => boolean
}

export interface BrowserSurfaceManagerDeps {
  getMainWindow: () => BrowserWindow | null
}

type StateListener = (surfaceId: string, state: BrowserSurfaceState) => void
type AgentControlListener = (surfaceId: string, event: BrowserAgentControlEvent) => void

import { isBrowserStartPageUrl, normalizeBrowserUrl } from '../../shared/browser-url'
/*-- URL 归一化规则住在 shared（浏览器 surface 与渲染层地址管理共用），此处再导出保持既有 import 不变 --*/
export { normalizeBrowserUrl }

/**
 * 浏览器 surface 管理器；用户浏览和 Agent 工具共用同一组原生标签。
 * 每 tab 一个 WebContentsView（主进程持有），仅活动 tab attach 到宿主窗口，其余 detach 保活；
 * popOut/embed 通过跨窗口 re-parent 切换载体，webContents 不销毁、导航历史保留。
 */
export class BrowserSurfaceManager {
  private surfaces = new Map<string, BrowserSurface>()
  private stateListeners = new Set<StateListener>()
  private agentControlListeners = new Set<AgentControlListener>()
  private showListeners = new Set<(surfaceId: string) => void>()

  onShowRequested(listener: (surfaceId: string) => void): () => void {
    this.showListeners.add(listener)
    return () => this.showListeners.delete(listener)
  }

  // Only ordinary browser guests are eligible; service partitions and the shell never enter this list.
  automationTabs(): Array<{ surfaceId: string; tabId: string; contents: Electron.WebContents; visible: boolean }> {
    return [...this.surfaces.values()].filter(surface => !surface.options.partition && !surface.options.httpOnly && !surface.options.externalPopups)
      .flatMap(surface => [...surface.tabs.values()].filter(tab => !tab.view.webContents.isDestroyed()).map(tab => ({
        surfaceId: surface.surfaceId, tabId: tab.tabId, contents: tab.view.webContents,
        visible: surface.activeTabId === tab.tabId && !!surface.bounds && surface.bounds.width > 0 && surface.bounds.height > 0 && !tab.loadError,
      })))
  }

  automationNewTab(url: string): number {
    const existing = [...this.surfaces.values()].find(surface => !surface.options.partition && !surface.options.httpOnly && !surface.options.externalPopups)
    if (existing) {
      const result = this.openTab(existing.surfaceId, url)
      if (!result.success) throw new Error(result.error)
      return this.getTab(existing.surfaceId, result.data.tabId)!.view.webContents.id
    }
    const surfaceId = randomUUID()
    const result = this.createSurface({ surfaceId, carrier: 'pane', url })
    if (!result.success) throw new Error(result.error)
    return this.automationTabs().find(tab => tab.surfaceId === surfaceId)!.contents.id
  }

  automationShow(surfaceId: string, tabId: string): void {
    this.activateTab(surfaceId, tabId)
    const standalone = this.surfaces.get(surfaceId)?.standaloneWindow
    if (standalone && !standalone.isDestroyed()) { standalone.show(); standalone.focus() }
    else for (const listener of this.showListeners) listener(surfaceId)
  }

  constructor(private deps: BrowserSurfaceManagerDeps) {}

  onStateChanged(listener: StateListener): () => void {
    this.stateListeners.add(listener)
    return () => this.stateListeners.delete(listener)
  }

  onAgentControlChanged(listener: AgentControlListener): () => void {
    this.agentControlListeners.add(listener)
    return () => this.agentControlListeners.delete(listener)
  }

  createSurface(request: CreateBrowserSurfaceRequest, options: BrowserSurfaceOptions = {}): BrowserResult<{ surfaceId: string }> {
    if (!request.surfaceId) return { success: false, error: 'Missing surfaceId' }
    if (this.surfaces.has(request.surfaceId)) return { success: false, error: 'Surface already exists' }
    if (options.httpOnly && !isHttpPage(request.url)) return { success: false, error: 'Unsupported page URL' }

    const surface: BrowserSurface = {
      surfaceId: request.surfaceId,
      carrier: request.carrier,
      tabs: new Map(),
      activeTabId: null,
      bounds: null,
      standaloneWindow: null,
      agentControlled: false,
      options,
      hiddenFrame: null,
    }
    this.surfaces.set(surface.surfaceId, surface)

    /*-- 独立窗口载体：先开窗再挂 tab，窗口被用户关闭时整体销毁 surface --*/
    if (surface.carrier === 'window') this.openStandaloneWindow(surface)

    const tab = this.createTab(surface, request.url)
    surface.tabs.set(tab.tabId, tab)
    surface.activeTabId = tab.tabId
    this.attachActiveTab(surface)
    this.emitState(surface)
    return { success: true, data: { surfaceId: surface.surfaceId } }
  }

  destroySurface(surfaceId: string): void {
    const surface = this.surfaces.get(surfaceId)
    if (!surface) return
    this.surfaces.delete(surfaceId)

    const mainWindow = this.deps.getMainWindow()
    for (const tab of surface.tabs.values()) {
      if (mainWindow && !mainWindow.isDestroyed()) this.detachView(mainWindow, tab.view)
      if (surface.standaloneWindow && !surface.standaloneWindow.isDestroyed()) {
        this.detachView(surface.standaloneWindow, tab.view)
      }
      this.destroyTabView(tab)
    }

    const standalone = surface.standaloneWindow
    surface.standaloneWindow = null
    if (standalone && !standalone.isDestroyed()) standalone.destroy()

    /*-- 推送销毁终态：渲染端据此移除本地 surface 状态（不读已销毁的 webContents） --*/
    this.notifyState(surfaceId, {
      surfaceId,
      carrier: surface.carrier,
      tabs: [],
      activeTabId: null,
      agentControlled: surface.agentControlled,
      destroyed: true,
    })
  }

  destroyAll(): void {
    for (const surfaceId of [...this.surfaces.keys()]) this.destroySurface(surfaceId)
  }

  popOut(surfaceId: string): BrowserResult<{ surfaceId: string }> {
    const surface = this.surfaces.get(surfaceId)
    if (!surface) return { success: false, error: 'Surface not found' }
    if (surface.carrier === 'window') {
      const win = surface.standaloneWindow
      if (!win || win.isDestroyed()) return { success: false, error: 'Browser window unavailable' }
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
      return { success: true, data: { surfaceId } }
    }

    /*-- 先从主窗口摘除全部 tab view，再切换载体；webContents 全程存活 --*/
    const mainWindow = this.deps.getMainWindow()
    if (mainWindow && !mainWindow.isDestroyed()) {
      for (const tab of surface.tabs.values()) this.detachView(mainWindow, tab.view)
    }
    surface.carrier = 'window'
    surface.bounds = null
    this.openStandaloneWindow(surface)
    this.emitState(surface)
    return { success: true, data: { surfaceId } }
  }

  embed(surfaceId: string): BrowserResult<{ surfaceId: string }> {
    const surface = this.surfaces.get(surfaceId)
    if (!surface) return { success: false, error: 'Surface not found' }
    if (surface.carrier !== 'window') return { success: false, error: 'Surface is not popped out' }

    const standalone = surface.standaloneWindow
    if (standalone && !standalone.isDestroyed()) {
      for (const tab of surface.tabs.values()) this.detachView(standalone, tab.view)
    }
    /*-- 先切回 pane 载体再关窗：closed 回调只在 carrier=window 时销毁 surface --*/
    surface.carrier = 'pane'
    surface.bounds = null
    surface.standaloneWindow = null
    if (standalone && !standalone.isDestroyed()) standalone.close()
    this.emitState(surface)
    return { success: true, data: { surfaceId } }
  }

  setBounds(surfaceId: string, bounds: BrowserBounds): void {
    const surface = this.surfaces.get(surfaceId)
    if (!surface) return
    /*-- 从可见转为让位的瞬间：detach 前抓住当前帧，让渲染层以冻结帧替代黑屏空场 --*/
    const wasVisible = Boolean(surface.bounds && surface.bounds.width > 0 && surface.bounds.height > 0)
    const willHide = !(bounds.width > 0 && bounds.height > 0)
    if (wasVisible && willHide && !surface.hiddenFrame) {
      const tab = surface.activeTabId ? surface.tabs.get(surface.activeTabId) ?? null : null
      if (tab) {
        surface.hiddenFrame = tab.view.webContents.capturePage()
          .then((image) => (image.isEmpty() ? null : image.toJPEG(72)))
          .then((bytes) => (bytes ? `data:image/jpeg;base64,${bytes.toString('base64')}` : null))
          .catch(() => null)
      }
    } else if (!wasVisible && !willHide) {
      /*-- 回到可见后冻结帧作废，下次让位重新抓 --*/
      surface.hiddenFrame = null
    }
    surface.bounds = bounds
    this.attachActiveTab(surface)
  }

  async getHiddenFrame(surfaceId: string): Promise<string | null> {
    const frame = this.surfaces.get(surfaceId)?.hiddenFrame
    return frame ? await frame : null
  }

  getState(surfaceId: string): BrowserSurfaceState | null {
    const surface = this.surfaces.get(surfaceId)
    return surface ? this.buildState(surface) : null
  }

  openTab(surfaceId: string, url?: string): BrowserResult<{ tabId: string }> {
    const surface = this.surfaces.get(surfaceId)
    if (!surface) return { success: false, error: 'Surface not found' }
    if (surface.options.httpOnly && !isHttpPage(url)) return { success: false, error: 'Unsupported page URL' }
    const tab = this.createTab(surface, url)
    surface.tabs.set(tab.tabId, tab)
    surface.activeTabId = tab.tabId
    this.attachActiveTab(surface)
    this.emitState(surface)
    return { success: true, data: { tabId: tab.tabId } }
  }

  closeTab(surfaceId: string, tabId: string): void {
    const surface = this.surfaces.get(surfaceId)
    const tab = surface?.tabs.get(tabId)
    if (!surface || !tab) return

    const host = this.hostWindowOf(surface)
    if (host && !host.isDestroyed()) this.detachView(host, tab.view)
    surface.tabs.delete(tabId)
    this.destroyTabView(tab)

    /*-- 关闭的是活动 tab 时切到剩余最后一个；全部关闭后 surface 保留为空 --*/
    if (surface.activeTabId === tabId) {
      const remaining = [...surface.tabs.keys()]
      surface.activeTabId = remaining.length > 0 ? remaining[remaining.length - 1] : null
      this.attachActiveTab(surface)
    }
    this.emitState(surface)
  }

  activateTab(surfaceId: string, tabId: string): void {
    const surface = this.surfaces.get(surfaceId)
    if (!surface || !surface.tabs.has(tabId)) return
    surface.activeTabId = tabId
    this.attachActiveTab(surface)
    this.emitState(surface)
  }

  navigate(surfaceId: string, tabId: string, url: string): void {
    if (this.surfaces.get(surfaceId)?.options.httpOnly && !isHttpPage(url)) return
    const tab = this.getTab(surfaceId, tabId)
    if (!tab) return
    tab.requestedUrl = normalizeBrowserUrl(url)
    /*-- 导航失败（证书错误、中断等）不抛错，加载态由 webContents 事件回流 --*/
    void tab.view.webContents.loadURL(tab.requestedUrl).catch(() => {})
  }

  goBack(surfaceId: string, tabId: string): void {
    this.getTab(surfaceId, tabId)?.view.webContents.navigationHistory.goBack()
  }

  goForward(surfaceId: string, tabId: string): void {
    this.getTab(surfaceId, tabId)?.view.webContents.navigationHistory.goForward()
  }

  reload(surfaceId: string, tabId: string): void {
    const tab = this.getTab(surfaceId, tabId)
    if (!tab) return
    if (tab.loadError && tab.requestedUrl) {
      void tab.view.webContents.loadURL(tab.requestedUrl).catch(() => {})
    } else {
      tab.view.webContents.reload()
    }
  }

  /*-- 主进程控制服务管理 Agent 控制指示，网页不接收此能力 --*/
  setAgentControlled(surfaceId: string, active: boolean): void {
    const surface = this.surfaces.get(surfaceId)
    if (!surface || surface.agentControlled === active) return
    surface.agentControlled = active
    const event: BrowserAgentControlEvent = { surfaceId, active }
    for (const listener of this.agentControlListeners) listener(surfaceId, event)
    this.emitState(surface)
  }

  getStandaloneWebContents(surfaceId: string): Electron.WebContents | null {
    const surface = this.surfaces.get(surfaceId)
    const win = surface?.standaloneWindow
    return win && !win.isDestroyed() ? win.webContents : null
  }

  private getTab(surfaceId: string, tabId: string): BrowserTab | null {
    return this.surfaces.get(surfaceId)?.tabs.get(tabId) ?? null
  }

  private hostWindowOf(surface: BrowserSurface): BrowserWindow | null {
    return surface.carrier === 'pane' ? this.deps.getMainWindow() : surface.standaloneWindow
  }

  private openStandaloneWindow(surface: BrowserSurface): void {
    const win = createStandaloneBrowserWindow(surface.surfaceId)
    surface.standaloneWindow = win
    win.on('closed', () => {
      surface.standaloneWindow = null
      /*-- 用户直接关闭独立窗口：surface 仍挂窗口载体则整体销毁 --*/
      if (surface.carrier === 'window' && this.surfaces.has(surface.surfaceId)) {
        this.destroySurface(surface.surfaceId)
      }
    })
  }

  private createTab(surface: BrowserSurface, url?: string): BrowserTab {
    const view = new WebContentsView({
      webPreferences: {
        /*-- 独立持久会话：网页 cookie/登录态与 JanusX 自身 UI 隔离 --*/
        partition: surface.options.partition ?? 'persist:janusx-browser',
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
      },
    })
    const tab: BrowserTab = { tabId: randomUUID(), view, requestedUrl: url ? normalizeBrowserUrl(url) : '' }

    /*-- 空白 tab 与加载过渡期间保持深色，避免白闪 --*/
    view.setBackgroundColor('#0a0a0a')

    /*-- 普通浏览器将弹窗转为新 tab；服务宿主可将其交给系统浏览器。 --*/
    view.webContents.setWindowOpenHandler((details) => {
      if (details.url.startsWith('http://') || details.url.startsWith('https://')) {
        if (surface.options.httpOnly && !isHttpPage(details.url)) return { action: 'deny' }
        if (!surface.options.openExternalUrl?.(details.url)) {
          if (surface.options.externalPopups) void shell.openExternal(details.url).catch(() => {})
          else this.openTab(surface.surfaceId, details.url)
        }
      } else if (!surface.options.httpOnly) {
        void shell.openExternal(details.url)
      }
      return { action: 'deny' }
    })

    if (surface.options.httpOnly) {
      // Service pages cannot navigate into local files or launch custom schemes.
      const guardNavigation = (event: Electron.Event, targetUrl: string): void => {
        if (!isHttpPage(targetUrl) || surface.options.openExternalUrl?.(targetUrl)) event.preventDefault()
      }
      view.webContents.on('will-navigate', guardNavigation)
      view.webContents.on('will-redirect', guardNavigation)
    }

    const emit = (): void => {
      if (this.surfaces.has(surface.surfaceId)) this.emitState(surface)
    }
    /*-- 加载失败要显式记录：否则自签证书被中止、端口没开这类失败完全静默，
         视图只停在 setBackgroundColor 的深色底上，用户看到的就是一块黑。 --*/
    view.webContents.on('did-navigate', (_event, navigatedUrl: string) => {
      if (navigatedUrl) tab.requestedUrl = navigatedUrl
      tab.loadError = undefined
      this.attachActiveTab(surface)
      emit()
    })
    view.webContents.on('did-start-loading', () => {
      tab.loadError = undefined
      this.attachActiveTab(surface)
      emit()
    })
    view.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      // ERR_ABORTED is normal when a navigation supersedes another navigation.
      if (errorCode === -3) return
      // 只在主框架失败时记录：子资源（图片/脚本）失败不该把整个页面标成坏的。
      if (isMainFrame) {
        if (validatedURL) tab.requestedUrl = validatedURL
        tab.loadError = errorDescription || 'Load failed'
        this.attachActiveTab(surface)
        console.warn(
          '[browser][load] did-fail-load',
          JSON.stringify({ surfaceId: surface.surfaceId, tabId: tab.tabId, errorCode, errorDescription, isMainFrame }),
        )
      }
      emit()
    })
    view.webContents.on('did-stop-loading', emit)
    view.webContents.on('page-title-updated', emit)

    if (url) void view.webContents.loadURL(tab.requestedUrl).catch(() => {})
    return tab
  }

  private destroyTabView(tab: BrowserTab): void {
    try {
      tab.view.webContents.close()
    } catch {
      /*-- webContents 可能已销毁 --*/
    }
  }

  private detachView(host: BrowserWindow, view: WebContentsView): void {
    try {
      host.contentView.removeChildView(view)
    } catch {
      /*-- view 可能不在该窗口上（如 re-parent 中途） --*/
    }
  }

  /*-- 仅活动 tab attach 到宿主窗口并应用最近 bounds；其余 tab detach 保活 --*/
  private attachActiveTab(surface: BrowserSurface): void {
    const host = this.hostWindowOf(surface)
    if (!host || host.isDestroyed()) return
    const active = surface.activeTabId ? surface.tabs.get(surface.activeTabId) ?? null : null
    const bounds = surface.bounds
    const showActive = active && !active.loadError
      && !isBrowserStartPageUrl(active.view.webContents.getURL() || active.requestedUrl)
      && bounds && bounds.width > 0 && bounds.height > 0

    for (const tab of surface.tabs.values()) {
      if (showActive && tab.tabId === active.tabId) continue
      this.detachView(host, tab.view)
    }
    if (!showActive) return
    active.view.setBounds(bounds)
    if (!host.contentView.children.includes(active.view)) host.contentView.addChildView(active.view)
  }

  private buildState(surface: BrowserSurface): BrowserSurfaceState {
    return {
      surfaceId: surface.surfaceId,
      carrier: surface.carrier,
      tabs: [...surface.tabs.values()].map((tab) => {
        const contents = tab.view.webContents
        return {
          tabId: tab.tabId,
          url: tab.loadError ? tab.requestedUrl : contents.getURL() || tab.requestedUrl,
          title: contents.getTitle(),
          isLoading: contents.isLoading(),
          canGoBack: contents.navigationHistory.canGoBack(),
          canGoForward: contents.navigationHistory.canGoForward(),
          ...(tab.loadError ? { loadError: tab.loadError } : {}),
        }
      }),
      activeTabId: surface.activeTabId,
      agentControlled: surface.agentControlled,
    }
  }

  private emitState(surface: BrowserSurface): void {
    this.notifyState(surface.surfaceId, this.buildState(surface))
  }

  private notifyState(surfaceId: string, state: BrowserSurfaceState): void {
    for (const listener of this.stateListeners) listener(surfaceId, state)
  }
}

function isHttpPage(input?: string): boolean {
  if (!input || input === 'about:blank') return true
  try {
    const url = new URL(normalizeBrowserUrl(input))
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
  } catch { return false }
}
