import type { ConversationItem } from './conversation-display'
import { groupWorkOutput, summarizeWork } from './work-output'

export function conversationOutputGroups(items: ConversationItem[], activeTurnId: string | null) {
  return groupWorkOutput(items,
    item => !['userMessage', 'agentMessage', 'imageGeneration', 'error', 'turnError'].includes(item.type) && !item.images?.length,
    item => item.turnId,
  ).map(group => {
    // Prefer work still running over a newer operation that already finished.
    const operations = group.items.filter(item => item.type !== 'reasoning')
    const latest = group.process ? [...operations].reverse().find(item => item.status === 'inProgress') ?? operations.at(-1) : undefined
    const preview = latest?.activity || (latest?.type === 'commandExecution' ? latest.text.split('\n')[0].replace(/\s+/g, ' ').slice(0, 240)
      : latest?.files?.map(file => file.path).join(', ').slice(0, 240))
    return { ...group,
      activity: preview ? { text: preview, startedAt: latest?.status === 'inProgress' ? latest.receivedAt : undefined } : undefined,
      summary: summarizeWork(group.items),
      settled: group.process && activeTurnId !== group.items[0].turnId && group.items.every(item => item.status === 'completed' && !item.truncated),
    }
  })
}
