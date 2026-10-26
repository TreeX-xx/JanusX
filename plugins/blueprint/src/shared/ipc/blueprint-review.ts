import type { NoteRepairInput, NoteRepairPlan, NoteRepairDiff, NoteRepairUpdate } from '../note-repair'
import type { BlueprintReviewSettings, ReviewConfigurationStatus } from '../blueprint-review-settings'
import type { NoteStructureReview, ReviewContext, ReviewItem } from '../blueprint-review'
import type { NoteMcpChange, NoteMcpProbe, NoteMcpStatus } from '../note-mcp'
import type { NoteReadResult, NoteUpdatesView, NoteVersion } from '../blueprint-attention'

export const BLUEPRINT_REVIEW_CHANNELS = {
  repairPrepare: 'blueprint:review:repair:prepare', repairDiff: 'blueprint:review:repair:diff', repairUndo: 'blueprint:review:repair:undo',
  repairRetryReview: 'blueprint:review:repair:retry-review',
  read: 'blueprint:review:read', readSaved: 'blueprint:review:read-saved', run: 'blueprint:review:run', close: 'blueprint:review:close', cancel: 'blueprint:review:cancel',
  settingsGet: 'blueprint:review:settings:get', settingsUpdate: 'blueprint:review:settings:update',
  configurationTest: 'blueprint:review:configuration:test', credentialStatus: 'blueprint:review:credential:status', credentialSet: 'blueprint:review:credential:set',
  credentialGet: 'blueprint:review:credential:get',
  activityChanged: 'blueprint:review:activity-changed', activityRead: 'blueprint:review:activity-read',
  resultsChanged: 'blueprint:review:results-changed',
  markRead: 'blueprint:notes:mark-read', undoRead: 'blueprint:notes:undo-read', readChanged: 'blueprint:notes:read-changed',
  mcpStatus: 'blueprint:note-mcp:status', mcpChange: 'blueprint:note-mcp:change', mcpProbe: 'blueprint:note-mcp:probe',
} as const
export interface ReviewActivity {
  noteId: string
  phase: 'structure' | 'reading' | 'analyzing' | 'verifying' | 'publishing'
  trigger?: 'manual' | 'automatic'
}
export interface AutomaticReviewSummary {
  finishedAt: string
  outcome: 'reviewed' | 'no-changes'
  reviewed: number
  findings: number
  failed: number
  incomplete: number
}
export interface AutomaticReviewRound {
  id: number
  finishedAt?: string
}
export interface AutomaticReviewTarget {
  noteId: string
  title?: string
  path?: string
  /** Legacy or manual retry records may have no Git commit. */
  commit?: string
  round?: number
  state: 'pending' | 'reviewing' | 'reviewed' | 'incomplete' | 'failed'
  /** A previously unresolved target remains in Needs retry while another automatic attempt runs. */
  retrying?: boolean
  stage?: ReviewActivity['phase']
  error?: string
  reportRevision?: number
}
export interface AutomaticReviewActivity {
  phase: 'disabled' | 'waiting' | 'checking' | 'reviewing' | 'failed' | 'unavailable'
  commits: number
  threshold: number
  remaining: number
  total?: number
  completed?: number
  currentNote?: { id: string; title: string; path: string }
  reason?: 'no-git' | 'detached' | 'no-commits' | 'git-conflicts' | 'history-changed' | 'review-failed' | 'sources-unavailable'
  error?: string
  lastRun?: AutomaticReviewSummary
  targets?: AutomaticReviewTarget[]
  rounds?: AutomaticReviewRound[]
  context?: ReviewContext
}
export interface BlueprintReviewActivityUpdate {
  automaticSettings?: BlueprintReviewSettings['automatic']
  root: string
  revision: number
  automatic?: AutomaticReviewActivity
  activities: ReviewActivity[]
}
export interface BlueprintReviewView {
  context: ReviewContext
  revision: number
  sourceComplete: boolean
  /** Last saved records are visible while current source validation is pending. */
  sourcesPending?: boolean
  items: ReviewItem[]
  activities: ReviewActivity[]
  automatic?: AutomaticReviewActivity
  activityRevision?: number
  updates?: NoteUpdatesView
  updatesError?: string
  structure?: NoteStructureReview
}
/** Committed suggestions, shared by all discovery and Note detail surfaces. */
export type BlueprintReviewResults = Pick<BlueprintReviewView, 'context' | 'revision' | 'items' | 'updates'>
export interface BlueprintReviewAPI {
  repairPrepare(input: NoteRepairInput): Promise<NoteRepairPlan>
  repairDiff(id: string): Promise<NoteRepairDiff>
  repairUndo(id: string): Promise<NoteRepairUpdate>
  repairRetryReview(id: string): Promise<NoteRepairUpdate>
  activityRead(rootPath: string): Promise<BlueprintReviewActivityUpdate>
  markRead(context: ReviewContext, versions: NoteVersion[], bulk: boolean): Promise<NoteReadResult>
  undoRead(token: string): Promise<NoteReadResult>
  onReadChanged(callback: (result: NoteReadResult) => void): () => void
  readSaved(rootPath: string): Promise<BlueprintReviewView>
  read(rootPath: string): Promise<BlueprintReviewView>
  run(rootPath: string, noteId: string): Promise<ReviewItem>
  close(context: ReviewContext, noteId: string, reportRevision: number, findingIds: string[]): Promise<'closed' | 'absent'>
  cancel(rootPath: string, noteId: string): Promise<void>
  settingsGet(): Promise<BlueprintReviewSettings>
  settingsUpdate(settings: BlueprintReviewSettings): Promise<BlueprintReviewSettings>
  configurationTest(): Promise<ReviewConfigurationStatus>
  credentialStatus(): Promise<boolean>
  credentialGet(): Promise<string | null>
  credentialSet(key: string): Promise<void>
  onActivityChanged(callback: (update: BlueprintReviewActivityUpdate) => void): () => void
  onResultsChanged(callback: (update: BlueprintReviewResults) => void): () => void
  mcpStatus(): Promise<NoteMcpStatus>
  mcpChange(change: NoteMcpChange): Promise<void>
  mcpProbe(): Promise<NoteMcpProbe>
}
