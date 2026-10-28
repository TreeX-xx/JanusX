/**
 * @file Chat 流式编排器（M3 收薄：Electron 壳适配器）
 * @description 整轮语义（资源校验、knowledge recall、工具装配、recovery、
 * 空回复兜底、observation 落库）已下沉到 `@janus-agent/janus-agent` 的
 * `runChatTurn`；本文件只保留壳侧能力，任何改动配 twin test
 * （tests/unit/llm/janus-agent-ports.test.ts）：
 *              - AbortController 生命周期与重复 requestId 仲裁
 *              - R6 steering 目标注册（端口实例来自 agent-core，壳只管生命周期）
 *              - ChatSessionRuntime LRU（实例来自 chat-core，随请求传入）
 *              - delta 40ms 合批；reasoning 按段由 renderer 有界保留
 *              - 窗口销毁守卫（reply 前检查 isDestroyed）
 *              - IPC 扇出：agentEvent / legacy delta / recallTrace / toolTrace / done / error
 * 偏离说明：recallTrace 通道改为整轮结束后再发（facade 经 result 返回；
 * 同 requestId，渲染端行为不变，仅徽标出现时机后移）。
 */

// Note: policy-neutral loop core with shell-side duties only — see .agents/notes/agent/agent-loop-refactor.md
import { llmService } from './LlmService'
import { configService, DEFAULT_AGENT_MAX_STEPS } from '../config/service'
import { captureEngineeringUserMemory } from '../knowledge/engineering-user-memory'
import { knowledgeProcessingQueue } from '../knowledge/processing-queue'
import { knowledgeContextService } from '../knowledge/context-service'
import { LLM_CHANNELS } from '../../shared/ipc/llm'
import type { ChatAgentEvent, ChatAnswerQuestionPayload, ChatQuestionAnswer, ChatSteerInput, ChatWorkspaceResource } from '../../shared/ipc/llm'
import { attachMemoChatTools, memoSteeringContext } from '../memo/chat-tools'
import { MEMO_TARGET_PROMPT, mentionsMemoWorkspace } from '../../shared/memo-chat-target'
import { workspaceAgentRuntime, workflowSessionParents } from '../agent/runtime/shell-runtime'
import { streamChatModel as streamText } from './chat-model-stream'
import { attachChatToolEvents, currentChatCallId } from './chat-tool-events'
import {
  runChatTurn,
  resolveWorkflowXMode,
  parseWorkflowXCommand,
  type ChatTurnPorts,
} from '@janus-agent/janus-agent'
import { AgentSteeringPort } from '@janus-agent/agent-core'
import {
  prepareJanusChatRecall as prepareCoreRecall,
} from '@janus-agent/chat-core'
import {
  buildJanusChatTurnPorts,
  type JanusCaptureInput,
} from './janus-agent-ports'
import { injectUserMemoryContext, type UserRecallResult } from '../knowledge/user-recall-service'
import { capturePersonChatTurn, capturePersonEpisodeFromTurn } from '../knowledge/user-turn-capture'
import { sanitizeLoopMessages } from './loop-message-sanitize'
import { ManagedChatSession } from './managed-chat-session'
import type { ChatContextCheckpoint, ChatContextStatus } from '../../shared/chat-context'
import type { UserMemoryDelivery } from '../../shared/memory-strength'
import { containsMemoryDelivery, recordUserMemoryAccessBestEffort, trackMemoryStream } from '../knowledge/memory-access'
import { requireBlueprintPlugin } from '../plugins/legacy-blueprint'

/** 对话消息类型 */
export interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

/** 流式对话请求参数 */
export interface ChatStreamRequest {
  memoBinding?: import('../../shared/memo').MemoBinding
  memoMessageId?: string
  contextCheckpoint?: ChatContextCheckpoint
  contextEpoch?: number
  compact?: { keepRecentUnits: number }
  requestId: string
  messages: ChatMessage[]
  providerId: string
  modelId?: string
  sourceTag?: 'janus-chat' | 'launch-assistant'
  conversationId?: string
  workspaceId?: string
  workspacePath?: string
  workspaceResources?: ChatWorkspaceResource[]
  toolTraces?: import('../../shared/ipc/llm').ChatToolTraceEntry[]
  /**
   * Host-owned tool surface for this turn (dual gate, supply side): names not
   * listed are never offered to the model. `toolGate` is the call-time
   * backstop; it is a host function and never crosses IPC — see
   * .agents/notes/agent/run-config-assistant-edit-tools.md
   */
  toolAllowlist?: string[]
  toolGate?: (call: { name: string; arguments: unknown }) => Promise<{ block: true; reason: string; terminate?: boolean } | undefined>
  /** 运行配置轮内文档（真实值；脱敏只发生在进模型上下文的边界）。 */
  launchDraft?: { config: import('../../shared/ipc/project').LaunchConfig; projectPath: string }
  /**
   * S6 engineering domain. Missing = legacy personal behavior.
   * `project` never falls back to personal memory capture/injection.
   */
  domain?: 'personal' | 'project'
  /** Renderer selection request only; never trusted for paths or grants. */
  noteRefs?: Array<{ uri: string; expectedHash?: string; checkoutPath?: string }>
  noteWorkingSet?: string
  /** Retired request fields are rejected; Blueprint owns its native conversations. */
  noteRepairId?: string
  maintenanceTaskId?: string
}

