import { useEffect, useState, type KeyboardEvent, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import type { ConversationInputHandle } from '../ConversationInput'
import { workerShortcutLabel, type WorkerShortcut } from '../../../../shared/worker-shortcuts'
import styles from './WorkerShortcuts.module.css'
import { WorkerShortcutIcon } from './WorkerShortcutIcon'

interface Choice { target: WorkerShortcut; label: string; detail: string; disabled: boolean }
export function useWorkerShortcuts(config: { workspaceId: string | null } | undefined, draft: string, setDraft: (value: string) => void, input: RefObject<ConversationInputHandle>) {
  const { t } = useTranslation('janus')
  const [selected, select] = useState<WorkerShortcut>()
  const [choices, setChoices] = useState<Choice[]>([])
  const [error, setError] = useState(''), [loading, setLoading] = useState(false)
  const [dismissed, dismiss] = useState<string>(), [index, setIndex] = useState(0)
  const [caret, setCaret] = useState(0)
  useEffect(() => {
    if (!config) return
    const changed = () => setCaret(input.current?.selectionStart ?? 0)
    document.addEventListener('selectionchange', changed)
    return () => document.removeEventListener('selectionchange', changed)
  }, [config, input])
  const end = input.current?.selectionStart ?? caret
  const prefix = draft.slice(0, end)
  const match = config && !selected && prefix.match(/(?:^|[\s，。；、\u3400-\u9fff])([#@])([^\s#@]*)$/)
  const trigger = match && (match[1] === '#' || prefix === draft && /^@/.test(draft)) ? match[1] : undefined
  const open = !!trigger && draft !== dismissed
  const query = match ? match[2].toLowerCase() : ''
  const visible = choices.filter(choice => choice.label.toLowerCase().includes(query))
  const workspaceId = config?.workspaceId
  const enabled = !!config
  useEffect(() => { if (!enabled) select(undefined) }, [enabled])
  useEffect(() => { setIndex(0) }, [query, trigger])
  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true); setChoices([]); setError('')
    const api = window.electron.superAgent
    void (async () => {
      if (!api) throw new Error('Worker settings are unavailable')
      const policy = await api.workerPolicy()
      if (trigger === '#') return (['codex', 'claude'] as const).map(backend => ({ target: { kind: 'backend' as const, backend },
        label: backend === 'claude' ? 'Claude Code' : 'Codex', disabled: !policy.enabled.includes(backend),
        detail: !policy.enabled.includes(backend) ? t('shortcuts.disabled') : backend === policy.defaultBackend ? t('shortcuts.default') : t('shortcuts.enabled') }))
      if (!workspaceId) return []
      const [snapshot, workers] = await Promise.all([api.snapshot(workspaceId), api.workers(workspaceId)])
      return snapshot.works.filter(work => work.closedAt === null).map(work => {
        const execution = snapshot.executions.find(row => row.workId === work.id)
        const backend = execution ? execution.backend ?? 'codex' : work.workerBackend ?? policy.defaultBackend
        const worker = workers.find(row => row.workId === work.id)
        return { target: { kind: 'worker' as const, workId: work.id, workspaceId, title: work.title }, label: work.title,
          disabled: !policy.enabled.includes(backend) || worker?.phase === 'stopping',
          detail: `${backend === 'claude' ? 'Claude Code' : 'Codex'} · ${!policy.enabled.includes(backend) ? t('shortcuts.disabled') : worker ? t(`superagent.phase.${worker.phase}`) : t('shortcuts.resume')}` }
      })
    })().then(rows => { if (!cancelled) setChoices(rows) }).catch(value => { if (!cancelled) setError(String(value)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [open, trigger, workspaceId, t])
  const choose = (choice: Choice) => {
    if (choice.disabled) return
    if (choice.target.kind === 'backend') input.current?.insertEngine(choice.target.backend, [end - query.length - 1, end])
    else { select(choice.target); setDraft('') }
    dismiss(undefined)
    requestAnimationFrame(() => input.current?.focus())
  }
  const keyDown = (event: KeyboardEvent) => {
    if (!open || event.nativeEvent.isComposing || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return false
    if (!['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape'].includes(event.key)) return false
    event.preventDefault(); event.stopPropagation()
    if (event.key === 'Escape') dismiss(draft)
    else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') setIndex(value => Math.max(0, Math.min(visible.length - 1, value + (event.key === 'ArrowDown' ? 1 : -1))))
    else if (!loading && visible[index]) choose(visible[index])
    return true
  }
  return { selected: config ? selected : undefined, clear: () => select(undefined), keyDown,
    control: config ? <>
      {!selected && !draft && <small className={styles.hint}>{t('shortcuts.hint')}</small>}
      {selected && <div className={styles.selection} data-worker-selection>
        <span className={styles.tag} title={workerShortcutLabel(selected)}><WorkerShortcutIcon target={selected} /><span>{workerShortcutLabel(selected)}</span></span><small>{t(selected.kind === 'worker' ? 'shortcuts.directHint' : 'shortcuts.backendHint')}</small>
        <button type="button" aria-label={t('shortcuts.remove')} onClick={() => { select(undefined); requestAnimationFrame(() => input.current?.focus()) }}><X size={12} /></button>
      </div>}
      {open && <div className={styles.menu} role="listbox" aria-label={t('shortcuts.choose')} data-worker-shortcuts>
        {loading ? <div role="status">{t('shortcuts.loading')}</div> : error ? <div role="alert">{error}</div> : !visible.length ? <div>{t('shortcuts.empty')}</div> : visible.map((choice, i) => <button type="button" role="option"
          key={workerShortcutLabel(choice.target) + (choice.target.kind === 'worker' ? choice.target.workId : '')} aria-selected={i === index} disabled={choice.disabled}
          onPointerDown={event => event.preventDefault()} onMouseEnter={() => setIndex(i)} onClick={() => choose(choice)}>
          <span className={styles.icon} aria-hidden="true"><WorkerShortcutIcon target={choice.target} size={18} /></span>
          <span className={styles.copy}><span className={styles.label}>{choice.label}</span><small>{choice.detail}</small></span>
        </button>)}
      </div>}
    </> : null,
  }
}
