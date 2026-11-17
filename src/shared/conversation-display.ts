// Engine-owned implementation. See .agents/notes/agent/ideas/superagent-harness-reliability.md
export * from '@janus-agent/janus-agent/superagent/contracts/conversation-display'
import { supportsConversation as engineSupportsConversation } from '@janus-agent/janus-agent/superagent/contracts/conversation-display'
import { runtimeCapability } from './runtime/capabilities'
import type { ConversationEngine } from '@janus-agent/janus-agent/superagent/contracts/conversation-display'

/** Desktop adapters have narrower platform support than the engine contracts. */
export function supportsConversation(engine: string, platform?: string): engine is ConversationEngine {
  if (platform === undefined) return engineSupportsConversation(engine)
  return runtimeCapability('conversation', engine, { kind: 'local', platform: platform === 'win32' || platform === 'darwin' || platform === 'linux' ? platform : null }).status === 'available'
}
