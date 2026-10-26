// Note: the single control surface for the blueprint panel — see
// .agents/notes/blueprint/maintenance/blueprint-dispatch-panel.md
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Blueprint } from '@/services/blueprint'
import { bindTerminal, composeDispatchBrief } from '@/services/blueprint'
import type { TerminalPreset, Workspace } from '@/types'
import { useBlueprintMaintenanceStore } from '@/stores/blueprint-maintenance'
import { useBlueprintStore } from '@/stores/blueprint'
import { useWorkspaceStore } from '@/stores/workspace'
import { useAppStore } from '@/stores/app'
import { projectGraph } from '@/services/harness'
import { sameCheckoutPath } from '@/features/blueprint/resolveNodeWorkspace'
import { launchTerminalPreset, warmDefaultShellCache, warmTerminalCreatePath } from '@/lib/terminal-launch'
import { getTerminalPresetMeta } from '../../../../shared/terminalLaunch'
import type { BlueprintMaintenanceScope } from '../../../../../plugins/blueprint/src/shared/janus/maintenance-types'
import { Select } from '../ui/Select'
import { TerminalPresetIcon } from '../ui/TerminalPresetIcon'
import { useBlueprintSelectPortal } from './blueprintSelectPortal'
import { MaintenanceApproval } from './MaintenanceApproval'
import { MaintenanceFileReview } from './MaintenanceFileReview'
import { bulkApproval, maintenanceSelection } from './maintenanceSelection'
import { resolveMaintenanceContext } from './maintenanceContext'
import { useI18n } from '@/i18n/useI18n'
import type { UseJanusChatReturn } from '../janus/useJanusChat'
import styles from './BlueprintActionBar.module.css'

const DEFAULT_DISPATCH_PRESET: TerminalPreset = 'codex'
const DISPATCH_PRESETS: TerminalPreset[] = ['janus', 'claude', 'codex', 'opencode', 'pi', 'dsh', 'shell']

const closed = (status: string) => status === 'completed' || status === 'cancelled'

interface DispatchReceipt {
  preset: TerminalPreset
  noteCount: number
  goal: string
  reused: boolean
}

export interface BlueprintActionBarProps {
  chat: UseJanusChatReturn
  blueprint: Blueprint
  workspace: Workspace
  ownerPath: string | null
  /** Writable scope resolved from canvas focus; never inferred from one node. */
  nodeScope: BlueprintMaintenanceScope
  /** Quiet read-scope chip: how many Notes this conversation is carrying. */
  noteCount: number
  /** The focused batch resolved to zero Notes in this checkout. */
  sourceUnavailable: boolean
  /** Checkout that owns the unreadable batch; the switch target. */
  switchPath: string | null
  /** Matched Notes living in another checkout. */
  foreignCount: number
  /** Matched Notes cut by the per-turn ref cap. */
  droppedCount: number
  onReviewOpenChange: (open: boolean) => void
}

/**
 * Three deliberate verbs — organize the Notes, choose the terminal, dispatch —
 * and nothing else on the surface. Discussion happens in the composer; the
 * terminal is the brief's review surface, so dispatch is one click rather than
 * generate-then-confirm. Pinned above the composer so a pending approval never
 * scrolls away with the transcript.
 */
