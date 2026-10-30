import type {
  AuditAction,
  AuditEvent,
  CandidateFact,
  CandidateGraphEdge,
  CandidateWikiPatch,
  CaptureObservationInput,
  GraphEdge,
  KnowledgeContractsSnapshot,
  KnowledgeSource,
  KnowledgeTruthSnapshot,
  MemoryFact,
  Observation,
  ObservationPruneQuery,
  ObservationPruneResult,
  ObservationQuery,
  RetentionStats,
  UserMemoryOverview,
  WikiPage,
  WikiNoteStatus,
} from '../knowledge'
import type { KnowledgeSettings } from '../knowledge-settings'

export interface PersonalProfileOverrides {
  identity?: string
  formatPrefs?: string[]
  toolPrefs?: string[]
}

export interface PersonalProfileEditContext {
  overrides: PersonalProfileOverrides
  hash: string
}

export interface ObservationRevocationsPage {
  total: number
  offset: number
  limit: number
  items: Array<{
    key: string
    revokedAt: string
    observationCount: number
    factCount: number
    sourceStatus: 'available' | 'changed' | 'missing' | 'ambiguous'
    source?: { id: string; workspaceId: string; content: string; truncated: boolean }
  }>
}

export const KNOWLEDGE_CHANNELS = {
  candidateAction: 'knowledge:candidate:action',
  contracts: 'knowledge:contracts:get',
  bootstrap: 'knowledge:bootstrap',
  observe: 'knowledge:observe',
  listObservations: 'knowledge:observations:list',
  pruneObservations: 'knowledge:observations:prune',
  observationRevocationContext: 'knowledge:observations:revocation-context',
  revokeObservation: 'knowledge:observations:revoke',
  observationRevocations: 'knowledge:observations:revocations',
  autoPruneObservations: 'knowledge:observations:auto-prune',
  resolveObservationContent: 'knowledge:observations:resolve-content',
  retentionStats: 'knowledge:retention:stats',
  listAudit: 'knowledge:audit:list',
  auditPage: 'knowledge:audit:page',
  auditStats: 'knowledge:audit:stats',
  // Phase 5: `knowledge:extract` direct IPC removed — LLM enhancement runs only
  // via the processing queue (`runLlmStage` → `knowledgeExtractService.extract`).
  listCandidates: 'knowledge:candidates:list',
  rejectCandidate: 'knowledge:candidates:reject',
  applyCandidate: 'knowledge:candidates:apply',
  factReviewContext: 'knowledge:candidates:fact-review-context',
  listTruth: 'knowledge:truth:list',
  processNow: 'knowledge:process-now',
  processingStats: 'knowledge:processing-stats',
  userMemoryOverview: 'knowledge:user-memory:overview',
  personalProfileEditContext: 'knowledge:user-memory:profile-context',
  savePersonalProfile: 'knowledge:user-memory:profile-save',
  importLegacyPersonalMemory: 'knowledge:user-memory:import-legacy',
  migrateLegacyEpisodes: 'knowledge:user-memory:migrate-episodes',
  forgetPersonalMemory: 'knowledge:user-memory:forget',
  proposePersonalMemoryCorrection: 'knowledge:user-memory:correct',
  getPersonalSettings: 'settings:personal-memory:get',
  updatePersonalSettings: 'settings:personal-memory:update',
  getSettings: 'settings:knowledge:get',
  updateSettings: 'settings:knowledge:update',
} as const

export interface KnowledgeBootstrapResult {
  workspacePath?: string
  knowledgeRoot: string
  createdDirectories: string[]
  createdFiles: string[]
  contracts: KnowledgeContractsSnapshot
}

export interface AuditQuery {
  action?: AuditAction | (string & {})
  domain?: 'all' | 'engineering' | 'personal'
  workspaceId?: string
  targetType?: AuditEvent['targetType']
  targetId?: string
  limit?: number
}

// Note: audit pages bind filters and preserve event snapshots — see .agents/notes/knowledge/tasks/knowledge-review-status-audit-plan.md
export interface AuditPageQuery extends AuditQuery { cursor?: string }
export interface AuditRecord extends AuditEvent { displayTitle?: string }
export interface AuditPage extends AuditStats {
  items: AuditRecord[]
  nextCursor?: string
  workspaces: Array<{ id: string; name: string }>
}

export interface AuditStats {
  total: number
  byAction: Record<string, number>
}

/**
 * Phase 5: service-level input for `knowledgeExtractService.extract`.
 * No longer an IPC payload — the queue-owned `runLlmStage` is the only caller.
 */
export interface ExtractInput {
  observations?: Observation[]
  query?: ObservationQuery
  limit?: number
  workspaceId?: string
  workspaceName?: string
  workspacePath?: string
  source?: KnowledgeSource
  actor?: string
  correlationId?: string
}

