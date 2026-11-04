import { CircleAlert, LoaderCircle, Unplug } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import styles from './ConversationNotice.module.css'

/** Native retry status is temporary; failed turns remain in their history position. */
export function ConversationNotice({ kind, message }: { kind: 'retry' | 'failure' | 'connection' | 'error'; message: string }) {
  const { t } = useTranslation('terminal')
  const retry = kind === 'retry'
  const count = retry ? message.match(/\b([1-9]\d{0,2})\s*\/\s*([1-9]\d{0,2})\b/) : null
  const Icon = retry ? LoaderCircle : kind === 'connection' ? Unplug : CircleAlert
  return <div className={styles.notice} data-kind={kind} data-conversation-notice={kind}>
    <div className={styles.heading} role={retry ? 'status' : 'alert'}>
      <Icon size={16} className={retry ? styles.spinner : undefined} aria-hidden="true" />
      <span>{t(`conversation.notice.${kind}`)}</span>
      {count && <span className={styles.count}>{count[1]}/{count[2]}</span>}
    </div>
    {!retry && <p className={styles.hint}>{t(`conversation.notice.${kind}Hint`)}</p>}
    <details className={styles.details}>
      <summary>{t('conversation.notice.details')}</summary>
      <pre>{message}</pre>
    </details>
  </div>
}