export function BlueprintActionBar(props: BlueprintActionBarProps) {
  const { chat, blueprint, workspace, ownerPath, nodeScope, noteCount, sourceUnavailable, switchPath, foreignCount, droppedCount } = props
  const { t } = useI18n('blueprint')
  const store = useBlueprintMaintenanceStore()
  const selectPortal = useBlueprintSelectPortal()
  const workspaces = useWorkspaceStore((state) => state.workspaces)
  const terminals = useWorkspaceStore((state) => state.terminals)
  const [target, setTarget] = useState<{ graphId: string; scope: BlueprintMaintenanceScope } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const [preset, setPreset] = useState<TerminalPreset>(DEFAULT_DISPATCH_PRESET)
  const [dispatching, setDispatching] = useState(false)
  const [receipt, setReceipt] = useState<DispatchReceipt | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false)
  const [approvalWanted, setApprovalWanted] = useState(false)
  const [hiddenReview, setHiddenReview] = useState<string | null>(null)
  const actionLock = useRef(false)
  const alive = useRef(true)
  const latestChat = useRef(chat)
  latestChat.current = chat

  const scopeType = nodeScope.type
  const scopeNodeId = nodeScope.type === 'blueprint' ? null : nodeScope.nodeId
  const sourceWorkspace = switchPath ? workspaces.find(item => sameCheckoutPath(item.path, switchPath)) : undefined
  const unreadableHere = sourceUnavailable && !!switchPath && !!sourceWorkspace && !sameCheckoutPath(workspace.path, switchPath)

  const initialize = store.initialize
  const loadAudits = store.loadAudits
  const task = store.tasks.find(item => item.conversationId === chat.conversationId
    && item.workspaceId === workspace.id && !closed(item.status))
    ?? store.tasks.find(item => item.blueprintId === target?.graphId && !closed(item.status))
  const working = busy || chat.isStreaming || task?.status === 'analyzing' || task?.status === 'applying'
  const proposal = task?.status === 'proposal-ready' ? task.changeSet : null
  const reviewKey = proposal ? JSON.stringify(proposal) : null
  const reviewOpen = !sourceUnavailable && !!reviewKey && hiddenReview !== reviewKey
  const { onReviewOpenChange } = props
  useEffect(() => {
    onReviewOpenChange(reviewOpen)
    return () => onReviewOpenChange(false)
  }, [reviewOpen, onReviewOpenChange])
  const pendingUndo = store.pendingUndo?.changeSet.blueprintId === target?.graphId ? store.pendingUndo : null
  const audits = target ? store.audits[target.graphId] ?? [] : []
  const taskMatches = !!target && (!task || (task.conversationId === chat.conversationId && task.blueprintId === target.graphId
    && JSON.stringify(task.nodeScope) === JSON.stringify(target.scope)))
  const hasUserMessage = chat.messages.some(message => message.role === 'user' && message.content.trim())
  // A stale task read a Note baseline that no longer holds; regenerating from it
  // would propose against facts the host has already rejected.
  const stale = task?.status === 'stale'

  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  useEffect(() => {
    let current = true
    setTarget(null)
    setError(null)
    if (unreadableHere) return
    void (async () => {
      await initialize()
      const failure = useBlueprintMaintenanceStore.getState().error
      if (failure) throw new Error(failure)
      if (scopeType === 'node' || scopeType === 'subtree') {
        const context = await resolveMaintenanceContext(blueprint, scopeNodeId!, ownerPath)
        if (context.stale) throw new Error(t('blueprint:maintenance.sourceChanged'))
        if (!sameCheckoutPath(context.checkoutPath, workspace.path)) throw new Error(t('blueprint:maintenance.sourceUnavailable'))
        return { graphId: context.graphId, scope: { type: 'node', nodeId: context.nodeId } as BlueprintMaintenanceScope }
      }
      const view = await projectGraph(workspace.path)
      if (!view || view.blueprint.id !== blueprint.id) throw new Error(t('blueprint:maintenance.sourceUnavailable'))
      return { graphId: view.blueprint.id, scope: { type: 'blueprint' } as BlueprintMaintenanceScope }
    })().then(result => {
      if (!current || !result) return
      setTarget(result)
      void loadAudits(result.graphId)
    }).catch(reason => { if (current) setError(String(reason instanceof Error ? reason.message : reason)) })
    return () => { current = false }
  }, [blueprint, scopeType, scopeNodeId, ownerPath, workspace.path, unreadableHere, refresh, t, initialize, loadAudits])

  // A receipt describes one conversation at one scope; a new one invalidates it.
  useEffect(() => { setReceipt(null); setConfirmBulkDelete(false); setApprovalWanted(false) },
    [chat.conversationId, target?.graphId, scopeType, scopeNodeId])

  const bulkResult = useMemo(() => {
    if (!proposal) return { selection: null, error: null }
    try {
      const selection = bulkApproval(proposal)
      return { selection: confirmBulkDelete ? { ...selection, operations: maintenanceSelection(proposal, proposal.operations.map(op => op.operationId)), blockedDeletes: [] } : selection, error: null }
    } catch (reason) { return { selection: null, error: reason instanceof Error ? reason.message : String(reason) } }
  }, [proposal, confirmBulkDelete])
  const bulk = bulkResult.selection
  // A proposal nothing can approve in bulk is a dead end, so a blocked deletion
  // forces the detail view open; otherwise it stays collapsed behind a button.
  const detailForced = !!proposal && !!bulk?.blockedDeletes.length
  const showApproval = !!proposal && (detailForced || approvalWanted)

  const run = useCallback(async (action: () => Promise<void>) => {
    if (actionLock.current || working) return
    actionLock.current = true
    setBusy(true)
    setError(null)
    try { await action() }
    catch (reason) { if (alive.current) setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { actionLock.current = false; if (alive.current) setBusy(false) }
  }, [working])

  const checkResult = useCallback((ok: boolean | void) => {
    const failure = useBlueprintMaintenanceStore.getState().error
    if (ok === false || failure) throw new Error(failure ?? t('blueprint:maintenance.operationFailed'))
  }, [t])

  /**
   * The maintenance task is the conversation's authorized scope, so both the
   * proposal and the brief need one. Bootstrapping here (rather than only on
   * "organize") is what lets a user discuss, dispatch, and never touch a Note.
   */
  const ensureTask = useCallback(async (): Promise<string | null> => {
    if (!target || !taskMatches) return null
    const goal = [...chat.messages].reverse().find(message => message.role === 'user')?.content.trim()
    if (!goal || !chat.activeModel) return null
    if (task) return task.id
    const history = chat.messages
    const started = await store.start({ blueprintId: target.graphId, conversationId: chat.conversationId,
      workspaceId: workspace.id, workspaceName: workspace.name, workspacePath: workspace.path,
      nodeScope: target.scope, goal }) ?? undefined
    if (!started) { checkResult(false); return null }
    if (!alive.current || latestChat.current.messages !== history || latestChat.current.isStreaming) {
      await store.cancel(started.id)
      if (alive.current) throw new Error(t('blueprint:maintenance.conversationChanged'))
      return null
    }
    return started.id
  }, [target, taskMatches, chat, task, store, workspace, checkResult, t])

  const organize = useCallback(async () => {
    setHiddenReview(null)
    const id = await ensureTask()
    if (!id || !alive.current) return
    chat.proposeMaintenance(id, t('blueprint:maintenance.proposalPrompt'))
  }, [chat, ensureTask, t])

  /**
   * One verb: Janus writes the brief from the involved Notes, the host opens or
   * reuses the target terminal, and the brief lands prefilled. Nothing is
   * submitted — the terminal is where the user reads it and presses Enter.
   */
  const dispatch = useCallback(async () => {
    if (dispatching || !chat.activeModel) return
    setDispatching(true)
    setError(null)
    try {
      const taskId = await ensureTask()
      if (!taskId) throw new Error(t('blueprint:maintenance.finishOtherTarget'))
      const resources = chat.resourceController.resources
      const brief = await composeDispatchBrief({
        taskId,
        conversationId: chat.conversationId,
        messages: chat.messages.map((message) => ({ role: message.role, content: message.content })),
        providerId: chat.activeModel.providerId,
        modelId: chat.activeModel.modelId,
        workspaceIds: resources.map((resource) => resource.workspaceId),
        workspaceRoots: Object.fromEntries(resources.map((resource) => [resource.workspaceId, resource.workspacePath])),
      })
      if (!alive.current) return
      const anchorNodeId = brief.anchorNodeId
      const blueprintId = target?.graphId ?? blueprint.id
      // Reuse the anchor's live terminal when there is one; only the brief travels.
      const existing = anchorNodeId ? terminals.find((terminal) => terminal.id === blueprint.nodes[anchorNodeId]?.boundTerminalId) : undefined
      if (existing) {
        window.electron.terminal.input(existing.id, brief.text)
        useWorkspaceStore.getState().setActiveTerminal(existing.id)
        useAppStore.getState().setLoadState('terminal-active')
      } else {
        const launched = await launchTerminalPreset({
          preset,
          workspaceId: workspace.id,
          workspacePath: workspace.path,
          name: getTerminalPresetMeta(preset).name,
          initialInput: brief.text,
        })
        if (!launched) throw new Error(t('blueprint:maintenance.dispatch.createFailed'))
        if (!launched.ok) throw new Error(`${t('blueprint:maintenance.dispatch.createFailed')}: ${launched.error}`)
        if (anchorNodeId) {
          // Binding re-arms the existing terminal-close analysis on this node.
          await bindTerminal(workspace.path, anchorNodeId, launched.terminalId)
          await useBlueprintStore.getState().focusNode({
            blueprintId,
            nodeId: anchorNodeId,
            workspaceId: workspace.id,
            workspaceName: workspace.name,
            workspacePath: workspace.path,
          })
        }
      }
      if (alive.current) {
        setReceipt({ preset, noteCount: brief.brief.noteRefs.length, goal: brief.brief.goal, reused: !!existing })
      }
    } catch (reason) {
      if (alive.current) setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      if (alive.current) setDispatching(false)
    }
  }, [dispatching, chat, ensureTask, preset, terminals, target?.graphId, blueprint, workspace, t])

  const warm = useCallback((next: TerminalPreset) => {
    if (next === 'shell') warmDefaultShellCache()
    else warmTerminalCreatePath([next])
  }, [])

  const applyAll = useCallback(async (previewId: string) => {
    if (!proposal || !bulk || !task) return
    await run(async () => {
      const ids = bulk.operations.map((op) => op.operationId)
      // Deletions only ride a bulk approval behind one explicit acknowledgement.
      const confirmed = confirmBulkDelete
        ? bulk.operations.filter((op) => op.type === 'delete-node').map((op) => op.operationId)
        : []
      checkResult(await store.apply({ taskId: task.id, changeSetId: proposal.id, previewId, operationIds: ids, confirmedDeleteOperationIds: confirmed }))
    })
    setConfirmBulkDelete(false)
  }, [proposal, bulk, task, confirmBulkDelete, run, store, checkResult])

  const applySelected = useCallback(async (operationIds: string[], confirmedDeleteOperationIds: string[], previewId?: string) => {
    if (!proposal || !task) return
    await run(async () => {
      checkResult(await store.apply({ taskId: task.id, changeSetId: proposal.id, previewId, operationIds, confirmedDeleteOperationIds }))
    })
  }, [proposal, task, run, store, checkResult])

  const presetOptions = DISPATCH_PRESETS.map((type) => ({
    value: type,
    label: getTerminalPresetMeta(type).label,
    icon: <TerminalPresetIcon preset={type} style={{ width: 14, height: 14 }} />,
  }))

  if (sourceUnavailable) {
    return <div className={styles.bar} role="toolbar" aria-label={t('blueprint:maintenance.actionsAria')} data-state="blocked">
      <p className={styles.warn}>
        {sourceWorkspace ? t('blueprint:maintenance.scopeForeignBlocked') : t('blueprint:maintenance.sourceUnavailable')}
      </p>
      {sourceWorkspace && <button type="button" disabled={working}
        onClick={() => useWorkspaceStore.getState().setActiveWorkspace(sourceWorkspace.id)}>
        {t('blueprint:maintenance.switchToSource', { name: sourceWorkspace.name })}
      </button>}
    </div>
  }

  const applyDisabled = working || !proposal || !bulk?.operations.length || !!bulk?.blockedDeletes.length
  const reviewContext = task && proposal ? {
    taskId: task.id, changeSetId: proposal.id, conversationId: chat.conversationId,
    workspaceId: workspace.id, workspacePath: workspace.path,
  } : undefined

  return <div className={styles.bar} role="toolbar" aria-label={t('blueprint:maintenance.actionsAria')}
    data-review-open={reviewOpen}
    data-state={proposal ? 'proposal' : dispatching ? 'dispatching' : 'idle'}>
    <div className={styles.row}>
      <button type="button" className={styles.primary} disabled={working || stale || !hasUserMessage || !taskMatches}
        onClick={() => void run(organize)} title={t('blueprint:maintenance.organizeHint')}>
        {task?.status === 'analyzing' ? t('blueprint:maintenance.organizing') : t('blueprint:maintenance.organize')}
      </button>
      {proposal && <button type="button" aria-pressed={reviewOpen} onClick={() => setHiddenReview(reviewOpen ? reviewKey : null)}>
        {t(reviewOpen ? 'blueprint:maintenance.reviewDiscussion' : 'blueprint:maintenance.reviewDocument')}
      </button>}
      <span onMouseEnter={() => warm(preset)}>
        <Select
          value={preset}
          onChange={(value) => setPreset(value as TerminalPreset)}
          options={presetOptions}
          prefix={<TerminalPresetIcon preset={preset} style={{ width: 16, height: 16 }} />}
          getPortalContainer={selectPortal ? () => selectPortal : undefined}
          ariaLabel={t('blueprint:maintenance.dispatch.presetAria')}
        />
      </span>
      <button type="button" disabled={working || stale || dispatching || !hasUserMessage || !taskMatches || !chat.activeModel}
        onClick={() => void dispatch()} title={t('blueprint:maintenance.dispatch.hint')}>
        {dispatching ? t('blueprint:maintenance.dispatch.dispatching') : t('blueprint:maintenance.dispatch.dispatch')}
      </button>
      <span className={styles.chip} title={t('blueprint:maintenance.noteCountAria', { count: noteCount })}>
        {t('blueprint:maintenance.noteCount', { count: noteCount })}
      </span>
      <button type="button" className={styles.more} aria-expanded={expanded} onClick={() => setExpanded(value => !value)}
        title={t('blueprint:maintenance.moreActions')}>
        {t('blueprint:maintenance.more')}
      </button>
    </div>

    {(!hasUserMessage || foreignCount > 0 || droppedCount > 0) && <p className={styles.hint}>
      {!hasUserMessage ? t('blueprint:maintenance.policyHint') : ''}
      {foreignCount > 0 ? t('blueprint:maintenance.scopeForeign', { count: foreignCount }) : ''}
      {droppedCount > 0 ? t('blueprint:maintenance.scopeDropped', { count: droppedCount }) : ''}
    </p>}
    {error && <p className={styles.warn} role="alert">{error}</p>}
    {bulkResult.error && <p className={styles.warn} role="alert">{bulkResult.error}</p>}
    {/* A failed source read leaves the verbs dead; refresh is the way back. */}
    {(store.error || (!target && error)) && <div className={styles.row}>
      <button type="button" disabled={working} onClick={() => void run(async () => {
        await useBlueprintStore.getState().refreshAfterAnalysis()
        const failure = useBlueprintStore.getState().error
        if (failure) throw new Error(failure)
        if (alive.current) setRefresh(value => value + 1)
      })}>
        {t('blueprint:action.refresh')}
      </button>
    </div>}
    {task && <p className={styles.status} role="status">{task.phase}</p>}
    {task?.error && !error && <p className={styles.warn} role="alert">{task.error}</p>}
    {task?.status === 'active' && task.changeSetHistory.at(-1)?.status === 'rejected' && <p className={styles.hint} role="status">
      {t('blueprint:maintenance.reviewOutdated')}
    </p>}
    {receipt && <p className={styles.status} role="status">
      {t('blueprint:maintenance.dispatch.receipt', { preset: getTerminalPresetMeta(receipt.preset).label, count: receipt.noteCount })}
      {' · '}
      {t('blueprint:maintenance.dispatch.prefillOnly')}
    </p>}

    {proposal && bulk && reviewContext && <div className={styles.proposal} hidden={!reviewOpen}>
      <p className={styles.proposalHead}>
        {t('blueprint:maintenance.pendingProposal', { version: proposal.version })}
        {!confirmBulkDelete && bulk.excludedDeletes.length > 0 && ` · ${t('blueprint:maintenance.deleteBulkExcluded', { count: bulk.excludedDeletes.length })}`}
      </p>
      <p>{proposal.reason}</p>
      <p className={styles.hint}>{t('blueprint:maintenance.reviewHint')}</p>
      {bulk.blockedDeletes.length > 0 && <p className={styles.warn}>
        {t('blueprint:maintenance.deleteBlocked', { count: bulk.blockedDeletes.length })}
      </p>}
      <div className={styles.row}>
        {bulk.excludedDeletes.length > 0 && <label className={styles.danger}>
          <input type="checkbox" checked={confirmBulkDelete} disabled={working}
            onChange={event => setConfirmBulkDelete(event.target.checked)} />
          {t('blueprint:maintenance.deleteConfirmAll', { count: bulk.excludedDeletes.length })}
        </label>}
        <button type="button" aria-expanded={showApproval} onClick={() => setApprovalWanted(value => !value)}>
          {t('blueprint:maintenance.approvePartial')}
        </button>
      </div>
      {showApproval ? <MaintenanceApproval key={JSON.stringify(proposal)} changeSet={proposal} busy={!!working} onApply={applySelected} reviewContext={reviewContext} />
        : <MaintenanceFileReview key={JSON.stringify(proposal)} input={{ ...reviewContext, operationIds: bulk.operations.map(op => op.operationId) }}
          disabled={!!applyDisabled} label={t('blueprint:maintenance.approveAll', { count: bulk.operations.length })} onApply={applyAll} />}
    </div>}

    {task && expanded && <div className={styles.row}>
      <button type="button" disabled={working} onClick={() => void run(async () => {
        if (proposal) await store.dismiss({ taskId: task.id })
        else await store.complete(task.id)
        checkResult()
        if (alive.current) setRefresh(value => value + 1)
      })}>
        {proposal ? t('blueprint:maintenance.cancelTask') : t('blueprint:maintenance.completeMaintenance')}
      </button>
    </div>}

    {expanded && target && <details className={styles.history}>
      <summary>{t('blueprint:maintenance.auditHistory')}{store.error ? '' : ` · ${audits.length}`}</summary>
      {audits.length === 0 && !store.error && <p>{t('blueprint:maintenance.auditEmpty')}</p>}
      {audits.map(audit => <div key={audit.id}>
        <p>{audit.changeSetSnapshot.reason} · {t('blueprint:maintenance.auditOperations', { count: audit.selectedOperationIds.length })}</p>
        <p>{t('blueprint:maintenance.auditRevision', { before: audit.beforeRevision, after: audit.afterRevision })}</p>
        <button type="button" disabled={working || !!task || audit.status !== 'applied'}
          onClick={() => void run(async () => { checkResult(await store.prepareUndo(audit.blueprintId, audit.id)) })}>
          {t('blueprint:maintenance.undoAction')}
        </button>
      </div>)}
      {task && audits.length > 0 && <p>{t('blueprint:maintenance.undoBlockedActive')}</p>}
      {pendingUndo && <>
        {pendingUndo.conflicts.map(conflict => <p key={conflict}>{conflict}</p>)}
        <MaintenanceApproval changeSet={pendingUndo.changeSet} busy={!!working || !!task} undo
          onApply={async (operationIds, confirmed) => { await run(async () => {
            checkResult(await store.applyUndo({ blueprintId: pendingUndo.changeSet.blueprintId, undoChangeSetId: pendingUndo.changeSet.id, operationIds, confirmedDeleteOperationIds: confirmed }))
          }) }} />
        <button type="button" disabled={working} onClick={store.clearPendingUndo}>{t('blueprint:maintenance.undoCancel')}</button>
      </>}
    </details>}
  </div>
}