/*-- 纯 helper 继续沿用 chat-core（单测经此 re-export，链路不断） --*/
export {
  hasExplicitWorkspaceMutationIntent,
  toolTraceEntryFromResult,
  toolTraceHistoryMessage,
} from '@janus-agent/chat-core'

type ContextSearch = typeof knowledgeContextService.search
type UserSearch = (query: string) => Promise<UserRecallResult>

/**
 * User recall behind the shell seam. Older hermetic mocks of
 * `knowledgeContextService` carry only `search`; production always carries
 * `searchUserOnly`, so the guard keeps those tests hermetic without behavior
 * change while production fuses the user section.
 */
function defaultUserSearch(): UserSearch | undefined {
  const service = knowledgeContextService as Partial<Pick<typeof knowledgeContextService, 'searchUserOnly'>>
  if (typeof service.searchUserOnly !== 'function') return undefined
  return (query: string) => knowledgeContextService.searchUserOnly(query)
}

/**
 * Positional wrapper over chat-core's object-form recall (llm-handlers 的
 * 非流式路径沿用旧签名；默认后端仍是 knowledgeContextService）。
 * User memory appends as its own section under an independent budget,
 * independently of workspaceId, so no-workspace sessions keep personal recall.
 */
export async function prepareJanusChatRecall(
  requestId: string,
  messages: ChatMessage[],
  workspaceId?: string,
  workspacePath?: string,
  search: ContextSearch = knowledgeContextService.search.bind(knowledgeContextService),
  searchUser?: UserSearch,
  domain?: 'personal' | 'project',
): Promise<{ messages: ChatMessage[]; trace: import('@janus-agent/chat-core').KnowledgeRecallTrace; userMemoryDelivery?: UserMemoryDelivery }> {
  const project = await prepareCoreRecall({ requestId, messages, workspaceId, workspacePath, search })
  // S6 domain isolation: project sessions never auto-inject personal history.
  // Only an explicit user-provided snippet (not the whole timeline) may cross.
  if (domain === 'project') return project
  const resolveUser = searchUser ?? defaultUserSearch()
  if (!resolveUser) return project
  const query = [...messages].reverse().find((message) => message.role === 'user' && message.content.trim())
    ?.content.trim() ?? ''
  if (!query) return project
  let user: UserRecallResult | null = null
  try {
    user = await resolveUser(query)
  } catch {
    return project
  }
  if (!user || !user.compactContext) return project
  return { ...project, messages: injectUserMemoryContext(project.messages, user.compactContext), ...(user.delivery ? { userMemoryDelivery: user.delivery } : {}) }
}

/*-- delta 合批窗口：高速流下把每 token 一次 IPC 压到每 40ms 一次 --*/
const DELTA_FLUSH_MS = 40

type ChatToolGate = NonNullable<ChatStreamRequest['toolGate']>

const normalizeToolName = (name: string) => name.toLowerCase().replace(/[._-]+/g, '')

/**
 * 双闸兜底：`toolAllowlist` 过滤工具供给之后，`toolGate` 在调用点拦截
 * allowlist 之外的一切调用（含未来新注册工具），reason 回灌模型。
 * 用法照 desktop-task-turn.ts 的既有先例 — see
 * .agents/notes/agent/run-config-assistant-edit-tools.md
 */
export function gateFromToolAllowlist(allowlist: string[] | undefined, policy?: ChatToolGate): ChatToolGate | undefined {
  if (!allowlist) return policy
  const allowed = new Set(allowlist.map(normalizeToolName))
  return async (call) => {
    if (!allowed.has(normalizeToolName(call.name))) {
      return { block: true, reason: `Tool unavailable for this conversation: ${call.name}` }
    }
    return policy?.(call)
  }
}
/** P6：默认 40（P6 前硬编码 20），经 agentMaxSteps 配置可调，仅 janus-chat 通道。 */
const CHAT_MAX_STEPS = DEFAULT_AGENT_MAX_STEPS

