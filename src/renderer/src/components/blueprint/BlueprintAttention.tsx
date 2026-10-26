// Note: shared discovery surface, quiet automatic work — see .agents/notes/blueprint/navigation/note-updates-and-suggestion-navigation.md
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { ArrowDown, ArrowUp, Check, RefreshCw, X } from 'lucide-react'
import { useNoteRepairStore, noteRepairKey } from '@/stores/note-repair'
import { repairIsActive } from '../../../../../plugins/blueprint/src/shared/note-repair'
import './note-repair.css'
import { reviewErrorKey } from '@/features/blueprint/review-error'
import { useEditorStore } from '@/stores/editor'
import { useI18n } from '@/i18n/useI18n'
import { markNoteRead, useBlueprintReview, useBlueprintReviewStore } from '@/stores/blueprint-review'
import { useBlueprintActivityStore } from '@/stores/blueprint-review-activity'
import { useBlueprintNavigation } from '@/stores/blueprint-navigation'
import { attentionReviewState, attentionRoots, attentionRows, automaticAttentionGroup, matchesAttention, rowDestination, type AttentionMode, type AttentionRow, type AutomaticAttentionGroup } from '@/features/blueprint/attention-model'
import { BlueprintReviewActivity } from './BlueprintReviewActivity'
import type { Blueprint } from '../../../../../plugins/blueprint/src/shared/janus/types'
import type { BlueprintReviewView } from '../../../../../plugins/blueprint/src/shared/ipc/blueprint-review'
import type { NoteReadResult } from '../../../../../plugins/blueprint/src/shared/blueprint-attention'
import './blueprint-attention.css'

function WatchRoot({ root }: { root: string }) { useBlueprintReview(root); return null }
const automaticGroupOrder: AutomaticAttentionGroup[] = ['completed', 'needsRetry']

