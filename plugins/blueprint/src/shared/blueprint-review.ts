// Note: current suggestions and Note lifecycle — see .agents/notes/blueprint/maintenance/suggestions/module.md
import { z } from 'zod'

export const reviewPathSchema = z.string().min(1).refine(path =>
  !path.includes('\\') && !path.includes('\0') && !path.startsWith('/') && !path.includes(':')
  && !path.split('/').some(part => part === '..' || part === '.' || !part), 'Expected a workspace-relative path')

export const reviewContextSchema = z.object({
  repoId: z.string().uuid(),
  workspacePath: z.string().min(1),
  branch: z.string().min(1),
}).strict()
export type ReviewContext = z.infer<typeof reviewContextSchema>

export const reviewSourceSchema = z.object({
  noteId: z.string().uuid(), path: reviewPathSchema, hash: z.string().regex(/^[a-f0-9]{64}$/),
  kind: z.string().min(1), lifecycle: z.string().min(1), module: z.string().optional(),
}).strict()
export type ReviewSource = z.infer<typeof reviewSourceSchema>

export const reviewEvidenceSchema = z.object({
  path: reviewPathSchema, hash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict()
export type ReviewEvidence = z.infer<typeof reviewEvidenceSchema>

export const reviewCitationSchema = z.object({ path: reviewPathSchema, quote: z.string().min(1).max(20000) }).strict()

export const reviewFindingSchema = z.object({
  id: z.string().uuid(), category: z.enum(['contradiction', 'omission', 'insufficient']),
  summary: z.string().min(1).max(2000), explanation: z.string().min(1).max(20000),
  suggestion: z.string().max(20000),
  citations: z.array(reviewCitationSchema).min(1).max(100),
  verification: z.enum(['not-configured', 'pending', 'scored', 'supported', 'disputed', 'uncertain', 'failed']),
  verificationDetail: z.object({ model: z.string(), question: z.string(), score: z.number().min(0).max(1).optional(), error: z.string().optional() }).strict().optional(),
}).strict()
export type ReviewFinding = z.infer<typeof reviewFindingSchema>

export const reviewResultSchema = z.object({
  findings: z.array(reviewFindingSchema).max(200),
  coverage: z.enum(['complete', 'insufficient']),
  limitations: z.array(z.string().min(1).max(2000)).max(100),
  // Legacy callers may supply resolutions; a complete review replaces the entire current set.
  resolvedFindings: z.array(z.object({
    id: z.string().uuid(), reason: z.string().min(1).max(2000), citations: z.array(reviewCitationSchema).min(1).max(100),
  }).strict()).max(200).default([]),
  provenance: z.object({ providerId: z.string(), modelId: z.string(), ruleVersion: z.string(), commit: z.string().regex(/^[a-f0-9]{40,64}$/).optional() }).strict().optional(),
}).strict().superRefine((value, context) => {
  if (new Set(value.findings.map(finding => finding.id)).size !== value.findings.length) {
    context.addIssue({ code: 'custom', message: 'Duplicate finding identity' })
  }
  if (value.coverage === 'insufficient' && value.limitations.length === 0) {
    context.addIssue({ code: 'custom', message: 'Missing coverage must be explained' })
  }
  if (value.coverage === 'insufficient' && value.resolvedFindings.length) {
    context.addIssue({ code: 'custom', message: 'Incomplete review cannot resolve earlier findings' })
  }
  const resolved = value.resolvedFindings.map(finding => finding.id)
  if (new Set(resolved).size !== resolved.length || value.findings.some(finding => resolved.includes(finding.id))) {
    context.addIssue({ code: 'custom', message: 'Conflicting finding resolution' })
  }
})
export type ReviewResult = z.infer<typeof reviewResultSchema>

export interface ReportedFinding extends ReviewFinding {
  source: ReviewSource
  evidence: ReviewEvidence[]
  stale: boolean
}

export interface ReviewReport extends Omit<ReviewResult, 'findings' | 'resolvedFindings'> {
  id: string
  source: ReviewSource
  evidence: ReviewEvidence[]
  stale: boolean
  createdAt: string
  findings: ReportedFinding[]
}

export interface ReviewTicket {
  id: string
  noteId: string
  generation: string
  source: ReviewSource
  evidence: ReviewEvidence[]
  reportRevision: number
  /** Immutable Git source used by an automatic review; current workspace observations remain separate. */
  snapshotCommit?: string
}

export interface ReviewItem {
  noteId: string
  source: ReviewSource | null
  availability: 'available' | 'unavailable' | 'deleted' | 'excluded'
  reportRevision: number
  report: ReviewReport | null
  pending: ReviewTicket | null
  error: string | null
  /** A repaired source has retired its old report but has not completed a current-source review. */
  awaitingReview?: { hash: string }
}

export interface NoteStructureIssue {
  path: string
  code: string
  message: string
  field?: string
  noteId?: string
  title?: string
  hash?: string
}
export interface NoteStructureReview {
  complete: boolean
  checked: number
  snapshotHash: string
  issues: NoteStructureIssue[]
}

/** Only complete, stable scans may confirm a missing target. Unreadable paths are not deletions. */
export interface ReviewSourceSnapshot {
  context: ReviewContext
  complete: boolean
  notes: ReviewSource[]
  unavailablePaths: string[]
  structure?: NoteStructureReview
  evidence: Record<string, string | null>
}

export const REVIEW_NOTE_KINDS = new Set(['module', 'decision', 'requirement'])
