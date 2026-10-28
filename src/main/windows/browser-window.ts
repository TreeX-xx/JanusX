import { BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { loadRendererWindow } from './renderer-loader'

/**
 * 创建浏览器 surface 的独立窗口载体。
 * 复用 editor-window 的 query-param 模式：渲染端 main.tsx 依据 browserWindow=1 路由到 StandaloneBrowser。
 * 窗口内网页内容由 BrowserSurfaceManager 持有的 WebContentsView 承载，窗口自身 webContents 只跑 JanusX chrome UI。
 */
export function createStandaloneBrowserWindow(surfaceId: string): BrowserWindow {
  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 720,
    minHeight: 480,
    title: 'JanusX Browser',
    // 与编辑器独立窗口同理：默认经典黑先用深色打底，渲染侧再按主题接管。
    backgroundColor: '#151517',
    frame: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../../preload/index.mjs'),
      sandbox: false,
      webSecurity: true,
      webviewTag: false,
    },
  })
  window.webContents.setWindowOpenHandler((details) => {
    void shell.openExternal(details.url)
    return { action: 'deny' }
  })
  void loadRendererWindow(
    window,
    (url) => {
      url.searchParams.set('browserWindow', '1')
      url.searchParams.set('surfaceId', surfaceId)
    },
    { browserWindow: '1', surfaceId },
  )
  return window
}
