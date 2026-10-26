import type {
  AnalysisTrigger,
  Blueprint,
  BlueprintAnalysis,
  BlueprintFeatureItem,
  BlueprintNode,
  BlueprintNodeStatus,
  BlueprintNodeType,
  BlueprintRequirementCandidate,
  BlueprintRequirementCandidateStatus,
  DiscoveredRequirement,
} from '../../../plugins/blueprint/src/shared/janus/types'
import type {
  BlueprintDispatchBriefResult,
  BlueprintMaintenanceApplyInput,
  BlueprintMaintenanceApplyResult,
  BlueprintMaintenancePreviewInput,
  BlueprintMaintenancePreview,
  BlueprintMaintenanceAuditListInput,
  BlueprintMaintenanceAuditRecord,
  BlueprintMaintenanceDismissInput,
  BlueprintMaintenanceEvent,
  BlueprintMaintenanceStartInput,
  BlueprintMaintenanceTask,
  BlueprintMaintenanceUndoApplyInput,
  BlueprintMaintenanceUndoApplyResult,
  BlueprintMaintenanceUndoPrepareInput,
  BlueprintMaintenanceUndoPrepareResult,
} from '../../../plugins/blueprint/src/shared/janus/maintenance-types'

export const JANUS_COMMAND_CHANNELS = {
  listBlueprints: 'blueprint:list',
  listBlueprintSummaries: 'blueprint:list-summaries',
  loadBlueprint: 'blueprint:load',
  createBlueprint: 'blueprint:create',
  updateBlueprint: 'blueprint:update',
  deleteBlueprint: 'blueprint:delete',
  createNode: 'blueprint:node:create',
  updateNode: 'blueprint:node:update',
  deleteNode: 'blueprint:node:delete',
  replaceNodeFeatures: 'blueprint:node:features',
  addNodeFeature: 'blueprint:node:feature:add',
  updateNodeFeature: 'blueprint:node:feature:update',
  deleteNodeFeature: 'blueprint:node:feature:delete',
  focusNode: 'janus:node:focus',
  bindTerminal: 'janus:terminal:bind',
  analyze: 'janus:analyzer:analyze',
  applyAnalysisPatch: 'janus:analyzer:apply-patch',
  listAnalyses: 'janus:analysis:list',
  applyAnalysis: 'janus:analysis:apply',
  listRequirementCandidates: 'janus:requirements:list-candidates',
  acceptRequirementCandidate: 'janus:requirements:accept-candidate',
  rejectRequirementCandidate: 'janus:requirements:reject-candidate',
  acceptDiscovered: 'janus:analyzer:accept-discovered',
  maintenanceList: 'blueprint:maintenance:list',
  maintenanceAuditList: 'blueprint:maintenance:audit:list',
  maintenanceStart: 'blueprint:maintenance:start',
  maintenanceApply: 'blueprint:maintenance:apply',
  maintenancePreview: 'blueprint:maintenance:preview',
  maintenanceCancel: 'blueprint:maintenance:cancel',
  maintenanceComplete: 'blueprint:maintenance:complete',
  maintenanceDismiss: 'blueprint:maintenance:dismiss',
  maintenanceUndoPrepare: 'blueprint:maintenance:undo:prepare',
  maintenanceUndoApply: 'blueprint:maintenance:undo:apply',
  dispatchComposeBrief: 'blueprint:dispatch:compose-brief',
} as const

export interface BlueprintSummary {
  id: string
  name: string
  description: string
  contentRevision: number
  nodeCount: number
  createdAt: string
  updatedAt: string
}

export const JANUS_EVENT_CHANNELS = {
  analysis: 'janus:island:analysis',
  discovered: 'janus:island:discovered',
  maintenance: 'blueprint:maintenance:event',
} as const

export interface BlueprintCreateInput {
  name: string
  description?: string
  rootTitle?: string
  rootType?: BlueprintNodeType
}

export interface BlueprintUpdatePatch {
  name?: string
  description?: string
  canvasLayout?: Record<string, { x: number; y: number }>
  collapsedNodeIds?: string[] | null
}

export type NodeCreateInput = Partial<BlueprintNode> & {
  title: string
  type: BlueprintNodeType
}

export type FeatureItemInput = Partial<BlueprintFeatureItem> & { title: string }

export interface FocusNodePayload {
  workspacePath: string
  nodeId: string
}

export interface AnalyzerAnalyzePayload {
  nodeId: string
  workspacePath?: string
  trigger?: AnalysisTrigger
  commitLimit?: number
}

export interface ApplyAnalysisPatchPayload {
  workspacePath: string
  blueprintId: string
  nodeId: string
  patch: {
    progress?: number
    status?: BlueprintNodeStatus
    featureUpdates?: Array<{
      featureId: string
      progress?: number
      status?: BlueprintFeatureItem['status']
      description?: string
      requirementNotes?: string[]
    }>
  }
}

export interface AnalysisHistoryPayload {
  workspacePath: string
  blueprintId: string
  nodeId: string
}

export interface ApplyAnalysisPayload extends AnalysisHistoryPayload {
  analysisId: string
}

export interface ListCandidatesPayload {
  workspacePath: string
  blueprintId: string
  status?: BlueprintRequirementCandidateStatus
}

export interface AcceptCandidatePayload {
  workspacePath: string
  blueprintId: string
  candidateId: string
  title?: string
  description?: string
  parentId?: string
  decisionNote?: string
}

