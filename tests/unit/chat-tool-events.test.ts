import { expect, it, vi } from 'vitest'
import type { ChatTurnPorts } from '@janus-agent/janus-agent'
import { attachChatToolEvents, currentChatCallId } from '../../src/main/llm/chat-tool-events'

it('forwards request cancellation and publishes deferred receipts on the original call', async () => {
  const controller = new AbortController()
  const receipt = { toolName: 'command.run', workspaceId: 'w', correlationId: 'c', status: 'completed', summary: 'done', output: { ok: true, exitCode: 0 } }
  const execute = vi.fn(async () => ({ ...receipt, continuation: { executionId: 'e' }, output: { state: 'running' } }))
  const wait = vi.fn(async () => [{ executionId: 'e', result: receipt }])
  const entries: any[] = []
  const ports = { tools: { executeFunctionCall: execute, awaitBackground: wait } } as unknown as ChatTurnPorts
  attachChatToolEvents(ports, 'r', entry => entries.push(entry))
  const input = { sessionId: 's', call: { toolName: 'command.run', input: {}, correlationId: 'c' } }
  await ports.tools.executeFunctionCall(input, 'caller', controller.signal)
  expect(execute).toHaveBeenCalledWith(input, 'caller', controller.signal)
  await ports.tools.awaitBackground!([{ sessionId: 's', executionId: 'e' }], { signal: controller.signal }, 'caller')
  expect(entries.map(entry => entry.callId)).toEqual(['c', 'c'])
  expect(entries.map(entry => entry.status)).toEqual(['running', 'completed'])
  controller.abort()
  await ports.tools.awaitBackground!([{ sessionId: 's', executionId: 'e' }], { signal: controller.signal }, 'caller')
  expect(entries).toHaveLength(2)
})

it('keeps parallel same-name calls and their business events bound to the originating call', async () => {
  const seen: string[] = []
  const entries: any[] = []
  const ports = { tools: { executeFunctionCall: async (input: any) => {
    await new Promise(resolve => setTimeout(resolve, input.call.correlationId === 'a' ? 10 : 0))
    seen.push(currentChatCallId()!)
    return { toolName: 'workspace.read', workspaceId: 'w', status: 'completed', summary: 'read', output: {}, correlationId: input.call.correlationId }
  } } } as unknown as ChatTurnPorts
  attachChatToolEvents(ports, 'r', entry => entries.push(entry))
  await Promise.all(['a', 'b'].map(id => ports.tools.executeFunctionCall({ sessionId: 's', call: { toolName: 'workspace.read', correlationId: id } }, 'caller')))
  expect(seen).toEqual(['b', 'a'])
  expect(entries.map(entry => entry.callId)).toEqual(['b', 'a'])
  expect(currentChatCallId()).toBeUndefined()
})

it('projects config validation receipts without archiving the business payload', async () => {
  const entries: any[] = []
  const ports = { tools: { executeFunctionCall: async () => ({ toolName: 'launch-config.get', workspaceId: 'w', status: 'completed', summary: 'read',
    output: { summary: 'draft read', config: { configurations: [{ env: { TOKEN: 'must-not-archive' } }] },
      validation: { valid: false, errors: [{ field: 'program', message: 'Missing program' }], warnings: [] } } }) } } as unknown as ChatTurnPorts
  attachChatToolEvents(ports, 'r', entry => entries.push(entry))
  await ports.tools.executeFunctionCall({ sessionId: 's', call: { toolName: 'launch-config.get', correlationId: 'read' } }, 'caller')
  expect(entries[0]).toMatchObject({ callId: 'read', configResult: { operation: 'read', valid: false, errors: ['program: Missing program'], applied: false } })
  expect(JSON.stringify(entries)).not.toContain('must-not-archive')
})
