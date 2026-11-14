import { AsyncLocalStorage } from 'node:async_hooks'
import { toolTraceEntryFromResult } from '@janus-agent/chat-core'
import type { ChatTurnPorts } from '@janus-agent/janus-agent'
import type { ChatToolTraceEntry } from '../../shared/ipc/llm'

// Note: call identity also binds business events produced inside tools — see .agents/notes/agent/requirements/chat-work-timeline.md
const activeCall = new AsyncLocalStorage<string>()
export const currentChatCallId = () => activeCall.getStore()

/** Emit each redacted result before stream_end can unsubscribe the renderer. */
export function attachChatToolEvents(ports: ChatTurnPorts, requestId: string, onTrace: (entry: ChatToolTraceEntry) => void): void {
  const execute = ports.tools.executeFunctionCall.bind(ports.tools)
  const awaitBackground = ports.tools.awaitBackground?.bind(ports.tools)
  ports.tools = { ...ports.tools,
    ...(awaitBackground ? { awaitBackground: async (...args: Parameters<NonNullable<ChatTurnPorts['tools']['awaitBackground']>>) => {
      const results = await awaitBackground(...args)
      if (args[1].signal.aborted) return []
      for (const { result } of results) onTrace({ ...toolTraceEntryFromResult(result, requestId), callId: result.correlationId })
      return results
    } } : {}),
    executeFunctionCall: (input, callerId, signal) => {
    const callId = input.call.correlationId
    return activeCall.run(callId ?? '', async () => {
      const result = await execute(input, callerId, signal)
      const trace: ChatToolTraceEntry = { ...toolTraceEntryFromResult(result, requestId), ...(callId ? { callId } : {}) }
      const output = result.output as { summary?: unknown; validation?: { valid: boolean; errors: Array<{ field: string; message: string }>; warnings: Array<{ field: string; message: string }> }; applied?: boolean } | undefined
      if (/^launch-config\.(get|edit|apply)$/.test(result.toolName) && output?.validation) {
        const issues = (values: Array<{ field: string; message: string }>) => values.slice(0, 20).map(value => `${value.field}: ${value.message}`.slice(0, 2000))
        trace.configResult = { operation: result.toolName.endsWith('.get') ? 'read' : result.toolName.endsWith('.edit') ? 'edit' : 'apply',
          summary: typeof output.summary === 'string' ? output.summary.slice(0, 2000) : '', valid: output.validation.valid,
          errors: issues(output.validation.errors), warnings: issues(output.validation.warnings), applied: output.applied === true }
      }
      onTrace(trace)
      return result
    })
  } }
}
