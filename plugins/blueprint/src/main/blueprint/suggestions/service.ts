// Note: one lifecycle for desktop and MCP — see .agents/notes/blueprint/maintenance/suggestions/module.md
import { randomUUID } from 'node:crypto'
import {
  REVIEW_NOTE_KINDS, reviewEvidenceSchema, reviewResultSchema, reviewSourceSchema,
  type ReportedFinding, type ReviewContext, type ReviewEvidence, type ReviewFinding, type ReviewItem, type ReviewResult, type ReviewSource, type ReviewSourceSnapshot, type ReviewTicket,
} from '../../../shared/blueprint-review'
import { reviewContextKey, ReviewStore, type ReviewState, type StoredReviewItem } from './store'

const conflict = (): Error => Object.assign(new Error('Suggestion or source changed; read the current state'), { code: 'CONFLICT' })
const evidenceMatches = (evidence: ReviewEvidence[], snapshot: ReviewSourceSnapshot): boolean =>
  evidence.every(source => snapshot.evidence[source.path] === source.hash)

const reportEvidence = (item: StoredReviewItem) => [
  ...(item.report?.evidence ?? []), ...(item.report?.findings.flatMap(finding => finding.evidence) ?? []),
]
// Only exact content matches are merged. Similar wording or a shared title is not proof of identity.
function findingKey(finding: ReviewFinding): string {
  const prose = (value: string) => value.normalize('NFC').trim().replace(/\s+/g, ' ')
  return JSON.stringify([finding.category, prose(finding.summary), prose(finding.explanation), prose(finding.suggestion),
    [...new Set(finding.citations.map(citation => JSON.stringify([citation.path, citation.quote])))].sort()])
}

function invalidate(item: StoredReviewItem): void {
  item.generation = randomUUID()
  item.reportRevision++
  item.pending = null
  item.error = null
}

/** A stale report cannot accept a score; do not leave its annotation pending forever. */
function settleStaleScores(item: StoredReviewItem): void {
  if (!item.report?.stale) return
  for (const finding of item.report.findings) {
    if (finding.verification !== 'pending') continue
    finding.verification = 'failed'
    finding.verificationDetail = undefined
  }
}

function clear(item: StoredReviewItem, availability: 'deleted' | 'excluded'): void {
  invalidate(item)
  item.report = null
  delete item.awaitingReview
  item.observedEvidence = {}
  item.availability = availability
  item.missingSince = null
  if (availability === 'deleted') item.source = null
}

export class SuggestionService {
  constructor(private readonly store: ReviewStore, private readonly now = Date.now, private readonly deletionGraceMs = 500) {}

  read(context: ReviewContext): { revision: number; items: ReviewItem[] } {
    const state = this.store.read(context)
    return { revision: state.revision, items: state.items.filter(item => item.availability !== 'deleted' && item.availability !== 'excluded')
      .map(({ generation: _generation, missingSince: _missingSince, observedEvidence: _observedEvidence, ...item }) => item) }
  }

  evidencePaths(context: ReviewContext): string[] {
    return [...new Set(this.store.read(context).items.flatMap(item => [
      ...(item.report?.evidence ?? []), ...(item.report?.findings.flatMap(finding => finding.evidence) ?? []), ...(item.pending?.evidence ?? []),
    ]).map(source => source.path))]
  }

