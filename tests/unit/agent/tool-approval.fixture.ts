import type { WorkspaceAgentRuntime } from '@janus-agent/agent-core'

export function approveToolRequests(runtime: WorkspaceAgentRuntime): void {
  runtime.onEvent(event => {
    if (event.type !== 'approval-requested') return
    const { id, workspaceId, sessionId, correlationId, toolName, actionRisk } = event.request
    runtime.resolveApproval({ approvalId: id, approved: true, workspaceId, sessionId, correlationId, toolName, actionRisk })
  })
}
