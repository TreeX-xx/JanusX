// Note: local reminders leave system notifications — see .agents/notes/desktop/desktop-toast.md
// Note: transparent toast needs pre-paint transparent page, solid card, shadowless window — see .agents/notes/desktop/desktop-toast.md
import { BrowserWindow, app, ipcMain, screen, type IpcMainEvent } from 'electron'
import { join } from 'node:path'
import { SYSTEM_CHANNELS } from '../../shared/ipc/system'
import { THEME_CHANNELS } from '../../shared/ipc/theme'
import { configService } from '../config/service'
import { loadRendererWindow } from '../windows/renderer-loader'

export interface DesktopToastPayload {
  id: string
  type: 'completed' | 'failed' | 'attention'
  engine?: string
  title: string
  body: string
  terminalId?: string
  workspaceId?: string
  createdAt: string
}

interface DesktopToastOptions {
  onClick?: () => void
  onShown?: () => void
  onError?: (error: string) => void
  timeoutMs?: number
}

const TOAST_WIDTH = 380
const TOAST_HEIGHT = 112
const TOAST_MARGIN = 18
const DEFAULT_TIMEOUT_MS = 8_000

class DesktopToastWindow {
  private toastWindow: BrowserWindow | null = null
  private rendererReady = false
  private currentPayload: DesktopToastPayload | null = null
  private currentOptions: DesktopToastOptions | null = null
  private hideTimer: ReturnType<typeof setTimeout> | null = null
  private readyTimer: ReturnType<typeof setTimeout> | null = null
  private deliverySequence = 0
  private pendingDelivery: number | null = null

  constructor() {
    ipcMain.on(SYSTEM_CHANNELS.toastReady, this.handleReady)
    ipcMain.on(SYSTEM_CHANNELS.toastPainted, this.handlePainted)
    ipcMain.on(SYSTEM_CHANNELS.toastAction, this.handleAction)
  }

  show(payload: DesktopToastPayload, options: DesktopToastOptions = {}): boolean {
    if (!app.isReady()) {
      options.onError?.('app-not-ready')
      return false
    }

    this.currentPayload = payload
    this.currentOptions = options
    this.clearReadyTimer()
    if (this.hideTimer) {
      clearTimeout(this.hideTimer)
      this.hideTimer = null
    }

    try {
      const win = this.ensureWindow()
      this.positionWindow(win)
      this.flush()
      if (!this.rendererReady || this.pendingDelivery !== null) {
        const expectedPayload = payload
        this.readyTimer = setTimeout(() => {
          this.readyTimer = null
          if (this.currentPayload !== expectedPayload) return
          this.currentOptions?.onError?.('desktop-toast-renderer-not-ready')
        }, 1500)
        this.readyTimer.unref?.()
      }
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      options.onError?.(message)
      return false
    }
  }

  private ensureWindow(): BrowserWindow {
    if (this.toastWindow && !this.toastWindow.isDestroyed()) return this.toastWindow

    this.rendererReady = false
    const win = new BrowserWindow({
      width: TOAST_WIDTH,
      height: TOAST_HEIGHT,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      show: false,
      focusable: false,
      // 无原生阴影与粗边框：两者在 Windows 透明窗口上渲染成灰边/灰色阴影矩形
      // Win11 DWM 默认 backgroundMaterial:auto 会在圆角卡片外再铺一层 Mica 灰玻璃，
      // 必须显式 none；系统圆角交给 CSS 卡片，窗口自身不再倒角
      hasShadow: false,
      thickFrame: false,
      backgroundMaterial: 'none',
      roundedCorners: false,
      backgroundColor: '#00000000',
      webPreferences: {
        // This module is emitted under out/main/chunks in production and
        // development builds; the preload bundle is emitted under out/preload.
        preload: join(__dirname, '../../preload/index.mjs'),
        sandbox: false,
        // Hidden toasts must paint before the window is shown.
        backgroundThrottling: false,
      },
    })

    win.setAlwaysOnTop(true, 'screen-saver')
    win.on('closed', () => {
      if (this.toastWindow === win) {
        this.toastWindow = null
        this.rendererReady = false
      }
    })
    win.webContents.on('did-fail-load', (_event, _code, description) => {
      const reason = description || 'desktop-toast-load-failed'
      console.error(`[desktop-toast] renderer failed to load: ${reason}`)
      this.currentOptions?.onError?.(reason)
    })
    win.webContents.on('render-process-gone', (_event, details) => {
      const reason = `desktop-toast-renderer-gone:${details.reason || 'unknown'}`
      console.error(`[desktop-toast] ${reason}`)
      this.currentOptions?.onError?.(reason)
    })

    this.toastWindow = win
    void this.loadToastApp(win).catch((error) => {
      const message = error instanceof Error ? error.message : String(error)
      this.currentOptions?.onError?.(message)
    })

    return win
  }

