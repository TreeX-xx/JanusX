import type { ConversationCommand, ConversationSnapshot } from '../../shared/conversation-display'
import type { ConversationHistoryRequest, ConversationHistoryResult } from '../../shared/conversation-history'

/** Each adapter owns exactly one execution/session. The UI consumes only this common contract. */
export interface ConversationController {
  readHistory?(request: ConversationHistoryRequest): Promise<ConversationHistoryResult>
  readonly state: ConversationSnapshot
  snapshot(): ConversationSnapshot
  setNativeInput(write: (text: string) => void): void
  command(command: ConversationCommand): Promise<ConversationSnapshot>
  acceptsTerminalInput(data: string): boolean
  dispose(): Promise<void>
}

export const conversations = new Map<string, ConversationController>()
