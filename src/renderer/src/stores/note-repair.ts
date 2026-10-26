// Note: selected issues move into the workspace Janus conversation — see .agents/notes/blueprint/navigation/note-updates-and-suggestion-navigation.md
import { create } from 'zustand'
import { useBlueprintMaintenanceStore } from './blueprint-maintenance'
import { useBlueprintStore } from './blueprint'
import { useWorkspaceStore } from './workspace'
import { useBlueprintReviewStore } from './blueprint-review'
import { noteSourceKey, useNoteSourceStore } from './note-source'
import { sameCheckoutPath } from '@/features/blueprint/resolveNodeWorkspace'
import { repairIsActive, type NoteRepairInput, type NoteRepairPlan, type NoteRepairUpdate } from '../../../../plugins/blueprint/src/shared/note-repair'

export const noteRepairKey = (root: string) => root.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()

export type RepairSyncPart = 'source' | 'suggestions'
export type RepairSyncState = { state: 'loading' | 'ready' | 'error'; error?: string }
export interface RepairCardState extends NoteRepairUpdate {
  transferId: string; input: NoteRepairInput; plan?: NoteRepairPlan; title: string; summaries: string[]
  source?: { x: number; y: number; width: number; height: number }
  sync?: Partial<Record<RepairSyncPart, RepairSyncState>>; previewHash?: string; conversationId?: string; started?: boolean; transferred?: boolean; reverted?: boolean; reviewOnly?: boolean
}
interface State {
  cards: Record<string, RepairCardState>
  request(input: NoteRepairInput, title: string, summaries: string[], element?: HTMLElement): void
  start(root: string, id: string, conversationId: string): boolean
  receive(update: NoteRepairUpdate): void
  cancel(root: string): void
  transferred(root: string, id: string): void
  retry(root: string): Promise<void>
  retryReview(root: string): Promise<void>
  refresh(root: string, part?: RepairSyncPart): Promise<void>
}
let stopRepairEvents: (() => void) | undefined
const syncRequests = new Map<string, Promise<void>>()
const message = (error: unknown) => error instanceof Error ? error.message : String(error)
export const useNoteRepairStore = create<State>((set, get) => ({
  cards: {},
  request(input, title, summaries, element) {
    // Keep final host evidence subscribed even when chat.stop removes its stream listener.
    if (!stopRepairEvents) stopRepairEvents = window.electron.llm?.onAgentEvent?.(event => {
      if (event.type === 'note_repair') get().receive(event.update)
    })
    const root = noteRepairKey(input.context.workspacePath)
    const workspace = useWorkspaceStore.getState().workspaces.find(item => item.id === useWorkspaceStore.getState().activeWorkspaceId)
    if (!workspace || !sameCheckoutPath(workspace.path, root)) return
    if (get().cards[root] && repairIsActive(get().cards[root].phase)) return
    const id = crypto.randomUUID(), rect = element?.getBoundingClientRect()
    set(state => ({ cards: { ...state.cards, [root]: { id, transferId: id, input, title, summaries, phase: 'preparing',
      source: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : undefined } } }))
    const blueprint = useBlueprintStore.getState().currentBlueprint
    if (blueprint) useBlueprintMaintenanceStore.getState().requestOpen({ blueprintId: blueprint.id })
    void window.electron.blueprintReview.repairPrepare(input).then(plan => {
      if (get().cards[root]?.id !== id || get().cards[root]?.phase !== 'preparing') return
      set(state => ({ cards: { ...state.cards, [root]: { ...state.cards[root], id: plan.id, plan, title: plan.title, summaries: plan.summaries, phase: 'queued' } } }))
    }).catch(error => {
      if (get().cards[root]?.id === id && get().cards[root]?.phase === 'preparing') get().receive({ id, phase: 'failed', error: message(error) })
    })
  },
  start(root, id, conversationId) {
    root = noteRepairKey(root)
    const card = get().cards[root]
    if (!card?.plan || card.id !== id || card.started || card.phase !== 'queued') return false
    set(state => ({ cards: { ...state.cards, [root]: { ...card, started: true, conversationId, phase: 'reading' } } }))
    return true
  },
  receive(update) {
    const pair = Object.entries(get().cards).find(([, card]) => card.id === update.id)
    if (!pair) return
    const [root, card] = pair
    // A cancelled client still accepts host evidence of a write or final cancellation.
    if (['cancelled', 'failed'].includes(card.phase) && update.changed && update.phase !== 'reverted') {
      set(state => ({ cards: { ...state.cards, [root]: { ...card, changed: true, afterHash: update.afterHash ?? card.afterHash } } }))
      if (!repairIsActive(update.phase)) void get().refresh(root)
      else if (update.afterHash && update.afterHash !== card.afterHash) void get().refresh(root, 'source')
      return
    }
    if (!repairIsActive(card.phase) && update.phase !== 'reverted' && !(card.phase === 'cancelled' && update.phase === 'cancelled')) return
    set(state => ({ cards: { ...state.cards, [root]: { ...card, ...update, ...(update.phase === 'reverted' ? { error: update.error } : {}) } } }))
    if (!repairIsActive(update.phase)) void get().refresh(root)
    else if (update.changed && update.afterHash && update.afterHash !== card.afterHash) void get().refresh(root, 'source')
  },
  cancel(root) {
    root = noteRepairKey(root)
    const card = get().cards[root]
    if (card && repairIsActive(card.phase)) get().receive({ id: card.id, phase: 'cancelled' })
  },
  transferred(root, id) {
    root = noteRepairKey(root)
    const card = get().cards[root]
    if (card?.id === id) set(state => ({ cards: { ...state.cards, [root]: { ...card, transferred: true } } }))
  },
  async retry(root) {
    root = noteRepairKey(root)
    const card = get().cards[root]
    if (!card || repairIsActive(card.phase)) return
    await get().refresh(root, 'suggestions')
    if (get().cards[root]?.sync?.suggestions?.state === 'error') return
    const view = useBlueprintReviewStore.getState().views[card.input.context.workspacePath]
    if (!view) return
    if (view.context.repoId !== card.input.context.repoId || view.context.branch !== card.input.context.branch) {
      set(state => ({ cards: { ...state.cards, [root]: { ...card, error: '工作区或分支已变化，请从建议栏重新选择问题' } } }))
      return
    }
    const old = card.input
    const item = old.kind === 'suggestions' ? view.items.find(item => item.noteId === old.noteId) : undefined
    const ids = item?.report?.findings.map(finding => finding.id) ?? []
    const issue = old.kind === 'structure' ? view.structure?.issues.find(issue => issue.path === old.path) : undefined
    if (old.kind === 'suggestions' && item && ids.length) get().request({ ...old, context: view.context, reportRevision: item.reportRevision, findingIds: ids }, card.title, card.summaries)
    else if (old.kind === 'structure' && issue?.hash) get().request({ ...old, context: view.context, hash: issue.hash }, card.title, card.summaries)
    else set(state => ({ cards: { ...state.cards, [root]: { ...card, error: '所选问题已更新或已处理，请从建议栏选择当前问题' } } }))
  },
  async retryReview(root) {
    root = noteRepairKey(root)
    const card = get().cards[root]
    if (!card || repairIsActive(card.phase)) return
    set(state => ({ cards: { ...state.cards, [root]: { ...card, phase: 'reviewing', reviewOnly: true, error: undefined } } }))
    try { get().receive(await window.electron.blueprintReview.repairRetryReview(card.id)) }
    catch (error) { get().receive({ id: card.id, phase: 'review-incomplete', error: message(error) }) }
  },
  async refresh(root, part) {
    const card = get().cards[noteRepairKey(root)]
    if (!card) return
    root = card.input.context.workspacePath
    const key = noteRepairKey(root), id = card.id
    const parts: RepairSyncPart[] = part ? [part] : card.changed ? ['source', 'suggestions'] : ['suggestions']
    await Promise.all(parts.map(target => {
      const requestKey = key + ':' + id + ':' + (card.afterHash ?? '') + ':' + target
      const existing = syncRequests.get(requestKey)
      if (existing) return existing
      const update = (value: RepairSyncState, hash?: string) => {
        const current = get().cards[key]
        if (current?.id !== id || current.afterHash !== card.afterHash) return
        set(state => ({ cards: { ...state.cards, [key]: { ...current,
          sync: { ...current.sync, [target]: value }, ...(hash ? { previewHash: hash } : {}) } } }))
      }
      update({ state: 'loading' })
      const beforeView = useBlueprintReviewStore.getState().views[root]
      const beforeSource = card.plan ? useNoteSourceStore.getState().sources[noteSourceKey(root, card.plan.uri)] : undefined
      const request = (async () => {
        try {
          if (target === 'source') {
            if (!card.plan) throw new Error('Note source is unavailable')
            const source = await useNoteSourceStore.getState().refresh(root, card.plan.uri, true)
            const current = get().cards[key]
            if (current?.id !== id || current.afterHash !== card.afterHash) return
            // Deliver bytes before any whole-workspace projection or suggestion read.
            useBlueprintStore.getState().applyNoteSource(root, source)
            if (card.afterHash && source.sourceHash !== card.afterHash) throw new Error('Note 已再次变化，当前显示最新原文，请核对修改结果')
            update({ state: 'ready' }, source.sourceHash)
          } else {
            await useBlueprintReviewStore.getState().refreshSaved(root)
            const state = useBlueprintReviewStore.getState()
            // Older hosts use the full-read fallback, whose errors are stored rather than thrown.
            if (!window.electron.blueprintReview.readSaved && state.errors[root]) throw new Error(state.errors[root])
            const view = state.views[root]
            if (!view || view.context.branch !== card.input.context.branch || view.context.repoId !== card.input.context.repoId) throw new Error('工作区或分支已变化，请重新打开当前建议')
            update({ state: 'ready' })
          }
        } catch (error) {
          const view = useBlueprintReviewStore.getState().views[root]
          const source = card.plan ? useNoteSourceStore.getState().sources[noteSourceKey(root, card.plan.uri)] : undefined
          const recovered = target === 'suggestions'
            ? view && view.items !== beforeView?.items && view.context.repoId === card.input.context.repoId && view.context.branch === card.input.context.branch
            : source && source !== beforeSource && (!card.afterHash || source.sourceHash === card.afterHash)
          update(recovered ? { state: 'ready' } : { state: 'error', error: message(error) })
        }
      })().finally(() => { if (syncRequests.get(requestKey) === request) syncRequests.delete(requestKey) })
      syncRequests.set(requestKey, request)
      return request
    }))
  },
}))

