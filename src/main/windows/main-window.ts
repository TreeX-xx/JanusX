import { app, BrowserWindow, nativeImage } from 'electron'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { installProductionCsp } from '../bootstrap/session'
import { loadRendererWindow } from './renderer-loader'
import { configService } from '../config/service'
import { getThemeDefinition } from '../../shared/theme/registry'

export function createMainWindow(onClosed: () => void): BrowserWindow {
  // Bootstrap loads the profile before creating any main window.
  // Note: .agents/notes/workbench/standalone-editor-initial-theme.md
  const theme = getThemeDefinition(configService.getCachedTheme())
  const iconFile = process.platform === 'win32' ? 'icon.ico' : 'icon.png'
  const appIcon = nativeImage.createFromPath(join(__dirname, '../../../resources', iconFile))
  const window = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 600,
    title: 'JanusX',
    icon: appIcon,
    frame: false,
    show: false,
    backgroundColor: theme.tokens['shell-canvas'],
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../../preload/index.mjs'),
      sandbox: false,
      webSecurity: true,
      webviewTag: false,
    },
  })
  if (process.platform === 'win32' && !app.isPackaged) {
    // Windows caches taskbar icons by path separately from the native window icon.
    const icon = readFileSync(join(app.getAppPath(), 'resources/icon.ico'))
    const hash = createHash('sha256').update(icon).digest('hex').slice(0, 16)
    const directory = join(app.getPath('userData'), 'shell-icons')
    mkdirSync(directory, { recursive: true })
    const iconPath = join(directory, `janusx-${hash}.ico`)
    writeFileSync(iconPath, icon)
    window.setAppDetails({
      appId: 'com.janusx.app.dev',
      appIconPath: iconPath,
      appIconIndex: 0,
      relaunchCommand: `"${process.execPath}" "${join(app.getAppPath(), 'scripts/dev-entry.mjs')}"`,
      relaunchDisplayName: 'JanusX (Dev)',
    })
  }
  installProductionCsp(window.webContents.session)
  window.once('ready-to-show', () => {
    if (!window.isDestroyed()) window.show()
  })
  window.on('closed', onClosed)
  const query = {
    initialTheme: theme.id,
    initialBackground: theme.tokens['shell-canvas'],
    initialColorScheme: theme.base,
  }
  void loadRendererWindow(window, (url) => {
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value)
  }, query)
  return window
}