/** Active streaming chat abort controllers (module-scoped for shutdown). */
const abortControllers = new Map<string, AbortController>()
const chatSessions = new Map<string, ManagedChatSession>()
const MAX_CHAT_SESSIONS = 32

function getChatSession(conversationId: string): ManagedChatSession {
  const existing = chatSessions.get(conversationId)
  if (existing) {
    chatSessions.delete(conversationId)
    chatSessions.set(conversationId, existing)
    return existing
  }
  const session = new ManagedChatSession()
  chatSessions.set(conversationId, session)
  while (chatSessions.size > MAX_CHAT_SESSIONS) {
    const oldest = chatSessions.keys().next().value
    if (!oldest) break
    chatSessions.delete(oldest)
  }
  return session
}

/** Abort every in-flight LLM chat stream. Safe to call repeatedly. */
export function abortAllChatStreams(): void {
  for (const controller of abortControllers.values()) {
    try {
      controller.abort()
    } catch {
      // ignore
    }
  }
  abortControllers.clear()
}

export function abortChatStream(requestId: string): void {
  abortControllers.get(requestId)?.abort()
}

/**
 * R6-full：进行中流的 steering 目标注册（key = conversationId ?? requestId）。
 * 队列只活在请求生命周期内：renderer 历史已乐观追加用户原文并随会话落盘，
 * 主侧无需另行落盘；请求结束（成功/失败/取消）即丢弃未消费条目——下次发送
 * 会从渲染端历史自然带上这些文本，不丢不重。
 */
const activeSteerTargets = new Map<string, { requestId: string; port: AgentSteeringPort; entries: Map<string, string>; memoId?: string }>()
const MAX_STEER_ENTRIES_PER_REQUEST = 10

export function steerChatStream(input: ChatSteerInput): { accepted: boolean; error?: string } {
  let content = typeof input.text === 'string' ? input.text.trim() : ''
  if (!content) return { accepted: false, error: 'Empty steering text' }
  if (typeof input.entryId !== 'string' || !input.entryId) return { accepted: false, error: 'Invalid steering entry id' }
  const key = input.conversationId || ''
  const target = key ? activeSteerTargets.get(key) : undefined
  if (!target || !abortControllers.has(target.requestId)) {
    if (key) activeSteerTargets.delete(key)
    return { accepted: false, error: 'No active stream for this conversation' }
  }
  if (target.memoId) content += '\n\n' + memoSteeringContext(target.memoId, input.entryId, input.memoBinding)
  const previous = target.entries.get(input.entryId)
  if (previous !== undefined) return previous === content ? { accepted: true } : { accepted: false, error: 'Steering identity conflicts with an earlier message' }
  if (target.port.size >= MAX_STEER_ENTRIES_PER_REQUEST) {
    return { accepted: false, error: 'Steering queue is full for this stream' }
  }
  target.entries.set(input.entryId, content)
  // 入队即抢占：port 内部打断在途流式尝试；工具执行中则到间隙应用。
  target.port.push(input.entryId, { role: 'user', content })
  return { accepted: true }
}

export function cancelChatSteer(input: { conversationId?: string; entryId: string }): { cancelled: boolean } {
  const key = input.conversationId || ''
  const target = key ? activeSteerTargets.get(key) : undefined
  if (!target) return { cancelled: false }
  const cancelled = target.port.remove(input.entryId)
  if (cancelled) target.entries.delete(input.entryId)
  return { cancelled }
}

/** 单向 send/on 模式的 chatStream 事件端点（渲染端按 requestId 过滤） */
interface ChatStreamReplyTarget {
  reply: (channel: string, payload: unknown) => void
  sender?: { id?: number; isDestroyed?: () => boolean }
}

/** Pending mid-turn ask_user answers, keyed by tool call id. */
const pendingQuestionResolvers = new Map<string, { requestId: string; resolve: (answer: ChatQuestionAnswer) => void }>()

function settlePendingQuestion(key: string, answer: ChatQuestionAnswer): boolean {
  const pending = pendingQuestionResolvers.get(key)
  if (!pending) return false
  pendingQuestionResolvers.delete(key)
  pending.resolve(answer)
  return true
}

