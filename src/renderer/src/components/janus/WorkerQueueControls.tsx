import { useTranslation } from 'react-i18next'
import type { SuperAgentQueueControl, SuperAgentQueuePriority, SuperAgentScheduleEntry } from '../../../../shared/superagent-scheduling'
import styles from './SuperAgentWork.module.css'

export function WorkerQueueControls({ entry, busy, run }: {
  entry: SuperAgentScheduleEntry; busy: boolean; run(action: () => Promise<unknown>): Promise<void>
}) {
  const { t } = useTranslation('janus')
  const waiting = ['queued', 'paused'].includes(entry.status)
  if (!waiting) return null
  const change = (action: SuperAgentQueueControl['action'], priority?: SuperAgentQueuePriority) => {
    const target = { workspaceId: entry.workspaceId, workId: entry.workId, expectedVersion: entry.queueVersion ?? 0 }
    void run(() => window.electron.superAgent!.controlQueue(action === 'priority'
      ? { ...target, action, priority: priority! } : { ...target, action }))
  }
  return <div className={styles.queueControls} data-worker-queue="">
    <div className={styles.queueFacts} aria-live="polite">
      {entry.queuePosition !== undefined && <strong>{t('superagent.queue.position', { position: entry.queuePosition })}</strong>}
      <span>{t(`superagent.queue.reason.${entry.waitReason ?? (entry.status === 'paused' ? 'paused' : 'capacity')}`)}</span>
      {entry.status === 'queued' && entry.queuedAt !== undefined && <span>{t('superagent.queue.waited', { minutes: Math.floor(Math.max(0, Date.now() - entry.queuedAt) / 60000) })}</span>}
      {entry.effectivePriority && entry.effectivePriority !== (entry.priority ?? 'normal') && <span>{t('superagent.queue.promoted', { priority: t(`superagent.queue.priority.${entry.effectivePriority}`) })}</span>}
    </div>
    {!entry.occupiesSlot && <div className={styles.actions}>
      <select aria-label={t('superagent.queue.priorityLabel')} value={entry.priority ?? 'normal'} disabled={busy}
        onChange={event => change('priority', event.target.value as SuperAgentQueuePriority)}>
        {(['high', 'normal', 'background'] as const).map(priority => <option key={priority} value={priority}>{t(`superagent.queue.priority.${priority}`)}</option>)}
      </select>
      <button type="button" disabled={busy} onClick={() => change(entry.status === 'paused' ? 'resume' : 'pause')}>{t(entry.status === 'paused' ? 'superagent.queue.resume' : 'superagent.queue.pause')}</button>
      <button type="button" disabled={busy} onClick={() => change('cancel')}>{t('superagent.queue.cancel')}</button>
    </div>}
  </div>
}
