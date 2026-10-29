// Note: shared non-statistical semantics — .agents/notes/terminal/terminal-hook-launch-isolation.md
import { matchesEngineEvents } from './agent-engine-capabilities'
import { JANUSX_SYNTHETIC_HOOK_EVENTS, type AgentHookPayload, type AgentHookSemantic } from './agent-hook-types'

export function getHookMatcher(payload: AgentHookPayload): string | undefined {
  if (payload.matcher?.trim()) return payload.matcher.trim()
  const raw = payload.raw as Record<string, unknown> | undefined
  const value = raw && (raw.matcher ?? raw.notification_type ?? raw.type)
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

export function normalizeHookLifecycle(payload: AgentHookPayload): AgentHookSemantic | undefined {
  const { source, event, raw } = payload
  if (event === 'SessionEnd' || event === 'session.deleted') return { type: 'session-close' }
  if (event === 'SessionStart' || event === 'session.created' || event === 'session.updated') return { type: 'session-update' }
  if (event === 'permission.replied') return { type: 'turn-start', resume: true }
  if (matchesEngineEvents(source, 'start', event, raw)) return { type: 'turn-start' }
  if (event === 'session.execution.interrupted' || event === 'Interrupt' || event === JANUSX_SYNTHETIC_HOOK_EVENTS.interrupted) return { type: 'turn-end', kind: 'interrupted' }
  if (event === JANUSX_SYNTHETIC_HOOK_EVENTS.apiError || event === JANUSX_SYNTHETIC_HOOK_EVENTS.orphaned
    || matchesEngineEvents(source, 'fail', event, raw)) return { type: 'turn-end', kind: 'failed' }
  if (matchesEngineEvents(source, 'complete', event, raw)) return { type: 'turn-end', kind: 'done' }
  if (matchesEngineEvents(source, 'approval', event, raw)
    || event === 'Notification' && getHookMatcher(payload) === 'permission_prompt') return { type: 'waiting-user', kind: 'approval' }
  if (matchesEngineEvents(source, 'attention', event, raw)) return { type: 'waiting-user', kind: 'input' }
  return undefined
}
