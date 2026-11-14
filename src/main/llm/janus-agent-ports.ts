/**
 * @file ChatTurnPorts adapter: JanusX shell services behind the agent facade.
 * @description Pure wiring (no Electron imports): every host capability is an
 * injected function so unit tests drive the adapter without singletons.
 * `chat-orchestrator.ts` supplies the production singletons; twin tests cover
 * parity with the pre-separation inline logic (same errors, same payloads).
 */
import type {
  ExecuteToolInput,
  ToolDefinition,
  ToolManifest,
  ToolResult,
} from '@janus-agent/agent-core'
import type { ChatTurnPorts } from '@janus-agent/janus-agent'
import type { KnowledgeSource, ObservationType, StructuredCloneValue } from '../../shared/knowledge'
import { USER_MEMORY_WORKSPACE_ID, USER_MEMORY_WORKSPACE_PATH } from '../knowledge/constants'
import { detectChatModelBudget } from './chat-model-budget'
import type { AiModelRegistryEntry } from '@janusx/llm-core'

export interface JanusAgentSessionShape {
  id: string
  status: string
  workspace: {
    workspaceId: string
    workspaceRoot: string
  }
}

export interface JanusModelInfoShape {
  id: string
  supportsFunctionCalling?: boolean
  contextWindow?: number
  maxOutputTokens?: number
}

export interface JanusCaptureInput {
  workspaceId: string
  workspacePath: string
  source: KnowledgeSource
  type: ObservationType
  content: string
  summary: string
  tags: string[]
  actor: string
  correlationId: string
  sessionId: string
  metadata?: Record<string, StructuredCloneValue>
}

export interface JanusChatTurnPortsDeps {
  callerId: string
  getProviderSettings: (providerId: string) => Promise<{ modelId?: string; extra?: Record<string, unknown> } | null>
  getLanguageModel: (providerId: string, modelId: string) => Promise<unknown>
  /** Optional: older LlmService shapes lack a catalog; the gate is then skipped. */
  listModels?: (providerId: string) => Promise<JanusModelInfoShape[]>
  resolveModelMetadata?: (modelId: string) => Promise<AiModelRegistryEntry | undefined>
  getMaxTurns: () => Promise<number>
  getAgentSession: (agentSessionId: string) => JanusAgentSessionShape | null | undefined
  forkAgentSession?: NonNullable<ChatTurnPorts['sessions']['forkSession']>
  closeAgentSession?: NonNullable<ChatTurnPorts['sessions']['closeSession']>
  executeFunctionCall: (input: ExecuteToolInput, callerId: string, signal?: AbortSignal) => Promise<ToolResult>
  awaitBackground?: ChatTurnPorts['tools']['awaitBackground']
  listRegistryTools: () => ToolDefinition[]
  listRegistryManifests: () => ToolManifest[] | undefined
  /**
   * Project recall for chat turns. Absent = no turn-level recall; the caller
   * injects its own context as messages instead (maintenance discussions keep
   * their blueprint-scoped recall and never fuse personal history).
   */
  knowledgeSearch?: NonNullable<ChatTurnPorts['knowledgeSearch']>
  /**
   * Turn capture for memory compounding. Absent = no capture; maintenance
   * discussions keep their own engineering observation path.
   */
  captureObservation?: (input: JanusCaptureInput) => Promise<{ workspaceId?: string } | null | undefined>
  scheduleSettled?: (workspaceId: string) => void
  streamTextFn: ChatTurnPorts['streamTextFn']
  /** Mid-turn question UI bridge (shell owns lifecycle; this file only passes it through). */
  question?: ChatTurnPorts['question']
}

/**
 * Shell parity notes (twin-tested; deviation needs a twin test update):
 * - missing provider / model errors match the pre-separation messages
 * - unavailable sessions throw before any model call, same messages
 * - function-calling gate fires only on explicit `false`
 * - capture payloads (tags/actor/summary/metadata) match the inline version;
 *   `notifySettled` fires once per target workspace after capture
 */