  /** A scan is applied only to the revision from which its evidence requests were collected. */
  reconcile(context: ReviewContext, snapshot: ReviewSourceSnapshot, expectedRevision: number): number {
    if (reviewContextKey(context) !== reviewContextKey(snapshot.context)) throw conflict()
    const notes = snapshot.notes.map(note => reviewSourceSchema.parse(note))
    if (new Set(notes.map(note => note.noteId)).size !== notes.length) throw new Error('Ambiguous Note identity')
    const committed = this.store.mutate(context, state => {
      if (state.revision !== expectedRevision) throw conflict()
      const byId = new Map(notes.map(note => [note.noteId, note]))
      const unavailable = new Set(snapshot.unavailablePaths)
      for (const item of state.items) {
        const originalRevision = item.reportRevision
        const source = byId.get(item.noteId)
        if (!source) {
          if (item.availability === 'deleted') continue
          const confirmedReadable = snapshot.complete && item.source && !unavailable.has(item.source.path)
          if (confirmedReadable && item.missingSince !== null && this.now() - item.missingSince >= this.deletionGraceMs) {
            clear(item, 'deleted')
          } else {
            if (item.availability !== 'unavailable') invalidate(item)
            item.availability = 'unavailable'
            item.missingSince = confirmedReadable ? item.missingSince ?? this.now() : null
            if (item.report) { item.report.stale = true; item.report.findings.forEach(finding => { finding.stale = true }) }
            settleStaleScores(item)
          }
          continue
        }
        const changed = JSON.stringify(item.source) !== JSON.stringify(source)
        const wasUnavailable = item.availability !== 'available'
        item.source = source
        item.missingSince = null
        if (!REVIEW_NOTE_KINDS.has(source.kind)) {
          if (item.availability !== 'excluded') clear(item, 'excluded')
          continue
        }
        item.availability = 'available'
        if (changed || wasUnavailable) {
          invalidate(item)
          if (item.report) { item.report.stale = true; item.report.findings.forEach(finding => { finding.stale = true }) }
        }
        const dependencies = reportEvidence(item)
        const observed = Object.fromEntries(dependencies.map(source => [source.path, snapshot.evidence[source.path] ?? null]))
        const before = item.observedEvidence ?? Object.fromEntries(dependencies.map(source => [source.path, source.hash]))
        const evidenceChanged = Object.keys(observed).some(path => observed[path] !== before[path])
        item.observedEvidence = observed
        if (item.report && (item.report.source.path !== source.path || item.report.source.hash !== source.hash ||
          !evidenceMatches(item.report.evidence, snapshot))) item.report.stale = true
        for (const finding of item.report?.findings ?? []) {
          if (finding.source.path !== source.path || finding.source.hash !== source.hash ||
            !evidenceMatches(finding.evidence, snapshot)) { finding.stale = true; item.report!.stale = true }
        }
        settleStaleScores(item)
        if ((evidenceChanged || item.pending && !item.pending.snapshotCommit && !evidenceMatches(item.pending.evidence, snapshot)) && item.reportRevision === originalRevision) invalidate(item)
      }
      for (const source of notes) {
        if (state.items.some(item => item.noteId === source.noteId)) continue
        state.items.push({ noteId: source.noteId, source, generation: randomUUID(),
          availability: REVIEW_NOTE_KINDS.has(source.kind) ? 'available' : 'excluded',
          reportRevision: 0, report: null, pending: null, error: null, missingSince: null })
      }
      return state
    })
    return committed.revision
  }

  begin(context: ReviewContext, noteId: string, expectedRevision: number, evidence: ReviewEvidence[], snapshotSource?: ReviewSource, snapshotCommit?: string): ReviewTicket {
    const sources = evidence.map(source => reviewEvidenceSchema.parse(source))
    if (new Set(sources.map(source => source.path)).size !== sources.length) throw new Error('Duplicate evidence path')
    return this.store.mutate(context, state => {
      if (state.revision !== expectedRevision) throw conflict()
      const item = this.target(state, noteId)
      if (item.availability !== 'available' || !item.source) throw conflict()
      const source = snapshotSource ? reviewSourceSchema.parse(snapshotSource) : item.source
      if (source.noteId !== noteId) throw conflict()
      const ticket: ReviewTicket = { id: randomUUID(), noteId, generation: item.generation,
        source, evidence: sources, reportRevision: item.reportRevision, ...(snapshotCommit ? { snapshotCommit } : {}) }
      item.pending = ticket
      item.error = null
      return ticket
    })
  }

  extendEvidence(context: ReviewContext, noteId: string, ticketId: string, expectedRevision: number, evidence: ReviewEvidence[]): void {
    const sources = evidence.map(source => reviewEvidenceSchema.parse(source))
    if (new Set(sources.map(source => source.path)).size !== sources.length) throw new Error('Duplicate evidence path')
    this.store.mutate(context, state => {
      if (state.revision !== expectedRevision) throw conflict()
      const item = this.target(state, noteId)
      if (!item.pending || item.pending.id !== ticketId || item.pending.generation !== item.generation) throw conflict()
      item.pending.evidence = sources
    })
  }