function isQuestionAnswer(value: unknown): value is ChatQuestionAnswer {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  if (record.status === 'cancelled') return true
  if (record.status !== 'answered' || !Array.isArray(record.answers)) return false
  return (record.answers as unknown[]).every((entry) => {
    if (!entry || typeof entry !== 'object') return false
    const item = entry as Record<string, unknown>
    return typeof item.header === 'string'
      && Array.isArray(item.selected)
      && (item.selected as unknown[]).every((choice) => typeof choice === 'string')
      && (item.custom === undefined || typeof item.custom === 'string')
  })
}

/** Renderer answers a pending mid-turn question (see LLM_CHANNELS.answerQuestion). */
export function answerChatQuestion(payload: ChatAnswerQuestionPayload): { accepted: boolean; error?: string } {
  if (!payload || typeof payload.callId !== 'string' || !payload.callId) {
    return { accepted: false, error: 'Invalid call id' }
  }
  if (!isQuestionAnswer(payload.answer)) return { accepted: false, error: 'Invalid answer' }
  const key = JSON.stringify([payload.requestId, payload.callId])
  const pending = pendingQuestionResolvers.get(key)
  if (!pending || pending.requestId !== payload.requestId || !abortControllers.has(payload.requestId)) {
    return { accepted: false, error: 'No pending question for this request' }
  }
  if (!settlePendingQuestion(key, payload.answer)) {
    return { accepted: false, error: 'No pending question for this call' }
  }
  return { accepted: true }
}

/** Shell QuestionPort: blocks the loop on the renderer question UI; abort settles cancelled. */
function createShellQuestionPort(requestId: string): NonNullable<ChatTurnPorts['question']> {
  return {
    askUser: (request, signal) => new Promise((resolve) => {
      const key = JSON.stringify([requestId, request.callId])
      if (pendingQuestionResolvers.has(key)) {
        resolve({ status: 'cancelled' })
        return
      }
      const finish = (answer: ChatQuestionAnswer) => {
        pendingQuestionResolvers.delete(key)
        signal.removeEventListener('abort', onAbort)
        resolve(answer)
      }
      const onAbort = () => finish({ status: 'cancelled' })
      if (signal.aborted) {
        resolve({ status: 'cancelled' })
        return
      }
      pendingQuestionResolvers.set(key, { requestId, resolve: finish })
      signal.addEventListener('abort', onAbort, { once: true })
    }),
  }
}

