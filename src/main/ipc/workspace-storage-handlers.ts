// Note: .agents/notes/desktop/workspace-state-storage.md
import { app, ipcMain, type BrowserWindow } from 'electron'
import { opendir, readFile, writeFile, rename, unlink } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { workspaceIo } from '@janus-agent/agent-core'
import { WORKSPACE_STORAGE_CHANNELS, type WorkspaceMigrationItem, type WorkspaceCleanupCategory } from '../../shared/ipc/workspace-storage'
import type { Workspace } from '../../shared/ipc/workspace'
import { workspaceStateStore, startWorkspaceMaintenance, requestWorkspaceMaintenance } from '../storage/service'
import { disposeWorkspaceWatcher } from './handlers'
import { retireLegacyHooks } from '../notifications/retire-legacy-hooks'

export async function workspaceStorageRecords(): Promise<Workspace[]> {
  const directory = join(app.getPath('userData'), 'janusx', 'workspaces')
  return workspaceIo.run(directory, async batch => {
    const result: Workspace[] = []
    try {
      for await (const item of await opendir(directory)) {
        if (item.isFile() && item.name.endsWith('.json')) {
          const workspace = JSON.parse(await readFile(join(directory, item.name), 'utf8')) as Workspace
          if (typeof workspace.id === 'string' && typeof workspace.path === 'string' && `${workspace.id}.json` === item.name) result.push(workspace)
        }
        await batch.step()
      }
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    return result
  }, { background: true })
}
const records = workspaceStorageRecords
const localRecords = async () => (await records()).filter(item => !item.runtime || item.runtime.kind === 'windows')
const pathKey = (path: string) => process.platform === 'win32' ? resolve(path).toLowerCase() : resolve(path)

export async function syncWorkspaceStorageRecords(): Promise<void> {
  await workspaceIo.run(workspaceStateStore().root, async () => workspaceStateStore().sync(await localRecords()))
  requestWorkspaceMaintenance()
}

async function saveRecord(workspace: Workspace): Promise<void> {
  const path = join(app.getPath('userData'), 'janusx', 'workspaces', `${workspace.id}.json`)
  const temporary = `${path}.${randomUUID()}.tmp`
  try { await writeFile(temporary, JSON.stringify(workspace, null, 2), { flag: 'wx' }); await rename(temporary, path) }
  finally { await unlink(temporary).catch(() => {}) }
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
  ipcMain.handle(WORKSPACE_STORAGE_CHANNELS.retireHooks, async event => {
    authorize(event.sender)
    const [{ terminalManager }, { getProjectRunner }] = await Promise.all([
      import('../terminal/manager'), import('../project/runner/service'),
    ])
    return retireLegacyHooks({ homeDir: homedir(), userDataDir: app.getPath('userData'),
      claudeConfigDir: process.env.CLAUDE_CONFIG_DIR?.trim(), codexHome: process.env.CODEX_HOME?.trim(),
    }, () => {
      if (terminalManager.listInstances().some(terminal => terminal.status !== 'exited') || getProjectRunner().getAllRunning().size) {
        throw new Error('请先关闭终端和运行任务，再清理旧 Hook。 Close terminals and running tasks before cleanup.')
      }
    })
  })
  startWorkspaceMaintenance(localRecords)
  workspaceStateStore().completeRelocation = async (oldPath, newPath) => {
    for (const workspace of (await localRecords()).filter(item => pathKey(item.path) === pathKey(oldPath))) {
      await saveRecord({ ...workspace, path: newPath, updatedAt: new Date().toISOString() })
    }
  }
  ipcMain.handle(WORKSPACE_STORAGE_CHANNELS.data, async event => {
    authorize(event.sender)
    const data = await workspaceIo.run(workspaceStateStore().root, async () => workspaceStateStore().data(await localRecords()))
    requestWorkspaceMaintenance()
    return data
  })
  ipcMain.handle(WORKSPACE_STORAGE_CHANNELS.measure, async (event, id: unknown) => {
    authorize(event.sender)
    if (typeof id !== 'string') throw new Error('Invalid storage id')
    return workspaceStateStore().measure(id)
  })
  ipcMain.handle(WORKSPACE_STORAGE_CHANNELS.cleanup, async (event, id: unknown, category: unknown) => {
    authorize(event.sender)
    if (typeof id !== 'string' || !['logs', 'checkpoints', 'all'].includes(String(category))) throw new Error('Invalid cleanup selection')
    return workspaceIo.run(workspaceStateStore().root, async () => {
      await workspaceStateStore().sync(await localRecords())
      await workspaceStateStore().cleanup(id, category as WorkspaceCleanupCategory)
      requestWorkspaceMaintenance()
    }, { background: true })
  })
  ipcMain.handle(WORKSPACE_STORAGE_CHANNELS.relocate, async (event, id: unknown, destination: unknown) => {
    authorize(event.sender)
    if (typeof id !== 'string' || typeof destination !== 'string' || !destination.trim()) throw new Error('Invalid workspace relocation')
    return workspaceIo.run(workspaceStateStore().root, async () => {
      const workspaces = await localRecords()
      await workspaceStateStore().relocate(id, destination, async (oldPath, newPath) => {
        for (const workspace of workspaces.filter(item => pathKey(item.path) === pathKey(oldPath))) {
          await saveRecord({ ...workspace, path: newPath, updatedAt: new Date().toISOString() })
        }
        disposeWorkspaceWatcher(oldPath)
      })
      requestWorkspaceMaintenance()
    })
  })
  ipcMain.handle(WORKSPACE_STORAGE_CHANNELS.restore, async (event, id: unknown) => {
    authorize(event.sender)
    return workspaceIo.run(workspaceStateStore().root, async () => {
      const workspaces = await localRecords()
      const item = (await workspaceStateStore().data(workspaces)).find(item => item.id === id)
      if (!item?.detachedAt || item.status === 'purging') throw new Error('Workspace data is not available for reattachment')
      const workspace: Workspace = { id: randomUUID(), name: item.name, path: item.path, clis: [], layout: { mode: 'grid', positions: [] }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
      const inspected = await workspaceStateStore().inspect(item.path, workspace.id, item.name)
      if (inspected.target !== item.target) throw new Error('WORKSPACE_IDENTITY_MISMATCH')
      await saveRecord(workspace)
      await syncWorkspaceStorageRecords()
    })
  })
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
    requestWorkspaceMaintenance()
    return result
  })
}
