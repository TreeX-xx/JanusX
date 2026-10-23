import { ipcMain, shell } from 'electron'
import { readdir, realpath, stat } from 'node:fs/promises'
import { extname, join, resolve, sep } from 'node:path'
import { FILE_CHANNELS } from '../../shared/ipc/workspace'
import type { WorkspaceSourceFile, WorkspaceSourceFilesResult } from '../../shared/ipc/workspace'
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

const SOURCE_EXTENSIONS = new Map<string, WorkspaceSourceFile['language']>([
  ['.ts', 'typescript'],
  ['.tsx', 'typescript'],
  ['.js', 'javascript'],
  ['.jsx', 'javascript'],
  ['.mjs', 'javascript'],
  ['.cjs', 'javascript'],
])
const SOURCE_EXCLUDED_DIRECTORIES = new Set(['.git', '.janusX', 'node_modules', 'out', 'dist', 'build', 'release', 'coverage'])
const SOURCE_MAX_FILES = 400
const SOURCE_MAX_FILE_BYTES = 512 * 1024
const SOURCE_MAX_TOTAL_BYTES = 12 * 1024 * 1024

export async function loadWorkspaceSourceFiles(workspacePath: string): Promise<WorkspaceSourceFilesResult> {
  try {
    const root = await realpath(resolve(workspacePath))
    if (!(await stat(root)).isDirectory()) throw new Error('Workspace path is not a directory')

    const files: WorkspaceSourceFile[] = []
    let totalBytes = 0
    let truncated = false

    const visit = async (directory: string): Promise<void> => {
      if (truncated) return
      const entries = await readdir(directory, { withFileTypes: true })
      for (const entry of entries) {
        if (truncated) return
        if (entry.isSymbolicLink()) continue
        const absolutePath = join(directory, entry.name)
        const resolvedPath = resolve(absolutePath)
        if (resolvedPath !== root && !resolvedPath.startsWith(`${root}${sep}`)) continue
        if (entry.isDirectory()) {
          if (!SOURCE_EXCLUDED_DIRECTORIES.has(entry.name)) await visit(absolutePath)
          continue
        }
        const language = SOURCE_EXTENSIONS.get(extname(entry.name).toLowerCase())
        if (!entry.isFile() || !language) continue
        if (files.length >= SOURCE_MAX_FILES) {
          truncated = true
          return
        }
        const result = await janusWorkspaceFs.readText(absolutePath, SOURCE_MAX_FILE_BYTES)
        if (!result.ok) continue
        const bytes = Buffer.byteLength(result.value.content)
        if (totalBytes + bytes > SOURCE_MAX_TOTAL_BYTES) {
          truncated = true
          return
        }
        totalBytes += bytes
        files.push({ path: absolutePath, content: result.value.content, language })
      }
    }

    await visit(root)
    return { files, truncated }
  } catch (error) {
    return { files: [], truncated: false, error: error instanceof Error ? error.message : 'Failed to scan workspace sources' }
  }
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
  ipcMain.handle(FILE_CHANNELS.read, async (_event, filePath: string) => {
    const result = await janusWorkspaceFs.readText(filePath)
    return result.ok
      ? { content: result.value.content, encoding: 'utf-8', size: result.value.size, mtime: result.value.mtime }
      : { error: result.error.message || 'Failed to read file' }
  })

  ipcMain.handle(FILE_CHANNELS.save, async (event, filePath: string, content: string, expectedVersion?: string) => {
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

  ipcMain.handle(FILE_CHANNELS.readBinary, async (_event, filePath: string) => {
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

  ipcMain.handle(FILE_CHANNELS.stat, async (_event, filePath: string) => {
    try {
      const result = await janusWorkspaceFs.stat(filePath)
      if (!result.ok) throw result.error
      return result.value
    } catch (err: any) {
      return { error: err.message || 'Failed to stat file' }
    }
  })

  ipcMain.handle(FILE_CHANNELS.sourceFiles, async (_event, workspacePath: string) => loadWorkspaceSourceFiles(workspacePath))
}
