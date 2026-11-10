import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronRight, Clock3, Folder, Pencil, Play, Plus, Power, Trash2, Workflow } from 'lucide-react'
import { JanusEye } from '../janus/JanusEye'
import { PromptDialog } from '../common/PromptDialog'
import { AutomationTaskEditor } from './AutomationTaskEditor'
import { AutomationTaskHistory } from './AutomationTaskHistory'
import { isReminder, reminderTemplate, type AutomationCard, type AutomationDefinition, type AutomationRun } from '../../../../shared/automations'
import { useRightToolStore } from '@/stores/right-tools'
import { activateAutomationCompanion, receiveAutomationRemoval, useAutomationsStore } from '@/stores/automations'
import { useIslandStore } from '@/stores/island'
import { useI18n } from '@/i18n/useI18n'
import './automations.css'

type DeleteTarget = { kind: 'card' | 'task'; id: string; revision: number; name: string; taskIds: string[]; active: boolean }
export function AutomationPanel() {
  const { t } = useI18n('common'), api = window.electron.automations
  const draft = useAutomationsStore(state => state.draft), setDraft = useAutomationsStore(state => state.setDraft), draftSequence = useAutomationsStore(state => state.draftSequence)
  const focus = useRightToolStore(state => state.focusRequest)
  const islandLinked = useIslandStore(state => state.stage === 'expanded' && state.companionToolId === 'automations')
  const [cards, setCards] = useState<AutomationCard[]>([]), [tasks, setTasks] = useState<AutomationDefinition[]>([])
  const [selected, setSelected] = useState<string | null>(null), [closedCards, setClosedCards] = useState<string[]>([])
  const [runs, setRuns] = useState<AutomationRun[]>([]), [runId, setRunId] = useState<string | null>(null)
  const [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const [cardPrompt, setCardPrompt] = useState<{ card?: AutomationCard } | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null)
  const refreshSequence = useRef(0), panelRef = useRef<HTMLElement>(null)
  const hasDraft = Boolean(draft)
  const refresh = useCallback(async () => {
    if (!api) return
    const sequence = ++refreshSequence.current
    const [nextCards, nextTasks] = await Promise.all([api.listCards(), api.list()])
    const exists = nextTasks.some(task => task.id === selected), history = selected && exists ? await api.history(selected) : []
    if (sequence !== refreshSequence.current) return
    setCards(nextCards); setTasks(nextTasks); setRuns(history)
    if (selected && !exists) { setSelected(null); setRunId(null) }
  }, [api, selected])
  useEffect(() => {
    const sequence = refreshSequence
    void refresh().catch(error => setError(String(error)))
    const unsubscribe = api?.onChanged(() => { void refresh().catch(error => setError(String(error))) })
    return () => { sequence.current++; unsubscribe?.() }
  }, [api, refresh])
  useEffect(() => {
    if (focus?.toolId !== 'automations') return
    setSelected(focus.itemId); setRunId(focus.runId ?? null); setDraft(null)
    useRightToolStore.getState().consumeFocus(focus.sequence)
  }, [focus, setDraft])
  useEffect(() => {
    if (selected) panelRef.current?.querySelector(`[data-task-id="${CSS.escape(selected)}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [selected, tasks])
  useLayoutEffect(() => {
    const scroll = panelRef.current?.querySelector('.automation-scroll')
    if (!scroll || !hasDraft) return
    const revealEditor = () => {
      const editor = panelRef.current?.querySelector('.automation-editor')
      if (editor) scroll.scrollTop = editor.closest('.automation-draft-card') ? 0 : scroll.scrollTop + editor.getBoundingClientRect().top - scroll.getBoundingClientRect().top
    }
    revealEditor()
    // The companion panel shrinks when Island stacks above it in narrow windows.
    const resize = new ResizeObserver(revealEditor); resize.observe(scroll)
    return () => resize.disconnect()
  }, [draftSequence, draft?.id, draft?.input.cardId, hasDraft, cards.length])
  const action = async (fn: () => Promise<void>) => { setBusy(true); setError(''); try { await fn() } catch (error) { setError(String(error)) } finally { setBusy(false) } }
  const createTask = (cardId: string) => {
    setDraft({ input: { ...reminderTemplate(), cardId, name: t('automations.newTaskTitle'), schedule: 'manual', tasks: [] } })
    setSelected(null); setError('')
  }
  const editTask = (task: AutomationDefinition) => {
    const { id, revision, root: _root, createdAt: _created, nextRunAt: _next, ...input } = task
    setDraft({ id, revision, input }); setSelected(id); setError('')
  }
  const prepareDelete = async (kind: DeleteTarget['kind'], item: AutomationCard | AutomationDefinition) => {
    const taskIds = kind === 'task' ? [item.id] : tasks.filter(task => task.cardId === item.id).map(task => task.id)
    const histories = await Promise.all(taskIds.map(id => api!.history(id)))
    setDeleteTarget({ kind, id: item.id, revision: item.revision, name: item.name, taskIds, active: histories.flat().some(run => ['running', 'queued'].includes(run.state)) })
  }
  const remove = async () => {
    if (!deleteTarget || busy) return
    await action(async () => {
      try {
        if (deleteTarget.kind === 'card') await api!.removeCard(deleteTarget.id, deleteTarget.revision)
        else await api!.remove(deleteTarget.id, deleteTarget.revision)
      } catch (error) {
        if (String(error).includes('revision_conflict')) { setDeleteTarget(null); await refresh(); throw new Error(t('automations.deleteConflict')) }
        throw error
      }
      deleteTarget.taskIds.forEach(receiveAutomationRemoval)
      if (deleteTarget.kind === 'card' && useAutomationsStore.getState().draft?.input.cardId === deleteTarget.id) setDraft(null)
      setDeleteTarget(null); await refresh()
    })
  }
  const scheduleLabel = (task: AutomationDefinition) => task.schedule === 'interval' ? `${t('automations.interval')} · ${task.intervalMinutes} ${t('automations.minutes')}` : task.schedule === 'manual' ? t('automations.manual') : `${t(`automations.${task.schedule}`)}${task.schedule === 'weekly' ? ` · ${t(`automations.day${task.weekday}`)}` : ''} · ${task.time}`
  const draftCardId = draft?.input.cardId ?? tasks.find(task => task.id === draft?.id)?.cardId
  const editor = draft && <AutomationTaskEditor key={`${draft.id ?? 'new'}:${draft.input.cardId ?? ''}:${draftSequence}`} draft={draft} cards={cards} busy={busy} action={action} onSaved={(task, run) => { setSelected(task.id); setRunId(run ?? null); void refresh().catch(error => setError(String(error))) }} />
  return <section ref={panelRef} className="automation-panel" data-island-linked={islandLinked} aria-label={t('automations.title')} aria-busy={busy}>
    <header className="automation-header"><div className="automation-heading"><h2>{t('automations.title')}</h2><span className="automation-count">{tasks.length}</span></div>
      <div className="automation-header-actions"><button className="automation-island-control" aria-pressed={islandLinked} title={t(islandLinked ? 'automations.closeIsland' : 'automations.openIslandHint')} aria-label={t(islandLinked ? 'automations.closeIsland' : 'automations.openIsland')} onClick={() => islandLinked ? useIslandStore.getState().dispatch({ type: 'dismiss' }) : activateAutomationCompanion()}><span aria-hidden="true"><JanusEye mode="order" className="automation-island-eyes" /></span></button>
        <button className="automation-text-button" disabled={busy || !api} onClick={() => { setError(''); setCardPrompt({}) }}><Plus size={14} />{t('automations.new')}</button></div>
    </header>
    <div className="automation-scroll">
      {error && !deleteTarget && !cardPrompt && <p role="alert" className="automation-error">{error}</p>}
      {!api && <p role="status" className="automation-muted">{t('automations.unavailable')}</p>}
      {draft && !cards.some(card => card.id === draftCardId) && <article className="automation-card automation-draft-card">{editor}</article>}
      {api && !cards.length && !draft && <div className="automation-empty"><Workflow size={28} strokeWidth={1.25} /><h3>{t('automations.emptyTitle')}</h3><p>{t('automations.empty')}</p></div>}
      <div className="automation-list">{cards.map(card => {
        const children = tasks.filter(task => task.cardId === card.id), containsDraft = draftCardId === card.id
        const open = !closedCards.includes(card.id) || containsDraft || children.some(task => task.id === selected)
        return <article key={card.id} className={`automation-card automation-group${open ? ' selected' : ''}`} data-card-id={card.id}>
          <div className="automation-group-heading"><button className="automation-card-title" aria-expanded={open} aria-controls={`automation-card-${card.id}`} onClick={() => { setClosedCards(value => open ? [...value.filter(id => id !== card.id), card.id] : value.filter(id => id !== card.id)); if (children.some(task => task.id === selected)) setSelected(null) }}><Folder size={14} /><span>{card.name}</span><span className="automation-count">{children.length}</span><ChevronRight size={13} /></button>
            <button className="automation-icon-button" disabled={busy} aria-label={t('automations.renameCard')} title={t('automations.renameCard')} onClick={() => { setError(''); setCardPrompt({ card }) }}><Pencil size={13} /></button>
            <button className="automation-icon-button automation-delete" disabled={busy} aria-label={t('automations.deleteCard')} title={t('automations.deleteCard')} onClick={() => void action(() => prepareDelete('card', card))}><Trash2 size={13} /></button></div>
          {open && <div id={`automation-card-${card.id}`} className="automation-group-body">
            {!children.length && !containsDraft && <p className="automation-card-empty">{t('automations.emptyCard')}</p>}
            {children.map(task => <article className={`automation-task-card${selected === task.id ? ' selected' : ''}`} key={task.id} data-task-id={task.id}>
              {draft?.id === task.id ? editor : <><div className="automation-task-card-heading"><button className="automation-task-title" aria-expanded={selected === task.id} onClick={() => { setSelected(selected === task.id ? null : task.id); setRunId(null) }}><span>{task.name}</span><ChevronRight size={13} /></button><span className="automation-status" data-state={task.enabled ? 'enabled' : 'disabled'}>{t(task.enabled ? 'automations.enabled' : 'automations.disabled')}</span></div>
                <p className="automation-task-description automation-task-excerpt">{isReminder(task) ? task.tasks[0].message : t('automations.stepCount', { count: task.tasks.length })}</p>
                <span className="automation-schedule" title={task.timezone}><Clock3 size={12} />{scheduleLabel(task)}</span>
                <div className="automation-task-card-actions"><button className="automation-text-button" disabled={busy} onClick={() => editTask(task)}><Pencil size={12} />{t('automations.editTask')}</button>
                  <button className="automation-icon-button" role="switch" aria-checked={task.enabled} aria-label={t('automations.taskEnabled', { name: task.name })} title={t(task.enabled ? 'automations.disable' : 'automations.enableTask')} disabled={busy} onClick={() => void action(async () => { const { id, revision, root: _root, createdAt: _created, nextRunAt: _next, ...input } = task; await api!.save({ ...input, enabled: !task.enabled }, id, revision); await refresh() })}><Power size={13} /></button>
                  <button className="automation-icon-button automation-delete" disabled={busy} aria-label={t('automations.deleteTask')} title={t('automations.deleteTask')} onClick={() => void action(() => prepareDelete('task', task))}><Trash2 size={13} /></button>
                  <button className="automation-text-button" disabled={busy} onClick={() => void action(async () => { const run = await api!.run(task.id, crypto.randomUUID()); setSelected(task.id); setRunId(run.id); await refresh() })}><Play size={12} />{t('automations.run')}</button></div>
                {task.nextRunAt && <small className="automation-next">{t('automations.next')} · {new Date(task.nextRunAt).toLocaleString()}</small>}
                {selected === task.id && <AutomationTaskHistory runs={runs.filter(run => run.definitionId === task.id)} runId={runId} setRunId={setRunId} busy={busy} cancel={id => void action(() => api!.cancel(id))} />}
              </>}
            </article>)}
            {containsDraft && !draft?.id && editor}
            <button className="automation-add-task" disabled={busy || Boolean(draft)} onClick={() => createTask(card.id)}><Plus size={14} />{t('automations.addTask')}</button>
          </div>}
        </article>
      })}</div>
      <p className="automation-local"><Clock3 size={13} />{t('automations.localOnly')}</p>
    </div>
    {createPortal(<div data-island-companion><PromptDialog open={Boolean(cardPrompt)} busy={busy} title={t(cardPrompt?.card ? 'automations.renameCard' : 'automations.new')} label={t('automations.cardName')} defaultValue={cardPrompt?.card?.name ?? ''} validate={name => name.length > 120 ? t('automations.nameTooLong') : null} description={error ? <p role="alert">{error}</p> : undefined} confirmText={t('automations.save')} onCancel={() => { if (!busy) { setCardPrompt(null); setError('') } }} onConfirm={name => void action(async () => {
      const card = await api!.saveCard(name, cardPrompt?.card?.id, cardPrompt?.card?.revision)
      setClosedCards(value => value.filter(id => id !== card.id)); setCardPrompt(null); await refresh()
    })} />
      <PromptDialog open={Boolean(deleteTarget)} confirmOnly tone="danger" busy={busy} title={t('automations.deleteTitle', { name: deleteTarget?.name ?? '' })} description={<><p>{t(deleteTarget?.kind === 'card' ? 'automations.deleteDescription' : 'automations.deleteTaskDescription')}</p>{deleteTarget?.active && <p>{t('automations.deleteActive')}</p>}{error && <p role="alert">{error}</p>}</>} confirmText={t(busy ? 'automations.deleting' : deleteTarget?.active ? 'automations.stopAndDelete' : deleteTarget?.kind === 'card' ? 'automations.deleteCard' : 'automations.deleteTask')} onConfirm={() => void remove()} onCancel={() => { if (!busy) { setDeleteTarget(null); setError('') } }} /></div>, document.body)}
  </section>
}
