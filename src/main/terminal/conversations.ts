import type { ConversationCommand, ConversationSnapshot } from '../../shared/conversation-display'

/** Each adapter owns exactly one execution/session. The UI consumes only this common contract. */
export interface ConversationController {
  readonly state: ConversationSnapshot
  snapshot(): ConversationSnapshot
  command(command: ConversationCommand): Promise<ConversationSnapshot>
  acceptsTerminalInput(data: string): boolean
  dispose(): Promise<void>
}

export const conversations = new Map<string, ConversationController>()