export function buildJanusChatTurnPorts(deps: JanusChatTurnPortsDeps): ChatTurnPorts {
  // Narrowed once: the async capture closure below keeps the check.
  // Note: disabled capture is an expected no-op — see .agents/notes/knowledge/memory-domain-controls.md
  const captureObservation = deps.captureObservation ? async (input: JanusCaptureInput) => {
    try { return await deps.captureObservation!(input) }
    catch (error) {
      if (error instanceof Error && error.message === 'memory-capture-disabled') return undefined
      throw error
    }
  } : undefined
  return {
    model: {
      resolve: async (providerId, modelId) => {
        const settings = await deps.getProviderSettings(providerId)
        if (!settings) {
          throw new Error(`Provider "${providerId}" 未配置`)
        }
        const actualModelId = modelId || settings.modelId || ''
        if (!actualModelId) throw new Error('No model ID configured')
        const budget = await detectChatModelBudget(actualModelId, settings, {
          listModels: () => deps.listModels?.(providerId) ?? Promise.resolve([]), resolveModelMetadata: deps.resolveModelMetadata,
        })
        if (!budget.resolved && deps.resolveModelMetadata) throw new Error(`MODEL_LIMITS_UNAVAILABLE: ${actualModelId}. Update the model catalog first; if capacity is still unavailable, configure both context and maximum output tokens.`)
        const model = await deps.getLanguageModel(providerId, actualModelId)
        return {
          model,
          modelId: actualModelId,
          ...budget,
        }
      },
      getMaxTurns: () => deps.getMaxTurns(),
    },
    sessions: {
      ...(deps.forkAgentSession ? { forkSession: deps.forkAgentSession } : {}),
      ...(deps.closeAgentSession ? { closeSession: deps.closeAgentSession } : {}),
      getSession: (agentSessionId) => {
        const session = deps.getAgentSession(agentSessionId)
        if (!session) return null
        return {
          sessionId: session.id,
          workspaceId: session.workspace.workspaceId,
          workspaceRoot: session.workspace.workspaceRoot,
          status: session.status,
        }
      },
    },
    tools: {
      executeFunctionCall: (input, callerId, signal) => deps.executeFunctionCall(input, callerId, signal),
      ...(deps.awaitBackground ? { awaitBackground: deps.awaitBackground } : {}),
      registry: {
        list: () => deps.listRegistryTools(),
        // The facade tolerates an undefined return (`?.() ?? createToolManifests`)
        // and rebuilds manifests itself; the cast only satisfies the declared shape.
        listManifests: (() => deps.listRegistryManifests()) as () => ToolManifest[],
      },
    },
    streamTextFn: deps.streamTextFn,
    ...(deps.question ? { question: deps.question } : {}),
    ...(deps.knowledgeSearch ? { knowledgeSearch: deps.knowledgeSearch } : {}),
    ...(captureObservation ? {
      knowledgeCapture: {
      captureTurn: async (capture) => {
        // Note: project domain keeps turns out of personal memory — see .agents/notes/agent/chat-turn-guard-domain-s6.md
        // Empty targets mean a workspace-free turn; fall back to the person
        // sentinel so the observation still compounds. The seam stays generic:
        // only plain workspace-id strings cross into janus-agentX.
        const targets = capture.targets.length > 0
          ? capture.targets
          : [{
            workspaceId: USER_MEMORY_WORKSPACE_ID,
            workspacePath: USER_MEMORY_WORKSPACE_PATH,
            sessionId: capture.correlationId,
          }]
        for (const target of targets) {
          const sessionId = target.sessionId || capture.correlationId
          if (capture.userText) {
            await captureObservation({
              workspaceId: target.workspaceId,
              workspacePath: target.workspacePath,
              source: 'janus-chat',
              type: 'conversation-turn',
              content: capture.userText,
              summary: 'Janus Chat user message',
              tags: ['janus-chat', 'user'],
              actor: 'user',
              correlationId: capture.correlationId,
              sessionId,
            })
          }
          await captureObservation({
            workspaceId: target.workspaceId,
            workspacePath: target.workspacePath,
            source: 'janus-chat',
            type: 'conversation-turn',
            content: capture.assistantText,
            summary: 'Janus Chat assistant response',
            tags: ['janus-chat', 'assistant'],
            actor: 'assistant',
            correlationId: capture.correlationId,
            sessionId,
            metadata: { providerId: capture.providerId, modelId: capture.modelId },
          })
        }
      },
      notifySettled: async (workspaceId) => {
        deps.scheduleSettled?.(workspaceId)
      },
      },
    } : {}),
  }
}
