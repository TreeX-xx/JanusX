import { useState } from 'react'
import { Button } from '@janusx/ui'
import type { HostedConnection } from '../../../shared/ipc/hosted'
import { useI18n } from '@/i18n/useI18n'

/** Authorization stays in the user's CLI; the collaboration surface supplies the next step. */
export function HostedConnectionNotice({ connection, onRetry, onLogin, busy = false }: {
  connection: HostedConnection
  onRetry: () => void
  onLogin?: () => void
  busy?: boolean
}) {
  const { t } = useI18n('common')
  const [copied, setCopied] = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)
  const cli = connection.provider === 'github' ? 'gh' : 'glab'
  const platform = connection.provider === 'github' ? 'GitHub' : 'GitLab'
  const host = connection.provider === 'github' ? 'github.com' : 'gitlab.com'
  const command = cli + ' auth login --hostname ' + host + ' --web'
  const installUrl = connection.provider === 'github' ? 'https://cli.github.com/' : 'https://docs.gitlab.com/cli/'
  const message = connection.status === 'ready' ? t('common:hosted.connected', { platform })
    : connection.status === 'cli-missing' ? t('common:hosted.cliMissing', { cli })
      : connection.status === 'unauthenticated' ? t('common:hosted.loginRequired', { platform })
        : t('common:hosted.connectionFailed', { platform })

  return (
    <div style={{ fontSize: 11, color: 'var(--shell-muted)', lineHeight: 1.7 }}>
      <div role="status">{message}</div>
      {connection.status === 'error' && connection.error && <div role="alert">{connection.error}</div>}
      {(connection.status === 'cli-missing' || connection.status === 'unauthenticated') && (
        <>
          {connection.status === 'cli-missing' && <a href={installUrl} target="_blank" rel="noreferrer">{t('common:hosted.installCli', { cli })}</a>}
          {onLogin && connection.status === 'unauthenticated' ? <Button variant="secondary" onClick={onLogin}>{t('common:repository.signIn')}</Button> : <>
          <div>{t('common:hosted.loginHint')}</div>
          <code style={{ display: 'block', overflowWrap: 'anywhere', userSelect: 'text' }}>{command}</code>
          <Button variant="ghost" type="button" onClick={() => {
            setCopyFailed(false)
            void navigator.clipboard.writeText(command).then(() => setCopied(true)).catch(() => setCopyFailed(true))
          }}>{copied ? t('common:hosted.copied') : t('common:hosted.copyLogin')}</Button>
          {copyFailed && <div role="alert">{t('common:hosted.copyFailed')}</div>}
          </>}
        </>
      )}
      {connection.status !== 'ready' && <Button variant="ghost" type="button" disabled={busy} onClick={onRetry} style={{ marginLeft: 8 }}>{t('common:hosted.retry')}</Button>}
    </div>
  )
}
