import { useEffect, useState } from 'react'
import { ArrowDown, ArrowUp, Bell, Check, Clock3, GitBranch, Plus, Trash2 } from 'lucide-react'
import { automationInputSchema, dailyReviewTemplate, isReminder, reminderTemplate, type AutomationCard, type AutomationDefinition, type AutomationDraft, type AutomationInput } from '../../../../shared/automations'
import { useAutomationsStore } from '@/stores/automations'
import { useWorkspaceStore } from '@/stores/workspace'
import { useI18n } from '@/i18n/useI18n'
import { AutomationTaskFields } from './AutomationTaskFields'

export function AutomationTaskEditor({ draft, cards, busy, action, onSaved }: {
  draft: AutomationDraft; cards: AutomationCard[]; busy: boolean;
  action(fn: () => Promise<void>): Promise<void>;
  onSaved(task: AutomationDefinition, runId?: string): void;
}) {
  const { t } = useI18n('common'), api = window.electron.automations!
  const setDraft = useAutomationsStore(state => state.setDraft)
  const workspaces = useWorkspaceStore(state => state.workspaces), workspaceId = useWorkspaceStore(state => state.activeWorkspaceId)
  const [providers, setProviders] = useState<Array<{ id: string; name: string; models: string[] }>>([])
  const [baseline, setBaseline] = useState(''), [preview, setPreview] = useState('')
  const [templatesOpen, setTemplatesOpen] = useState(false)
  const reminder = isReminder(draft.input), hasSteps = draft.input.tasks.length > 0
  const valid = automationInputSchema.safeParse(draft.input).success
  useEffect(() => {
    void window.electron.llm.getTerminalProviders?.('janus').then(items => setProviders(items.filter(item => item.enabled !== false).map(item => ({
      id: item.id, name: item.name, models: [...new Set([item.defaultModelId, item.modelId, ...(item.models ?? [])].filter((value): value is string => Boolean(value)))],
    })))).catch(() => {})
  }, [])
  const update = (patch: Partial<AutomationInput>) => { setDraft({ ...draft, input: { ...draft.input, ...patch } }); setPreview('') }
  const changeStep = (index: number, patch: Partial<AutomationInput['tasks'][number]>) => update({ tasks: draft.input.tasks.map((step, at) => at === index ? { ...step, ...patch } : step) })
  const stepName = (step: AutomationInput['tasks'][number]) => t(step.kind.startsWith('agent.') ? 'automations.reviewTask' : step.kind === 'command' ? 'automations.checkTask' : `automations.${step.kind}`)
  const templates = [{ id: 'interval', label: 'intervalTemplate', icon: Bell }, { id: 'daily', label: 'dailyReminderTemplate', icon: Clock3 }, { id: 'review', label: 'template', icon: GitBranch }] as const
  const applyTemplate = async (kind: typeof templates[number]['id']) => {
    const input = kind === 'review' ? dailyReviewTemplate(draft.input.workspaceId || workspaceId || workspaces[0]?.id || '') : reminderTemplate(reminder ? draft.input.tasks[0].message : '')
    input.name = draft.input.name; input.enabled = draft.input.enabled; input.cardId = draft.input.cardId
    if (kind === 'daily') { input.schedule = 'daily'; delete input.intervalMinutes }
    if (kind === 'review') {
      const model = await window.electron.llm.getTerminalDefault('janus')
      input.providerId = draft.input.providerId || model?.provider.id || ''; input.modelId = draft.input.modelId || model?.modelId || ''
    }
    if (useAutomationsStore.getState().draft !== draft) return
    setDraft({ ...draft, input }); setBaseline(''); setPreview(''); setTemplatesOpen(false)
  }
  const save = async (enabled: boolean, trial = false) => {
    const task = await api.save({ ...draft.input, enabled }, draft.id, draft.revision, baseline || undefined)
    const run = trial ? await api.run(task.id, crypto.randomUUID()) : undefined
    // A new chat proposal must survive an older save completing.
    if (useAutomationsStore.getState().draft === draft) { setDraft(null); onSaved(task, run?.id) }
  }
  const reorder = (index: number, offset: number) => {
    const steps = [...draft.input.tasks], target = index + offset
    if (target < 1 || target >= steps.length - 1) return
    ;[steps[index], steps[target]] = [steps[target], steps[index]]
    update({ tasks: steps.map((step, at) => at ? { ...step, input: steps[at - 1].id } : step) })
  }
  return <form className="automation-editor automation-inline-editor" aria-label={t(draft.id ? 'automations.editTask' : 'automations.addTask')} onSubmit={event => { event.preventDefault(); if (valid) void action(() => save(draft.input.enabled)) }}>
    <fieldset disabled={busy}>
      <div className="automation-editor-heading"><h3>{t(draft.id ? 'automations.editTask' : 'automations.addTask')}</h3><button type="button" className="automation-text-button" onClick={() => setDraft(null)}>{t('action.cancel')}</button></div>
      {!draft.id && !draft.input.cardId && <label>{t('automations.destinationCard')}<select value="" onChange={event => update({ cardId: event.target.value || undefined })}><option value="">{t('automations.createCardForTask')}</option>{cards.map(card => <option key={card.id} value={card.id}>{card.name}</option>)}</select></label>}
      <label>{t('automations.taskName')}<input required maxLength={120} value={draft.input.name} onChange={event => update({ name: event.target.value })} /></label>
      <section className="automation-form-section automation-template-section">
        <button type="button" className="automation-template-toggle" aria-expanded={!hasSteps || templatesOpen} onClick={() => setTemplatesOpen(value => !value)}>{t('automations.quickStart')}</button>
        {(!hasSteps || templatesOpen) && <><p className="automation-field-hint">{t(hasSteps ? 'automations.replaceTemplateHint' : 'automations.chooseTemplateHint')}</p><div className="automation-template-choices">{templates.map(({ id, label, icon: Icon }) => <button type="button" key={id} onClick={() => void action(() => applyTemplate(id))}><Icon size={13} />{t(`automations.${label}`)}</button>)}</div></>}
      </section>
      {hasSteps && <>
        {reminder ? <AutomationTaskFields input={draft.input} index={0} workspaces={workspaces} providers={providers} baseline={baseline} taskName={stepName} update={update} changeTask={changeStep} setBaseline={setBaseline} /> : <details className="automation-steps-editor" open><summary>{t('automations.steps')} · {draft.input.tasks.length}</summary><div className="automation-task-list">
          {draft.input.tasks.map((step, index) => <div className="automation-task" key={step.id}><div className="automation-task-heading"><span className="automation-step">{index + 1}</span><strong>{stepName(step)}</strong>
            {index > 0 && index < draft.input.tasks.length - 1 && <div className="automation-task-tools">
              <button className="automation-icon-button" type="button" aria-label={t('automations.moveUp')} disabled={index === 1} onClick={() => reorder(index, -1)}><ArrowUp size={13} /></button>
              <button className="automation-icon-button" type="button" aria-label={t('automations.moveDown')} disabled={index === draft.input.tasks.length - 2} onClick={() => reorder(index, 1)}><ArrowDown size={13} /></button>
              <button className="automation-icon-button" type="button" aria-label={t('automations.remove')} disabled={step.kind.startsWith('agent.') && draft.input.tasks.filter(item => item.kind.startsWith('agent.')).length === 1} onClick={() => { const steps = draft.input.tasks.filter((_, at) => at !== index); update({ tasks: steps.map((item, at) => at ? { ...item, input: steps[at - 1].id } : item) }) }}><Trash2 size={13} /></button>
            </div>}</div>
            <AutomationTaskFields input={draft.input} index={index} workspaces={workspaces} providers={providers} baseline={baseline} taskName={stepName} update={update} changeTask={changeStep} setBaseline={value => { setBaseline(value); setPreview('') }} />
          </div>)}
        </div><div className="automation-add-actions">{(['agent.internal', 'command'] as const).map(kind => <button className="automation-text-button" type="button" key={kind} disabled={draft.input.tasks.length >= 12} onClick={() => {
          const steps = [...draft.input.tasks], index = steps.length - 1, step = { id: `step_${crypto.randomUUID()}`, kind, input: steps[index - 1].id, ...(kind === 'command' ? { command: 'diff-check' as const } : { prompt: '' }) }
          steps.splice(index, 0, step); steps[steps.length - 1] = { ...steps[steps.length - 1], input: step.id }; update({ tasks: steps })
        }}><Plus size={13} />{t(kind === 'command' ? 'automations.addCheck' : 'automations.addReview')}</button>)}</div></details>}
        <section className="automation-form-section">
          <label>{t('automations.schedule')}<select value={draft.input.schedule} onChange={event => update({ schedule: event.target.value as AutomationInput['schedule'], intervalMinutes: draft.input.intervalMinutes ?? 1 })}>{(['manual', 'interval', 'daily', 'weekdays', 'weekly'] as const).map(value => <option key={value} value={value}>{t(`automations.${value}`)}</option>)}</select></label>
          {draft.input.schedule === 'interval' && <label>{t('automations.intervalMinutes')}<input type="number" min={1} max={10080} step={1} required value={draft.input.intervalMinutes ?? 1} onChange={event => update({ intervalMinutes: Number(event.target.value) })} /></label>}
          {!['manual', 'interval'].includes(draft.input.schedule) && <><div className="automation-fields"><label>{t('automations.time')}<input type="time" required value={draft.input.time} onChange={event => update({ time: event.target.value })} /></label><label>{t('automations.timezone')}<input required value={draft.input.timezone} onChange={event => update({ timezone: event.target.value })} /></label></div>
            {draft.input.schedule === 'weekly' && <label>{t('automations.weekday')}<select value={draft.input.weekday} onChange={event => update({ weekday: Number(event.target.value) })}>{Array.from({ length: 7 }, (_, day) => <option key={day} value={day}>{t(`automations.day${day}`)}</option>)}</select></label>}</>}
        </section>
        {!reminder && <><p className="automation-field-hint">{t('automations.permission')}</p><div className="automation-preview-actions"><button type="button" disabled={!valid} onClick={() => void action(async () => { const result = await api.preview(draft.input, draft.id, baseline || undefined); if (useAutomationsStore.getState().draft === draft) setPreview(`${result.base.slice(0, 10)} → ${result.head.slice(0, 10)}\n${result.files.length} ${t('automations.files')}\n${result.files.join('\n')}`) })}>{t('automations.preview')}</button><button type="button" disabled={!valid} onClick={() => void action(() => save(draft.input.enabled, true))}>{t('automations.trial')}</button></div>{preview && <pre className="automation-preview" role="status">{preview}</pre>}</>}
      </>}
      <footer className="automation-inline-footer"><button type="submit" className="automation-primary" disabled={!valid}><Check size={13} />{t('automations.saveTask')}</button>{!draft.input.enabled && <button type="button" disabled={!valid} onClick={() => void action(() => save(true))}>{t('automations.enable')}</button>}</footer>
    </fieldset>
  </form>
}
