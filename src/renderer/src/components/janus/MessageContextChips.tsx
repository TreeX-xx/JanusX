import { Code2, FileText, Folder } from 'lucide-react'
import type { MessageContext } from '../../../../shared/conversation-context'
import { workerShortcutLabel } from '../../../../shared/worker-shortcuts'
import { useTranslation } from 'react-i18next'
import { useContext } from 'react'
import { WorkerScheduleContext } from './WorkerScheduleContext'
import { WorkerShortcutIcon } from './WorkerShortcutIcon'

export function MessageContextChips({ context, hideReferences = false }: { context?: MessageContext; hideReferences?: boolean }) {
  const { t } = useTranslation('janus')
  const snapshot = useContext(WorkerScheduleContext)
  const target = context?.worker?.kind === 'worker' ? context.worker : undefined
  const schedule = target && snapshot?.workspaceId === target.workspaceId ? snapshot.entries.find(row => row.workId === target.workId) : undefined
  if (!context || ((!context.references.length || hideReferences) && !context.worker)) return null
  return <div className="janus-message-contexts">{context.worker && <span className="janus-message-context"><WorkerShortcutIcon target={context.worker} size={12} />{workerShortcutLabel(context.worker)}{context.worker.kind === 'worker' && ` · ${t(`shortcuts.${context.delivery ?? 'pending'}`)}`}{context.delivery === 'sent' && schedule && ` · ${schedule.queuePosition !== undefined ? t('superagent.queue.position', { position: schedule.queuePosition }) : t(`superagent.phase.${schedule.status}`)}`}</span>}{context.references.map(ref => <span key={ref.id} className="janus-message-context" title={ref.path + (ref.quote ? '\n' + ref.quote : '')}>
    {ref.quote ? <Code2 size={12} aria-hidden="true" /> : ref.kind === 'directory' ? <Folder size={12} aria-hidden="true" /> : <FileText size={12} aria-hidden="true" />}<span>{ref.name}</span>
  </span>).filter(() => !hideReferences)}</div>
}
