// Note: .agents/notes/workbench/service-integrations.md — settings layout and managed CPA lifecycle.
import { useEffect, useId, useState } from 'react'
import { Copy, Eye, EyeOff, FileText, Play, RotateCw, Shuffle, Square } from 'lucide-react'
import { Select, ThemedTooltip } from './controls'
import { useCpaStore } from './store'
import { api, cpa } from './bridge'
import { useI18n, cpaError } from './i18n'
import { normalizeCpaSettings, validateCpaManagementKey } from '../shared/cpa'
import formStyles from './forms.module.css'
import styles from './CpaSettingsPanel.module.css'

export function CpaSettingsPanel({ onOpened }: { onOpened?: () => void }) {
  const { t } = useI18n('common')
  const fieldId = useId()
  const settings = useCpaStore((state) => state.settings)
  const status = useCpaStore((state) => state.status)
  const [draft, setDraft] = useState(settings?.managementUrl ?? '')
  const [mode, setMode] = useState<'managed' | 'external'>(settings?.mode ?? 'managed')
  const [enabled, setEnabled] = useState(settings?.enabled ?? false)
  const [port, setPort] = useState(String(settings?.port ?? 8317))
  const [autoUpdate, setAutoUpdate] = useState(settings?.autoUpdate ?? true)
  const [managementKey, setManagementKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [keySaved, setKeySaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const edit = () => { setSaved(false); setKeySaved(false); setError(null); setNotice(null) }

  useEffect(() => {
    let disposed = false
    void useCpaStore.getState().load().catch(() => { if (!disposed) setError(t('common:cpa.settingsFailed')) })
    return () => { disposed = true }
  }, [t])
  useEffect(() => {
    if (!settings) return
    setDraft(settings.managementUrl); setMode(settings.mode ?? 'external'); setPort(String(settings.port ?? 8317))
    setEnabled(settings.enabled ?? false); setAutoUpdate(settings.autoUpdate ?? true)
  }, [settings])
  useEffect(() => {
    if (mode !== 'managed') return
    const poll = () => { void useCpaStore.getState().refreshStatus().catch(() => {}) }
    poll()
    const timer = setInterval(poll, 1000)
    return () => clearInterval(timer)
  }, [mode])

  const save = async (open: boolean) => {
    setError(null)
    setSaved(false)
    setKeySaved(false)
    setNotice(null)
    let next
    try { next = normalizeCpaSettings({ mode, enabled, port: Number(port), autoUpdate, managementUrl: draft }) }
    catch { setError(mode === 'managed' ? t('common:cpa.invalidPort') : t('common:cpa.invalidUrl')); return }
    const key = mode === 'managed' && managementKey !== '' ? managementKey : undefined
    try { if (key !== undefined) validateCpaManagementKey(key) }
    catch { setError(t('common:cpa.invalidKey')); return }
    setBusy(true)
    try {
      await useCpaStore.getState().save(next, key)
      setManagementKey(''); setShowKey(false); setKeySaved(key !== undefined)
      setSaved(true)
      if (open) {
        await api.views.open({ view: 'management' })
        onOpened?.()
      }
    } catch (failure) { setError(operationError(failure)) }
    finally { setBusy(false) }
  }

  const operationError = cpaError
  const operate = async (action: 'start' | 'stop' | 'restart' | 'update' | 'copyManagementKey' | 'openLogs') => {
    setBusy(true); setError(null); setNotice(null)
    try {
      if (action === 'copyManagementKey' || action === 'openLogs') {
        await cpa[action]()
        if (action === 'copyManagementKey') setNotice(t('common:cpa.keyCopied'))
      } else await useCpaStore.getState().operate(action)
    } catch (failure) { setError(operationError(failure)) }
    finally { setBusy(false) }
  }

  const canOperate = settings?.mode === 'managed' && settings.enabled
  const running = status?.phase === 'running'
  const canStop = running || status?.phase === 'starting' || status?.phase === 'downloading'
  const runtimeError = mode === 'managed' && (status?.error || status?.updateError || status?.operationError)
  const failure = error ?? (runtimeError ? operationError(new Error(runtimeError)) : null)
  const buttonClass = `${formStyles.button} ${formStyles.ghostButton}`

  return <section className={styles.panel} aria-label={t('common:cpa.title')} data-cpa-settings>
    <header className={styles.intro}>
      <h3>CPA <span>CLIProxyAPI</span></h3>
      <p className={formStyles.hint}>{t('common:cpa.description')}</p>
    </header>

    <div className={styles.group}>
      <div className={styles.fieldRow}>
        <span className={formStyles.labelText}>{t('common:cpa.mode')}</span>
        <Select role="combobox" ariaLabel={t('common:cpa.mode')} value={mode} disabled={busy} className={styles.select}
          options={[{ value: 'managed', label: t('common:cpa.managed') }, { value: 'external', label: t('common:cpa.external') }]}
          onChange={(value) => { setMode(value as 'managed' | 'external'); setManagementKey(''); setShowKey(false); edit() }} />
      </div>
      {mode === 'managed' ? <>
        <SettingToggle label={t('common:cpa.enableManaged')} hint={t('common:cpa.managedHelp')}
          checked={enabled} disabled={busy} onChange={(value) => { setEnabled(value); edit() }} />
        <div className={styles.fieldRow}>
          <div className={formStyles.label}>
            <label className={formStyles.labelText} htmlFor={`${fieldId}-port`}>{t('common:cpa.port')}</label>
            <p className={formStyles.hint} id={`${fieldId}-port-help`}>{t('common:cpa.portHelp')}</p>
          </div>
          <input className={`${formStyles.input} ${styles.port}`} id={`${fieldId}-port`} aria-describedby={`${fieldId}-port-help`}
            type="number" min={1024} max={65535} value={port} disabled={busy} onChange={(event) => { setPort(event.target.value); edit() }} />
        </div>
      </> : <div className={styles.addressRow}>
        <div className={formStyles.label}>
          <label className={formStyles.labelText} htmlFor={`${fieldId}-address`}>{t('common:cpa.managementUrl')}</label>
          <p className={formStyles.hint} id={`${fieldId}-address-help`}>{t('common:cpa.addressHelp')}</p>
        </div>
        <input className={`${formStyles.input} ${styles.address}`} id={`${fieldId}-address`} aria-describedby={`${fieldId}-address-help`}
          value={draft} spellCheck={false} placeholder="http://127.0.0.1:8317/management.html"
          disabled={busy} onChange={(event) => { setDraft(event.target.value); edit() }} />
        <p className={formStyles.hint}>{t('common:cpa.loginHelp')}</p>
      </div>}
    </div>

    {mode === 'managed' && <>
      <div className={styles.group}>
        <div className={styles.keyRow}>
          <div className={formStyles.label}>
            <label className={formStyles.labelText} htmlFor={`${fieldId}-key`}>{t('common:cpa.managementKey')}</label>
            <p className={formStyles.hint} id={`${fieldId}-key-help`}>{t('common:cpa.keyHelp')}</p>
          </div>
          <div className={styles.keyControl}>
            <div className={styles.keyInput}>
              <input className={`${formStyles.input} ${styles.input}`} id={`${fieldId}-key`} aria-describedby={`${fieldId}-key-help`}
                type={showKey ? 'text' : 'password'} value={managementKey} disabled={busy} autoComplete="new-password" spellCheck={false}
                maxLength={128} placeholder={t('common:cpa.keyPlaceholder')}
                onChange={(event) => { setManagementKey(event.target.value); edit() }} />
              <ThemedTooltip label={showKey ? t('common:cpa.hideKey') : t('common:cpa.showKey')}>
                <button type="button" className={styles.iconButton} aria-label={showKey ? t('common:cpa.hideKey') : t('common:cpa.showKey')}
                  disabled={busy} onClick={() => setShowKey((value) => !value)}>
                  {showKey ? <EyeOff size={14} aria-hidden="true" /> : <Eye size={14} aria-hidden="true" />}
                </button>
              </ThemedTooltip>
              <ThemedTooltip label={t('common:cpa.generateKey')}>
                <button type="button" className={styles.iconButton} aria-label={t('common:cpa.generateKey')} disabled={busy} onClick={() => {
                  const bytes = crypto.getRandomValues(new Uint8Array(32))
                  setManagementKey(Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join(''))
                  edit()
                }}><Shuffle size={14} aria-hidden="true" /></button>
              </ThemedTooltip>
            </div>
            {canOperate && <button type="button" className={`${buttonClass} ${styles.copyButton}`} disabled={busy} onClick={() => void operate('copyManagementKey')}>
              <Copy size={13} aria-hidden="true" />{t('common:cpa.copyKey')}
            </button>}
          </div>
        </div>
      </div>

      <div className={styles.group}>
        <SettingToggle label={t('common:cpa.autoUpdate')} hint={t('common:cpa.updateHelp')}
          checked={autoUpdate} disabled={busy} onChange={(value) => { setAutoUpdate(value); edit() }} />
        {canOperate && <div className={styles.updateActions}>
          {status?.pendingVersion && <p className={formStyles.hint}>{t('common:cpa.updateReady')}: {status.pendingVersion}</p>}
          <button type="button" className={buttonClass} disabled={busy} onClick={() => void operate('update')}>
            <RotateCw size={13} aria-hidden="true" />{t('common:cpa.updateNow')}
          </button>
        </div>}
      </div>

      <div className={styles.group}>
        <div className={styles.runtimeRow}>
          <span className={formStyles.labelText}>{t('common:cpa.runtimeStatus')}</span>
          {status && <div className={styles.runtimeInfo} role="status">
            {status.version && <span className={styles.version}>{status.version}</span>}
            <span className={styles.phase} data-phase={status.phase}>{t(`common:cpa.phase.${status.phase}`)}{status.progress !== undefined && ` · ${status.progress}%`}</span>
          </div>}
        </div>
        {canOperate && <div className={styles.runtimeActions}>
          {canStop
            ? <button type="button" className={buttonClass} onClick={() => void operate('stop')}><Square size={12} aria-hidden="true" />{t('common:cpa.stop')}</button>
            : <button type="button" className={buttonClass} disabled={busy} onClick={() => void operate('start')}><Play size={13} aria-hidden="true" />{t('common:cpa.start')}</button>}
          <button type="button" className={buttonClass} disabled={busy || !running} onClick={() => void operate('restart')}><RotateCw size={13} aria-hidden="true" />{t('common:cpa.restart')}</button>
          <button type="button" className={`${buttonClass} ${styles.logsButton}`} disabled={busy} onClick={() => void operate('openLogs')}><FileText size={13} aria-hidden="true" />{t('common:cpa.logs')}</button>
        </div>}
      </div>
    </>}

    <p className={formStyles.hint}>{t('common:cpa.quotaHelp')}</p>
    <div className={styles.feedback} aria-live="polite">
      {saved && <p className={styles.success} role="status">{keySaved ? t('common:cpa.keySaved') : t('common:cpa.saved')}</p>}
      {notice && <p className={styles.success} role="status">{notice}</p>}
      {failure && <p className={styles.error} role="alert">{failure}</p>}
    </div>
    <footer className={styles.footer}>
      <button type="button" className={buttonClass} disabled={busy || !settings} onClick={() => void save(false)}>{settings?.mode === 'managed' && running && (Number(port) !== settings.port || mode !== settings.mode || !enabled || managementKey !== '') ? t('common:cpa.saveRestart') : t('common:action.save')}</button>
      <button type="button" className={`${formStyles.button} ${formStyles.primaryButton}`} disabled={busy || !settings || mode === 'managed' && !enabled} onClick={() => void save(true)}>{t('common:cpa.saveAndOpen')}</button>
    </footer>
  </section>
}

function SettingToggle({ label, hint, checked, disabled, onChange }: {
  label: string; hint: string; checked: boolean; disabled: boolean; onChange: (checked: boolean) => void
}) {
  return <div className={formStyles.row}>
    <div className={formStyles.label}>
      <span className={formStyles.labelText}>{label}</span>
      <p className={formStyles.hint}>{hint}</p>
    </div>
    <label className={formStyles.switch}>
      <input type="checkbox" aria-label={label} checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
      <span className={formStyles.switchTrack} aria-hidden="true" />
    </label>
  </div>
}
