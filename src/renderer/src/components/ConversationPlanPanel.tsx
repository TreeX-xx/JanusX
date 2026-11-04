import { useState } from 'react'
import { Check, ChevronRight, Circle, LoaderCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ConversationPlan, ConversationSnapshot } from '../../../shared/conversation-display'
import styles from './AgentSessionPane.module.css'

export function ConversationPlanPanel({ plan, connection, historical = false }: {
  plan: ConversationPlan; connection: ConversationSnapshot['connection']; historical?: boolean
}) {
  const { t } = useTranslation('terminal')
  const [expanded, setExpanded] = useState<boolean | null>(null)
  const done = plan.steps.filter(step => step.status === 'completed').length
  const allDone = plan.steps.length > 0 && done === plan.steps.length
  const running = !historical && !plan.stale && plan.outcome === 'running' && connection === 'ready'
  const open = expanded ?? (!historical && !allDone && plan.outcome === 'running')
  const current = plan.steps.find(step => step.status === 'inProgress')
  const status = !historical && plan.stale ? 'planUnavailable' : !historical && connection !== 'ready' && plan.outcome === 'running' ? 'planDisconnected'
    : plan.outcome === 'interrupted' ? 'planInterrupted' : plan.outcome === 'failed' ? 'planFailed'
      : plan.outcome === 'completed' && !allDone ? 'planIncomplete' : null
  return <section className={styles.plan} aria-label={t('conversation.planTitle')}>
    <button type="button" className={styles.planToggle} aria-expanded={open} onClick={() => setExpanded(!open)}>
      <ChevronRight size={14} style={{ transform: open ? 'rotate(90deg)' : undefined }} aria-hidden="true" />
      <span className={styles.planTitle}>{!open && running && current ? current.step : t('conversation.planTitle')}</span>
      <span>{t('conversation.planCount', { done, total: plan.steps.length })}</span>
      {historical && <span>v{plan.version}</span>}
    </button>
    {status && <p className={styles.planStatus}>{t(`conversation.${status}`)}</p>}
    {open && <div className={styles.planBody}>
      {plan.explanation && <p className={styles.planExplanation}>{plan.explanation}</p>}
      {!plan.steps.length && <p>{t('conversation.planCleared')}</p>}
      <ol>{plan.steps.map((step, index) => <li key={index} data-state={step.status}>
        {step.status === 'completed' ? <Check size={14} aria-hidden="true" /> : step.status === 'inProgress' && running
          ? <LoaderCircle size={14} className={styles.planSpinner} aria-hidden="true" /> : <Circle size={12} aria-hidden="true" />}
        <span>{step.step}</span><span className={styles.planStepState}>{t(`conversation.planStates.${step.status}`)}</span>
      </li>)}</ol>
    </div>}
  </section>
}