export function BlueprintAttention({ blueprint, workspacePath }: { blueprint: Blueprint | null; workspacePath?: string }) {
  const { t, currentLanguage } = useI18n('blueprint')
  const repairs = useNoteRepairStore(state => state.cards)
  const views = useBlueprintReviewStore(state => state.views)
  const statuses = useBlueprintActivityStore(state => state.statuses)
  const statusErrors = useBlueprintActivityStore(state => state.errors)
  const readErrors = useBlueprintReviewStore(state => state.errors)
  const roots = useMemo(() => attentionRoots(blueprint, workspacePath), [blueprint, workspacePath])
  const attentionViews = useMemo(() => Object.fromEntries(roots.flatMap(root => {
    const view = views[root]
    const status = statuses[root]
    const automatic = status?.automatic
    if (!automatic?.context || view && (view.context.branch !== automatic.context.branch || view.context.repoId !== automatic.context.repoId
      || (view.activityRevision ?? -1) > status.revision)) return view ? [[root, view] as const] : []
    const current: BlueprintReviewView = { ...view, context: automatic.context, revision: view?.revision ?? 0,
      sourceComplete: view?.sourceComplete ?? false, items: view?.items ?? [], activities: status.activities,
      automatic, activityRevision: status.revision }
    return [[root, current] as const]
  })) as Record<string, BlueprintReviewView>, [roots, views, statuses])
  const rows = useMemo(() => attentionRows(blueprint, roots, attentionViews), [blueprint, roots, attentionViews])
  const [mode, setMode] = useState<AttentionMode | null>(null)
  const [automaticFilter, setAutomaticFilter] = useState<AutomaticAttentionGroup>('completed')
  const [rootFilter, setRootFilter] = useState('')
  const [query, setQuery] = useState('')
  const [moduleFilter, setModuleFilter] = useState('')
  const [order, setOrder] = useState<string[]>([])
  const [waitingForInitialRows, setWaitingForInitialRows] = useState(false)
  const [selected, setSelected] = useState('')
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [undo, setUndo] = useState<NoteReadResult[]>([])
  const [position, setPosition] = useState<CSSProperties>({})
  const trigger = useRef<HTMLElement | null>(null)
  const panel = useRef<HTMLDivElement | null>(null)
  const epoch = useRef(0)
  const panelEpoch = useRef(0)
  useEffect(() => { panelEpoch.current++; setRefreshing(false) }, [mode, rootFilter])
  const contextKey = roots.map(root => root + ':' + (views[root]?.context.branch ?? '')).join('|')
  const rootsKey = roots.join('|')
  const previousContext = useRef<{ rootsKey: string; contextKey: string; resolved: boolean } | null>(null)
  const latestRows = useRef(rows); latestRows.current = rows
  const updates = rows.filter(row => row.update?.unread).length
  const suggestions = rows.filter(row => row.item?.report?.findings.length || row.structureIssues?.length).length
  // Counts describe the same known rows as the list, independently of background synchronization.
  const updatesReady = Boolean(roots.length) && roots.every(root => views[root]?.updates?.ready)
  const suggestionsReady = Boolean(roots.length) && roots.every(root => views[root] && (!views[root].sourcesPending || views[root].revision > 0 || views[root].updates?.ready))
  const complete = Boolean(roots.length) && roots.every(root => views[root]?.updates?.ready && views[root]?.updates?.complete && !views[root]?.updatesError && !readErrors[root])
  const selectedRoots = useMemo(() => roots.filter(root => !rootFilter || root === rootFilter), [roots, rootFilter])
  const reviewDetailsReady = selectedRoots.every(root => views[root] && !views[root].sourcesPending)
  const syncError = selectedRoots.map(root => mode === 'automatic' ? statusErrors[root] : readErrors[root] || (mode === 'updates' ? views[root]?.updatesError : '')).find(Boolean)
  const close = () => { setMode(null); trigger.current?.focus({ preventScroll: true }) }
  const open = (next: AttentionMode, element: HTMLElement, root = '') => {
    if (mode === next && rootFilter === root) { close(); return }
    trigger.current = element
    const rect = element.getBoundingClientRect()
    const panelHeight = Math.min(480, window.innerHeight - 24)
    setPosition({ left: Math.max(10, Math.min(rect.right - 440, window.innerWidth - 450)),
      top: Math.max(12, Math.min(rect.bottom + 8, window.innerHeight - panelHeight - 12)) })
    setMode(next); setAutomaticFilter(rows.some(row => matchesAttention(row, 'automatic') && (!root || row.root === root) && automaticAttentionGroup(row) === 'needsRetry') ? 'needsRetry' : 'completed'); setRootFilter(root); setQuery(''); setModuleFilter(''); setError(''); setSelected('')
    setOrder(rows.filter(row => matchesAttention(row, next) && (!root || row.root === root)).map(row => row.key))
    setWaitingForInitialRows(roots.some(candidate => (!root || candidate === root) && (!views[candidate] || views[candidate].sourcesPending || next === 'automatic' && !attentionViews[candidate]?.automatic)))
  }
  useEffect(() => {
    const previous = previousContext.current
    const resolved = roots.every(root => Boolean(views[root]?.context))
    previousContext.current = { rootsKey, contextKey, resolved }
    if (!previous || (previous.rootsKey === rootsKey && (!previous.resolved || previous.contextKey === contextKey))) return
    epoch.current++; setMode(null); setUndo([]); setBusy(false); setRefreshing(false); setError('')
  }, [contextKey, rootsKey, roots, views])
  useEffect(() => {
    if (!mode || !waitingForInitialRows) return
    if (!selectedRoots.every(root => attentionViews[root] && (mode !== 'automatic' || attentionViews[root].automatic))) return
    setOrder(rows.filter(row => matchesAttention(row, mode) && (!rootFilter || row.root === rootFilter)).map(row => row.key))
    if (mode === 'automatic') setAutomaticFilter(rows.some(row => (!rootFilter || row.root === rootFilter) && matchesAttention(row, mode) && automaticAttentionGroup(row) === 'needsRetry') ? 'needsRetry' : 'completed')
    if (!selectedRoots.every(root => views[root] && !views[root].sourcesPending)) return
    setWaitingForInitialRows(false)
  }, [mode, waitingForInitialRows, selectedRoots, rootFilter, attentionViews, rows, views])
  useEffect(() => {
    if (!undo.length) return
    const timer = setTimeout(() => setUndo([]), Math.max(0, Math.min(...undo.map(item => item.expiresAt ?? 0)) - Date.now()))
    return () => clearTimeout(timer)
  }, [undo])
  useEffect(() => {
    if (!mode) return
    panel.current?.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true })
    const pointer = (event: PointerEvent) => { if (!panel.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) setMode(null) }
    const resize = () => setMode(null)
    window.addEventListener('pointerdown', pointer); window.addEventListener('resize', resize)
    return () => { window.removeEventListener('pointerdown', pointer); window.removeEventListener('resize', resize) }
  }, [mode])
  // Suggestions and review results follow committed state; unread browsing retains its reading order.
  const orderedRows = mode && mode !== 'updates' ? rows.filter(row => matchesAttention(row, mode) && (!rootFilter || row.root === rootFilter))
    : order.map(key => rows.find(row => row.key === key)).filter((row): row is AttentionRow => Boolean(row))
  const filtered = orderedRows.filter(row => (!moduleFilter || row.module === moduleFilter) && `${row.title} ${row.module} ${row.path}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
  const markableUpdates = filtered.filter(row => row.update?.unread && row.update.available)
  type RowGroup = { key: string; title?: string; finishedAt?: string; rows: AttentionRow[] }
  let groups: RowGroup[] = [{ key: 'rows', rows: filtered }]
  if (mode === 'automatic') {
    const matching = filtered.filter(row => automaticAttentionGroup(row) === automaticFilter)
    if (automaticFilter === 'needsRetry') groups = [{ key: 'needsRetry', rows: matching }]
    else {
      const rounds = selectedRoots.flatMap(root => attentionViews[root]?.automatic?.rounds ?? []).sort((a, b) => b.id - a.id)
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
  const unseen = mode === 'updates' ? rows.filter(row => matchesAttention(row, mode) && (!rootFilter || row.root === rootFilter) && !order.includes(row.key)).length : 0
  const navigate = (row: AttentionRow, findingId?: string) => {
    if (!blueprint || !row.available || !mode) return
    setSelected(row.key)
    if (row.fileOnly) {
      void useEditorStore.getState().openFile(row.root.replace(/[\\/]$/, '') + '/' + row.path, row.root).catch(reason => setError(String(reason)))
      return
    }
    useBlueprintNavigation.getState().navigate(blueprint.id, { ...rowDestination(row, mode), ...(findingId ? { intent: 'finding', findingId } : {}) })
  }
  const handoff = (row: AttentionRow, ids: string[], intent: 'repair' | 'discuss', element: HTMLElement) => {
    if (!row.item?.report) return
    useNoteRepairStore.getState().request({ kind: 'suggestions', intent, context: row.context, noteId: row.noteId, reportRevision: row.item.reportRevision, findingIds: ids }, row.title, row.item.report.findings.filter(finding => ids.includes(finding.id)).map(finding => finding.summary), element)
    setMode(null)
  }
  const refresh = async () => {
    if (refreshing || !mode) return
    const generation = epoch.current, panelGeneration = panelEpoch.current
    setRefreshing(true); setError('')
    try {
      await Promise.all(selectedRoots.map(root => mode === 'automatic'
        ? useBlueprintActivityStore.getState().refresh(root) : useBlueprintReviewStore.getState().refresh(root)))
      if (generation === epoch.current && panelGeneration === panelEpoch.current) setOrder(latestRows.current.filter(row => matchesAttention(row, mode) && (!rootFilter || row.root === rootFilter)).map(row => row.key))
    } catch (reason) { if (generation === epoch.current && panelGeneration === panelEpoch.current) setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { if (generation === epoch.current && panelGeneration === panelEpoch.current) setRefreshing(false) }
  }
  const markAll = async () => {
    if (busy || !markableUpdates.length) return
    const generation = epoch.current
    // Once these rows are acted on, retain them as read even if the initial source sync is pending.
    setWaitingForInitialRows(false)
    setBusy(true); setError('')
    const receipts: NoteReadResult[] = []
    try {
      for (const root of roots) {
        if (generation !== epoch.current) break
        const versions = markableUpdates.filter(row => row.root === root).map(row => row.update!)
        if (versions.length) {
          const result = await markNoteRead(root, versions, true, views[root]?.context)
          if (result?.undoToken) receipts.push(result)
        }
      }
    } catch (reason) { if (generation === epoch.current) setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { if (generation === epoch.current) { setUndo(receipts); setBusy(false) } }
  }
  const undoAll = async () => {
    const generation = epoch.current
    setBusy(true); setError('')
    try {
      for (const item of undo) {
        if (generation !== epoch.current) break
        if (item.undoToken) useBlueprintReviewStore.getState().receiveRead(await window.electron.blueprintReview.undoRead(item.undoToken))
        if (generation === epoch.current) setUndo(remaining => remaining.filter(receipt => receipt !== item))
      }
      if (generation === epoch.current) setUndo([])
    } catch (reason) { if (generation === epoch.current) setError(String(reason)) }
    finally { if (generation === epoch.current) setBusy(false) }
  }
  const selectedIndex = displayRows.findIndex(row => row.key === selected)
  return <div className="bp-attention">
    {roots.map(root => <WatchRoot key={root} root={root} />)}
    {blueprint && <div className="bp-attention__triggers">
      <button type="button" aria-expanded={mode === 'updates'} onClick={event => open('updates', event.currentTarget)}>{t('attention.updates')} <span>{updatesReady ? updates : t('attention.loading')}</span></button>
      <button type="button" aria-expanded={mode === 'suggestions'} onClick={event => open('suggestions', event.currentTarget)}>{t('attention.suggestions')} <span>{suggestionsReady ? suggestions : t('attention.loading')}</span></button>
    </div>}
    <BlueprintReviewActivity blueprint={blueprint} workspacePath={workspacePath} onOpen={(root, element) => open('automatic', element, root)} />
    {mode && createPortal(<div ref={panel} className="bp-attention-panel" style={position} role="dialog" aria-label={t('attention.' + mode)} onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close() }
    }}>
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
          {mode === 'suggestions' && Boolean(row.item?.report?.findings.length) && <div className="bp-repair-actions"><button type="button" disabled={!row.available || !!row.activity || !!repairs[noteRepairKey(row.root)] && repairIsActive(repairs[noteRepairKey(row.root)].phase)} onClick={event => handoff(row, row.item!.report!.findings.map(finding => finding.id), 'repair', event.currentTarget.closest<HTMLElement>('article')!)}>{t('repair.all', { count: row.item!.report!.findings.length })}</button><button type="button" disabled={!row.available || !!row.activity || !!repairs[noteRepairKey(row.root)] && repairIsActive(repairs[noteRepairKey(row.root)].phase)} onClick={event => handoff(row, row.item!.report!.findings.map(finding => finding.id), 'discuss', event.currentTarget.closest<HTMLElement>('article')!)}>{t('repair.discuss')}</button></div>}
          {mode === 'suggestions' && row.item?.report?.findings.map(finding => <div key={finding.id} className="bp-attention-panel__issue">
            <button type="button" className="bp-attention-panel__finding" disabled={!row.available} onClick={() => navigate(row, finding.id)}>{finding.summary}</button>
          </div>)}
          {mode === 'suggestions' && [...new Set(row.structureIssues?.map(issue => issue.path) ?? [])].map(path => {
            const issue = row.structureIssues?.find(issue => issue.path === path)
            return issue?.hash ? <div className="bp-repair-actions" key={path}><button type="button" disabled={!!repairs[noteRepairKey(row.root)] && repairIsActive(repairs[noteRepairKey(row.root)].phase)} onClick={event => {
              useNoteRepairStore.getState().request({ kind: 'structure', intent: 'repair', context: row.context, path, hash: issue.hash! }, row.title, row.structureIssues!.filter(issue => issue.path === path).map(issue => issue.message), event.currentTarget.closest<HTMLElement>('article')!); setMode(null)
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
