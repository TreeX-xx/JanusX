import type { ReactNode } from 'react'
import { useHistoryDisclosure } from './chat/VirtualHistory'
import { MarkdownContent } from './chat/ChatContent'
import { Check, ChevronRight, Circle, LoaderCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ConversationPlan, ConversationSnapshot } from '../../../shared/conversation-display'
import styles from './AgentSessionPane.module.css'

export function ConversationPlanPanel({ turnId, plan, document, connection, historical, workspacePath, readMore }: {
  turnId: string; plan?: ConversationPlan; document?: string; connection: ConversationSnapshot['connection']
  historical: boolean; workspacePath?: string; readMore?: ReactNode
}) {
  const { t } = useTranslation('terminal')
  const done = plan?.steps.filter(step => step.status === 'completed').length ?? 0
  const allDone = Boolean(plan?.steps.length && done === plan.steps.length)
  const running = !historical && !plan?.stale && plan?.outcome === 'running' && connection === 'ready'
  const [open, setExpanded] = useHistoryDisclosure(`plan:${turnId}`, !historical && !allDone)
  const current = plan?.steps.find(step => step.status === 'inProgress')
  const status = plan?.stale ? 'planUnavailable' : !historical && connection !== 'ready' && plan?.outcome === 'running' ? 'planDisconnected'
    : plan?.outcome === 'interrupted' ? 'planInterrupted' : plan?.outcome === 'failed' ? 'planFailed'
      : plan?.outcome === 'completed' && !allDone && plan.steps.length > 0 ? 'planIncomplete' : null
  const title = t('conversation.planTitle')
  return <section className={styles.plan} data-turn-plan={turnId} aria-label={title}>
    <button type="button" className={styles.planToggle} aria-expanded={open} onClick={() => setExpanded(!open)}>
      <ChevronRight size={14} style={{ transform: open ? 'rotate(90deg)' : undefined }} aria-hidden="true" />
      <span className={styles.planTitle}>{!open && running && current ? current.step : title}</span>
      {plan && <span>{t('conversation.planCount', { done, total: plan.steps.length })}</span>}
    </button>
    {status && <p className={styles.planStatus}>{t(`conversation.${status}`)}</p>}
    {open && <div className={styles.planBody}>
      {plan?.explanation && <p className={styles.planExplanation}>{plan.explanation}</p>}
      {plan && !plan.steps.length && <p>{t('conversation.planCleared')}</p>}
      {!!plan?.steps.length && <ol>{plan.steps.map((step, index) => <li key={index} data-state={step.status} data-current={running && step.status === 'inProgress'}>
        {step.status === 'completed' ? <Check size={14} aria-hidden="true" /> : step.status === 'inProgress' && running
          ? <LoaderCircle size={14} className={styles.planSpinner} aria-hidden="true" /> : <Circle size={12} aria-hidden="true" />}
        <span>{step.step}</span><span className={styles.planStepState}>{t(`conversation.planStates.${step.status}`)}</span>
      </li>)}</ol>}
      {document && <MarkdownContent content={document} workspacePath={workspacePath} variant="conversation" />}
      {readMore}
    </div>}
  </section>
}
