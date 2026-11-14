import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SettingsSection, SettingsRow, SettingsFooter, Button, Input, settingsStyles as styles } from '@janusx/ui'
import { DEFAULT_WORKER_MODEL_SETTINGS, DEFAULT_WORKER_IDLE_MINUTES, MAX_WORKER_IDLE_MINUTES, parseWorkerIdleMinutes, WORKER_REASONING_EFFORT_SUGGESTIONS, parseWorkerModelSettings, type WorkerModelSettings } from '../../../shared/superagent-worker-settings'
import { useWorkerSettingsText } from '../lib/worker-settings-text'
import { Select } from './ui/Select'
import { Clock3, Cpu, RefreshCw } from 'lucide-react'
import { SettingsCheckbox } from './ui/SettingsCheckbox'
import layout from './WorkerDefaultsSettings.module.css'
import { TerminalPresetIcon } from './ui/TerminalPresetIcon'
import { DEFAULT_WORKER_POLICY, type WorkerPolicy, type WorkerBackend } from '../../../shared/superagent-worker-settings'

export function WorkerDefaultsSettings() {
  const { t } = useTranslation('settings')
  const { effortLabel, errorText } = useWorkerSettingsText()
  const api = window.electron?.superAgent
  const initialProfiles = { codex: DEFAULT_WORKER_MODEL_SETTINGS, claude: { ...DEFAULT_WORKER_MODEL_SETTINGS, terminal: 'claude' as const } }
  const [saved, setSaved] = useState<Record<WorkerBackend, WorkerModelSettings>>(initialProfiles)
  const [drafts, setDrafts] = useState(saved)
  const [policy, setPolicy] = useState<WorkerPolicy>(DEFAULT_WORKER_POLICY)
  const [savedPolicy, setSavedPolicy] = useState(policy)
  const setDraft = (value: WorkerModelSettings) => setDrafts(current => ({ ...current, [value.terminal]: value }))
  const [status, setStatus] = useState<'loading' | 'idle' | 'saving' | 'saved' | 'error'>('loading')
  const [error, setError] = useState('')
  const [idleMinutes, setIdleMinutes] = useState<number | string>(DEFAULT_WORKER_IDLE_MINUTES)
  const [savedIdleMinutes, setSavedIdleMinutes] = useState(DEFAULT_WORKER_IDLE_MINUTES)
  useEffect(() => {
    let cancelled = false
    if (!api) { setStatus('error'); setError(t('workerDefaults.unavailable')); return }
    void Promise.all([api.workerDefaults('codex'), api.workerDefaults('claude'), api.workerIdleTimeoutMinutes(), api.workerPolicy()]).then(([codex, claude, minutes, value]) => { if (!cancelled) { setSaved({ codex, claude }); setDrafts({ codex, claude }); setPolicy(value); setSavedPolicy(value); setIdleMinutes(minutes); setSavedIdleMinutes(minutes); setStatus('idle') } })
      .catch(value => { if (!cancelled) { setStatus('error'); setError(String(value)) } })
    return () => { cancelled = true }
  }, [api, t])
  const change = (draft: WorkerModelSettings, value: Partial<WorkerModelSettings>) => { setDraft({ ...draft, ...value }); setStatus('idle'); setError('') }
  const busy = status === 'loading' || status === 'saving'
  const dirty = JSON.stringify(saved) !== JSON.stringify(drafts) || JSON.stringify(policy) !== JSON.stringify(savedPolicy) || Number(idleMinutes) !== savedIdleMinutes
  const save = async () => {
    if (!api) return
    setStatus('saving'); setError('')
    try {
      const minutes = parseWorkerIdleMinutes(Number(idleMinutes))
      for (const backend of ['codex', 'claude'] as const) {
        const model = parseWorkerModelSettings(drafts[backend])
        if (JSON.stringify(saved[backend]) !== JSON.stringify(model)) {
          const value = await api.updateWorkerDefaults(model)
          setSaved(current => ({ ...current, [backend]: value }))
        }
      }
      const storedPolicy = await api.updateWorkerPolicy(policy)
      setPolicy(storedPolicy); setSavedPolicy(storedPolicy)
      const storedMinutes = await api.updateWorkerIdleTimeoutMinutes(minutes)
      setSavedIdleMinutes(storedMinutes); setIdleMinutes(storedMinutes); setStatus('saved')
    } catch (value) { setError(String(value)); setStatus('error') }
  }
  return <SettingsSection className={styles.section} aria-label={t('workerDefaults.title')}>
      <h3 className={styles.sectionTitle}><Cpu size={18} aria-hidden="true" />{t('workerDefaults.title')}</h3>
      <div className={layout.profiles}>
        {(['codex', 'claude'] as const).map(backend => {
          const draft = drafts[backend], name = backend === 'codex' ? 'Codex' : 'Claude Code'
          const isDefault = policy.defaultBackend === backend, enabled = policy.enabled.includes(backend)
          return <section className={layout.profile} key={backend} aria-label={name}>
            <header className={layout.header}>
              <div className={layout.identity}><TerminalPresetIcon preset={backend} style={{ width: 24, height: 24 }} /><h4>{name}</h4></div>
              <div className={layout.controls}>
                <button type="button" className={layout.defaultButton} aria-pressed={isDefault} disabled={busy || !api}
                  onClick={() => { setPolicy(current => ({ defaultBackend: backend, enabled: current.enabled.includes(backend) ? current.enabled : [...current.enabled, backend] })); setStatus('idle') }}>
                  {t(isDefault ? 'workerDefaults.isDefault' : 'workerDefaults.makeDefault')}
                </button>
                <SettingsCheckbox aria-label={t('workerDefaults.enableWorker', { name })} checked={enabled} disabled={busy || !api || isDefault}
                  onChange={event => { setPolicy(current => ({ ...current, enabled: event.target.checked ? [...current.enabled, backend] : current.enabled.filter(value => value !== backend) })); setStatus('idle') }} />
              </div>
            </header>
            <div className={layout.fields}>
              <WorkerDefaultModel backend={backend} value={draft.model} disabled={busy || !api || !enabled} onChange={model => change(draft, { model, effort: null })} />
              <div className={layout.field}>
                <label htmlFor={'worker-effort-' + backend}>{t('workerDefaults.effort')}</label>
                <Select id={'worker-effort-' + backend} value={draft.effort ?? ''} disabled={busy || !api || !enabled}
                  options={[{ value: '', label: effortLabel(null) }, ...[...new Set<string>([...WORKER_REASONING_EFFORT_SUGGESTIONS, ...(draft.effort ? [draft.effort] : [])])].map(value => ({ value, label: effortLabel(value) }))]}
                  onChange={effort => change(draft, { effort: effort || null })} ariaLabel={t('workerDefaults.effort')} />
              </div>
            </div>
          </section>
        })}
      </div>
      <SettingsRow className={styles.row}>
        <label className={layout.identity} htmlFor="worker-idle-minutes"><Clock3 size={18} aria-hidden="true" />{t('workerDefaults.idleTimeout')}</label>
        <div className={styles.numberControl}>
          <Input id="worker-idle-minutes" className={styles.input} type="number" min={1} max={MAX_WORKER_IDLE_MINUTES} step={1} value={idleMinutes} disabled={busy || !api}
            onChange={event => { setIdleMinutes(event.target.value); setStatus('idle'); setError('') }} />
          <span className={styles.unit}>{t('workerDefaults.minutes')}</span>
        </div>
      </SettingsRow>
    <SettingsFooter className={styles.footer} sticky={false}>
      <div className={`${styles.status} ${status === 'error' ? styles.statusError : ''}`} role={status === 'error' ? 'alert' : 'status'}>
        {status === 'error' ? `${t('workerDefaults.error')}: ${errorText(error)}` : status === 'saved' ? t('footer.saved') : busy ? t(status === 'loading' ? 'footer.loading' : 'footer.saving') : dirty ? t('footer.unsaved') : ''}
      </div>
      <div className={styles.actions}>
        <Button variant="ghost" disabled={busy || !api} onClick={() => { setDrafts(initialProfiles); setIdleMinutes(DEFAULT_WORKER_IDLE_MINUTES); setStatus('idle'); setError('') }}>{t('workerDefaults.restore')}</Button>
        <Button variant="primary" disabled={busy || !api || !dirty} onClick={() => void save()}>{t('footer.save')}</Button>
      </div>
    </SettingsFooter>
  </SettingsSection>
}

