import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { BookOpen, ChevronDown, ChevronUp, MoreHorizontal, PanelLeftClose, PanelLeftOpen, Pencil, Plus, Trash2, X } from 'lucide-react'
import { selectedMemoNodeId, useMemoStore } from '@/stores/memo'
import { useExperimentalStore } from '@/stores/experimental'
import { useI18n } from '@/i18n/useI18n'
import { PromptDialog } from '../common/PromptDialog'
import { Select } from '../ui/Select'
import type { Memo, MemoOperation, MemoPoint } from '../../../../shared/memo'
import { useMemoIslandLayout } from './useMemoIslandLayout'
import { islandMotionStyle, useIslandPresence } from '../island/islandMotion'
import { MemoConstellation, type MemoConstellationHandle } from './MemoConstellation'
import type { StarLayout } from './constellationLayout'
import { EditField, PointComposer, type MemoDraft } from './MemoEditor'
import './memo.css'
import './memoIsland.css'

type MemoPanelProps = { onBindMemo: (memoId: string | null) => void; compactTrigger?: boolean }

// Note: disabled previews unmount the editor without deleting or unbinding — see .agents/notes/workbench/experimental-preview-features.md
export function MemoPanel(props: MemoPanelProps) {
  const enabled = useExperimentalStore(state => state.memo)
  const load = useExperimentalStore(state => state.load)
  useEffect(() => { void load() }, [load])
  return enabled ? <EnabledMemoPanel {...props} /> : null
}

