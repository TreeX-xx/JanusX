import type { AutomationInput } from '../../../../shared/automations'
import { useI18n } from '@/i18n/useI18n'

type Task = AutomationInput['tasks'][number]
export function AutomationTaskFields({ input, index, workspaces, providers, baseline, taskName, update, changeTask, setBaseline }: {
  input: AutomationInput
  index: number
  workspaces: Array<{ id: string; name: string }>
  providers: Array<{ id: string; name: string; models: string[] }>
  baseline: string
  taskName(task: Task): string
  update(patch: Partial<AutomationInput>): void
  changeTask(index: number, patch: Partial<Task>): void
  setBaseline(value: string): void
}) {
  const { t } = useI18n('common'), task = input.tasks[index]
  return <div className="automation-task-body">
    {task.kind === 'notification' && <label>{t('automations.notificationMessage')}<textarea value={task.message ?? ''} onChange={event => changeTask(index, { message: event.target.value })} /></label>}
    {task.kind === 'git' && <>
      <p className="automation-task-description">{t('automations.gitHint')}</p>
      <label>{t('automations.project')}<select value={input.workspaceId} onChange={event => update({ workspaceId: event.target.value })}>
        <option value="">{t('automations.selectProject')}</option>{workspaces.map(workspace => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}
      </select></label>
      <label>{t('automations.branch')}<input value={input.branch} onChange={event => update({ branch: event.target.value })} /></label>
      <details className="automation-advanced"><summary>{t('automations.advanced')}</summary><label>{t('automations.baseline')}<input value={baseline} aria-describedby="automation-baseline-hint" onChange={event => setBaseline(event.target.value)} /></label><p id="automation-baseline-hint" className="automation-field-hint">{t('automations.baselineHint')}</p></details>
    </>}
    {task.kind.startsWith('agent.') && <>
      <label>{t('automations.executor')}<select value={task.kind} onChange={event => changeTask(index, { kind: event.target.value as Task['kind'] })}><option value="agent.internal">{t('automations.internal')}</option><option value="agent.cli">Codex CLI</option></select></label>
      <label>{t('automations.instructions')}<textarea placeholder={t('automations.instructionsHint')} value={task.prompt ?? ''} onChange={event => changeTask(index, { prompt: event.target.value })} /></label>
      {task.kind === 'agent.internal' && <>
        {input.tasks.filter(item => item.kind === 'agent.internal').length > 1 && <p className="automation-field-hint">{t('automations.sharedModelHint')}</p>}
        <div className="automation-fields"><label>{t('automations.provider')}<select value={input.providerId} onChange={event => update({ providerId: event.target.value, modelId: providers.find(item => item.id === event.target.value)?.models[0] ?? '' })}>
          <option value="">{t('automations.selectModel')}</option>{!providers.some(item => item.id === input.providerId) && input.providerId && <option value={input.providerId}>{input.providerId}</option>}
          {providers.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
          <label>{t('automations.model')}<input list={`automation-models-${task.id}`} value={input.modelId} onChange={event => update({ modelId: event.target.value })} /><datalist id={`automation-models-${task.id}`}>{providers.find(item => item.id === input.providerId)?.models.map(model => <option key={model} value={model} />)}</datalist></label>
        </div>
      </>}
    </>}
    {(task.kind === 'command' || task.kind === 'artifact') && <p className="automation-task-description">{task.kind === 'command' ? <code>git diff --check</code> : t('automations.artifactHint')}</p>}
    {index > 0 && <label className="automation-task-input">{t('automations.input')}<select value={task.input} onChange={event => changeTask(index, { input: event.target.value })}>{input.tasks.slice(0, index).map((prior, at) => <option key={prior.id} value={prior.id}>{at + 1}. {taskName(prior)}</option>)}</select></label>}
  </div>
}
