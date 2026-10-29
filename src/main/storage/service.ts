import { app } from 'electron'
import { configureWorkspaceStorage } from '@janus-agent/agent-core'
import { WorkspaceStateStore } from './workspace-state'
import { resolve } from 'node:path'

let store: WorkspaceStateStore | undefined
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
