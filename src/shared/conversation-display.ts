/** Provider-neutral display contract. Adapters normalize structured events or explicit transcripts, never ANSI. */
export type ConversationEngine = 'codex' | 'claude' | 'opencode' | 'pi' | 'dsh'
export function supportsConversation(engine: string): engine is ConversationEngine { return ['codex', 'claude', 'opencode', 'pi', 'dsh'].includes(engine) }
export interface ConversationCapabilities {
  edit?: boolean
  submit: boolean
  cancel: boolean
  settings: boolean
  approvals: boolean
  liveText: boolean
}
export const CODEX_CONVERSATION_CAPABILITIES: ConversationCapabilities = {
  submit: true, cancel: true, settings: true, approvals: true, liveText: true, edit: true,
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
export interface ConversationApproval {
  id: string | number
  itemId: string
  kind: 'command' | 'file'
  description: string
}
export interface ConversationModelOption {
  model: string
  displayName: string
  description: string
  defaultEffort: string | null
  efforts: Array<{ effort: string; description: string }>
}

/** Slash commands are client actions, never prompts. Absolute paths such as /tmp/a remain text. */
export function parseConversationSlashCommand(text: string): { name: string; query: string } | null {
  const match = /^\s*\/([a-z][\w-]*)?(?:\s+([\s\S]*))?$/i.exec(text)
  return match ? { name: (match[1] ?? '').toLowerCase(), query: (match[2] ?? '').trim() } : null
}
export interface ConversationSnapshot {
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
  | { type: 'mode'; mode: ConversationDisplayMode }
  | { type: 'send'; text: string; commandId: string; controlEpoch: number }
  | { type: 'edit'; itemId: string; text: string; commandId: string; controlEpoch: number }
  | { type: 'interrupt'; controlEpoch: number }
  | { type: 'models'; controlEpoch: number }
  | { type: 'settings'; model: string; effort: string | null; controlEpoch: number }
  | { type: 'approve'; requestId: string | number; decision: 'accept' | 'decline'; controlEpoch: number }
