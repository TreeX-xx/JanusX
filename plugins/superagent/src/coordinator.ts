// Note: .agents/notes/agent/superagent-plugin-migration.md — one native activation owns its admitted turns.
import { NativeServiceError, type JsonValue } from '@janusx/plugin-sdk'
import { z } from 'zod'

const identity = z.string().min(1).max(128)
const backend = z.enum(['codex', 'claude'])
const scope = z.object({ version: z.literal(1), turnId: z.string().uuid(), workspaceId: identity, conversationId: identity }).strict()
const input = scope.extend({ eventId: identity, inputId: identity, backend: backend.optional() })
const scheduling = z.object({
  version: z.literal(1), workspaceId: identity, workId: identity,
  launching: z.boolean(), live: z.boolean(), preparing: z.boolean(),
  node: z.object({ flow: z.string(), state: z.string(), dependencies: z.array(z.string().nullable()).max(1024) }).strict().nullable(),
}).strict()
const withdrawal = scope.extend({ eventId: identity })
const route = scope.extend({ tool: z.enum(['work_route', 'work_plan']), arguments: z.record(z.unknown()) })
type Input = z.infer<typeof input>
type Turn = { workspaceId: string; conversationId: string; inputs: Map<string, Input> }

export function createCoordinator(host?: { call(method: string, value: JsonValue, signal: AbortSignal): Promise<JsonValue> }) {
  const turns = new Map<string, Turn>()
  return {
    async call(method: string, value: JsonValue, signal: AbortSignal): Promise<JsonValue> {
      signal.throwIfAborted()
      if (method === 'settings.read' || method === 'settings.save' || method === 'workers.list') {
        const view = z.object({ instanceId: z.string().uuid(), input: z.unknown(), project: z.object({ id: identity }).passthrough().nullable() }).strict().parse(value)
        if (!host || method === 'workers.list' && !view.project) throw new NativeServiceError('STALE_CONTEXT')
        return host.call('superagent.' + method, { workspaceId: view.project?.id ?? null, input: view.input as JsonValue }, signal)
      }
      if (method === 'scheduler.admit') {
        const { node, preparing, live, launching } = scheduling.parse(value)
        if (!node) return !preparing
        if (!launching && live && node.flow === 'paused' && node.state === 'running') return true
        return node.flow === 'running' && ['admitting', 'queued', 'running'].includes(node.state)
          && node.dependencies.every(state => state === 'done')
      }
      const key = scope.strip().parse(value)
      const turn = turns.get(key.turnId)
      if (turn && (turn.workspaceId !== key.workspaceId || turn.conversationId !== key.conversationId)) throw new NativeServiceError('STALE_CONTEXT')
      if (method === 'turn.open') {
        scope.parse(value)
        if (!turn && turns.size >= 128) throw new NativeServiceError('RATE_LIMITED')
        if (!turn) turns.set(key.turnId, { ...key, inputs: new Map() })
        return null
      }
      if (method === 'turn.close') { scope.parse(value); turns.delete(key.turnId); return null }
      if (!turn) throw new NativeServiceError('STALE_CONTEXT')
      if (method === 'turn.instructions') { scope.parse(value); return 'Inline engine labels [[engine:claude]] and [[engine:codex]] identify the requested engine for the adjacent task in the user input. Preserve their positions and task associations. A message may request multiple engines (for example Claude implementation followed by Codex testing): use work_plan with the respective workerBackend on each node and dependencies matching the requested order. These labels do not select one backend for the whole message. Ask for clarification if task associations are ambiguous.'
        + '\nScheduling receipts are authoritative: queued or paused means accepted but not started/delivered. Report the returned global queuePosition and waitReason when present. Capacity is global; waiting work automatically starts when a slot becomes free. Do not promise immediate execution for queued work.' }
      if (method === 'turn.input') {
        const admitted = input.parse(value)
        const previous = turn.inputs.get(admitted.eventId)
        if (previous && (previous.inputId !== admitted.inputId || previous.backend !== admitted.backend)) throw new NativeServiceError('STALE_CONTEXT')
        turn.inputs.set(admitted.eventId, admitted)
        return null
      }
      if (method === 'turn.withdraw') { turn.inputs.delete(withdrawal.parse(value).eventId); return null }
      if (method !== 'turn.route') throw new NativeServiceError('UNKNOWN_METHOD')
      const request = route.parse(value)
      const args = request.arguments
      const admitted = [...turn.inputs.values()].find(row => row.inputId === args.inputId)
      if (!admitted) throw new NativeServiceError('INPUT_NOT_ADMITTED')
      const selected = admitted.backend
      if (!selected) return { arguments: args } as JsonValue
      if (request.tool === 'work_plan') {
        const nodes = z.array(z.record(z.unknown())).parse(args.nodes)
        if (nodes.some(node => node.workerBackend && node.workerBackend !== selected)) throw new NativeServiceError('WORKER_BACKEND_CONFLICT')
        return { arguments: { ...args, nodes: nodes.map(node => ({ ...node, workerBackend: selected })) }, selected } as JsonValue
      }
      if (args.workerBackend && args.workerBackend !== selected) throw new NativeServiceError('WORKER_BACKEND_CONFLICT')
      return { arguments: args.action === 'new' ? { ...args, workerBackend: selected } : args, selected } as JsonValue
    },
    async stop() { turns.clear() },
  }
}
