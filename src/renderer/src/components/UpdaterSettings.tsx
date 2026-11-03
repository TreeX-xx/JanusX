import { SettingsCheckbox } from './ui/SettingsCheckbox'
import { useEffect, useState } from 'react'
import { useI18n } from '@/i18n/useI18n'
import { getUpdaterSettings, updateUpdaterSettings } from '@/services/updater-settings'
import { DEFAULT_UPDATER_SETTINGS, type UpdaterState } from '../../../shared/ipc/updater'
import { applyUpdaterEvent } from '@/lib/updater-badge'
import styles from './NotificationSettingsPanel.module.css'
import aboutStyles from './AboutSettingsPanel.module.css'

const UNSUPPORTED_KEY: Record<string, string> = {
  'non-windows-p0': 'settings:updater.unsupportedWin',
  'dev-mode': 'settings:updater.unsupportedDev',
  portable: 'settings:updater.unsupportedPortable',
}

/**
 * 设置中心关于页的应用更新区（Win P0）。
 * 自动检查只提示；用户分别点击下载和重启安装，失败后可重试。
 */
export function UpdaterSettings() {
  const { t } = useI18n('settings')
  const [state, setState] = useState<UpdaterState | null>(null)
  const [autoCheck, setAutoCheck] = useState(DEFAULT_UPDATER_SETTINGS.autoCheck)
  const [busy, setBusy] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const api = window.electron?.updater
    if (!api) return
    let disposed = false
    setBusy(true)
    Promise.all([getUpdaterSettings(), api.getState()]).then(([settings, initial]) => {
      if (disposed) return
      setAutoCheck(settings.autoCheck)
      setState(initial)
      setBusy(false)
    }).catch(() => {
      if (disposed) return
      setError(t('settings:updater.error.load'))
      setBusy(false)
    })
    const off = api.onEvent((event) => {
      if (!disposed) setState((prev) => applyUpdaterEvent(prev, event))
    })
    return () => {
      disposed = true
      off()
    }
  }, [t])

  const toggleAutoCheck = async (checked: boolean) => {
    if (!window.electron?.updater || saving) return
    setSaving(true)
    setError('')
    try {
      const next = await updateUpdaterSettings({ autoCheck: checked })
      setAutoCheck(next.autoCheck)
    } catch {
      setError(t('settings:updater.error.save'))
    } finally {
      setSaving(false)
    }
  }

  const check = async () => {
    const api = window.electron?.updater
    if (!api || busy) return
    setBusy(true)
    setError('')
    try {
      const next = await api.check()
      setState(next)
    } catch {
      setError(t('settings:updater.error.check'))
    } finally {
      setBusy(false)
    }
  }

  const download = async () => {
    const api = window.electron?.updater
    if (!api || busy) return
    setBusy(true)
    setError('')
    try {
      setState(await api.download())
    } catch {
      setError(t('settings:updater.error.download'))
    } finally {
      setBusy(false)
    }
  }

  const install = async () => {
    const api = window.electron?.updater
    if (!api || busy) return
    setBusy(true)
    setError('')
    try {
      const result = await api.install()
      if (!result.ok) setError(t('settings:updater.error.install'))
    } catch {
      setError(t('settings:updater.error.install'))
    } finally {
      setBusy(false)
    }
  }

  const openReleases = async () => {
    try {
      await window.electron?.updater.openReleases()
    } catch {
      /* 浏览器预览无主进程时由 fallback 的 window.open 兜底 */
    }
  }

  if (!window.electron?.updater) {
    return <div className={styles.status}>{t('settings:updater.unsupportedDev')}</div>
  }

  const unsupportedKey = state && !state.supported && state.unsupportedReason
    ? UNSUPPORTED_KEY[state.unsupportedReason]
    : null

  return (
    <div className={aboutStyles.updaterContent}>
      <div className={styles.status}>
        {t('settings:updater.currentVersion', { version: state?.currentVersion || '—' })}
      </div>
      <SettingSwitch
        label={t('settings:updater.autoCheck.label')}
        hint={t('settings:updater.autoCheck.hint')}
        checked={autoCheck}
        disabled={busy || saving || (state !== null && !state.supported)}
        onChange={(checked) => void toggleAutoCheck(checked)}
      />
      {unsupportedKey
        ? (
          <>
            <div className={styles.status}>{t(unsupportedKey)}</div>
            <div className={`${styles.testRow} ${aboutStyles.updaterActions}`}>
              <button
                type="button"
                className={`${styles.button} ${styles.ghostButton}`}
                onClick={() => void openReleases()}
              >
                {t('settings:updater.openReleases')}
              </button>
            </div>
          </>
        )
        : (
          <>
            <StatusLine state={state} />
            <div className={`${styles.testRow} ${aboutStyles.updaterActions}`}>
              <button
                type="button"
                className={`${styles.button} ${styles.ghostButton}`}
                onClick={() => void check()}
                disabled={busy || state?.phase === 'checking' || state?.phase === 'downloading'}
              >
                {state?.phase === 'checking' ? t('settings:updater.checking') : t('settings:updater.check')}
              </button>
              {state?.availableVersion && (state.phase === 'available' || state.phase === 'error') && (
                <button
                  type="button"
                  className={`${styles.button} ${styles.primaryButton}`}
                  onClick={() => void download()}
                  disabled={busy}
                >
                  {state.phase === 'error' ? t('settings:updater.retryDownload') : t('settings:updater.download')}
                </button>
              )}
              {state?.phase === 'downloaded' && (
                <button
                  type="button"
                  className={`${styles.button} ${styles.primaryButton}`}
                  onClick={() => void install()}
                  disabled={busy}
                >
                  {t('settings:updater.restart')}
                </button>
              )}
            </div>
          </>
        )}
      {error && <div className={`${styles.status} ${styles.statusError}`}>{error}</div>}
      {state?.error && <div className={`${styles.status} ${styles.statusError}`}>{t('settings:updater.error.update', { message: state.error })}</div>}
    </div>
  )
}

