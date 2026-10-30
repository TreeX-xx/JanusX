import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SYSTEM_CHANNELS } from '../../src/shared/ipc/system'
import { THEME_CHANNELS } from '../../src/shared/ipc/theme'

const mocks = vi.hoisted(() => {
  const handlers = new Map<string, (...args: any[]) => void>()
  const win = {
    isDestroyed: vi.fn(() => false),
    isVisible: vi.fn(() => false),
    setAlwaysOnTop: vi.fn(),
    setBounds: vi.fn(),
    showInactive: vi.fn(),
    hide: vi.fn(),
    destroy: vi.fn(),
    on: vi.fn(),
    webContents: { send: vi.fn(), on: vi.fn(), isDestroyed: vi.fn(() => false) },
  }
  return { handlers, win, BrowserWindow: vi.fn(function () { return win }) }
})

vi.mock('electron', () => ({
  BrowserWindow: mocks.BrowserWindow,
  app: { isReady: () => true },
  ipcMain: { on: (channel: string, handler: (...args: any[]) => void) => mocks.handlers.set(channel, handler) },
  screen: {
    getCursorScreenPoint: () => ({ x: 0, y: 0 }),
    getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }),
  },
}))
vi.mock('../../src/main/config/service', () => ({ configService: { getCachedTheme: () => 'dark' } }))
vi.mock('../../src/main/windows/renderer-loader', () => ({ loadRendererWindow: vi.fn(async () => {}) }))

import { desktopToastWindow } from '../../src/main/notifications/desktop-toast-window'

const payload = (id: string) => ({ id, type: 'completed' as const, title: id, body: 'Done', createdAt: '' })
const emit = (channel: string, value?: unknown, sender: unknown = mocks.win.webContents) => {
  mocks.handlers.get(channel)!({ sender }, value)
}
const delivery = () => mocks.win.webContents.send.mock.calls.filter(([channel]) => channel === SYSTEM_CHANNELS.toastShow).at(-1)![1].deliveryId

describe('desktop toast presentation', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    mocks.win.isVisible.mockReturnValue(false)
  })
  afterEach(() => {
    desktopToastWindow.destroy()
    vi.useRealTimers()
  })

  it('keeps the window hidden until the themed card acknowledges painting', () => {
    const onShown = vi.fn()
    desktopToastWindow.show(payload('first'), { onShown })
    emit(SYSTEM_CHANNELS.toastReady)
    expect(mocks.win.webContents.send.mock.calls.slice(0, 2).map(([channel]) => channel))
      .toEqual([THEME_CHANNELS.changed, SYSTEM_CHANNELS.toastShow])
    expect(mocks.win.showInactive).not.toHaveBeenCalled()
    expect(onShown).not.toHaveBeenCalled()
    expect(mocks.BrowserWindow).toHaveBeenCalledWith(expect.objectContaining({
      show: false, transparent: true, backgroundMaterial: 'none',
      webPreferences: expect.objectContaining({ backgroundThrottling: false }),
    }))
    emit(SYSTEM_CHANNELS.toastPainted, delivery())
    expect(mocks.win.showInactive).toHaveBeenCalledOnce()
    expect(onShown).toHaveBeenCalledOnce()
    vi.advanceTimersByTime(7999)
    expect(mocks.win.hide).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(mocks.win.hide).toHaveBeenCalledOnce()
  })

  it('rejects old, duplicate and foreign paint acknowledgements', () => {
    const firstShown = vi.fn()
    const latestShown = vi.fn()
    desktopToastWindow.show(payload('first'), { onShown: firstShown })
    emit(SYSTEM_CHANNELS.toastReady)
    const firstDelivery = delivery()
    desktopToastWindow.show(payload('latest'), { onShown: latestShown })
    const latestDelivery = delivery()
    emit(SYSTEM_CHANNELS.toastPainted, firstDelivery)
    emit(SYSTEM_CHANNELS.toastPainted, latestDelivery, {})
    expect(mocks.win.showInactive).not.toHaveBeenCalled()
    emit(SYSTEM_CHANNELS.toastPainted, latestDelivery)
    emit(SYSTEM_CHANNELS.toastPainted, latestDelivery)
    expect(firstShown).not.toHaveBeenCalled()
    expect(latestShown).toHaveBeenCalledOnce()
    expect(mocks.win.showInactive).toHaveBeenCalledOnce()
  })

  it('cancels the old timeout while a replacement paints and keeps a visible window stable', () => {
    desktopToastWindow.show(payload('first'), { timeoutMs: 100 })
    emit(SYSTEM_CHANNELS.toastReady)
    emit(SYSTEM_CHANNELS.toastPainted, delivery())
    mocks.win.isVisible.mockReturnValue(true)
    desktopToastWindow.show(payload('next'))
    vi.advanceTimersByTime(100)
    expect(mocks.win.hide).not.toHaveBeenCalled()
    emit(SYSTEM_CHANNELS.toastPainted, delivery())
    expect(mocks.win.showInactive).toHaveBeenCalledOnce()
  })

  it('reports a paint timeout even when subscription readiness already arrived', () => {
    const onError = vi.fn()
    desktopToastWindow.show(payload('first'), { onError })
    emit(SYSTEM_CHANNELS.toastReady)
    vi.advanceTimersByTime(1500)
    expect(onError).toHaveBeenCalledWith('desktop-toast-renderer-not-ready')
    expect(mocks.win.showInactive).not.toHaveBeenCalled()
  })

  it('invalidates pending paint on dismiss and supports a new delivery after hiding', () => {
    desktopToastWindow.show(payload('first'))
    emit(SYSTEM_CHANNELS.toastReady)
    const stale = delivery()
    emit(SYSTEM_CHANNELS.toastAction, { action: 'dismiss' })
    emit(SYSTEM_CHANNELS.toastPainted, stale)
    expect(mocks.win.showInactive).not.toHaveBeenCalled()
    desktopToastWindow.show(payload('next'))
    emit(SYSTEM_CHANNELS.toastPainted, delivery())
    expect(mocks.win.showInactive).toHaveBeenCalledOnce()
  })
})
