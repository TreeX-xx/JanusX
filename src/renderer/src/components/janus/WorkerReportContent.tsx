import { useTranslation } from 'react-i18next'
import type { WorkerReportDocument } from '@janus-agent/janus-agent/superagent/contracts/worker-report'
import { MarkdownContent } from '../chat/ChatContent'
import styles from './WorkerReportCard.module.css'

export function WorkerReportContent({ document }: { document: WorkerReportDocument }) {
  const { t } = useTranslation('janus')
  if (document.kind !== 'question') return <ReportSections document={document} />
  return <div className={styles.result}>
    <section className={styles.conclusion}>
      <span className={styles.badge} data-status="question">{t('superagent.reportQuestion')}</span>
      <MarkdownContent content={document.summary} variant="conversation" />
    </section>
    <section className={styles.questions}><h3>{t('superagent.reportQuestions')}</h3>
      <ul>{document.report.questions.map((question, index) => <li key={index}><MarkdownContent content={question} variant="conversation" /></li>)}</ul>
    </section>
    {document.report.limitations.length > 0 && <section><h3>{t('superagent.reportLimitations')}</h3>
      <ul>{document.report.limitations.map((item, index) => <li key={index}><MarkdownContent content={item} variant="conversation" /></li>)}</ul>
    </section>}
    <details className={styles.details}><summary>{t('superagent.reportDetails')}</summary><ReportSections document={document} /></details>
  </div>
}

function ReportSections({ document }: { document: WorkerReportDocument }) {
  const { t } = useTranslation('janus')
  const { report } = document
  const kindLabel = { ready: t('superagent.reportReady'), question: t('superagent.reportQuestion'), failure: t('superagent.reportFailure') }
  const checkLabel = { passed: t('superagent.checkPassed'), failed: t('superagent.checkFailed'), not_run: t('superagent.checkNotRun'), not_applicable: t('superagent.checkNotApplicable') }
  return <div className={styles.result}>
    <section className={styles.conclusion} aria-label={t('superagent.reportConclusion')}>
      <span className={styles.badge} data-status={document.kind}>{kindLabel[document.kind]}</span>
      <div className={styles.summary}><MarkdownContent content={document.summary} variant="conversation" /></div>
      <p className={styles.caption}>{t('superagent.reportEvidenceNotice')}</p>
    </section>
    <section><h3>{t('superagent.reportCompleted')}</h3>{report.completed.length
      ? <ul>{report.completed.map((item, i) => <li key={i}><MarkdownContent content={item} variant="conversation" /></li>)}</ul>
      : <p className={styles.caption}>{t('superagent.reportNoCompleted')}</p>}</section>
    <section><h3>{t('superagent.reportChecks')}</h3><ul className={styles.checks}>{report.checks.map((check, i) => <li key={i}>
      <div className={styles.checkHeading}><span className={styles.badge} data-status={check.status}>{checkLabel[check.status]}</span><code>{check.method}</code></div>
      <MarkdownContent content={check.result} variant="conversation" />
      {check.evidence.length > 0 && <ul className={styles.references} aria-label={t('superagent.reportEvidence')}>{check.evidence.map((ref, j) => <li key={j}><code>{ref}</code></li>)}</ul>}
    </li>)}</ul></section>
    <section><h3>{t('superagent.reportArtifacts')}</h3>{report.artifacts.length
      ? <ul className={styles.artifacts}>{report.artifacts.map((item, i) => <li key={i}><span>{item.label}</span><code>{item.reference}</code></li>)}</ul>
      : <p className={styles.caption}>{t('superagent.reportNoArtifacts')}</p>}</section>
    <section><h3>{t('superagent.reportLimitations')}</h3>{report.limitations.length
      ? <ul>{report.limitations.map((item, i) => <li key={i}><MarkdownContent content={item} variant="conversation" /></li>)}</ul>
      : <p className={styles.caption}>{t('superagent.reportNoLimitations')}</p>}</section>
    {report.questions.length > 0 && <section className={styles.questions}><h3>{t('superagent.reportQuestions')}</h3><ol>{report.questions.map((item, i) => <li key={i}><MarkdownContent content={item} variant="conversation" /></li>)}</ol></section>}
    {report.details && <details className={styles.details}><summary>{t('superagent.reportExplanation')}</summary><MarkdownContent content={report.details} variant="conversation" /></details>}
  </div>
}
