import { createSuperAgentChatTurn as createEngineTurn } from './chat-tools'
import type { WorkerBackend } from '../../../shared/superagent'
import { DesktopSuperAgentService } from './desktop-service'

/** UI selections are constraints on admitted inputs, not model-generated hints. */
export async function createSuperAgentChatTurn(options: Parameters<typeof createEngineTurn>[0] & { workerBackend?: WorkerBackend }) {
  const service = options.service
  const policy = service instanceof DesktopSuperAgentService ? service.workerPolicy : undefined
  const selections = new Map<string, WorkerBackend>()
  const remember = async (eventId: string, backend?: WorkerBackend) => {
    if (backend === undefined) return
    if (!['codex', 'claude'].includes(backend)) throw new Error('Unsupported Worker backend')
    await policy?.resolveBackend(backend)
    const input = (await service.snapshot(options.workspaceId)).inputs.find(row => row.eventId === eventId && row.conversationId === options.conversationId)
    if (!input) throw new Error('Worker selection has no admitted input')
    selections.set(input.id, backend)
  }
  const turn = await createEngineTurn(options)
  await remember(options.eventId, options.workerBackend)
  return { ...turn,
    async steering(eventId: string, text: string, backend?: WorkerBackend) {
      const result = await turn.steering(eventId, text)
      await remember(eventId, backend)
      return result + (backend ? `\nHost-selected Worker backend for this input: ${backend}. This constraint must be preserved.` : '')
    },
    async attach(ports: Parameters<typeof turn.attach>[0]) {
      const context = await turn.attach(ports)
      ports.localTools = ports.localTools?.map(tool => !['work_route', 'work_plan'].includes(tool.name) ? tool : { ...tool,
        execute: async (call, signal) => {
          const args = call.arguments as { inputId?: string; action?: string; workId?: string; workerBackend?: WorkerBackend }
          const selected = args && selections.get(args.inputId ?? '')
          try {
            if (selected && tool.name === 'work_plan') {
              await policy?.resolveBackend(selected)
              const plan = call.arguments as { nodes?: Array<{ workerBackend?: WorkerBackend }> }
              if (!Array.isArray(plan.nodes)) throw new Error('Workflow nodes are required')
              if (plan.nodes.some(node => node.workerBackend && node.workerBackend !== selected)) throw new Error('Worker backend conflicts with the user selection')
              return tool.execute({ ...call, arguments: { ...plan, nodes: plan.nodes.map(node => ({ ...node, workerBackend: selected })) } }, signal)
            }
            if (selected && ['new', 'continue', 'reopen'].includes(args.action ?? '')) {
              await policy?.resolveBackend(selected)
              if (args.workerBackend && args.workerBackend !== selected) throw new Error('Worker backend conflicts with the user selection')
              if (args.action === 'new') return tool.execute({ ...call, arguments: { ...args, workerBackend: selected } }, signal)
              if (!(service instanceof DesktopSuperAgentService) || !args.workId) throw new Error('Cannot verify the selected Worker backend')
              await service.checkWorker(options.workspaceId, args.workId, selected)
            }
            return tool.execute(call, signal)
          } catch (error) { return { content: String(error), isError: true } }
        },
      })
      return context + `\nWorker policy: ${JSON.stringify(await policy?.policy())}. Use only enabled backends. Explicit disabled requests must be reported, never silently substituted.`
        + '\nInline engine labels [[engine:claude]] and [[engine:codex]] identify the requested engine for the adjacent task in the user input. Preserve their positions and task associations. A message may request multiple engines (for example Claude implementation followed by Codex testing): use work_plan with the respective workerBackend on each node and dependencies matching the requested order. These labels do not select one backend for the whole message. Ask for clarification if task associations are ambiguous.'
        + '\nScheduling receipts are authoritative: queued or paused means accepted but not started/delivered. Report the returned global queuePosition and waitReason when present. Capacity is global; waiting work automatically starts when a slot becomes free. Do not promise immediate execution for queued work.'
        + (options.workerBackend ? `\nHost-selected Worker backend for current input: ${options.workerBackend}. Preserve it when arranging work.` : '')
    },
  }
}
