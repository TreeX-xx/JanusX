// Note: current suggestions are shared by preview and canvas — see .agents/notes/blueprint/maintenance/suggestions/module.md
import { useEffect } from 'react'
import { create } from 'zustand'
import { useBlueprintActivityStore } from './blueprint-review-activity'
import { sameCheckoutPath } from '@/features/blueprint/resolveNodeWorkspace'
import type { BlueprintReviewActivityUpdate, BlueprintReviewResults, BlueprintReviewView } from '../../../../plugins/blueprint/src/shared/ipc/blueprint-review'
import type { NoteReadResult, NoteVersion } from '../../../../plugins/blueprint/src/shared/blueprint-attention'
import { readReviewWithDeadline } from '@/services/blueprint-review-read'
import { onBlueprintSourcesChanged } from '@/services/blueprint-sync'

interface State {
  views: Record<string, BlueprintReviewView>
  errors: Record<string, string>
  refresh(root: string): Promise<void>
  refreshAfterChange(root: string): Promise<void>
  refreshSaved(root: string): Promise<void>
  receiveActivity(update: BlueprintReviewActivityUpdate): void
  receiveResults(update: BlueprintReviewResults): void
  receiveRead(result: NoteReadResult): void
}
const pending = new Map<string, Promise<void>>()
const savedReads = new Map<string, Promise<void>>()
const followups = new Map<string, { dirty: boolean; promise: Promise<void> }>()
const rootKey = (root: string) => root.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase()
function mergeView(previous: BlueprintReviewView | undefined, incoming: BlueprintReviewView): BlueprintReviewView {
  if (!previous || previous.context.branch !== incoming.context.branch || previous.context.repoId !== incoming.context.repoId) return incoming
  const latest = { ...incoming }
  if (previous.revision > latest.revision) { latest.items = previous.items; latest.revision = previous.revision }
  if ((previous.activityRevision ?? -1) > (latest.activityRevision ?? -1)) {
    latest.automatic = previous.automatic; latest.activities = previous.activities; latest.activityRevision = previous.activityRevision
  }
  if (previous.updates && (!latest.updates || previous.updates.revision > latest.updates.revision)) latest.updates = previous.updates
  return latest
}
export const useBlueprintReviewStore = create<State>((set, get) => ({
  views: {}, errors: {},
  receiveResults(update) {
    set(state => {
      const views = { ...state.views }
      const roots = new Set([update.context.workspacePath, ...[...Object.keys(views), ...subscriptions.keys()].filter(root => sameCheckoutPath(root, update.context.workspacePath))])
      for (const root of roots) {
        const previous = views[root]
        if (previous && (previous.context.branch !== update.context.branch || previous.context.repoId !== update.context.repoId)) continue
        views[root] = mergeView(previous, { ...(previous ?? { sourceComplete: false, sourcesPending: true, activities: [] }), ...update })
      }
      return { views }
    })
  },
  receiveRead(result) {
    set(state => ({ views: Object.fromEntries(Object.entries(state.views).map(([root, view]) => {
      if (!sameCheckoutPath(root, result.context.workspacePath) || view.context.branch !== result.context.branch || view.context.repoId !== result.context.repoId
        || (view.updates?.revision ?? -1) > result.updates.revision) return [root, view]
      return [root, { ...view, updates: result.updates, updatesError: '' }]
    })) }))
  },
  receiveActivity(update) {
    useBlueprintActivityStore.getState().receive(update)
    for (const root of Object.keys(get().views).filter(root => sameCheckoutPath(root, update.root))) {
      const previous = get().views[root]
      const context = update.automatic?.context
      if (context && (context.branch !== previous.context.branch || context.repoId !== previous.context.repoId)) { void get().refresh(root); continue }
      if (update.revision <= (previous.activityRevision ?? -1)) continue
      set(state => ({ views: { ...state.views, [root]: { ...previous, automatic: update.automatic, activities: update.activities, activityRevision: update.revision } } }))
      if (get().errors[root] || previous.activities.some(activity => !update.activities.some(next => next.noteId === activity.noteId)) || previous.automatic?.lastRun?.finishedAt !== update.automatic?.lastRun?.finishedAt
        || previous.automatic?.targets?.some(target => {
          const next = update.automatic?.targets?.find(item => item.noteId === target.noteId)
          return next && (target.state !== next.state || target.reportRevision !== next.reportRevision)
        })) {
        // An in-flight read can predate completion; follow it with a current read.
        void get().refreshSaved(root).catch(() => { /* Source synchronization reports its own health. */ })
      }
    }
  },
  refreshSaved(root) {
    if (!window.electron?.blueprintReview?.readSaved) return get().refreshAfterChange(root)
    const existing = savedReads.get(rootKey(root))
    if (existing) return existing
    const started = get().views[root]?.context
    const request = readReviewWithDeadline(() => window.electron.blueprintReview.readSaved(root)).then(view => {
      set(state => {
        const expected = started ?? view.context
        const views = { ...state.views }
        for (const path of new Set([root, ...[...Object.keys(views), ...subscriptions.keys()].filter(path => sameCheckoutPath(path, root))])) {
          const previous = views[path]
          if (previous && (previous.context.branch !== expected.branch || previous.context.repoId !== expected.repoId)) continue
          const merged = mergeView(previous, view)
          if (previous && previous.context.branch === view.context.branch && previous.context.repoId === view.context.repoId) {
            merged.sourceComplete = previous.sourceComplete; merged.sourcesPending = previous.sourcesPending
            merged.structure = previous.structure; merged.updatesError = previous.updatesError
            if (previous.updates && merged.updates?.revision === previous.updates.revision) merged.updates = previous.updates
          }
          views[path] = merged
        }
        return { views }
      })
    }).finally(() => { if (savedReads.get(rootKey(root)) === request) savedReads.delete(rootKey(root)) })
    savedReads.set(rootKey(root), request)
    return request
  },
  refreshAfterChange(root) {
    const key = rootKey(root), existing = followups.get(key)
    if (existing) { existing.dirty = true; return existing.promise }
    const task = { dirty: true, promise: undefined as unknown as Promise<void> }
    task.promise = (async () => {
      await pending.get(key)
      do { task.dirty = false; await get().refresh(root) } while (task.dirty)
    })().finally(() => { if (followups.get(key) === task) followups.delete(key) })
    followups.set(key, task)
    return task.promise
  },
  refresh(root) {
    const existing = pending.get(rootKey(root))
    if (existing) return existing
    if (!root || !window.electron?.blueprintReview) return Promise.resolve()
    let finished = false
    if (!get().views[root] && window.electron.blueprintReview.readSaved) {
      void readReviewWithDeadline(() => window.electron.blueprintReview.readSaved(root)).then(view => {
        if (finished) return
        set(state => {
          const previous = state.views[root]
          if (previous && (!previous.sourcesPending || previous.context.repoId !== view.context.repoId || previous.context.branch !== view.context.branch)) return state
          return { views: { ...state.views, [root]: mergeView(previous, view) } }
        })
      }).catch(() => { /* Current source reading remains authoritative and reports its own errors. */ })
    }
    const request = readReviewWithDeadline(() => window.electron.blueprintReview.read(root)).then(view => {
      set(state => {
        const views = { ...state.views }, errors = { ...state.errors }
        for (const path of new Set([root, ...[...Object.keys(views), ...subscriptions.keys()].filter(path => sameCheckoutPath(path, root))])) {
          views[path] = mergeView(views[path], view); errors[path] = ''
        }
        return { views, errors }
      })
    }).catch(error => { set(state => ({ errors: { ...state.errors, [root]: error instanceof Error ? error.message : String(error) } })) })
      .finally(() => { finished = true; pending.delete(rootKey(root)) })
    pending.set(rootKey(root), request)
    return request
  },
}))
const subscriptions = new Map<string, { count: number; timer: ReturnType<typeof setInterval> }>()
let stopActivitySubscription: (() => void) | undefined
let stopResultsSubscription: (() => void) | undefined
let stopReadSubscription: (() => void) | undefined
let stopSourceSubscription: (() => void) | undefined
export async function markNoteRead(root: string, versions: NoteVersion[], bulk = false, context?: NoteReadResult['context']): Promise<NoteReadResult | undefined> {
  const api = window.electron?.blueprintReview
  if (!api?.markRead || !versions.length) return
  let view = useBlueprintReviewStore.getState().views[root]
  if (!view) { await useBlueprintReviewStore.getState().refresh(root); view = useBlueprintReviewStore.getState().views[root] }
  if (!view) throw new Error('Note sources are unavailable')
  const result = await api.markRead(context ?? view.context, versions.map(({ noteId, hash, path }) => ({ noteId, hash, path })), bulk)
  useBlueprintReviewStore.getState().receiveRead(result)
  return result
}
export function useBlueprintReview(root: string) {
  useEffect(() => {
    if (!root || !window.electron?.blueprintReview) return
    if (!subscriptions.size) stopActivitySubscription = window.electron.blueprintReview.onActivityChanged?.(update => {
      if ([...subscriptions.keys()].some(root => sameCheckoutPath(root, update.root))) useBlueprintReviewStore.getState().receiveActivity(update)
    })
    if (!subscriptions.size) stopResultsSubscription = window.electron.blueprintReview.onResultsChanged?.(update => {
      if ([...subscriptions.keys()].some(root => sameCheckoutPath(root, update.context.workspacePath))) useBlueprintReviewStore.getState().receiveResults(update)
    })
    if (!subscriptions.size) stopReadSubscription = window.electron.blueprintReview.onReadChanged?.(result => {
      useBlueprintReviewStore.getState().receiveRead(result)
    })
    if (!subscriptions.size) stopSourceSubscription = onBlueprintSourcesChanged(event => {
      const root = [...subscriptions.keys()].find(root => sameCheckoutPath(root, event.root))
      if (root) void useBlueprintReviewStore.getState().refreshAfterChange(root)
    })
    let subscription = subscriptions.get(root)
    if (!subscription) {
      // Source and review events refresh promptly; polling only repairs missed events and external MCP changes.
      subscription = { count: 0, timer: setInterval(() => { void useBlueprintReviewStore.getState().refresh(root) }, 10000) }
      subscriptions.set(root, subscription)
      void useBlueprintReviewStore.getState().refresh(root)
    }
    subscription.count++
    return () => {
      if (--subscription.count === 0) { clearInterval(subscription.timer); subscriptions.delete(root) }
      if (!subscriptions.size) { stopActivitySubscription?.(); stopActivitySubscription = undefined; stopResultsSubscription?.(); stopResultsSubscription = undefined; stopReadSubscription?.(); stopReadSubscription = undefined; stopSourceSubscription?.(); stopSourceSubscription = undefined }
    }
  }, [root])
  return useBlueprintReviewStore(state => state.views[root])
}
