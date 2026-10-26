// Note: local acknowledgements never modify source Notes — see .agents/notes/blueprint/navigation/note-updates-and-suggestion-navigation.md
import { abortableRead } from './read-task'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { z } from 'zod'
import { SerialQueue, writeFileAtomic } from '@janusx/plugin-sdk/native'
import { reviewContextKey } from './suggestions/store'
import type { SuggestionSources } from './suggestions/sources'
import type { ReviewContext, ReviewSourceSnapshot } from '../../shared/blueprint-review'
import type { NoteReadResult, NoteUpdatesView, NoteVersion } from '../../shared/blueprint-attention'

const recordSchema = z.object({ hash: z.string(), path: z.string(), baselineHash: z.string().optional(), baselinePath: z.string().optional(),
  readHash: z.string().optional(), readPath: z.string().optional(), stamp: z.string().optional(), observedAt: z.string(), available: z.boolean() })
const branchSchema = z.object({ initialized: z.boolean(), records: z.record(recordSchema) })
const stateSchema = z.object({ version: z.literal(1), revision: z.number(), contexts: z.record(branchSchema) })
type State = z.infer<typeof stateSchema>
type Branch = z.infer<typeof branchSchema>
type RecordState = z.infer<typeof recordSchema>
type Undo = { context: ReviewContext; expiresAt: number; stamp: string; rows: Array<{ id: string; hash?: string; path?: string; stamp?: string }> }

