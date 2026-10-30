import type { OwnerScope } from './team/types'

export type KnowledgeSource =
  | 'agent-stream'
  | 'blueprint-maintenance'
  | 'checkpoint'
  | 'git-analyzer'
  | 'janus-chat'
  | 'manual'
  | 'tool'
  | 'system'

export type ObservationType =
  | 'conversation-turn'
  | 'tool-call'
  | 'tool-result'
  | 'checkpoint-event'
  | 'git-event'
  | 'analysis-result'
  | 'user-note'
  | 'system-event'

export type KnowledgeVisibility = 'workspace' | 'project' | 'global' | 'restricted'
export type ObservationQueryScope = 'global' | 'workspace'

export type CandidateStatus = 'proposed' | 'approved' | 'rejected' | 'applied'

/** Phase 1: how a candidate was derived (deterministic rule, LLM, or merged). */
export type Derivation = 'deterministic' | 'llm' | 'merged'

/** Phase 1: what a fact states. Stored on MemoryFact, no new entity types. */
export type FactKind = 'fact' | 'preference' | 'decision' | 'procedure'

/** Phase 1: evidence chain every derived candidate must carry. */
export interface CandidateEvidence {
  observationIds: string[]
  snippets?: string[]
  sources?: MemorySourceEvidence[]
  /** Exact per-claim excerpts, verified against the complete source digest before review. */
  quotes?: Array<{ observationId: string; quote: string }>
  /** Host-bound task context, including constraints and corrections not selected as citations. */
  contextSources?: MemorySourceEvidence[]
}

export type RetentionClass = 'noise' | 'operational' | 'evidence' | 'derived'

export type WikiPageStatus = 'draft' | 'review' | 'published' | 'archived'

export type GraphRelationType =
  | 'mentions'
  | 'derived_from'
  | 'supersedes'
  | 'depends_on'
  | 'conflicts_with'
  | 'implemented_in'
  | 'owned_by'
  | 'used_by_agent'

/**
 * Phase 5 lifecycle status of an observation's content body.
 * Missing values default to 'active' for backward compatibility.
 */
export type CompactionStatus = 'active' | 'compacted' | 'summarized'

export type StructuredCloneValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | StructuredCloneValue[]
  | { [key: string]: StructuredCloneValue }

export type AuditAction =
  | 'capture'
  | 'extract'
  | 'candidate_proposed'
  | 'candidate_approved'
  | 'candidate_rejected'
  | 'candidate_applied'
  | 'wiki_updated'
  | 'fact_superseded'
  | 'truth_revoked'
  | 'knowledge_conflict'
  | 'knowledge_feedback'
  | 'reindex'
  // Phase 1: processing queue run failures.
  | 'processing_failed'
  // Phase 1 convergence: persisted records that fail strict schema validation.
  | 'schema_violation'
  // Phase 5: lifecycle audit actions for observations.
  | 'observation_pruned'
  | 'observation_auto_pruned'
  | 'observation_archived'
  | 'observation_compacted'
  // User memory M1: profile/episode/habit lifecycle (private by default).
  | 'user_profile_updated'
  | 'user_episode_captured'
  | 'user_episode_harvested'
  | 'habit_candidate_proposed'

/** Independent knowledge MVP: project memory stays workspace-scoped, user memory is person-scoped. */
export type UserMemoryScope = 'project' | 'user'

export type MemoryScope = UserMemoryScope | 'global'
export type MemorySpeaker = 'user' | 'assistant' | 'tool' | 'system' | 'unknown'
/** Origin is not truth: even a user statement still needs candidate review. */
export type MemorySourceAuthority = 'user-stated' | 'model-generated' | 'tool-observed' | 'unverified'
export interface MemorySourceEvidence {
  /** Full source content digest captured by the host; absent on legacy evidence. */
  contentHash?: string
  observationId: string
  workspaceId: string
  scope: MemoryScope
  source: KnowledgeSource
  createdAt: string
  sourceEventId?: string
  sessionId?: string
  speaker: MemorySpeaker
  authority: MemorySourceAuthority
  excerpt: string
}

