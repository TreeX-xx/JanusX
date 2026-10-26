type StructuredCloneValue = string | number | boolean | null | undefined | StructuredCloneValue[] | { [key: string]: StructuredCloneValue }
type OwnerScope = 'private' | 'project'

export type BlueprintNodeType = 'epic' | 'feature' | 'task' | 'issue'

export type BlueprintNodeStatus =
  | 'not-started'
  | 'planning'
  | 'in-progress'
  | 'testing'
  | 'bug-fixing'
  | 'blocked'
  | 'paused'
  | 'done'
  | 'archived'

export type BlueprintStatusSource = 'manual' | 'janus'

export interface WorkspaceSnapshot {
  name: string
  path: string
}

export type AnalysisTrigger =
  | 'commit-threshold'
  | 'manual'
  | 'terminal-close'
  | 'reconcile'

export interface BlueprintTodo {
  id: string
  text: string
  done: boolean
  createdAt: string
}

export type BlueprintFeatureStatus = 'planned' | 'in-progress' | 'done' | 'blocked'

export interface BlueprintFeatureItem {
  id: string
  title: string
  description: string
  progress: number
  status: BlueprintFeatureStatus
  requirementNotes: string[]
  createdAt: string
  updatedAt: string
}

export type BlueprintIssueSeverity = 'low' | 'medium' | 'high' | 'critical'
export type BlueprintIssueStatus = 'open' | 'resolved' | 'wontfix'

export interface BlueprintIssue {
  id: string
  title: string
  description: string
  severity: BlueprintIssueSeverity
  status: BlueprintIssueStatus
  createdAt: string
  resolvedAt?: string
}

export type BlueprintActivityType =
  | 'terminal-start'
  | 'file-change'
  | 'commit'
  | 'output'
  | 'analysis'
  | 'note'
  | 'status-change'

export interface BlueprintActivity {
  id: string
  type: BlueprintActivityType
  content: string
  metadata?: Record<string, StructuredCloneValue>
  createdAt: string
}

export interface DiscoveredRequirement {
  title: string
  description: string
  suggestedParent: string
  confidence: number
}

export type BlueprintRequirementCandidateStatus = 'pending' | 'accepted' | 'rejected'

export interface BlueprintRequirementCandidate {
  id: string
  blueprintId: string
  sourceNodeId: string
  sourceAnalysisId: string
  title: string
  description: string
  suggestedParentId?: string
  suggestedParentTitle?: string
  confidence: number
  status: BlueprintRequirementCandidateStatus
  acceptedNodeId?: string
  decisionNote?: string
  evidence: string[]
  createdAt: string
  decidedAt?: string
}

export interface AnalysisResult {
  schemaVersion: number
  progress: number
  status: BlueprintNodeStatus
  summary: string
  confidence: number
  evidence: string[]
  unresolved: string[]
  discoveredRequirements: DiscoveredRequirement[]
  featureUpdates: Array<{
    featureId: string
    progress?: number
    status?: BlueprintFeatureStatus
    description?: string
    requirementNotes?: string[]
  }>
  newFeatureRequirements: DiscoveredRequirement[]
}

export interface AnalysisInputSummary {
  blueprint: string
  actual: string
}

export interface BlueprintAnalysis {
  id: string
  nodeId: string
  trigger: AnalysisTrigger
  inputSummary: AnalysisInputSummary
  result: AnalysisResult
  applied: boolean
  error?: string
  createdAt: string
}

export type BlueprintRelationType =
  | 'parent'
  | 'governed-by'
  | 'derived-from'
  | 'supersedes'
  | 'depends-on'
  | 'blocks'
  | 'related-to'
  | 'implements'

export interface BlueprintRelation {
  id: string
  sourceNodeId: string
  targetNodeId: string
  type: BlueprintRelationType
  sourceUri?: string
  targetUri?: string
  criteria?: string[]
  scope?: 'full' | 'partial'
  reason?: string
  declarations?: string[]
  resolution?: import('@janus-agent/harness-node').NoteResolution
  description?: string
  createdAt: string
  updatedAt: string
}

