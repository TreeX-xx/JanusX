import { app, ipcMain, type BrowserWindow } from 'electron'
import { opendir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { workspaceIo } from '@janus-agent/agent-core'
import { WORKSPACE_STORAGE_CHANNELS, type WorkspaceMigrationItem } from '../../shared/ipc/workspace-storage'
import type { Workspace } from '../../shared/ipc/workspace'
import { workspaceStateStore } from '../storage/service'

async function records(): Promise<Workspace[]> {
  const directory = join(app.getPath('userData'), 'janusx', 'workspaces')
  return workspaceIo.run(directory, async batch => {
    const result: Workspace[] = []
    try {
      for await (const item of await opendir(directory)) {
        if (item.isFile() && item.name.endsWith('.json')) {
          const workspace = JSON.parse(await readFile(join(directory, item.name), 'utf8')) as Workspace
          if (typeof workspace.id === 'string' && typeof workspace.path === 'string') result.push(workspace)
        }
        await batch.step()
      }
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    return result
  }, { background: true })
}

async function inspect(workspace: Workspace): Promise<WorkspaceMigrationItem> {
  if (workspace.runtime && workspace.runtime.kind !== 'windows') return {
    id: workspace.id, name: workspace.name, source: workspace.path, target: '', categories: [], status: 'unsupported',
    error: '远程工作区需在其运行环境内迁移；本机迁移不会访问远程路径。 Remote migration is not available from this local profile.',
  }
  return workspaceStateStore().inspect(workspace.path, workspace.id, workspace.name)
}

export function registerWorkspaceStorageHandlers(getAllowedWindows: () => readonly BrowserWindow[]): void {
  const authorize = (sender: { id: number }) => {
    if (!getAllowedWindows().some(window => !window.isDestroyed() && window.webContents.id === sender.id)) throw new Error('Workspace storage is only available to application windows')
  }
  ipcMain.handle(WORKSPACE_STORAGE_CHANNELS.list, async event => {
    authorize(event.sender)
    const store = workspaceStateStore(), items: WorkspaceMigrationItem[] = []
    for (const workspace of await records()) items.push(await inspect(workspace))
    return { root: store.root, items, prompt: items.some(item => item.status === 'pending') && !await store.promptDismissed() }
  })
  ipcMain.handle(WORKSPACE_STORAGE_CHANNELS.dismiss, async event => { authorize(event.sender); await workspaceStateStore().dismissPrompt() })
  ipcMain.handle(WORKSPACE_STORAGE_CHANNELS.migrate, async (event, ids: unknown) => {
    authorize(event.sender)
    if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string')) throw new Error('Invalid migration selection')
    const workspaces = await records(), result: WorkspaceMigrationItem[] = []
    for (const id of new Set(ids)) {
      const workspace = workspaces.find(item => item.id === id)
      if (!workspace) throw new Error('Workspace is no longer registered')
      const item = await inspect(workspace)
      if (item.status === 'unsupported' || item.status === 'offline') { result.push(item); continue }
      try { await workspaceStateStore().migrate(workspace.path); result.push(await inspect(workspace)) }
      catch (error) {
        const current = await inspect(workspace)
        result.push({ ...current, status: current.status === 'cleanup-pending' ? 'cleanup-pending' : 'failed', error: String(error) })
      }
    }
    return result
  })
}
