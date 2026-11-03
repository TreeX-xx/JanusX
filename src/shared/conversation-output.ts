import type { ConversationItem } from './conversation-display'
import { groupWorkOutput, summarizeWork } from './work-output'

export function conversationOutputGroups(items: ConversationItem[], activeTurnId: string | null) {
  return groupWorkOutput(items,
    item => !['userMessage', 'agentMessage', 'imageGeneration'].includes(item.type) && !item.images?.length,
    item => item.turnId,
  ).map(group => {
    // Prefer work still running over a newer operation that already finished.
    const latest = group.process ? [...group.items].reverse().find(item => item.status === 'inProgress') ?? group.items.at(-1) : undefined
    return { ...group,
      activity: latest?.activity ? { text: latest.activity, startedAt: latest.status === 'inProgress' ? latest.receivedAt : undefined } : undefined,
      summary: summarizeWork(group.items),
      settled: group.process && activeTurnId !== group.items[0].turnId && group.items.every(item => item.status === 'completed' && !item.truncated),
    }
  })
}
