import { type ReactNode } from 'react'
import { useHistoryDisclosure } from '../chat/VirtualHistory'
import { ChevronDown } from 'lucide-react'
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
  if (!enabled) return children
  return <details className="superagent-reply" open={open}>
    <summary onClick={event => { event.preventDefault(); setExpanded(!open) }}><ChevronDown size={12} aria-hidden="true" />
      <span>{open ? t(latest ? 'superagent.latestReply' : 'superagent.historyReply') : summary.replace(/\s+/g, ' ').slice(0,120) || t('superagent.historyReply')}</span>
    </summary>{children}
  </details>
}
