// Note: .agents/notes/workbench/plugin-contract-v1.md ? project configuration follows all-workspace access.
// Note: .agents/notes/workbench/plugin-contract-v1.md — host-generated plugin settings.
import { useEffect, useRef, useState } from 'react'
import { isPluginSettingValue, type PluginSettingValue } from '@janusx/plugin-sdk'
import type { InstalledPlugin, PluginConfigurationState } from '../../../../shared/ipc/plugins'
import { pluginRequest } from '@/extensions/plugin-runtime'
import { hasPluginProjectAccess } from '../../../../shared/plugin-project-access'
import { useWorkspaceStore } from '@/stores/workspace'
import { useWorktreeStore } from '@/stores/worktree'
import { useI18n } from '@/i18n/useI18n'
import styles from './PluginSettingsPanel.module.css'
import { openExtensionView } from '@/extensions/workbench'
import type { PluginConfigurationTarget } from '@/extensions/plugin-configuration-navigation'
import { pluginConfigurationDrafts } from '@/extensions/plugin-configuration-drafts'

export function PluginConfigurationForm({ record, initialScope = 'application', proposal, onOpened }: {
  record: InstalledPlugin; initialScope?: 'application' | 'project'; proposal?: PluginConfigurationTarget['proposal']; onOpened?: () => void
}) {
  const { t } = useI18n('plugins')
  const projectId = useWorkspaceStore(state => state.activeWorkspaceId)
  const project = useWorkspaceStore(state => state.workspaces.find(item => item.id === projectId))
  const root = useWorktreeStore(state => projectId ? state.activePaths[projectId] ?? project?.path : undefined)
  const [scope, setScope] = useState(initialScope)
  const projectAllowed = Boolean(projectId && hasPluginProjectAccess(record, projectId))
  const projectScope = scope === 'project' && projectAllowed
  const [configuration, setConfiguration] = useState<PluginConfigurationState | null>(null)
  const [patch, setPatch] = useState<Record<string, PluginSettingValue | null>>({})
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState('')
  const [saved, setSaved] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState<'reload' | 'reset' | null>(null)
  const requests = useRef({ sequence: 0 }).current
  const target = { id: record.manifest.id, projectId: projectScope ? projectId : null, scopePath: projectScope ? root ?? null : null }
  const draftTarget = { ...target, digest: record.digest }
  const initialTarget = useRef(JSON.stringify(target))
  const proposalConsumed = useRef(false)
  const [reviewing, setReviewing] = useState(false)
  const load = async (discard = false) => {
    const current = ++requests.sequence
    setBusy(true); setFailure(''); setSaved(false)
    try {
      const result = await pluginRequest<PluginConfigurationState>({ type: 'configurationGet', ...target })
      if (current === requests.sequence) {
        const draft = discard ? undefined : pluginConfigurationDrafts.read(draftTarget)
        if (discard) pluginConfigurationDrafts.clear(draftTarget)
        setConfiguration(draft?.configuration ?? result); setPatch(draft?.patch ?? {}); setReviewing(draft?.reviewing ?? false)
        if (draft && draft.configuration.revision !== result.revision) setFailure('CONFIGURATION_CONFLICT')
        if (proposal && !proposalConsumed.current && initialTarget.current === JSON.stringify(target)) {
          proposalConsumed.current = true
          if (!draft && !discard) {
            const proposed = { ...result, revision: proposal.expectedRevision }
            setConfiguration(proposed); setPatch(proposal.patch); setReviewing(true)
            pluginConfigurationDrafts.write(draftTarget, { configuration: proposed, patch: proposal.patch, reviewing: true })
            if (proposal.expectedRevision !== result.revision) setFailure('CONFIGURATION_CONFLICT')
          }
        }
      }
    } catch (cause) { if (current === requests.sequence) { setConfiguration(null); setFailure((cause as Error).message) } }
    finally { if (current === requests.sequence) setBusy(false) }
  }
  useEffect(() => {
    setConfiguration(null); setPatch({}); setConfirmDiscard(null); void load()
    return () => { requests.sequence++ }
    // A schema/root change invalidates the old form and any in-flight response.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record.manifest.id, record.digest, projectScope, projectId, root])
  const submit = async (reset: boolean, migrate = false) => {
    if (!configuration) return
    const current = ++requests.sequence
    setBusy(true); setFailure(''); setSaved(false)
    try {
      const result = await pluginRequest<PluginConfigurationState>({ type: 'configurationUpdate', ...target,
        expectedRevision: configuration.revision, patch: reset || migrate ? {} : patch, reset, migrate })
      if (current === requests.sequence) { pluginConfigurationDrafts.clear(draftTarget); setConfiguration(result); setPatch({}); setSaved(true); setReviewing(false) }
    } catch (cause) { if (current === requests.sequence) setFailure((cause as Error).message) }
    finally { if (current === requests.sequence) setBusy(false) }
  }
  const settings = record.manifest.contributes.settings ?? []
  const customView = record.manifest.contributes.configurationViews?.[projectScope ? 'project' : 'application']
  const valueFor = (key: string) => Object.hasOwn(patch, key)
    ? patch[key] ?? configuration?.inherited[key] : configuration?.values[key]
  const invalid = settings.some(setting => Object.hasOwn(patch, setting.key) && patch[setting.key] !== null && !isPluginSettingValue(setting, patch[setting.key]))
  const edit = (key: string, value: PluginSettingValue | null) => {
    if (!configuration) return
    const next = { ...patch, [key]: value }
    pluginConfigurationDrafts.write(draftTarget, { configuration, patch: next, reviewing })
    setPatch(next); setSaved(false)
  }
  return <div data-plugin-configuration>
    <p className={styles.hint}>{t('plugins:configurationHint')}</p>
    {Object.keys(patch).length > 0 && <p role="status">{t('plugins:configurationDraftHint')}</p>}
    {reviewing && <p role="status">{t('plugins:configurationReview')}</p>}
    {customView && <button type="button" disabled={busy || !record.enabled || Boolean(Object.keys(patch).length)} onClick={() => {
      if (openExtensionView(`extension:${record.manifest.id}/${customView}`)) onOpened?.()
      else setFailure('CONTEXT_UNAVAILABLE')
    }}>{t('plugins:configurationCustom')}</button>}
    <label className={styles.row}>{t('plugins:configurationScope')}
      <select aria-label={t('plugins:configurationScope')} value={projectScope ? 'project' : 'application'} disabled={busy} onChange={event => setScope(event.target.value as 'application' | 'project')}>
        <option value="application">{t('plugins:configurationApplication')}</option>
        {projectAllowed && <option value="project">{t('plugins:configurationProject')} · {project?.name} · {root}</option>}
      </select>
    </label>
    {configuration && settings.map(setting => {
      const value = valueFor(setting.key)
      const disabled = busy || projectScope && setting.scope !== 'project'
      const overridden = Object.hasOwn(patch, setting.key) ? patch[setting.key] !== null : Object.hasOwn(configuration.overrides, setting.key)
      const change = (next: PluginSettingValue) => edit(setting.key, next)
      return <div key={setting.key} className={styles.configurationField}>
        <label>{setting.title}
          {setting.type === 'boolean' ? <input type="checkbox" aria-label={setting.title} disabled={disabled} checked={Boolean(value)} onChange={event => change(event.target.checked)} />
            : setting.type === 'enum' ? <select aria-label={setting.title} disabled={disabled} value={String(value)} onChange={event => change(event.target.value)}>
              {setting.options.map(option => <option key={option} value={option}>{option}</option>)}
            </select> : <input aria-label={setting.title} disabled={disabled} type={setting.type === 'number' ? 'number' : 'text'} value={String(value ?? '')}
              min={setting.type === 'number' ? setting.minimum : undefined} max={setting.type === 'number' ? setting.maximum : undefined}
              step={setting.type === 'number' && setting.integer ? 1 : 'any'} maxLength={setting.type === 'string' ? setting.maxLength ?? 4096 : undefined}
              onChange={event => change(setting.type === 'number' ? (event.target.value === '' ? '' : Number(event.target.value)) : event.target.value)} />}
        </label>
        <span className={styles.hint}>{disabled && !busy ? t('plugins:configurationApplicationOnly') : overridden ? t('plugins:configurationOverride') : t('plugins:configurationInherited')}</span>
        <button type="button" aria-label={`${t('plugins:configurationResetField')} ${setting.title}`} disabled={disabled || !overridden}
          onClick={() => edit(setting.key, null)}>{t('plugins:configurationResetField')}</button>
        {setting.description && <p className={styles.hint}>{setting.description}</p>}
      </div>
    })}
    {configuration?.issues.length ? <p role="status" className={styles.error}>{t('plugins:configurationIssues')} {configuration.issues.join(', ')}</p> : null}
    {configuration && configuration.migrations.length > 0 && <section aria-label={t('plugins:configurationMigration')}>
      <p className={styles.hint}>{t('plugins:configurationMigrationHint')}</p>
      <ul>{configuration.migrations.map(item => <li key={item.from}>{item.from} → {item.to} · {t(`plugins:configurationMigrationStatus.${item.status}`)}</li>)}</ul>
      <button type="button" disabled={busy || Boolean(Object.keys(patch).length) || !configuration.migrations.some(item => item.status === 'ready')}
        onClick={() => { void submit(false, true) }}>{t('plugins:configurationMigration')}</button>
    </section>}
    {invalid && <p role="alert" className={styles.error}>{t('plugins:configurationInvalid')}</p>}
    {failure && <p role="alert" className={styles.error}>{failure === 'CONFIGURATION_CONFLICT' ? t('plugins:configurationConflict') : failure}</p>}
    {saved && <p role="status">{t('plugins:configurationSaved')}</p>}
    <div className={styles.actions}>
      <button type="button" disabled={busy || !configuration || !Object.keys(patch).length || invalid} onClick={() => { void submit(false) }}>{t('plugins:configurationSave')}</button>
      <button type="button" disabled={busy || !configuration} onClick={() => setConfirmDiscard('reset')}>{t('plugins:configurationReset')}</button>
      <button type="button" disabled={busy} onClick={() => { if (Object.keys(patch).length) setConfirmDiscard('reload'); else void load() }}>{t('plugins:configurationReload')}</button>
    </div>
    {confirmDiscard && <section role="alertdialog" aria-label={t('plugins:configurationDiscardTitle')} className={styles.card}>
      <p>{t(confirmDiscard === 'reset' ? 'plugins:configurationResetHint' : 'plugins:configurationDiscardHint')}</p>
      <div className={styles.actions}>
        <button type="button" disabled={busy} onClick={() => { const action = confirmDiscard; setConfirmDiscard(null); if (action === 'reset') void submit(true); else void load(true) }}>{t('plugins:confirm')}</button>
        <button type="button" onClick={() => setConfirmDiscard(null)}>{t('plugins:cancel')}</button>
      </div>
    </section>}
  </div>
}
