import { useId, type ReactNode } from 'react'
import { useHistoryDisclosure } from '../chat/VirtualHistory'
import { ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { JanusChatMessage } from '../../../../shared/ipc/janus-chat'

/** Consecutive inputs (including steering) share the reply that follows them. */
export function messageRounds(messages: JanusChatMessage[]) {
  const rounds = new Map<string, { id: string; inputIds: string[] }>()
  let round: { id: string; inputIds: string[] } | undefined, answered = false
  for (const message of messages) {
    if (message.id.startsWith('worker-report:')) continue
    if (message.role === 'user') {
      if (!round || answered) round = { id: message.id, inputIds: [] }
      round.inputIds.push(message.id); answered = false
    } else answered = true
    if (round) rounds.set(message.id, round)
  }
  return rounds
}

export function SuperAgentReply({ enabled, latest, summary, children }: { enabled: boolean; latest: boolean; summary: string; children: ReactNode }) {
  const [open, setExpanded] = useHistoryDisclosure('reply', latest), { t } = useTranslation('janus')
  const bodyId = useId()
  if (!enabled) return children
  return <details className="superagent-reply" open={open}>
    <summary aria-expanded={open} aria-controls={bodyId} onClick={event => { event.preventDefault(); setExpanded(!open) }}>
      <ChevronRight size={13} aria-hidden="true" />
      <span className="superagent-reply-label">{t(latest ? 'superagent.latestReply' : 'superagent.historyReply')}</span>
      <span className="superagent-reply-preview" aria-hidden="true">{summary.replace(/\s+/g, ' ').slice(0, 120)}</span>
      <span className="superagent-reply-action">{t(open ? 'superagent.collapseReply' : 'superagent.expandReply')}</span>
    </summary><div id={bodyId} aria-hidden={!open} {...(!open ? { inert: '' } : {})}>{children}</div>
  </details>
}
