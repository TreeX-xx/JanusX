// Note: .agents/notes/desktop/browser-computer-use.md
import type { ChatTurnPorts } from '@janus-agent/janus-agent'
import type { AgentApprovalMode } from '../../shared/ipc/agent-runtime'
import { configService } from '../config/service'
import { beginComputerTurn, callComputer, computerTurnSignal, endComputerTurn } from './control'
import { computerReadTools, computerTools } from './tools'

export async function attachComputerTools(ports: ChatTurnPorts, opts: {
  owner: string; runId: string; signal: AbortSignal; getApprovalMode(): Promise<AgentApprovalMode>
}) {
  if (!(await configService.getControlSettings()).computer.enabled) return
  await beginComputerTurn(opts.runId, opts.owner)
  if (opts.signal.aborted) { endComputerTurn(opts.runId); opts.signal.throwIfAborted() }
  ports.localTools = [...(ports.localTools ?? []), ...computerTools.map(({ tool, schema }) => ({
    name: 'computer_' + tool.name, description: tool.description!, parameters: schema, executionMode: 'sequential' as const,
    execute: async (call: { arguments: unknown; id: string }, toolSignal: AbortSignal) => {
      try {
        const args = schema.parse(call.arguments)
        const signal = AbortSignal.any([opts.signal, toolSignal, computerTurnSignal(opts.runId)])
        if (!computerReadTools.has(tool.name)) {
          const mode = await opts.getApprovalMode()
          if (mode === 'plan') throw new Error('Computer actions are unavailable in plan mode')
          if (mode !== 'auto-run') {
            const zh = (await configService.get()).language !== 'en'
            const allow = zh ? '允许一次' : 'Allow once'
            const answer = await ports.question?.askUser({ callId: call.id, allowCustom: false, questions: [{
              header: zh ? '电脑控制' : 'Computer control', question: tool.name + ' · ' + JSON.stringify(args).slice(0, 400), multiple: false,
              options: [{ label: allow }, { label: zh ? '拒绝' : 'Deny' }],
            }] }, signal)
            if (answer?.status !== 'answered' || !answer.answers.some(a => a.selected.includes(allow))) throw new Error('Computer action was not approved')
          }
        }
        return { content: JSON.stringify(await callComputer(opts.runId, tool.name, args, signal)) }
      } catch (e) { return { content: e instanceof Error ? e.message : String(e), isError: true } }
    },
  }))]
}
