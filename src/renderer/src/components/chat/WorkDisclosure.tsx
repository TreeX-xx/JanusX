import { createContext, useContext, useId, useMemo, useState, type ReactNode } from 'react'
import { useHistoryDisclosure } from './VirtualHistory'
import { ConversationDuration } from '../ConversationDuration'
import { ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import './conversation-output.css'
import './work-disclosure.css'
import type { WorkSummary } from '../../../../shared/work-output'

const WorkState = createContext<Map<string, boolean> | null>(null)
/** Keep choices when the live JanusX turn becomes a history row. */
export function WorkDisclosureScope({ children, scopeKey }: { children: ReactNode; scopeKey: string }) {
  const scope = useMemo(() => ({ key: scopeKey, choices: new Map<string, boolean>() }), [scopeKey])
  return <WorkState.Provider value={scope.choices}>{children}</WorkState.Provider>
}

export function WorkDisclosure({ children, summary, settled, stateKey = 'work', activity }: {
  children: ReactNode | (() => ReactNode); summary: WorkSummary; settled?: boolean; stateKey?: string
  activity?: { text: string; startedAt?: number }
}) {
  const { t } = useTranslation('terminal')
  const cache = useContext(WorkState)
  const [open, setExpanded] = useHistoryDisclosure(`work:${stateKey}`, cache?.get(stateKey) ?? false)
  const [visited, setVisited] = useState(open)
  const bodyId = useId()
  const status = summary.waiting ? 'waiting' : summary.running ? 'running' : summary.unknown ? 'unknown' : summary.interrupted ? 'interrupted' : 'completed'
  return <div className="conversation-work" data-settled={settled} data-status={status}>
    <button type="button" className="conversation-work-toggle" aria-expanded={open} aria-controls={bodyId}
      onClick={() => { cache?.set(stateKey, !open); setVisited(true); setExpanded(!open) }}>
      <ChevronRight size={14} aria-hidden="true" />
      <span className="conversation-work-preview" title={activity?.text}>{activity?.text || t(summary.running ? 'conversation.work.analyzing' : 'conversation.workLog')}</span>
      {activity?.startedAt !== undefined && <ConversationDuration startedAt={activity.startedAt} />}
      <span className="conversation-work-status">{t(`conversation.work.${status}`)}</span>
      <span className="conversation-work-count">{t('conversation.work.count', { count: summary.count })}</span>
      {summary.running > 1 && <span>{t('conversation.work.parallel', { count: summary.running - 1 })}</span>}
      {!!summary.failed && <span>{t('conversation.work.failures', { count: summary.failed })}</span>}
      {!!summary.rejected && <span>{t('conversation.work.rejections', { count: summary.rejected })}</span>}
      {!!summary.unknown && status !== 'unknown' && <span>{t('conversation.work.unknown')}</span>}
      {!!summary.interrupted && status !== 'interrupted' && <span>{t('conversation.work.interruptions', { count: summary.interrupted })}</span>}
      {summary.incomplete && <span>{t('conversation.work.incomplete')}</span>}
    </button>
    <div id={bodyId} className="conversation-work-body" hidden={!open}>{open || visited ? typeof children === 'function' ? children() : children : null}</div>
  </div>
}
