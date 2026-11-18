// Note: recover confirmed turn plans for conversation history — .agents/notes/workbench/terminal-dialog-dual-mode.md
import { lstat } from 'node:fs/promises'
import { basename } from 'node:path'
import { readJsonlLinesWithCursor } from '../runtime-telemetry/history'
import { parseJsonLine } from '../sessions/transcript-kernel'
import type { ConversationPlan } from '../../shared/conversation-display'

const MAX_RESTORED_PLANS = 500

function readSteps(value: unknown): ConversationPlan['steps'] | undefined {
  if (!Array.isArray(value) || value.length > 100) return undefined
  const steps: ConversationPlan['steps'] = []
  for (const row of value) {
    if (typeof row?.step !== 'string' || row.step.length > 2000) return undefined
    const status = row.status === 'in_progress' ? 'inProgress' : row.status
    if (status !== 'pending' && status !== 'inProgress' && status !== 'completed') return undefined
    steps.push({ step: row.step, status })
  }
  return steps
}

/** Read only a bound Codex rollout and recover tool calls with an explicit success receipt. */
export async function readCodexTurnPlans(path: string, threadId: string): Promise<Map<string, ConversationPlan>> {
  const plans = new Map<string, ConversationPlan>()
  if (!/^[a-z0-9-]{1,100}$/i.test(threadId) || !basename(path).endsWith(`-${threadId}.jsonl`)) return plans
  if (!(await lstat(path).catch(() => null))?.isFile()) return plans
  const { lines } = await readJsonlLinesWithCursor(path, true)
  const meta = lines[0] ? parseJsonLine(lines[0]) : null
  const identity = meta?.payload as { id?: unknown; session_id?: unknown } | undefined
  if (meta?.type !== 'session_meta' || (identity?.id ?? identity?.session_id) !== threadId) return plans

  let turnId: string | undefined
  let latest: ConversationPlan | undefined
  const pending = new Map<string, Pick<ConversationPlan, 'steps' | 'explanation'>>()
  for (const line of lines) {
    if (!/task_started|turn_context|task_complete|turn_aborted|update_plan|function_call_output/.test(line)) continue
    const record = parseJsonLine(line)
    const payload = record?.payload as Record<string, unknown> | undefined
    if (!payload) continue
    const event = record?.type === 'event_msg' ? payload.type : undefined
    if (event === 'task_started' || record?.type === 'turn_context') {
      const id = payload.turn_id
      if (typeof id !== 'string' || (payload.root_turn_id && payload.root_turn_id !== id)) continue
      if (id !== turnId) { turnId = id; latest = undefined; pending.clear() }
    } else if (event === 'task_complete' || event === 'turn_aborted') {
      if (payload.turn_id !== turnId) continue
      if (latest) {
        plans.set(latest.turnId, { ...latest, outcome: event === 'turn_aborted' ? 'interrupted' : 'completed' })
        if (plans.size > MAX_RESTORED_PLANS) {
          const oldest = plans.keys().next()
          if (!oldest.done) plans.delete(oldest.value)
        }
      }
      turnId = undefined; latest = undefined; pending.clear()
    } else if (turnId && record?.type === 'response_item' && typeof payload.call_id === 'string') {
      if (payload.type === 'function_call' && payload.name === 'update_plan' && typeof payload.arguments === 'string' && payload.arguments.length <= 250_000) {
        const args = parseJsonLine(payload.arguments)
        const steps = readSteps(args?.plan)
        if (steps && pending.size < 100) pending.set(payload.call_id, { steps, explanation: typeof args?.explanation === 'string' ? args.explanation.slice(0, 4000) : '' })
      } else if (payload.type === 'function_call_output') {
        const call = pending.get(payload.call_id)
        pending.delete(payload.call_id)
        if (call && payload.output === 'Plan updated') latest = { ...call, turnId, outcome: 'running', version: (latest?.version ?? 0) + 1 }
      }
    }
  }
  return plans
}