export interface ExtractOutput {
  facts: CandidateFact[]
  wikiPatches: CandidateWikiPatch[]
  graphEdges: CandidateGraphEdge[]
  degraded?: { reason: string; detail?: string }
  auditEventId?: string
  /** Phase 2: deterministic candidates upgraded to derivation 'merged' in place (no separate append). */
  mergedFactCandidateIds?: string[]
  /** Phase 2: observation ids dropped by the per-batch character budget (oldest first). */
  droppedObservationIds?: string[]
}

export type ReviewCandidateType = 'fact' | 'wiki-patch' | 'graph-edge'

export interface ReviewCandidateInput {
  type: ReviewCandidateType
  id: string
  candidateHash: string
  replacement?: { id: string; hash: string }
  reviewNotes?: string
  /** Audit actor override for explicit review. Legacy auto-policy is rejected. Defaults to 'knowledge-review'. */
  actor?: string
}

export interface FactReviewContext {
  factKey?: string
  targets: Array<{ id: string; hash: string; content: string; version: number }>
  competing: Array<{ id: string; content: string }>
  blocked?: 'id-collision' | 'invalid-target' | 'multiple-targets'
}

export interface ReviewResult {
  candidate: CandidateFact | CandidateWikiPatch | CandidateGraphEdge
  auditEvents: AuditEvent[]
  applied?: {
    fact?: MemoryFact
    edge?: GraphEdge
    page?: WikiPage
  }
}

export type TruthKind = 'fact' | 'graph' | 'wiki'

export interface RevokeTruthInput {
  kind: TruthKind
  id: string
  workspaceId: string
}

/** Phase 0 diagnostics: pipeline health snapshot for the Workbench status bar. */
export interface KnowledgeDiagnosticsQuery {
  workspaceId?: string
  recentLimit?: number
}

export interface KnowledgeWorkspaceDiagnostics {
  workspaceId: string
  workspaceName: string
  observations: number
  evidence: number
  /** Observations whose workspaceId had to be guessed from the directory basename. */
  fallbackWorkspaceIds: number
  /** Evidence observations after the processing cursor (falls back to all evidence when the cursor is unknown). */
  unprocessedEstimate: number
  lastObservationAt?: string
}

/** Phase 5 (§6): proposed 候选按 derivation 计数（与 ProcessingStats 同口径）。 */
export interface KnowledgeProposalsByDerivation {
  deterministic: number
  llm: number
  merged: number
}

export interface KnowledgeDiagnostics {
  generatedAt: string
  knowledgeRoot: string
  recentObservations: Observation[]
  workspaces: KnowledgeWorkspaceDiagnostics[]
  candidates: { facts: number; wikiPatches: number; graphEdges: number; byDerivation: KnowledgeProposalsByDerivation }
  truth: { facts: number; wikiPages: number; graphEdges: number }
  /** Phase 5 (§6): recall 索引最近一次重建时间；从未构建为 null。 */
  indexUpdatedAt: string | null
  captureFailures: number
  captureRecovery?: { batches: number; events: number; lastError?: string }
  transcriptRecovery?: { pending: number; lastError?: string }
}

/** Phase 1-1: manual trigger input for the knowledge processing queue. */
export interface KnowledgeProcessNowInput {
  workspaceId?: string
}

/** Phase 1-1: result of a manual queue run. Cursor advances only on handler success. */
export interface KnowledgeProcessNowResult {
  processed: number
  failed: number
  pending: number
  advancedWorkspaces: string[]
  handlerMissing: boolean
}

export interface KnowledgeProcessingWorkspaceStats {
  workspaceId: string
  pending: number
  lastObservationAt?: string
}

/** Phase 5: last queue run summary (mirrors the queue's QueueRunSummary). */
export interface KnowledgeProcessingLastRun {
  at: string
  processed: number
  failed: number
}

/** Phase 1-1: queue metrics for the Workbench status bar. */
export interface KnowledgeProcessingStats {  generatedAt: string
  refinement?: import('../memory-decision').RefinementTaskStats
  pendingTotal: number
  workspaces: KnowledgeProcessingWorkspaceStats[]
  failures: number
  lastRunAt: string | null
  lastRun: KnowledgeProcessingLastRun | null
  handlerConfigured: boolean
  /** Phase 2/5: LLM stage wiring + process-lifetime outcome counters. */
  llmConfigured: boolean
  llmSucceeded: number
  llmFailed: number
  llmSkipped: number
  /** Phase 5 (§6): proposed 候选按 derivation 计数 + 总数。 */
  proposalsByDerivation: KnowledgeProposalsByDerivation
  proposalsTotal: number
  /** Phase 5 (§6): recall 索引最近一次重建时间；从未构建为 null。 */
  indexUpdatedAt: string | null
  /** Phase 5 (§6): retention 维护最近一次成功时间；从未成功为 null。 */
  lastMaintenanceAt: string | null
}

