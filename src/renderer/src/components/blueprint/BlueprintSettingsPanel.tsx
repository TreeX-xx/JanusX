import { useI18n } from '@/i18n/useI18n'
import { useEffect, useId, useRef, useState } from 'react'
import { Cpu, Eye, EyeOff, Minus, Plus, RefreshCw, Timer } from 'lucide-react'
import { DEFAULT_BLUEPRINT_REVIEW_SETTINGS, type BlueprintReviewSettings, type ReviewConfigurationStatus } from '../../../../../plugins/blueprint/src/shared/blueprint-review-settings'
import { Select } from '../ui/Select'
import settingsStyles from '../KnowledgeSettingsPanel.module.css'
import styles from './BlueprintSettingsPanel.module.css'
import { NoteMcpSettings } from './NoteMcpSettings'

// Note: changes persist immediately; detection is separate — see .agents/notes/blueprint/product-direction.md
export function BlueprintSettingsPanel() {
  const { t } = useI18n('blueprint')
  const id = useId()
  const [settings, setSettings] = useState<BlueprintReviewSettings>(DEFAULT_BLUEPRINT_REVIEW_SETTINGS)
  const [loaded, setLoaded] = useState(false)
  const [providers, setProviders] = useState<Array<{ id: string; name: string; models: string[] }>>([])
  const [status, setStatus] = useState<ReviewConfigurationStatus | null>(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [key, setKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [checkRevision, setCheckRevision] = useState(0)
  const queue = useRef(Promise.resolve())
  const revision = useRef(0)
  const mounted = useRef(true)
  useEffect(() => {
    let active = true
    mounted.current = true
    const refreshProviders = () => { void window.electron.llm.getTerminalProviders('janus').then(items => {
      if (active) setProviders(items.filter(item => item.enabled !== false).map(item => ({ id: item.id, name: item.name, models: item.models ?? (item.modelId ? [item.modelId] : []) })))
    }).catch(reason => { if (active) setError(String(reason)) }) }
    refreshProviders()
    void Promise.all([window.electron.blueprintReview.settingsGet(), window.electron.blueprintReview.credentialGet().catch(reason => {
      if (active) setError(t('blueprint:review.credentialFailed') + String(reason))
      return null
    })]).then(([value, credential]) => {
      if (active) { setSettings(value); setKey(credential ?? ''); setLoaded(true); setCheckRevision(value => value + 1) }
    }).catch(reason => { if (active) setError(String(reason)) })
    window.addEventListener('focus', refreshProviders)
    return () => { active = false; mounted.current = false; window.removeEventListener('focus', refreshProviders) }
  }, [t])
  useEffect(() => {
    setTesting(false)
    if (!loaded || saving || error) return
    let active = true
    const timer = setTimeout(() => {
      setTesting(true)
      void window.electron.blueprintReview.configurationTest().then(value => { if (active) setStatus(value) })
        .catch(reason => { if (active) setError(String(reason)) }).finally(() => { if (active) setTesting(false) })
    }, 800)
    return () => { active = false; clearTimeout(timer) }
  }, [checkRevision, loaded, saving, providers, error])
  const change = (next: BlueprintReviewSettings) => {
    const current = ++revision.current
    setSettings(next); setSaving(true); setStatus(null); setError('')
    queue.current = queue.current.catch(() => undefined).then(async () => {
      try {
        const saved = await window.electron.blueprintReview.settingsUpdate(next)
        if (mounted.current && current === revision.current) { setSettings(saved); setCheckRevision(value => value + 1) }
      } catch (reason) { if (mounted.current && current === revision.current) setError(t('blueprint:review.saveFailed') + String(reason)) }
      finally { if (mounted.current && current === revision.current) setSaving(false) }
    })
  }
  const credential = (value: string) => {
    const current = ++revision.current
    setKey(value); setSaving(true); setStatus(null); setError('')
    if (!value) setShowKey(false)
    queue.current = queue.current.catch(() => undefined).then(async () => {
      try {
        await window.electron.blueprintReview.credentialSet(value)
        if (mounted.current && current === revision.current) setCheckRevision(value => value + 1)
      } catch (reason) { if (mounted.current && current === revision.current) setError(t('blueprint:review.credentialFailed') + String(reason)) }
      finally { if (mounted.current && current === revision.current) setSaving(false) }
    })
  }
  const changeCommits = (commits: number) => {
    if (Number.isInteger(commits) && commits >= 1 && commits <= 10000 && commits !== settings.automatic.commits) {
      change({ ...settings, automatic: { ...settings.automatic, commits } })
    }
  }
  const selected = providers.find(provider => provider.id === settings.generation.providerId)
  const label = (value: string) => ({ ready: t('blueprint:review.ready'), missing: t('blueprint:review.missing'), failed: t('blueprint:review.failed'), disabled: t('blueprint:review.disabled') })[value] ?? value
  return (
    <div className={`${settingsStyles.panel} ${styles.panel}`}>
      <div className={styles.intro}>
        <p className={settingsStyles.hint}>{t('blueprint:review.settingsIntro')}</p>
        <p className={settingsStyles.status} role="status">{saving ? t('blueprint:review.saving') : ''}</p>
      </div>
      {error && <p className={`${settingsStyles.hint} ${settingsStyles.statusError}`} role="alert">{error}</p>}
      <fieldset className={`${settingsStyles.section} ${styles.section}`} disabled={!loaded} aria-labelledby={`${id}-models`}>
        <h3 className={settingsStyles.sectionTitle} id={`${id}-models`}><Cpu size={14} aria-hidden="true" />{t('blueprint:review.models')}</h3>
        <p className={settingsStyles.hint}>{t('blueprint:review.modelRoles')}</p>
        <div className={styles.fieldRow}>
          <span className={settingsStyles.labelText}>{t('blueprint:review.generationProvider')}</span>
          <Select
            ariaLabel={t('blueprint:review.generationProvider')}
            value={settings.generation.providerId}
            disabled={!loaded}
            onChange={providerId => change({ ...settings, generation: { providerId, modelId: '' } })}
            options={[
              { value: '', label: t('blueprint:review.chooseProvider') },
              ...(settings.generation.providerId && !selected ? [{ value: settings.generation.providerId, label: t('blueprint:review.providerUnavailable') }] : []),
              ...providers.map(provider => ({ value: provider.id, label: provider.name })),
            ]}
          />
        </div>
        <div className={styles.fieldRow}>
          <span className={settingsStyles.labelText}>{t('blueprint:review.generationModel')}</span>
          <Select
            ariaLabel={t('blueprint:review.generationModel')}
            value={settings.generation.modelId}
            disabled={!loaded}
            onChange={modelId => change({ ...settings, generation: { ...settings.generation, modelId } })}
            options={[
              { value: '', label: t('blueprint:review.chooseModel') },
              ...(settings.generation.modelId && !selected?.models.includes(settings.generation.modelId) ? [{ value: settings.generation.modelId, label: `${settings.generation.modelId} ${t('blueprint:review.modelUnavailable')}` }] : []),
              ...(selected?.models.map(model => ({ value: model, label: model })) ?? []),
            ]}
          />
        </div>
        <div className={styles.jev}>
          <label className={settingsStyles.row}>
            <span className={settingsStyles.labelText}>{t('blueprint:review.enableJev')}</span>
            <span className={settingsStyles.switch}>
              <input type="checkbox" checked={settings.jev.enabled} onChange={event => change({ ...settings, jev: { ...settings.jev, enabled: event.target.checked } })} />
              <span className={settingsStyles.switchTrack} />
            </span>
          </label>
          {settings.jev.enabled && <>
            <label className={styles.fieldRow}>
              <span className={settingsStyles.labelText}>{t('blueprint:review.jevEndpoint')}</span>
              <input className={styles.input} value={settings.jev.endpoint} spellCheck={false} onChange={event => change({ ...settings, jev: { ...settings.jev, endpoint: event.target.value } })} />
            </label>
            <label className={styles.fieldRow}>
              <span className={settingsStyles.labelText}>{t('blueprint:review.jevModel')}</span>
              <input className={styles.input} value={settings.jev.model} spellCheck={false} onChange={event => change({ ...settings, jev: { ...settings.jev, model: event.target.value } })} />
            </label>
            <div className={styles.fieldRow}>
              <label className={settingsStyles.labelText} htmlFor={`${id}-jev-key`}>{t('blueprint:review.jevCredential')}</label>
              <div className={styles.credentialInput}>
                <input id={`${id}-jev-key`} className={styles.input} type={showKey ? 'text' : 'password'} autoComplete="off" spellCheck={false} value={key} placeholder={t('blueprint:review.credentialPlaceholder')} onChange={event => credential(event.target.value)} />
                <button className={styles.eyeButton} type="button" disabled={saving || !key} aria-label={showKey ? t('blueprint:review.hideCredential') : t('blueprint:review.showCredential')} aria-pressed={showKey} onClick={() => setShowKey(value => !value)}>
                  {showKey ? <EyeOff size={15} aria-hidden="true" /> : <Eye size={15} aria-hidden="true" />}
                </button>
              </div>
            </div>
          </>}
        </div>
        <div className={styles.feedback}>
          <div className={styles.feedbackText} role="status">
            <p className={settingsStyles.hint}>{testing ? t('blueprint:review.testing') : status ? t('blueprint:review.configurationResult', { generation: label(status.generation.status), jev: label(status.jev.status) }) : t('blueprint:review.waiting')}</p>
            {status?.generation.message && <p className={settingsStyles.hint}>{status.generation.reason ? t(`blueprint:review.connectionFailure.${status.generation.reason}`) : status.generation.message}{status.generation.httpStatus ? ` (HTTP ${status.generation.httpStatus})` : ''}</p>}
            {status?.jev.message && <p className={settingsStyles.hint}>{status.jev.message}</p>}
          </div>
          <button className={settingsStyles.button} type="button" disabled={testing || saving} onClick={() => { setError(''); setCheckRevision(value => value + 1) }}>
            <RefreshCw size={12} aria-hidden="true" />{t('blueprint:review.retest')}
          </button>
        </div>
      </fieldset>
      <fieldset className={`${settingsStyles.section} ${styles.section}`} disabled={!loaded} aria-labelledby={`${id}-automatic`}>
        <h3 className={settingsStyles.sectionTitle} id={`${id}-automatic`}><Timer size={14} aria-hidden="true" />{t('blueprint:review.automatic')}</h3>
        <label className={settingsStyles.row}>
          <span className={settingsStyles.labelText}>{t('blueprint:review.automaticEnable')}</span>
          <span className={settingsStyles.switch}>
            <input type="checkbox" checked={settings.automatic.enabled} aria-describedby={`${id}-automatic-help`}
              disabled={!settings.automatic.enabled && (saving || status?.generation.status !== 'ready')}
              onChange={event => change({ ...settings, automatic: { ...settings.automatic, enabled: event.target.checked } })} />
            <span className={settingsStyles.switchTrack} />
          </span>
        </label>
        <div className={settingsStyles.row}>
          <label className={settingsStyles.labelText} htmlFor={`${id}-commits`}>{t('blueprint:review.automaticCommits')}</label>
          <div className={styles.numberControl}>
            <button className={styles.stepButton} type="button" aria-label={t('blueprint:review.decreaseAutomaticCommits')}
              disabled={settings.automatic.commits <= 1} onClick={() => changeCommits(settings.automatic.commits - 1)}>
              <Minus size={14} aria-hidden="true" />
            </button>
            <input id={`${id}-commits`} className={`${styles.input} ${styles.numberInput}`} type="number" inputMode="numeric" min={1} max={10000} step={1} value={settings.automatic.commits}
              onChange={event => changeCommits(Number(event.target.value))} />
            <button className={styles.stepButton} type="button" aria-label={t('blueprint:review.increaseAutomaticCommits')}
              disabled={settings.automatic.commits >= 10000} onClick={() => changeCommits(settings.automatic.commits + 1)}>
              <Plus size={14} aria-hidden="true" />
            </button>
          </div>
        </div>
        <p className={settingsStyles.hint} id={`${id}-automatic-help`}>{t('blueprint:review.automaticHelp')}</p>
      </fieldset>
      <NoteMcpSettings />
    </div>
  )
}
