import type { ConversationItem } from './conversation-display'
import { groupWorkOutput, summarizeWork } from './work-output'

export function conversationOutputGroups(items: ConversationItem[], activeTurnId: string | null) {
  return groupWorkOutput(items,
    item => !['userMessage', 'agentMessage', 'imageGeneration'].includes(item.type) && !item.images?.length,
    item => item.turnId,
  ).map(group => ({ ...group,
    summary: summarizeWork(group.items),
    settled: group.process && activeTurnId !== group.items[0].turnId && group.items.every(item => item.status === 'completed' && !item.truncated),
  }))
}
