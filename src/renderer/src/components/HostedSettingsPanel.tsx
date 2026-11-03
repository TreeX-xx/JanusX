import { SettingsCheckbox } from './ui/SettingsCheckbox'
import { useEffect, useState } from 'react'
import { useI18n } from '@/i18n/useI18n'
import {
  clearGitlabToken,
  getGitlabConfig,
  saveGitlabConfig,
  verifyGitlabConfig,
} from '@/services/hosted'
import styles from './NotificationSettingsPanel.module.css'

type StatusState = 'idle' | 'loading' | 'saving' | 'verifying' | 'saved' | 'error' | 'verified'

export function HostedSettingsPanel() {
  const { t } = useI18n('common')
  const [url, setUrl] = useState('')
  const [token, setToken] = useState('')
  const [allowInsecure, setAllowInsecure] = useState(false)
  const [timeoutSeconds, setTimeoutSeconds] = useState('30')
  const [tokenSource, setTokenSource] = useState<'keychain' | 'env' | 'none'>('none')
  const [status, setStatus] = useState<StatusState>('loading')
  const [message, setMessage] = useState('')
  const [verifiedName, setVerifiedName] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    getGitlabConfig()
      .then((config) => {
        if (cancelled) return
        setUrl(config.url)
        setAllowInsecure(config.allowInsecure)
        setTimeoutSeconds(String(Math.round(config.timeoutMs / 1000)))
        setTokenSource(config.tokenSource)
        setStatus('idle')
      })
      .catch((err) => {
        if (cancelled) return
        setMessage(err instanceof Error ? err.message : String(err))
        setStatus('error')
      })
    return () => {
      cancelled = true
    }
  }, [])

  const markDirty = () => {
    if (status === 'saved' || status === 'error' || status === 'verified') {
      setStatus('idle')
      setMessage('')
      setVerifiedName(null)
    }
  }

  const timeoutMs = () => {
    const seconds = Number(timeoutSeconds)
    return Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : 30000
  }

  const handleVerify = async () => {
    setStatus('verifying')
    setMessage('')
    setVerifiedName(null)
    try {
      const result = await verifyGitlabConfig({
        url,
        allowInsecure,
        timeoutMs: timeoutMs(),
        token: token.trim() || undefined,
      })
      if (result.ok) {
        setVerifiedName(result.username ?? null)
        setStatus('verified')
      } else {
        setMessage(result.error ?? '')
        setStatus('error')
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err))
      setStatus('error')
    }
  }

  const handleSave = async () => {
    setStatus('saving')
    setMessage('')
    try {
      const next = await saveGitlabConfig({
        url,
        allowInsecure,
        timeoutMs: timeoutMs(),
        token: token.trim() || undefined,
      })
      setUrl(next.url)
      setAllowInsecure(next.allowInsecure)
      setTimeoutSeconds(String(Math.round(next.timeoutMs / 1000)))
      setTokenSource(next.tokenSource)
      setToken('')
      setStatus('saved')
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err))
      setStatus('error')
    }
  }

  const handleClearToken = async () => {
    setStatus('saving')
    try {
      const next = await clearGitlabToken()
      setTokenSource(next.tokenSource)
      setToken('')
      setStatus('saved')
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err))
      setStatus('error')
    }
  }

  const busy = status === 'loading' || status === 'saving' || status === 'verifying'
  const tokenHint =
    tokenSource === 'env'
      ? t('common:hosted.tokenEnv')
      : tokenSource === 'keychain'
        ? t('common:hosted.tokenSaved')
        : t('common:hosted.tokenNone')
  const statusClass =
    status === 'error'
      ? `${styles.status} ${styles.statusError}`
      : status === 'saved' || status === 'verified'
        ? `${styles.status} ${styles.statusSuccess}`
        : styles.status
  const statusText =
    status === 'loading'
      ? t('common:hosted.loading')
      : status === 'saving'
        ? t('common:hosted.saving')
        : status === 'verifying'
          ? t('common:hosted.verifying')
          : status === 'verified' && verifiedName
            ? t('common:hosted.connectedAs', { name: verifiedName })
            : status === 'saved' && !message
              ? 'OK'
              : (message ?? '')

  return (
    <div className={styles.panel}>
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>{t('common:hosted.githubSection')}</h3>
        <p className={styles.hint}>{t('common:hosted.githubHint')}</p>
      </section>

      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>{t('common:hosted.gitlabSection')}</h3>

        <div className={styles.row}>
          <div className={styles.label}>
            <span className={styles.labelText}>{t('common:hosted.urlLabel')}</span>
          </div>
          <input
            value={url}
            placeholder={t('common:hosted.urlPlaceholder')}
            onChange={(event) => {
              setUrl(event.target.value)
              markDirty()
            }}
            disabled={busy}
            className={`${styles.input} ${styles.textInput}`}
          />
        </div>

        <div className={styles.row}>
          <div className={styles.label}>
            <span className={styles.labelText}>{t('common:hosted.tokenLabel')}</span>
            <span className={styles.hint}>{tokenHint}</span>
          </div>
          <input
            type="password"
            value={token}
            placeholder={t('common:hosted.tokenPlaceholder')}
            onChange={(event) => {
              setToken(event.target.value)
              markDirty()
            }}
            disabled={busy}
            className={`${styles.input} ${styles.textInput}`}
          />
        </div>

        <div className={styles.row}>
          <div className={styles.label}>
            <span className={styles.labelText}>{t('common:hosted.timeoutLabel')}</span>
          </div>
          <div className={styles.numberControl}>
            <input
              value={timeoutSeconds}
              inputMode="numeric"
              type="number"
              min={1}
              max={120}
              step={1}
              onChange={(event) => {
                setTimeoutSeconds(event.target.value)
                markDirty()
              }}
              disabled={busy}
              className={styles.input}
            />
            <span className={styles.unit}>s</span>
          </div>
        </div>

        <div className={styles.row}>
          <div className={styles.label}>
            <span className={styles.labelText}>{t('common:hosted.insecureLabel')}</span>
            <span className={styles.hint}>{t('common:hosted.insecureWarn')}</span>
          </div>
          <SettingsCheckbox aria-label={t('common:hosted.insecureLabel')}
              checked={allowInsecure}
              onChange={(event) => {
                setAllowInsecure(event.target.checked)
                markDirty()
              }}
              disabled={busy}
            />
        </div>
      </section>

      <div className={styles.footer}>
        <div className={statusClass}>{statusText}</div>
        <div className={styles.actions}>
          <button
            type="button"
            className={`${styles.button} ${styles.ghostButton}`}
            onClick={() => void handleVerify()}
            disabled={busy || !url.trim()}
          >
            {t('common:hosted.verify')}
          </button>
          {tokenSource === 'keychain' && (
            <button
              type="button"
              className={`${styles.button} ${styles.ghostButton}`}
              onClick={() => void handleClearToken()}
              disabled={busy}
            >
              {t('common:hosted.clearToken')}
            </button>
          )}
          <button
            type="button"
            className={`${styles.button} ${styles.primaryButton}`}
            onClick={() => void handleSave()}
            disabled={busy || !url.trim()}
          >
            {t('common:hosted.save')}
          </button>
        </div>
      </div>
    </div>
  )
}
