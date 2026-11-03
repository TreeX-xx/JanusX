import { BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { loadRendererWindow } from './renderer-loader'
import { configService } from '../config/service'
import { getThemeDefinition } from '../../shared/theme/registry'

/**
 * 创建浏览器 surface 的独立窗口载体。
 * 复用 editor-window 的 query-param 模式：渲染端 main.tsx 依据 browserWindow=1 路由到 StandaloneBrowser。
 * 窗口内网页内容由 BrowserSurfaceManager 持有的 WebContentsView 承载，窗口自身 webContents 只跑 JanusX chrome UI。
 */
export function createStandaloneBrowserWindow(surfaceId: string): BrowserWindow {
  const theme = getThemeDefinition(configService.getCachedTheme())
  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 720,
    minHeight: 480,
    title: 'JanusX Browser',
    backgroundColor: theme.tokens['shell-canvas'],
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
      url.searchParams.set('initialTheme', theme.id)
      url.searchParams.set('initialBackground', theme.tokens['shell-canvas'])
      url.searchParams.set('initialColorScheme', theme.base)
    },
    { browserWindow: '1', surfaceId, initialTheme: theme.id, initialBackground: theme.tokens['shell-canvas'], initialColorScheme: theme.base },
  )
  return window
}