export class NoteReadingService {
  private readonly queue = new SerialQueue()
  private observationRevision = 0
  get observationEpoch(): number { return this.observationRevision }
  private readonly undo = new Map<string, Undo>()
  constructor(private readonly path: string, private readonly sources: SuggestionSources, private readonly now: () => number = Date.now) {}
  private async load(): Promise<State> {
    try { return stateSchema.parse(JSON.parse(await readFile(this.path, 'utf8'))) }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, revision: 0, contexts: {} }; throw error }
  }
  private async save(state: State) { state.revision++; await writeFileAtomic(this.path, JSON.stringify(state) + '\n'); this.observationRevision++ }
  private sync(state: State, snapshot: ReviewSourceSnapshot): Branch {
    const key = reviewContextKey(snapshot.context)
    const branch = state.contexts[key] ?? { initialized: false, records: {} }
    // A partial first scan cannot decide which files are new.
    if (!branch.initialized && !snapshot.complete) return branch
    const initial = !branch.initialized
    const present = new Set(snapshot.notes.map(note => note.noteId))
    for (const note of snapshot.notes) {
      let record = branch.records[note.noteId]
      if (!record) record = branch.records[note.noteId] = { hash: note.hash, path: note.path, available: true, observedAt: new Date(this.now()).toISOString(),
        ...(initial ? { baselineHash: note.hash, baselinePath: note.path } : {}) }
      if (record.hash !== note.hash || record.path !== note.path) {
        record.hash = note.hash; record.path = note.path; record.observedAt = new Date(this.now()).toISOString()
      }
      record.available = true
    }
    for (const [id, record] of Object.entries(branch.records)) {
      if (!present.has(id)) {
        record.available = false
        // Keep the identity's baseline for a later restore; omit confirmed absent targets from the view.
      }
    }
    branch.initialized = true
    state.contexts[key] = branch
    return branch
  }
  private view(state: State, branch: Branch, snapshot: Pick<ReviewSourceSnapshot, 'complete'>): NoteUpdatesView {
    return { ready: branch.initialized, complete: snapshot.complete, revision: state.revision,
      entries: Object.entries(branch.records).filter(([, record]) => record.available || !snapshot.complete).map(([noteId, record]) => {
        const hash = record.readHash ?? record.baselineHash, path = record.readPath ?? record.baselinePath
        return { noteId, hash: record.hash, path: record.path, unread: hash !== record.hash || path !== record.path,
          change: !hash ? 'added' : hash === record.hash && path !== record.path ? 'moved' : 'modified', observedAt: record.observedAt, available: record.available }
      }) }
  }
  /** Read only the persisted observation; never scan sources or establish a first-use baseline. */
  async readSaved(context: ReviewContext): Promise<NoteUpdatesView> {
    const state = await this.load()
    const branch = state.contexts[reviewContextKey(context)] ?? { initialized: false, records: {} }
    return { ...this.view(state, branch, { complete: true }), complete: false }
  }
  /** Host-verified writes update only their target; they never establish an incomplete baseline. */
  observeVersion(context: ReviewContext, version: NoteVersion): Promise<NoteUpdatesView> {
    return this.queue.run(async () => {
      const state = await this.load(), branch = state.contexts[reviewContextKey(context)]
      if (!branch?.initialized) return this.view(state, { initialized: false, records: {} }, { complete: false })
      const previous = branch.records[version.noteId]
      if (!previous || previous.hash !== version.hash || previous.path !== version.path || !previous.available) {
        branch.records[version.noteId] = { ...previous, hash: version.hash, path: version.path, available: true, observedAt: new Date(this.now()).toISOString() }
        await this.save(state)
      }
      return this.view(state, branch, { complete: false })
    })
  }
  async read(context: ReviewContext, observed?: ReviewSourceSnapshot, signal?: AbortSignal, observedEpoch = this.observationEpoch): Promise<NoteUpdatesView> {
    return this.queue.run(async () => {
      signal?.throwIfAborted()
      const snapshot = observed ?? await abortableRead(this.sources.capture(context, [], signal), signal), state = await abortableRead(this.load(), signal)
      signal?.throwIfAborted()
      if (reviewContextKey(context) !== reviewContextKey(snapshot.context)) throw new Error('Note observation belongs to another workspace')
      if (observed && observedEpoch !== this.observationEpoch) return this.view(state,
        state.contexts[reviewContextKey(context)] ?? { initialized: false, records: {} }, { complete: false })
      const before = JSON.stringify(state.contexts)
      const branch = this.sync(state, snapshot)
      if (before !== JSON.stringify(state.contexts)) await this.save(state)
      return this.view(state, branch, snapshot)
    })
  }
  async mark(context: ReviewContext, versions: NoteVersion[], bulk = false): Promise<NoteReadResult> {
    return this.queue.run(async () => {
      const snapshot = await this.sources.capture(context, []), state = await this.load(), branch = this.sync(state, snapshot)
      if (!branch.initialized) throw new Error('Note sources are incomplete; reading state was not changed')
      // A batch names explicit versions; unrelated malformed Notes must not block readable targets.
      // Validate every selected identity before writing, including when the list came from saved records.
      if (bulk && versions.some(version => !snapshot.notes.some(note => note.noteId === version.noteId))) {
        throw new Error('Some selected Notes are unavailable; refresh the update list and try again')
      }
      const stamp = randomUUID(), rows: Undo['rows'] = []
      for (const version of versions) {
        const record = branch.records[version.noteId]
        // Late reads acknowledge only the version requested; newer source bytes stay unread.
        if (!record?.available) continue
        if (record.readHash === record.hash && record.readPath === record.path && (version.hash !== record.hash || version.path !== record.path)) continue
        rows.push({ id: version.noteId, hash: record.readHash, path: record.readPath, stamp: record.stamp })
        record.readHash = version.hash; record.readPath = version.path; record.stamp = stamp
      }
      await this.save(state)
      const result: NoteReadResult = { context, updates: this.view(state, branch, snapshot) }
      for (const [token, undo] of this.undo) if (undo.expiresAt <= this.now()) this.undo.delete(token)
      if (bulk && rows.length) {
        result.undoToken = randomUUID(); result.expiresAt = this.now() + 8000
        this.undo.set(result.undoToken, { context, rows, stamp, expiresAt: result.expiresAt })
      }
      return result
    })
  }
  async revert(token: string): Promise<NoteReadResult> {
    return this.queue.run(async () => {
      const undo = this.undo.get(token)
      if (!undo || undo.expiresAt <= this.now()) { this.undo.delete(token); throw new Error('The reading undo has expired') }
      const snapshot = await this.sources.capture(undo.context, []), state = await this.load(), branch = this.sync(state, snapshot)
      for (const row of undo.rows) {
        const record: RecordState | undefined = branch.records[row.id]
        if (!record || record.stamp !== undo.stamp) continue
        record.readHash = row.hash; record.readPath = row.path; record.stamp = row.stamp
      }
      await this.save(state); this.undo.delete(token)
      return { context: undo.context, updates: this.view(state, branch, snapshot) }
    })
  }
}
