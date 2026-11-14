import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAgentRuntime } from '@janus-agent/agent-core'
import { bindMemoryToolIdentity, currentMemoryToolEvent } from '../../../src/main/agent/runtime/memory-tool-context'

let root: string
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'janusx-memory-tool-context-')) })
afterEach(async () => { await rm(root, { recursive: true, force: true }) })

describe('host memory tool event context', () => {
  it('preserves the request abort signal through its executeTool wrapper', async () => {
    const runtime = bindMemoryToolIdentity(createAgentRuntime({ resolveWorkspaceRoot: async () => root }))
    let entered!: () => void
    const started = new Promise<void>(resolve => { entered = resolve })
    const execute = vi.fn((_input, context) => new Promise((_resolve, reject) => {
      context.signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true })
      entered()
    }))
    runtime.registry.register({ name: 'probe', description: 'wait', actionRisk: 'read', inputSchema: { type: 'object' }, execute })
    const session = await runtime.createSession({ workspaceId: 'workspace', workspaceRoot: root })
    const controller = new AbortController()
    const pending = runtime.executeFunctionCall({ sessionId: session.id, call: { toolName: 'probe', input: {} } }, 'caller', controller.signal)
    await started
    controller.abort()
    expect((await pending).status).toBe('cancelled')
    await runtime.cancelSession(session.id)
  })
  it('carries the actual runtime event through concurrent calls without accepting payload identity', async () => {
    const runtime = bindMemoryToolIdentity(createAgentRuntime({ resolveWorkspaceRoot: async () => root }))
    runtime.registry.register({ name: 'probe', description: 'read event', actionRisk: 'read', inputSchema: { type: 'object' },
      execute: async () => { await new Promise(resolve => setTimeout(resolve, 5)); return currentMemoryToolEvent() } })
    const one = await runtime.createSession({ workspaceId: 'workspace', workspaceRoot: root })
    const two = await runtime.createSession({ workspaceId: 'workspace', workspaceRoot: root })
    const results = await Promise.all([one, two].map((session, index) => runtime.executeFunctionCall({ sessionId: session.id,
      call: { toolName: 'probe', correlationId: `event-${index}`, input: { sessionId: 'forged', sourceEventId: 'forged' } } })))
    expect(results.map(result => result.output)).toEqual([
      { sessionId: one.id, sourceEventId: 'event-0' }, { sessionId: two.id, sourceEventId: 'event-1' },
    ])
    expect(currentMemoryToolEvent()).toBeUndefined()
  })

  it('uses the same generated correlation id in the tool context and runtime result', async () => {
    const runtime = bindMemoryToolIdentity(createAgentRuntime({ resolveWorkspaceRoot: async () => root }))
    runtime.registry.register({ name: 'probe', description: 'read event', actionRisk: 'read', inputSchema: { type: 'object' }, execute: () => currentMemoryToolEvent() })
    const session = await runtime.createSession({ workspaceId: 'workspace', workspaceRoot: root })
    const result = await runtime.executeTool({ sessionId: session.id, call: { toolName: 'probe', input: {} } })
    expect(result.output).toEqual({ sessionId: session.id, sourceEventId: result.correlationId })
  })
})
