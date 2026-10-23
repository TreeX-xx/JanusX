import { useEffect, useState } from 'react'
import type { InstalledPlugin } from '../../../../shared/ipc/plugins'
import type { PluginMessage, PluginTaskRun } from '@janusx/plugin-sdk'
import { pluginRequest, refreshPlugins } from '@/extensions/plugin-runtime'
import { useWorkspaceStore } from '@/stores/workspace'
import { useWorktreeStore } from '@/stores/worktree'
import { useI18n } from '@/i18n/useI18n'
import styles from './PluginSettingsPanel.module.css'

function CredentialSlot({ record, slot, projectId, scopePath }: { record: InstalledPlugin; slot: NonNullable<InstalledPlugin['manifest']['contributes']['credentials']>[number]; projectId: string | null; scopePath: string | null }) {
  const { t } = useI18n('plugins')
  const [draft, setDraft] = useState(''); const [configured, setConfigured] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false); const [failure, setFailure] = useState('')
  useEffect(() => {
    let active = true
    setConfigured(null); setDraft('')
    if (record.enabled) void pluginRequest<{ configured: boolean }>({ type: 'credentialStatus', id: record.manifest.id, slot: slot.id, projectId, scopePath })
      .then(result => { if (active) setConfigured(result.configured) }, cause => { if (active) setFailure(cause.message) })
    return () => { active = false }
  }, [record.enabled, record.manifest.id, slot.id, slot.origin, projectId, scopePath])
  const save = async (value: string | null) => {
    setBusy(true); setFailure('')
    try {
      const result = await pluginRequest<{ configured: boolean }>({ type: 'credentialSet', id: record.manifest.id, slot: slot.id, projectId, scopePath, value })
      setConfigured(result.configured); setDraft(''); await refreshPlugins()
    } catch (cause) { setFailure((cause as Error).message) }
    finally { setBusy(false) }
  }
  return <div className={styles.card} data-plugin-credential={slot.id}>
    <label>{slot.title}<input type="password" autoComplete="new-password" aria-label={slot.title} value={draft} disabled={busy || !record.enabled} onChange={event => setDraft(event.target.value)} /></label>
    <p className={styles.hint}>{slot.origin} · {t(configured ? 'plugins:credentialConfigured' : 'plugins:credentialEmpty')}</p>
    <div className={styles.actions}>
      <button disabled={busy || !record.enabled || !draft} onClick={() => { void save(draft) }}>{t('plugins:credentialSave')}</button>
      <button disabled={busy || !record.enabled || !configured} onClick={() => { void save(null) }}>{t('plugins:credentialRevoke')}</button>
    </div>
    {failure && <p role="alert">{failure}</p>}
  </div>
}
export function PluginBackgroundPanel({ record, runs }: { record: InstalledPlugin; runs: PluginTaskRun[] }) {
  const { t } = useI18n('plugins')
  const activeProject = useWorkspaceStore(state => state.activeWorkspaceId)
  const project = useWorkspaceStore(state => state.workspaces.find(item => item.id === activeProject))
  const worktree = useWorktreeStore(state => activeProject ? state.activePaths[activeProject] ?? project?.path : undefined)
  const [scope, setScope] = useState<'application' | 'project'>('application')
  const projectId = scope === 'project' ? activeProject : null
  const [inputs, setInputs] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false); const [failure, setFailure] = useState('')
  const tasks = record.manifest.contributes.tasks ?? []; const slots = record.manifest.contributes.credentials ?? []
  if (!tasks.length && !slots.length) return null
  const start = async (task: typeof tasks[number]) => {
    setBusy(true); setFailure('')
    try {
      const input = JSON.parse(inputs[task.id] ?? JSON.stringify(Object.fromEntries(Object.entries(task.input).map(([key, type]) => [key, type === 'string' ? '' : type === 'number' ? 0 : false])))) as PluginMessage
      await pluginRequest({ type: 'taskStart', id: record.manifest.id, task: task.id, projectId, scopePath: projectId ? worktree ?? null : null, input }); await refreshPlugins()
    } catch (cause) { setFailure((cause as Error).message) }
    finally { setBusy(false) }
  }
  return <details data-plugin-background><summary>{t('plugins:background')}</summary>
    <label>{t('plugins:configurationScope')}<select aria-label={t('plugins:backgroundScope')} value={scope} disabled={busy} onChange={event => setScope(event.target.value as typeof scope)}>
      <option value="application">{t('plugins:configurationApplication')}</option>
      <option value="project" disabled={!activeProject}>{t('plugins:configurationProject')}</option>
    </select></label>
    {slots.map(slot => <CredentialSlot key={`${record.digest}:${slot.id}:${projectId}:${worktree}`} record={record} slot={slot} projectId={projectId} scopePath={projectId ? worktree ?? null : null} />)}
    {tasks.filter(task => task.scope === scope).map(task => <div key={task.id} className={styles.card}>
      <label>{task.title}<textarea aria-label={`${task.title} ${t('plugins:taskInput')}`} value={inputs[task.id] ?? JSON.stringify(Object.fromEntries(Object.entries(task.input).map(([key, type]) => [key, type === 'string' ? '' : type === 'number' ? 0 : false])))}
        onChange={event => setInputs(values => ({ ...values, [task.id]: event.target.value }))} /></label>
      <button disabled={busy || !record.enabled || scope === 'project' && !activeProject} onClick={() => { void start(task) }}>{t('plugins:taskRun', { title: task.title })}</button>
    </div>)}
    <p className={styles.hint}>{t('plugins:backgroundHint')}</p>
    {record.manifest.permissions.some(permission => permission.name === 'models.generate') && <p className={styles.hint}>{t('plugins:modelHint')}</p>}
    {failure && <p role="alert">{failure}</p>}
    {runs.filter(run => run.pluginId === record.manifest.id).slice().reverse().map(run => <div key={run.id} className={styles.card} data-plugin-task={run.id}>
      <span>{run.task} · {t(`plugins:taskState.${run.state}`)} · {run.projectId ?? t('plugins:configurationApplication')}</span>
      {run.state === 'running' && <button onClick={() => { void pluginRequest({ type: 'taskCancel', runId: run.id }).then(refreshPlugins).catch(cause => setFailure(cause.message)) }}>{t('plugins:taskCancel')}</button>}
      {run.error && <p role="status">{run.error}</p>}
      <pre>{run.logs.map(log => `${log.time} ${log.code}${log.message ? `: ${log.message}` : ''}`).join('\n')}</pre>
      {run.modelResults?.map((result, index) => <div key={index} data-plugin-model-result>
        <pre>{result.text}</pre>
        <span>{t('plugins:modelUsage', { input: result.usage.inputTokens ?? '—', output: result.usage.outputTokens ?? '—' })}</span>
      </div>)}
    </div>)}
  </details>
}
