/** Provider-neutral display contract. Adapters normalize structured events or explicit transcripts, never ANSI. */
export type ConversationEngine = 'codex' | 'claude' | 'opencode' | 'pi' | 'dsh'
export function supportsConversation(engine: string): engine is ConversationEngine { return ['codex', 'claude', 'opencode', 'pi', 'dsh'].includes(engine) }
export interface ConversationCapabilities {
  questions?: boolean
  /** Supports a turn-pinned steer request, distinct from a native input queue. */
  steer?: boolean
  commands?: boolean
  /** Native input can be delivered while a response is running. */
  liveInput?: boolean
  newThread?: boolean
  edit?: boolean
  submit: boolean
  cancel: boolean
  settings: boolean
  approvals: boolean
  liveText: boolean
}
export const CODEX_CONVERSATION_CAPABILITIES: ConversationCapabilities = {
  submit: true, cancel: true, settings: true, approvals: true, liveText: true, edit: true, newThread: true, liveInput: true, steer: true,
}
export type ConversationDisplayMode = 'terminal' | 'conversation'
export interface ConversationPlan {
  /** Native readback failed; preserve the last confirmed steps without a live spinner. */
  stale?: boolean
  turnId: string
  version: number
  explanation: string
  steps: Array<{ step: string; status: 'pending' | 'inProgress' | 'completed' }>
  outcome: 'running' | 'completed' | 'interrupted' | 'failed'
}
export interface ConversationItem {
  /** Bounded native tool label/target, separate from growing tool output. */
  activity?: string
  images?: ConversationImage[]
  phase?: 'commentary' | 'final_answer'
  /** False when the text projection cannot faithfully reproduce the native input. */
  editable?: boolean
  /** Local receipt time; absent for older snapshots without timing metadata. */
  receivedAt?: number
  durationMs?: number
  id: string
  turnId: string
  type: string
  text: string
  status: string
  files?: Array<{ path: string; diff: string }>
  truncated?: boolean
}
export interface ConversationImage {
  source?: string
  id: string
  status: 'loading' | 'ready' | 'unavailable'
  path?: string
  mimeType?: string
  error?: string
}
export interface ConversationApproval {
  id: string | number
  itemId: string
  kind: 'command' | 'file'
  description: string
  choices?: Array<{ id: string; label: string; description?: string }>
}
export interface ConversationModelOption {
  /** Display metadata only; model remains the complete native selection identity. */
  provider?: { id: string; name: string }
  fastTier?: string
  model: string
  displayName: string
  description: string
  defaultEffort: string | null
  efforts: Array<{ effort: string; description: string }>
}

/** Slash commands are client actions, never prompts. Absolute paths such as /tmp/a remain text. */
export function parseConversationSlashCommand(text: string, entries: ConversationCatalogEntry[] = []): { name: string; query: string } | null {
  const match = /^\s*\/([^\s]*)(?:\s+([\s\S]*))?$/.exec(text)
  if (!match) return null
  const name = match[1]
  const known = name && entries.some(entry => entry.name.startsWith(name))
  if (name.includes('/') && !known) return null
  if (name && !known && !/^[\w:-]+$/.test(name)) return null
  return { name, query: (match[2] ?? '').trim() }
}
export interface ConversationCatalogEntry {
  id: string
  name: string
  label: string
  description: string
  kind: 'skill' | 'command' | 'prompt'
  source: string
  execution: 'native' | 'terminal'
  argumentHint?: string
}
export interface ConversationSnapshot {
  /** Claude's native session workflow control; absent until native readback succeeds. */
  ultracode?: { enabled: boolean; available: boolean; model: string }
  /** Undefined until the native session reports its tier; null means standard. */
  serviceTier?: string | null
  commands?: ConversationCatalogEntry[]
  commandsRevision?: number
  commandsLoading?: boolean
  commandsError?: string
  /** Native acceptance is not model completion; uncertain deliveries must not be retried. */
  commandReceipts?: Array<{ id: string; status: 'accepted' | 'handedOff' | 'unknown' }>
  startup?: ConversationStartup
  /** Bounded, immutable plan revisions observed during this runtime. */
  plans?: ConversationPlan[]
  turnStartedAt?: number
  engine: ConversationEngine
  capabilities: ConversationCapabilities
  id: string
  revision: number
  mode: ConversationDisplayMode
  controlEpoch: number
  connection: 'starting' | 'ready' | 'disconnected' | 'closed'
  threadId: string | null
  turnId: string | null
  submitting: boolean
  items: ConversationItem[]
  approvals: ConversationApproval[]
  questions?: import('./conversation-questions').ConversationQuestionRequest[]
  needsTerminal: boolean
  truncated: boolean
  model: string | null
  effort: string | null
  models: ConversationModelOption[]
  modelsLoading: boolean
  modelsError?: string
  settingsUpdating: boolean
  /** A session-only request choice, distinct from the native CLI's saved default. */
  settingsOverride?: boolean
  /** Native tasks still running after the response, when the adapter can track them. */
  backgroundTasks?: number
  error?: string
}
export type ConversationCommand =
  | { type: 'ultracode'; enabled: boolean; controlEpoch: number }
  | { type: 'commands'; controlEpoch: number }
  | { type: 'invoke'; entryId: string; catalogRevision: number; arguments: string; commandId: string; controlEpoch: number }
  | { type: 'terminal-command'; name: string; arguments: string; commandId: string; controlEpoch: number }
  | { type: 'startup'; startupId: number; action: 'trust' | 'login' | 'apiKey' | 'cancel' | 'resume' | 'check'; apiKey?: string; controlEpoch: number }
  | { type: 'mode'; mode: ConversationDisplayMode }
  | { type: 'send'; text: string; commandId: string; controlEpoch: number; delivery?: 'queue' | 'steer'; expectedTurnId?: string; imagePaths?: string[] }
  | { type: 'edit'; itemId: string; text: string; commandId: string; controlEpoch: number }
  | { type: 'interrupt'; controlEpoch: number }
  | { type: 'new'; controlEpoch: number }
  | { type: 'models'; controlEpoch: number }
  | { type: 'speed'; fast: boolean; controlEpoch: number }
  | { type: 'settings'; model: string; effort: string | null; controlEpoch: number }
  | { type: 'approve'; requestId: string | number; decision: string; controlEpoch: number }
  | { type: 'answer'; requestId: string | number; version: number; answer: import('./conversation-questions').ConversationQuestionAnswer; controlEpoch: number }

export interface ConversationStartup {
  id: number
  kind: 'trust' | 'login' | 'hooks'
  status: 'pending' | 'busy' | 'waiting' | 'cancelled'
  directory?: string
  hooks?: Array<{ key: string; event: string; source: string; command: string }>
  authUrl?: string
  error?: string
}

/** Omitted delivery uses native input behavior; explicit queue/steer preserves that intent across IPC races. */
export function validateConversationDelivery(snapshot: ConversationSnapshot, command: ConversationCommand): void {
  if (command.type !== 'send') return
  if (command.delivery !== undefined && command.delivery !== 'queue' && command.delivery !== 'steer') throw new Error('Invalid delivery mode')
  if (command.delivery === 'queue' && snapshot.turnId) throw new Error('A new turn started. Restore the queued message and send again.')
  if (command.delivery === 'steer' && (!snapshot.capabilities.steer || !snapshot.capabilities.liveInput
    || !command.expectedTurnId || command.expectedTurnId !== snapshot.turnId)) throw new Error('The target turn has ended or cannot accept steering. Restore the message before sending again.')
}
