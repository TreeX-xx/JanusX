// Note: .agents/notes/workbench/plugin-contract-v1.md — host-generated plugin settings.
import { useEffect, useRef, useState } from 'react'
import { isPluginSettingValue, type PluginSettingValue } from '@janusx/plugin-sdk'
import type { InstalledPlugin, PluginConfigurationState } from '../../../../shared/ipc/plugins'
import { pluginRequest } from '@/extensions/plugin-runtime'
import { useWorkspaceStore } from '@/stores/workspace'
import { useWorktreeStore } from '@/stores/worktree'
import { useI18n } from '@/i18n/useI18n'
import styles from './PluginSettingsPanel.module.css'

export function PluginConfigurationForm({ record, initialScope = 'application' }: { record: InstalledPlugin; initialScope?: 'application' | 'project' }) {
  const { t } = useI18n('plugins')
  const projectId = useWorkspaceStore(state => state.activeWorkspaceId)
  const project = useWorkspaceStore(state => state.workspaces.find(item => item.id === projectId))
  const root = useWorktreeStore(state => projectId ? state.activePaths[projectId] ?? project?.path : undefined)
  const [scope, setScope] = useState(initialScope)
  const projectAllowed = Boolean(projectId && record.projects.includes(projectId))
  const projectScope = scope === 'project' && projectAllowed
  const [configuration, setConfiguration] = useState<PluginConfigurationState | null>(null)
  const [patch, setPatch] = useState<Record<string, PluginSettingValue | null>>({})
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState('')
  const [saved, setSaved] = useState(false)
  const requests = useRef({ sequence: 0 }).current
  const target = { id: record.manifest.id, projectId: projectScope ? projectId : null, scopePath: projectScope ? root ?? null : null }
  const load = async () => {
    const current = ++requests.sequence
    setBusy(true); setFailure(''); setSaved(false)
    try {
      const result = await pluginRequest<PluginConfigurationState>({ type: 'configurationGet', ...target })
      if (current === requests.sequence) { setConfiguration(result); setPatch({}) }
    } catch (cause) { if (current === requests.sequence) { setConfiguration(null); setFailure((cause as Error).message) } }
    finally { if (current === requests.sequence) setBusy(false) }
  }
  useEffect(() => {
    setConfiguration(null); setPatch({}); void load()
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
      if (current === requests.sequence) { setConfiguration(result); setPatch({}); setSaved(true) }
    } catch (cause) { if (current === requests.sequence) setFailure((cause as Error).message) }
    finally { if (current === requests.sequence) setBusy(false) }
  }
  const settings = record.manifest.contributes.settings ?? []
  const valueFor = (key: string) => Object.hasOwn(patch, key)
    ? patch[key] ?? configuration?.inherited[key] : configuration?.values[key]
  const invalid = settings.some(setting => Object.hasOwn(patch, setting.key) && patch[setting.key] !== null && !isPluginSettingValue(setting, patch[setting.key]))
  return <div data-plugin-configuration>
    <p className={styles.hint}>{t('plugins:configurationHint')}</p>
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
      const change = (next: PluginSettingValue) => { setPatch(current => ({ ...current, [setting.key]: next })); setSaved(false) }
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
          onClick={() => { setPatch(current => ({ ...current, [setting.key]: null })); setSaved(false) }}>{t('plugins:configurationResetField')}</button>
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
      <button type="button" disabled={busy || !configuration} onClick={() => { void submit(true) }}>{t('plugins:configurationReset')}</button>
      <button type="button" disabled={busy} onClick={() => { void load() }}>{t('plugins:configurationReload')}</button>
    </div>
  </div>
}
