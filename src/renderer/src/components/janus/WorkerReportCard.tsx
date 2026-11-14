import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { ClipboardList, Maximize2, Minimize2, X } from 'lucide-react'
import { useSuperAgentHighlight, useSuperAgentPresentation, workerReportKey, type ReportTarget } from './SuperAgentPresentation'
import { useSuperAgentUIStore } from '../../stores/superagent-ui'
import { isUserFacingReportSummary, parseWorkerReport, type WorkerReportDocument } from '@janus-agent/janus-agent/superagent/contracts/worker-report'
import { WorkerReportContent } from './WorkerReportContent'
import { MarkdownContent } from '../chat/ChatContent'
import styles from './WorkerReportCard.module.css'

interface Props extends ReportTarget { workId?: string; buttonOnly?: boolean | 'icon' }

/** Full reports stay in immutable resources / persisted messages; only their compact summary enters the feed. */
export function WorkerReportCard({ title, summary, content, workspaceId, resourceId, workId, buttonOnly }: Props) {
  const { t } = useTranslation('janus'), presentation = useSuperAgentPresentation()
  const [open, setOpen] = useState(false), trigger = useRef<HTMLElement | null>(null)
  const host = useRef<HTMLElement>(null), register = presentation?.registerReport
  const cardReport = useMemo(() => parseWorkerReport(content ?? ''), [content])
  const target = { title, summary, content, workspaceId, resourceId }
  const key = workId ? workerReportKey(workId, target) : ''
  useLayoutEffect(() => {
    if (!key || buttonOnly || !register) return
    register(key, host.current)
    return () => register(key, null)
  }, [key, buttonOnly, register])
  const highlight = useSuperAgentHighlight(!buttonOnly && workId ? { workIds: [workId] } : null)
  const shown = workId && presentation ? presentation.report?.workId === workId
    && (resourceId ? presentation.report.target.resourceId === resourceId : presentation.report.target.content === content) : open
  const show = (element: HTMLElement) => {
    trigger.current = element
    if (workId && presentation) { if (shown) presentation.closeReport(); else presentation.openReport(workId, target, element) }
    else setOpen(value => !value)
  }
  return <>
    {buttonOnly ? <button type="button" className={buttonOnly === 'icon' ? styles.iconButton : undefined} title={t('superagent.viewReport')} aria-label={t('superagent.viewReport')} aria-expanded={!!shown} onClick={event => show(event.currentTarget)}>
      {buttonOnly === 'icon' ? <ClipboardList size={14} aria-hidden="true" /> : t('superagent.viewReport')}</button> :
      <article ref={host} className={styles.card} data-worker-report="" data-report-key={key || undefined} {...highlight}>
        <small>{t('superagent.report')}</small><h2>{title}</h2>
        {cardReport ? <><p>{isUserFacingReportSummary(cardReport.summary) ? cardReport.summary : t('superagent.reportLegacyCard')}</p><ReportCardChecks document={cardReport} /></>
          : <p>{content || !isUserFacingReportSummary(summary) ? t('superagent.reportLegacyCard') : summary}</p>}
        <footer><button type="button" aria-expanded={!!shown} onClick={event => show(event.currentTarget)}>{t('superagent.viewReport')}</button></footer>
      </article>}
    {!buttonOnly && shown && workId && presentation ? <WorkerReportReader key={key} {...presentation.report!.target} workId={workId} onClose={presentation.closeReport} />
      : open && <WorkerReportReader {...target} workId={workId} onClose={() => { setOpen(false); requestAnimationFrame(() => trigger.current?.focus({ preventScroll: true })) }} />}
  </>
}

