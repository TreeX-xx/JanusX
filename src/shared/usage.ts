/** Native session usage, normalized to exclusive fresh input/cache/output counts. */
export type UsageEngine = 'claude' | 'codex' | 'opencode' | 'janus' | 'pi' | 'dsh'
export interface UsageTokens {
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  totalTokens: number
}
export interface UsageEvent extends UsageTokens {
  id: string
  at?: number
  model?: string
  /** Earlier Claude blocks with identical input/cache counts, for repairing old bookings. */
  partialOutputs?: Array<{ at: number; outputTokens: number }>
}
export interface UsageObservation {
  engine: UsageEngine
  namespace: string
  sessionId: string
  collectedAt: number
  mode: 'events' | 'cumulative'
  events?: UsageEvent[]
  counters?: UsageTokens
  model?: string
  sourceIdentity?: string
  sourceSize?: number
  sourceHash?: string
  sourcePrefixHash?: string
  modelChangedAt?: number
  /** A source failure is visible but never advances accounting state. */
  issue?: string
}
export interface UsageRecord extends UsageTokens {
  id: string
  /** Native event identity for precise metadata enrichment on future replays. */
  eventId?: string
  engine: UsageEngine
  sessionId: string
  at: number
  intervalStart?: number
  timeBasis: 'event' | 'sample'
  model?: string
}
export interface UsageSessionStatus {
  engine: UsageEngine
  sessionId: string
  coverageStart: number
  updatedAt: number
  issue?: string
}
export interface UsageLedgerQuery {
  start: number
  end: number
  engine?: UsageEngine
  offset?: number
  limit?: number
  throughId?: number
}
export interface UsageLedgerPage {
  records: UsageRecord[]
  sessions: UsageSessionStatus[]
  nextOffset?: number
  throughId?: number
  error?: string
  warning?: string
  coverageStart?: number
  hasIssues?: boolean
}
export interface UsageSourceCheckpoint {
  mode?: 'events' | 'cumulative'
  sourceIdentity?: string
  sourceSize?: number
  sourceHash?: string
  updatedAt: number
  model?: string
}
