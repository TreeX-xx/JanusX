import type { ReactNode } from 'react'
import { Brain, ChevronRight, Code2, FileText, LoaderCircle, Search, Terminal, Wrench } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { ConversationDuration } from '../ConversationDuration'
import { useWorkDisclosure } from './WorkDisclosure'
import { toolAction } from './tool-presentation'
import './tool-disclosure.css'

const icons = { run: Terminal, edit: Code2, read: FileText, search: Search, think: Brain, tool: Wrench }

/** Shared HTML-derived tool row; adapters supply data and their own detail actions. */
export function ToolDisclosure({ stateKey, kind, target, status, statusLabel, startedAt, durationMs,
  children, defaultExpanded = false, className = '', summaryClassName = '', bodyClassName = '', callId, turnId }: {
  stateKey: string; kind: string; target: string; status: string; statusLabel: string
  startedAt?: number; durationMs?: number; children: ReactNode | (() => ReactNode)
  defaultExpanded?: boolean; className?: string; summaryClassName?: string; bodyClassName?: string
  callId?: string; turnId?: string
}) {
  const { t } = useTranslation('terminal')
  const [open, setOpen] = useWorkDisclosure(stateKey, defaultExpanded)
  const running = ['inProgress', 'running', 'requested'].includes(status)
  const action = toolAction(kind)
  const Icon = running ? LoaderCircle : icons[action]
  return <details className={`conversation-tool ${className}`} open={open} data-state={status}
    data-active={running || status === 'approval'} data-call-id={callId} data-turn={turnId}>
    <summary className={`conversation-tool-toggle ${summaryClassName}`} aria-expanded={open}
      onClick={event => { event.preventDefault(); setOpen(!open) }}>
      <Icon size={13} aria-hidden="true" className={running ? 'conversation-tool-spinner' : undefined} />
      <span className="conversation-tool-verb">{t(`conversation.toolAction.${action}`)}</span>
      <span className="conversation-tool-target" title={target}>{target}</span>
      <span className="conversation-tool-time" title={statusLabel}>
        {status === 'completed' && durationMs !== undefined
          ? <ConversationDuration durationMs={durationMs} />
          : <>{statusLabel}{running && startedAt !== undefined && <ConversationDuration startedAt={startedAt} />}</>}
      </span>
      <ChevronRight size={12} aria-hidden="true" className="conversation-tool-chevron" />
    </summary>
    {open && <div className={`conversation-tool-body ${bodyClassName}`}>
      {typeof children === 'function' ? children() : children}
    </div>}
  </details>
}