function WorkerDefaultModel({ backend, value, disabled, onChange }: { backend: WorkerBackend; value: string | null; disabled: boolean; onChange: (value: string | null) => void }) {
  const { t } = useTranslation('settings')
  const [models, setModels] = useState<Array<{ value: string; label: string }>>([])
  const [state, setState] = useState<'loading' | 'ready' | 'empty' | 'error'>('loading')
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    let cancelled = false
    setState('loading')
    void (async () => {
      const api = window.electron?.superAgent
      if (!api?.workerModels) throw new Error('Model catalog unavailable')
      const rows = await api.workerModels(backend)
      const options = [...new Map(rows.map(row => [row.model, { value: row.model, label: row.displayName || row.model }])).values()]
      if (!cancelled) { setModels(options); setState(options.length ? 'ready' : 'empty') }
    })().catch(() => { if (!cancelled) setState('error') })
    return () => { cancelled = true }
  }, [backend, revision])
  const options: Array<{ value: string; label: string; disabled?: boolean }> = [{ value: '', label: t('workerDefaults.native') }, ...models]
  if (value && !models.some(row => row.value === value)) options.push({ value, label: value, disabled: true })
  return <div className={layout.field}>
    <label htmlFor={'worker-model-' + backend}>{t('workerDefaults.model')}</label>
    <div className={layout.modelControl}>
      <Select id={'worker-model-' + backend} value={value ?? ''} disabled={disabled} options={options} onChange={model => onChange(model || null)} ariaLabel={t('workerDefaults.model')} />
      <Button variant="ghost" disabled={state === 'loading'} aria-label={t('workerDefaults.refreshModels')} onClick={() => setRevision(current => current + 1)}><RefreshCw size={15} aria-hidden="true" /></Button>
    </div>
    {state !== 'ready' && <span className={layout.catalogStatus} role="status">{t('workerDefaults.catalog.' + state)}</span>}
  </div>
}
