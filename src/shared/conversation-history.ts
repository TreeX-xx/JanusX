import type { ConversationHistoryPage as NativePage, ConversationHistoryText } from '@janus-agent/janus-agent/superagent/contracts/conversation-history'
import type { ConversationPlan } from './conversation-display'

export * from '@janus-agent/janus-agent/superagent/contracts/conversation-history'

export type ConversationHistoryPage = NativePage & { plans?: ConversationPlan[] }
export type ConversationHistoryResult = ConversationHistoryPage | ConversationHistoryText
