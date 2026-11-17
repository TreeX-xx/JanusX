import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import styles from './ChatErrorCard.module.css'

/** Shared error presentation for SuperAgent and conversation composer feedback. */
export function ChatErrorCard({ message, status, actions, onDismiss }: {
  message: string
  status?: ReactNode
  actions?: ReactNode
  onDismiss?(): void
}) {
  const { t } = useTranslation('common')
  return <div className={`janus-chat-error-card ${styles.card}`} data-chat-error-card>
    {status}
    <div className={styles.text} role="alert">{message}</div>
    {(actions || onDismiss) && <div className={styles.actions}>
      {actions}
      {onDismiss && <button type="button" onClick={onDismiss}>{t('action.close')}</button>}
    </div>}
  </div>
}
