// Note: host-neutral entry for the shared suggestion state — see .agents/notes/blueprint/maintenance/suggestions/module.md
import { abortableRead } from '../read-task'
import { setTimeout as delay } from 'node:timers/promises'
import { reviewResultSchema, type ReviewContext, type ReviewEvidence, type ReviewFinding, type ReviewResult, type ReviewTicket } from '../../../shared/blueprint-review'
import { SuggestionService } from './service'
import { WorkspaceSuggestionSources, type SuggestionSources } from './sources'
import { containsReviewQuote } from '../review/citations'

/** Hosts resolve a context explicitly; switching the UI project never redirects a bound caller. */
export class WorkspaceSuggestions {
  constructor(private readonly service: SuggestionService, private readonly sources: SuggestionSources = new WorkspaceSuggestionSources(),
    private readonly reviewSources: SuggestionSources = sources, private readonly snapshotCommit?: string) {}

  /** Keep live reconciliation while validating an automatic review against its immutable commit. */
  atSnapshot(sources: SuggestionSources, commit: string): WorkspaceSuggestions {
    return new WorkspaceSuggestions(this.service, this.sources, sources, commit)
  }

  async synchronize(context: ReviewContext, extraEvidence: string[] = [], signal?: AbortSignal) {
    for (let attempt = 0; attempt < 3; attempt++) {
      signal?.throwIfAborted()
      const revision = this.service.read(context).revision
      const evidence = [...new Set([...this.service.evidencePaths(context), ...extraEvidence])]
      try {
        const snapshot = await abortableRead(this.sources.capture(context, evidence, signal), signal)
        signal?.throwIfAborted()
        const committedRevision = this.service.reconcile(context, snapshot, revision)
        const view = this.service.read(context)
        if (view.revision !== committedRevision) throw Object.assign(new Error('Suggestions changed during source reconciliation'), { code: 'CONFLICT' })
        return { ...view, snapshot }
      } catch (error) {
        if ((error as { code?: string }).code !== 'CONFLICT' || attempt === 2) throw error
      }
    }
    throw new Error('Workspace changed repeatedly')
  }

  async read(context: ReviewContext, signal?: AbortSignal) {
    const { snapshot: _snapshot, ...view } = await this.readWithSnapshot(context, signal)
    return view
  }

  /** The desktop update counter consumes this same synchronized source observation. */
  async readWithSnapshot(context: ReviewContext, signal?: AbortSignal) {
    let synchronized = await this.synchronize(context, [], signal)
    const missing = synchronized.items.some(item => item.availability === 'unavailable' && item.source
      && !synchronized.snapshot.notes.some(note => note.noteId === item.noteId))
    if (synchronized.snapshot.complete && missing) {
      await abortableRead(delay(550), signal)
      synchronized = await this.synchronize(context, [], signal)
    }
    return { ...synchronized, sourceComplete: synchronized.snapshot.complete }
  }

  async begin(context: ReviewContext, noteId: string, evidence: ReviewEvidence[] = [], expectedHash?: string, signal?: AbortSignal): Promise<ReviewTicket> {
    const { revision, snapshot: live } = await this.synchronize(context, this.snapshotCommit ? [] : evidence.map(source => source.path), signal)
    const snapshot = this.snapshotCommit ? await this.reviewSources.capture(context, evidence.map(source => source.path)) : live
    if (evidence.some(source => snapshot.evidence[source.path] !== source.hash)) throw new Error('Review evidence changed')
    const target = snapshot.notes.find(note => note.noteId === noteId)
    if (this.snapshotCommit && !target) throw new Error('Review target changed')
    if (expectedHash && target?.hash !== expectedHash) throw new Error('Review target changed')
    signal?.throwIfAborted()
    return this.service.begin(context, noteId, revision, evidence, this.snapshotCommit ? target : undefined, this.snapshotCommit)
  }

  async extendEvidence(context: ReviewContext, noteId: string, ticketId: string, evidence: ReviewEvidence[], signal?: AbortSignal): Promise<void> {
    const { revision, snapshot: live } = await this.synchronize(context, this.snapshotCommit ? [] : evidence.map(source => source.path), signal)
    const snapshot = this.snapshotCommit ? await this.reviewSources.capture(context, evidence.map(source => source.path)) : live
    if (evidence.some(source => snapshot.evidence[source.path] !== source.hash)) throw new Error('Review evidence changed')
    signal?.throwIfAborted()
    this.service.extendEvidence(context, noteId, ticketId, revision, evidence)
  }

  async publish(context: ReviewContext, noteId: string, ticketId: string, result: ReviewResult, signal?: AbortSignal): Promise<void> {
    const parsed = reviewResultSchema.parse(result)
    signal?.throwIfAborted()
    const ticket = this.service.read(context).items.find(item => item.noteId === noteId)?.pending
    if (!ticket || ticket.id !== ticketId) throw new Error('Review input is no longer current')
    const pinned = await this.reviewSources.capture(context, [ticket.source.path, ...ticket.evidence.map(source => source.path)])
    if (pinned.notes.find(note => note.noteId === noteId)?.hash !== ticket.source.hash ||
      ticket.evidence.some(source => pinned.evidence[source.path] !== source.hash)) throw new Error('Review evidence changed')
    const paths = new Set([ticket.source.path, ...ticket.evidence.map(source => source.path)])
    const bytes = new Map<string, string>()
    for (const path of paths) bytes.set(path, (await this.reviewSources.bytes(context, path)).toString('utf8'))
    for (const finding of [...parsed.findings, ...parsed.resolvedFindings]) {
      if (finding.citations.some(citation => !bytes.has(citation.path) || !containsReviewQuote(bytes.get(citation.path)!, citation.quote))) throw new Error('Review citation is not present in its source')
    }
    const live = await this.synchronize(context, [], signal)
    signal?.throwIfAborted()
    this.service.publish(context, ticketId, noteId, parsed, live.snapshot.evidence)
  }

  async close(context: ReviewContext, noteId: string, reportRevision: number, findingIds: string[]) {
    await this.read(context)
    return this.service.close(context, noteId, reportRevision, findingIds)
  }

  async retire(context: ReviewContext, noteId: string, hash: string) {
    await this.synchronize(context)
    this.service.retire(context, noteId, hash)
  }

  saved(context: ReviewContext) { return this.service.read(context) }

  score(context: ReviewContext, noteId: string, reportId: string, hash: string, finding: ReviewFinding) {
    return this.service.score(context, noteId, reportId, hash, finding)
  }

  fail(context: ReviewContext, noteId: string, ticketId: string, message: string): void {
    this.service.fail(context, noteId, ticketId, message)
  }
}
