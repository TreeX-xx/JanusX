// Note: current-only persistence — see .agents/notes/blueprint/maintenance/suggestions/module.md
import { createHash } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname, isAbsolute, normalize } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { reviewContextSchema, type ReviewContext, type ReviewItem } from '../../../shared/blueprint-review'

export interface StoredReviewItem extends ReviewItem {
  generation: string
  missingSince: number | null
  /** Latest observed hashes only; no source or finding history. Optional for existing stores. */
  observedEvidence?: Record<string, string | null>
}

export interface ReviewState {
  context: ReviewContext
  revision: number
  items: StoredReviewItem[]
}

export function reviewContextKey(context: ReviewContext): string {
  const parsed = reviewContextSchema.parse(context)
  if (!isAbsolute(parsed.workspacePath)) throw new Error('Review workspace must be an absolute canonical path')
  const path = normalize(parsed.workspacePath)
  return createHash('sha256').update(JSON.stringify([parsed.repoId.toLowerCase(), process.platform === 'win32' ? path.toLowerCase() : path, parsed.branch])).digest('hex')
}

/** Short synchronous transactions only: no model calls, scans or awaited callbacks under the lock. */
export class ReviewStore {
  private readonly db: DatabaseSync

  constructor(readonly path: string) {
    mkdirSync(dirname(path), { recursive: true })
    this.db = new DatabaseSync(path)
    try {
      this.db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA secure_delete=ON;')
      const version = this.db.prepare('PRAGMA user_version').get() as { user_version: number }
      if (version.user_version !== 0 && version.user_version !== 1) throw new Error('Unsupported suggestion store version')
      this.db.exec(`CREATE TABLE IF NOT EXISTS review_contexts (
        context_key TEXT PRIMARY KEY, context_json TEXT NOT NULL, revision INTEGER NOT NULL, items_json TEXT NOT NULL
      )`)
      if (version.user_version === 0) this.db.exec('PRAGMA user_version=1')
    } catch (error) { this.db.close(); throw error }
  }

  close(): void { this.db.close() }

  read(context: ReviewContext): ReviewState {
    const row = this.db.prepare('SELECT context_json, revision, items_json FROM review_contexts WHERE context_key=?')
      .get(reviewContextKey(context)) as { context_json: string; revision: number; items_json: string } | undefined
    if (!row) return { context: reviewContextSchema.parse(context), revision: 0, items: [] }
    return { context: reviewContextSchema.parse(JSON.parse(row.context_json)), revision: row.revision, items: JSON.parse(row.items_json) as StoredReviewItem[] }
  }

  mutate<T>(context: ReviewContext, operation: (state: ReviewState) => T): T {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const state = this.read(context)
      const before = JSON.stringify(state.items)
      const result = operation(state)
      const after = JSON.stringify(state.items)
      if (before !== after) {
        state.revision++
        this.db.prepare(`INSERT INTO review_contexts VALUES (?, ?, ?, ?)
          ON CONFLICT(context_key) DO UPDATE SET revision=excluded.revision, items_json=excluded.items_json`)
          .run(reviewContextKey(context), JSON.stringify(state.context), state.revision, after)
      }
      this.db.exec('COMMIT')
      return result
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
  }
}
