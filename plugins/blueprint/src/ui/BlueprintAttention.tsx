// Original attention panel DOM, styling and ordering; plugin-owned reads/writes.
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ArrowDown, ArrowUp, Check, RefreshCw, X } from './WorkbenchIcons'
import { blueprintText as t } from './blueprint-text'
import { reviewErrorKey } from './graph/review-error'
import { attentionReviewState, attentionRoots, attentionRows, automaticAttentionGroup, matchesAttention, type AttentionMode, type AttentionRow, type AutomaticAttentionGroup } from './graph/attention-model'
import type { Blueprint } from '../shared/janus/types'
import type { BlueprintReviewView } from '../shared/ipc/blueprint-review'
import type { NoteRepairInput } from '../shared/note-repair'
import type { NoteVersion } from '../shared/blueprint-attention'
import './blueprint-attention.css'

const automaticGroupOrder: AutomaticAttentionGroup[] = ['completed', 'needsRetry']
export function BlueprintAttention({ blueprint, review, busy: operationBusy, activityTrigger, select, repair, refresh: reload, mark, undoRead, openFile }: {
  blueprint?: Blueprint; review?: BlueprintReviewView; busy: boolean; activityTrigger?: ReactNode
  select(row: AttentionRow, mode: AttentionMode, findingId?: string): void; repair(input: NoteRepairInput): void
  refresh(): Promise<void>; mark(versions: NoteVersion[]): Promise<void>; undoRead?: () => Promise<void>
  openFile(path: string, hash?: string): Promise<void>
}) {
  const currentLanguage = document.documentElement.lang
  const roots = attentionRoots(blueprint ?? null, review?.context.workspacePath)
  const views = review ? Object.fromEntries(roots.map(root => [root, review])) : {}
  const attentionViews = views
  const rows = useMemo(() => attentionRows(blueprint ?? null, roots, views), [blueprint, review])
  const [mode, setMode] = useState<AttentionMode | null>(null)
  const [automaticFilter, setAutomaticFilter] = useState<AutomaticAttentionGroup>('completed')
  const [query, setQuery] = useState(''), [moduleFilter, setModuleFilter] = useState('')
  const [order, setOrder] = useState<string[]>([]), [selected, setSelected] = useState('')
  const [error, setError] = useState(''), [refreshing, setRefreshing] = useState(false), [pending, setPending] = useState(false)
  const busy = operationBusy || pending
  const [position, setPosition] = useState<CSSProperties>({})
  const trigger = useRef<HTMLElement | null>(null), panel = useRef<HTMLDivElement | null>(null)
  const awaitingRows = useRef(false)
  const updates = rows.filter(row => row.update?.unread).length
  const suggestions = rows.filter(row => row.item?.report?.findings.length || row.structureIssues?.length).length
  const updatesReady = Boolean(review?.updates?.ready)
  const suggestionsReady = Boolean(review && (!review.sourcesPending || review.revision > 0 || review.updates?.ready))
  const complete = Boolean(review?.updates?.ready && review.updates.complete && !review.updatesError)
  const selectedRoots = roots
  const reviewDetailsReady = Boolean(review && !review.sourcesPending)
  const syncError = mode === 'updates' ? review?.updatesError : ''
  const undo = undoRead ? [true] : []
  const close = () => { setMode(null); trigger.current?.focus({ preventScroll: true }) }
  const open = (next: AttentionMode, element: HTMLElement) => {
    if (mode === next) { close(); return }
    trigger.current = element
    const rect = element.getBoundingClientRect(), height = Math.min(480, innerHeight - 24)
    setPosition({ left: Math.max(10, Math.min(rect.right - 440, innerWidth - 450)), top: Math.max(12, Math.min(rect.bottom + 8, innerHeight - height - 12)) })
    setMode(next); setQuery(''); setModuleFilter(''); setError(''); setSelected('')
    setAutomaticFilter(rows.some(row => matchesAttention(row, 'automatic') && automaticAttentionGroup(row) === 'needsRetry') ? 'needsRetry' : 'completed')
    setOrder(rows.filter(row => matchesAttention(row, next)).map(row => row.key))
    awaitingRows.current = !review || Boolean(review.sourcesPending)
  }
  useEffect(() => {
    if (!mode) return
    panel.current?.querySelector('input')?.focus({ preventScroll: true })
    const pointer = (event: PointerEvent) => { if (!panel.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) close() }
    // Navigation can disable its focused button. Escape must still dismiss the
    // panel before the workbench's own close shortcut handles the key.
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault(); event.stopPropagation(); close()
    }
    const resize = () => setMode(null)
    window.addEventListener('pointerdown', pointer); window.addEventListener('resize', resize); window.addEventListener('keydown', escape, true)
    return () => { window.removeEventListener('pointerdown', pointer); window.removeEventListener('resize', resize); window.removeEventListener('keydown', escape, true) }
  }, [mode])
  useEffect(() => {
    if (!mode || !awaitingRows.current || !reviewDetailsReady) return
    setOrder(rows.filter(row => matchesAttention(row, mode)).map(row => row.key)); awaitingRows.current = false
  }, [review, mode, rows, reviewDetailsReady])
  useEffect(() => { setMode(null); setError('') }, [review?.context.repoId, review?.context.branch])
  // Suggestions and review results follow committed state; unread browsing retains its reading order.
  const orderedRows = mode && mode !== 'updates' ? rows.filter(row => matchesAttention(row, mode))
    : order.map(key => rows.find(row => row.key === key)).filter((row): row is AttentionRow => Boolean(row))
  const filtered = orderedRows.filter(row => (!moduleFilter || row.module === moduleFilter) && `${row.title} ${row.module} ${row.path}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
  const markableUpdates = filtered.filter(row => row.update?.unread && row.update.available)
  type RowGroup = { key: string; title?: string; finishedAt?: string; rows: AttentionRow[] }
  let groups: RowGroup[] = [{ key: 'rows', rows: filtered }]
  if (mode === 'automatic') {
    const matching = filtered.filter(row => automaticAttentionGroup(row) === automaticFilter)
    if (automaticFilter === 'needsRetry') groups = [{ key: 'needsRetry', rows: matching }]
    else {
      const rounds = selectedRoots.flatMap(root => views[root]?.automatic?.rounds ?? []).sort((a, b) => b.id - a.id)
      const ids = [...new Set([...rounds.map(round => round.id), ...matching.flatMap(row => row.target?.round === undefined ? [] : [row.target.round])])].sort((a, b) => b - a)
      groups = ids.map(id => {
        const index = rounds.findIndex(round => round.id === id)
        return { key: 'round-' + id, title: t(index < 0 ? 'attention.round.current' : index === 0 ? 'attention.round.latest' : 'attention.round.previous'),
          finishedAt: rounds.find(round => round.id === id)?.finishedAt, rows: matching.filter(row => row.target?.round === id) }
      })
      const legacy = matching.filter(row => row.target?.round === undefined)
      if (legacy.length) groups.push({ key: 'legacy', title: t('attention.round.legacy'), rows: legacy })
    }
  }
  const displayRows = groups.flatMap(group => group.rows)
  const unseen = mode === 'updates' ? rows.filter(row => matchesAttention(row, mode) && !order.includes(row.key)).length : 0
  const navigate = (row: AttentionRow, findingId?: string) => {
    if (!row.available || !mode) return
    setSelected(row.key)
    if (row.fileOnly) { void openFile(row.path, row.structureIssues?.[0]?.hash).catch(error => setError(String(error))); return }
    select(row, mode, findingId)
  }
  const handoff = (row: AttentionRow, ids: string[], intent: 'repair' | 'discuss', _element: HTMLElement) => {
    if (!row.item?.report) return
    repair({ kind: 'suggestions', intent, context: row.context, noteId: row.noteId, reportRevision: row.item.reportRevision, findingIds: ids }); close()
  }
  const refresh = async () => {
    setRefreshing(true); setError(''); awaitingRows.current = true
    try { await reload() }
    catch (error) { setError(String(error)) }
    finally { setRefreshing(false) }
  }
  const markAll = async () => {
    if (busy || !markableUpdates.length) return
    setPending(true); setError(''); awaitingRows.current = false
    try { await mark(markableUpdates.map(row => ({ noteId: row.noteId, hash: row.update!.hash, path: row.update!.path }))) }
    catch (error) { setError(String(error)) }
    finally { setPending(false) }
  }
  const undoAll = async () => {
    setPending(true); setError('')
    try { await undoRead?.() }
    catch (error) { setError(String(error)) }
    finally { setPending(false) }
  }
  const selectedIndex = displayRows.findIndex(row => row.key === selected)
  return <div className="bp-attention">
    {blueprint && <div className="bp-attention__triggers">
      <button type="button" aria-expanded={mode === 'updates'} onClick={event => open('updates', event.currentTarget)}>{t('attention.updates')} <span>{updatesReady ? updates : t('attention.loading')}</span></button>
      <button type="button" aria-expanded={mode === 'suggestions'} onClick={event => open('suggestions', event.currentTarget)}>{t('attention.suggestions')} <span>{suggestionsReady ? suggestions : t('attention.loading')}</span></button>
    </div>}
    {activityTrigger && <button type="button" className="blueprint-review-activity" aria-label={t('review.title')} aria-expanded={mode === 'automatic'} onClick={event => open('automatic', event.currentTarget)}>{activityTrigger}</button>}
    {mode && createPortal(<div ref={panel} className="bp-attention-panel" style={position} role="dialog" aria-label={t('attention.' + mode)}>
      <header><strong>{t('attention.' + mode)}</strong><button type="button" onClick={close} aria-label={t('attention.close')}><X size={15} /></button></header>
      <div className="bp-attention-panel__filters"><input value={query} onChange={event => setQuery(event.target.value)} placeholder={t('attention.search')} aria-label={t('attention.search')} />
        <select value={moduleFilter} onChange={event => setModuleFilter(event.target.value)} aria-label={t('attention.module')}><option value="">{t('attention.allModules')}</option>{[...new Set(orderedRows.map(row => row.module).filter(Boolean))].map(module => <option key={module}>{module}</option>)}</select></div>
      {mode === 'automatic' && <div className="bp-attention-panel__categories" role="group" aria-label={t('attention.automatic')}>
        {automaticGroupOrder.map(key => <button type="button" key={key} aria-pressed={automaticFilter === key} onClick={() => { setAutomaticFilter(key); setSelected('') }}>
          {t('attention.group.' + key)} <span>{orderedRows.filter(row => automaticAttentionGroup(row) === key).length}</span>
        </button>)}
      </div>}
      <div className="bp-attention-panel__summary"><span>{mode === 'automatic' ? automaticFilter === 'completed' ? t('attention.round.retention') : query || moduleFilter ? t('attention.count', { count: displayRows.length, total: orderedRows.filter(row => automaticAttentionGroup(row) === automaticFilter).length }) : '' : t('attention.count', { count: displayRows.length, total: orderedRows.length })}</span>
        <button type="button" aria-label={t(refreshing ? 'action.refreshing' : 'attention.refresh')} aria-busy={refreshing} disabled={refreshing} onClick={() => void refresh()}>
          <RefreshCw size={13} className={refreshing ? 'bp-attention-panel__refreshing' : undefined} />{unseen ? t('attention.newItems', { count: unseen }) : ''}
        </button>
      </div>
      {(syncError || mode === 'updates' && !complete || !reviewDetailsReady) && <p className="bp-attention-panel__notice" role="status">{syncError || t('attention.syncing')}</p>}
      {mode === 'automatic' && selectedRoots.map(root => {
        const automatic = attentionViews[root]?.automatic
        const workspaceFailure = automatic?.reason && !['review-failed'].includes(automatic.reason)
        return automatic?.lastRun || workspaceFailure ? <details key={root} className="bp-attention-panel__notice bp-attention-panel__history">
          <summary>{workspaceFailure ? t('review.activity.reason.' + automatic.reason) : t('attention.runDetails')}</summary>
          {automatic.lastRun && <p>{t('attention.lastRun', { findings: automatic.lastRun.findings, failed: automatic.lastRun.failed })}</p>}
          {workspaceFailure && automatic.error && <p>{automatic.error}</p>}
        </details> : null
      })}
      <div className="bp-attention-panel__list">
        {!displayRows.length && !groups.some(group => group.title) && !syncError && reviewDetailsReady && (mode === 'suggestions' || complete) && <p className="bp-attention-panel__empty">{t('attention.empty')}</p>}
        {groups.map(group => <section key={group.key ?? 'rows'} className="bp-attention-panel__group" data-group={automaticFilter}>
          {group.title && <h3 className="bp-attention-panel__round"><span>{group.title} · {group.rows.length}</span><small>{group.finishedAt ? new Date(group.finishedAt).toLocaleString(currentLanguage) : t('attention.round.timeUnknown')}</small></h3>}
          {group.title && !group.rows.length && <p className="bp-attention-panel__empty">{t('attention.round.empty')}</p>}
          {group.rows.map(row => <article key={row.key} data-selected={row.key === selected} data-read={mode === 'updates' && !row.update?.unread}>
          <button type="button" className="bp-attention-panel__target" disabled={!row.available} onClick={() => navigate(row)}><span>{row.title}</span>
            {mode === 'updates' && !row.update?.unread ? <Check size={14} /> : <span className="bp-attention-panel__tag">{mode === 'updates' ? t('attention.' + row.update?.change) : mode === 'automatic' ? t('attention.state.' + attentionReviewState(row)) : row.structureIssues?.length ? t('review.structure.invalid') : t('attention.findings', { count: row.item?.report?.findings.length ?? 0 })}</span>}
          </button>
          <small>{[roots.length > 1 ? row.root.replace(/\\/g, '/').split('/').pop() : '', row.module, mode === 'updates' && !row.update?.unread ? t('attention.read') : ''].filter(Boolean).join(' · ') || row.path}</small>
          {!row.available && <p>{t('attention.unavailable')}</p>}
          {row.item?.report?.stale && mode === 'suggestions' && <p>{t('review.stale')}</p>}
          <>{(mode === 'automatic' || mode === 'suggestions') && Boolean(row.structureIssues?.length) && <details className="bp-attention-panel__reason"><summary>{t('review.failure.structure')}</summary>{row.structureIssues?.map((issue, index) => <p key={index}>{issue.field || issue.path}: {issue.message}</p>)}</details>}
          {mode === 'automatic' && row.target?.state === 'failed' && row.target.error && !row.structureIssues?.length && <details className="bp-attention-panel__reason"><summary>{t(reviewErrorKey(row.target.error))}</summary><p>{row.target.error}</p></details>}
          {mode === 'automatic' && row.target?.state === 'incomplete' && <small>{t('attention.state.incomplete')}</small>}</>
          {mode === 'suggestions' && Boolean(row.item?.report?.findings.length) && <div className="bp-repair-actions"><button type="button" disabled={!row.available || !!row.activity || busy} onClick={event => handoff(row, row.item!.report!.findings.map(finding => finding.id), 'repair', event.currentTarget.closest<HTMLElement>('article')!)}>{t('repair.all', { count: row.item!.report!.findings.length })}</button><button type="button" disabled={!row.available || !!row.activity || busy} onClick={event => handoff(row, row.item!.report!.findings.map(finding => finding.id), 'discuss', event.currentTarget.closest<HTMLElement>('article')!)}>{t('repair.discuss')}</button></div>}
          {mode === 'suggestions' && row.item?.report?.findings.map(finding => <div key={finding.id} className="bp-attention-panel__issue">
            <button type="button" className="bp-attention-panel__finding" disabled={!row.available} onClick={() => navigate(row, finding.id)}>{finding.summary}</button>
          </div>)}
          {mode === 'suggestions' && [...new Set(row.structureIssues?.map(issue => issue.path) ?? [])].map(path => {
            const issue = row.structureIssues?.find(issue => issue.path === path)
            return issue?.hash ? <div className="bp-repair-actions" key={path}><button type="button" disabled={busy} onClick={() => {
              repair({ kind: 'structure', intent: 'repair', context: row.context, path, hash: issue.hash! }); close()
            }}>{t('repair.format')}</button></div> : null
          })}
          </article>)}
        </section>)}
      </div>
      <footer>
        <div className="bp-attention-panel__sequence"><button type="button" aria-label={t('attention.previous')} disabled={selectedIndex <= 0} onClick={() => navigate(displayRows[selectedIndex - 1])}><ArrowUp size={14} /></button><button type="button" aria-label={t('attention.next')} disabled={!displayRows.length || selectedIndex >= displayRows.length - 1} onClick={() => navigate(displayRows[selectedIndex + 1])}><ArrowDown size={14} /></button></div>
        {mode === 'updates' && <details className="bp-attention-panel__menu"><summary>{t('attention.actions')}</summary><button type="button" disabled={busy || !markableUpdates.length} aria-busy={busy} onClick={() => void markAll()}>{t(busy ? 'attention.markingRead' : 'attention.markAll', { count: markableUpdates.length })}</button></details>}
        {!!undo.length && <button type="button" disabled={busy} onClick={() => void undoAll()}>{t('attention.undo')}</button>}
      </footer>
      {error && <p className="bp-attention-panel__notice" role="alert">{error}</p>}
    </div>, document.body)}
  </div>
}
