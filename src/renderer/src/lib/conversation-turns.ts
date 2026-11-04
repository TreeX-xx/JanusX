import type { ConversationItem } from '../../../shared/conversation-display'
import { conversationOutputGroups } from '../../../shared/conversation-output'
import { conversationFileChanges } from '../../../shared/conversation-file-changes'

export interface ConversationTurn {
  key: string
  items: ConversationItem[]
  active: boolean
  groups: ReturnType<typeof conversationOutputGroups>
  changes: ReturnType<typeof conversationFileChanges> extends Map<string, infer T> ? T | undefined : never
}

// IPC clones row objects. Compare values once at the boundary, then retain historical
// turn projections; streaming must not repeatedly tokenize every historical patch.
function equalValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false
  const left = a as Record<string, unknown>, right = b as Record<string, unknown>
  const keys = Object.keys(left)
  return keys.length === Object.keys(right).length && keys.every(key => Object.hasOwn(right, key) && equalValue(left[key], right[key]))
}
export function createConversationTurns() {
  let previous = new Map<string, ConversationTurn>()
  return (items: ConversationItem[], activeTurn: string | null): ConversationTurn[] => {
    const grouped = new Map<string, ConversationItem[]>()
    for (const item of items) {
      const rows = grouped.get(item.turnId)
      if (rows) rows.push(item)
      else grouped.set(item.turnId, [item])
    }
    const next = new Map<string, ConversationTurn>()
    for (const [key, rows] of grouped) {
      const old = previous.get(key), active = key === activeTurn
      if (old && old.active === active && equalValue(old.items, rows)) next.set(key, old)
      else next.set(key, { key, items: rows, active, groups: conversationOutputGroups(rows, activeTurn), changes: conversationFileChanges(rows).get(key) })
    }
    previous = next
    return [...next.values()]
  }
}
