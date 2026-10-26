import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronRight, RefreshCw, Square } from './WorkbenchIcons'
import { blueprintText as t } from './blueprint-text'
import { reviewErrorKey } from './graph/review-error'
import { REVIEW_NOTE_KINDS } from '../shared/blueprint-review'
import type { BlueprintReviewView } from '../shared/ipc/blueprint-review'
import type { NoteRepairInput } from '../shared/note-repair'
import './note-review.css'
import './note-repair.css'
import './blueprint-disclosure.css'

export type ReaderVisit = { intent: string; sequence: number; findingId?: string; reportRevision?: number; anchor?: string }
export function NoteReviewPanel({ view, rootPath, noteId, kind, sourceHash, sourcePath, onLocate, visit, shortcutHost, onReveal, repairBusy, onRepair, onRun, onClose, onCancel, onRefresh }: {
  view?: BlueprintReviewView; rootPath: string; noteId: string; kind: string; sourceHash: string; sourcePath: string
  onLocate(path: string, quote: string): void; visit?: ReaderVisit; shortcutHost?: HTMLElement | null; onReveal(): void
  repairBusy: boolean; onRepair(input: NoteRepairInput): void; onRun(): Promise<void>; onClose(ids: string[]): Promise<void>; onCancel(): Promise<void>; onRefresh(): void
}) {
  const motionReady = true
  const phases = { structure: t('review.structure.checking'), reading: t('blueprint:review.reading'), analyzing: t('blueprint:review.analyzing'), verifying: t('blueprint:review.verification'), publishing: t('blueprint:review.publishing') }

  const handoff = (ids: string[], intent: 'repair' | 'discuss', _element: HTMLElement) => {
    if (view && item?.report) onRepair({ kind: 'suggestions', intent, context: view.context, noteId, reportRevision: item.reportRevision, findingIds: ids })
  }
  const readError = ''
  const [error, setError] = useState('')
  const [starting, setStarting] = useState(false)
  const [handling, setHandling] = useState(false)
  const section = useRef<HTMLElement>(null)
  const heading = useRef<HTMLDivElement>(null)
  const contentId = useId()
  const [expanded, setExpanded] = useState(false)
  const visitIntent = visit?.intent, visitSequence = visit?.sequence
  useEffect(() => { setExpanded(Boolean(visitIntent && visitIntent !== 'body')) }, [rootPath, noteId, visitSequence, visitIntent])
  useEffect(() => {
    const wiki = heading.current?.closest<HTMLElement>('.bp-note-wiki')
    const toolbar = wiki?.querySelector<HTMLElement>('.bp-note-wiki__toolbar')
    if (!wiki || !toolbar) return
    const measure = () => {
      wiki.style.setProperty('--note-toolbar-height', toolbar.getBoundingClientRect().height + 'px')
    }
    const observer = new ResizeObserver(measure)
    observer.observe(toolbar)
    measure()
    return () => { observer.disconnect(); wiki.style.removeProperty('--note-toolbar-height') }
  }, [rootPath, noteId, kind])
  const focusedVisit = useRef(0)
  const [navigationNotice, setNavigationNotice] = useState('')
  const epoch = useRef(0)
  useEffect(() => {
    setError(''); setStarting(false); setHandling(false)
    return () => {
      // Invalidate in-flight callbacks against the latest epoch, not the value at mount.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      epoch.current++
    }
  }, [rootPath, noteId, sourceHash])
  const item = view?.items.find(item => item.noteId === noteId)
  const activity = view?.activities.find(activity => activity.noteId === noteId)
  const automaticTarget = view?.automatic?.targets?.find(target => target.noteId === noteId)
  useEffect(() => {
    if (!motionReady || !visit || visit.intent === 'body' || !view || focusedVisit.current === visit.sequence) return
    if (!expanded) { setExpanded(true); return }
    setNavigationNotice('')
    let target: HTMLElement | null = heading.current
    if (visit.reportRevision !== undefined && item && visit.reportRevision !== item.reportRevision) setNavigationNotice(t('attention.resultChanged'))
    if (visit.intent === 'finding' && visit.findingId) {
      const finding = section.current?.querySelector<HTMLDetailsElement>(`[data-finding-id="${CSS.escape(visit.findingId)}"]`)
      if (finding) { finding.open = true; target = finding }
      else setNavigationNotice(t('attention.resultChanged'))
    } else if (visit.intent === 'failure') target = section.current?.querySelector<HTMLElement>('.bp-note-review__failure') ?? target
    else if (visit.intent === 'coverage') target = section.current?.querySelector<HTMLElement>('.bp-note-review__coverage') ?? target
    const frame = requestAnimationFrame(() => { focusedVisit.current = visit.sequence; target?.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' }) })
    return () => cancelAnimationFrame(frame)
  }, [motionReady, visit, view, item, t, expanded])
  const run = async () => {
    const current = epoch.current
    setStarting(true); setError(''); setExpanded(true)
    try { await onRun() }
    catch (reason) { if (current === epoch.current) setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { if (current === epoch.current) setStarting(false); onRefresh() }
  }
  const close = async (ids: string[]) => {
    if (!view || !item) return
    const current = epoch.current
    setHandling(true); setError('')
    try { await onClose(ids) }
    catch (reason) { if (current === epoch.current) setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { if (current === epoch.current) setHandling(false); onRefresh() }
  }
  const failure = automaticTarget ? automaticTarget.state === 'failed' : Boolean(item?.error)
  const incomplete = Boolean(item?.awaitingReview) || (automaticTarget ? automaticTarget.state === 'incomplete' : item?.report?.coverage === 'insufficient')
  const running = starting || Boolean(activity)
  const structure = view?.structure
  const structureIssues = structure?.issues.filter(issue => issue.noteId === noteId || issue.path === sourcePath || issue.path === '.agents/notes/module.md') ?? []
  const rawFailure = error || readError || automaticTarget?.error || item?.error || ''
  const shortCause = readError || structure && !structure.complete ? t('review.structure.incomplete') : structureIssues.length ? t('review.failure.structure') : rawFailure ? /[\u3400-\u9fff]/.test(rawFailure) ? rawFailure.split('\n')[0].slice(0, 140) : t(reviewErrorKey(rawFailure))
    : incomplete ? t(item?.awaitingReview ? 'review.awaitingReview' : 'attention.state.incomplete') : ''
  const structureState = readError ? 'incomplete' : !structure ? 'checking' : !structure.complete ? 'incomplete' : structureIssues.length ? 'invalid' : 'passed'
  const shortcutLabel = running ? t('reader.reviewRunning') : readError ? t('reader.reviewUnavailable') : !view ? t('attention.loading') : failure ? t('reader.reviewFailed')
    : structureIssues.length ? t('reader.structureIssue') : item?.awaitingReview ? t('review.awaitingReview') : incomplete ? t('reader.reviewIncomplete')
    : item?.report && (item.report.stale || item.report.source?.hash && item.report.source.hash !== sourceHash) ? t('reader.reviewStale')
      : item?.report?.findings.length ? t('reader.reviewFindings', { count: item.report.findings.length })
        : item?.report?.coverage === 'complete' ? t('reader.reviewPassed') : t('reader.reviewUnreviewed')
  const runLabel = t(item?.awaitingReview ? 'repair.retryReview' : REVIEW_NOTE_KINDS.has(kind) ? 'review.run' : 'review.structure.run')
  return <section ref={section} className="bp-note-review bp-reader-card" aria-label={t('blueprint:review.aria')}>
    {shortcutHost && createPortal(<button type="button" className="bp-note-review-shortcut" title={t('reader.openReview')} aria-label={`${t('reader.openReview')} · ${shortcutLabel}`} onClick={() => {
      onReveal?.(); setExpanded(true)
      requestAnimationFrame(() => section.current?.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' }))
    }}>{shortcutLabel}</button>, shortcutHost)}
    <div ref={heading} className="bp-note-review__heading bp-reader-card__header" data-expanded={expanded}>
      <div className="bp-reader-card__title-row">
        <button type="button" className="bp-note-review__toggle bp-reader-card__toggle" aria-expanded={expanded} aria-controls={contentId} onClick={() => setExpanded(value => !value)}>
          <ChevronRight className="bp-disclosure-chevron" size={14} aria-hidden="true" /><strong>{t('review.title')}</strong>
          {!!item?.report?.findings.length && <span className="bp-reader-card__count">{t('attention.findings', { count: item.report.findings.length })}</span>}
        </button>
        {running ? <button type="button" className="bp-note-review__run bp-reader-card__icon" title={t('review.cancel')} aria-label={t('review.cancel')} onClick={() => void onCancel().catch(reason => setError(String(reason)))}><Square size={13} aria-hidden="true" /></button>
          : <button type="button" className="bp-note-review__run bp-reader-card__icon" title={runLabel} aria-label={runLabel} disabled={repairBusy} onClick={() => void run()}><RefreshCw size={14} aria-hidden="true" /></button>}
      </div>
        <span className="bp-note-review__status bp-reader-card__description" role="status" aria-busy={running}>
          {running && <span className="bp-note-review__spinner" aria-hidden="true" />}
          {activity ? phases[activity.phase] : starting ? t('review.starting') : shortCause || t('review.structure.' + structureState)}
        </span>
    </div>
    <div id={contentId} className="bp-note-review__content bp-reader-card__body" hidden={!expanded}>
      {(error || readError) && <p role="alert">{error || readError}</p>}
      {structure && <div className="bp-note-review__structure" data-state={structureState}>
        <strong>{t('review.structure.' + structureState)}</strong>
        {!REVIEW_NOTE_KINDS.has(kind) && <p>{t('review.structure.only')}</p>}
        {[...new Set(structureIssues.map(issue => issue.path))].map(path => {
          const issue = structureIssues.find(issue => issue.path === path)
          return issue?.hash && view ? <div className="bp-repair-actions" key={path}><button type="button" disabled={repairBusy || running} onClick={() => onRepair({ kind: 'structure', intent: 'repair', context: view.context, path, hash: issue.hash! })}>{t('repair.format')}</button></div> : null
        })}
        {structureIssues.map((issue, index) => <details key={index}><summary>{issue.field || issue.path}</summary><p>{issue.message}</p><small>{issue.code}</small></details>)}
      </div>}
      {navigationNotice && <p role="status">{navigationNotice}</p>}
      {failure && <div className="bp-note-review__failure" role="status"><strong>{t('attention.state.failed')}</strong>
        {automaticTarget?.stage && <p>{phases[automaticTarget.stage]}</p>}<p>{automaticTarget?.error || item?.error}</p><p>{t('attention.recoverReview')}</p></div>}
      {incomplete && <div className="bp-note-review__coverage" role="status">
        <strong>{t(item?.awaitingReview ? 'review.awaitingReview' : 'attention.state.incomplete')}</strong>
        {item?.report?.coverage === 'insufficient' ? item.report.limitations.map((limit, index) => <p key={index}>{limit}</p>) : <p>{t('attention.resultChanged')}</p>}
        <p>{t('attention.recoverReview')}</p>
      </div>}
      {item?.report?.stale && <p className="bp-note-review__stale">{t('blueprint:review.stale')}</p>}
      {REVIEW_NOTE_KINDS.has(kind) && !item?.report && !item?.awaitingReview && !activity && !starting && <p>{t('blueprint:review.none')}</p>}
      {item?.report && <>
        {!!item.report.findings.length && <div className="bp-repair-actions"><button type="button" disabled={repairBusy || running} onClick={event => handoff(item.report!.findings.map(finding => finding.id), 'repair', event.currentTarget.closest<HTMLElement>('.bp-note-review__content')!)}>{t('repair.all', { count: item.report!.findings.length })}</button>
          <button type="button" disabled={repairBusy || running} onClick={event => handoff(item.report!.findings.map(finding => finding.id), 'discuss', event.currentTarget.closest<HTMLElement>('.bp-note-review__content')!)}>{t('repair.discuss')}</button></div>}
        {!item.report.findings.length && <p>{item.report.coverage === 'complete' ? t('blueprint:review.noFindings') : t('blueprint:review.insufficient')}</p>}
        {item.report.findings.map(finding => <details key={finding.id} data-finding-id={finding.id} className="bp-note-review__finding">
          <summary>{finding.summary}{finding.stale ? t('blueprint:review.staleSuffix') : ''}</summary>
          <p>{finding.explanation}</p>
          {finding.citations.map((citation, index) => <blockquote key={index}><p>{citation.quote}</p><button type="button" onClick={() => onLocate(citation.path, citation.quote)}>{t('blueprint:review.locate')}{citation.path}</button></blockquote>)}
          <p><strong>{t('blueprint:review.suggestion')}</strong>{finding.suggestion}</p>
          <p>{finding.verificationDetail?.score !== undefined ? `${t('review.score')} · ${finding.verificationDetail.score.toFixed(3)}`
            : t(finding.verification === 'pending' ? 'review.scorePending' : finding.verification === 'failed' ? 'review.verifyFailed' : 'review.notVerified')}</p>
          {finding.verificationDetail && <details><summary>{t('blueprint:review.verification')}</summary><p>{finding.verificationDetail.question}</p><p>{finding.verificationDetail.model}</p>{finding.verificationDetail.error && <p>{finding.verificationDetail.error}</p>}</details>}
          <div className="bp-note-review__actions" aria-busy={handling}><button type="button" disabled={handling || repairBusy || running} onClick={() => void close([finding.id])}>{t('blueprint:review.handled')}</button><button type="button" disabled={handling || repairBusy || running} onClick={() => void close([finding.id])}>{t('blueprint:review.declined')}</button></div>
        </details>)}
      </>}
    </div>
  </section>
}
