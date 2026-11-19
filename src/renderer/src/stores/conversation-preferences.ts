import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ConversationDisplayMode } from '../../../shared/conversation-display'

/** Launch and reading preferences shared by both conversation surfaces. */
interface ConversationPreferences {
  initialView: ConversationDisplayMode
  setInitialView(view: ConversationDisplayMode): void
  emphasisColors: Record<string, string>
  setEmphasisColor(theme: string, color: string | null): void
}

export function normalizeEmphasisColor(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const color = value.trim()
  if (/^#[\da-f]{6}$/i.test(color)) return color.toUpperCase()
  if (/^#[\da-f]{3}$/i.test(color)) return '#' + [...color.slice(1)].map(char => char + char).join('').toUpperCase()
  return null
}

function restoreEmphasisColors(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(value).flatMap(([theme, value]) => {
    const color = normalizeEmphasisColor(value)
    return color ? [[theme, color]] : []
  }))
}

export const useConversationPreferences = create<ConversationPreferences>()(persist(set => ({
  initialView: 'terminal', setInitialView: initialView => set({ initialView }),
  emphasisColors: {},
  setEmphasisColor: (theme, value) => {
    const color = normalizeEmphasisColor(value)
    if (value !== null && !color) return
    set(state => {
      const emphasisColors = { ...state.emphasisColors }
      if (color) emphasisColors[theme] = color
      else delete emphasisColors[theme]
      return { emphasisColors }
    })
  },
}), {
  name: 'janusx-conversation-launch',
  version: 1,
  // The old opt-in never selected an initial view; both values opened terminal.
  migrate: () => ({ initialView: 'terminal' as ConversationDisplayMode, emphasisColors: {} as Record<string, string> }),
  merge: (saved, current) => ({ ...current,
    initialView: (saved as Partial<ConversationPreferences> | null)?.initialView === 'conversation' ? 'conversation' : 'terminal',
    emphasisColors: restoreEmphasisColors((saved as Partial<ConversationPreferences> | null)?.emphasisColors),
  }),
  partialize: state => ({ initialView: state.initialView, emphasisColors: state.emphasisColors }),
}))

// Keep settings changed in another application window in sync without re-parsing chat history.
if (typeof window !== 'undefined') window.addEventListener('storage', event => {
  if (event.key === 'janusx-conversation-launch' || event.key === null) void useConversationPreferences.persist.rehydrate()
})