/** In-place by default. Enlarging is explicit, with the same fetched document and original-view state. */
export function WorkerReportReader({ title, content, workspaceId, resourceId, workId, onClose }: ReportTarget & { workId?: string; onClose(): void }) {
  const { t } = useTranslation('janus')
  const [enlarged, setEnlarged] = useState(false), [body, setBody] = useState(content ?? ''), [error, setError] = useState('')
  const [loading, setLoading] = useState(false), [original, setOriginal] = useState(false)
  const [retry, setRetry] = useState(0)
  const dialog = useRef<HTMLDialogElement>(null), reader = useRef<HTMLElement>(null), heading = useId()
  const structured = useMemo(() => parseWorkerReport(body), [body])
  useEffect(() => {
    let cancelled = false
    const markRead = () => { if (workspaceId && workId && resourceId) useSuperAgentUIStore.getState().markWorkerReportRead(workspaceId, workId, resourceId) }
    setBody(content ?? ''); setError(''); setLoading(false)
    if (content === undefined && workspaceId && resourceId) {
      setLoading(true)
      void window.electron.superAgent!.readResource(workspaceId, resourceId)
        .then(result => { if (!cancelled) { setBody(result.text); markRead() } })
        .catch(value => { if (!cancelled) setError(String(value)) })
        .finally(() => { if (!cancelled) setLoading(false) })
    } else if (content !== undefined) markRead()
    return () => { cancelled = true }
  }, [content, workspaceId, resourceId, workId, retry])
  useLayoutEffect(() => {
    if (enlarged) dialog.current?.showModal()
    else if (reader.current) {
      // Reveal the heading inside its transcript, without scrolling the whole tool pane.
      for (let parent = reader.current.parentElement; parent; parent = parent.parentElement) {
        if (parent.scrollHeight > parent.clientHeight && /auto|scroll/.test(getComputedStyle(parent).overflowY)) {
          parent.scrollTop += reader.current.getBoundingClientRect().top - parent.getBoundingClientRect().top - 12
          break
        }
      }
      reader.current.focus({ preventScroll: true })
    }
  }, [enlarged])
  const contents = <>
      <header><div><small>{t('superagent.report')}</small><h2 id={heading}>{title}</h2></div><div className={styles.readerActions}>
        <button type="button" aria-label={t(enlarged ? 'superagent.shrinkReport' : 'superagent.enlargeReport')} title={t(enlarged ? 'superagent.shrinkReport' : 'superagent.enlargeReport')} onClick={() => setEnlarged(value => !value)}>{enlarged ? <Minimize2 size={15} /> : <Maximize2 size={15} />}</button>
        <button type="button" aria-label={t('superagent.closeReport')} onClick={onClose}><X size={16} /></button></div></header>
      <div className={styles.toolbar}><span>{t('superagent.reportDetails')}</span>
        <button type="button" aria-pressed={original} onClick={() => setOriginal(value => !value)}>{t(original ? 'superagent.reportBack' : 'superagent.reportOriginal')}</button></div>
      <div className={styles.body} data-worker-report-body="">{loading ? <p role="status">{t('superagent.loadingContent')}</p> : error ? <><p role="alert">{error}</p><button onClick={() => setRetry(value => value + 1)}>{t('superagent.retryContent')}</button></>
        : original ? <pre className={styles.original}>{body}</pre> : structured ? <WorkerReportContent document={structured} />
          : <><p className={styles.caption}>{t('superagent.reportLegacy')}</p><MarkdownContent content={body} variant="conversation" /></>}</div>
  </>
  return enlarged ? createPortal(<dialog ref={dialog} className={styles.dialog} aria-labelledby={heading} onCancel={event => { event.preventDefault(); setEnlarged(false) }} onClose={() => setEnlarged(false)}>{contents}</dialog>, document.body)
    : <section ref={reader} className={styles.drawer} role="region" aria-label={t('superagent.reportDetails')} tabIndex={-1} data-worker-report-drawer="" data-worker-report-inline=""
        onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); onClose() } }}>{contents}</section>
}

/** A sidebar report may arrive before its persisted conversation message is visible. */
export function SuperAgentReportFallback() {
  const presentation = useSuperAgentPresentation(), report = presentation?.report
  return report && !report.inline ? <WorkerReportReader key={workerReportKey(report.workId, report.target)} {...report.target} workId={report.workId} onClose={presentation.closeReport} /> : null
}

function ReportCardChecks({ document }: { document: WorkerReportDocument }) {
  const { t } = useTranslation('janus')
  const failed = document.report.checks.filter(check => check.status === 'failed').length
  const notRun = document.report.checks.filter(check => check.status === 'not_run').length
  const passed = document.report.checks.filter(check => check.status === 'passed').length
  return <div className={styles.cardChecks}>
    <span>{t(document.kind === 'question' ? 'superagent.reportQuestion' : document.kind === 'failure' ? 'superagent.reportFailure' : 'superagent.reportReady')}</span>
    {failed > 0 && <span data-status="failed">{t('superagent.reportFailedCount', { count: failed })}</span>}
    {passed > 0 && <span>{t('superagent.reportPassedCount', { count: passed })}</span>}
    {notRun > 0 && <span>{t('superagent.reportNotRunCount', { count: notRun })}</span>}
  </div>
}

/** Backward-compatible rendering for already persisted report messages; no model text classification. */
export function WorkerReportMessage({ content, reportId }: { content: string; reportId?: string }) {
  const presentation = useSuperAgentPresentation()
  const boundary = content.indexOf('\n\n')
  const heading = boundary < 0 ? content.split('\n')[0] : content.slice(0, boundary)
  const title = heading.includes(' · ') ? heading.slice(heading.indexOf(' · ') + 3) : heading
  const body = boundary < 0 ? content : content.slice(boundary + 2)
  const source = reportId ? presentation?.reportSource(reportId) : undefined
  return <WorkerReportCard title={title} summary={parseWorkerReport(body)?.summary ?? body.split(/\n\s*\n/)[0].slice(0, 240)} content={body} {...source} />
}