export interface BlueprintNodeWorkspaceBinding {
  primaryWorkspaceId: string | null
  linkedWorkspaceIds: string[]
}

export interface BlueprintNode {
  id: string
  title: string
  type: BlueprintNodeType
  status: BlueprintNodeStatus
  /**
   * 原始 note 词汇（NoteAdapter v1 透传；legacy JSON 缺省）。
   * type/status 是映射后的画布词汇，kind/lifecycle 是 note 原文，
   * 详情 eyebrow/chips 与 kind 过滤直接读这里，不做二次映射。
   */
  kind?: string
  lifecycle?: string
  progress: number
  statusSource: BlueprintStatusSource
  positioning: string
  description: string
  features: BlueprintFeatureItem[]
  completedItems: string[]
  techSolution: string
  notes: string
  todos: BlueprintTodo[]
  issues: BlueprintIssue[]
  activities: BlueprintActivity[]
  analyses: BlueprintAnalysis[]
  /**
   * Harness projection (S4): file-backed identity. Present only on nodes
   * projected from `.agents/notes`. `sourceHash` is the last-seen file
   * digest and seeds optimistic-concurrency saves.
   */
  sourceUri?: string
  sourceHash?: string
  sourceRelPath?: string
  note?: import('../notes').NoteDoc
  /** Derived only from the shared runtime's valid execution/coverage overlay. */
  noteEvidence?: { taskDone?: boolean; coveredACs?: number; totalACs?: number }
  /** @deprecated Mirror of primaryWorkspaceId kept for legacy readers; write both via store APIs. */
  workspaceId: string | null
  primaryWorkspaceId: string | null
  linkedWorkspaceIds: string[]
  workspaceSnapshot: WorkspaceSnapshot | null
  boundTerminalId: string | null
  terminalHistory: string[]
  lastAnalyzedCommitSha: string | null
  children: string[]
  parentId: string | null
  tags: string[]
  createdAt: string
  updatedAt: string
}

export interface BlueprintInvalidNote {
  relPath: string
  classification?: string
  diagnostics: Array<{ code: string; message: string }>
}

export interface Blueprint {
  /** Persisted schema version; absent means the legacy v0 shape. */
  schemaVersion?: number
  /** 'harness' marks a live projection over `.agents/notes`; default lane is 'json'. */
  source?: 'json' | 'harness'
  /** NoteAdapter version that produced this projection (harness lane only; legacy JSON leaves it undefined). */
  adapterVersion?: string
  /** Monotonic version for semantic changes. Canvas-only changes do not increment it. */
  contentRevision: number
  id: string
  name: string
  description: string
  /**
   * ToB M1 归属字段（全可选，历史数据缺省即单机私人数据）：
   * ownerScope 缺省 'private'；version 复用 contentRevision，不另设字段。
   */
  ownerScope?: OwnerScope
  tenantId?: string | null
  projectId?: string | null
  ownerUserId?: string | null
  updatedBy?: string | null
  rootNodeId: string
  nodeIds: string[]
  nodes: Record<string, BlueprintNode>
  relations: BlueprintRelation[]
  requirementCandidates: BlueprintRequirementCandidate[]
  mountedTo: string | null
  canvasLayout: Record<string, { x: number; y: number }>
  /** Persisted collapsed node ids; null/undefined means not initialized yet. */
  collapsedNodeIds?: string[] | null
  /**
   * Notes that failed validation, excluded from the graph but surfaced for
   * repair. Transient (fresh per projection, never persisted to JSON).
   */
  invalidNotes?: BlueprintInvalidNote[]
  /** Original serializable read model, shared with engineering wiki. */
  noteSnapshot?: import('../notes').NoteReadSnapshot
  composition?: import('../blueprint-composition').BlueprintComposition
  projectionDiagnostics?: Array<{ code: string; message: string; path?: string }>
  createdAt: string
  updatedAt: string
}

export const ANALYSIS_SCHEMA_VERSION = 1
