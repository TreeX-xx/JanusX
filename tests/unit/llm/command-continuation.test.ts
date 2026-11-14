import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { WorkspaceAgentRuntime } from '@janus-agent/agent-core'
import { runChatTurn } from '@janus-agent/janus-agent'
import { registerCommandTools } from '../../../src/main/agent/runtime/tools/command-tools'
import { buildJanusChatTurnPorts } from '../../../src/main/llm/janus-agent-ports'
import { attachChatToolEvents } from '../../../src/main/llm/chat-tool-events'
import { bindMemoryToolIdentity } from '../../../src/main/agent/runtime/memory-tool-context'
import { attachNoteChatTools } from '../../../src/main/harness/note-chat'
import { attachAutomationTools } from '../../../src/main/automations/chat-tools'
import { attachLaunchConfigTools } from '../../../src/main/harness/launch-config-chat'
import { ProjectType } from '../../../src/shared/ipc/project'

vi.mock('../../../src/main/automations/host', () => ({ automationService: () => { throw new Error('Unexpected automation execution') } }))

it.each([false, true])('delivers or cancels a command through actual desktop wrappers: cancel=%s', async cancel => {
  const root = await mkdtemp(join(tmpdir(), 'janus-desktop-continuation-'))
  const runtime = bindMemoryToolIdentity(new WorkspaceAgentRuntime(async () => root))
  registerCommandTools(runtime.registry)
  const session = await runtime.createSession({ workspaceId: 'w', workspaceRoot: root, approvalMode: 'auto-run', timeoutMs: 100 })
  const traces: Array<{ status: string; callId?: string }> = []
  const contexts: string[] = []
  let executions = 0
  let rounds = 0
  let executionId: string | undefined
  const controller = new AbortController()
  const ports = buildJanusChatTurnPorts({
    callerId: 'desktop', getProviderSettings: async () => ({ modelId: 'fixture' }), getLanguageModel: async () => ({}), getMaxTurns: async () => 8,
    getAgentSession: id => runtime.getSession(id),
    executeFunctionCall: async (input, caller, signal) => {
      executions++
      const result = await runtime.executeFunctionCall(input, caller, signal)
      executionId = result.continuation?.executionId
      return result
    },
    awaitBackground: (refs, options, caller) => runtime.awaitBackground(refs, options, caller),
    listRegistryTools: () => runtime.registry.list(), listRegistryManifests: () => runtime.registry.listManifests(),
    streamTextFn: async options => {
      rounds++
      contexts.push(JSON.stringify(options.messages))
      return rounds === 1 ? { textStream: (async function* () {})(), fullStream: (async function* () {
        yield { type: 'tool-call', toolCallId: 'build', toolName: 'command_run', args: { program: basename(process.execPath), yieldTimeMs: 10,
          args: ['-e', 'require("fs").appendFileSync("starts.txt","x");setTimeout(()=>console.log("desktop-complete"),300)'] } }
        yield { type: 'finish', finishReason: 'tool-calls' }
      })() } : { textStream: (async function* () { yield rounds === 2 ? 'Waiting.' : 'Verified.' })() }
    },
  })
  const resources = [{ agentSessionId: session.id, workspaceId: 'w', workspacePath: root }]
  attachNoteChatTools(ports, { conversationId: 'c', userText: 'Run checks', signal: controller.signal, resources, onChange: () => {} })
  attachAutomationTools(ports, { workspaceId: 'w', providerId: 'p', modelId: 'fixture', sessionIds: [session.id], signal: controller.signal, onDraft: () => {} })
  attachLaunchConfigTools(ports, { workspaceId: 'w', resources, signal: controller.signal, onChange: () => {},
    draft: { projectPath: root, config: { version: '0.1.0', projectType: ProjectType.Vite, projectName: 'fixture', configurations: [] } } })
  attachChatToolEvents(ports, 'r', entry => traces.push(entry))
  try {
    const result = await runChatTurn({ requestId: 'r', providerId: 'p', callerId: 'desktop', sourceTag: 'harness', workspaceMutationRecovery: false,
      messages: [{ role: 'user', content: 'Run checks' }], workspaceResources: [{ workspaceId: 'w', workspacePath: root, workspaceName: 'W', agentSessionId: session.id }],
    }, ports, { onEvent: event => { if (cancel && event.type === 'tool_execution_update') controller.abort() } }, controller.signal)
    expect(executions).toBe(1)
    if (cancel) {
      expect(result.cancelled).toBe(true)
      expect(rounds).toBe(1)
      const [done] = await runtime.awaitBackground([{ sessionId: session.id, executionId: executionId! }], { signal: new AbortController().signal }, 'desktop')
      expect(done.result.status).toBe('cancelled')
      return
    }
    expect(rounds).toBe(3)
    expect(contexts.at(-1)).toContain('desktop-complete')
    expect(traces.map(trace => [trace.callId, trace.status])).toEqual([['build', 'running'], ['build', 'completed']])
    expect(result.toolTraces.map(trace => trace.status)).toEqual(['completed'])
    expect(await readFile(join(root, 'starts.txt'), 'utf8')).toBe('x')
  } finally {
    await runtime.cancelSession(session.id)
    await rm(root, { recursive: true, force: true })
  }
})
