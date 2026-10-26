import type {
  BlueprintFeatureStatus,
  BlueprintNode,
  BlueprintNodeStatus,
  BlueprintNodeType,
  BlueprintNodeWorkspaceBinding,
  BlueprintRelation,
  BlueprintRelationType,
} from './types'

export interface BlueprintProposedFeature {
  id?: string
  title: string
  description: string
  progress: number
  status: BlueprintFeatureStatus
  requirementNotes: string[]
}

export type BlueprintMaintenanceScope =
  | { type: 'node'; nodeId: string }
  | { type: 'subtree'; nodeId: string }
  | { type: 'blueprint' }

export interface BlueprintEvidenceFile {
  path: string
  sha256: string
  role: 'critical' | 'supporting'
  sourceState: 'committed' | 'staged' | 'unstaged' | 'untracked'
  supportsOperationIds: string[]
}

export interface BlueprintEvidenceManifest {
  workspaceId: string
  workspaceRootFingerprint: string
  gitHead?: string
  files: BlueprintEvidenceFile[]
}

export type BlueprintMaintenanceTaskStatus =
  | 'draft'
  | 'analyzing'
  | 'proposal-ready'
  | 'applying'
  | 'active'
  | 'stale'
  | 'completed'
  | 'cancelled'
  | 'failed'

export interface BlueprintMaintenanceMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: string
}

interface BlueprintOperationBase {
  operationId: string
  reason: string
  evidenceRefs: string[]
  dependsOn: string[]
  risk: 'low' | 'medium' | 'high'
}

export interface BlueprintCreateNodeOperation extends BlueprintOperationBase {
  type: 'create-node'
  tempNodeId: string
  parentId: string
  after: {
    title: string
    type: BlueprintNodeType
    description: string
    positioning: string
    techSolution: string
    notes: string
    tags: string[]
  }
}

export interface BlueprintUpdateNodeOperation extends BlueprintOperationBase {
  type: 'update-node'
  nodeId: string
  before: Partial<BlueprintNode> & { sections?: Record<string, string | null> }
  after: Partial<Pick<BlueprintNode,
    'title' | 'type' | 'status' | 'progress' | 'positioning' | 'description' |
    'techSolution' | 'notes' | 'tags'>> & { features?: BlueprintProposedFeature[]; sections?: Record<string, string | null> }
}

export interface BlueprintMoveNodeOperation extends BlueprintOperationBase {
  type: 'move-node'
  nodeId: string
  beforeParentId: string | null
  afterParentId: string
}

export interface BlueprintAddRelationOperation extends BlueprintOperationBase {
  type: 'add-relation'
  /** Proposal-local id so dependent operations can reference the new relation. */
  tempRelationId: string
  after: {
    sourceNodeId: string
    targetNodeId: string
    relationType: BlueprintRelationType
    description?: string
  }
}

export interface BlueprintUpdateRelationOperation extends BlueprintOperationBase {
  type: 'update-relation'
  relationId: string
  before: Partial<Pick<BlueprintRelation, 'type' | 'description'>>
  after: {
    relationType?: BlueprintRelationType
    description?: string
  }
}

export interface BlueprintRemoveRelationOperation extends BlueprintOperationBase {
  type: 'remove-relation'
  relationId: string
  before?: BlueprintRelation
}

export interface BlueprintUpdateWorkspaceBindingOperation extends BlueprintOperationBase {
  type: 'update-workspace-binding'
  nodeId: string
  before: BlueprintNodeWorkspaceBinding
  after: BlueprintNodeWorkspaceBinding
}

export interface BlueprintArchiveNodeOperation extends BlueprintOperationBase {
  type: 'archive-node'
  nodeId: string
  beforeStatus: BlueprintNodeStatus
}

export interface BlueprintDeleteNodeImpact {
  title: string
  parentId: string | null
  childIds: string[]
  incomingRelationIds: string[]
  outgoingRelationIds: string[]
}

export interface BlueprintDeleteNodeOperation extends BlueprintOperationBase {
  type: 'delete-node'
  nodeId: string
  /** Always forced to 'high'; deletion never joins bulk approval. */
  risk: 'high'
  impact: BlueprintDeleteNodeImpact
}

/**
 * Undo-only operation emitted when reversing an applied delete-node. It is not
 * part of the model proposal schema and is rejected by proposal normalization.
 */
export interface BlueprintRestoreNodeOperation extends BlueprintOperationBase {
  type: 'restore-node'
  nodeId: string
  node: BlueprintNode
  relations: BlueprintRelation[]
}

