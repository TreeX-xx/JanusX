import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserSurfaceState } from '../../src/shared/ipc/browser'

const h = vi.hoisted(() => {
  type Handler = (...args: unknown[]) => void

  class MockWebContents {
    static nextId = 1
    id = MockWebContents.nextId++
    isDestroyed = vi.fn(() => false)
    handlers: Record<string, Handler[]> = {}
    loadURL = vi.fn(() => Promise.resolve())
    reload = vi.fn()
    close = vi.fn()
    setWindowOpenHandler = vi.fn()
    capturePage = vi.fn(async () => ({
      isEmpty: () => false,
      toJPEG: () => Buffer.from('fake-jpeg'),
    }))
    getURL = vi.fn(() => 'https://example.com/')
    getTitle = vi.fn(() => 'Example')
    isLoading = vi.fn(() => false)
    navigationHistory = {
      canGoBack: vi.fn(() => false),
      canGoForward: vi.fn(() => false),
      goBack: vi.fn(),
      goForward: vi.fn(),
    }
    on(event: string, cb: Handler): void {
      ;(this.handlers[event] ??= []).push(cb)
    }
    emit(event: string, ...args: unknown[]): void {
      for (const cb of this.handlers[event] ?? []) cb(...args)
    }
  }

  class MockWebContentsView {
    static instances: MockWebContentsView[] = []
    webContents = new MockWebContents()
    setBounds = vi.fn()
    setBackgroundColor = vi.fn()
    constructor(readonly options?: unknown) {
      MockWebContentsView.instances.push(this)
    }
  }

  class MockBrowserWindow {
    isMinimized = vi.fn(() => true)
    restore = vi.fn()
    show = vi.fn()
    focus = vi.fn()
    static instances: MockBrowserWindow[] = []
    contentView = {
      children: [] as MockWebContentsView[],
      addChildView: (view: MockWebContentsView): void => {
        if (!this.contentView.children.includes(view)) this.contentView.children.push(view)
      },
      removeChildView: (view: MockWebContentsView): void => {
        const index = this.contentView.children.indexOf(view)
        if (index >= 0) this.contentView.children.splice(index, 1)
      },
    }
    webContents = new MockWebContents()
    handlers: Record<string, Handler[]> = {}
    destroyed = false
    constructor() {
      MockBrowserWindow.instances.push(this)
    }
    on(event: string, cb: Handler): void {
      ;(this.handlers[event] ??= []).push(cb)
    }
    emitClosed(): void {
      if (this.destroyed) return
      this.destroyed = true
      for (const cb of this.handlers['closed'] ?? []) cb()
    }
    isDestroyed(): boolean {
      return this.destroyed
    }
    close(): void {
      this.emitClosed()
    }
    destroy(): void {
      this.emitClosed()
    }
  }

  return { MockWebContents, MockWebContentsView, MockBrowserWindow, openExternal: vi.fn() }
})

vi.mock('electron', () => ({
  WebContentsView: h.MockWebContentsView,
  BrowserWindow: h.MockBrowserWindow,
  shell: { openExternal: h.openExternal },
}))

vi.mock('../../src/main/windows/browser-window', () => ({
  createStandaloneBrowserWindow: vi.fn(() => new h.MockBrowserWindow()),
}))

import { BrowserSurfaceManager, normalizeBrowserUrl } from '../../src/main/browser/surface-manager'

describe('normalizeBrowserUrl', () => {
  it('keeps explicit schemes', () => {
    expect(normalizeBrowserUrl('http://a.dev')).toBe('http://a.dev')
    expect(normalizeBrowserUrl('https://a.dev/x?q=1')).toBe('https://a.dev/x?q=1')
    expect(normalizeBrowserUrl('file:///C:/a.html')).toBe('file:///C:/a.html')
  })

  it('routes loopback hosts to http', () => {
    expect(normalizeBrowserUrl('localhost:3000')).toBe('http://localhost:3000')
    expect(normalizeBrowserUrl('127.0.0.1:8080/path')).toBe('http://127.0.0.1:8080/path')
  })

  it('defaults everything else to https', () => {
    expect(normalizeBrowserUrl('example.com')).toBe('https://example.com')
    expect(normalizeBrowserUrl('  docs.example.com/a ')).toBe('https://docs.example.com/a')
  })
})

