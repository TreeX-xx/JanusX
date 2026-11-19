import { BrowserWindow, ipcMain } from 'electron'
import { SYSTEM_CHANNELS } from '../../shared/ipc/system'
import { type EditorWindowManager, type EditorWindowPayload } from './editor-window'
import { EditorRouting } from './editor-routing'

export function registerWindowIpc(editorWindows: EditorWindowManager, getMainWindow: () => BrowserWindow | null): void {
  const routing = new EditorRouting(editorWindows, getMainWindow)
  ipcMain.on(SYSTEM_CHANNELS.editorHostReady, event => routing.embeddedReady(event.sender))
  ipcMain.on(SYSTEM_CHANNELS.editorReceived, (event, payload: { requestId: string; success: boolean }) => routing.received(event.sender, payload.requestId, payload.success))
  // Note: .agents/notes/desktop/window-controls.md
  const observed = new WeakSet<BrowserWindow>()
  ipcMain.handle(SYSTEM_CHANNELS.getMaximized, event => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window || window.isDestroyed()) return false
    if (!observed.has(window)) {
      observed.add(window)
      const publish = () => {
        if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
          window.webContents.send(SYSTEM_CHANNELS.maximizedChanged, window.isMaximized())
        }
      }
      window.on('maximize', publish)
      window.on('unmaximize', publish)
    }
    return window.isMaximized()
  })
  const focusObserved = new WeakSet<BrowserWindow>()
  ipcMain.handle(SYSTEM_CHANNELS.getFocused, event => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window || window.isDestroyed()) return false
    if (!focusObserved.has(window)) {
      focusObserved.add(window)
      const publishFocus = () => {
        if (!window.webContents.isDestroyed()) window.webContents.send(SYSTEM_CHANNELS.focusChanged, window.isFocused())
      }
      window.on('focus', publishFocus)
      window.on('blur', publishFocus)
    }
    return window.isFocused()
  })
  ipcMain.handle(SYSTEM_CHANNELS.minimize, event => BrowserWindow.fromWebContents(event.sender)?.minimize())
  ipcMain.handle(SYSTEM_CHANNELS.maximize, event => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (window) window.isMaximized() ? window.unmaximize() : window.maximize()
  })
  ipcMain.handle(SYSTEM_CHANNELS.close, event => BrowserWindow.fromWebContents(event.sender)?.close())
  ipcMain.handle(SYSTEM_CHANNELS.openEditor, (_event, payload: EditorWindowPayload) => routing.open(payload))
  ipcMain.on(SYSTEM_CHANNELS.editorReady, (event) => editorWindows.ready(event.sender))
  ipcMain.handle(SYSTEM_CHANNELS.confirmEditorClose, event => editorWindows.confirmClose(event.sender))
  // Note: learning verifies a loaded file, not merely creation of an editor window — see .agents/notes/workbench/first-run-learning.md
  ipcMain.on(SYSTEM_CHANNELS.editorViewed, (event, payload: { filePath?: unknown; workspacePath?: unknown }) => {
    if (getMainWindow()?.webContents !== event.sender && !editorWindows.list().some(window => window.webContents === event.sender)) return
    if (typeof payload?.filePath !== 'string' || typeof payload?.workspacePath !== 'string') return
    const main = getMainWindow()
    if (main && !main.isDestroyed()) main.webContents.send(SYSTEM_CHANNELS.editorViewed, { filePath: payload.filePath, workspacePath: payload.workspacePath })
  })
  ipcMain.handle(SYSTEM_CHANNELS.setAlwaysOnTop, (event, value: boolean) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window || window.isDestroyed()) return { value: false }
    const enabled = Boolean(value)
    window.setAlwaysOnTop(enabled)
    if (window.isMinimized()) window.restore()
    if (!window.isVisible()) window.show()
    if (enabled) window.moveTop()
    window.focus()
    return { value: window?.isAlwaysOnTop() ?? false }
  })
  ipcMain.handle(SYSTEM_CHANNELS.embedEditor, (event, payload: EditorWindowPayload) => routing.embed(event.sender, payload))
}
