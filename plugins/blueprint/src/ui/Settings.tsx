import { t } from './i18n'
import { useEffect, useId, useRef, useState } from 'react'
import { z } from 'zod'
import {
  blueprintReviewSettingsSchema,
  type BlueprintReviewSettings,
  type BlueprintSettingsSnapshot,
  type ReviewConfigurationStatus,
} from '../shared/blueprint-review-settings'
import { call, plugin } from './client'
import { settingsText as reviewText } from './settings-text'
import { Select } from './Select'
import { Cpu, Eye, EyeOff, Minus, Plus, RefreshCw, Timer } from './SettingsIcons'
import { NoteMcpSettings } from './NoteMcpSettings'
import settingsStyles from './SettingsCards.module.css'
import styles from './BlueprintSettingsPanel.module.css'
import './settings-surface.css'
import { Draft } from './draft'
import { SettingsAutosave, type SettingsSaveState } from './settings-autosave'
import type { LegacyDataMigration } from '../main/legacy-data'

const snapshotSchema = z.object({ value: blueprintReviewSettingsSchema, revision: z.string().regex(/^[a-f0-9]{64}$/) }).strict()
const draftSchema = z.object({ base: snapshotSchema, value: blueprintReviewSettingsSchema.extend({ automatic: z.object({ enabled: z.boolean(), commits: z.number() }).strict() }) }).strict()

