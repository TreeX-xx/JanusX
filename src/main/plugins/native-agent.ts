import { randomUUID } from 'node:crypto'
import { createAgentRuntime, type ToolDefinition } from '@janus-agent/agent-core'
import { ManagedChatSession } from '@janus-agent/chat-core'
import { runChatTurn } from '@janus-agent/janus-agent'
import { nativeAgentRequestSchema, NativeServiceError, type JsonValue, type NativeHandler } from '@janusx/plugin-sdk'
import type { InstalledPlugin } from '../../shared/ipc/plugins'
import { hasPluginProjectAccess } from '../../shared/plugin-project-access'
import { llmService } from '../llm/LlmService'
import { buildJanusChatTurnPorts } from '../llm/janus-agent-ports'
import { generateText, streamText } from '../llm/ai-runtime'
import type { NativePluginService } from './native-service'
import { nativeAbortable } from './native-models'
import { NativeAgentProgressStream } from './native-agent-progress'

/** Generic private Agent turn: tools belong to the requesting service and credentials stay in the host. */
export function nativeAgentHost(record: InstalledPlugin, service: () => NativePluginService,
  resolveProject: (id: string, root: string | null) => Promise<{ root: string; name: string }>): NativeHandler {
  let active = 0
  const requests: number[] = []
  return async (method, value, signal) => {
    if (method !== 'agent.run') throw new NativeServiceError('UNKNOWN_METHOD')
    if (!record.manifest.permissions.some(permission => permission.name === 'models.generate')) throw new NativeServiceError('PERMISSION_DENIED')
    const parsed = nativeAgentRequestSchema.safeParse(value)
    if (!parsed.success) throw new NativeServiceError('INVALID_REQUEST')
    const input = parsed.data
    if (input.progress && !record.manifest.capabilities.required.includes('models.agent.progress')) throw new NativeServiceError('PERMISSION_DENIED')
    if (!hasPluginProjectAccess(record, input.projectId)) throw new NativeServiceError('PATH_NOT_GRANTED')
    const project = await resolveProject(input.projectId, input.root)
    signal.throwIfAborted()
    const now = Date.now()
    while (requests.length && now - requests[0] > 60_000) requests.shift()
    if (active >= 2 || requests.length >= 4) throw new NativeServiceError('RATE_LIMITED')
    active++; requests.push(now)
    const workspaceId = randomUUID(), callerId = `plugin:${record.manifest.id}:${input.runId}`
    const runtime = createAgentRuntime({ resolveWorkspaceRoot: async id => id === workspaceId ? project.root : null })
    try {
      for (const tool of input.tools) runtime.registry.register({ name: tool.name, description: tool.description, actionRisk: tool.actionRisk,
        inputSchema: tool.inputSchema as unknown as ToolDefinition['inputSchema'],
        execute: async args => service().call('agent.tool', { runId: input.runId, tool: tool.name, input: args as JsonValue }, signal),
      })
      const session = await runtime.createSession({ workspaceId, workspaceRoot: project.root, approvalMode: 'auto-run', timeoutMs: 600_000 }, callerId)
      let progress: NativeAgentProgressStream | undefined
      const cancel = () => { progress?.close(); void runtime.cancelSession(session.id) }
      signal.addEventListener('abort', cancel, { once: true })
      try {
        signal.throwIfAborted()
        const provider = await nativeAbortable(llmService.getProviderSettings('janus', input.providerId), signal)
        signal.throwIfAborted()
        if (!provider || provider.enabled === false) throw new NativeServiceError('MODEL_UNAVAILABLE')
        const model = await nativeAbortable(llmService.getLanguageModel('janus', input.providerId, input.modelId), signal)
        signal.throwIfAborted()
        if (input.progress) progress = new NativeAgentProgressStream(input.runId, provider.apiKey, input.tools.map(tool => tool.name),
          value => service().call('agent.progress', value, signal))
        const ports = buildJanusChatTurnPorts({ callerId, getProviderSettings: async () => ({ modelId: input.modelId, extra: provider.extra }),
          getLanguageModel: async () => model, listModels: () => llmService.listModels('janus', input.providerId),
          resolveModelMetadata: id => llmService.resolveModelMetadata(id), getMaxTurns: async () => 64,
          getAgentSession: id => runtime.getSession(id), executeFunctionCall: (call, caller) => runtime.executeFunctionCall(call, caller),
          listRegistryTools: () => runtime.registry.list(), listRegistryManifests: () => runtime.registry.listManifests(), streamTextFn: streamText as never,
        })
        const result = await nativeAbortable(runChatTurn({ requestId: input.runId, sourceTag: 'harness', providerId: input.providerId, modelId: input.modelId, callerId,
          messages: input.messages, systemPromptPrefix: input.system, chatSession: new ManagedChatSession(), toolAllowlist: input.tools.map(tool => tool.name),
          workspaceResources: [{ workspaceId, workspacePath: project.root, workspaceName: project.name, agentSessionId: session.id }],
          compactionSummarizer: async (request, abort) => (await generateText({ model, system: request.system, prompt: request.prompt, maxTokens: 4096, maxRetries: 0, abortSignal: abort })).text,
        }, ports, { onEvent: event => progress?.push(event) }, signal), signal)
        signal.throwIfAborted()
        if (provider.apiKey && result.text.includes(provider.apiKey)) throw new NativeServiceError('MODEL_UNAVAILABLE')
        await progress?.finish(result.text)
        signal.throwIfAborted()
        return { text: result.text, cancelled: result.cancelled, toolTraces: result.toolTraces.map(trace => ({ status: trace.status })) }
      } finally { progress?.close(); signal.removeEventListener('abort', cancel); await runtime.cancelSession(session.id) }
    } catch (cause) {
      if (cause instanceof NativeServiceError) throw cause
      if (signal.aborted) throw new NativeServiceError('CANCELLED')
      throw new NativeServiceError('MODEL_UNAVAILABLE')
    } finally { active-- }
  }
}
