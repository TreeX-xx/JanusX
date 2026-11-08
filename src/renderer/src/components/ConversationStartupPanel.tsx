import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ShieldCheck, LogIn } from 'lucide-react'
import type { ConversationCommand, ConversationStartup } from '../../../shared/conversation-display'
import styles from './ConversationStartupPanel.module.css'

export function ConversationStartupPanel({ startup, epoch, busy, action, engine = 'Codex' }: {
  startup: ConversationStartup; epoch: number; busy: boolean; action: (command: ConversationCommand) => Promise<boolean>; engine?: string
}) {
  const { t } = useTranslation('terminal')
  const [apiKey, setApiKey] = useState('')
  const [error, setError] = useState('')
  const titleId = useId()
  const openRequested = useRef(false)
  const waiting = startup.status === 'waiting'
  const disabled = busy || startup.status === 'busy'
  const trust = startup.kind !== 'login'
  const hooks = startup.kind === 'hooks'
  const title = t(hooks ? 'conversation.startupHooksTitle' : trust ? 'conversation.startupTrustTitle' : 'conversation.startupLoginTitle')
  const send = async (choice: Extract<ConversationCommand, { type: 'startup' }>['action']) => {
    const key = choice === 'apiKey' ? apiKey : undefined
    openRequested.current = choice === 'login'
    setApiKey(''); setError('')
    if (!await action({ type: 'startup', startupId: startup.id, action: choice, controlEpoch: epoch, ...(key ? { apiKey: key } : {}) })) setError(t('conversation.startupActionError'))
  }
  const openLogin = useCallback(async () => {
    if (!startup.authUrl) return
    try { await window.electron.file.openPreviewLink(startup.authUrl) }
    catch { setError(t('conversation.startupBrowserError')) }
  }, [startup.authUrl, t])
  useEffect(() => {
    if (startup.authUrl && openRequested.current) { openRequested.current = false; void openLogin() }
  }, [startup.authUrl, openLogin])
  return <section className={styles.panel} aria-labelledby={titleId} aria-busy={disabled} data-conversation-startup={startup.kind}>
      <div className={styles.identity}>{trust ? <ShieldCheck size={16} aria-hidden="true" /> : <LogIn size={16} aria-hidden="true" />}<span>{engine}</span></div>
      <h2 id={titleId}>{title}</h2>
      <p>{t(hooks ? 'conversation.startupHooksHint' : trust ? 'conversation.startupTrustHint' : waiting ? 'conversation.startupWaitingHint' : 'conversation.startupLoginHint', { engine })}</p>
      {startup.directory && <code className={styles.directory}>{startup.directory}</code>}
      {hooks && <div className={styles.hooks}>{startup.hooks?.map(hook => <details key={hook.key}><summary>{hook.event}</summary><p>{hook.source}</p><pre>{hook.command}</pre></details>)}</div>}
      {!trust && !waiting && <details className={styles.keyDetails}><summary>{t('conversation.startupApiKey')}</summary><form onSubmit={event => { event.preventDefault(); if (!disabled && apiKey.trim()) void send('apiKey') }}>
        <div className={styles.keyRow}><input aria-label={t('conversation.startupApiKey')} type="password" autoComplete="off" spellCheck={false} value={apiKey} disabled={disabled} onChange={event => setApiKey(event.target.value)} />
          <button type="submit" disabled={disabled || !apiKey.trim()}>{t('conversation.startupUseKey')}</button></div>
      </form></details>}
      {(error || startup.error) && <p className={styles.error} role="alert">{error || startup.error}</p>}
      {disabled && <p role="status">{t('conversation.startupWorking')}</p>}
      <div className={styles.actions}>
        <button type="button" disabled={disabled} onClick={() => void send('cancel')}>{t('conversation.startupCancel')}</button>
        {trust && <button type="button" className={styles.primary} disabled={disabled} onClick={() => void send('trust')}>{t('conversation.startupTrust')}</button>}
        {!trust && !waiting && <button className={styles.primary} type="button" disabled={disabled} onClick={() => void send('login')}>{t('conversation.startupLogin')}</button>}
        {waiting && <><button type="button" disabled={disabled} onClick={() => void send('check')}>{t('conversation.startupCheck')}</button><button type="button" className={styles.primary} disabled={disabled} onClick={() => void openLogin()}>{t('conversation.startupOpenBrowser')}</button></>}
      </div>
  </section>
}
