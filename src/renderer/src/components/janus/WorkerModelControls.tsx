import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Settings2, X } from 'lucide-react'
import { Button } from '@janusx/ui'
import type { SuperAgentWorkerSnapshot } from '../../../../shared/superagent-worker'
import type { WorkerModelSettings, WorkerSettingsState } from '../../../../shared/superagent-worker-settings'
import { Select } from '../ui/Select'
import styles from './WorkerModelControls.module.css'
import { useWorkerSettingsText } from '../../lib/worker-settings-text'

export function WorkerModelControls({ worker }: { worker: SuperAgentWorkerSnapshot }) {
  const { t } = useTranslation('janus')
  const { effortLabel, errorText } = useWorkerSettingsText()
  const api = window.electron?.superAgent
  const [settings, setSettings] = useState<WorkerSettingsState>()
  const [model, setModel] = useState(''), [effort, setEffort] = useState<string | null>(null)
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null), dialog = useRef<HTMLDivElement>(null), heading = useId(), panelId = useId()
  const [position, setPosition] = useState<{ left: number; top: number; maxHeight: number }>()
  const close = useCallback((restoreFocus = true) => {
    setOpen(false); setPosition(undefined)
    if (restoreFocus) trigger.current?.focus({ preventScroll: true })
  }, [])
  useLayoutEffect(() => {
    if (!open) return
    const button = trigger.current, panel = dialog.current
    if (!button || !panel) return
    const place = () => {
      const anchor = button.getBoundingClientRect(), width = panel.getBoundingClientRect().width
      const viewportWidth = document.documentElement.clientWidth, viewportHeight = window.innerHeight
      const edge = 12, gap = 6
      if (anchor.bottom <= 0 || anchor.top >= viewportHeight || anchor.right <= 0 || anchor.left >= viewportWidth) { close(false); return }
      const naturalHeight = (panel.querySelector('header')?.getBoundingClientRect().height ?? 0) + (panel.querySelector('[data-worker-model-body]')?.scrollHeight ?? 0) + 2
      const below = Math.max(0, viewportHeight - anchor.bottom - gap - edge), above = Math.max(0, anchor.top - gap - edge)
      const up = below < naturalHeight && above > below
      const maxHeight = Math.min(viewportHeight - edge * 2, up ? above : below)
      const next = { left: Math.max(edge, Math.min(anchor.right - width, viewportWidth - width - edge)),
        top: up ? Math.max(edge, anchor.top - gap - Math.min(naturalHeight, maxHeight)) : anchor.bottom + gap, maxHeight }
      setPosition(current => current && current.left === next.left && current.top === next.top && current.maxHeight === next.maxHeight ? current : next)
    }
    place()
    panel.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true })
    const resize = new ResizeObserver(place); resize.observe(panel); resize.observe(button)
    const onScroll = (event: Event) => { if (!(event.target instanceof Node) || !panel.contains(event.target)) place() }
    window.addEventListener('resize', place); window.addEventListener('scroll', onScroll, true)
    return () => { resize.disconnect(); window.removeEventListener('resize', place); window.removeEventListener('scroll', onScroll, true) }
  }, [open, close])
  useEffect(() => {
    if (!open) return
    // Shared Select consumes Escape while its list is open; the following Escape closes this panel.
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); close() } }
    const onPointer = (event: PointerEvent) => {
      if (!dialog.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) close(false)
    }
    document.addEventListener('keydown', onKeyDown); document.addEventListener('pointerdown', onPointer, true)
    return () => { document.removeEventListener('keydown', onKeyDown); document.removeEventListener('pointerdown', onPointer, true) }
  }, [open, close])
  const edited = useRef(false), request = useRef(0), lock = useRef(false)
  const { conversation } = worker
  const identity = useMemo(() => ({ workspaceId: worker.workspaceId, workId: worker.workId, executionId: worker.executionId }), [worker.workspaceId, worker.workId, worker.executionId])
  const available = !worker.restored && !worker.stopConfirmed && !['stopping', 'stopped', 'failed', 'interrupted'].includes(worker.phase) && conversation.connection === 'ready'
  const accept = useCallback((value: WorkerSettingsState) => {
    setSettings(value)
    if (!edited.current) {
      const selected = value.selection.model ?? conversation.model ?? ''
      setModel(selected)
      const nativeEffort = value.selection.model === null ? conversation.effort : null
      setEffort(value.selection.effort ?? nativeEffort ?? conversation.models.find(row => row.model === selected)?.defaultEffort ?? null)
    }
  }, [conversation.model, conversation.effort, conversation.models])
  useEffect(() => {
    if (!api?.workerSettings || !available) return
    if (lock.current) return
    let cancelled = false
    const revision = ++request.current
    void api.workerSettings(identity).then(value => { if (!cancelled && request.current === revision) accept(value) })
      .catch(value => { if (!cancelled && request.current === revision) setError(String(value)) })
    return () => { cancelled = true }
  }, [api, identity, available, conversation.revision, busy, accept])
  const option = conversation.models.find(row => row.model === model)
  const perform = async (action: () => Promise<WorkerSettingsState>) => {
    if (lock.current) return
    lock.current = true; setBusy(true); setError(''); request.current++
    try { const value = await action(); edited.current = false; accept(value) }
    catch (value) { setError(String(value)) }
    finally { lock.current = false; setBusy(false) }
  }
  const disabled = !available || !settings || busy || conversation.modelsLoading || !api?.configureWorker
  const dirty = edited.current
  const chooseModel = (value: string) => {
    edited.current = true; setModel(value)
    setEffort(conversation.models.find(row => row.model === value)?.defaultEffort ?? null)
  }
  const selection: WorkerModelSettings = { terminal: conversation.engine === 'claude' ? 'claude' : 'codex', model, effort }
  const summary = `${conversation.model ?? t('workerModel.unknown')} · ${effortLabel(conversation.effort)}`
  return <>
    <button ref={trigger} type="button" className={styles.trigger} title={`${t('workerModel.title')}: ${summary}`} aria-label={`${t('workerModel.title')}: ${summary}`} aria-haspopup="dialog" aria-controls={open ? panelId : undefined} aria-expanded={open} onClick={() => { if (open) close(); else setOpen(true) }}>
      <Settings2 size={12} aria-hidden="true" /><span>{summary}</span>
    </button>
    {open && createPortal(<div ref={dialog} id={panelId} role="dialog" aria-modal="false" className={styles.dialog} aria-labelledby={heading}
      style={{ left: position?.left, top: position?.top, maxHeight: position?.maxHeight, visibility: position ? 'visible' : 'hidden' }}>
    <header><h2 id={heading}>{t('workerModel.title')}</h2><button type="button" aria-label={t('workerModel.close')} onClick={() => close()}><X size={16} aria-hidden="true" /></button></header>
    <div className={styles.body} data-worker-model-body="">
      <p>{t('workerModel.current', { model: conversation.model ?? t('workerModel.unknown'), effort: effortLabel(conversation.effort) })}</p>
      <label>{t('workerModel.model')}<Select value={model} disabled={disabled || !conversation.models.length}
        options={conversation.models.map(row => ({ value: row.model, label: row.displayName }))} onChange={chooseModel} ariaLabel={t('workerModel.model')} getPortalContainer={() => dialog.current} /></label>
      <label>{t('workerModel.effort')}<Select value={effort ?? ''} disabled={disabled || !option?.efforts.length}
        options={option?.efforts.length ? option.efforts.map(row => ({ value: row.effort, label: effortLabel(row.effort) })) : [{ value: '', label: effortLabel(null) }]}
        onChange={value => { edited.current = true; setEffort(value || null) }} ariaLabel={t('workerModel.effort')} getPortalContainer={() => dialog.current} /></label>
      {settings && <p role="status">{t(settings.pending ? 'workerModel.pending' : settings.inherited ? 'workerModel.inherited' : 'workerModel.override', { model: settings.selection.model ?? t('workerModel.native'), effort: effortLabel(settings.selection.effort) })}</p>}
      <p>{t('workerModel.timing')}</p>
      <div className={styles.actions}>
        <Button variant="ghost" type="button" disabled={disabled} onClick={() => void perform(() => api!.configureWorker(identity, null))}>{t('workerModel.restore')}</Button>
        <Button variant="primary" type="button" disabled={disabled || !option || !dirty} onClick={() => void perform(() => api!.configureWorker(identity, selection))}>{t('workerModel.save')}</Button>
        <Button variant="ghost" type="button" disabled={!available || busy || !api?.refreshWorkerModels} onClick={() => void perform(() => api!.refreshWorkerModels(identity))}>{t('workerModel.refresh')}</Button>
      </div>
      {(error || settings?.error || conversation.modelsError) && <p role="alert">{t('workerModel.error')}: {errorText(error || settings?.error || conversation.modelsError)}</p>}
    </div>
    </div>, document.body)}
  </>
}
