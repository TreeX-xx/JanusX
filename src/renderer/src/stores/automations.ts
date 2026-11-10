import { create } from 'zustand'
import type { AutomationDraft, AutomationRun } from '../../../shared/automations'
import { useRightToolStore } from './right-tools'
import { useIslandStore } from './island'

export const useAutomationsStore = create<{
  draft: AutomationDraft | null; notices: AutomationRun[]; draftSequence: number; removedIds: string[];
  setDraft(draft: AutomationDraft | null): void;
}>((set) => ({ draft: null, notices: [], draftSequence: 0, removedIds: [], setDraft: draft => set({ draft }) }))

export function receiveAutomationRemoval(id: string): void {
  const right = useRightToolStore.getState()
  if (right.focusRequest?.toolId === 'automations' && right.focusRequest.itemId === id) right.consumeFocus(right.focusRequest.sequence)
  useAutomationsStore.setState(state => ({
    draft: state.draft?.id === id ? null : state.draft,
    notices: state.notices.filter(run => run.definitionId !== id),
    removedIds: state.removedIds.includes(id) ? state.removedIds : [...state.removedIds, id],
  }))
}

export function receiveAutomationDraft(draft: AutomationDraft): void {
  if (draft.id && useAutomationsStore.getState().removedIds.includes(draft.id)) return
  const right = useRightToolStore.getState()
  if (right.focusRequest?.toolId === 'automations') right.consumeFocus(right.focusRequest.sequence)
  useAutomationsStore.setState(state => ({ draft, draftSequence: state.draftSequence + 1 }))
  activateAutomationCompanion()
}

export function openAutomationRun(run: Pick<AutomationRun, 'definitionId' | 'id'>): void {
  if (useAutomationsStore.getState().removedIds.includes(run.definitionId)) return
  useRightToolStore.getState().requestFocus('automations', run.definitionId, run.id)
}
export function activateAutomationCompanion(): void {
  useRightToolStore.getState().openTool('automations')
  const island = useIslandStore.getState()
  if (island.stage !== 'expanded' || island.companionToolId !== 'automations') island.openChat('', 'automations')
}
export function subscribeAutomations(): () => void {
  const api = window.electron.automations
  if (!api) return () => {}
  const subscriptions = [
    api.onDraft(receiveAutomationDraft),
    api.onRemoved(receiveAutomationRemoval),
    api.onCompleted(run => useAutomationsStore.setState(state => state.removedIds.includes(run.definitionId) ? state : ({ notices: [...state.notices.filter(item => item.id !== run.id).slice(-49), run] }))),
    api.onFocus(openAutomationRun),
  ]
  return () => subscriptions.forEach(unsubscribe => unsubscribe())
}
