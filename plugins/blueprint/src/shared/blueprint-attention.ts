// Note: version-aware reading and navigation — see .agents/notes/blueprint/navigation/note-updates-and-suggestion-navigation.md
import type { ReviewContext } from './blueprint-review'

export interface NoteVersion { noteId: string; hash: string; path: string }
export interface NoteUpdate extends NoteVersion {
  unread: boolean
  change: 'added' | 'modified' | 'moved'
  observedAt: string
  available: boolean
}
export interface NoteUpdatesView {
  ready: boolean
  complete: boolean
  revision: number
  entries: NoteUpdate[]
}
export interface NoteReadResult {
  context: ReviewContext
  updates: NoteUpdatesView
  undoToken?: string
  expiresAt?: number
}
export type NoteDetailIntent = 'body' | 'suggestions' | 'finding' | 'coverage' | 'failure' | 'activity' | 'retry'
export interface BlueprintNoteDestination {
  context?: ReviewContext
  root: string
  noteId: string
  intent: NoteDetailIntent
  findingId?: string
  reportRevision?: number
  hash?: string
}
