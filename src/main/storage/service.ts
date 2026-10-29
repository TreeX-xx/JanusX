// Note: .agents/notes/desktop/workspace-state-storage.md
import { app } from 'electron'
import { workspaceIo, configureWorkspaceStorage, configureWorkspaceStorageEvents } from '@janus-agent/agent-core'
import { WorkspaceStateStore } from './workspace-state'
import { resolve } from 'node:path'
import type { WorkspaceDataRecord } from '../../shared/ipc/workspace-storage'

let store: WorkspaceStateStore | undefined
let readRecords: (() => Promise<WorkspaceDataRecord[]>) | undefined
let maintenance: Promise<void> | undefined
let dirty = false
let timer: ReturnType<typeof setTimeout> | undefined

export function requestWorkspaceMaintenance(): void {
  if (!readRecords) return
  dirty = true
  if (maintenance) return
  maintenance = (async () => {
    let next: number | undefined
    while (dirty) {
      dirty = false
      next = await workspaceIo.idle(workspaceStateStore().root, async () => workspaceStateStore().maintain(await readRecords!()), false)
    }
    if (timer) clearTimeout(timer)
    if (next) {
      timer = setTimeout(requestWorkspaceMaintenance, Math.min(2 ** 31 - 1, Math.max(1, next - Date.now())))
      timer.unref?.()
    }
  })().catch(error => console.error('[workspace-data] maintenance failed:', error)).finally(() => {
    maintenance = undefined
    if (dirty) requestWorkspaceMaintenance()
  })
}

export function startWorkspaceMaintenance(records: () => Promise<WorkspaceDataRecord[]>): void {
  readRecords = records
  workspaceStateStore().onChange = requestWorkspaceMaintenance
  configureWorkspaceStorageEvents(() => { if (workspaceStateStore().hasDeferredMaintenance) requestWorkspaceMaintenance() })
  requestWorkspaceMaintenance()
}
export function workspaceStateStore(): WorkspaceStateStore {
  return store ??= new WorkspaceStateStore(app.getPath('userData'), async cwd => {
    const [{ terminalManager }, { getProjectRunner }] = await Promise.all([
      import('../terminal/manager'), import('../project/runner/service'),
    ])
    const normalized = (value: string) => process.platform === 'win32' ? resolve(value).toLowerCase().replace(/\\/g, '/') : resolve(value)
    const under = (path: string) => normalized(path) === normalized(cwd) || normalized(path).startsWith(normalized(cwd) + '/')
    if (terminalManager.listInstances().some(t => t.status !== 'exited' && under(t.config.cwd)) || [...getProjectRunner().getAllRunning().entries()].some(([id, p]) => under(p.scopePath ?? id.split('::')[0]))) {
      throw new Error('请先关闭此工作区及子目录的终端和运行任务，再执行迁移。 Close workspace terminals and tasks before migrating.')
    }
  })
}

/** Called after profile selection and its single-instance lock, before consumers. */
export function initializeWorkspaceStorage(): void {
  configureWorkspaceStorage((cwd, write) => workspaceStateStore().resolve(cwd, write))
}
