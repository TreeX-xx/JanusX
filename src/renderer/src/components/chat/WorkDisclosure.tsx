import { createContext, useContext, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { useHistoryDisclosure } from './VirtualHistory'
import { DisclosureReturn } from './DisclosureReturn'
import { ConversationDuration } from '../ConversationDuration'
import { Check, ChevronRight, CircleAlert, Clock, LoaderCircle, Square } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import './conversation-output.css'
import './work-disclosure.css'
import { toolAction } from './tool-presentation'
import type { WorkSummary } from '../../../../shared/work-output'

const WorkState = createContext<Map<string, boolean> | null>(null)
/** Keep choices when the live JanusX turn becomes a history row. */
export function WorkDisclosureScope({ children, scopeKey }: { children: ReactNode; scopeKey: string }) {
  const scope = useMemo(() => ({ key: scopeKey, choices: new Map<string, boolean>() }), [scopeKey])
  return <WorkState.Provider value={scope.choices}>{children}</WorkState.Provider>
}

/** A live tool moves into a different history row when its turn finishes. */
export function useWorkDisclosure(key: string, fallback: boolean) {
  const cache = useContext(WorkState)
  const [open, setOpen] = useHistoryDisclosure(key, cache?.get(key) ?? fallback)
  return [open, (value: boolean | ((previous: boolean) => boolean)) => {
    const next = typeof value === 'function' ? value(open) : value
    cache?.set(key, next)
    setOpen(next)
  }] as const
}

export function WorkDisclosure({ children, summary, settled, stateKey = 'work', activity }: {
  children: ReactNode | (() => ReactNode); summary: WorkSummary; settled?: boolean; stateKey?: string
  activity?: { text: string; kind?: string; startedAt?: number }
}) {
  const { t } = useTranslation('terminal')
  const [open, setExpanded] = useWorkDisclosure(`work:${stateKey}`, false)
  const [visited, setVisited] = useState(open)
  const bodyId = useId()
  const toggleRef = useRef<HTMLButtonElement>(null)
  const status = summary.waiting ? 'waiting' : summary.running ? 'running' : summary.unknown ? 'unknown' : summary.interrupted ? 'interrupted' : 'completed'
  const StatusIcon = summary.waiting ? Clock : summary.running ? LoaderCircle : summary.failed || summary.rejected || summary.unknown ? CircleAlert : summary.interrupted ? Square : Check
  return <div className="conversation-work" data-settled={settled} data-status={status}>
    <button ref={toggleRef} type="button" className="conversation-work-toggle" aria-expanded={open} aria-controls={bodyId}
      onClick={() => { setVisited(true); setExpanded(!open) }}>
      <ChevronRight size={13} aria-hidden="true" />
      <span className="conversation-work-copy">
      <span className="conversation-work-activity">
        {activity?.kind && <span className="conversation-work-verb">{t(`conversation.toolAction.${toolAction(activity.kind)}`)}</span>}
        <span className="conversation-work-preview" title={activity?.text}>{activity?.text || t(summary.running ? 'conversation.work.analyzing' : 'conversation.workLog')}</span>
      </span>
      <span className="conversation-work-meta">
      <span className="conversation-work-status"><StatusIcon size={11} aria-hidden="true" className={summary.running && !summary.waiting ? 'conversation-work-spinner' : undefined} />{t(`conversation.work.${status}`)}</span>
      <span className="conversation-work-count">{t('conversation.work.count', { count: summary.count })}</span>
      {activity?.startedAt !== undefined && <ConversationDuration startedAt={activity.startedAt} />}
      {summary.running > 1 && <span>{t('conversation.work.parallel', { count: summary.running - 1 })}</span>}
      {!!summary.failed && <span className="conversation-work-error">{t('conversation.work.failures', { count: summary.failed })}</span>}
      {!!summary.rejected && <span className="conversation-work-error">{t('conversation.work.rejections', { count: summary.rejected })}</span>}
      {!!summary.unknown && status !== 'unknown' && <span>{t('conversation.work.unknown')}</span>}
      {!!summary.interrupted && status !== 'interrupted' && <span>{t('conversation.work.interruptions', { count: summary.interrupted })}</span>}
      {summary.incomplete && <span>{t('conversation.work.incomplete')}</span>}
      </span></span>
    </button>
    {open && <DisclosureReturn toggleRef={toggleRef} />}
    <div id={bodyId} className="conversation-work-body" hidden={!open}>{open || visited ? typeof children === 'function' ? children() : children : null}</div>
  </div>
}
