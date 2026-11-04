import { Clock3 } from 'lucide-react'
import type { AutomationRun } from '../../../../shared/automations'
import { useI18n } from '@/i18n/useI18n'

export function AutomationTaskHistory({ runs, runId, setRunId, busy, cancel }: { runs: AutomationRun[]; runId: string | null; setRunId(id: string): void; busy: boolean; cancel(id: string): void }) {
  const { t } = useI18n('common'), current = runs.find(run => run.id === runId) ?? runs[0]
  return <section className="automation-history"><h3>{t('automations.history')}</h3>
    {!runs.length && <p className="automation-history-empty">{t('automations.noRuns')}</p>}
    <div className="automation-runs">{runs.map(run => <button className="automation-run" aria-pressed={current?.id === run.id} key={run.id} onClick={() => setRunId(run.id)}><Clock3 size={13} /><span>{new Date(run.startedAt).toLocaleString()}</span><span className="automation-status" data-state={run.state}>{t(`automations.${run.state}`)}</span></button>)}</div>
    {current && <article className="automation-report"><div className="automation-report-heading"><strong>{t(`automations.${current.state}`)}</strong>{['running', 'queued'].includes(current.state) && <button className="automation-text-button" disabled={busy} onClick={() => cancel(current.id)}>{t('automations.cancel')}</button>}</div>
      {current.reason && <p>{['no_changes', 'overlapping', 'missed'].includes(current.reason) ? t(`automations.${current.reason}`) : current.reason}</p>}
      {current.message && <p>{current.message}</p>}
      {current.cursor.commit && <code className="automation-commit">{current.cursor.commit.slice(0, 10)}{current.head && ` → ${current.head.slice(0, 10)}`}</code>}
      {current.tasks.map(step => { const kind = current.snapshot.tasks.find(item => item.id === step.id)?.kind ?? 'agent.internal'; return <div className="automation-task-result" key={step.id}><span>{t(kind.startsWith('agent.') ? 'automations.reviewTask' : kind === 'command' ? 'automations.checkTask' : `automations.${kind}`)}</span><span className="automation-status" data-state={step.state}>{t(`automations.${step.state}`)}</span></div> })}
      {current.report && <><p>{current.report.summary}</p><div className="automation-coverage"><span>{t('automations.coverage')} · {current.report.coveredFiles.length}/{current.report.files.length}</span><strong>{t(`automations.${current.report.verdict}`)}</strong></div>
        {current.report.skipped.length > 0 && <pre>{current.report.skipped.join('\n')}</pre>}{current.report.checks.map(check => <pre key={check.taskId}>{check.command}: {check.passed ? '✓' : '!'} {check.output}</pre>)}
        {current.report.findings.map((finding, index) => <div className="automation-finding" key={index} data-severity={finding.severity}><strong>{finding.severity} · {finding.path}:{finding.line}</strong><p>{finding.evidence}</p><p>{finding.suggestion}</p></div>)}
      </>}
    </article>}
  </section>
}
