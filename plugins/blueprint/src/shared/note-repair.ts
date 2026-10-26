import { z } from 'zod'
import { reviewContextSchema, reviewPathSchema, type ReviewContext } from './blueprint-review'

// Note: selected review issues become bounded Janus repairs — see .agents/notes/blueprint/navigation/note-updates-and-suggestion-navigation.md
const base = { context: reviewContextSchema, intent: z.enum(['repair', 'discuss']) }
export const noteRepairInputSchema = z.discriminatedUnion('kind', [
  z.object({ ...base, kind: z.literal('suggestions'), noteId: z.string().uuid(), reportRevision: z.number().int().nonnegative(),
    findingIds: z.array(z.string().uuid()).min(1).max(200) }).strict(),
  z.object({ ...base, kind: z.literal('structure'), path: reviewPathSchema, hash: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
])
export type NoteRepairInput = z.infer<typeof noteRepairInputSchema>
export type NoteRepairPhase = 'preparing' | 'queued' | 'reading' | 'editing' | 'reviewing' | 'review-incomplete' | 'resolved' | 'unresolved' | 'discussed' | 'failed' | 'cancelled' | 'reverted' | 'unchanged'
export const repairIsActive = (phase: NoteRepairPhase) => ['preparing', 'queued', 'reading', 'editing', 'reviewing'].includes(phase)
export interface NoteRepairPlan {
  id: string
  context: ReviewContext
  intent: 'repair' | 'discuss'
  kind: 'suggestions' | 'structure'
  noteId: string
  uri: string
  path: string
  title: string
  summaries: string[]
}
export interface NoteRepairUpdate {
  id: string
  phase: NoteRepairPhase
  changed?: boolean
  afterHash?: string
  recordError?: string
  resolved?: number
  remaining?: number
  changes?: { added: number; removed: number }
  error?: string
}
export interface NoteRepairDiff { before: string; after: string; path: string; reverted?: boolean }
