import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ConversationDisplayMode } from '../../../shared/conversation-display'

/** Both launch surfaces share a preference; changing it only affects newly created sessions. */
interface ConversationPreferences {
  initialView: ConversationDisplayMode
  setInitialView(view: ConversationDisplayMode): void
}
export const useConversationPreferences = create<ConversationPreferences>()(persist(set => ({
  initialView: 'terminal', setInitialView: initialView => set({ initialView }),
}), {
  name: 'janusx-conversation-launch',
  version: 1,
  // The old opt-in never selected an initial view; both values opened terminal.
  migrate: () => ({ initialView: 'terminal' as const }),
  merge: (saved, current) => ({ ...current, initialView: (saved as Partial<ConversationPreferences> | null)?.initialView === 'conversation' ? 'conversation' : 'terminal' }),
  partialize: state => ({ initialView: state.initialView }),
}))
