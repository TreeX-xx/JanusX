import { ipcMain, shell, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { detectWorkflowX } from '@janus-agent/node-hosts'
import { WORKFLOWX_CHANNELS, type WorkflowXSnapshot } from '../../shared/ipc/workflowx'
import type { ResolveWorkspaceRoot } from '../office/office-workspace-guard'

// Note: quiet external WorkflowX import detection — see .agents/notes/blueprint/workspaces/requirements/workflowx-onboarding.md
export function registerWorkflowXHandlers(options: {
  getAllowedWindows: () => readonly BrowserWindow[]
  resolveWorkspaceRoot: ResolveWorkspaceRoot
}): void {
  let cached: { root?: string; value: WorkflowXSnapshot } | undefined
  const authorized = (event: IpcMainInvokeEvent) => options.getAllowedWindows().some(window =>
    !window.isDestroyed() && !window.webContents.isDestroyed() && window.webContents === event.sender)

  ipcMain.handle(WORKFLOWX_CHANNELS.detect, async (event, workspaceId: unknown, refresh: unknown) => {
    const id = typeof workspaceId === 'string' && workspaceId.length <= 256 ? workspaceId : null
    const unavailable = (): WorkflowXSnapshot => ({ workspaceId: id, status: 'uncertain', sources: [], checkedAt: Date.now(), unavailable: true })
    if (!authorized(event) || (workspaceId !== null && id === null)) return unavailable()
    try {
      const root = id ? await options.resolveWorkspaceRoot(id) : undefined
      if (id && !root) return unavailable()
      if (refresh !== true && cached?.root === root && cached?.value.workspaceId === id
        && Date.now() - cached.value.checkedAt < 15_000) return cached.value
      const value: WorkflowXSnapshot = { ...await detectWorkflowX({ workspacePath: root }), workspaceId: id }
      cached = { root, value }
      return value
    } catch { return unavailable() }
  })

  ipcMain.handle(WORKFLOWX_CHANNELS.openRepository, async (event) => {
    if (!authorized(event)) return false
    try {
      await shell.openExternal('https://github.com/TreeX-xx/WorkFlowX')
      return true
    } catch { return false }
  })
}
