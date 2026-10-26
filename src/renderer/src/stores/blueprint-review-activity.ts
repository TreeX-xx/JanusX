// Note: enabled status is independent of corpus loading — see .agents/notes/blueprint/maintenance/note-content-review.md
import { useEffect } from 'react'
import { create } from 'zustand'
import { sameCheckoutPath } from '@/features/blueprint/resolveNodeWorkspace'
import type { BlueprintReviewActivityUpdate } from '../../../../plugins/blueprint/src/shared/ipc/blueprint-review'
import { readReviewWithDeadline } from '@/services/blueprint-review-read'

interface State {
  statuses: Record<string, BlueprintReviewActivityUpdate>
  errors: Record<string, string>
  receive(update: BlueprintReviewActivityUpdate): void
  refresh(root: string): Promise<void>
}
const pending = new Map<string, Promise<void>>()
export const useBlueprintActivityStore = create<State>((set, get) => ({
  statuses: {}, errors: {},
  receive(update) {
    set(state => {
      const roots = new Set([update.root, ...[...Object.keys(state.statuses), ...pending.keys()].filter(root => sameCheckoutPath(root, update.root))])
      const statuses = { ...state.statuses }, errors = { ...state.errors }
      for (const root of roots) {
        const previous = statuses[root]
        if (previous && previous.revision > update.revision) continue
        statuses[root] = { ...update, automaticSettings: update.automaticSettings ?? previous?.automaticSettings }
        errors[root] = ''
      }
      return { statuses, errors }
    })
  },
  refresh(root) {
    if (!root || !window.electron?.blueprintReview?.activityRead) return Promise.resolve()
    const existing = pending.get(root)
    if (existing) return existing
    const revision = get().statuses[root]?.revision ?? -1
    const request = readReviewWithDeadline(() => window.electron.blueprintReview.activityRead(root)).then(update => {
      get().receive({ ...update, root })
    }).catch(reason => {
      if ((get().statuses[root]?.revision ?? -1) > revision) return
      set(state => ({ errors: { ...state.errors, [root]: reason instanceof Error ? reason.message : String(reason) } }))
    }).finally(() => { pending.delete(root) })
    pending.set(root, request)
    return request
  },
}))

export function useBlueprintActivity(root: string) {
  useEffect(() => {
    if (!root) return
    void useBlueprintActivityStore.getState().refresh(root)
    // Events supply progress immediately; this small read repairs missed events without loading Notes.
    const timer = setInterval(() => { void useBlueprintActivityStore.getState().refresh(root) }, 5000)
    const focus = () => { void useBlueprintActivityStore.getState().refresh(root) }
    window.addEventListener('focus', focus)
    return () => { clearInterval(timer); window.removeEventListener('focus', focus) }
  }, [root])
  return useBlueprintActivityStore(state => state.statuses[root]
    ?? Object.entries(state.statuses).find(([path]) => sameCheckoutPath(path, root))?.[1])
}
