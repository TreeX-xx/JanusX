import { useEffect, useId, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { CodexUpdateChoice, CodexUpdatePrompt } from '../../../shared/conversation-display'
import styles from './ConversationStartupPanel.module.css'

export function CodexUpdatePanel({ prompt, busy, focused, choose }: {
  prompt: CodexUpdatePrompt
  busy: boolean
  focused: boolean
  choose: (choice: CodexUpdateChoice) => void
}) {
  const { t } = useTranslation('terminal')
  const titleId = useId()
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    if (focused) heading.current?.focus({ preventScroll: true })
  }, [focused, prompt.id])

  return <section className={styles.panel} aria-labelledby={titleId}>
    <h2 id={titleId} ref={heading} tabIndex={-1}>{t('conversation.codexUpdateTitle')}</h2>
    {prompt.versions && <p>{t('conversation.codexUpdateVersions', prompt.versions)}</p>}
    {prompt.choice
      ? <p role="status">{t(prompt.choice === 'update' ? 'conversation.codexUpdating' : 'conversation.codexContinuing')}</p>
      : <div className={styles.actions}>
        <button type="button" className={styles.primary} disabled={busy} onClick={() => choose('update')}>{t('conversation.codexUpdateNow')}</button>
        <button type="button" disabled={busy} onClick={() => choose('skip')}>{t('conversation.codexSkipOnce')}</button>
        <button type="button" disabled={busy} onClick={() => choose('dismiss')}>{t('conversation.codexSkipVersion')}</button>
      </div>}
  </section>
}
