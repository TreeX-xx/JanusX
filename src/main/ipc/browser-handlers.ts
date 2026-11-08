import { BrowserWindow, ipcMain } from 'electron'
import {
  BROWSER_EVENT_CHANNELS,
  BROWSER_INVOKE_CHANNELS,
  type BrowserBounds,
  type CreateBrowserSurfaceRequest,
} from '../../shared/ipc/browser'
import type { BrowserSurfaceManager } from '../browser/surface-manager'

/**
 * 浏览器域 IPC 注册器。
 * 状态事件同时推送给主窗口与 surface 的独立窗口（若存在），保证双载体 UI 同步。
 */
export function registerBrowserHandlers(
  getMainWindow: () => BrowserWindow | null,
  surfaces: BrowserSurfaceManager,
): void {
  surfaces.onShowRequested(surfaceId => getMainWindow()?.webContents.send(BROWSER_EVENT_CHANNELS.show, surfaceId))
  const pushTargets = (surfaceId: string): Electron.WebContents[] => {
    const targets = new Set<Electron.WebContents>()
    const mainWindow = getMainWindow()
    if (mainWindow && !mainWindow.isDestroyed()) targets.add(mainWindow.webContents)
    const standalone = surfaces.getStandaloneWebContents(surfaceId)
    if (standalone && !standalone.isDestroyed()) targets.add(standalone)
    return [...targets]
  }

  surfaces.onStateChanged((surfaceId, state) => {
    for (const target of pushTargets(surfaceId)) target.send(BROWSER_EVENT_CHANNELS.state, state)
  })
  surfaces.onAgentControlChanged((surfaceId, event) => {
    for (const target of pushTargets(surfaceId)) target.send(BROWSER_EVENT_CHANNELS.agentControl, event)
  })

  ipcMain.handle(BROWSER_INVOKE_CHANNELS.createSurface, (_event, request: CreateBrowserSurfaceRequest) =>
    surfaces.createSurface(request),
  )
  ipcMain.handle(BROWSER_INVOKE_CHANNELS.destroySurface, (_event, surfaceId: string) =>
    surfaces.destroySurface(surfaceId),
  )
  ipcMain.handle(BROWSER_INVOKE_CHANNELS.popOut, (_event, surfaceId: string) => surfaces.popOut(surfaceId))
  ipcMain.handle(BROWSER_INVOKE_CHANNELS.embed, (_event, surfaceId: string) => surfaces.embed(surfaceId))
  ipcMain.handle(BROWSER_INVOKE_CHANNELS.setBounds, (_event, surfaceId: string, bounds: BrowserBounds) =>
    surfaces.setBounds(surfaceId, bounds),
  )
  ipcMain.handle(BROWSER_INVOKE_CHANNELS.getState, (_event, surfaceId: string) => surfaces.getState(surfaceId))
  ipcMain.handle(BROWSER_INVOKE_CHANNELS.getHiddenFrame, (_event, surfaceId: string) => surfaces.getHiddenFrame(surfaceId))
  ipcMain.handle(BROWSER_INVOKE_CHANNELS.openTab, (_event, surfaceId: string, url?: string) =>
    surfaces.openTab(surfaceId, url),
  )
  ipcMain.handle(BROWSER_INVOKE_CHANNELS.closeTab, (_event, surfaceId: string, tabId: string) =>
    surfaces.closeTab(surfaceId, tabId),
  )
  ipcMain.handle(BROWSER_INVOKE_CHANNELS.activateTab, (_event, surfaceId: string, tabId: string) =>
    surfaces.activateTab(surfaceId, tabId),
  )
  ipcMain.handle(BROWSER_INVOKE_CHANNELS.navigate, (_event, surfaceId: string, tabId: string, url: string) =>
    surfaces.navigate(surfaceId, tabId, url),
  )
  ipcMain.handle(BROWSER_INVOKE_CHANNELS.goBack, (_event, surfaceId: string, tabId: string) =>
    surfaces.goBack(surfaceId, tabId),
  )
  ipcMain.handle(BROWSER_INVOKE_CHANNELS.goForward, (_event, surfaceId: string, tabId: string) =>
    surfaces.goForward(surfaceId, tabId),
  )
  ipcMain.handle(BROWSER_INVOKE_CHANNELS.reload, (_event, surfaceId: string, tabId: string) =>
    surfaces.reload(surfaceId, tabId),
  )
}
