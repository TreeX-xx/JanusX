// Note: .agents/notes/desktop/browser-computer-use.md
import { z } from 'zod'
import { toolSchemaToZod } from '@janus-agent/agent-core'
import type { ChatTurnPorts } from '@janus-agent/janus-agent'
import { configService } from '../config/service'
import { browserControl } from './control-service'
import { READ_BROWSER_TOOLS } from './control-broker'
import type { AgentApprovalMode } from '../../shared/ipc/agent-runtime'

// Preserve upstream schemas; normalize the integer-only exclusive bound used for page sizes.
function modelSchema(input: unknown): Parameters<typeof toolSchemaToZod>[0] {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid browser tool schema')
  const result: Record<string, unknown> = { ...input }
  if ('exclusiveMinimum' in result) { result.minimum = Number(result.exclusiveMinimum) + (result.type === 'integer' ? 1 : 0); delete result.exclusiveMinimum }
  if (result.properties) result.properties = Object.fromEntries(Object.entries(result.properties as Record<string, unknown>)
    .filter(([key]) => !['filePath', 'requestFilePath', 'responseFilePath'].includes(key)).map(([key, value]) => [key, modelSchema(value)]))
  if (result.items) result.items = modelSchema(result.items)
  if (Array.isArray(result.anyOf)) result.anyOf = result.anyOf.map(modelSchema)
  return result as Parameters<typeof toolSchemaToZod>[0]
}
export async function attachBrowserTools(ports: ChatTurnPorts, options: { owner: string; runId: string; signal: AbortSignal; root?: string; getApprovalMode?(): Promise<AgentApprovalMode> }): Promise<void> {
  if (!(await configService.getControlSettings()).browser.enabled) return
  const broker = browserControl()
  broker.beginTurn(options.runId)
  const tools = await broker.catalog()
  options.signal.throwIfAborted()
  ports.localTools = [...(ports.localTools ?? []), ...tools.map(tool => ({
    name: `browser_${tool.name}`, description: `Control JanusX's visible embedded browser. Use browser_list_pages for host pageId values; select an uncontrolled page before reading it. ${tool.description ?? ''}`,
    parameters: tool.name === 'new_page' ? z.object({ url: z.string().url() }).strict()
      : tool.name === 'select_page' || tool.name === 'close_page' ? z.object({ pageId: z.number().int().positive() }).strict()
        : toolSchemaToZod(modelSchema(tool.inputSchema)),
    executionMode: 'sequential' as const,
    execute: async (call: { arguments: unknown; id: string }, toolSignal: AbortSignal) => {
      try {
        const signal = AbortSignal.any([options.signal, toolSignal])
        signal.throwIfAborted()
        if (!READ_BROWSER_TOOLS.has(tool.name)) {
          const mode = await (options.getApprovalMode?.() ?? configService.getAgentApprovalMode())
          if (mode === 'plan') throw new Error('Browser actions are unavailable in plan mode')
          if (mode !== 'auto-run') {
            const args = call.arguments as Record<string, unknown>
            const chinese = (await configService.get()).language !== 'en'
            const allow = chinese ? '允许' : 'Allow'
            const answer = await ports.question?.askUser({ callId: call.id, allowCustom: false,
              questions: [{ header: chinese ? '浏览器' : 'Browser', question: `${chinese ? '允许执行浏览器操作' : 'Allow browser action'} ${tool.name}? ${JSON.stringify({ pageId: args.pageId, url: args.url, files: args.filePaths }).slice(0, 600)}`, multiple: false,
                options: [{ label: allow }, { label: chinese ? '拒绝' : 'Deny' }] }] }, signal)
            if (answer?.status !== 'answered' || !answer.answers.some(answer => answer.selected.includes(allow))) throw new Error('Browser action was not approved')
          }
        }
        const result = await broker.call(options.owner, options.runId, tool.name, call.arguments as Record<string, unknown>, signal, options.root)
        return { content: JSON.stringify(result) }
      } catch (error) { return { content: error instanceof Error ? error.message : String(error), isError: true } }
    },
  }))]
}