export type ExternalMcpClientId = 'claude-code' | 'codex' | 'opencode' | 'janus' | 'pi' | 'dsh'

export interface ExternalMcpClientStatus {
  id: ExternalMcpClientId
  label: string
  configPath: string
  registered: boolean
  support?: 'automatic' | 'unverified'
  current?: boolean
  format?: string
  error?: string
}

export interface ExternalMcpStatus {
  entry: string
  entryExists: boolean
  launch?: { command: string; args: string[]; env?: Record<string, string> }
  isPackaged: boolean
  clients: ExternalMcpClientStatus[]
}

export interface ExternalMcpProbeResult {
  ok: boolean
  stage: 'start' | 'handshake' | 'tools' | 'query'
  tools: string[]
  error?: string
}

export interface ExternalMcpRegisterResult {
  ok: boolean
  client: ExternalMcpClientId
  configPath: string
  backedUpPath?: string
  error?: string
}

export interface KnowledgeAPI {
  contracts: () => Promise<KnowledgeContractsSnapshot>
  bootstrap: (workspacePath?: string) => Promise<KnowledgeBootstrapResult>
  observe: (input: CaptureObservationInput) => Promise<Observation>
  listObservations: (query: ObservationQuery) => Promise<Observation[]>
  pruneObservations: (query: ObservationPruneQuery) => Promise<ObservationPruneResult>
  observationRevocationContext: (input: { id: string; workspaceId: string }) => Promise<{ sourceHash: string; revoked: boolean; content: string }>
  revokeObservation: (input: { id: string; workspaceId: string; sourceHash: string }) => Promise<void>
  observationRevocations: (input: { offset?: number; limit?: number }) => Promise<ObservationRevocationsPage>
  autoPruneObservations: (nowMs?: number) => Promise<ObservationPruneResult>
  resolveObservationContent: (observation: Observation) => Promise<string>
  retentionStats: () => Promise<RetentionStats>
  listAudit: (query?: AuditQuery) => Promise<AuditEvent[]>
  auditPage: (query?: AuditPageQuery) => Promise<AuditPage>
  auditStats: (query?: AuditQuery) => Promise<AuditStats>
  listCandidates: () => Promise<CandidateFact[]>
  rejectCandidate: (input: ReviewCandidateInput) => Promise<ReviewResult>
  applyCandidate: (input: ReviewCandidateInput) => Promise<ReviewResult>
  factReviewContext: (input: ReviewCandidateInput) => Promise<FactReviewContext>
  listTruth: () => Promise<KnowledgeTruthSnapshot>
  processNow: (input?: KnowledgeProcessNowInput) => Promise<KnowledgeProcessNowResult>
  processingStats: () => Promise<KnowledgeProcessingStats>
  userMemoryOverview: () => Promise<UserMemoryOverview>
  personalProfileEditContext: () => Promise<PersonalProfileEditContext>
  savePersonalProfile: (input: { expectedHash: string; overrides: PersonalProfileOverrides }) => Promise<void>
  importLegacyPersonalMemory: () => Promise<{ created: number; remaining: number }>
  migrateLegacyEpisodes: (input?: { expectedHash?: string }) => Promise<{ hash: string; files: number; episodes: number; migrated: number }>
  candidateAction: (input: { candidateId: string; candidateHash: string; action: 'score' | 'refine' }) => Promise<void>
  forgetPersonalMemory: (input: { targetId: string; targetHash: string; kind?: 'fact' | 'episode' | 'override' }) => Promise<void>
  proposePersonalMemoryCorrection: (input: { targetId: string; targetHash: string; content: string }) => Promise<{ candidateId: string; status: CandidateFact['status'] }>
  getPersonalSettings: () => Promise<import('../personal-memory-settings').PersonalMemorySettings>
  updatePersonalSettings: (settings: Partial<import('../personal-memory-settings').PersonalMemorySettings>) => Promise<import('../personal-memory-settings').PersonalMemorySettings>
  getSettings: () => Promise<KnowledgeSettings>
  updateSettings: (settings: Partial<KnowledgeSettings>) => Promise<KnowledgeSettings>
}

export interface PrepareNoteWikiInput {
  rootPath: string
  uris: string[]
  pageSlug: string
  reviewMode: 'incremental' | 'full-page'
  expectedVersion: number
}
export interface NoteWikiDraft {
  draftId: string
  page?: WikiPage
  sources: Array<{ uri: string; sourceHash: string; raw: string }>
}
export interface NoteWikiPage { page: WikiPage; sources: WikiNoteStatus[] }