/** Durable user snapshot rendered after JANUS_PERSONA with its own recall budget. */
export interface UserProfile {
  version: number
  confirmedFacts?: Array<{ id: string; version: number; content: string; kind: FactKind; observationIds: string[]; sourceHash: string; supersedes?: string }>
  derivation?: { fingerprint: string; ruleVersion: string; expiresAt: string }
  identity?: string
  formatPrefs?: string[]
  toolPrefs?: string[]
  /** Habit fact ids with version bumps; predecessor archive lives in facts via supersedes. */
  habitVersions?: Array<{ habitId: string; version: number; archived?: boolean }>
  updatedAt: string
}

/** Auto-written dated event in episodes/ with TTL harvest and rolling working set. */
export interface UserEpisode {
  id: string
  content: string
  createdAt: string
  /** ISO expiry; defaults to createdAt + ttlDays. */
  expiresAt: string
  ttlDays: number
  tags: string[]
  sourceObservationIds: string[]
  status: 'active' | 'expired'
}

/** User memory M4: one glance payload for the persona cards plus badge. */
export interface UserMemoryOverviewHabit {
  contentHash?: string
  confirmed?: boolean
  id: string
  content: string
  habitStrength?: number
  lastSeenAt?: string
  succession?: string
  observationIds: string[]
}

export interface UserMemoryOverviewEpisode {
  contentHash?: string
  id: string
  content: string
  createdAt: string
  expiresAt: string
  tags: string[]
}

export interface UserMemoryOverview {
  profile: UserProfile
  habits: UserMemoryOverviewHabit[]
  recent: UserMemoryOverviewEpisode[]
  /** Proposed scope-user fact candidates awaiting Inbox review. */
  pendingHabitCount: number
  generatedAt: string
}

export interface KnowledgeProvenance {
  workspaceId: string
  workspaceName: string
  workspacePath: string
  source: KnowledgeSource
  sourceObservationIds: string[]
  fileRefs: string[]
  actor: string
  createdAt: string
  sourceEvidence?: MemorySourceEvidence[]
  promptHash?: string
  model?: string
  /** ToB M1/P3 预留：执行人用户 ID 与所属组织，全可选。 */
  actorId?: string | null
  tenantId?: string | null
}

export interface Observation {
  /** Host-derived from the durable source revocation ledger. */
  revokedAt?: string
  id: string
  /** Host-owned write intent. Payload fields cannot grant this intent. */
  memoryIntent?: 'remember' | 'episode'
  expiresAt?: string
  episodeStatus?: 'active' | 'expired'
  relatedObservationIds?: string[]
  /** Absent on legacy records; resolve user sentinel, otherwise project. */
  scope?: MemoryScope
  sourceEvidence?: MemorySourceEvidence
  workspaceId: string
  workspaceName: string
  workspacePath: string
  source: KnowledgeSource
  type: ObservationType
  content: string
  summary?: string
  fileRefs: string[]
  tags: string[]
  visibility: KnowledgeVisibility
  actor: string
  createdAt: string
  correlationId?: string
  /** Phase 1 convergence: owning conversation/session (agent turn, chat conversation). Empty when sourceless. */
  sessionId?: string
  /** Phase 1 convergence: producing agent identity (engine name, analyzer id). Empty when unknown. */
  agentId?: string
  metadata?: Record<string, StructuredCloneValue>
  // Phase 1 convergence: always written by capture; missing on read is a schema violation.
  retentionClass: RetentionClass
  retentionReason?: string
  // Phase 4: content addressing + blob compression.
  contentHash: string
  // Event identity when supplied by the host; otherwise conservative content dedupe.
  dedupeKey: string
  contentLength: number
  contentPreview?: string
  blobRef?: string
  originalLength?: number
  truncated?: boolean
  // Phase 5: archive / compact / audit lifecycle.
  // Phase 1 convergence: capture writes 'active'; missing on read is a schema violation.
  compactionStatus: CompactionStatus
  compactedAt?: string
}