export type BlueprintOperation =
  | BlueprintCreateNodeOperation
  | BlueprintUpdateNodeOperation
  | BlueprintMoveNodeOperation
  | BlueprintAddRelationOperation
  | BlueprintUpdateRelationOperation
  | BlueprintRemoveRelationOperation
  | BlueprintUpdateWorkspaceBindingOperation
  | BlueprintArchiveNodeOperation
  | BlueprintDeleteNodeOperation
  | BlueprintRestoreNodeOperation

export type BlueprintChangeSetStatus =
  | 'ready'
  | 'applied'
  | 'partially-approved'
  | 'rejected'
  | 'stale'

export type BlueprintMaintenanceGroupKind = 'node' | 'relations' | 'bindings' | 'deletes'

export interface BlueprintMaintenanceIntentGroup {
  id: string
  kind: BlueprintMaintenanceGroupKind
  /** Primary blueprint node this group edits, if any. */
  nodeId?: string
  title: string
  summary: string
  risk: 'low' | 'medium' | 'high'
  operationIds: string[]
  evidenceRefs: string[]
}

export interface BlueprintChangeSet {
  id: string
  taskId: string
  blueprintId: string
  baseRevision: number
  version: number
  status: BlueprintChangeSetStatus
  reason: string
  /** Host-captured raw Note hashes at proposal time, keyed by source UUID. */
  sourceHashes?: Record<string, string>
  evidence?: BlueprintEvidenceManifest[]
  operations: BlueprintOperation[]
  /** Node-aggregated approval groups derived from operations. Absent on legacy records. */
  groups?: BlueprintMaintenanceIntentGroup[]
  /** Human-readable整理稿 markdown, bound to the same version as operations. */
  digest?: string
  createdAt: string
  /** Marks reverse ChangeSets generated from an audit record. */
  undoOfAuditId?: string
}

export interface BlueprintMaintenanceTask {
  id: string
  conversationId?: string
  blueprintId: string
  blueprintName: string
  baseRevision: number
  workspaceId: string
  workspaceName: string
  workspacePath: string
  authorizedWorkspaces?: BlueprintMaintenanceWorkspace[]
  nodeScope: BlueprintMaintenanceScope
  goal: string
  status: BlueprintMaintenanceTaskStatus
  progress: number
  phase: string
  messages: BlueprintMaintenanceMessage[]
  changeSet: BlueprintChangeSet | null
  changeSetHistory: BlueprintChangeSet[]
  error?: string
  createdAt: string
  updatedAt: string
}

export interface BlueprintMaintenanceWorkspace {
  workspaceId: string
  workspaceName: string
  workspacePath: string
}

export interface BlueprintMaintenanceStartInput {
  blueprintId: string
  conversationId?: string
  workspaceId: string
  workspaceName: string
  workspacePath: string
  authorizedWorkspaces?: BlueprintMaintenanceWorkspace[]
  nodeScope: BlueprintMaintenanceScope
  goal: string
  providerId?: string
  modelId?: string
}

/**
 * Dispatch hand-off, produced from a maintenance conversation and prefilled
 * into a work terminal. Never submitted automatically.
 *
 * Note: intentionally not a BlueprintOperation — the change set is content-only
 * and reversing a terminal launch has no meaning.
 */
export interface BlueprintDispatchBrief {
  goal: string
  steps: string[]
  acceptance: string[]
  constraints: string[]
  /** Intersected with the task scope by the host; never model-invented. */
  noteRefs: string[]
}

export interface BlueprintDispatchBriefResult {
  brief: BlueprintDispatchBrief
  /** Exact text prefilled into the terminal. */
  text: string
  /** Node the dispatched terminal binds to, for terminal-close analysis. */
  anchorNodeId: string | null
  workspaceId: string
  workspaceName: string
  workspacePath: string
}

export interface BlueprintMaintenanceApplyInput {
  taskId: string
  changeSetId: string
  /** Host-owned frozen file selection reviewed by the user. */
  previewId?: string
  operationIds: string[]
  /**
   * Node-aggregated approval: callers may pass group ids instead of (or
   * together with) operation ids. The main process expands them to operations
   * with dependency closure before validation.
   */
  groupIds?: string[]
  /**
   * Every selected delete-node operation must appear here. The main process
   * rejects the apply otherwise — bulk approval never covers deletions.
   */
  confirmedDeleteOperationIds?: string[]
}