  publish(context: ReviewContext, ticketId: string, noteId: string, result: ReviewResult, liveEvidence?: Record<string, string | null>): void {
    const parsed = reviewResultSchema.parse(result)
    this.store.mutate(context, state => {
      const item = this.target(state, noteId)
      const ticket = item.pending
      if (!ticket || ticket.id !== ticketId || ticket.generation !== item.generation || item.availability !== 'available'
        || ticket.reportRevision !== item.reportRevision) throw conflict()
      const evidence = new Set([ticket.source.path, ...ticket.evidence.map(source => source.path)])
      if ([...parsed.findings, ...parsed.resolvedFindings].some(finding => finding.citations.some(citation => !evidence.has(citation.path)))) throw new Error('Unrecorded evidence citation')
      const previous = item.report?.findings ?? []
      const remaining = parsed.coverage === 'complete' ? [] : previous
      const stale = ticket.source.hash !== item.source?.hash || ticket.source.path !== item.source?.path
        || Boolean(liveEvidence && ticket.evidence.some(source => liveEvidence[source.path] !== source.hash))
      const byContent = new Map(remaining.map(finding => [findingKey(finding), finding]))
      const findings: ReportedFinding[] = []
      const ids = new Set<string>(), keys = new Set<string>()
      for (const finding of parsed.findings) {
        const key = findingKey(finding)
        const id = remaining.find(previous => previous.id === finding.id)?.id ?? byContent.get(key)?.id ?? finding.id
        if (ids.has(id) || keys.has(key)) continue
        ids.add(id); keys.add(key)
        findings.push({ ...finding, id, source: ticket.source, evidence: ticket.evidence, stale })
      }
      for (const finding of remaining) {
        const key = findingKey(finding)
        if (ids.has(finding.id) || keys.has(key)) continue
        ids.add(finding.id); keys.add(key); findings.push(finding)
      }
      // Resolution explanations are transient validation inputs, never a history of cleared issues.
      item.report = { coverage: parsed.coverage, limitations: parsed.limitations, provenance: parsed.provenance, findings, id: ticket.id,
        source: ticket.source, evidence: ticket.evidence, stale: stale || findings.some(finding => finding.stale), createdAt: new Date(this.now()).toISOString() }
      settleStaleScores(item)
      const latest = { ...item.observedEvidence, ...Object.fromEntries(ticket.evidence.map(source => [source.path, source.hash])) }
      item.observedEvidence = Object.fromEntries(reportEvidence(item).map(source => [source.path, source.path in latest ? latest[source.path] : source.hash]))
      item.reportRevision++
      item.pending = null
      item.error = null
      if (parsed.coverage === 'complete' && !item.report.stale) delete item.awaitingReview
    })
  }

  retire(context: ReviewContext, noteId: string, hash: string): void {
    this.store.mutate(context, state => {
      const item = this.target(state, noteId)
      if (item.availability !== 'available' || item.source?.hash !== hash) throw conflict()
      invalidate(item)
      item.report = null
      item.awaitingReview = { hash }
    })
  }

  /** Scoring is annotation only. Never attach a late score to another report or source. */
  score(context: ReviewContext, noteId: string, reportId: string, hash: string, finding: ReviewFinding): boolean {
    return this.store.mutate(context, state => {
      const item = this.target(state, noteId), report = item.report
      if (!report || report.id !== reportId || report.source.hash !== hash || item.source?.hash !== hash || report.stale) return false
      const target = report.findings.find(value => value.id === finding.id)
      if (!target) return false
      target.verification = finding.verification
      target.verificationDetail = finding.verificationDetail
      return true
    })
  }

  fail(context: ReviewContext, noteId: string, ticketId: string, message: string): void {
    this.store.mutate(context, state => {
      const item = this.target(state, noteId)
      if (item.pending?.id !== ticketId) throw conflict()
      item.pending = null
      item.error = message.slice(0, 2000)
    })
  }

  close(context: ReviewContext, noteId: string, reportRevision: number, findingIds: string[]): 'closed' | 'absent' {
    if (findingIds.length === 0) throw new Error('Select at least one finding')
    return this.store.mutate(context, state => {
      const item = state.items.find(row => row.noteId === noteId)
      if (!item?.report) return 'absent'
      if (item.reportRevision !== reportRevision) throw conflict()
      const selected = new Set(findingIds)
      const findings = item.report.findings.filter(finding => !selected.has(finding.id))
      if (findings.length === item.report.findings.length) return 'absent'
      if (findings.length) item.report.findings = findings
      else item.report = null
      invalidate(item)
      return 'closed'
    })
  }

  private target(state: ReviewState, noteId: string): StoredReviewItem {
    const item = state.items.find(row => row.noteId === noteId)
    if (!item) throw conflict()
    return item
  }
}
