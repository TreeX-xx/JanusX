import { InputGroup } from '@janusx/ui'
import { SettingsSurface, SettingsSection, SettingsFooter, SettingsRow, Input as SettingsInput, Button as SettingsButton, SettingsCheckbox } from '@janusx/ui'
// Note: .agents/notes/workbench/service-integrations.md — settings layout and managed CPA lifecycle.
import { useEffect, useId, useState } from 'react'
import { Copy, Eye, EyeOff, FileText, Play, RotateCw, Shuffle, Square } from 'lucide-react'
import { Select, ThemedTooltip } from './controls'
import { useCpaStore } from './store'
import { api, cpa } from './bridge'
import { useI18n, cpaError } from './i18n'
import { normalizeCpaSettings, validateCpaManagementKey } from '../shared/cpa'
import { settingsStyles as formStyles } from '@janusx/ui'
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

  return <SettingsSurface as="section" className={styles.panel} aria-label={t('common:cpa.title')} data-cpa-settings>
    <header className={styles.intro}>
      <h3>CPA <span>CLIProxyAPI</span></h3>
      <p className={formStyles.hint}>{t('common:cpa.description')}</p>
    </header>

    <SettingsSection className={styles.group}>
      <SettingsRow className={styles.fieldRow}>
        <span className={formStyles.labelText}>{t('common:cpa.mode')}</span>
        <Select role="combobox" ariaLabel={t('common:cpa.mode')} value={mode} disabled={busy} className={styles.select}
          options={[{ value: 'managed', label: t('common:cpa.managed') }, { value: 'external', label: t('common:cpa.external') }]}
          onChange={(value) => { setMode(value as 'managed' | 'external'); setManagementKey(''); setShowKey(false); edit() }} />
      </SettingsRow>
      {mode === 'managed' ? <>
        <SettingToggle label={t('common:cpa.enableManaged')} hint={t('common:cpa.managedHelp')}
          checked={enabled} disabled={busy} onChange={(value) => { setEnabled(value); edit() }} />
        <SettingsRow className={styles.fieldRow}>
          <div className={formStyles.label}>
            <label className={formStyles.labelText} htmlFor={`${fieldId}-port`}>{t('common:cpa.port')}</label>
            <p className={formStyles.hint} id={`${fieldId}-port-help`}>{t('common:cpa.portHelp')}</p>
          </div>
          <SettingsInput className={`${formStyles.input} ${styles.port}`} id={`${fieldId}-port`} aria-describedby={`${fieldId}-port-help`}
            type="number" min={1024} max={65535} value={port} disabled={busy} onChange={(event) => { setPort(event.target.value); edit() }} />
        </SettingsRow>
      </> : <div className={styles.addressRow}>
        <div className={formStyles.label}>
          <label className={formStyles.labelText} htmlFor={`${fieldId}-address`}>{t('common:cpa.managementUrl')}</label>
          <p className={formStyles.hint} id={`${fieldId}-address-help`}>{t('common:cpa.addressHelp')}</p>
        </div>
        <SettingsInput className={`${formStyles.input} ${styles.address}`} id={`${fieldId}-address`} aria-describedby={`${fieldId}-address-help`}
          value={draft} spellCheck={false} placeholder="http://127.0.0.1:8317/management.html"
          disabled={busy} onChange={(event) => { setDraft(event.target.value); edit() }} />
        <p className={formStyles.hint}>{t('common:cpa.loginHelp')}</p>
      </div>}
    </SettingsSection>

    {mode === 'managed' && <>
      <SettingsSection className={styles.group}>
        <div className={styles.keyRow}>
          <div className={formStyles.label}>
            <label className={formStyles.labelText} htmlFor={`${fieldId}-key`}>{t('common:cpa.managementKey')}</label>
            <p className={formStyles.hint} id={`${fieldId}-key-help`}>{t('common:cpa.keyHelp')}</p>
          </div>
          <div className={styles.keyControl}>
            <InputGroup className={styles.keyInput}>
              <SettingsInput className={`${formStyles.input} ${styles.input}`} id={`${fieldId}-key`} aria-describedby={`${fieldId}-key-help`}
                type={showKey ? 'text' : 'password'} value={managementKey} disabled={busy} autoComplete="new-password" spellCheck={false}
                maxLength={128} placeholder={t('common:cpa.keyPlaceholder')}
                onChange={(event) => { setManagementKey(event.target.value); edit() }} />
              <ThemedTooltip label={showKey ? t('common:cpa.hideKey') : t('common:cpa.showKey')}>
                <SettingsButton variant="ghost" size="icon" type="button" className={styles.iconButton} aria-label={showKey ? t('common:cpa.hideKey') : t('common:cpa.showKey')}
                  disabled={busy} onClick={() => setShowKey((value) => !value)}>
                  {showKey ? <EyeOff size={14} aria-hidden="true" /> : <Eye size={14} aria-hidden="true" />}
                </SettingsButton>
              </ThemedTooltip>
              <ThemedTooltip label={t('common:cpa.generateKey')}>
                <SettingsButton variant="ghost" size="icon" type="button" className={styles.iconButton} aria-label={t('common:cpa.generateKey')} disabled={busy} onClick={() => {
                  const bytes = crypto.getRandomValues(new Uint8Array(32))
                  setManagementKey(Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join(''))
                  edit()
                }}><Shuffle size={14} aria-hidden="true" /></SettingsButton>
              </ThemedTooltip>
            </InputGroup>
            {canOperate && <SettingsButton type="button" className={`${styles.copyButton}`} disabled={busy} onClick={() => void operate('copyManagementKey')}>
              <Copy size={13} aria-hidden="true" />{t('common:cpa.copyKey')}
            </SettingsButton>}
          </div>
        </div>
      </SettingsSection>

      <SettingsSection className={styles.group}>
        <SettingToggle label={t('common:cpa.autoUpdate')} hint={t('common:cpa.updateHelp')}
          checked={autoUpdate} disabled={busy} onChange={(value) => { setAutoUpdate(value); edit() }} />
        {canOperate && <div className={styles.updateActions}>
          {status?.pendingVersion && <p className={formStyles.hint}>{t('common:cpa.updateReady')}: {status.pendingVersion}</p>}
          <SettingsButton type="button" disabled={busy} onClick={() => void operate('update')}>
            <RotateCw size={13} aria-hidden="true" />{t('common:cpa.updateNow')}
          </SettingsButton>
        </div>}
      </SettingsSection>

      <SettingsSection className={styles.group}>
        <div className={styles.runtimeRow}>
          <span className={formStyles.labelText}>{t('common:cpa.runtimeStatus')}</span>
          {status && <div className={styles.runtimeInfo} role="status">
            {status.version && <span className={styles.version}>{status.version}</span>}
            <span className={styles.phase} data-phase={status.phase}>{t(`common:cpa.phase.${status.phase}`)}{status.progress !== undefined && ` · ${status.progress}%`}</span>
          </div>}
        </div>
        {canOperate && <div className={styles.runtimeActions}>
          {canStop
            ? <SettingsButton type="button" onClick={() => void operate('stop')}><Square size={12} aria-hidden="true" />{t('common:cpa.stop')}</SettingsButton>
            : <SettingsButton type="button" disabled={busy} onClick={() => void operate('start')}><Play size={13} aria-hidden="true" />{t('common:cpa.start')}</SettingsButton>}
          <SettingsButton type="button" disabled={busy || !running} onClick={() => void operate('restart')}><RotateCw size={13} aria-hidden="true" />{t('common:cpa.restart')}</SettingsButton>
          <SettingsButton type="button" className={`${styles.logsButton}`} disabled={busy} onClick={() => void operate('openLogs')}><FileText size={13} aria-hidden="true" />{t('common:cpa.logs')}</SettingsButton>
        </div>}
      </SettingsSection>
    </>}

    <p className={formStyles.hint}>{t('common:cpa.quotaHelp')}</p>
    <div className={styles.feedback} aria-live="polite">
      {saved && <p className={styles.success} role="status">{keySaved ? t('common:cpa.keySaved') : t('common:cpa.saved')}</p>}
      {notice && <p className={styles.success} role="status">{notice}</p>}
      {failure && <p className={styles.error} role="alert">{failure}</p>}
    </div>
    <SettingsFooter className={styles.footer}>
      <div className={formStyles.actions}>
      <SettingsButton type="button" disabled={busy || !settings} onClick={() => void save(false)}>{settings?.mode === 'managed' && running && (Number(port) !== settings.port || mode !== settings.mode || !enabled || managementKey !== '') ? t('common:cpa.saveRestart') : t('common:action.save')}</SettingsButton>
      <SettingsButton variant="primary" type="button"  disabled={busy || !settings || mode === 'managed' && !enabled} onClick={() => void save(true)}>{t('common:cpa.saveAndOpen')}</SettingsButton>
      </div>
    </SettingsFooter>
  </SettingsSurface>
}

function SettingToggle({ label, hint, checked, disabled, onChange }: {
  label: string; hint: string; checked: boolean; disabled: boolean; onChange: (checked: boolean) => void
}) {
  return <SettingsRow className={formStyles.row}>
    <div className={formStyles.label}>
      <span className={formStyles.labelText}>{label}</span>
      <p className={formStyles.hint}>{hint}</p>
    </div>
    <SettingsCheckbox aria-label={label} checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
  </SettingsRow>
}