describe('BrowserSurfaceManager', () => {
  let mainWindow: InstanceType<typeof h.MockBrowserWindow>
  let manager: BrowserSurfaceManager
  let states: BrowserSurfaceState[]

  const lastState = (): BrowserSurfaceState => states[states.length - 1]

  beforeEach(() => {
    h.MockWebContentsView.instances = []
    h.MockBrowserWindow.instances = []
    mainWindow = new h.MockBrowserWindow()
    manager = new BrowserSurfaceManager({ getMainWindow: () => mainWindow as never })
    states = []
    manager.onStateChanged((_id, state) => states.push(state))
  })

  it('waits for layout bounds before attaching a new pane surface', () => {
    const result = manager.createSurface({ surfaceId: 's1', carrier: 'pane' })
    expect(result).toEqual({ success: true, data: { surfaceId: 's1' } })

    const view = h.MockWebContentsView.instances[0]
    expect(mainWindow.contentView.children).not.toContain(view)
    expect(view.setBounds).not.toHaveBeenCalled()

    const state = lastState()
    expect(state.carrier).toBe('pane')
    expect(state.tabs).toHaveLength(1)
    expect(state.activeTabId).toBe(state.tabs[0].tabId)
    expect(state.tabs[0]).toMatchObject({ url: 'https://example.com/', title: 'Example', isLoading: false })
  })

  it('rejects duplicate surface ids', () => {
    manager.createSurface({ surfaceId: 's1', carrier: 'pane' })
    expect(manager.createSurface({ surfaceId: 's1', carrier: 'pane' }).success).toBe(false)
  })

  it('reuses an empty ordinary surface and excludes service and destroyed guests from control', () => {
    manager.createSurface({ surfaceId: 'browser', carrier: 'pane' })
    manager.closeTab('browser', manager.getState('browser')!.activeTabId!)
    manager.createSurface({ surfaceId: 'cpa', carrier: 'pane' }, { partition: 'persist:cpa', httpOnly: true })
    const id = manager.automationNewTab('https://example.com/')
    expect(manager.automationTabs().map(tab => [tab.surfaceId, tab.contents.id])).toEqual([['browser', id]])
    const listener = vi.fn()
    const unsubscribe = manager.onShowRequested(listener)
    manager.automationShow('browser', manager.getState('browser')!.activeTabId!)
    expect(listener).toHaveBeenCalledWith('browser')
    unsubscribe()
    h.MockWebContentsView.instances.at(-1)!.webContents.isDestroyed.mockReturnValue(true)
    expect(manager.automationTabs()).toEqual([])
  })

  it('keeps blank native tabs detached so the host start page remains usable', () => {
    manager.createSurface({ surfaceId: 'start', carrier: 'pane' })
    const view = h.MockWebContentsView.instances[0]
    view.webContents.getURL.mockReturnValue('')
    const tabId = manager.getState('start')!.activeTabId!
    manager.setBounds('start', { x: 10, y: 80, width: 900, height: 600 })
    expect(mainWindow.contentView.children).toHaveLength(0)

    manager.navigate('start', tabId, 'localhost:3000')
    view.webContents.getURL.mockReturnValue('http://localhost:3000')
    view.webContents.emit('did-navigate', {}, 'http://localhost:3000')
    expect(mainWindow.contentView.children).toEqual([view])

    view.webContents.getURL.mockReturnValue('about:blank')
    view.webContents.emit('did-navigate', {}, 'about:blank')
    expect(mainWindow.contentView.children).toHaveLength(0)
    manager.popOut('start')
    const standalone = h.MockBrowserWindow.instances[1]
    manager.setBounds('start', { x: 0, y: 80, width: 900, height: 600 })
    expect(standalone.contentView.children).toHaveLength(0)
    expect(view.webContents.close).not.toHaveBeenCalled()
  })

  it('uses a host-owned service partition without a preload or Node bridge', () => {
    manager.createSurface({ surfaceId: 'cpa', carrier: 'pane', url: 'http://localhost:8317/management.html' }, {
      partition: 'persist:janusx-cpa-test', httpOnly: true,
    })
    expect(h.MockWebContentsView.instances[0].options).toEqual({ webPreferences: {
      partition: 'persist:janusx-cpa-test', nodeIntegration: false,
      contextIsolation: true, sandbox: true, webSecurity: true,
    } })
  })

  it('freezes one frame per yield and drops it once the view is visible again', async () => {
    manager.createSurface({ surfaceId: 's1', carrier: 'pane', url: 'http://localhost:3000' })
    const view = h.MockWebContentsView.instances[0]
    view.webContents.getURL.mockReturnValue('http://localhost:3000')
    manager.setBounds('s1', { x: 10, y: 80, width: 900, height: 600 })
    expect(mainWindow.contentView.children).toEqual([view])
    expect(view.webContents.capturePage).not.toHaveBeenCalled()

    // Yielding to an overlay captures exactly once, even across repeated zero reports.
    manager.setBounds('s1', { x: 0, y: 0, width: 0, height: 0 })
    expect(mainWindow.contentView.children).toHaveLength(0)
    manager.setBounds('s1', { x: 0, y: 0, width: 0, height: 0 })
    expect(view.webContents.capturePage).toHaveBeenCalledTimes(1)
    expect(await manager.getHiddenFrame('s1')).toMatch(/^data:image\/jpeg;base64,/)

    // Back to visible invalidates the frame; the next yield captures fresh.
    manager.setBounds('s1', { x: 10, y: 80, width: 900, height: 600 })
    manager.setBounds('s1', { x: 0, y: 0, width: 0, height: 0 })
    expect(view.webContents.capturePage).toHaveBeenCalledTimes(2)
    expect(await manager.getHiddenFrame('s1')).toMatch(/^data:image\/jpeg;base64,/)
    expect(await manager.getHiddenFrame('missing')).toBeNull()
  })

  it('restricts service navigation and popups to web pages without changing ordinary browser behavior', () => {
    manager.createSurface({ surfaceId: 'cpa', carrier: 'pane', url: 'http://localhost:8317/management.html' }, { httpOnly: true })
    const view = h.MockWebContentsView.instances[0]
    const tabId = manager.getState('cpa')!.activeTabId!
    for (const url of ['file:///C:/secret', 'javascript:alert(1)', 'custom://launch', 'https://user:secret@example.com']) {
      expect(manager.openTab('cpa', url).success).toBe(false)
      manager.navigate('cpa', tabId, url)
      const preventDefault = vi.fn()
      view.webContents.emit('will-navigate', { preventDefault }, url)
      expect(preventDefault).toHaveBeenCalledOnce()
      view.webContents.emit('will-redirect', { preventDefault }, url)
      expect(preventDefault).toHaveBeenCalledTimes(2)
    }
    expect(view.webContents.loadURL).toHaveBeenCalledTimes(1)
    const popup = view.webContents.setWindowOpenHandler.mock.calls[0][0] as (details: { url: string }) => unknown
    const externalCalls = h.openExternal.mock.calls.length
    expect(popup({ url: 'custom://launch' })).toEqual({ action: 'deny' })
    expect(h.openExternal.mock.calls).toHaveLength(externalCalls)
    popup({ url: 'https://accounts.example.com/login' })
    expect(manager.getState('cpa')!.tabs).toHaveLength(2)
    expect(manager.createSurface({ surfaceId: 'invalid-cpa', carrier: 'pane', url: 'file:///C:/local' }, { httpOnly: true }).success).toBe(false)
  })

  it('hands selected service authorization popups and redirects to its host without creating guest tabs', () => {
    const authUrl = 'https://auth.openai.com/oauth/authorize?state=fixture'
    const openExternalUrl = vi.fn((url: string) => url === authUrl)
    manager.createSurface({ surfaceId: 'cpa', carrier: 'pane', url: 'http://localhost:8317/management.html' }, { httpOnly: true, openExternalUrl })
    const view = h.MockWebContentsView.instances[0]
    const popup = view.webContents.setWindowOpenHandler.mock.calls[0][0] as (details: { url: string }) => unknown
    expect(popup({ url: authUrl })).toEqual({ action: 'deny' })
    expect(manager.getState('cpa')!.tabs).toHaveLength(1)
    for (const event of ['will-navigate', 'will-redirect']) {
      const preventDefault = vi.fn()
      view.webContents.emit(event, { preventDefault }, authUrl)
      expect(preventDefault).toHaveBeenCalledOnce()
      preventDefault.mockClear()
      view.webContents.emit(event, { preventDefault }, 'http://localhost:8317/management.html#/quota')
      expect(preventDefault).not.toHaveBeenCalled()
    }
    popup({ url: 'https://example.com/help' })
    expect(manager.getState('cpa')!.tabs).toHaveLength(2)
  })

  it('keeps content-only service popups external without bypassing URL restrictions or OAuth handling', () => {
    const authUrl = 'https://auth.openai.com/oauth/authorize?state=fixture'
    const openExternalUrl = vi.fn((url: string) => url === authUrl)
    manager.createSurface({ surfaceId: 'cpa', carrier: 'pane', url: 'http://localhost:8317/management.html' }, {
      httpOnly: true, externalPopups: true, openExternalUrl,
    })
    const view = h.MockWebContentsView.instances[0]
    const popup = view.webContents.setWindowOpenHandler.mock.calls[0][0] as (details: { url: string }) => unknown
    h.openExternal.mockResolvedValue(undefined)
    popup({ url: 'https://example.com/help' })
    expect(h.openExternal).toHaveBeenCalledWith('https://example.com/help')
    expect(manager.getState('cpa')!.tabs).toHaveLength(1)
    h.openExternal.mockClear()
    popup({ url: authUrl })
    expect(openExternalUrl).toHaveBeenCalledWith(authUrl)
    expect(h.openExternal).not.toHaveBeenCalled()
    for (const url of ['file:///C:/secret', 'custom://launch', 'https://user:secret@example.com']) popup({ url })
    expect(h.openExternal).not.toHaveBeenCalled()
    const preventDefault = vi.fn()
    view.webContents.emit('will-navigate', { preventDefault }, 'http://localhost:8317/management.html#/quota')
    expect(preventDefault).not.toHaveBeenCalled()
  })

  it('attaches only the active tab and keeps others detached', () => {
    manager.createSurface({ surfaceId: 's1', carrier: 'pane' })
    manager.setBounds('s1', { x: 10, y: 20, width: 300, height: 200 })
    const first = h.MockWebContentsView.instances[0]
    const second = manager.openTab('s1', 'example.com/two')
    expect(second.success).toBe(true)
    const secondView = h.MockWebContentsView.instances[1]

    expect(mainWindow.contentView.children).toContain(secondView)
    expect(mainWindow.contentView.children).not.toContain(first)
    expect(lastState().activeTabId).toBe(second.success ? second.data.tabId : null)

    const firstTabId = lastState().tabs[0].tabId
    manager.activateTab('s1', firstTabId)
    expect(mainWindow.contentView.children).toContain(first)
    expect(mainWindow.contentView.children).not.toContain(secondView)
    expect(lastState().activeTabId).toBe(firstTabId)
  })

  it('keeps the surface alive with zero tabs after closing the last tab', () => {
    manager.createSurface({ surfaceId: 's1', carrier: 'pane' })
    const tabId = lastState().tabs[0].tabId
    const view = h.MockWebContentsView.instances[0]

    manager.closeTab('s1', tabId)
    expect(view.webContents.close).toHaveBeenCalled()
    expect(mainWindow.contentView.children).toHaveLength(0)

    const state = lastState()
    expect(state.tabs).toHaveLength(0)
    expect(state.activeTabId).toBeNull()
    expect(manager.getState('s1')).not.toBeNull()
  })

  it('activates the remaining tab when the active tab is closed', () => {
    manager.createSurface({ surfaceId: 's1', carrier: 'pane' })
    manager.setBounds('s1', { x: 10, y: 20, width: 300, height: 200 })
    const firstTabId = lastState().tabs[0].tabId
    manager.openTab('s1')
    const secondTabId = lastState().activeTabId as string

    manager.closeTab('s1', secondTabId)
    expect(lastState().activeTabId).toBe(firstTabId)
    expect(mainWindow.contentView.children).toContain(h.MockWebContentsView.instances[0])
  })

  it('applies bounds to the active tab view', () => {
    manager.createSurface({ surfaceId: 's1', carrier: 'pane' })
    const view = h.MockWebContentsView.instances[0]
    manager.setBounds('s1', { x: 10, y: 20, width: 300, height: 200 })
    expect(view.setBounds).toHaveBeenCalledWith({ x: 10, y: 20, width: 300, height: 200 })
  })

  it('normalizes navigate input and delegates history/reload calls', () => {
    manager.createSurface({ surfaceId: 's1', carrier: 'pane' })
    const tabId = lastState().tabs[0].tabId
    const contents = h.MockWebContentsView.instances[0].webContents

    manager.navigate('s1', tabId, 'localhost:5173')
    expect(contents.loadURL).toHaveBeenCalledWith('http://localhost:5173')
    manager.navigate('s1', tabId, 'example.com/docs')
    expect(contents.loadURL).toHaveBeenCalledWith('https://example.com/docs')

    manager.goBack('s1', tabId)
    manager.goForward('s1', tabId)
    manager.reload('s1', tabId)
    expect(contents.navigationHistory.goBack).toHaveBeenCalled()
    expect(contents.navigationHistory.goForward).toHaveBeenCalled()
    expect(contents.reload).toHaveBeenCalled()
  })

  it('pushes state on webContents navigation events', () => {
    manager.createSurface({ surfaceId: 's1', carrier: 'pane' })
    const contents = h.MockWebContentsView.instances[0].webContents
    const before = states.length
    contents.emit('page-title-updated')
    contents.emit('did-navigate')
    expect(states.length).toBe(before + 2)
  })

  it('records a main-frame load failure and clears it on the next navigation', () => {
    manager.createSurface({ surfaceId: 's1', carrier: 'pane', url: 'https://localhost:9443' })
    const contents = h.MockWebContentsView.instances[0].webContents
    const tabId = lastState().tabs[0].tabId

    // 自签证书被中止这类失败必须显式记录，否则视图只停在深色底上，用户看到一块黑。
    contents.emit('did-fail-load', {}, -202, 'net::ERR_CERT_AUTHORITY_INVALID', 'https://localhost:9443/', true)
    expect(lastState().tabs[0]).toMatchObject({ tabId, loadError: 'net::ERR_CERT_AUTHORITY_INVALID' })

    contents.emit('did-start-loading')
    expect(lastState().tabs[0].loadError).toBeUndefined()

    contents.emit('did-fail-load', {}, -202, 'net::ERR_CERT_AUTHORITY_INVALID', 'https://localhost:9443/', true)
    expect(lastState().tabs[0].loadError).toBe('net::ERR_CERT_AUTHORITY_INVALID')
    contents.emit('did-navigate')
    expect(lastState().tabs[0].loadError).toBeUndefined()
  })

  it('ignores a sub-frame load failure instead of failing the whole page', () => {
    manager.createSurface({ surfaceId: 's1', carrier: 'pane', url: 'https://example.com/' })
    const contents = h.MockWebContentsView.instances[0].webContents

    contents.emit('did-fail-load', {}, -20, 'net::ERR_BLOCKED_BY_CLIENT', 'https://ads.example.com/', false)

    expect(lastState().tabs[0].loadError).toBeUndefined()
  })

  it('falls back to a generic message when the failure carries no description', () => {
    manager.createSurface({ surfaceId: 's1', carrier: 'pane', url: 'https://example.com/' })
    const contents = h.MockWebContentsView.instances[0].webContents

    contents.emit('did-fail-load', {}, -999, '', 'https://example.com/', true)

    expect(lastState().tabs[0].loadError).toBe('Load failed')
  })

  it('pops out to a standalone window without destroying webContents', () => {
    manager.createSurface({ surfaceId: 's1', carrier: 'pane' })
    const view = h.MockWebContentsView.instances[0]
    const contents = view.webContents

    const result = manager.popOut('s1')
    expect(result.success).toBe(true)
    expect(mainWindow.contentView.children).not.toContain(view)
    expect(contents.close).not.toHaveBeenCalled()

    const standalone = h.MockBrowserWindow.instances[h.MockBrowserWindow.instances.length - 1]
    expect(standalone).not.toBe(mainWindow)
    expect(lastState().carrier).toBe('window')
    expect(manager.getStandaloneWebContents('s1')).toBe(standalone.webContents)
  })

  it('embeds a popped-out surface back into the main window and closes the standalone window', () => {
    manager.createSurface({ surfaceId: 's1', carrier: 'pane' })
    manager.popOut('s1')
    const standalone = h.MockBrowserWindow.instances[h.MockBrowserWindow.instances.length - 1]
    const view = h.MockWebContentsView.instances[0]

    const result = manager.embed('s1')
    expect(result.success).toBe(true)
    expect(lastState().carrier).toBe('pane')
    expect(standalone.isDestroyed()).toBe(true)
    expect(view.webContents.close).not.toHaveBeenCalled()

    manager.setBounds('s1', { x: 0, y: 0, width: 100, height: 100 })
    expect(mainWindow.contentView.children).toContain(view)
  })

  it('rejects embedding a pane but reveals the existing window on repeated popOut', () => {
    manager.createSurface({ surfaceId: 's1', carrier: 'pane' })
    expect(manager.embed('s1').success).toBe(false)
    expect(manager.popOut('s1').success).toBe(true)
    const count = h.MockBrowserWindow.instances.length
    const window = h.MockBrowserWindow.instances.at(-1)!
    expect(manager.popOut('s1').success).toBe(true)
    expect(h.MockBrowserWindow.instances).toHaveLength(count)
    expect(window.restore).toHaveBeenCalledOnce()
    expect(window.show).toHaveBeenCalledOnce()
    expect(window.focus).toHaveBeenCalledOnce()
  })

  it('destroys the surface when the user closes the standalone window', () => {
    manager.createSurface({ surfaceId: 's1', carrier: 'pane' })
    manager.popOut('s1')
    const standalone = h.MockBrowserWindow.instances[h.MockBrowserWindow.instances.length - 1]
    const contents = h.MockWebContentsView.instances[0].webContents

    standalone.emitClosed()
    expect(manager.getState('s1')).toBeNull()
    expect(contents.close).toHaveBeenCalled()
    expect(lastState().destroyed).toBe(true)
    expect(lastState().tabs).toHaveLength(0)
  })

  it('destroySurface closes all tab contents and emits a destroyed tombstone', () => {
    manager.createSurface({ surfaceId: 's1', carrier: 'pane' })
    manager.openTab('s1')
    const [first, second] = h.MockWebContentsView.instances

    manager.destroySurface('s1')
    expect(first.webContents.close).toHaveBeenCalled()
    expect(second.webContents.close).toHaveBeenCalled()
    expect(mainWindow.contentView.children).toHaveLength(0)
    expect(manager.getState('s1')).toBeNull()
    expect(lastState()).toMatchObject({ surfaceId: 's1', destroyed: true, tabs: [], activeTabId: null })
  })

  it('creates a window-carrier surface directly with its own standalone window', () => {
    const result = manager.createSurface({ surfaceId: 's2', carrier: 'window', url: 'example.com' })
    expect(result.success).toBe(true)
    const standalone = h.MockBrowserWindow.instances[h.MockBrowserWindow.instances.length - 1]
    const view = h.MockWebContentsView.instances[0]
    expect(lastState().carrier).toBe('window')
    expect(standalone.contentView.children).not.toContain(view)
    manager.setBounds('s2', { x: 0, y: 34, width: 300, height: 200 })
    expect(standalone.contentView.children).toContain(view)
    expect(mainWindow.contentView.children).not.toContain(view)
    expect(view.webContents.loadURL).toHaveBeenCalledWith('https://example.com')
  })

  it('unsubscribes state listeners cleanly', () => {
    const extra: BrowserSurfaceState[] = []
    const off = manager.onStateChanged((_id, state) => extra.push(state))
    off()
    manager.createSurface({ surfaceId: 's1', carrier: 'pane' })
    expect(extra).toHaveLength(0)
  })

  it('detaches hidden views and does not reattach them on tab changes or load events', () => {
    manager.createSurface({ surfaceId: 's1', carrier: 'pane' })
    manager.setBounds('s1', { x: 10, y: 60, width: 400, height: 300 })
    expect(mainWindow.contentView.children).toHaveLength(1)

    manager.setBounds('s1', { x: 0, y: 0, width: 0, height: 0 })
    manager.openTab('s1', 'https://example.com/two')
    h.MockWebContentsView.instances[1].webContents.emit('did-start-loading')
    expect(mainWindow.contentView.children).toHaveLength(0)

    manager.setBounds('s1', { x: 10, y: 60, width: 400, height: 300 })
    expect(mainWindow.contentView.children).toEqual([h.MockWebContentsView.instances[1]])
  })

  it('exposes a failed address, detaches the black view, and retries that address', () => {
    manager.createSurface({ surfaceId: 's1', carrier: 'pane', url: 'http://localhost:9443' })
    const view = h.MockWebContentsView.instances[0]
    const contents = view.webContents
    contents.getURL.mockReturnValue('')
    const tabId = lastState().activeTabId as string
    manager.setBounds('s1', { x: 10, y: 60, width: 400, height: 300 })
    contents.emit('did-fail-load', {}, -102, 'net::ERR_CONNECTION_REFUSED', 'http://localhost:9443/', true)

    expect(mainWindow.contentView.children).toHaveLength(0)
    expect(lastState().tabs[0]).toMatchObject({ url: 'http://localhost:9443/', loadError: 'net::ERR_CONNECTION_REFUSED' })
    manager.setBounds('s1', { x: 10, y: 60, width: 400, height: 300 })
    expect(mainWindow.contentView.children).toHaveLength(0)
    manager.reload('s1', tabId)
    expect(contents.loadURL).toHaveBeenLastCalledWith('http://localhost:9443/')
    contents.emit('did-start-loading')
    expect(mainWindow.contentView.children).toEqual([view])
    expect(lastState().tabs[0].loadError).toBeUndefined()
  })

  it('does not show a failure when navigation is superseded', () => {
    manager.createSurface({ surfaceId: 's1', carrier: 'pane', url: 'https://example.com' })
    manager.setBounds('s1', { x: 10, y: 60, width: 400, height: 300 })
    const view = h.MockWebContentsView.instances[0]
    view.webContents.emit('did-fail-load', {}, -3, 'net::ERR_ABORTED', 'https://example.com', true)
    expect(lastState().tabs[0].loadError).toBeUndefined()
    expect(mainWindow.contentView.children).toEqual([view])
  })
})