export interface CaptureObservationInput {
  workspaceId?: string
  workspaceName?: string
  workspacePath: string
  source: KnowledgeSource
  type: ObservationType
  content: string
  summary?: string
  fileRefs?: string[]
  tags?: string[]
  visibility?: KnowledgeVisibility
  actor?: string
  correlationId?: string
  sessionId?: string
  agentId?: string
  metadata?: Record<string, StructuredCloneValue>
}

export interface ObservationQuery {
  scope?: ObservationQueryScope
  workspaceId?: string
  workspaceName?: string
  workspacePath?: string
  limit?: number
  source?: KnowledgeSource
  type?: ObservationType
}

export interface ObservationPruneQuery extends ObservationQuery {
  olderThan?: string
  confirm?: boolean
  retentionClass?: RetentionClass
}

export interface ObservationPruneResult {
  dryRun: boolean
  matched: number
  removed: number
  kept: number
}

/** Phase 5: result of archiving aged monthly shards into gzipped archive files. */
export interface ObservationArchiveResult {
  archivedShards: Array<{ shard: string; recordCount: number; archivedTo: string }>
  totalRecords: number
}

/** Phase 5: result of compacting aged evidence observations (mark + summarize only in MVP). */
export interface ObservationCompactResult {
  compacted: number
  kept: number
  dryRun: boolean
}

export interface RetentionStats {
  noise: number
  operational: number
  evidence: number
  derived: number
  total: number
}

export interface MemoryFact {
  /** Host-only retrieval metadata; never evidence, confirmation, or fact version. */
  recallState?: { strength: number; anchorAt: string; lastAccessAt: string; recentRequests: string[] }
  /** Host-derived from supported explicit single-value statements. */
  factKey?: 'release.command' | 'response.language'
  cardinality?: 'single'
  polarity?: 'positive' | 'negative'
  /** Host-written on explicit review; binds the reviewed content, never model authority. */
  confirmation?: { kind: 'human-review' | 'model-review'; contentHash: string; confirmedAt: string; taskId?: string; model?: string }
  id: string
  content: string
  concepts: string[]
  files: string[]
  tags: string[]
  confidence: number
  version: number
  supersedes?: string
  status: CandidateStatus | 'active' | 'archived'
  provenance: KnowledgeProvenance
  /** Phase 1: deterministic/LLM classification of what the fact states. */
  kind: FactKind
  /** Missing on legacy records: user sentinel means user, otherwise project. */
  scope?: MemoryScope
  /** User memory M1: Ebbinghaus strength with retrieval reheat, habit facts only. */
  habitStrength?: number
  /** User memory M1: last retrieval or confirmation instant (ISO). */
  lastSeenAt?: string
  /** User memory M1: ISO expiry for episodes-derived habits; missing means durable. */
  ttl?: string
  /** ToB M1 归属字段（全可选；version 即本体的 version，不另设）。 */
  ownerScope?: OwnerScope
  tenantId?: string | null
  projectId?: string | null
  ownerUserId?: string | null
  updatedBy?: string | null
}

// Note: wiki sources are host-read snapshots — see .agents/notes/blueprint/documents/tasks/note-wiki-r3.md
export interface WikiNoteRef { uri: string; sourceHash: string }
export interface WikiNoteStatus {
  uri: string
  sourceHash?: string
  currentHash?: string
  status: 'fresh' | 'changed' | 'missing' | 'ambiguous' | 'unbound' | 'unknown'
  detail?: string
}
export interface WikiPage {
  topicKey?: string
  relations?: WikiPageRelation[]
  /** Derived from current published targets; never saved as review evidence. */
  relationIssues?: WikiRelationIssue[]
  /** Host-owned dependencies and topic ownership for maintained project pages. */
  sourceFactRefs?: Array<{ id: string; contentHash: string }>
  managed?: boolean
  generationHash?: string
  freshness?: 'current' | 'stale' | 'unknown'
  slug: string
  title: string
  markdown: string
  tags: string[]
  status: WikiPageStatus
  sourceFactIds: string[]
  updatedAt: string
  version: number
  workspaceId: string
  workspacePath?: string
  sourceNoteRefs?: WikiNoteRef[]
  /** ToB M1 归属字段（全可选；version 即本体的 version，不另设）。 */
  ownerScope?: OwnerScope
  tenantId?: string | null
  projectId?: string | null
  ownerUserId?: string | null
  updatedBy?: string | null
}

