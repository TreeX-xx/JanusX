// Note: .agents/notes/planning/blueprint-official-plugin.md — shared Note consumers do not load the blueprint plugin.
import { resolve } from 'node:path'
import { NoteService, type LoadedNoteEntry, type NoteIndex } from '@janus-agent/harness-node'
import * as sharedHarness from '@janus-agent/harness-node'

// Local bindings preserve runtime values in the main bundle's dynamic namespace.
export const assertNoLocalLeak = sharedHarness.assertNoLocalLeak
export const claimsHarnessSchema = sharedHarness.claimsHarnessSchema
export const stripRemoteCreds = sharedHarness.stripRemoteCreds
export type { ResolveResult, ShareSelection, ShareSnapshot, BindingRecord, ChangeListener } from '@janus-agent/harness-node'

export class HarnessNoteService extends NoteService {
  private indexReads = new Map<string, Promise<{ rev: number; index: NoteIndex }>>()

  protected override refreshIndex(root: string): Promise<{ rev: number; index: NoteIndex }> {
    const path = resolve(root)
    const key = process.platform === 'win32' ? path.toLowerCase() : path
    const pending = this.indexReads.get(key)
    if (pending) return pending
    const read = super.refreshIndex(path).finally(() => {
      if (this.indexReads.get(key) === read) this.indexReads.delete(key)
    })
    this.indexReads.set(key, read)
    return read
  }

  override async warmup(root: string): Promise<{ rev: number; ms: number }> {
    const started = Date.now()
    const resolved = await this.resolveRoot(root)
    if (!resolved.ok || !resolved.root) throw new Error(`no project notes under ${root}`)
    const { rev } = await this.refreshIndex(resolved.root)
    return { rev, ms: Date.now() - started }
  }

  /** Read-only inputs for desktop adapters; the shared service owns the index and revision. */
  readIndex(root: string): Promise<{ rev: number; index: NoteIndex }> {
    return this.refreshIndex(root)
  }

  readCoverage(root: string, rev: number, entries: LoadedNoteEntry[], repoId: string) {
    return this.coverageOverlay(root, rev, entries, repoId)
  }
}

export const harnessNoteService = new HarnessNoteService()
