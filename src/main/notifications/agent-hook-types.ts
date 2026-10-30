import type { AgentEngine } from '../janus-runner/types'

export type AgentHookSource = AgentEngine

export type AgentHookLifecycle =
  | 'received'
  | 'started'
  | 'completed'
  | 'failed'
  | 'interrupted'
  | 'approval'
  | 'attention'
  | 'unmatched'
  | 'desktop-toast-shown'
  | 'desktop-toast-failed'
  | 'ignored'

/**
 * Turn-end events synthesized inside the main process (transcript sentinel,
 * pty exit) and fed through the same hook pipeline as CLI-origin events. The
 * namespace guarantees they can never collide with a real CLI hook name, and
 * the coordinator only accepts them while a turn is active (first signal wins).
 */
export const JANUSX_SYNTHETIC_HOOK_EVENTS = {
  /** Terminal API error recorded in the transcript (429/5xx/network abort). */
  apiError: 'janusx.turn.api-error',
  /** User-initiated end (Esc/Ctrl+C interrupt, user kill): silent, no toast. */
  interrupted: 'janusx.turn.interrupted',
  /** Process died while a turn was still running. */
  orphaned: 'janusx.turn.orphaned',
} as const

/**
 * Hook-command argv flag carrying the settings-side matcher that fired the
 * hook (e.g. Claude `Notification` entries bake `--matcher permission_prompt`
 * vs `--matcher idle_prompt`). The hook event name alone cannot tell them
 * apart, so installer and client share this flag instead of duplicating it.
 */
export const JANUSX_HOOK_MATCHER_FLAG = '--matcher' as const

export type AgentHookCompletionKind = 'done' | 'failed' | 'interrupted'

export interface AgentHookTurnStart {
  terminalId: string
  engine: AgentEngine
  source: AgentHookSource
  sessionId?: string
  transcriptPath?: string
}

export interface RegisteredHookTerminal {
  terminalId: string
  engine: AgentEngine
  workspaceId?: string
  cwd?: string
}

export interface AgentHookPayload {
  source: AgentHookSource
  event: string
  terminalId?: string
  workspaceId?: string
  sessionId?: string
  cwd?: string
  message?: string
  timestamp?: string
  /** Settings-side matcher that fired this hook, when the installer baked one in. */
  matcher?: string
  raw?: unknown
}

/** Accepted non-telemetry lifecycle; engine names are interpreted once at ingress. */
export type AgentHookSemantic =
  | { type: 'session-update' }
  | { type: 'turn-start'; resume?: boolean }
  | { type: 'waiting-user'; kind: 'approval' | 'input' }
  | { type: 'turn-end'; kind: AgentHookCompletionKind }
  | { type: 'session-close'; interruptedTurn?: boolean }

export interface AgentHookCoordinatorEvent {
  type: AgentHookLifecycle
  terminalId?: string
  turnId?: string
  engine: AgentEngine
  source: AgentHookSource
  hookEvent: string
  reason?: string
  delivered?: boolean
}

export interface AgentHookCompletion {
  turnId: string
  terminalId: string
  engine: AgentEngine
  source: AgentHookSource
  hookEvent: string
  startedAt?: string
  endedAt: string
  kind: AgentHookCompletionKind
  failed: boolean
  message?: string
}