function EnabledMemoPanel({ onBindMemo, compactTrigger = false }: MemoPanelProps) {
  const { t } = useI18n('janus')
  const state = useMemoStore()
  const [open, setOpen] = useState(false)
  const liveMemo = state.memos.find(memo => memo.id === state.activeMemoId)
  const lastMemo = useRef(liveMemo)
  if (open) lastMemo.current = liveMemo
  const selected = open ? liveMemo : lastMemo.current
  const drafts = useRef(new Map<string, MemoDraft>()).current
  const layouts = useRef(new Map<string, StarLayout>()).current
  const constellation = useRef<MemoConstellationHandle>(null)
  const [composingPoint, setComposingPoint] = useState<string | null>(null)
  const selectedNodeId = selectedMemoNodeId(selected, state.selectedNodes)
  const selectedNode = selected?.nodes.find(node => node.id === selectedNodeId)
  const nodeIndex = selected?.nodes.findIndex(node => node.id === selectedNodeId) ?? -1
  const selectNode = (id: string | null) => { if (selected) state.selectNode(selected.id, id) }
  const [collapsed, setCollapsed] = useState(false)
  const [filesDrawer, setFilesDrawer] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [dialog, setDialog] = useState<'create' | 'delete' | 'deleteNode' | null>(null)
  const [dialogMemo, setDialogMemo] = useState<Memo | null>(null)
  const dialogBusy = useRef(false)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renamingTitle, setRenamingTitle] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<Memo | null>(null)
  const [targetNodeId, setTargetNodeId] = useState<string | null>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const { present, phase } = useIslandPresence(open)
  const { placement, active, pane, setPane } = useMemoIslandLayout(trigger, present, collapsed, !open)
  const constrainedFiles = Boolean(placement && placement.memo.width < 460)
  const compactFiles = constrainedFiles || collapsed
  const filesVisible = constrainedFiles ? filesDrawer : !collapsed
  const filesPresence = useIslandPresence(filesVisible)
  const panelHidden = !active || (placement?.mode === 'focus' && pane === 'chat')
  useEffect(() => { if (!compactFiles) setFilesDrawer(false) }, [compactFiles])
  useEffect(() => {
    if (!open) return
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest('.memo-select-options')) return
      document.querySelectorAll<HTMLDetailsElement>('.memo-panel details[open]').forEach(menu => {
        if (event.target instanceof Node && !menu.contains(event.target)) menu.open = false
      })
    }
    document.addEventListener('pointerdown', dismiss, true)
    return () => document.removeEventListener('pointerdown', dismiss, true)
  }, [open])
  const api = typeof window === 'undefined' ? undefined : window.electron?.memo
  const { refresh: refreshMemos, receive } = state
  useEffect(() => {
    if (!api) return
    const refresh = () => { void refreshMemos().catch(reason => setError(String(reason))).finally(() => setLoading(false)) }
    refresh()
    return api.onChanged(change => { receive(change.id); refresh() })
  }, [api, refreshMemos, receive])
  if (!api) return null

  const run = async <T,>(action: () => Promise<T>): Promise<T> => {
    try { const result = await action(); setError(null); return result }
    catch (reason) {
      setError(reason instanceof Error && reason.message.includes('MEMO_CONFLICT') ? t('janus:memo.conflict') : String(reason))
      await state.refresh().catch(() => undefined)
      throw reason
    }
  }
  const edit = (memo: Memo, operations: MemoOperation[]) => run(() => state.edit(memo.id, { expectedRevision: memo.revision, operations })).then(result => result.revision)
  const act = (operations: MemoOperation[]) => { if (selected) void edit(selected, operations).catch(() => undefined) }
  const updatedLabel = (updatedAt: number) => {
    const minutes = Math.floor((Date.now() - updatedAt) / 60000)
    if (minutes < 1) return t('janus:memo.time.now')
    if (minutes < 60) return t('janus:memo.time.minutesAgo', { count: minutes })
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return t('janus:memo.time.hoursAgo', { count: hours })
    const days = Math.floor(hours / 24)
    return days < 7 ? t('janus:memo.time.daysAgo', { count: days }) : new Date(updatedAt).toLocaleDateString()
  }
  const fileRow = (memo: Memo) => <div key={memo.id} className="memo-file-row" data-active={selected?.id === memo.id}>
    {renamingId === memo.id
      ? <input autoFocus className="memo-file-rename" aria-label={t('janus:memo.fileTitle')} value={renamingTitle} onChange={event => setRenamingTitle(event.target.value)}
        onKeyDown={event => { if (event.key === 'Escape') setRenamingId(null); if (event.key === 'Enter') { void edit(memo, [{ op: 'rename', title: renamingTitle }]).then(() => setRenamingId(null)).catch(() => undefined) } }}
        onBlur={() => { void edit(memo, [{ op: 'rename', title: renamingTitle }]).then(() => setRenamingId(null)).catch(() => undefined) }} />
      : <button type="button" className="memo-file-main" aria-label={memo.title} title={memo.title} aria-pressed={selected?.id === memo.id} onClick={() => { onBindMemo(memo.id); setFilesDrawer(false) }}>
        <strong><span className="memo-file-name">{memo.title}</span>{state.changedIds.includes(memo.id) && <span className="memo-update-dot" />}</strong>
        <span>{updatedLabel(memo.updatedAt)}</span>
      </button>}
    <div className="memo-file-actions">
      <button type="button" aria-label={t('janus:memo.rename')} title={t('janus:memo.rename')} onClick={() => { setRenamingId(memo.id); setRenamingTitle(memo.title) }}><Pencil size={11} /></button>
      <button type="button" className="danger" aria-label={t('janus:memo.delete')} title={t('janus:memo.delete')} onClick={() => { setDialog('delete'); setDeleteTarget(memo) }}><Trash2 size={11} /></button>
    </div>
  </div>
  const pointView = (point: MemoPoint, nodeId: string, index: number, points: MemoPoint[]) => <div className="memo-point" role="listitem" key={point.id}>
    <span className="memo-point-number" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
    <EditField drafts={drafts} fieldId={`${selected!.id}/${point.id}`} value={point.text} revision={selected!.revision} label={t('janus:memo.pointText')} multiline onSave={(text, revision) => edit({ ...selected!, revision }, [{ op: 'editPoint', pointId: point.id, text }])} />
    <details className="memo-point-menu"><summary aria-label={t('janus:memo.recordActions')} title={t('janus:memo.recordActions')}><MoreHorizontal size={14} /></summary><div className="memo-point-actions">
      <Select role="combobox" ariaLabel={t('janus:memo.movePoint')} className="memo-node-select" dropdownClassName="memo-select-options"
        value={nodeId} options={selected?.nodes.map(node => ({ value: node.id, label: node.title })) ?? []}
        onChange={targetId => { if (targetId !== nodeId) act([{ op: 'movePoint', pointId: point.id, nodeId: targetId }]) }} />
      <button type="button" disabled={index === 0} aria-label={t('janus:memo.up')} onClick={() => act([{ op: 'movePoint', pointId: point.id, nodeId, afterId: index === 1 ? null : points[index - 2].id }])}><ChevronUp size={14} /></button>
      <button type="button" disabled={index === points.length - 1} aria-label={t('janus:memo.down')} onClick={() => act([{ op: 'movePoint', pointId: point.id, nodeId, afterId: points[index + 1].id }])}><ChevronDown size={14} /></button>
      <button type="button" aria-label={t('janus:memo.removePoint')} onClick={() => act([{ op: 'removePoint', pointId: point.id }])}><Trash2 size={13} /></button>
    </div></details>
    {point.source && <small title={`${point.source.conversationId}/${point.source.messageId}`}>{t('janus:memo.chatSource')}</small>}
  </div>
  const addPoint = (nodeId: string) => { setComposingPoint(selected!.id + '/' + nodeId); requestAnimationFrame(() => document.querySelector<HTMLElement>('.memo-point-composer')?.scrollIntoView({ block: 'nearest' })) }
  const addNode = (afterId: string | null) => constellation.current?.insert(afterId)
  const deleteNode = () => { setDialogMemo(selected ?? null); setTargetNodeId(selectedNodeId); setDialog('deleteNode') }
  const clearDialog = () => { setDialog(null); setDialogMemo(null); setDeleteTarget(null) }
  const deletingNode = dialogMemo?.nodes.find(node => node.id === targetNodeId)
  return <>
    <button ref={trigger} type="button" className="memo-trigger" data-compact={compactTrigger || undefined} title={t('janus:memo.open')} aria-label={t('janus:memo.open')} aria-expanded={open} onClick={() => setOpen(value => !value)}><BookOpen size={14} /><span className="memo-trigger-label">{t('janus:memo.title')}</span>{state.changedIds.some(id => id !== selected?.id) && <span className="memo-update-dot" />}</button>
    {open && active && placement?.switcher && createPortal(<div className="memo-view-switch" data-island-companion onPointerDown={event => event.stopPropagation()} role="group" aria-label={t('janus:memo.layoutViews')} style={{ left: placement.switcher.left, top: placement.switcher.top, width: placement.switcher.width, height: placement.switcher.height }}>
      <button type="button" aria-pressed={pane === 'chat'} onClick={() => setPane('chat')}>{t('janus:island.expanded.view.chat')}</button>
      <button type="button" aria-pressed={pane === 'memo'} onClick={() => setPane('memo')}>{t('janus:memo.title')}</button>
    </div>, document.body)}
    {present && placement && createPortal(<aside ref={element => { if (element) element.inert = !open }} className="memo-panel island-surface" data-island-companion data-side="left" data-layout={placement.mode} data-phase={phase} hidden={panelHidden} onPointerDown={event => event.stopPropagation()} aria-label={t('janus:memo.panel')} style={{ ...islandMotionStyle, left: placement.memo.left, top: placement.memo.top, height: placement.memo.height, width: placement.memo.width }} onKeyDown={event => { event.stopPropagation(); if (event.key === 'Escape') { if (filesDrawer) setFilesDrawer(false); else setOpen(false) } }}>
      <header className="memo-shell-header">
        <span><BookOpen size={14} />{t('janus:memo.title')}</span>
        {/* Explicit leave ends the session; automatic layout changes only change visibility. */}
        <button type="button" aria-label={t('janus:memo.close')} title={t('janus:memo.close')} onClick={() => { setOpen(false); setFilesDrawer(false); onBindMemo(null) }}><X size={15} /></button>
      </header>
      <div className="memo-canvas">
      <div className="memo-upper">
      <div className="memo-file-slot" data-compact={compactFiles} data-manual={!constrainedFiles}>
      {compactFiles && <div className="memo-rail" ref={element => { if (element) element.inert = filesDrawer }}>
          <button type="button" aria-label={t('janus:memo.expandFiles')} title={t('janus:memo.expandFiles')} onClick={() => { if (constrainedFiles) setFilesDrawer(true); else setCollapsed(false) }}><PanelLeftOpen size={14} /></button>
          <button type="button" aria-label={t('janus:memo.new')} title={t('janus:memo.new')} onClick={() => setDialog('create')}><Plus size={14} /></button>
        </div>}
      {filesPresence.present && <nav ref={element => { if (element) element.inert = !filesVisible }} className="memo-files" data-drawer={constrainedFiles} data-phase={filesPresence.phase} aria-label={t('janus:memo.files')}>
          <div className="memo-files-header">
            <div><span className="memo-files-kicker">Memo</span><strong>{t('janus:memo.files')}</strong></div>
            <div className="memo-files-actions">
              <button type="button" aria-label={t('janus:memo.collapseFiles')} title={t('janus:memo.collapseFiles')} onClick={() => { if (!constrainedFiles) setCollapsed(true); setFilesDrawer(false) }}><PanelLeftClose size={14} /></button>
              <button type="button" aria-label={t('janus:memo.new')} title={t('janus:memo.new')} onClick={() => setDialog('create')}><Plus size={14} /></button>
            </div>
          </div>
          <div className="memo-files-list">{state.memos.map(fileRow)}</div>
        </nav>}
      </div>
      {constrainedFiles && filesPresence.present && <button ref={element => { if (element) element.inert = !filesDrawer }} type="button" className="memo-drawer-backdrop" data-phase={filesPresence.phase} aria-label={t('janus:memo.collapseFiles')} onClick={() => setFilesDrawer(false)} />}
      <div className="memo-content">{selected ? <div className="memo-document" key={selected.id}>
        {!selectedNode && <div className="memo-title">
          <EditField drafts={drafts} fieldId={`${selected.id}/title`} value={selected.title} revision={selected.revision} label={t('janus:memo.fileTitle')} onSave={(title, revision) => edit({ ...selected, revision }, [{ op: 'rename', title }])} />
        </div>}
        <div className="memo-document-meta"><span>{t('janus:memo.nodeCount', { count: selected.nodes.length })}</span><span>{t('janus:memo.pointCount', { count: selected.nodes.reduce((count, node) => count + node.points.length, 0) })}</span></div>
        {selectedNode && <header className="memo-record-heading" key={selectedNode.id}>
          <div className="memo-record-title">
            <EditField drafts={drafts} fieldId={`${selected.id}/${selectedNode.id}/title`} value={selectedNode.title} revision={selected.revision} label={t('janus:memo.nodeTitle')} onSave={(title, revision) => edit({ ...selected, revision }, [{ op: 'editNode', nodeId: selectedNode.id, title }])} />
            <EditField drafts={drafts} fieldId={`${selected.id}/${selectedNode.id}/label`} value={selectedNode.label} revision={selected.revision} label={t('janus:memo.label')} placeholder={t('janus:memo.labelPlaceholder')} allowEmpty onSave={(label, revision) => edit({ ...selected, revision }, [{ op: 'editNode', nodeId: selectedNode.id, label }])} />
          </div>
          <button className="memo-add-point" type="button" aria-label={t('janus:memo.addPoint')} title={t('janus:memo.addPoint')} onClick={() => addPoint(selectedNode.id)}><Plus size={15} /></button>
          <details className="memo-node-actions"><summary aria-label={t('janus:memo.starActions')} title={t('janus:memo.starActions')}><MoreHorizontal size={15} /></summary><div className="memo-node-menu">
            <button type="button" disabled={nodeIndex === 0} aria-label={t('janus:memo.up')} onClick={() => act([{ op: 'moveNode', nodeId: selectedNode.id, afterId: nodeIndex === 1 ? null : selected.nodes[nodeIndex - 2].id }])}><ChevronUp size={14} />{t('janus:memo.up')}</button>
            <button type="button" disabled={nodeIndex === selected.nodes.length - 1} aria-label={t('janus:memo.down')} onClick={() => act([{ op: 'moveNode', nodeId: selectedNode.id, afterId: selected.nodes[nodeIndex + 1].id }])}><ChevronDown size={14} />{t('janus:memo.down')}</button>
            <button type="button" onClick={() => addNode(nodeIndex === 0 ? null : selected.nodes[nodeIndex - 1].id)}><Plus size={14} />{t('janus:memo.insertBefore')}</button>
            <button type="button" onClick={() => addNode(selectedNode.id)}><Plus size={14} />{t('janus:memo.insertAfter')}</button>
            <button type="button" className="danger" aria-label={t('janus:memo.removeNode')} title={t('janus:memo.removeNodeHint')} onClick={deleteNode}><Trash2 size={13} />{t('janus:memo.removeNode')}</button>
          </div></details>
        </header>}
        <div className="memo-scroll" id={`memo-body-${selected.id}`} role={selectedNode ? 'tabpanel' : undefined} aria-labelledby={selectedNode ? `memo-tab-${selectedNode.id}` : undefined} tabIndex={0}>
        {selectedNode ? <section key={selectedNode.id} className="memo-node">
          {(composingPoint === selected.id + '/' + selectedNode.id || drafts.has(selected.id + '/' + selectedNode.id + '/new-point')) && <PointComposer key={selectedNode.id} drafts={drafts} fieldId={selected.id + '/' + selectedNode.id + '/new-point'} revision={selected.revision} onSave={(text, revision) => edit({ ...selected, revision }, [{ op: 'addPoint', nodeId: selectedNode.id, text }])} onClose={() => setComposingPoint(current => current === selected.id + '/' + selectedNode.id ? null : current)} />}
          {!selectedNode.points.length && composingPoint !== selected.id + '/' + selectedNode.id && <p className="memo-record-empty">{t('janus:memo.emptyRecords')}</p>}
          <div className="memo-record-list" role="list">{selectedNode.points.map((point, pointIndex) => pointView(point, selectedNode.id, pointIndex, selectedNode.points))}</div>
        </section> : <p className="memo-empty">{t('janus:memo.noStars')}</p>}
        </div>
      </div> : <p className="memo-empty" role={loading ? 'status' : undefined}>{t(loading ? 'janus:memo.loading' : 'janus:memo.empty')}</p>}</div>
      </div>
      {selected && <MemoConstellation ref={constellation} key={selected.id} memo={selected} selectedId={selectedNodeId} reveal={open && !panelHidden} layouts={layouts} onSelect={selectNode} onCreate={async (title, afterId, revision) => {
        try { const result = await state.edit(selected.id, { expectedRevision: revision, operations: [{ op: 'addNode', title, afterId }] }); setError(null); return result }
        catch (reason) { await state.refresh().catch(() => undefined); throw reason }
      }} />}
      </div>
      {error && <div className="memo-error" role="alert">{error}<button type="button" onClick={() => { void run(() => state.refresh()).catch(() => undefined) }}>{t('janus:memo.retry')}</button></div>}
    </aside>, document.body)}
    {createPortal(<div data-island-companion hidden={!open || !active} onPointerDown={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}><PromptDialog open={dialog !== null} title={dialog === 'deleteNode' ? t('janus:memo.removeNode') : dialog === 'delete' ? t('janus:memo.delete') : t('janus:memo.new')} confirmOnly={dialog === 'delete' || dialog === 'deleteNode'} description={dialog === 'deleteNode' ? t('janus:memo.deleteStarConfirm', { title: deletingNode?.title ?? '', count: deletingNode?.points.length ?? 0 }) : dialog === 'delete' ? t('janus:memo.deleteConfirm') : undefined} tone={dialog === 'delete' || dialog === 'deleteNode' ? 'danger' : 'primary'} onCancel={clearDialog} onConfirm={value => {
      if (dialogBusy.current) return
      const target = deleteTarget ?? dialogMemo ?? selected
      if (dialog !== 'create' && !target) return
      dialogBusy.current = true
      const action = dialog === 'create' ? () => state.create(value).then(memo => onBindMemo(memo.id))
        : dialog === 'delete' && target ? () => state.remove(target.id, target.revision).then(() => { if (target.id === state.activeMemoId) onBindMemo(null) })
        : () => state.edit(target!.id, { expectedRevision: target!.revision, operations: [{ op: 'removeNode', nodeId: targetNodeId! }] }).then(() => {
          for (const fieldId of drafts.keys()) if (fieldId.startsWith(`${target!.id}/${targetNodeId}/`) || deletingNode?.points.some(point => fieldId === `${target!.id}/${point.id}`)) drafts.delete(fieldId)
        })
      void run(action).then(clearDialog).catch(() => {
        const refreshed = useMemoStore.getState().memos.find(memo => memo.id === target?.id)
        if (dialog === 'delete') setDeleteTarget(refreshed ?? target ?? null)
        else setDialogMemo(refreshed ?? target ?? null)
      }).finally(() => { dialogBusy.current = false })
    }} validate={dialog === 'delete' || dialog === 'deleteNode' ? undefined : value => value.trim() ? null : t('janus:memo.required')} /></div>, document.body)}
  </>
}
