import { BrowserWindow, shell, type WebContents } from 'electron'
import { join, normalize } from 'node:path'
import { loadRendererWindow } from './renderer-loader'
import { SYSTEM_CHANNELS } from '../../shared/ipc/system'
import { configService } from '../config/service'
import { getThemeDefinition } from '../../shared/theme/registry'

// Note: .agents/notes/workbench/standalone-editor-initial-theme.md

export type EditorWindowPayload = import('../../shared/editor').EditorDelivery

interface EditorWindowEntry {
  window: BrowserWindow
  ready: boolean
  allowClose: boolean
  pending: EditorWindowPayload[]
}

function identityPath(value: string): string {
  if (value.startsWith('janusx-workspace://')) return value.replace(/\/+$/, '')
  const normalized = normalize(value).replace(/[\\/]+$/, '')
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

export class EditorWindowManager {
  private windows = new Map<string, EditorWindowEntry>()

  get(workspacePath: string): BrowserWindow | undefined {
    const window = this.windows.get(identityPath(workspacePath))?.window
    return window && !window.isDestroyed() ? window : undefined
  }

  list(): BrowserWindow[] {
    return Array.from(this.windows.values())
      .map((entry) => entry.window)
      .filter((window) => !window.isDestroyed())
  }

  closeAll(): void {
    for (const entry of this.windows.values()) {
      if (!entry.window.isDestroyed()) entry.window.destroy()
    }
    this.windows.clear()
  }

  confirmClose(sender: WebContents): void {
    const entry = [...this.windows.values()].find(item => item.window.webContents === sender)
    if (!entry || entry.window.isDestroyed()) return
    entry.allowClose = true
    entry.window.close()
  }

  ready(sender: WebContents): void {
    for (const entry of this.windows.values()) {
      if (entry.window.webContents !== sender) continue
      entry.ready = true
      for (const payload of entry.pending.splice(0)) {
        entry.window.webContents.send(SYSTEM_CHANNELS.refreshEditor, payload)
      }
      return
    }
  }

  async open(payload: EditorWindowPayload): Promise<{ success: boolean; error?: string }> {
    if (!payload.filePath || !payload.workspacePath) {
      return { success: false, error: 'Missing editor window payload' }
    }
    const theme = getThemeDefinition(await configService.getTheme())
    const workspaceKey = identityPath(payload.workspacePath)
    const fileKey = identityPath(payload.filePath)
    const existing = this.windows.get(workspaceKey)
    if (existing && !existing.window.isDestroyed()) {
      if (existing.window.isMinimized()) existing.window.restore()
      if (existing.ready) {
        existing.window.show()
        existing.window.focus()
      }
      if (existing.ready) {
        existing.window.webContents.send(SYSTEM_CHANNELS.refreshEditor, payload)
      } else if (!existing.pending.some((item) => identityPath(item.filePath ?? '') === fileKey)) {
        existing.pending.push(payload)
      }
      return { success: true }
    }
    if (existing) this.windows.delete(workspaceKey)

    const filePath = payload.filePath
    const workspacePath = payload.workspacePath
    const window = new BrowserWindow({
      width: 1100,
      height: 760,
      minWidth: 820,
      minHeight: 520,
      title: 'JanusX Editor',
      show: false,
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
    window.once('ready-to-show', () => {
      if (!window.isDestroyed()) window.show()
    })
    window.on('close', event => {
      const entry = this.windows.get(workspaceKey)
      if (!entry || !entry.ready || entry.allowClose) return
      event.preventDefault()
      window.webContents.send(SYSTEM_CHANNELS.requestEditorClose)
    })
    window.on('closed', () => {
      if (this.windows.get(workspaceKey)?.window === window) this.windows.delete(workspaceKey)
    })
    window.webContents.setWindowOpenHandler((details) => {
      void shell.openExternal(details.url)
      return { action: 'deny' }
    })
    this.windows.set(workspaceKey, { window, ready: false, allowClose: false, pending: payload.requestId ? [payload] : [] })
    void loadRendererWindow(
      window,
      (url) => {
        url.searchParams.set('editorWindow', '1')
        url.searchParams.set('editorFile', filePath)
        url.searchParams.set('workspacePath', workspacePath)
        url.searchParams.set('editorTheme', theme.id)
        url.searchParams.set('editorBackground', theme.tokens['shell-canvas'])
        url.searchParams.set('editorColorScheme', theme.base)
      },
      {
        editorWindow: '1', editorFile: filePath, workspacePath,
        editorTheme: theme.id, editorBackground: theme.tokens['shell-canvas'], editorColorScheme: theme.base,
      },
    )
    return { success: true }
  }
}
