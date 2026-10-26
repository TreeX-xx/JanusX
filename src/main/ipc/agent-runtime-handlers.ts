import type { BrowserWindow, IpcMain } from 'electron'
import { AGENT_RUNTIME_CHANNELS, type ApprovalResult, type CreateAgentSessionInput, type ExecuteToolInput, type AgentApprovalMode } from '../../shared/ipc/agent-runtime'
import { configService } from '../config/service'
import { workspaceAgentRuntime, workflowSessionParents } from '../agent/runtime/shell-runtime'
import { registerWorkspaceTools } from '@janus-agent/agent-core'
import { registerNoteTools, connectConfiguredMcp, type McpToolManager } from '@janus-agent/node-hosts'
import { registerProjectTools } from '../agent/runtime/tools/project-tools'
import { registerGitTools } from '../agent/runtime/tools/git-tools'
import { registerCommandTools } from '../agent/runtime/tools/command-tools'
import { registerUserMemoryTools } from '../agent/runtime/tools/user-memory-tools'
import { registerPluginTools, type PluginAgentPort } from '../agent/runtime/tools/plugin-tools'
import { harnessNoteService } from '../harness/service'
import type { ResolveWorkspaceRoot } from '../office/office-workspace-guard'

let registered = false
let mcpReady: Promise<McpToolManager> | undefined
export async function closeAgentMcp(): Promise<void> { await (await mcpReady)?.close() }
let getMainWindow: () => BrowserWindow | null = () => null

export function registerAgentRuntimeHandlers(windowGetter: () => BrowserWindow | null, ipcMain: IpcMain, resolveWorkspaceRoot?: ResolveWorkspaceRoot, getPluginPort: () => PluginAgentPort | undefined = () => undefined): void {
  getMainWindow = windowGetter
  // Office guard resolves `undefined` for unknown workspaces; the core port
  // uses `null` for the same case (fail-closed on both sides).
  if (resolveWorkspaceRoot) workspaceAgentRuntime.setWorkspaceResolver((id) => resolveWorkspaceRoot(id).then((root) => root ?? null))
  if (registered) return
  registerWorkspaceTools(workspaceAgentRuntime.registry)
  registerNoteTools(workspaceAgentRuntime.registry, harnessNoteService)
  // Note: optional domain tools arrive through configured MCP or plugin capabilities — see .agents/notes/planning/blueprint-official-plugin.md
  registerProjectTools(workspaceAgentRuntime.registry)
  registerGitTools(workspaceAgentRuntime.registry)
  registerCommandTools(workspaceAgentRuntime.registry)
  registerUserMemoryTools(workspaceAgentRuntime.registry)
  registerPluginTools(workspaceAgentRuntime.registry, getPluginPort)
  mcpReady = connectConfiguredMcp(workspaceAgentRuntime.registry)
  registered = true
  ipcMain.handle(AGENT_RUNTIME_CHANNELS.createSession, async (event, input: CreateAgentSessionInput) => {
    await mcpReady
    return workspaceAgentRuntime.createSession({ ...input, approvalMode: input.approvalMode ?? await configService.getAgentApprovalMode(), safeCompileAutoAllow: input.safeCompileAutoAllow ?? await configService.getSafeCompileAutoAllow() }, `renderer:${event.sender.id}`)
  })
  ipcMain.handle(AGENT_RUNTIME_CHANNELS.executeTool, (event, input: ExecuteToolInput) => workspaceAgentRuntime.executeTool(input, `renderer:${event.sender.id}`))
  ipcMain.handle(AGENT_RUNTIME_CHANNELS.cancelSession, async (_event, sessionId: string) => {
    const result = await workspaceAgentRuntime.cancelSession(sessionId)
    for (const [child, parent] of workflowSessionParents) {
      if (parent !== sessionId) continue
      try { await workspaceAgentRuntime.cancelSession(child) } finally { workflowSessionParents.delete(child) }
    }
    return result
  })
  ipcMain.handle(AGENT_RUNTIME_CHANNELS.resolveApproval, (event, input: ApprovalResult) => workspaceAgentRuntime.resolveApproval(input, `renderer:${event.sender.id}`))
  ipcMain.handle(AGENT_RUNTIME_CHANNELS.getSession, (_event, sessionId: string) => workspaceAgentRuntime.getSession(sessionId))
  ipcMain.handle(AGENT_RUNTIME_CHANNELS.setApprovalMode, (event, input: { sessionId: string; mode: AgentApprovalMode }) => workspaceAgentRuntime.setApprovalMode(input.sessionId, input.mode, `renderer:${event.sender.id}`))
  ipcMain.handle(AGENT_RUNTIME_CHANNELS.queryPolicyAudit, (_event, query) => workspaceAgentRuntime.queryPolicyAudit(query))
  ipcMain.handle(AGENT_RUNTIME_CHANNELS.executeFunctionCall, (event, input: ExecuteToolInput) => workspaceAgentRuntime.executeFunctionCall(input, `renderer:${event.sender.id}`))
  ipcMain.handle(AGENT_RUNTIME_CHANNELS.executePlannerStep, (event, input: ExecuteToolInput) => workspaceAgentRuntime.executePlannerStep(input, `renderer:${event.sender.id}`))
  workspaceAgentRuntime.onEvent((event) => {
    const mainWindow = getMainWindow()
    const sessionId = 'session' in event ? event.session.id : 'sessionId' in event ? event.sessionId
      : 'request' in event ? event.request.sessionId : 'decision' in event ? event.decision.sessionId : event.result.sessionId
    const parentSessionId = workflowSessionParents.get(sessionId)
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) mainWindow.webContents.send(AGENT_RUNTIME_CHANNELS.event, parentSessionId ? { ...event, parentSessionId } : event)
  })
}
