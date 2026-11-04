import { create } from 'zustand'
import type { ConversationReference } from '../../../shared/conversation-context'

// Runtime drafts survive pane remounts, without putting file bytes in workspace persistence.
export const useConversationContext = create<{ entries: Record<string, ConversationReference[]> }>(() => ({ entries: {} }))
export function setConversationReferences(id: string, update: (refs: ConversationReference[]) => ConversationReference[]) {
  useConversationContext.setState(state => ({ entries: { ...state.entries, [id]: update(state.entries[id] ?? []) } }))
}
