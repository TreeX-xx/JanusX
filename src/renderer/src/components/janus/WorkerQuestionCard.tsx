import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { parseWorkerReport } from '@janus-agent/janus-agent/superagent/contracts/worker-report'
import type { SuperAgentReport } from '../../../../shared/superagent'
import { WorkerReportCard } from './WorkerReportCard'
import styles from './SuperAgentWork.module.css'

/** Host questions reuse the work input path; they never impersonate a native RPC request. */
export function WorkerQuestionCard({ report, title, conversationId, refresh }: {
  report: SuperAgentReport; title: string; conversationId: string; refresh(): Promise<void>
}) {
  const { t } = useTranslation('janus'), api = window.electron.superAgent!
  const [questions, setQuestions] = useState<string[]>([]), [answer, setAnswer] = useState('')
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const receipt = useRef<{ eventId: string; text: string } | null>(null), locked = useRef(false)
  useEffect(() => {
    let cancelled = false
    void api.readResource(report.workspaceId, report.resourceId).then(body => {
      if (!cancelled) setQuestions(parseWorkerReport(body.text)?.report.questions ?? [])
    }).catch(value => { if (!cancelled) setError(String(value)) })
    return () => { cancelled = true }
  }, [api, report.workspaceId, report.resourceId])
  const submit = async (text: string) => {
    if (locked.current || !text.trim()) return
    locked.current = true; setBusy(true); setError('')
    // A failed/unknown delivery keeps exactly the same identity and payload on retry.
    receipt.current ??= { eventId: crypto.randomUUID(), text }
    try {
      await api.continueWorker({ ...receipt.current, workspaceId: report.workspaceId, workId: report.workId,
        conversationId, replyToReportId: report.id })
      await refresh()
    } catch (value) { setError(String(value)) }
    finally { locked.current = false; setBusy(false) }
  }
  return <section className={styles.decision} aria-label={t('superagent.reportQuestion')} data-worker-question="">
    <strong>{t('superagent.reportQuestion')}</strong>
    <p>{report.summary}</p>
    {questions.length > 0 && <ul>{questions.map((question, index) => <li key={index}>{question}</li>)}</ul>}
    <form onSubmit={event => { event.preventDefault(); void submit(answer) }}>
      <textarea aria-label={t('superagent.questionAnswer')} value={answer} disabled={busy || !!receipt.current}
        onChange={event => setAnswer(event.target.value)} />
      <button type="submit" disabled={busy || (!receipt.current && !answer.trim())}>{t(receipt.current ? 'superagent.retryAnswer' : 'superagent.answerAndContinue')}</button>
      {!receipt.current && <button type="button" disabled={busy} onClick={() => void submit(t('superagent.recoverContextInput'))}>{t('superagent.recoverContext')}</button>}
    </form>
    <WorkerReportCard title={title} summary={report.summary} workspaceId={report.workspaceId} resourceId={report.resourceId} buttonOnly />
    {error && <p role="alert">{error}</p>}
  </section>
}
