import { useEffect, useState } from 'react'
import { Clock3, GitBranch } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { SuperAgentWorkerSnapshot } from '../../../../shared/superagent-worker'
import { ThemedTooltip } from '../ui/ThemedTooltip'
import { formatWorkerElapsed, workerTiming } from './workerPresentation'
import styles from './SuperAgentWork.module.css'

export function WorkerBranch({ branch, path }: { branch: string; path: string }) {
  const { t } = useTranslation('janus')
  return <ThemedTooltip placement="bottom" label={<span className={styles.branchDetails}><span>{t('superagent.workBranch')}</span><code>{branch}</code><span>{t('superagent.workDirectory')}</span><code>{path}</code></span>}>
    <span className={styles.workerBranch} tabIndex={0} aria-label={`${t('superagent.workBranch')}: ${branch}`}><GitBranch size={10} aria-hidden="true" /><span>{branch}</span></span>
  </ThemedTooltip>
}

/** Tick only this small label, preserving card focus and scroll positions. */
export function WorkerElapsed({ worker }: { worker?: SuperAgentWorkerSnapshot }) {
  const { t } = useTranslation('janus')
  const [now, setNow] = useState(Date.now)
  const timing = workerTiming(worker, now)
  const running = timing?.running
  useEffect(() => {
    setNow(Date.now())
    if (!running) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [running, worker?.executionId, worker?.conversation.turnStartedAt])
  if (!timing) return null
  const elapsed = formatWorkerElapsed(timing.seconds)
  return <span className={styles.workerElapsed} title={t('superagent.elapsedHint')}><Clock3 size={10} aria-hidden="true" /><time data-worker-elapsed="" dateTime={`PT${timing.seconds}S`} aria-label={t(timing.running ? 'superagent.elapsedRunning' : 'superagent.elapsedTotal', { time: elapsed })}>{elapsed}</time></span>
}