/** 壳默认 ports：生产单例装配（可注入版本见 janus-agent-ports）。 */
function defaultChatTurnPorts(callerId: string, requestId: string, domain?: 'personal' | 'project', conversationId?: string): ChatTurnPorts {
  const deliveries = new Map<string, UserMemoryDelivery>()
  return buildJanusChatTurnPorts({
    callerId,
    getProviderSettings: (providerId) => llmService.getProviderSettings('janus', providerId),
    getLanguageModel: (providerId, modelId) => llmService.getLanguageModel('janus', providerId, modelId),
    resolveModelMetadata: llmService.resolveModelMetadata ? modelId => llmService.resolveModelMetadata(modelId) : undefined,
    listModels: (providerId) => {
      const catalog = llmService as typeof llmService & {
        listModels?: (terminal: string, provider: string) => Promise<Array<{ id: string; supportsFunctionCalling?: boolean; contextWindow?: number; maxOutputTokens?: number }>>
      }
      return typeof catalog.listModels === 'function' ? catalog.listModels('janus', providerId) : Promise.resolve([])
    },
    getMaxTurns: () => configService.getAgentMaxSteps().catch(() => CHAT_MAX_STEPS),
    getAgentSession: (agentSessionId) => workspaceAgentRuntime.getSession(agentSessionId),
    forkAgentSession: async (parentId, caller) => {
      const child = await workspaceAgentRuntime.forkSession(parentId, caller)
      workflowSessionParents.set(child.id, parentId)
      return { sessionId: child.id, ...child.workspace, status: child.status }
    },
    closeAgentSession: async id => { try { await workspaceAgentRuntime.cancelSession(id) } finally { workflowSessionParents.delete(id) } },
    executeFunctionCall: (input, caller) => workspaceAgentRuntime.executeFunctionCall(input, caller),
    listRegistryTools: () => workspaceAgentRuntime.registry.list(),
    listRegistryManifests: () => workspaceAgentRuntime.registry.listManifests?.(),
    knowledgeSearch: async (input) => {
      const base = {
        query: input.query,
        workspaceId: input.workspaceId,
        workspacePath: input.workspacePath,
        maxItems: input.maxItems,
        maxChars: input.maxChars,
      }
      // S6 domain isolation: project turns use project recall only; personal
      // history never fuses automatically into the engineering context.
      if (domain === 'project') return knowledgeContextService.search(base)
      // Fused chat recall stays transparent to the loop: the port input keeps
      // its generic shape (no persona types cross into janus-agentX) while the
      // shell appends the user section under its own budget. The guard keeps
      // older hermetic mocks (search-only) on the legacy path.
      const service = knowledgeContextService as Partial<Pick<typeof knowledgeContextService, 'searchWithUser'>>
      if (typeof service.searchWithUser !== 'function') {
        return knowledgeContextService.search(base)
      }
      try {
        const result = await knowledgeContextService.searchWithUser(base)
        if (result.userMemoryDelivery) deliveries.set(result.userMemoryDelivery.section, result.userMemoryDelivery)
        return result
      } catch {
        return knowledgeContextService.search(base)
      }
    },
    captureObservation: (input: JanusCaptureInput) => captureEngineeringUserMemory({
      workspaceId: input.workspaceId,
      workspacePath: input.workspacePath,
      source: input.source,
      type: input.type,
      content: input.content,
      summary: input.summary,
      tags: input.tags,
      actor: input.actor,
      correlationId: input.correlationId,
      sessionId: conversationId ?? input.sessionId,
      ...(input.metadata ? { metadata: input.metadata } : {}),
    }, { speaker: input.actor === 'user' ? 'user' : input.actor === 'assistant' ? 'assistant' : 'unknown', sourceEventId: input.correlationId }),
    scheduleSettled: (workspaceId) => {
      knowledgeProcessingQueue.scheduleImmediate(workspaceId)
    },
    // Note: strict providers reject mid-conversation system follow-ups — see .agents/notes/agent/chat-system-mid-conversation.md
    streamTextFn: (async (options: Record<string, unknown>) => {
      const messages = (options as { messages?: Array<{ role: string }> }).messages
      if (!Array.isArray(messages)) return streamText(options as never)
      const sanitized = sanitizeLoopMessages(messages)
      const result = await streamText({ ...options, messages: sanitized } as never)
      const receipts = [...deliveries.values()].filter(receipt => containsMemoryDelivery(sanitized, receipt))
      return trackMemoryStream(result, async () => {
        for (const receipt of receipts) await recordUserMemoryAccessBestEffort(receipt, requestId, options.abortSignal as AbortSignal | undefined)
      })
    }) as unknown as ChatTurnPorts['streamTextFn'],
    question: createShellQuestionPort(requestId),
  })
}

