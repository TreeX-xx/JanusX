// Note: .agents/notes/desktop/browser-computer-use.md
import { useEffect, useState } from 'react'
import { SettingsSurface, SettingsSection, SettingsRow, SettingsFooter, Input, Button, settingsStyles as styles } from '@janusx/ui'
import { SettingsCheckbox } from './ui/SettingsCheckbox'
import { useI18n } from '@/i18n/useI18n'
import { DEFAULT_CONTROL_SETTINGS, type ControlSettings, type ControlStatus } from '../../../shared/ipc/control'
import { BrowserTerminalSettings } from './BrowserTerminalSettings'
import { CircleCheck, Square, RefreshCw } from 'lucide-react'

export function ControlSettingsPanel({ kind, onManageIntegrations }: { kind: 'browser' | 'computer'; onManageIntegrations?: () => void }) {
  const { t } = useI18n('control')
  const [saved, setSaved] = useState<ControlSettings>(DEFAULT_CONTROL_SETTINGS)
  const [draft, setDraft] = useState<ControlSettings>(DEFAULT_CONTROL_SETTINGS)
  const [runtime, setRuntime] = useState<ControlStatus>()
  const [busy, setBusy] = useState(true)
  const [message, setMessage] = useState('')
  const [error, setError] = useState(false)
  useEffect(() => {
    let cancelled = false
    Promise.all([window.electron.controls.get(), window.electron.controls.status()]).then(([settings, status]) => {
      if (!cancelled) { setSaved(settings); setDraft(settings); setRuntime(status) }
    }).catch(cause => { if (!cancelled) { setMessage(String(cause)); setError(true) } }).finally(() => { if (!cancelled) setBusy(false) })
    return () => { cancelled = true }
  }, [])
  const dirty = JSON.stringify(draft[kind]) !== JSON.stringify(saved[kind])
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError(false); setMessage('')
    try { await action() } catch (cause) { setError(true); setMessage(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }
  return <SettingsSurface className={styles.panel} data-control-settings={kind}>
    <SettingsSection className={styles.section}>
      <h3 className={styles.sectionTitle}>{t(`${kind}.section`)}</h3>
      <SettingsRow className={styles.row}>
        <div className={styles.label}><span className={styles.labelText}>{t('provider')}</span><span className={styles.hint}>{t(`${kind}.providerHint`)}</span></div>
        <span>{kind === 'browser' ? `Chrome DevTools MCP ${runtime?.browser.version ?? '1.12.0'}` : 'Cua Driver'}</span>
      </SettingsRow>
      {kind === 'browser' ? <>
        <SettingsRow className={styles.row}>
          <div className={styles.label}><span className={styles.labelText}>{t('browser.enabled')}</span><span className={styles.hint}>{t('browser.enabledHint')}</span></div>
          <SettingsCheckbox aria-label={t('browser.enabled')} checked={draft.browser.enabled} disabled={busy}
            onChange={event => setDraft(current => ({ ...current, browser: { ...current.browser, enabled: event.target.checked } }))} />
        </SettingsRow>
        <SettingsRow className={styles.row}>
          <div className={styles.label}><span className={styles.labelText}>{t('browser.timeout')}</span><span className={styles.hint}>{t('browser.timeoutHint')}</span></div>
          <div className={styles.numberControl}><Input className={styles.input} type="number" aria-label={t('browser.timeout')} min={3} max={60} step={1} disabled={busy}
            value={draft.browser.timeoutMs / 1000} onChange={event => setDraft(current => ({ ...current, browser: { ...current.browser, timeoutMs: Math.max(3000, Math.min(60000, Number(event.target.value) * 1000 || 3000)) } }))} /><span className={styles.unit}>{t('seconds')}</span></div>
        </SettingsRow>
        <SettingsRow className={styles.row}>
          <div className={styles.label}><span className={styles.labelText}>{t('status')}</span><span className={styles.hint}>{runtime?.browser.error ?? t('browser.approvalHint')}</span></div>
          <span data-control-runtime>{runtime?.browser.state === 'ready' ? t('browser.ready') : t('browser.unavailable')}</span>
        </SettingsRow>
        <div className={styles.actions}>
          <Button disabled={busy} onClick={() => void run(async () => { setRuntime(await window.electron.controls.status()) })}><RefreshCw size={14} />{t('browser.check')}</Button>
          <Button variant="danger" disabled={busy} onClick={() => void run(async () => { await window.electron.controls.stop(); setRuntime(await window.electron.controls.status()); setMessage(t('browser.stopped')) })}><Square size={14} />{t('browser.stop')}</Button>
        </div>
      </> : <>
        <p className={styles.hint} role="note">{t('computer.notConnected')}</p>
        <SettingsRow className={styles.row}>
          <div className={styles.label}><span className={styles.labelText}>{t('computer.executable')}</span><span className={styles.hint}>{t('computer.executableHint')}</span></div>
          <Input className={styles.textInput} aria-label={t('computer.executable')} placeholder="cua-driver" disabled={busy}
            value={draft.computer.executable} onChange={event => setDraft(current => ({ ...current, computer: { executable: event.target.value } }))} />
        </SettingsRow>
        <div className={styles.actions}><Button disabled={busy || dirty} onClick={() => void run(async () => {
          const result = await window.electron.controls.checkComputer()
          if (!result.available) throw new Error(result.error ?? t('computer.missing'))
          setMessage(t('computer.detected', { version: result.version ?? '' }))
        })}><CircleCheck size={14} />{t('computer.check')}</Button></div>
      </>}
    </SettingsSection>
    {kind === 'browser' && <BrowserTerminalSettings onManage={onManageIntegrations} />}
    <SettingsFooter className={styles.footer}>
      <div className={`${styles.status} ${error ? styles.statusError : ''}`} role="status">{message || (busy ? t('loading') : dirty ? t('unsaved') : '')}</div>
      <div className={styles.actions}>
        <Button disabled={busy || !dirty} onClick={() => { setDraft(saved); setMessage(''); setError(false) }}>{t('reset')}</Button>
        <Button variant="primary" disabled={busy || !dirty} onClick={() => void run(async () => {
          const next = await window.electron.controls.update(kind === 'browser' ? { browser: draft.browser } : { computer: draft.computer })
          setSaved(next); setDraft(next); setRuntime(await window.electron.controls.status()); setMessage(t('saved'))
        })}>{t('save')}</Button>
      </div>
    </SettingsFooter>
  </SettingsSurface>
}
