import { ipcMain, screen, type BrowserWindow, type Rectangle } from 'electron'
import { SYSTEM_CHANNELS, WINDOW_RESIZE_EDGES, type WindowResizeEdge, type WindowResizeGesture } from '../../shared/ipc/system'

export function registerMainWindowResize(getMainWindow: () => BrowserWindow | null): void {
  let gesture: { window: BrowserWindow; edge: WindowResizeEdge; start: Rectangle } | undefined

  ipcMain.on(SYSTEM_CHANNELS.dragMainResize, (event, message: WindowResizeGesture | null) => {
    const window = getMainWindow()
    if (!window || window.isDestroyed() || event.sender !== window.webContents || event.senderFrame !== event.sender.mainFrame) return
    if (gesture?.window !== window) gesture = undefined
    if (message?.phase === 'end' || !window.isResizable() || window.isMaximized() || window.isFullScreen()) {
      gesture = undefined
      return
    }
    if (message?.phase === 'start') {
      gesture = WINDOW_RESIZE_EDGES.includes(message.edge) ? { window, edge: message.edge, start: window.getBounds() } : undefined
      return
    }
    if (!gesture || message?.phase !== 'move' || !Number.isFinite(message.dx) || !Number.isFinite(message.dy)) return

    const { edge, start } = gesture
    const west = edge.includes('w')
    const north = edge.includes('n')
    const [minWidth, minHeight] = window.getMinimumSize()
    const [maxWidth, maxHeight] = window.getMaximumSize()
    const { workArea } = screen.getDisplayMatching(start)
    const dx = west ? -message.dx : edge.includes('e') ? message.dx : 0
    const dy = north ? -message.dy : edge.includes('s') ? message.dy : 0
    const width = Math.round(Math.max(minWidth, Math.min(maxWidth || Infinity, Math.max(workArea.width, start.width), start.width + dx)))
    const height = Math.round(Math.max(minHeight, Math.min(maxHeight || Infinity, Math.max(workArea.height, start.height), start.height + dy)))
    const bounds = {
      x: west ? start.x + start.width - width : start.x,
      y: north ? start.y + start.height - height : start.y,
      width,
      height,
    }
    const current = window.getBounds()
    if (bounds.x !== current.x || bounds.y !== current.y || width !== current.width || height !== current.height) window.setBounds(bounds)
  })
}