// Note: single-turn lock and project domain isolation — see .agents/notes/agent/chat-turn-guard-domain-s6.md
/** 流式对话编排：由 llm-handlers 的 ipcMain.on(chatStream) 委托调用 */
export async function handleChatStream(event: ChatStreamReplyTarget, request: ChatStreamRequest): Promise<void> {
  const { requestId, messages, providerId, modelId, sourceTag, conversationId, workspaceId, workspacePath, workspaceResources, toolTraces, toolAllowlist, toolGate, launchDraft, domain } = request
  // 供给入口搭车（照 note.focus 搭 janus-chat 的车）：'launch-assistant' 尚未进包侧
  // resolvesTrustedResources 闭名单，轮次以 'maintenance' 身份进 runChatTurn 解析
  // 工作区资源；画像三闸看的是请求上的 sourceTag，不受此重映射影响 — see
  // .agents/notes/agent/run-config-assistant-edit-tools.md
  const turnSourceTag = sourceTag === 'launch-assistant' ? 'maintenance' : sourceTag

  // S6: same conversationId shares one active turn across assistant/blueprint entries.
  const activeTurn = activeSteerTargets.get(conversationId || requestId)
  if (activeTurn?.requestId === requestId) return
  if (activeTurn || abortControllers.has(requestId)) {
    if (!event.sender?.isDestroyed?.()) {
      event.reply(LLM_CHANNELS.error, { requestId, error: 'BUSY: conversation already has an active turn' })
    }
    return
  }

  const controller = new AbortController()
  abortControllers.set(requestId, controller)
  // S6 single-turn lock: the steering slot doubles as the turn owner, so a
  // second entry with the same conversationId steers instead of spawning.
  const steerKey = conversationId || requestId
  const steeringPort = new AgentSteeringPort()
  activeSteerTargets.set(steerKey, { requestId, port: steeringPort, entries: new Map(),
    memoId: sourceTag === 'janus-chat' && !request.compact && !request.maintenanceTaskId && !request.noteRepairId ? request.memoBinding?.memoId : undefined })

  // 窗口销毁后 event.reply 会抛异常并造成 unhandled rejection，统一守卫
  const sendEvent = (
    channel: typeof LLM_CHANNELS.delta | typeof LLM_CHANNELS.done | typeof LLM_CHANNELS.error | typeof LLM_CHANNELS.recallTrace | typeof LLM_CHANNELS.toolTrace | typeof LLM_CHANNELS.agentEvent,
    payload: unknown,
  ) => {
    if (typeof event.sender?.isDestroyed === 'function' && event.sender.isDestroyed()) return
    try {
      event.reply(channel, payload)
    } catch {
      /* 窗口销毁竞态，丢弃事件 */
    }
  }

  const sendError = (message: string) => {
    sendEvent(LLM_CHANNELS.error, { requestId, error: message })
  }
  const sendAgentEvent = (agentEvent: ChatAgentEvent) => sendEvent(LLM_CHANNELS.agentEvent, agentEvent)

  // delta 合批：累积增量，40ms 定时 flush；循环结束/异常前强制 flush
  let pendingDelta = ''
  let deltaTimer: NodeJS.Timeout | null = null
  const flushDelta = () => {
    if (deltaTimer) {
      clearTimeout(deltaTimer)
      deltaTimer = null
    }
    if (!pendingDelta) return
    const delta = pendingDelta
    pendingDelta = ''
    sendEvent(LLM_CHANNELS.delta, { requestId, delta, done: false })
  }
  const queueDelta = (delta: string) => {
    pendingDelta += delta
    if (!deltaTimer) deltaTimer = setTimeout(flushDelta, DELTA_FLUSH_MS)
  }

  try {
    if (request.noteRepairId || request.maintenanceTaskId) requireBlueprintPlugin()
    const callerId = `renderer:${event.sender?.id ?? 'unknown'}`
    const ports = defaultChatTurnPorts(callerId, requestId, domain, conversationId)
    const turnAllowlist = toolAllowlist
    let turnToolGate = gateFromToolAllowlist(toolAllowlist, toolGate)
    const userText = [...messages].reverse().find(message => message.role === 'user')?.content ?? ''
    const ordinaryMemoTurn = sourceTag === 'janus-chat' && conversationId && !request.compact
    if (ordinaryMemoTurn && mentionsMemoWorkspace(userText)) {
      const previousGate = turnToolGate
      turnToolGate = async call => normalizeToolName(call.name) === 'notewrite'
        ? { block: true, reason: 'Memo workspace requests do not authorize repository Note writes. Use memo tools; never substitute a Note.' }
        : previousGate?.(call)
    }
    const modeCommand = parseWorkflowXCommand([...messages].reverse().find(message => message.role === 'user')?.content ?? '')
    if (modeCommand && !modeCommand.prompt) {
      await runChatTurn({ requestId, messages, providerId, modelId, sourceTag: turnSourceTag, toolAllowlist, toolGate: turnToolGate }, ports, { onEvent: agentEvent => {
        sendAgentEvent(agentEvent)
        if (agentEvent.type === 'text_delta') queueDelta(agentEvent.delta)
      } }, controller.signal)
      flushDelta()
      sendEvent(LLM_CHANNELS.delta, { requestId, delta: '', done: true })
      sendEvent(LLM_CHANNELS.done, { requestId })
      return
    }
    const chatSession = getChatSession(conversationId ?? requestId)
    const endpoint = await ports.model.resolve(providerId, modelId)
    ports.model.resolve = async () => endpoint
    const source = (endpoint as typeof endpoint & { source?: ChatContextStatus['source'] }).source ?? 'estimated'
    const scopeKey = JSON.stringify([domain ?? 'personal', request.contextEpoch ?? 0,
      (workspaceResources ?? []).map(item => [item.workspaceId, item.workspacePath]).sort(), request.memoBinding?.memoId ?? null])
    const turnMessages = chatSession.beginTurn(messages, scopeKey, request.contextCheckpoint,
      state => sendAgentEvent({ type: 'context_state', requestId, state }), source)
    const modelStream = ports.streamTextFn
    ports.streamTextFn = (async (options: Record<string, unknown>) => modelStream({ ...options,
      maxTokens: options.maxTokens ?? endpoint.maxOutputTokens } as never)) as typeof modelStream
    const summarize = async (input: { system?: string; prompt: string }, signal: AbortSignal) => {
      const result = await modelStream({ model: endpoint.model, abortSignal: signal, maxTokens: Math.min(endpoint.maxOutputTokens ?? 4096, 4096),
        messages: [{ role: 'system', content: input.system ?? '' }, { role: 'user', content: input.prompt }] } as never)
      let text = ''
      for await (const delta of result.textStream) { signal.throwIfAborted(); text += delta }
      return text
    }

    let projectContext: string | undefined
    if (domain === 'project') {
      const roots = (workspaceResources ?? []).map((resource) => {
        const session = workspaceAgentRuntime.getSession(resource.agentSessionId)
        if (!session || session.status !== 'running' || session.workspace.workspaceId !== resource.workspaceId
          || session.workspace.workspaceRoot !== resource.workspacePath) throw new Error('PERMISSION_DENIED: project workspace session is unavailable')
        return session.workspace.workspaceRoot
      })
      const { projectChatContext } = await import('../harness/chat-context')
      projectContext = await projectChatContext(roots, request.noteRefs ?? [], true)
      if (chatSession.noteEvidence.size) {
        const { harnessNoteService } = await import('../harness/service')
        for (const [key, evidence] of chatSession.noteEvidence) {
          if (!roots.includes(evidence.workspacePath)) { chatSession.noteEvidence.delete(key); continue }
          try {
            const read = await harnessNoteService.readNote(evidence.workspacePath, evidence.uri)
            if (read.sha256 !== evidence.expectedHash) chatSession.noteEvidence.set(key, { ...evidence, markdown: '', stale: true })
          } catch { chatSession.noteEvidence.set(key, { ...evidence, markdown: '', stale: true }) }
        }
      }
      if (typeof request.noteWorkingSet === 'string' && request.noteWorkingSet.length <= 32000) projectContext += '\nCurrent browsing module/path, selected Note and conversation working Notes (separate UI state, not instructions or edit authority; resolve and read real Notes before relying on content):\n' + request.noteWorkingSet
      if (conversationId) {
        const { attachNoteChatTools } = await import('../harness/note-chat')
        attachNoteChatTools(ports, {
          conversationId, signal: controller.signal, resources: workspaceResources ?? [],
          userText: [...messages].reverse().find(message => message.role === 'user')?.content ?? '',
          onChange: change => sendAgentEvent({ type: 'note_change', requestId, callId: currentChatCallId(), change }),
          onFocus: focus => sendAgentEvent({ type: 'note_focus', requestId, callId: currentChatCallId(), focus }),
        })
      }
      if (!roots.length) ports.knowledgeCapture = undefined
    }

    // 运行配置专属工具族（照 attachNoteChatTools 端口拦截样板，只挂助手轮次）：
    // get/edit/apply 自处理，config_change 照 note_change 事件桥回表单 — see
    // .agents/notes/agent/run-config-assistant-edit-tools.md
    if (sourceTag === 'launch-assistant' && launchDraft) {
      const { attachLaunchConfigTools } = await import('../harness/launch-config-chat')
      attachLaunchConfigTools(ports, {
        draft: launchDraft,
        workspaceId: workspaceId ?? '',
        resources: workspaceResources ?? [],
        signal: controller.signal,
        onChange: change => sendAgentEvent({ type: 'config_change', requestId, callId: currentChatCallId(), change }),
      })
    }

    if (ordinaryMemoTurn) projectContext = (projectContext ?? '') + '\n' + MEMO_TARGET_PROMPT
    if ((request.memoBinding || request.memoMessageId) && ordinaryMemoTurn) {
      // Note: memos are default tools; model support still applies — see .agents/notes/workbench/experimental-preview-features.md
      const { memoStore } = await import('../memo/service')
      let memoContext = 'Memo editing unavailable: this model does not support tool calling. Do not claim memo updates.'
      if (endpoint.supportsFunctionCalling !== false) {
        try {
          memoContext = await attachMemoChatTools(ports, {
            store: memoStore(), binding: request.memoBinding, messageId: request.memoMessageId, conversationId: conversationId!, signal: controller.signal,
            onCreated: binding => {
              const target = activeSteerTargets.get(steerKey)
              if (target?.requestId === requestId) target.memoId = binding.memoId
              sendAgentEvent({ type: 'memo_created', requestId, conversationId: conversationId!, binding })
            },
          })
        } catch (error) {
          controller.signal.throwIfAborted()
          memoContext = `Memo unavailable: ${error instanceof Error ? error.message : String(error)}. Continue the reply without claiming memo updates.`
        }
      }
      projectContext = (projectContext ?? '') + '\n' + memoContext
    }

    attachChatToolEvents(ports, requestId, entry => {
      const note = [...chatSession.noteEvidence.values()].find(item => entry.argsDigest === item.path)
      const trace = note ? { ...entry, summary: `${note.path}; uri=${note.uri}; expectedHash=${note.expectedHash}` } : entry
      sendEvent(LLM_CHANNELS.toolTrace, { requestId, entries: [trace] })
    })

    if (request.compact) {
      await chatSession.maybeCompact(turnMessages, { model: endpoint, force: true, keepRecentUnits: request.compact.keepRecentUnits }, summarize, controller.signal)
      sendEvent(LLM_CHANNELS.done, { requestId })
      return
    }
    const result = await runChatTurn(
      {
        requestId,
        messages: turnMessages,
        workflowMode: resolveWorkflowXMode(messages),
        providerId,
        modelId,
        sourceTag: turnSourceTag,
        conversationId,
        workspaceId,
        workspacePath,
        workspaceResources,
        toolTraces,
        toolAllowlist: turnAllowlist,
        toolGate: turnToolGate,
        callerId,
        chatSession,
        steeringPort,
        compactionSummarizer: summarize,
        ...(projectContext ? {
          systemPromptPrefix: projectContext,
        } : {}),
      },
      ports,
      {
        onEvent: (agentEvent) => {
          if (controller.signal.aborted) return
          sendAgentEvent(agentEvent)
          if (agentEvent.type === 'text_delta') queueDelta(agentEvent.delta)
        },
      },
      controller.signal,
    )
    flushDelta()

    // 用户中止：半截回复不写入知识库（facade 内已跳过 capture），直接收尾
    if (controller.signal.aborted || result.cancelled) {
      // facade 在取消时已发 stream_end(cancelled)；此处只补 done 通道
      sendEvent(LLM_CHANNELS.done, { requestId })
      return
    }

    if (sourceTag === 'janus-chat' && result.recallTrace) {
      sendEvent(LLM_CHANNELS.recallTrace, result.recallTrace)
    }
    // User memory closeout: every personal janus-chat turn grows the person timeline.
    // Workspace-attached turns already captured project observations inside
    // the loop, so only the episode lands here; workspace-free turns capture
    // observations plus the episode into person scope. Both helpers fail open.
    // S6: project domain never writes personal memory, even without a workspace.
    if (sourceTag === 'janus-chat' && domain !== 'project') {
      const lastUserText = [...messages].reverse().find((message) => message.role === 'user' && message.content.trim())
        ?.content.trim() ?? ''
      const hadWorkspace = Boolean(workspaceId || workspacePath || (workspaceResources?.length ?? 0) > 0)
      if (hadWorkspace) {
        await capturePersonEpisodeFromTurn({ userText: lastUserText, sessionId: conversationId ?? requestId, correlationId: requestId })
      } else {
        await capturePersonChatTurn({
          userText: lastUserText,
          assistantText: result.text,
          sessionId: conversationId ?? requestId,
          correlationId: requestId,
          providerId,
          modelId,
        })
      }
    }
    sendEvent(LLM_CHANNELS.delta, { requestId, delta: '', done: true })
    sendEvent(LLM_CHANNELS.done, { requestId })
  } catch (error: any) {
    flushDelta()
    // 用户主动取消时不作为错误上报
    if (controller.signal.aborted || error?.name === 'AbortError') {
      sendAgentEvent({ type: 'stream_end', requestId, cancelled: true })
      sendEvent(LLM_CHANNELS.done, { requestId })
      return
    }
    console.error('[IPC] llm:chat-stream error:', error.message || error)
    sendAgentEvent({ type: 'stream_error', requestId, error: error.message || String(error) })
    sendError(error.message || String(error))
  } finally {
    if (deltaTimer) {
      clearTimeout(deltaTimer)
      deltaTimer = null
    }
    // 未答复的中途提问随请求结束而取消，避免循环永久等待已销毁的渲染端。
    for (const [callId, pending] of pendingQuestionResolvers) {
      if (pending.requestId === requestId) settlePendingQuestion(callId, { status: 'cancelled' })
    }
    // R6-full：请求结束即丢弃 steering 目标（未消费条目以渲染端历史为准，不补发）。
    const steerTarget = activeSteerTargets.get(steerKey)
    if (steerTarget?.requestId === requestId) {
      activeSteerTargets.delete(steerKey)
    }
    // 重复 requestId 时新流已换新 controller，只清理仍属于本次的条目
    if (abortControllers.get(requestId) === controller) {
      abortControllers.delete(requestId)
    }
  }
}