// Cancel waiting handoffs on a workspace switch before they can bind to another dialog.
useWorkspaceStore.subscribe((state, previous) => {
  if (state.activeWorkspaceId === previous.activeWorkspaceId && state.workspaces === previous.workspaces) return
  const active = state.workspaces.find(item => item.id === state.activeWorkspaceId)
  for (const [root, card] of Object.entries(useNoteRepairStore.getState().cards)) {
    if (!card.started && (!active || !sameCheckoutPath(root, active.path))) useNoteRepairStore.getState().cancel(root)
  }
})

useNoteSourceStore.subscribe((state, previous) => {
  for (const [key, card] of Object.entries(useNoteRepairStore.getState().cards)) {
    if (!card.plan || !card.sync?.source || card.sync.source.state === 'ready') continue
    const sourceKey = noteSourceKey(card.input.context.workspacePath, card.plan.uri), source = state.sources[sourceKey]
    if (!source || source === previous.sources[sourceKey] || (card.afterHash && source.sourceHash !== card.afterHash)) continue
    useNoteRepairStore.setState(current => ({ cards: { ...current.cards, [key]: { ...card,
      previewHash: source.sourceHash, sync: { ...card.sync, source: { state: 'ready' } } } } }))
  }
})
useBlueprintReviewStore.subscribe((state, previous) => {
  for (const [key, card] of Object.entries(useNoteRepairStore.getState().cards)) {
    const root = card.input.context.workspacePath, view = state.views[root], old = previous.views[root]
    if (!view || view.items === old?.items || view.context.repoId !== card.input.context.repoId || view.context.branch !== card.input.context.branch) continue
    const item = card.plan && view.items.find(item => item.noteId === card.plan!.noteId), report = item?.report
    const reconciled = !repairIsActive(card.phase) && card.input.kind === 'suggestions' && card.input.intent === 'repair'
      && !['reverted', 'unchanged', 'discussed'].includes(card.phase) && card.afterHash && report?.coverage === 'complete' && !report.stale && !item?.awaitingReview && report.source?.hash === card.afterHash
    if (card.sync?.suggestions?.state !== 'error' && !reconciled) continue
    useNoteRepairStore.setState(current => ({ cards: { ...current.cards, [key]: { ...card,
      ...(reconciled ? { phase: report.findings.length ? 'unresolved' : 'resolved', remaining: report.findings.length, error: undefined } : {}),
      sync: { ...card.sync, suggestions: { state: 'ready' } } } } }))
  }
})
