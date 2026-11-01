import { useState } from 'react'
import { Check, Copy, Pencil } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ConversationItem } from '../../../shared/conversation-display'
import styles from './AgentSessionPane.module.css'
import { ConversationDuration } from './ConversationDuration'

export function ConversationMessageActions({ item, onEdit, editDisabled }: { item: ConversationItem; onEdit?: () => void; editDisabled?: boolean }) {
  const { t, i18n } = useTranslation('terminal')
  const [copied, setCopied] = useState(false)
  const [failed, setFailed] = useState(false)
  const date = item.receivedAt ? new Date(item.receivedAt) : null
  return <div className={styles.messageActions}>
    <button type="button" title={t(copied ? 'conversation.copiedMessage' : 'conversation.copyMessage')} aria-label={t(copied ? 'conversation.copiedMessage' : 'conversation.copyMessage')} onBlur={() => setCopied(false)} onClick={async () => {
      try { await navigator.clipboard.writeText(item.text); setCopied(true); setFailed(false) }
      catch { setFailed(true) }
    }}>{copied ? <Check size={14} /> : <Copy size={14} />}</button>
    {onEdit && <button type="button" data-message-edit title={t('conversation.editMessageHint')} aria-label={t('conversation.editMessage')} disabled={editDisabled} onClick={onEdit}><Pencil size={14} /></button>}
    {date && Number.isFinite(date.getTime()) && <time dateTime={date.toISOString()} title={date.toLocaleString(i18n.language)}>{date.toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' })}</time>}
    {item.durationMs !== undefined && <><span aria-hidden="true">·</span><ConversationDuration durationMs={item.durationMs} /></>}
    {failed && <span role="alert">{t('conversation.copyMessageFailed')}</span>}
  </div>
}