// Note: relationships publish with their owning Wiki revision — see .agents/notes/knowledge/tasks/knowledge-review-status-audit-plan.md
export interface WikiPageRelation {
  type: 'references' | 'depends_on' | 'conflicts_with'
  target: { workspaceId: string; slug: string; title: string; version: number; contentHash: string }
  reason: string
  sourceFactIds: string[]
}
export interface WikiRelationIssue {
  targetSlug: string
  type: WikiPageRelation['type']
  status: 'missing' | 'ambiguous' | 'changed' | 'stale' | 'invalid'
}

export interface GraphEdge {
  id: string
  from: string
  to: string
  type: GraphRelationType
  confidence: number
  sourceFactIds: string[]
  workspaceId: string
  createdAt: string
  status?: 'active' | 'archived'
  /** ToB M1 归属字段（全可选）。 */
  ownerScope?: OwnerScope
  tenantId?: string | null
  projectId?: string | null
  ownerUserId?: string | null
  updatedBy?: string | null
}

export type KnowledgeFeedbackAction = 'open' | 'copy' | 'apply' | 'reject' | 'dismiss'
export type KnowledgeFeedbackOutcome = 'success' | 'empty' | 'error'
export interface KnowledgeFeedbackInput {
  action: KnowledgeFeedbackAction
  resultKind: KnowledgeContextKind | 'none'
  workspaceId: string
  outcome: KnowledgeFeedbackOutcome
}
export interface KnowledgeFeedbackSummary {
  total: number
  byAction: Record<KnowledgeFeedbackAction, number>
  byOutcome: Record<KnowledgeFeedbackOutcome, number>
  byKind: Record<KnowledgeContextKind | 'none', number>
}

export interface KnowledgeConflict {
  id: string
  workspaceId: string
  kind: KnowledgeContextKind
  targetId: string
  candidateId: string
  reason: 'duplicate-id' | 'content-mismatch'
  provenance: KnowledgeProvenance
}

export interface KnowledgeTruthSnapshot {
  facts: MemoryFact[]
  wikiPages: WikiPage[]
  graphEdges: GraphEdge[]
}

export type KnowledgeContextKind = 'fact' | 'wiki' | 'graph'

export interface KnowledgeContextRequest {
  query: string
  workspaceId?: string
  workspacePath?: string
  /** Explicitly allow recall across every workspace. */
  allowGlobal?: boolean
  /** User memory M2: person scope beside project memory; user-only recall needs no workspace. */
  scope?: UserMemoryScope
  /** User memory M2: fused chat recall opts in; project-only callers (MCP, maintenance) leave it unset. */
  includeUser?: boolean
  maxItems?: number
  maxChars?: number
  /** Phase 3: filter evidence by producing agent (observations only; truth is shared). */
  agentId?: string
  /** Phase 3: filter evidence by owning session (observations only; truth is shared). */
  sessionId?: string
  /** Phase 3: only records with createdAt >= since (ISO string). */
  since?: string
  /** Phase 3: only records with createdAt <= until (ISO string). */
  until?: string
}

export interface KnowledgeContextSourceRefs {
  observationIds: string[]
  factIds: string[]
  fileRefs: string[]
}

export interface KnowledgeContextProvenance extends KnowledgeContextSourceRefs {
  source?: KnowledgeSource
  actor?: string
  createdAt: string
}