export interface RejectCandidatePayload {
  workspacePath: string
  blueprintId: string
  candidateId: string
  decisionNote?: string
}

export interface AcceptDiscoveredPayload {
  workspacePath: string
  blueprintId: string
  discovered: DiscoveredRequirement
  parentId?: string
  fallbackNodeId?: string
}

export interface IslandAnalysisEvent {
  blueprintId: string
  workspacePath: string
  nodeId: string
  nodeTitle: string
  applied: boolean
  error?: string
  result: BlueprintAnalysis['result']
  createdAt: string
}

export interface IslandDiscoveredEvent {
  blueprintId: string
  workspacePath: string
  nodeId: string
  nodeTitle: string
  candidateIds?: string[]
  requirements?: BlueprintRequirementCandidate[]
  discovered: DiscoveredRequirement[]
  createdAt: string
}

export interface JanusAPI {
  listBlueprints(cwd: string): Promise<Blueprint[] | null>
  listBlueprintSummaries(cwd: string): Promise<BlueprintSummary[] | null>
  loadBlueprint(cwd: string, id: string): Promise<Blueprint | null>
  createBlueprint(cwd: string, input: BlueprintCreateInput): Promise<Blueprint>
  updateBlueprint(cwd: string, id: string, patch: BlueprintUpdatePatch): Promise<Blueprint | null>
  deleteBlueprint(cwd: string, id: string): Promise<boolean>
  createNode(cwd: string, blueprintId: string, input: NodeCreateInput, parentId: string | null): Promise<BlueprintNode | null>
  updateNode(cwd: string, blueprintId: string, nodeId: string, patch: Partial<BlueprintNode>): Promise<BlueprintNode | null>
  deleteNode(cwd: string, blueprintId: string, nodeId: string): Promise<boolean>
  replaceNodeFeatures(cwd: string, blueprintId: string, nodeId: string, features: FeatureItemInput[]): Promise<BlueprintNode | null>
  addNodeFeature(cwd: string, blueprintId: string, nodeId: string, feature: FeatureItemInput): Promise<BlueprintNode | null>
  updateNodeFeature(cwd: string, blueprintId: string, nodeId: string, featureId: string, patch: Partial<BlueprintFeatureItem>): Promise<BlueprintNode | null>
  deleteNodeFeature(cwd: string, blueprintId: string, nodeId: string, featureId: string): Promise<BlueprintNode | null>
  focusNode(payload: FocusNodePayload): Promise<BlueprintNode | null>
  bindTerminal(cwd: string, nodeId: string, terminalId: string): Promise<BlueprintNode | null>
  analyze(payload: AnalyzerAnalyzePayload): Promise<BlueprintAnalysis | null>
  applyAnalysisPatch(payload: ApplyAnalysisPatchPayload): Promise<BlueprintNode | null>
  listAnalyses(payload: AnalysisHistoryPayload): Promise<BlueprintAnalysis[]>
  applyAnalysis(payload: ApplyAnalysisPayload): Promise<BlueprintNode | null>
  listRequirementCandidates(payload: ListCandidatesPayload): Promise<BlueprintRequirementCandidate[]>
  acceptRequirementCandidate(payload: AcceptCandidatePayload): Promise<BlueprintNode | null>
  rejectRequirementCandidate(payload: RejectCandidatePayload): Promise<BlueprintRequirementCandidate | null>
  acceptDiscovered(payload: AcceptDiscoveredPayload): Promise<BlueprintNode | null>
  onAnalysisResult(callback: (event: IslandAnalysisEvent) => void): () => void
  onDiscovered(callback: (event: IslandDiscoveredEvent) => void): () => void
  listMaintenanceTasks(): Promise<BlueprintMaintenanceTask[]>
  listMaintenanceAudits(input: BlueprintMaintenanceAuditListInput): Promise<BlueprintMaintenanceAuditRecord[]>
  startMaintenanceTask(input: BlueprintMaintenanceStartInput): Promise<BlueprintMaintenanceTask>
  applyMaintenanceChangeSet(input: BlueprintMaintenanceApplyInput): Promise<BlueprintMaintenanceApplyResult>
  previewMaintenanceChangeSet(input: BlueprintMaintenancePreviewInput): Promise<BlueprintMaintenancePreview>
  cancelMaintenanceTask(taskId: string): Promise<BlueprintMaintenanceTask>
  completeMaintenanceTask(taskId: string): Promise<BlueprintMaintenanceTask>
  dismissMaintenanceProposal(input: BlueprintMaintenanceDismissInput): Promise<BlueprintMaintenanceTask>
  prepareMaintenanceUndo(input: BlueprintMaintenanceUndoPrepareInput): Promise<BlueprintMaintenanceUndoPrepareResult>
  applyMaintenanceUndo(input: BlueprintMaintenanceUndoApplyInput): Promise<BlueprintMaintenanceUndoApplyResult>
  /** One-shot brief for handing this conversation to a work terminal. */
  composeDispatchBrief(input: {
    taskId: string
    conversationId: string
    messages: Array<{ role: string; content: string }>
    providerId: string
    modelId?: string
    workspaceIds: string[]
    workspaceRoots: Record<string, string>
  }): Promise<BlueprintDispatchBriefResult>
  onMaintenanceTask(callback: (event: BlueprintMaintenanceEvent) => void): () => void
}
