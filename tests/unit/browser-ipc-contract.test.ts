import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BROWSER_EVENT_CHANNELS,
  BROWSER_INVOKE_CHANNELS,
  type BrowserAPI,
  type BrowserSurfaceState,
} from '../../src/shared/ipc/browser'

const mocks = vi.hoisted(() => ({
  expose: vi.fn(),
  handle: vi.fn(),
  invoke: vi.fn(),
  send: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn(),
}))

let browserApi: BrowserAPI

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: (_name: string, api: { browser: BrowserAPI }) => {
      browserApi = api.browser
      mocks.expose(api)
    },
  },
  ipcMain: { handle: mocks.handle },
  ipcRenderer: {
    invoke: mocks.invoke,
    on: mocks.on,
    removeListener: mocks.removeListener,
    send: mocks.send,
  },
}))

beforeAll(async () => {
  await import('../../src/preload/index')
  const { registerBrowserHandlers } = await import('../../src/main/ipc/browser-handlers')
  const surfaces = {
    onShowRequested: vi.fn(() => () => {}),
    onStateChanged: vi.fn(() => () => {}),
    onAgentControlChanged: vi.fn(() => () => {}),
    createSurface: vi.fn(),
    destroySurface: vi.fn(),
    popOut: vi.fn(),
    embed: vi.fn(),
    setBounds: vi.fn(),
    getState: vi.fn(),
    getHiddenFrame: vi.fn(),
    openTab: vi.fn(),
    closeTab: vi.fn(),
    activateTab: vi.fn(),
    navigate: vi.fn(),
    goBack: vi.fn(),
    goForward: vi.fn(),
    reload: vi.fn(),
    getStandaloneWebContents: vi.fn(() => null),
  }
  registerBrowserHandlers(() => null, surfaces as never)
})

describe('Browser IPC contract', () => {
  beforeEach(() => {
    mocks.invoke.mockReset()
    mocks.invoke.mockResolvedValue({ success: true, data: {} })
    mocks.on.mockReset()
    mocks.removeListener.mockReset()
  })

  it('defines unique invoke and event channels', () => {
    const invokeChannels = Object.values(BROWSER_INVOKE_CHANNELS)
    expect(new Set(invokeChannels).size).toBe(invokeChannels.length)
    const eventChannels = Object.values(BROWSER_EVENT_CHANNELS)
    expect(new Set(eventChannels).size).toBe(eventChannels.length)
    expect(invokeChannels).not.toContain(eventChannels[0])
  })

  it('registers every invoke channel in main', () => {
    const registered = mocks.handle.mock.calls.map(([channel]) => channel)
    expect(registered).toEqual(expect.arrayContaining(Object.values(BROWSER_INVOKE_CHANNELS)))
  })

  it('routes all typed commands through the fixed preload API', async () => {
    const request = { surfaceId: 's1', carrier: 'pane' as const, url: 'https://example.com' }
    const bounds = { x: 1, y: 2, width: 3, height: 4 }

    await browserApi.createSurface(request)
    await browserApi.destroySurface('s1')
    await browserApi.popOut('s1')
    await browserApi.embed('s1')
    await browserApi.setBounds('s1', bounds)
    await browserApi.getState('s1')
    await browserApi.getHiddenFrame('s1')
    await browserApi.openTab('s1', 'https://a.dev')
    await browserApi.openTab('s1')
    await browserApi.closeTab('s1', 't1')
    await browserApi.activateTab('s1', 't1')
    await browserApi.navigate('s1', 't1', 'example.com')
    await browserApi.goBack('s1', 't1')
    await browserApi.goForward('s1', 't1')
    await browserApi.reload('s1', 't1')

    expect(mocks.invoke.mock.calls).toEqual([
      [BROWSER_INVOKE_CHANNELS.createSurface, request],
      [BROWSER_INVOKE_CHANNELS.destroySurface, 's1'],
      [BROWSER_INVOKE_CHANNELS.popOut, 's1'],
      [BROWSER_INVOKE_CHANNELS.embed, 's1'],
      [BROWSER_INVOKE_CHANNELS.setBounds, 's1', bounds],
      [BROWSER_INVOKE_CHANNELS.getState, 's1'],
      [BROWSER_INVOKE_CHANNELS.getHiddenFrame, 's1'],
      [BROWSER_INVOKE_CHANNELS.openTab, 's1', 'https://a.dev'],
      [BROWSER_INVOKE_CHANNELS.openTab, 's1', undefined],
      [BROWSER_INVOKE_CHANNELS.closeTab, 's1', 't1'],
      [BROWSER_INVOKE_CHANNELS.activateTab, 's1', 't1'],
      [BROWSER_INVOKE_CHANNELS.navigate, 's1', 't1', 'example.com'],
      [BROWSER_INVOKE_CHANNELS.goBack, 's1', 't1'],
      [BROWSER_INVOKE_CHANNELS.goForward, 's1', 't1'],
      [BROWSER_INVOKE_CHANNELS.reload, 's1', 't1'],
    ])
  })

  it('subscribes state/agentControl events with exact-listener unsubscribe', () => {
    const callback = (_state: BrowserSurfaceState) => {}
    const unsubscribe = browserApi.onStateChanged(callback)
    expect(mocks.on).toHaveBeenCalledWith(BROWSER_EVENT_CHANNELS.state, expect.any(Function))
    const registeredHandler = mocks.on.mock.calls.find(([channel]) => channel === BROWSER_EVENT_CHANNELS.state)?.[1]
    unsubscribe()
    expect(mocks.removeListener).toHaveBeenCalledWith(BROWSER_EVENT_CHANNELS.state, registeredHandler)

    const agentCallback = () => {}
    const unsubscribeAgent = browserApi.onAgentControlChanged(agentCallback)
    expect(mocks.on).toHaveBeenCalledWith(BROWSER_EVENT_CHANNELS.agentControl, expect.any(Function))
    const agentHandler = mocks.on.mock.calls.find(([channel]) => channel === BROWSER_EVENT_CHANNELS.agentControl)?.[1]
    unsubscribeAgent()
    expect(mocks.removeListener).toHaveBeenCalledWith(BROWSER_EVENT_CHANNELS.agentControl, agentHandler)
    const offShow = browserApi.onShowRequested(() => {})
    const showHandler = mocks.on.mock.calls.find(([channel]) => channel === BROWSER_EVENT_CHANNELS.show)?.[1]
    offShow()
    expect(mocks.removeListener).toHaveBeenCalledWith(BROWSER_EVENT_CHANNELS.show, showHandler)
  })

  it('keeps surface state DTOs structured-clone safe', () => {
    const state: BrowserSurfaceState = {
      surfaceId: 's1',
      carrier: 'pane',
      tabs: [{ tabId: 't1', url: 'https://a.dev', title: 'A', isLoading: false, canGoBack: true, canGoForward: false }],
      activeTabId: 't1',
      agentControlled: false,
    }
    expect(() => structuredClone(state)).not.toThrow()
  })

  it('does not expose a generic bridge', () => {
    expect(mocks.expose.mock.calls[0]?.[0]).not.toHaveProperty('invoke')
  })
})
