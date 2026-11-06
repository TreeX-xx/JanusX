/** Durable work records, independent of terminals, model context and live processes. */
export interface SuperAgentWorkspace {
  workspaceId: string
  workspacePath: string
}

export interface SuperAgentResource {
  id: string
  workspaceId: string
  kind: 'input' | 'report'
  sha256: string
  bytes: number
  createdAt: number
}

export interface SuperAgentInput extends SuperAgentWorkspace {
  id: string
  eventId: string
  conversationId: string
  sequence: number
  resourceId: string
  receivedAt: number
  status: 'received' | 'routed' | 'handled'
}

export interface SuperAgentWork extends SuperAgentWorkspace {
  id: string
  creationId: string
  title: string
  goal: string
  sourceInputId: string
  revision: number
  createdAt: number
  updatedAt: number
  closedAt: number | null
  latestExecutionId: string | null
  /** Latest report of the current execution, not proof that every input is incorporated. */
  latestReportId: string | null
}

/** One input can relate to several works; delivery is tracked separately for each. */
export interface SuperAgentDelivery {
  id: string
  workspaceId: string
  inputId: string
  workId: string
  executionId: string | null
  status: 'pending' | 'delivered' | 'incorporated' | 'unknown' | 'cancelled'
  updatedAt: number
}

/** Historical identity only. Loading this record never means a process is running. */
export interface SuperAgentExecution {
  id: string
  workspaceId: string
  workId: string
  instanceId: string
  cwd: string
  providerSessionId: string | null
  nativeTurnId: string | null
  recordedAt: number
}

export interface SuperAgentReport {
  id: string
  workspaceId: string
  workId: string
  executionId: string
  kind: 'ready' | 'question' | 'failure'
  summary: string
  resourceId: string
  receivedAt: number
  /** Confirmed inputs to this execution at report time; conservative association, not proof of incorporation or completion. */
  availableInputIds?: string[]
}

/** Metadata only; full input/report text lives in immutable resources. */
export interface SuperAgentSnapshot {
  workspaceId: string
  revision: number
  works: SuperAgentWork[]
  inputs: SuperAgentInput[]
  deliveries: SuperAgentDelivery[]
  executions: SuperAgentExecution[]
  reports: SuperAgentReport[]
  resources: SuperAgentResource[]
}

export interface SuperAgentWorkDetail extends Omit<SuperAgentSnapshot, 'works'> {
  work: SuperAgentWork
}

export interface SuperAgentSubmitInput {
  /** Keep this identity AND workspaceId when retrying the same submission. */
  eventId: string
  workspaceId: string
  conversationId: string
  text: string
}

export interface SuperAgentInputReceipt {
  input: SuperAgentInput
  duplicate: boolean
  revision: number
}

export interface SuperAgentChange {
  workspaceId: string
  revision: number
  kind: 'input' | 'work' | 'delivery' | 'execution' | 'report'
}

export interface SuperAgentResourceContent {
  resource: SuperAgentResource
  text: string
}