export interface BlueprintMaintenancePreviewInput {
  taskId: string
  changeSetId: string
  conversationId?: string
  workspaceId: string
  workspacePath: string
  operationIds: string[]
  groupIds?: string[]
}

export interface BlueprintMaintenanceFilePreview {
  uri: string
  path: string
  kind: 'create' | 'replace'
  reason: string
  operationIds: string[]
  before: string
  after: string
  /** Note deletion is represented by an archive in the Note transaction. */
  archivedInsteadOfDeleted?: boolean
}

export interface BlueprintMaintenancePreview {
  id: string
  changeSetId: string
  files: BlueprintMaintenanceFilePreview[]
}

export interface BlueprintMaintenanceApplyResult {
  task: BlueprintMaintenanceTask
  blueprintRevision: number
  appliedOperationIds: string[]
}

export interface BlueprintMaintenanceAuditListInput {
  blueprintId: string
  taskId?: string
}

export interface BlueprintMaintenanceAuditRecord {
  id: string
  taskId: string
  changeSetId: string
  blueprintId: string
  beforeRevision: number
  afterRevision: number
  selectedOperationIds: string[]
  rejectedOperationIds: string[]
  /** Delete operations the user individually confirmed at apply time. */
  confirmedDeleteOperationIds?: string[]
  status: 'pending' | 'applied'
  changeSetSnapshot: BlueprintChangeSet
  /** Real ids assigned when create-node / add-relation operations were applied, keyed by temp id. */
  createdNodeIds?: Record<string, string>
  createdRelationIds?: Record<string, string>
  /** Set when this record was produced by applying a reverse ChangeSet. */
  undoOfAuditId?: string
  /**
   * Local checkout root for audits on harness project graphs. Restart-safe
   * undo resolves through it first; the registered workspace list is the
   * fallback. Local-only: never enters shared exports.
   */
  harnessRoot?: string
  beforeSnapshot: unknown
  afterSnapshot?: unknown
  createdAt: string
  appliedAt?: string
}

export interface BlueprintMaintenanceUndoPrepareInput {
  blueprintId: string
  auditId: string
}

export interface BlueprintMaintenanceUndoPrepareResult {
  changeSet: BlueprintChangeSet
  /** Human-readable conflicts against the current Blueprint; non-blocking for unselected operations. */
  conflicts: string[]
}

export interface BlueprintMaintenanceUndoApplyInput {
  blueprintId: string
  undoChangeSetId: string
  operationIds: string[]
  confirmedDeleteOperationIds?: string[]
}

export interface BlueprintMaintenanceUndoApplyResult {
  blueprintRevision: number
  appliedOperationIds: string[]
  auditId: string
}

export interface BlueprintMaintenanceDismissInput {
  taskId: string
}

/**
 * Redacted, task-scoped agent lifecycle events for the maintenance renderer.
 * Tool arguments and raw tool output never leave the main process here.
 */
export type BlueprintMaintenanceAgentEvent =
  | { type: 'agent_start'; taskId: string }
  | { type: 'text_delta'; taskId: string; delta: string }
  | { type: 'reasoning_delta'; taskId: string; delta: string }
  | { type: 'tool_call_start'; taskId: string; callId: string; toolName?: string }
  | { type: 'tool_call_ready'; taskId: string; callId: string; toolName: string; argumentKeys: string[] }
  | { type: 'tool_execution_start'; taskId: string; callId: string; toolName: string }
  | { type: 'tool_execution_end'; taskId: string; callId: string; toolName: string; status: 'completed' | 'failed' }
  | { type: 'model_finish'; taskId: string; reason: 'stop' | 'tool_calls' | 'length' | 'unknown' }
  | { type: 'model_error'; taskId: string; code: string; retryable: boolean }
  | { type: 'steering_consumed'; taskId: string; keys: string[] }
  | { type: 'recall_trace'; taskId: string; status: string; recalledCount: number }
  | { type: 'stream_end'; taskId: string; cancelled: boolean }

export interface BlueprintMaintenanceToolTraceEntry {
  toolName: string
  workspaceId: string
  status: string
  summary: string
  argsDigest?: string
  resultDigest?: string
}

export interface BlueprintMaintenanceEvent {
  task: BlueprintMaintenanceTask
  agentEvent?: BlueprintMaintenanceAgentEvent
  toolTrace?: { taskId: string; entries: BlueprintMaintenanceToolTraceEntry[] }
}