export type Models = Array<{ id: string; name: string; models: Array<{ id: string; name: string }> }>
export function ModelSelect({
  models,
  value,
  change,
  disabled,
}: {
  models: Models
  value: { providerId: string; modelId: string }
  change(value: { providerId: string; modelId: string }): void
  disabled?: boolean
}) {
  const list = useId()
  return (
    <div className="fields">
      <label>
        {t('模型服务')}
        <select
          aria-label={t('模型服务')}
          disabled={disabled}
          value={value.providerId}
          onChange={(event) => change({ providerId: event.target.value, modelId: '' })}
        >
          <option value="">{t('选择服务')}</option>
          {models.map((provider) => (
            <option key={provider.id} value={provider.id}>
              {provider.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t('模型')}
        <input
          aria-label={t('模型')}
          disabled={disabled}
          list={list}
          value={value.modelId}
          onChange={(event) => change({ ...value, modelId: event.target.value })}
          placeholder={t('选择或输入模型 ID')}
        />
        <datalist id={list}>
          {models
            .find((provider) => provider.id === value.providerId)
            ?.models.map((model) => (
              <option key={model.id} value={model.id}>
                {model.name}
              </option>
            ))}
        </datalist>
      </label>
    </div>
  )
}

export function Settings({ models, saved }: { models: Models; saved(): void }) {
  const id = useId()
  const [providers, setProviders] = useState(models)
  const [status, setStatus] = useState<ReviewConfigurationStatus | null>(null)
  const [testing, setTesting] = useState(false)
  const [checkRevision, setCheckRevision] = useState(0)
  const [key, setKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [credentialConfigured, setCredentialConfigured] = useState(false)
  const [credentialSaving, setCredentialSaving] = useState(false)
  const [credentialError, setCredentialError] = useState('')
  const [credentialRevision, setCredentialRevision] = useState(0)
  const latestCredentialRevision = useRef(0)
  const credentialQueue = useRef(Promise.resolve())
  const mounted = useRef(false)
  useEffect(() => { setProviders(models) }, [models])
  useEffect(() => {
    mounted.current = true
    let active = true
    const refresh = () => { void call<Models>('models.catalog').then(value => { if (active) setProviders(value) }).catch(error => { if (active) setNotice(String(error)) }) }
    refresh()
    void call<{ configured: boolean }>('settings.credential-status').then(value => { if (active) setCredentialConfigured(value.configured) }).catch(error => { if (active) setCredentialError(String(error)) })
    window.addEventListener('focus', refresh)
    return () => { active = false; mounted.current = false; window.removeEventListener('focus', refresh) }
  }, [])
  useEffect(() => {
    if (!credentialRevision) return
    const timer = setTimeout(() => {
      credentialQueue.current = credentialQueue.current.catch(() => {}).then(async () => {
        try {
          const result = await call<{ configured: boolean }>('settings.credential-set', { value: key })
          if (mounted.current && latestCredentialRevision.current === credentialRevision) { setCredentialConfigured(result.configured); setCheckRevision(value => value + 1) }
        } catch (error) { if (mounted.current && latestCredentialRevision.current === credentialRevision) setCredentialError(String(error)) }
        finally { if (mounted.current && latestCredentialRevision.current === credentialRevision) setCredentialSaving(false) }
      })
    }, 350)
    return () => clearTimeout(timer)
  }, [credentialRevision])
  const [settings, setValue] = useState<BlueprintReviewSettings>(),
    [base, setBase] = useState<BlueprintSettingsSnapshot>(),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false)
  const draft = useRef<Draft>()
  const draftSequence = useRef(0)
  const [draftStatus, setDraftStatus] = useState<'saving' | 'saved' | 'failed'>()
  const [saveState, setSaveState] = useState<SettingsSaveState>()
  const autosave = useRef<SettingsAutosave>()
  const latest = useRef<BlueprintReviewSettings>()
  const savedCallback = useRef(saved)
  savedCallback.current = saved
  const [migration, setMigration] = useState<LegacyDataMigration>()
  draft.current ??= new Draft(plugin().storage, 'blueprint-settings-draft')
  useEffect(() => {
    let alive = true
    void call<LegacyDataMigration>('migration.status').then(value => { if (alive) setMigration(value) }).catch(() => {})
    void Promise.all([call<BlueprintSettingsSnapshot>('settings.snapshot'), draft.current!.read()])
      .then(([current, stored]) => {
        if (!alive) return
        autosave.current = new SettingsAutosave(current, async (value, expectedRevision) => {
          await call('settings.update', { value, expectedRevision })
          const snapshot = await call<BlueprintSettingsSnapshot>('settings.snapshot')
          if (JSON.stringify(snapshot.value) !== JSON.stringify(value)) throw new Error('RESOURCE_CHANGED')
          return snapshot
        }, state => {
          if (!alive) return
          setSaveState(state)
          if (state.snapshot) {
            setBase(state.snapshot)
            savedCallback.current()
            const value = latest.current
            const stored = !value || JSON.stringify(value) === JSON.stringify(state.snapshot.value) ? null : { base: state.snapshot, value }
            void draft.current!.write(stored).catch(() => {
              autosave.current?.pause(); setDraftStatus('failed')
              setNotice(t('草稿保存失败或已被其它页面修改。当前修改仍保留在此页面，请勿关闭。'))
            })
          }
        })
        const parsed = draftSchema.safeParse(stored)
        if (parsed.success && JSON.stringify(parsed.data.value) !== JSON.stringify(current.value)) {
          setValue(parsed.data.value)
          latest.current = parsed.data.value
          setBase(parsed.data.base)
          if (parsed.data.base.revision === current.revision) autosave.current.change(parsed.data.value)
          else autosave.current.pause()
          setNotice(
            parsed.data.base.revision === current.revision
              ? t('已恢复此页面的设置草稿')
              : t('已恢复草稿，但设置已在其它页面修改；请核对后重新载入已保存设置。'),
          )
        } else {
          setValue(current.value)
          latest.current = current.value
          setBase(current)
        }
      })
      .catch((error) => {
        if (alive) setNotice(String(error))
      })
    return () => {
      alive = false
      autosave.current?.dispose()
    }
  }, [])
  const setSettings = (value: BlueprintReviewSettings, delay = 350) => {
    setValue(value)
    latest.current = value
    setNotice('')
    if (base) {
      const sequence = ++draftSequence.current
      setDraftStatus('saving')
      void draft.current!.write({ base, value }).then(() => {
        if (sequence === draftSequence.current) setDraftStatus('saved')
      }).catch(() => {
        if (sequence !== draftSequence.current) return
        setDraftStatus('failed')
        autosave.current?.pause()
        setNotice(t('草稿保存失败或已被其它页面修改。当前修改仍保留在此页面，请勿关闭。'))
      })
    }
    autosave.current?.change(value, delay)
  }
  const action = async (task: () => Promise<void>) => {
    setBusy(true)
    setNotice('')
    try {
      await task()
    } catch (error) {
      setNotice(String(error))
    } finally {
      setBusy(false)
    }
  }
  const dirty = !!settings && !!base && JSON.stringify(base.value) !== JSON.stringify(settings)
  const saving = credentialSaving || saveState?.phase === 'saving' || saveState?.phase === 'pending'
  useEffect(() => {
    setTesting(false)
    if (!settings || !base || dirty || saving || credentialError || saveState?.phase === 'failed' || saveState?.phase === 'invalid') return
    const controller = new AbortController()
    const timer = setTimeout(() => {
      setTesting(true)
      void call<ReviewConfigurationStatus>('settings.check', null, controller.signal).then(value => {
        if (!controller.signal.aborted) setStatus(value)
      }).catch(error => { if (!controller.signal.aborted) setNotice(String(error)) })
        .finally(() => { if (!controller.signal.aborted) setTesting(false) })
    }, 800)
    return () => { clearTimeout(timer); controller.abort() }
  }, [base, dirty, saving, providers, checkRevision, credentialError, saveState?.phase])
  if (!settings || !base) return <p role="status">{notice || t('正在读取设置…')}</p>
  const change = (value: BlueprintReviewSettings) => {
    setStatus(null)
    setSettings(value, value.automatic.enabled !== settings.automatic.enabled || value.jev.enabled !== settings.jev.enabled ? 0 : 350)
  }
  const credential = (value: string) => {
    setKey(value); if (!value) setShowKey(false)
    setCredentialSaving(true); setCredentialError(''); setStatus(null)
    setCredentialRevision(++latestCredentialRevision.current)
  }
  const changeCommits = (commits: number) => {
    if (Number.isInteger(commits) && commits >= 1 && commits <= 10000 && commits !== settings.automatic.commits)
      change({ ...settings, automatic: { ...settings.automatic, commits } })
  }
  const selected = providers.find(provider => provider.id === settings.generation.providerId)
  const label = (value: string) => reviewText('blueprint:review.' + value)
  const error = credentialError || (saveState?.phase === 'failed' ? saveState.error : '')
  const saveMessage = saving ? reviewText('blueprint:review.saving') : !dirty && saveState?.phase === 'saved' ? t('已保存')
    : dirty ? draftStatus === 'saving' ? t('正在保存草稿，请保留当前页面…') : t('草稿已保存；重新打开此页面可恢复') : ''
  const reload = () => void action(async () => {
    autosave.current?.pause()
    await draft.current!.read(); await draft.current!.write(null)
    const current = await call<BlueprintSettingsSnapshot>('settings.snapshot')
    setValue(current.value); latest.current = current.value; setBase(current)
    autosave.current?.reset(current); setSaveState(undefined); setStatus(null)
    setNotice(t('已载入保存的设置'))
  })
  return (
    <div className={`blueprint-settings ${settingsStyles.panel} ${styles.panel}`}>
      <div className={styles.intro}>
        <h2 className="settings-heading">{t('蓝图设置')}</h2>
        <p className={settingsStyles.hint}>{reviewText('blueprint:review.settingsIntro')}</p>
        <p className={settingsStyles.status} role="status">{saveMessage}</p>
      </div>
      {Object.values(migration?.steps ?? {}).some(step => step.state === 'imported') && <p className={settingsStyles.hint} role="status">{t('已导入旧版蓝图数据，原文件已保留。迁移时自动审核保持关闭，请核对设置后自行启用。')}</p>}
      {error && <p className={`${settingsStyles.hint} ${settingsStyles.statusError}`} role="alert">{error}</p>}
      {notice && <p className={settingsStyles.hint} role="status">{notice}</p>}
      <fieldset className={`${settingsStyles.section} ${styles.section}`} disabled={busy} aria-labelledby={`${id}-models`}>
        <h3 className={settingsStyles.sectionTitle} id={`${id}-models`}><Cpu size={14} aria-hidden="true" />{reviewText('blueprint:review.models')}</h3>
        <p className={settingsStyles.hint}>{reviewText('blueprint:review.modelRoles')}</p>
        <div className={styles.fieldRow}>
          <span className={settingsStyles.labelText}>{reviewText('blueprint:review.generationProvider')}</span>
          <Select
            ariaLabel={reviewText('blueprint:review.generationProvider')}
            value={settings.generation.providerId}
            disabled={busy}
            onChange={providerId => change({ ...settings, generation: { providerId, modelId: '' } })}
            options={[
              { value: '', label: reviewText('blueprint:review.chooseProvider') },
              ...(settings.generation.providerId && !selected ? [{ value: settings.generation.providerId, label: reviewText('blueprint:review.providerUnavailable') }] : []),
              ...providers.map(provider => ({ value: provider.id, label: provider.name })),
            ]}
          />
        </div>
        <div className={styles.fieldRow}>
          <span className={settingsStyles.labelText}>{reviewText('blueprint:review.generationModel')}</span>
          <Select
            ariaLabel={reviewText('blueprint:review.generationModel')}
            value={settings.generation.modelId}
            disabled={busy}
            onChange={modelId => change({ ...settings, generation: { ...settings.generation, modelId } })}
            options={[
              { value: '', label: reviewText('blueprint:review.chooseModel') },
              ...(settings.generation.modelId && !selected?.models.some(model => model.id === settings.generation.modelId) ? [{ value: settings.generation.modelId, label: `${settings.generation.modelId} ${reviewText('blueprint:review.modelUnavailable')}` }] : []),
              ...(selected?.models.map(model => ({ value: model.id, label: model.name })) ?? []),
            ]}
          />
        </div>
        <div className={styles.jev}>
          <label className={settingsStyles.row}>
            <span className={settingsStyles.labelText}>{reviewText('blueprint:review.enableJev')}</span>
            <span className={settingsStyles.switch}>
              <input type="checkbox" checked={settings.jev.enabled} onChange={event => change({ ...settings, jev: { ...settings.jev, enabled: event.target.checked } })} />
              <span className={settingsStyles.switchTrack} />
            </span>
          </label>
          {settings.jev.enabled && <>
            <label className={styles.fieldRow}>
              <span className={settingsStyles.labelText}>{reviewText('blueprint:review.jevEndpoint')}</span>
              <input className={styles.input} value={settings.jev.endpoint} spellCheck={false} onChange={event => change({ ...settings, jev: { ...settings.jev, endpoint: event.target.value } })} />
            </label>
            <label className={styles.fieldRow}>
              <span className={settingsStyles.labelText}>{reviewText('blueprint:review.jevModel')}</span>
              <input className={styles.input} value={settings.jev.model} spellCheck={false} onChange={event => change({ ...settings, jev: { ...settings.jev, model: event.target.value } })} />
            </label>
            <div className={styles.fieldRow}>
              <label className={settingsStyles.labelText} htmlFor={`${id}-jev-key`}>{reviewText('blueprint:review.jevCredential')}</label>
              <div className={styles.credentialInput}>
                <input id={`${id}-jev-key`} className={styles.input} type={showKey ? 'text' : 'password'} autoComplete="off" spellCheck={false} value={key} placeholder={reviewText(credentialConfigured ? 'blueprint:review.credentialConfigured' : 'blueprint:review.credentialPlaceholder')} onChange={event => credential(event.target.value)} />
                <button className={styles.eyeButton} type="button" disabled={saving || !key} aria-label={showKey ? reviewText('blueprint:review.hideCredential') : reviewText('blueprint:review.showCredential')} aria-pressed={showKey} onClick={() => setShowKey(value => !value)}>
                  {showKey ? <EyeOff size={15} aria-hidden="true" /> : <Eye size={15} aria-hidden="true" />}
                </button>
              </div>
              {credentialConfigured && <button className={`${settingsStyles.button} credential-clear`} type="button" disabled={credentialSaving} onClick={() => credential('')}>{t('清除凭据')}</button>}
            </div>
          </>}
        </div>
        <div className={styles.feedback}>
          <div className={styles.feedbackText} role="status">
            <p className={settingsStyles.hint}>{testing ? reviewText('blueprint:review.testing') : status ? reviewText('blueprint:review.configurationResult', { generation: label(status.generation.status), jev: label(status.jev.status) }) : reviewText('blueprint:review.waiting')}</p>
            {status?.generation.message && <p className={settingsStyles.hint}>{status.generation.reason ? reviewText(`blueprint:review.connectionFailure.${status.generation.reason}`) : status.generation.message}{status.generation.httpStatus ? ` (HTTP ${status.generation.httpStatus})` : ''}</p>}
            {status?.jev.message && <p className={settingsStyles.hint}>{status.jev.message}</p>}
          </div>
          <button className={settingsStyles.button} type="button" disabled={testing || saving || dirty} onClick={() => { setNotice(''); setCheckRevision(value => value + 1) }}>
            <RefreshCw size={12} aria-hidden="true" />{reviewText('blueprint:review.retest')}
          </button>
        </div>
      </fieldset>
      <fieldset className={`${settingsStyles.section} ${styles.section}`} disabled={busy} aria-labelledby={`${id}-automatic`}>
        <h3 className={settingsStyles.sectionTitle} id={`${id}-automatic`}><Timer size={14} aria-hidden="true" />{reviewText('blueprint:review.automatic')}</h3>
        <label className={settingsStyles.row}>
          <span className={settingsStyles.labelText}>{reviewText('blueprint:review.automaticEnable')}</span>
          <span className={settingsStyles.switch}>
            <input type="checkbox" checked={settings.automatic.enabled} aria-describedby={`${id}-automatic-help`}
              disabled={!settings.automatic.enabled && (saving || status?.generation.status !== 'ready')}
              onChange={event => change({ ...settings, automatic: { ...settings.automatic, enabled: event.target.checked } })} />
            <span className={settingsStyles.switchTrack} />
          </span>
        </label>
        <div className={settingsStyles.row}>
          <label className={settingsStyles.labelText} htmlFor={`${id}-commits`}>{reviewText('blueprint:review.automaticCommits')}</label>
          <div className={styles.numberControl}>
            <button className={styles.stepButton} type="button" aria-label={reviewText('blueprint:review.decreaseAutomaticCommits')}
              disabled={settings.automatic.commits <= 1} onClick={() => changeCommits(settings.automatic.commits - 1)}>
              <Minus size={14} aria-hidden="true" />
            </button>
            <input id={`${id}-commits`} className={`${styles.input} ${styles.numberInput}`} type="number" inputMode="numeric" min={1} max={10000} step={1} value={settings.automatic.commits}
              onChange={event => changeCommits(Number(event.target.value))} />
            <button className={styles.stepButton} type="button" aria-label={reviewText('blueprint:review.increaseAutomaticCommits')}
              disabled={settings.automatic.commits >= 10000} onClick={() => changeCommits(settings.automatic.commits + 1)}>
              <Plus size={14} aria-hidden="true" />
            </button>
          </div>
        </div>
        <p className={settingsStyles.hint} id={`${id}-automatic-help`}>{reviewText('blueprint:review.automaticHelp')}</p>
      </fieldset>
      {dirty && (saveState?.phase === 'failed' || draftStatus === 'failed' || notice) && <div className={settingsStyles.actions}>
        <button className={settingsStyles.button} type="button" disabled={busy || saving} onClick={reload}>{t('放弃草稿并重新载入')}</button>
      </div>}
      <NoteMcpSettings />
    </div>
  )
}