export interface KnowledgeContextItem {
  id: string
  kind: KnowledgeContextKind
  title: string
  content: string
  score: number
  workspaceId: string
  workspacePath?: string
  provenance: KnowledgeContextProvenance
}

export interface KnowledgeContextResult {
  projectMemoryDelivery?: import('./memory-strength').ProjectMemoryDelivery
  /** JanusX-owned receipt; plain searches never record an access. */
  userMemoryDelivery?: import('./memory-strength').UserMemoryDelivery
  items: KnowledgeContextItem[]
  compactContext: string
  truncated: boolean
  eligibleCount: number
  maxItems: number
  maxChars: number
  degraded?: { reason: 'empty-query' | 'missing-workspace' }
}

export type KnowledgeRecallTraceStatus = 'recalled' | 'empty' | 'degraded' | 'error'

export interface KnowledgeRecallTraceTopHit {
  id: string
  kind: KnowledgeContextKind
  title: string
  score: number
  provenance: KnowledgeContextSourceRefs
}

export interface KnowledgeRecallTrace {
  requestId: string
  status: KnowledgeRecallTraceStatus
  query: string
  recalledCount: number
  eligibleCount: number
  truncated: boolean
  maxItems: number
  maxChars: number
  topHit?: KnowledgeRecallTraceTopHit
  reason?: string
}

export interface AuditEvent {
  id: string
  action: AuditAction
  targetType: 'observation' | 'fact' | 'wiki' | 'graph' | 'index'
  targetId: string
  before?: Record<string, StructuredCloneValue> | null
  after?: Record<string, StructuredCloneValue> | null
  provenance: KnowledgeProvenance
}

export interface CandidateFact {
  /** Host-bound explicit correction; old content is for review, not evidence for the new claim. */
  personalCorrection?: { targetId: string; targetHash: string; previousContent: string }
  /** Host-owned legacy source binding; rechecked before explicit approval. */
  legacySource?: { kind: 'fact' | 'profile'; id: string; hash: string }
  id: string
  type: 'fact'
  status: CandidateStatus
  fact: MemoryFact
  reviewNotes?: string
  /** Phase 1: required derivation + evidence chain (no default-when-missing reads). */
  derivation: Derivation
  evidence: CandidateEvidence
  /** Phase 1: conflicting truth/candidate ids (candidate-stage conflict check). */
  conflicts?: string[]
  /** Phase 2: source candidate ids when derivation === 'merged'. */
  mergedFrom?: string[]
  /** Host-validated advice; never grants source authority or approves truth. */
  decision?: import('./memory-decision').MemoryDecisionAnnotation
}

export interface CandidateWikiPatch {
  topicKey?: string
  relations?: WikiPageRelation[]
  generatedSections?: Array<{ markdown: string; ids: string[] }>
  sourceFactRefs?: Array<{ id: string; contentHash: string }>
  managed?: boolean
  generationHash?: string
  id: string
  type: 'wiki-patch'
  status: CandidateStatus
  pageSlug: string
  sourceNoteRefs?: WikiNoteRef[]
  reviewMode?: 'incremental' | 'full-page'
  expectedVersion?: number
  title: string
  patchMarkdown: string
  rationale: string
  confidence: number
  provenance: KnowledgeProvenance
  reviewNotes?: string
  /** Phase 1: required derivation + evidence chain (no default-when-missing reads). */
  derivation: Derivation
  evidence: CandidateEvidence
  /** Settled truth fact ids this patch summarizes; validated against known truth at extract. */
  sourceFactIds: string[]
  /** Phase 1: conflicting truth/candidate ids (candidate-stage conflict check). */
  conflicts?: string[]
  /** Phase 2: source candidate ids when derivation === 'merged'. */
  mergedFrom?: string[]
}

