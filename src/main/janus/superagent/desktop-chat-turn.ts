import { randomUUID } from 'node:crypto'
import type { JsonValue } from '@janusx/plugin-sdk'
import { createSuperAgentChatTurn as createEngineTurn } from './chat-tools'
import type { WorkerBackend } from '../../../shared/superagent'
import { DesktopSuperAgentService } from './desktop-service'

/** UI selections are constraints on admitted inputs, not model-generated hints. */
export async function createSuperAgentChatTurn(options: Parameters<typeof createEngineTurn>[0] & { workerBackend?: WorkerBackend }) {
  const service = options.service
  if (!(service instanceof DesktopSuperAgentService) || !service.activation) throw new Error('SuperAgent plugin is unavailable')
  const activation = service.activation
  const lifetime = AbortSignal.any([options.signal, activation.signal, ...(service.removal ? [service.removal.admission.signal] : [])])
  const scope = { version: 1, turnId: randomUUID(), workspaceId: options.workspaceId, conversationId: options.conversationId }
  const invoke = (method: string, values: Record<string, JsonValue> = {}, signal = lifetime) =>
    activation.call(method, { ...scope, ...values }, signal)
  const close = () => activation.active ? activation.call('turn.close', scope).catch(() => {}) : Promise.resolve()
  const remember = async (eventId: string, backend?: WorkerBackend) => {
    if (backend) await service.workerPolicy?.resolveBackend(backend)
    const input = (await service.snapshot(options.workspaceId)).inputs.find(row => row.eventId === eventId && row.conversationId === options.conversationId)
    if (!input) throw new Error('SuperAgent input is not admitted')
    await invoke('turn.input', { eventId, inputId: input.id, ...(backend ? { backend } : {}) })
  }
  await invoke('turn.open')
  let turn: Awaited<ReturnType<typeof createEngineTurn>>
  try {
    turn = await createEngineTurn({ ...options, signal: lifetime })
    await remember(options.eventId, options.workerBackend)
  } catch (error) { await close(); throw error }
  return { ...turn, close,
    revoke(eventId: string) {
      turn.revoke(eventId)
      void invoke('turn.withdraw', { eventId }).catch(() => {})
    },
    async steering(eventId: string, text: string, backend?: WorkerBackend) {
      const result = await turn.steering(eventId, text)
      await remember(eventId, backend)
      return result + (backend ? `\nHost-selected Worker backend for this input: ${backend}. This constraint must be preserved.` : '')
    },
    async attach(ports: Parameters<typeof turn.attach>[0]) {
      const context = await turn.attach(ports)
      ports.localTools = ports.localTools?.map(tool => !['work_route', 'work_plan'].includes(tool.name) ? tool : { ...tool,
        execute: async (call, signal) => {
          try {
            const combined = AbortSignal.any([signal, lifetime])
            const routed = await invoke('turn.route', { tool: tool.name, arguments: call.arguments as JsonValue }, combined)
            combined.throwIfAborted()
            const { arguments: args, selected } = routed as { arguments: Record<string, JsonValue>; selected?: WorkerBackend }
            if (selected) {
              await service.workerPolicy?.resolveBackend(selected)
              if (['continue', 'reopen'].includes(String(args.action))) await service.checkWorker(options.workspaceId, args.workId, selected)
            }
            combined.throwIfAborted()
            return tool.execute({ ...call, arguments: args }, combined)
          } catch (error) { return { content: String(error), isError: true } }
        },
      })
      return context + `\nWorker policy: ${JSON.stringify(await service.workerPolicy?.policy())}. Use only enabled backends. Explicit disabled requests must be reported, never silently substituted.`
        + '\n' + await invoke('turn.instructions')
        + (options.workerBackend ? `\nHost-selected Worker backend for current input: ${options.workerBackend}. Preserve it when arranging work.` : '')
    },
  }
}
