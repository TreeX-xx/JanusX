import { LazyDetails, useHistoryDisclosure } from './chat/VirtualHistory'
import { Check, ChevronRight, Circle, LoaderCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ConversationPlan, ConversationSnapshot } from '../../../shared/conversation-display'
import { compactConversationPlans } from '../../../shared/conversation-plans'
import styles from './AgentSessionPane.module.css'

export function ConversationPlanPanel({ plan, connection, historical = false, previous = false }: {
  plan: ConversationPlan; connection: ConversationSnapshot['connection']; historical?: boolean; previous?: boolean
}) {
  const { t } = useTranslation('terminal')
  const done = plan.steps.filter(step => step.status === 'completed').length
  const allDone = plan.steps.length > 0 && done === plan.steps.length
  const running = !historical && !plan.stale && plan.outcome === 'running' && connection === 'ready'
  const [open, setExpanded] = useHistoryDisclosure(`plan:${plan.turnId}:${historical ? plan.version : 'current'}`, !historical && !allDone && plan.outcome === 'running')
  const current = plan.steps.find(step => step.status === 'inProgress')
  const status = plan.stale ? 'planUnavailable' : !historical && connection !== 'ready' && plan.outcome === 'running' ? 'planDisconnected'
    : plan.outcome === 'interrupted' ? 'planInterrupted' : plan.outcome === 'failed' ? 'planFailed'
      : plan.outcome === 'completed' && !allDone ? 'planIncomplete' : null
  const title = t(previous ? 'conversation.planPrevious' : 'conversation.planTitle')
  return <section className={styles.plan} aria-label={title}>
    <button type="button" className={styles.planToggle} aria-expanded={open} onClick={() => setExpanded(!open)}>
      <ChevronRight size={14} style={{ transform: open ? 'rotate(90deg)' : undefined }} aria-hidden="true" />
      <span className={styles.planTitle}>{!open && running && current ? current.step : title}</span>
      <span>{t('conversation.planCount', { done, total: plan.steps.length })}</span>
    </button>
    {status && <p className={styles.planStatus}>{t(`conversation.${status}`)}</p>}
    {open && <div className={styles.planBody}>
      {plan.explanation && <p className={styles.planExplanation}>{plan.explanation}</p>}
      {!plan.steps.length && <p>{t('conversation.planCleared')}</p>}
      <ol>{plan.steps.map((step, index) => <li key={index} data-state={step.status} data-current={running && step.status === 'inProgress'}>
        {step.status === 'completed' ? <Check size={14} aria-hidden="true" /> : step.status === 'inProgress' && running
          ? <LoaderCircle size={14} className={styles.planSpinner} aria-hidden="true" /> : <Circle size={12} aria-hidden="true" />}
        <span>{step.step}</span><span className={styles.planStepState}>{t(`conversation.planStates.${step.status}`)}</span>
      </li>)}</ol>
    </div>}
  </section>
}

export function ConversationPlanHistory({ plans, connection, activeTurnId }: {
  plans: ConversationPlan[]; connection: ConversationSnapshot['connection']; activeTurnId?: string | null
}) {
  const { t } = useTranslation('terminal')
  const turns = new Map<string, ConversationPlan[]>()
  for (const plan of compactConversationPlans(plans)) {
    const revisions = turns.get(plan.turnId) ?? []
    revisions.push(plan); turns.set(plan.turnId, revisions)
  }
  return [...turns].map(([turnId, revisions]) => {
    const latest = revisions.at(-1)!, earlier = revisions.slice(0, -1)
    const historical = turnId !== activeTurnId
    if (!historical && !earlier.length) return null
    return <div key={turnId} className={styles.planGroup} data-plan-turn={turnId}>
      {historical && <ConversationPlanPanel plan={latest} connection={connection} historical />}
      {!!earlier.length && <LazyDetails stateKey={`plan-changes:${turnId}`} className={styles.planHistory} data-plan-history={turnId}
        summary={<summary><ChevronRight size={14} className={styles.chevron} aria-hidden="true" /><span>{t('conversation.planChanges')}</span><span className={styles.planVersionCount}>{earlier.length}</span></summary>}>
        {() => earlier.map(plan => <ConversationPlanPanel key={`${turnId}:${plan.version}`} plan={plan} connection={connection} historical previous />)}
      </LazyDetails>}
    </div>
  })
}
