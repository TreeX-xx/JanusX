// Note: one-shot, explicit user navigation — see .agents/notes/blueprint/navigation/note-updates-and-suggestion-navigation.md
import { create } from 'zustand'
import type { BlueprintNoteDestination } from '../../../../plugins/blueprint/src/shared/blueprint-attention'

export interface BlueprintNavigationRequest extends BlueprintNoteDestination { sequence: number; blueprintId: string }
interface State {
  request: BlueprintNavigationRequest | null
  sequence: number
  navigate(blueprintId: string, destination: BlueprintNoteDestination): void
  consume(sequence: number): void
}
export const useBlueprintNavigation = create<State>((set, get) => ({
  request: null, sequence: 0,
  navigate(blueprintId, destination) {
    const sequence = get().sequence + 1
    set({ sequence, request: { ...destination, sequence, blueprintId } })
  },
  consume(sequence) { if (get().request?.sequence === sequence) set({ request: null }) },
}))