export interface CandidateGraphEdge {
  id: string
  type: 'graph-edge'
  status: CandidateStatus
  edge: GraphEdge
  reviewNotes?: string
  /** Phase 1: required derivation + evidence chain (no default-when-missing reads). */
  derivation: Derivation
  evidence: CandidateEvidence
  /** Phase 1: conflicting truth/candidate ids (candidate-stage conflict check). */
  conflicts?: string[]
  /** Phase 2: source candidate ids when derivation === 'merged'. */
  mergedFrom?: string[]
}

export interface KnowledgeStorageLayout {
  version: 1
  rootDirName: 'global'
  directories: Array<{
    key: string
    relativePath: string
    purpose: string
  }>
  files: Array<{
    key: string
    relativePath: string
    format: 'json' | 'jsonl' | 'markdown'
    purpose: string
  }>
}

export interface KnowledgeWritePolicy {
  version: 1
  principles: string[]
  directWriteCollections: string[]
  candidateOnlyCollections: string[]
  auditRequiredActions: AuditAction[]
  requiredProvenanceFields: Array<keyof KnowledgeProvenance>
}

export interface KnowledgeSchemaContract {
  version: 1
  status: 'implemented'
  entities: {
    observation: Array<keyof Observation>
    memoryFact: Array<keyof MemoryFact>
    wikiPage: Array<keyof WikiPage>
    graphEdge: Array<keyof GraphEdge>
    auditEvent: Array<keyof AuditEvent>
    candidateWikiPatch: Array<keyof CandidateWikiPatch>
  }
  rules: string[]
}

export interface KnowledgeContractsSnapshot {
  schema: KnowledgeSchemaContract
  storage: KnowledgeStorageLayout
  writePolicy: KnowledgeWritePolicy
}

export type KnowledgeSearchDocumentType =
  | 'observation'
  | 'fact-candidate'
  | 'wiki-patch'
  | 'graph-candidate'
  | 'memory-fact'
  | 'wiki-page'
  | 'graph-edge'

export interface KnowledgeSearchQuery {
  query: string
  limit?: number
  workspaceId?: string
  workspaceName?: string
  workspacePath?: string
  tags?: string[]
  files?: string[]
  source?: KnowledgeSource
  types?: KnowledgeSearchDocumentType[]
  /** Phase 3: filter evidence by producing agent (observations only; truth is shared). */
  agentId?: string
  /** Phase 3: filter evidence by owning session (observations only; truth is shared). */
  sessionId?: string
  /** Phase 3: only records with createdAt >= since (ISO string). */
  since?: string
  /** Phase 3: only records with createdAt <= until (ISO string). */
  until?: string
}

/** BM25 score parts (§8 stage one): why a document matched, in rank order. */
export interface KnowledgeScoreExplanation {
  strengthBoost?: number
  bm25: number
  exactTitle: number
  titlePhrase: number
  titleTerm: number
  slugMatch: number
  bodyPhrase: number
  confidenceBoost: number
  freshnessBoost: number
}

export interface KnowledgeSearchHit {
  expiresAt?: string
  id: string
  type: KnowledgeSearchDocumentType
  title: string
  content: string
  score: number
  bm25Score: number
  scoreExplanation?: KnowledgeScoreExplanation
  workspaceId: string
  workspaceName: string
  workspacePath: string
  source: KnowledgeSource
  tags: string[]
  fileRefs: string[]
  sourceObservationIds: string[]
  createdAt: string
  confidence?: number
  status?: CandidateStatus | 'active' | 'archived' | 'expired'
  derivation?: Derivation
  agentId?: string
  sessionId?: string
  /** Person-scoped facts stay out of project/global recall. */
  scope?: MemoryScope
}

export interface KnowledgeSearchIndexStats {
  documentCount: number
  termCount: number
  averageDocumentLength: number
}

export interface KnowledgeSearchResult {
  query: KnowledgeSearchQuery
  hits: KnowledgeSearchHit[]
  compactContext: string
  indexStats: KnowledgeSearchIndexStats
  degraded?: { reason: string; detail?: string }
}