  private async loadToastApp(win: BrowserWindow): Promise<void> {
    await loadRendererWindow(
      win,
      (url) => url.searchParams.set('desktopToast', '1'),
      { desktopToast: '1' },
    )
  }

  private positionWindow(win: BrowserWindow): void {
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    const { workArea } = display
    win.setBounds({
      width: TOAST_WIDTH,
      height: TOAST_HEIGHT,
      x: Math.round(workArea.x + workArea.width - TOAST_WIDTH - TOAST_MARGIN),
      y: Math.round(workArea.y + workArea.height - TOAST_HEIGHT - TOAST_MARGIN),
    })
  }

  private flush(): void {
    const win = this.toastWindow
    if (!win || win.isDestroyed() || !this.rendererReady || !this.currentPayload) return

    if (this.hideTimer) {
      clearTimeout(this.hideTimer)
      this.hideTimer = null
    }

    this.pushTheme(win)
    this.positionWindow(win)
    this.pendingDelivery = ++this.deliverySequence
    win.webContents.send(SYSTEM_CHANNELS.toastShow, {
      ...this.currentPayload,
      deliveryId: this.pendingDelivery,
    })
  }

  private handlePainted = (event: IpcMainEvent, deliveryId: unknown): void => {
    const win = this.toastWindow
    if (!win || win.isDestroyed() || event.sender !== win.webContents
      || this.pendingDelivery === null || deliveryId !== this.pendingDelivery || !this.currentPayload) return

    this.pendingDelivery = null
    this.clearReadyTimer()
    // Keep native composition settings stable; changing material around show
    // rebuilds the Windows backdrop while the rounded card is visible.
    if (!win.isVisible()) win.showInactive()
    this.currentOptions?.onShown?.()

    const timeoutMs = this.currentOptions?.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.hideTimer = setTimeout(() => this.hide(), timeoutMs)
    this.hideTimer.unref?.()
  }

  /**
   * 主题统一控制：Toast 窗口短命且后创建，易错过 settings 的 theme:changed 广播。
   * show 前主动推送一次缓存主题（同步读，无 IO），渲染侧订阅后 applyThemeToDocument。
   */
  private pushTheme(win: BrowserWindow): void {
    try {
      if (win.isDestroyed() || win.webContents.isDestroyed()) return
      win.webContents.send(THEME_CHANNELS.changed, configService.getCachedTheme())
    } catch {
      // 主题推送失败不阻断通知本身
    }
  }

  private hide(): void {
    this.pendingDelivery = null
    this.clearReadyTimer()
    if (this.hideTimer) {
      clearTimeout(this.hideTimer)
      this.hideTimer = null
    }

    const win = this.toastWindow
    if (win && !win.isDestroyed()) {
      if (!win.webContents.isDestroyed()) win.webContents.send(SYSTEM_CHANNELS.toastHide)
      win.hide()
    }
    this.currentPayload = null
    this.currentOptions = null
  }

  private clearReadyTimer(): void {
    if (!this.readyTimer) return
    clearTimeout(this.readyTimer)
    this.readyTimer = null
  }

  /** Destroy the toast window so it cannot keep the app alive on quit. */
  destroy(): void {
    this.hide()
    const win = this.toastWindow
    this.toastWindow = null
    this.rendererReady = false
    if (win && !win.isDestroyed()) {
      win.destroy()
    }
  }

  private handleReady = (event: IpcMainEvent): void => {
    const win = this.toastWindow
    if (!win || win.isDestroyed() || event.sender !== win.webContents) return
    this.rendererReady = true
    console.debug('[desktop-toast] renderer ready')
    this.flush()
  }

  private handleAction = (event: IpcMainEvent, payload?: { action?: string }): void => {
    const win = this.toastWindow
    if (!win || win.isDestroyed() || event.sender !== win.webContents) return

    const action = payload?.action
    if (action === 'activate') {
      this.currentOptions?.onClick?.()
    }
    if (action === 'activate' || action === 'dismiss') {
      this.hide()
    }
  }
}

export const desktopToastWindow = new DesktopToastWindow()