function StatusLine({ state }: { state: UpdaterState | null }) {
  const { t } = useI18n('settings')
  if (!state) return null
  switch (state.phase) {
    case 'up-to-date':
      return <div className={`${styles.status} ${styles.statusSuccess}`}>{t('settings:updater.upToDate')}</div>
    case 'available':
    case 'error':
      if (!state.availableVersion) return null
      return (
        <>
          <div className={styles.status}>{t('settings:updater.available', { version: state.availableVersion ?? '' })}</div>
          <ReleaseNotes notes={state.releaseNotes} />
        </>
      )
    case 'downloading':
      return (
        <div className={aboutStyles.downloadStatus}>
          <div className={styles.status} role="status">
            {state.downloadPercent === 100 ? t('settings:updater.verifying') : t('settings:updater.downloading', { percent: state.downloadPercent ?? 0 })}
          </div>
          <progress className={aboutStyles.downloadProgress} max={100} value={state.downloadPercent ?? 0} aria-label={t('settings:updater.download')} />
        </div>
      )
    case 'downloaded':
      return (
        <>
          <div className={`${styles.status} ${styles.statusSuccess}`}>{t('settings:updater.downloaded', { version: state.availableVersion ?? '' })}</div>
          <ReleaseNotes notes={state.releaseNotes} />
        </>
      )
    default:
      return null
  }
}

function ReleaseNotes({ notes }: { notes: string | null }) {
  const { t } = useI18n('settings')
  if (!notes) return null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div className={styles.hint}>{t('settings:updater.releaseNotes.label')}</div>
      <div className={styles.hint} style={{ maxHeight: 120, overflowY: 'auto', whiteSpace: 'pre-wrap' }}>{notes}</div>
    </div>
  )
}

function SettingSwitch({ label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string
  hint: string
  checked: boolean
  disabled?: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <div className={aboutStyles.updaterSwitch}>
      <div className={styles.label}>
        <span className={styles.labelText}>{label}</span>
        <span className={styles.hint}>{hint}</span>
      </div>
      <SettingsCheckbox
          aria-label={label}
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
        />
    </div>
  )
}
