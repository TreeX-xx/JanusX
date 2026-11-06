export type SuperAgentScheduleStatus = 'awaiting-approval' | 'queued' | 'starting' | 'running' | 'waiting'
  | 'idle' | 'ready' | 'stopping' | 'stopped' | 'failed' | 'interrupted' | 'closed'

export interface SuperAgentScheduleEntry {
  workspaceId: string
  workId: string
  inputId: string
  conversationId: string
  order: number
  expectedRevision: number
  status: SuperAgentScheduleStatus
  operationId?: string
  executionId?: string
  diagnostic?: string
  updatedAt: number
}

export interface SuperAgentScheduleSnapshot {
  workspaceId: string
  revision: number
  maxConcurrentWorkers: number
  /** Global occupancy includes starting, waiting and unconfirmed stops. */
  occupied: number
  diagnostic?: string
  entries: SuperAgentScheduleEntry[]
}

export type SuperAgentRouteDecision = { inputId: string } & (
  | { action: 'new'; key: string; title: string; goal: string }
  | { action: 'continue' | 'stop' | 'close' | 'reopen'; workId: string; expectedRevision: number }
  | { action: 'stop-all'; scope: 'workspace' | 'all-workspaces' }
)

export interface SuperAgentWorkControl {
  workspaceId: string
  conversationId: string
  workId: string
  expectedRevision: number
  action: 'stop' | 'close'
}
