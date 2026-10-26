import { ipcMain, shell } from 'electron'
import { workspaceFileIpc } from '../workspace/runtime-ipc'
import { extname } from 'node:path'
import { FILE_CHANNELS } from '../../shared/ipc/workspace'
import { authorizeRendererAction, type RendererActionAuthorizer } from '../agent/runtime/shell-runtime'
import { janusWorkspaceFs } from '@janus-agent/agent-core'
import { htmlPreviewServer } from '../preview/html-preview-server'
import { saveEditorText } from '../lib/editor-save'
import type { HtmlPreviewRequest } from '../../shared/ipc/workspace'

const MIME_MAP: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.bmp': 'image/bmp',
}

export function registerFileHandlers(authorize: RendererActionAuthorizer = authorizeRendererAction): void {
  ipcMain.handle(FILE_CHANNELS.openPreviewLink, async (_event, value: string) => {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Invalid preview link')
    await shell.openExternal(url.href)
  })
  const previewOwners = new Set<number>()
  ipcMain.handle(FILE_CHANNELS.openHtmlPreview, async (event, request: HtmlPreviewRequest) => {
    if (event.senderFrame !== event.sender.mainFrame) throw new Error('HTML previews require the application frame')
    const owner = event.sender.id
    if (!previewOwners.has(owner)) {
      previewOwners.add(owner)
      event.sender.once('destroyed', () => { htmlPreviewServer.releaseOwner(owner); previewOwners.delete(owner) })
    }
    const lease = await htmlPreviewServer.open(owner, request)
    if (event.sender.isDestroyed()) { htmlPreviewServer.release(owner, lease.id); throw new Error('Preview window closed') }
    return lease
  })
  ipcMain.handle(FILE_CHANNELS.updateHtmlPreview, (event, id: string, content: string) => {
    if (event.senderFrame !== event.sender.mainFrame) throw new Error('Invalid preview frame')
    htmlPreviewServer.update(event.sender.id, id, content)
  })
  ipcMain.handle(FILE_CHANNELS.closeHtmlPreview, (event, id: string) => htmlPreviewServer.release(event.sender.id, id))
  workspaceFileIpc.handle(FILE_CHANNELS.read, async (_event, filePath: string) => {
    const result = await janusWorkspaceFs.readText(filePath)
    return result.ok
      ? { content: result.value.content, encoding: 'utf-8', size: result.value.size, mtime: result.value.mtime }
      : { error: result.error.message || 'Failed to read file' }
  })

  workspaceFileIpc.handle(FILE_CHANNELS.save, async (event, filePath: string, content: string, expectedVersion?: string) => {
    try {
      if (!await authorize(event, { workspaceRoot: filePath, toolName: 'legacy.file.save', actionRisk: 'write', source: 'renderer-user', preview: { summary: 'Save file changes', paths: [filePath], detail: `${content.length} characters`, truncated: false } })) return { error: 'File save denied by workspace policy' }
      return await saveEditorText(filePath, content, expectedVersion, async () => {
        const result = await janusWorkspaceFs.writeText(filePath, content)
        if (!result.ok) throw result.error
      })
    } catch (err: any) {
      return { error: err.message || 'Failed to save file' }
    }
  })

  workspaceFileIpc.handle(FILE_CHANNELS.readBinary, async (_event, filePath: string) => {
    try {
      const result = await janusWorkspaceFs.readBinary(filePath)
      if (!result.ok) throw result.error
      const { buffer, size, mtime } = result.value
      const ext = extname(filePath).toLowerCase()
      const mimeType = MIME_MAP[ext] || 'application/octet-stream'
      return { base64: buffer.toString('base64'), mimeType, size, mtime }
    } catch (err: any) {
      return { error: err.message || 'Failed to read binary file' }
    }
  })

  workspaceFileIpc.handle(FILE_CHANNELS.stat, async (_event, filePath: string) => {
    try {
      const result = await janusWorkspaceFs.stat(filePath)
      if (!result.ok) throw result.error
      return result.value
    } catch (err: any) {
      return { error: err.message || 'Failed to stat file' }
    }
  })

}
