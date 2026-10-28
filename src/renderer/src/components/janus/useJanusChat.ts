import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  answerChatQuestion,
  chatStream,
  getTerminalDefault,
  getTerminalProviders,
  listModels,
  getChatModelBudget,
  saveTerminalProvider,
  cancelSteerChat,
  steerChat,
  type ChatMessage,
} from '@/services/llm'
import { useWorkspaceStore } from '@/stores/workspace'
import { memoBinding, useMemoStore } from '@/stores/memo'
import type { MemoBinding } from '../../../../shared/memo'
import { useNoteChatStore } from '@/stores/note-chat'
import { useNoteFocusStore } from '@/stores/note-focus'
import { openPluginManager } from '@/extensions/plugin-configuration-navigation'
import type { Workspace } from '@/types'
import type { KnowledgeRecallTrace } from '../../../../shared/knowledge'
import { normalizeAgentApprovalMode, type AgentApprovalMode, type AgentSession, type ApprovalRequest } from '../../../../shared/ipc/agent-runtime'
import { getAgentSettings } from '@/services/agent-settings'
import type { ChatToolTraceEntry, ChatWorkspaceResource } from '../../../../shared/ipc/llm'
import { emptyChatTimeline, mergeTimelineTrace, reduceChatTimeline, reduceTimelineRuntime, settleChatTimeline, type ChatTimelineSnapshot } from '../../../../shared/chat-timeline'
import type { ChatQuestionAnswer, ChatTodoItem } from '../../../../shared/ipc/llm'
import { validChatModelLimits, type ChatModelLimits } from '../../../../shared/chat-model-limits'
import type { JanusPendingQuestion } from './janusRuntimeState'
import type {
  JanusChatMessage,
  JanusChatStorageSnapshot,
  PersistedJanusConversation,
  EngineeringContext,
} from '../../../../shared/ipc/janus-chat'
import {
  MAX_TOOL_TRACES,
  NEW_CONVERSATION_TITLE,
  capChatMessages,
  bindProjectConversation,
  continueConversation,
  createJanusConversation,
  getRetryTurn,
  createInitialSnapshot,
  parseCompactCommand,
  titleFromMessages,
} from './janusChatConversations'
import {
  JANUS_RESOURCE_STORAGE_KEY,
  parseJanusResourcePreferences,
  type WorkspaceResource,
} from './janusResources'
import {
  appendReasoningDelta,
  emptyReasoning,
  type ReasoningSnapshot,
} from './janusReasoning'
import { consumeSteeredIds, removeMessageById } from './janusSteering'
import {
  EMPTY_JANUS_RUNTIME_STATE,
  INITIAL_JANUS_CHAT_STATUS,
  chatStatusForEvent,
  reduceChatAgentEvent,
  reduceJanusRuntimeState,
  runtimeEventSessionId,
  type JanusChatStatus,
  type JanusRuntimeState,
  type JanusToolActivity,
} from './janusRuntimeState'

export type Message = JanusChatMessage

export interface ConversationSummary {
  id: string
  title: string
  updatedAt: number
  messageCount: number
  isStreaming: boolean
  hasError: boolean
  /** The memo this session maintains, when it has one. */
  memoId?: string
}

export interface ChatModelOption {
  providerId: string
  providerName: string
  modelId: string
  label: string
  isDefault: boolean
  isProviderDefault: boolean
}

export type { WorkspaceResource } from './janusResources'
export type { ReasoningSnapshot } from './janusReasoning'

export interface JanusResourceController {
  resources: WorkspaceResource[]
  availableWorkspaces: Workspace[]
  attachWorkspace: (workspaceId: string) => void
  detachWorkspace: (workspaceId: string) => void
  activities: JanusToolActivity[]
  pendingApprovals: ApprovalRequest[]
  resolveApproval: (approvalId: string, approved: boolean) => void
}

export interface UseJanusChatReturn {
  pendingTimeline?: ChatTimelineSnapshot
  activeTurnId?: string
  contextStatus?: import('../../../../shared/chat-context').ChatContextStatus
  setModelLimits?: (limits: ChatModelLimits | null) => Promise<void>
  engineeringContext?: EngineeringContext
  setEngineeringContext: (context: EngineeringContext) => void
  /** @deprecated Downloaded Blueprint owns repair and maintenance conversations. */
  repairNote: (planId: string, text: string) => boolean
  /** @deprecated Opens plugin management for legacy callers. */
  proposeMaintenance: (taskId: string, text: string) => void
  conversationId: string
  conversationTitle: string
  conversations: ConversationSummary[]
  messages: Message[]
  pendingContent: string
  /** 本轮流式推理快照（仅 UI 展示，永不计入正文与回复判定）。 */
  pendingReasoning: ReasoningSnapshot
  /** 已提交 assistant 消息的思维链快照（key 为消息 id，默认收起回看）。 */
  reasoningByTurn: Record<string, ReasoningSnapshot>
  isStreaming: boolean
  /** 本轮开始时间（毫秒时间戳，agentX Activity parity；未在途为 null）。 */
  turnStartedAt: number | null
  /** 本轮状态行（agentX store.ts parity：思考/输出/工具/等待）。 */
  turnStatus: JanusChatStatus
  error: string | null
  modelOptions: ChatModelOption[]
  activeModel: ChatModelOption | null
  modelNotice: string | null
  latestRecallTrace: KnowledgeRecallTrace | null
  /** Tool-call trace entries recorded for this conversation, used to inline tool cards under messages. */
  toolTraces: ChatToolTraceEntry[]
  /** Latest agent todo snapshot for the sticky bar above the composer. */
  todos: ChatTodoItem[]
  /** Open mid-turn questions awaiting a renderer answer. */
  pendingQuestions: JanusPendingQuestion[]
  /** Answer (or cancel) one pending mid-turn question. */
  answerQuestion: (callId: string, answer: ChatQuestionAnswer) => void
  resourceController: JanusResourceController
  send: (text: string) => void
  rewrite: (messageId: string, text: string) => void
  stop: () => void
  retry: () => void
  clear: () => void
  /**
   * R6-full：在途 steering 条目 id（= 乐观追加的用户消息 id）。
   * 主侧 steering_consumed 到达或请求结束即清除；文本永远留在历史里。
   */
  pendingSteerIds: string[]
  cancelSteeredMessage: (queueId: string) => void
  selectModel: (providerId: string, modelId: string) => void
  refreshModels: () => Promise<ChatModelOption[]>
  createConversation: () => string
  selectConversation: (conversationId: string) => void
  renameConversation: (conversationId: string, title: string) => void
  deleteConversation: (conversationId: string) => void
  /** Records the session's memo, or ends the session when switching/leaving. */
  bindMemo: (memoId: string | null) => void
  approvalMode: AgentApprovalMode
  setApprovalMode: (mode: AgentApprovalMode) => void
}

export interface UseJanusChatRegistryReturn {
  islandConversationId: string
  persistenceReady: boolean
  bindProject: (context: EngineeringContext, workspaceIds: string[], title: string) => string
  /**
   * Blueprint panel slot: find-or-create WITHOUT hijacking the island
   * conversation. Ephemeral: excluded from island lists and persistence,
   * hence valid until restart; the panel clears it on workspace switch.
   */
  bindPanelProject: (context: EngineeringContext, workspaceIds: string[], title: string) => string
  getController: (conversationId?: string) => UseJanusChatReturn
  /** Includes ephemeral project panels without exposing them in the island list. */
  getProjectController: (viewRef: NonNullable<EngineeringContext['viewRef']>) => UseJanusChatReturn | null
}

interface ConversationRuntime {
  pendingTimeline: ChatTimelineSnapshot
  contextStatus?: import('../../../../shared/chat-context').ChatContextStatus
  pendingContent: string
  pendingReasoning: ReasoningSnapshot
  reasoningByTurn: Record<string, ReasoningSnapshot>
  /** R6-full：在途 steering 条目 id；badge 用，请求结束即清（文本留历史）。 */
  pendingSteerIds: string[]
  isStreaming: boolean
  /** 本轮开始时间（毫秒时间戳；未在途为 null，供状态行计时）。 */
  turnStartedAt: number | null
  /** 本轮状态行（agentX store.ts parity）。 */
  turnStatus: JanusChatStatus
  error: string | null
  modelNotice: string | null
  latestRecallTrace: KnowledgeRecallTrace | null
  agent: JanusRuntimeState
  approvalMode: AgentApprovalMode
}

interface RuntimeHandles {
  timeline: ChatTimelineSnapshot
  usingAgentEvents: boolean
  generation: number
  active: boolean
  abort: (() => void) | null
  assistantMessageId: string | null
  pendingBuffer: string
  reasoning: ReasoningSnapshot
  flushTimer: number | null
  noticeTimer: number | null
  sessions: Map<string, AgentSession>
}


function emptyRuntime(approvalMode: AgentApprovalMode = 'per-action'): ConversationRuntime {
  return {
    pendingTimeline: emptyChatTimeline(),
    pendingContent: '',
    pendingReasoning: emptyReasoning(),
    reasoningByTurn: {},
    pendingSteerIds: [],
    isStreaming: false,
    turnStartedAt: null,
    turnStatus: INITIAL_JANUS_CHAT_STATUS,
    error: null,
    modelNotice: null,
    latestRecallTrace: null,
    agent: EMPTY_JANUS_RUNTIME_STATE,
    approvalMode,
  }
}

function createRuntimeHandles(): RuntimeHandles {
  return {
    timeline: emptyChatTimeline(),
    usingAgentEvents: false,
    generation: 0,
    active: false,
    abort: null,
    assistantMessageId: null,
    pendingBuffer: '',
    reasoning: emptyReasoning(),
    flushTimer: null,
    noticeTimer: null,
    sessions: new Map(),
  }
}

function workspaceResources(
  conversation: PersistedJanusConversation,
  workspaces: Workspace[],
): WorkspaceResource[] {
  const byId = new Map(workspaces.map((workspace) => [workspace.id, workspace]))
  return conversation.attachedWorkspaceIds.flatMap((id) => {
    const workspace = byId.get(id)
    return workspace
      ? [{ workspaceId: workspace.id, workspacePath: workspace.path, workspaceName: workspace.name }]
      : []
  })
}

export function useJanusChat(): UseJanusChatRegistryReturn {
  const availableWorkspaces = useWorkspaceStore((state) => state.workspaces)
  const initialRef = useRef<JanusChatStorageSnapshot>()
  initialRef.current ??= createInitialSnapshot()

  const [conversations, setConversations] = useState(initialRef.current.conversations)
  const [islandConversationId, setIslandConversationId] = useState(initialRef.current.activeConversationId)
  const [runtimeStates, setRuntimeStates] = useState<Record<string, ConversationRuntime>>({})
  const [modelOptions, setModelOptions] = useState<ChatModelOption[]>([])
  const [persistenceReady, setPersistenceReady] = useState(false)
  const [defaultApprovalMode, setDefaultApprovalMode] = useState<AgentApprovalMode>('per-action')

  const conversationsRef = useRef(conversations)
  const runtimesRef = useRef(runtimeStates)
  const workspacesRef = useRef(availableWorkspaces)
  const modelOptionsRef = useRef(modelOptions)
  /** Blueprint panel conversation ids: island-independent, never persisted. */
  const ephemeralIdsRef = useRef<Set<string>>(new Set())
  const panelWorkspaceRef = useRef<string | null>(null)
  const handlesRef = useRef(new Map<string, RuntimeHandles>())
  const legacyResourcesRef = useRef(parseJanusResourcePreferences(
    typeof localStorage === 'undefined' ? null : localStorage.getItem(JANUS_RESOURCE_STORAGE_KEY),
  ))

  conversationsRef.current = conversations
  runtimesRef.current = runtimeStates
  workspacesRef.current = availableWorkspaces
  modelOptionsRef.current = modelOptions

  const setRuntime = useCallback((id: string, update: (current: ConversationRuntime) => ConversationRuntime) => {
    setRuntimeStates((current) => {
      const nextRuntime = update(current[id] ?? emptyRuntime())
      const next = { ...current, [id]: nextRuntime }
      runtimesRef.current = next
      return next
    })
  }, [])

  const updateConversations = useCallback((
    update: (current: PersistedJanusConversation[]) => PersistedJanusConversation[],
  ) => {
    const next = update(conversationsRef.current)
    conversationsRef.current = next
    setConversations(next)
  }, [])

  const updateConversation = useCallback((
    id: string,
    update: (current: PersistedJanusConversation) => PersistedJanusConversation,
  ) => {
    updateConversations((current) => current.map((conversation) =>
      conversation.id === id ? update(conversation) : conversation))
  }, [updateConversations])

  const getHandles = useCallback((id: string) => {
    let handles = handlesRef.current.get(id)
    if (!handles) {
      handles = createRuntimeHandles()
      handlesRef.current.set(id, handles)
    }
    return handles
  }, [])

  const clearFlushTimer = useCallback((handles: RuntimeHandles) => {
    if (handles.flushTimer === null) return
    window.clearTimeout(handles.flushTimer)
    handles.flushTimer = null
  }, [])

  const flushPending = useCallback((id: string): string => {
    const handles = getHandles(id)
    clearFlushTimer(handles)
    const content = handles.pendingBuffer
    setRuntime(id, (current) => current.pendingContent === content && current.pendingTimeline === handles.timeline
      ? current
      : { ...current, pendingContent: content, pendingTimeline: handles.timeline })
    return content
  }, [clearFlushTimer, getHandles, setRuntime])

  const scheduleFlush = useCallback((id: string) => {
    const handles = getHandles(id)
    if (handles.flushTimer !== null) return
    handles.flushTimer = window.setTimeout(() => {
      handles.flushTimer = null
      setRuntime(id, (current) => {
        const pendingContent = handles.pendingBuffer
        const pendingReasoning = handles.reasoning
        return current.pendingContent === pendingContent && current.pendingReasoning.text === pendingReasoning.text && current.pendingTimeline === handles.timeline
          ? current
          : { ...current, pendingContent, pendingReasoning, pendingTimeline: handles.timeline }
      })
    }, 16)
  }, [getHandles, setRuntime])

  const appendPending = useCallback((id: string, delta: string) => {
    if (!delta) return
    const handles = getHandles(id)
    handles.pendingBuffer += delta
    if (!handles.usingAgentEvents) handles.timeline = reduceChatTimeline(handles.timeline, {
      type: 'text_delta', requestId: handles.timeline.requestId || handles.assistantMessageId || 'legacy', delta,
    })
    scheduleFlush(id)
  }, [getHandles, scheduleFlush])

  const appendReasoning = useCallback((id: string, delta: string) => {
    if (!delta) return
    const handles = getHandles(id)
    handles.reasoning = appendReasoningDelta(handles.reasoning, delta)
    scheduleFlush(id)
  }, [getHandles, scheduleFlush])

  /**
   * 收敛本轮思维链：清显示态；正文成功落库时把快照挂到该 assistant 消息下供收起回看。
   * 推理永不进入 messages/toolTraces/模型上下文，仅 UI 展示。
   * durationMs 由调用方按 turnStartedAt 结算（agentX done 行 parity）。
   */
  const snapshotReasoning = useCallback((id: string, messageId: string | undefined, store: boolean, durationMs?: number) => {
    const handles = getHandles(id)
    const snapshot = handles.reasoning
    handles.reasoning = emptyReasoning()
    const settled = typeof durationMs === 'number' && Number.isFinite(durationMs) && durationMs >= 0
      ? { ...snapshot, durationMs }
      : snapshot
    setRuntime(id, (current) => ({
      ...current,
      pendingReasoning: emptyReasoning(),
      ...(store && messageId && settled.chars > 0
        ? { reasoningByTurn: { ...current.reasoningByTurn, [messageId]: settled } }
        : {}),
    }))
  }, [getHandles, setRuntime])

  const cancelSessions = useCallback((handles: RuntimeHandles) => {
    const sessions = [...handles.sessions.values()]
    handles.sessions.clear()
    for (const session of sessions) {
      void window.electron.agentRuntime.cancelSession(session.id).catch(() => undefined)
    }
  }, [])

  const invalidateRuntime = useCallback((id: string, cancelAgentSessions = false) => {
    const handles = getHandles(id)
    handles.generation += 1
    handles.active = false
    handles.abort?.()
    handles.abort = null
    clearFlushTimer(handles)
    if (handles.noticeTimer !== null) window.clearTimeout(handles.noticeTimer)
    handles.noticeTimer = null
    handles.pendingBuffer = ''
    handles.reasoning = emptyReasoning()
    if (cancelAgentSessions) cancelSessions(handles)
  }, [cancelSessions, clearFlushTimer, getHandles])

  useEffect(() => {
    void getAgentSettings().then((settings) => setDefaultApprovalMode(normalizeAgentApprovalMode(settings.approvalMode))).catch(() => undefined)
  }, [])

  useEffect(() => {
    let cancelled = false
    const persistence = window.electron.janusChat
    if (!persistence) {
      setPersistenceReady(true)
      return
    }
    void persistence.load().then((snapshot) => {
      if (cancelled || !snapshot?.conversations.length) return
      // Discard old panel snapshots on restart and always retain a personal
      // fallback; an ephemeral panel must never become the island controller.
      const visible = snapshot.conversations.filter((item) => item.engineeringContext?.viewRef?.viewId !== 'workspace-dialog')
      if (!visible.length) visible.push(createJanusConversation())
      const activeId = visible.some((item) => item.id === snapshot.activeConversationId)
        ? snapshot.activeConversationId
        : visible[0].id
      conversationsRef.current = visible
      setConversations(visible)
      setIslandConversationId(activeId)
    }).catch(() => undefined).finally(() => {
      if (!cancelled) setPersistenceReady(true)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!persistenceReady) return
    const snapshot: JanusChatStorageSnapshot = {
      version: 1,
      activeConversationId: islandConversationId,
      conversations: conversations.filter((conversation) => !ephemeralIdsRef.current.has(conversation.id)),
    }
    void window.electron.janusChat?.save(snapshot).catch(() => undefined)
  }, [conversations, islandConversationId, persistenceReady])

  const loadConfiguredModels = useCallback(async (): Promise<ChatModelOption[]> => {
    try {
      const [providers, defaultProvider] = await Promise.all([getTerminalProviders('janus'), getTerminalDefault('janus')])
      const enabledProviders = providers.filter((provider) => provider.enabled !== false)
      const options = (await Promise.all(enabledProviders.map(async (provider) => {
        const configuredModelIds = provider.models?.length
          ? provider.models
          : [provider.modelId || (defaultProvider?.provider.id === provider.id ? defaultProvider.modelId : '')]
        const models = await listModels('janus', provider.id).catch(() => [])
        const modelIds = [...new Set([...models.map((model) => model.id), ...configuredModelIds].filter(Boolean))]
        return modelIds.map((modelId) => ({
          providerId: provider.id,
          providerName: provider.name,
          modelId,
          label: `${provider.name} / ${modelId}`,
          isDefault: defaultProvider?.provider.id === provider.id && defaultProvider.modelId === modelId,
          isProviderDefault: (provider.defaultModelId || provider.modelId) === modelId,
        }))
      }))).flat()
      modelOptionsRef.current = options
      setModelOptions(options)
      return options
    } catch (error) {
      console.error('Failed to load chat model options:', error)
      modelOptionsRef.current = []
      setModelOptions([])
      return []
    }
  }, [])

  useEffect(() => {
    void loadConfiguredModels()
    const refresh = () => void loadConfiguredModels()
    window.addEventListener('janus:llm-config-changed', refresh)
    return () => window.removeEventListener('janus:llm-config-changed', refresh)
  }, [loadConfiguredModels])

  useEffect(() => {
    const legacy = legacyResourcesRef.current
    if (availableWorkspaces.length === 0 || legacy.attachedWorkspaceIds.length === 0) return
    legacyResourcesRef.current = { version: 1, attachedWorkspaceIds: [] }
    updateConversation(islandConversationId, (conversation) => conversation.attachedWorkspaceIds.length > 0
      ? conversation
      : { ...conversation, attachedWorkspaceIds: legacy.attachedWorkspaceIds, updatedAt: Date.now() })
    localStorage.removeItem(JANUS_RESOURCE_STORAGE_KEY)
  }, [availableWorkspaces, islandConversationId, updateConversation])

  useEffect(() => {
    if (availableWorkspaces.length === 0) return
    const validIds = new Set(availableWorkspaces.map((workspace) => workspace.id))
    updateConversations((current) => {
      let changed = false
      const next = current.map((conversation) => {
        const attachedWorkspaceIds = conversation.attachedWorkspaceIds.filter((id) => validIds.has(id))
        if (attachedWorkspaceIds.length === conversation.attachedWorkspaceIds.length) return conversation
        changed = true
        const handles = handlesRef.current.get(conversation.id)
        if (handles) {
          for (const [workspaceId, session] of handles.sessions) {
            if (validIds.has(workspaceId)) continue
            handles.sessions.delete(workspaceId)
            void window.electron.agentRuntime.cancelSession(session.id).catch(() => undefined)
          }
        }
        return { ...conversation, attachedWorkspaceIds, updatedAt: Date.now() }
      })
      return changed ? next : current
    })
  }, [availableWorkspaces, updateConversations])

  useEffect(() => window.electron.agentRuntime.onEvent((event) => {
    const sessionId = runtimeEventSessionId(event)
    if (!sessionId) return
    for (const [conversationId, handles] of handlesRef.current) {
      if (![...handles.sessions.values()].some((session) => session.id === sessionId)) continue
      if (handles.active) {
        handles.timeline = reduceTimelineRuntime(handles.timeline, event)
        scheduleFlush(conversationId)
      }
      setRuntime(conversationId, (current) => ({
        ...current,
        agent: reduceJanusRuntimeState(current.agent, event),
        ...(handles.active && event.type === 'approval-requested' ? { turnStatus: { kind: 'awaiting' as const } } : {}),
      }))
      break
    }
  }), [scheduleFlush, setRuntime])

  useEffect(() => () => {
    for (const handles of handlesRef.current.values()) {
      handles.abort?.()
      clearFlushTimer(handles)
      if (handles.noticeTimer !== null) window.clearTimeout(handles.noticeTimer)
      cancelSessions(handles)
    }
    handlesRef.current.clear()
  }, [cancelSessions, clearFlushTimer])

  const ensureAgentSessions = useCallback(async (
    id: string,
    requestedResources: WorkspaceResource[],
  ): Promise<ChatWorkspaceResource[]> => {
    const handles = getHandles(id)
    const approvalMode = runtimesRef.current[id]?.approvalMode ?? defaultApprovalMode
    const resolved = await Promise.all(requestedResources.map(async (resource) => {
      let session = handles.sessions.get(resource.workspaceId)
      if (!session || session.status !== 'running') {
        session = await window.electron.agentRuntime.createSession({
          workspaceId: resource.workspaceId,
          workspaceRoot: resource.workspacePath,
          approvalMode,
        })
        handles.sessions.set(resource.workspaceId, session)
      }
      const conversation = conversationsRef.current.find((item) => item.id === id)
      const current = conversation
        ? workspaceResources(conversation, workspacesRef.current).find((item) =>
            item.workspaceId === resource.workspaceId && item.workspacePath === resource.workspacePath)
        : undefined
      if (!current) {
        handles.sessions.delete(resource.workspaceId)
        await window.electron.agentRuntime.cancelSession(session.id).catch(() => undefined)
        return null
      }
      return { ...current, agentSessionId: session.id }
    }))
    return resolved.filter((resource): resource is ChatWorkspaceResource => resource !== null)
  }, [defaultApprovalMode, getHandles])

  const commitAssistant = useCallback((id: string, content: string, messageId?: string, cancelled = false) => {
    const timeline = settleChatTimeline(getHandles(id).timeline, Date.now(), cancelled)
    if (!content.trim() && !timeline.blocks.length) return
    const assistantMessageId = messageId ?? crypto.randomUUID()
    updateConversation(id, (conversation) => {
      const appended = [...conversation.messages, {
        id: assistantMessageId,
        role: 'assistant' as const,
        content,
        ...(timeline.blocks.length || timeline.truncated ? { timeline } : {}),
        timestamp: Date.now(),
      }]
      const messages = ephemeralIdsRef.current.has(id) ? appended : capChatMessages(appended)
      return { ...conversation, messages, updatedAt: Date.now() }
    })
  }, [getHandles, updateConversation])

  // Note: bounded recovery preserves evidence and avoids replaying writes — see .agents/notes/blueprint/tasks/blueprint-dialog-separation.md
  const startRequest = useCallback((id: string, history: Message[], userMessage: Message, recovery?: { startedAt: number; error: string }, compact?: { keepRecentUnits: number }, boundMemo?: { binding?: MemoBinding }) => {
    const runtime = runtimesRef.current[id]
    const conversation = conversationsRef.current.find((item) => item.id === id)
    const handles = getHandles(id)
    if (!conversation || (!recovery && runtime?.isStreaming) || handles.active) return
    const requestMemoBinding = !window.electron.memo || compact ? undefined : boundMemo ? boundMemo.binding : memoBinding(id, userMessage.id)
    const generation = handles.generation + 1
    handles.generation = generation
    handles.active = true
    handles.abort?.()
    handles.abort = null
    handles.assistantMessageId = crypto.randomUUID()
    clearFlushTimer(handles)
    handles.pendingBuffer = ''
    handles.reasoning = emptyReasoning()

    handles.timeline = emptyChatTimeline()
    handles.usingAgentEvents = false

    // Note: plugin-specific turns run in the plugin — see .agents/notes/planning/blueprint-official-plugin.md
    const nextMessages = compact ? history : [...history, userMessage]
    if (!recovery) updateConversation(id, (current) => ({
      ...current,
      title: current.title === NEW_CONVERSATION_TITLE ? titleFromMessages(nextMessages) : current.title,
      messages: nextMessages,
      updatedAt: Date.now(),
    }))
    setRuntime(id, (current) => ({
      ...current,
      pendingContent: '',
      pendingTimeline: emptyChatTimeline(),
      pendingReasoning: emptyReasoning(),
      isStreaming: true,
      turnStartedAt: recovery?.startedAt ?? Date.now(),
      turnStatus: INITIAL_JANUS_CHAT_STATUS,
      error: recovery?.error ?? null,
      latestRecallTrace: null,
      agent: recovery ? { ...EMPTY_JANUS_RUNTIME_STATE, activities: current.agent.activities } : EMPTY_JANUS_RUNTIME_STATE,
    }))

    // Only these host tools are known to be safe to replay. Unknown tools fail closed.
    let replaySafe = true
    const chatMessages: ChatMessage[] = [
      ...history.filter(message => message.role === 'user' || message.content.trim()).map((message) => ({
        role: message.role,
        content: message.content,
      })),
      ...(!compact ? [{ role: 'user' as const, content: userMessage.content }] : []),
    ]

    void (async () => {
      const latest = conversationsRef.current.find((item) => item.id === id)
      if (!latest) return
      const resources = workspaceResources(latest, workspacesRef.current)
      const agentResources = await ensureAgentSessions(id, resources)
      if (handles.generation !== generation) return
      const options = modelOptionsRef.current
      const model = options.find((option) =>
        option.providerId === latest.providerId && option.modelId === latest.modelId)
        ?? options.find((option) => option.isDefault)
        ?? options[0]

      const stream = chatStream(
        chatMessages,
        (delta) => {
          if (handles.generation === generation) appendPending(id, delta)
        },
        () => {
          if (handles.generation !== generation) return
          handles.active = false
          handles.abort = null
          const final = flushPending(id)
          handles.pendingBuffer = ''
          const durationMs = runtimesRef.current[id]?.turnStartedAt
            ? Math.max(0, Date.now() - (runtimesRef.current[id]?.turnStartedAt ?? Date.now()))
            : undefined
          // R6-full：在途 steering badge 清除；文本早已在历史中保留。
          setRuntime(id, (current) => ({ ...current, pendingContent: '', pendingTimeline: emptyChatTimeline(), isStreaming: false, turnStartedAt: null, turnStatus: INITIAL_JANUS_CHAT_STATUS, pendingSteerIds: [], error: null }))
          commitAssistant(id, final, handles.assistantMessageId ?? undefined)
          snapshotReasoning(id, handles.assistantMessageId ?? undefined, final.trim().length > 0, durationMs)
          handles.assistantMessageId = null
        },
        (error) => {
          if (handles.generation !== generation) return
          handles.active = false
          handles.abort = null
          const startedAt = runtimesRef.current[id]?.turnStartedAt ?? Date.now()
          const latestUser = conversationsRef.current.find(item => item.id === id)?.messages.filter(message => message.role === 'user').at(-1)
          const canRecover = !requestMemoBinding && !recovery && replaySafe
            && latestUser?.id === userMessage.id
            && /function response parts|function call parts/i.test(error)
          const final = flushPending(id)
          handles.pendingBuffer = ''
          const durationMs = runtimesRef.current[id]?.turnStartedAt
            ? Math.max(0, Date.now() - (runtimesRef.current[id]?.turnStartedAt ?? Date.now()))
            : undefined
          setRuntime(id, (current) => ({
            ...current,
            pendingContent: '',
            pendingTimeline: emptyChatTimeline(),
            isStreaming: false,
            turnStartedAt: null,
            turnStatus: INITIAL_JANUS_CHAT_STATUS,
            error,
            pendingSteerIds: [],
          }))
          commitAssistant(id, final, handles.assistantMessageId ?? undefined)
          snapshotReasoning(id, handles.assistantMessageId ?? undefined, final.trim().length > 0, durationMs)
          handles.assistantMessageId = null
          if (canRecover) {
            startRequest(id, history, userMessage, { startedAt, error })
          }
        },
        {
          ...(model ? { providerId: model.providerId, modelId: model.modelId } : {}),
          sourceTag: 'janus-chat',
          conversationId: id,
          memoBinding: requestMemoBinding,
          memoMessageId: window.electron.memo && !compact ? userMessage.id : undefined,
          contextCheckpoint: latest.contextCheckpoint,
          contextEpoch: latest.contextEpoch,
          compact,
          workspaceResources: agentResources,
          toolTraces: latest.toolTraces,
          noteWorkingSet: JSON.stringify({ workingSet: useNoteFocusStore.getState().scopes[id] ?? null, browsing: null }),
          // S6: explicit domain; missing = legacy personal. Project never falls back to personal memory.
          ...(latest.engineeringContext?.domain ? { domain: latest.engineeringContext.domain } : {}),
          ...(latest.engineeringContext?.noteRefs?.length
            ? { noteRefs: latest.engineeringContext.noteRefs } : {}),
          onRecallTrace: (trace) => {
            if (handles.generation === generation) {
              setRuntime(id, (current) => ({ ...current, latestRecallTrace: trace }))
            }
          },
          onToolTrace: (entries) => {
            if (handles.generation !== generation) return
            const assistantMessageId = handles.assistantMessageId
            if (!assistantMessageId) return
            for (const entry of entries) handles.timeline = mergeTimelineTrace(handles.timeline, entry)
            scheduleFlush(id)
            updateConversation(id, (current) => ({
              ...current,
              toolTraces: [
                ...current.toolTraces,
                ...entries.map(({ configResult: _displayOnly, ...entry }) => ({ ...entry, turnId: assistantMessageId })),
              ].slice(-MAX_TOOL_TRACES),
              updatedAt: Date.now(),
            }))
          },
          onAgentEvent: (agentEvent) => {
            if (handles.generation !== generation) return
            handles.usingAgentEvents = true
            handles.timeline = reduceChatTimeline(handles.timeline, agentEvent)
            scheduleFlush(id)
            if (agentEvent.type === 'memo_created') {
              if (agentEvent.conversationId !== id || agentEvent.binding.messageId !== userMessage.id) return
              replaySafe = false
              // The originating conversation owns the binding, even if another
              // conversation is visible. Never replace a manual binding.
              updateConversation(id, current => current.memoId ? current : { ...current, memoId: agentEvent.binding.memoId, updatedAt: Date.now() })
              useMemoStore.getState().receive(agentEvent.binding.memoId)
              void useMemoStore.getState().refresh().catch(() => undefined)
              return
            }
            if (agentEvent.type === 'context_state') {
              if (handles.generation !== generation) return
              setRuntime(id, current => ({ ...current, contextStatus: agentEvent.state }))
              if (agentEvent.state.checkpoint) updateConversation(id, current => ({ ...current, contextCheckpoint: agentEvent.state.checkpoint }))
              return
            }
            if (agentEvent.type === 'note_focus') {
              if (handles.generation === generation && agentEvent.focus.conversationId === id) {
                useNoteFocusStore.getState().receive({ ...agentEvent.focus, turnId: handles.assistantMessageId ?? undefined })
              }
              return
            }
            if (agentEvent.type === 'note_change') {
              if (handles.generation === generation) replaySafe = false
              if (agentEvent.change.conversationId === id) useNoteChatStore.getState().receive(agentEvent.change)
              return
            }
            if (handles.generation === generation) {
              if ((agentEvent.type === 'tool_execution_start' || agentEvent.type === 'tool_execution_end')
                && !['note.list', 'note.read', 'note.focus', 'note.scope', 'note_list', 'note_read', 'note_focus', 'note_scope'].includes(agentEvent.toolName)) replaySafe = false
              if (agentEvent.type === 'reasoning_delta') {
                appendReasoning(id, agentEvent.delta)
              }
              if (agentEvent.type === 'steering_consumed') {
                // R6-full：主侧已注入本轮，badge 清除（文本本就在历史中）。
                setRuntime(id, (current) => {
                  const next = consumeSteeredIds(current.pendingSteerIds, agentEvent.keys)
                  return next === current.pendingSteerIds ? current : { ...current, pendingSteerIds: next }
                })
              }
              const status = chatStatusForEvent(agentEvent)
              setRuntime(id, (current) => ({
                ...current,
                ...(recovery && ['text_delta', 'reasoning_delta', 'tool_call_ready', 'tool_execution_start'].includes(agentEvent.type) ? { error: null } : {}),
                agent: reduceChatAgentEvent(current.agent, agentEvent),
                ...(status ? { turnStatus: status } : {}),
              }))
            }
          },
        },
      )
      handles.abort = stream.abort
    })().catch((reason: unknown) => {
      if (handles.generation !== generation) return
      handles.active = false
      handles.assistantMessageId = null
      setRuntime(id, (current) => ({
        ...current,
        isStreaming: false,
        turnStartedAt: null,
        turnStatus: INITIAL_JANUS_CHAT_STATUS,
        error: reason instanceof Error ? reason.message : 'Workspace session failed',
        pendingSteerIds: [],
      }))
    })
  }, [appendPending, appendReasoning, clearFlushTimer, commitAssistant, ensureAgentSessions, flushPending, getHandles, scheduleFlush, setRuntime, snapshotReasoning, updateConversation])

  const stop = useCallback((id: string) => {
    const runtime = runtimesRef.current[id]
    const handles = handlesRef.current.get(id)
    if (!runtime?.isStreaming && !handles?.abort && !handles?.active) return
    if (!handles) return
    handles.generation += 1
    handles.active = false
    handles.abort?.()
    handles.abort = null
    const final = flushPending(id)
    handles.pendingBuffer = ''
    // R6-full：stop 保留 steering 文本在历史（badge 清除），不断言自动重发。
    const stopDurationMs = runtimesRef.current[id]?.turnStartedAt
      ? Math.max(0, Date.now() - (runtimesRef.current[id]?.turnStartedAt ?? Date.now()))
      : undefined
    setRuntime(id, (current) => ({ ...current, pendingContent: '', pendingTimeline: emptyChatTimeline(), isStreaming: false, turnStartedAt: null, turnStatus: INITIAL_JANUS_CHAT_STATUS, pendingSteerIds: [] }))
    commitAssistant(id, final, handles.assistantMessageId ?? undefined, true)
    snapshotReasoning(id, handles.assistantMessageId ?? undefined, final.trim().length > 0, stopDurationMs)
    handles.assistantMessageId = null
  }, [commitAssistant, flushPending, setRuntime, snapshotReasoning])

  const send = useCallback((id: string, text: string) => {
    const trimmed = text.trim()
    const conversation = conversationsRef.current.find((item) => item.id === id)
    if (!trimmed || !conversation) return
    // Manual compaction uses the host summary checkpoint and preserves the transcript.
    const compact = parseCompactCommand(trimmed)
    if (compact) {
      const flashNotice = (modelNotice: string) => {
        setRuntime(id, (current) => ({ ...current, modelNotice }))
        const handles = getHandles(id)
        if (handles.noticeTimer !== null) window.clearTimeout(handles.noticeTimer)
        handles.noticeTimer = window.setTimeout(() => {
          handles.noticeTimer = null
          setRuntime(id, (current) => (current.modelNotice === modelNotice ? { ...current, modelNotice: null } : current))
        }, 1800)
      }
      if (runtimesRef.current[id]?.isStreaming || handlesRef.current.get(id)?.active) {
        flashNotice('Cannot compact while a response is streaming')
        return
      }
      if (conversation.messages.length < 3) {
        flashNotice('Conversation is already compact — nothing to collapse')
        return
      }
      startRequest(id, conversation.messages, { id: crypto.randomUUID(), role: 'user', content: trimmed, timestamp: Date.now() }, undefined, { keepRecentUnits: compact.keepLast })
      return
    }
    if (runtimesRef.current[id]?.isStreaming || handlesRef.current.get(id)?.active) {
      // R6-full：流式中发送走 steering——乐观追加用户消息（随会话落盘即 durable），
      // 再向主侧投递抢占。主侧 accept 即入队；拒绝（流已结束/队满）按下述回退。
      const entry: Message = { id: crypto.randomUUID(), role: 'user', content: trimmed, timestamp: Date.now() }
      const entryMemoBinding = window.electron.memo ? memoBinding(id, entry.id) : undefined
      updateConversation(id, (current) => ({ ...current, messages: [...current.messages, entry], updatedAt: Date.now() }))
      setRuntime(id, (current) => current.pendingSteerIds.includes(entry.id)
        ? current
        : { ...current, pendingSteerIds: [...current.pendingSteerIds, entry.id] })
      const settleSteer = (result: { accepted: boolean; error?: string }) => {
        if (result.accepted) return
        if (result.error === 'Steering queue is full for this stream') {
          // 队满：文本留历史（下次发送自然带上），badge 消 + 短暂提示。
          setRuntime(id, (current) => ({
            ...current,
            pendingSteerIds: current.pendingSteerIds.filter((item) => item !== entry.id),
            modelNotice: 'Steering queue is full; message kept for next turn',
          }))
          const handles = getHandles(id)
          if (handles.noticeTimer !== null) window.clearTimeout(handles.noticeTimer)
          handles.noticeTimer = window.setTimeout(() => {
            handles.noticeTimer = null
            setRuntime(id, (current) => ({ ...current, modelNotice: null }))
          }, 1800)
          return
        }
        // 流已结束等竞态：撤回乐观消息，macrotask 后按最新状态重走发送。
        updateConversation(id, (current) => {
          const next = removeMessageById(current.messages, entry.id)
          return next === current.messages ? current : { ...current, messages: next, updatedAt: Date.now() }
        })
        setRuntime(id, (current) => ({ ...current, pendingSteerIds: current.pendingSteerIds.filter((item) => item !== entry.id) }))
        window.setTimeout(() => {
          const handles = getHandles(id)
          const latest = conversationsRef.current.find((item) => item.id === id)
          if (!latest) return
          if (runtimesRef.current[id]?.isStreaming || handles.active) {
            // 流又忙了：文本挂回历史尾，等下次发送自然带上。
            updateConversation(id, (current) => ({ ...current, messages: [...current.messages, entry], updatedAt: Date.now() }))
            return
          }
          startRequest(id, latest.messages, entry, undefined, undefined, { binding: entryMemoBinding })
        }, 0)
      }
      void steerChat({ conversationId: id, entryId: entry.id, text: trimmed, memoBinding: entryMemoBinding }).then(
        settleSteer,
        () => settleSteer({ accepted: false }),
      )
      return
    }
    startRequest(id, conversation.messages, {
      id: crypto.randomUUID(),
      role: 'user',
      content: trimmed,
      timestamp: Date.now(),
    })
  }, [getHandles, setRuntime, startRequest, updateConversation])

  const cancelSteeredMessage = useCallback((id: string, queueId: string) => {
    // 已消费则撤销失败（消息保留）；未消费则从主侧队列与本地历史同时撤回。
    void cancelSteerChat({ conversationId: id, entryId: queueId }).then((result) => {
      setRuntime(id, (current) => ({ ...current, pendingSteerIds: current.pendingSteerIds.filter((item) => item !== queueId) }))
      if (result.cancelled) {
        updateConversation(id, (current) => {
          const next = removeMessageById(current.messages, queueId)
          return next === current.messages ? current : { ...current, messages: next, updatedAt: Date.now() }
        })
      }
    }).catch(() => undefined)
  }, [setRuntime, updateConversation])

  const rewrite = useCallback((id: string, messageId: string, text: string) => {
    const trimmed = text.trim()
    const conversation = conversationsRef.current.find((item) => item.id === id)
    if (!trimmed || !conversation || runtimesRef.current[id]?.isStreaming || handlesRef.current.get(id)?.active) return
    const index = conversation.messages.findIndex((message) =>
      message.id === messageId && message.role === 'user')
    if (index < 0) return
    const target = conversation.messages[index]
    updateConversation(id, (current) => ({ ...current, toolTraces: [] }))
    updateConversation(id, current => ({ ...current, contextCheckpoint: undefined, contextEpoch: (current.contextEpoch ?? 0) + 1 }))
    startRequest(id, conversation.messages.slice(0, index), { ...target, content: trimmed })
  }, [startRequest, updateConversation])

  const retry = useCallback((id: string) => {
    const conversation = conversationsRef.current.find((item) => item.id === id)
    if (!conversation || runtimesRef.current[id]?.isStreaming || handlesRef.current.get(id)?.active) return
    const turn = getRetryTurn(conversation.messages)
    if (!turn) return
    updateConversation(id, (current) => ({ ...current, toolTraces: [] }))
    startRequest(id, turn.history, turn.userMessage)
  }, [startRequest, updateConversation])

  const clear = useCallback((id: string) => {
    useNoteFocusStore.getState().clear(id, true)
    const panel = ephemeralIdsRef.current.has(id)
    invalidateRuntime(id, panel)
    updateConversation(id, (conversation) => ({
      ...conversation,
      messages: [],
      toolTraces: [],
      contextCheckpoint: undefined,
      contextEpoch: (conversation.contextEpoch ?? 0) + 1,
      updatedAt: Date.now(),
    }))
    setRuntime(id, () => ({ ...emptyRuntime(), ...(panel ? { approvalMode: 'plan' as const } : {}) }))
  }, [invalidateRuntime, setRuntime, updateConversation])

  // Note: workspace lifetime survives panel unmounts — see .agents/notes/blueprint/maintenance/tasks/blueprint-workspace-dialog.md
  useEffect(() => useWorkspaceStore.subscribe((state) => {
    if (panelWorkspaceRef.current === null) return
    const workspace = state.workspaces.find(item => item.id === state.activeWorkspaceId)
    const key = workspace ? `${workspace.id}|${workspace.path}` : ''
    if (panelWorkspaceRef.current === key) return
    panelWorkspaceRef.current = key
    for (const id of ephemeralIdsRef.current) {
      clear(id)
      updateConversation(id, conversation => ({
        ...conversation,
        title: workspace?.name ?? NEW_CONVERSATION_TITLE,
        attachedWorkspaceIds: workspace ? [workspace.id] : [],
        engineeringContext: conversation.engineeringContext ? {
          ...conversation.engineeringContext, intent: 'discuss', noteRefs: [], repoIds: [],
          contextRevision: (conversation.engineeringContext.contextRevision ?? 0) + 1,
        } : undefined,
      }))
    }
  }), [clear, updateConversation])

  const attachWorkspace = useCallback(async (id: string, workspaceId: string) => {
    const workspace = workspacesRef.current.find(item => item.id === workspaceId)
    const conversation = conversationsRef.current.find(item => item.id === id)
    if (!workspace || !conversation) return
    updateConversation(id, (conversation) => conversation.attachedWorkspaceIds.includes(workspaceId)
      ? conversation
      : {
          ...conversation,
          attachedWorkspaceIds: [...conversation.attachedWorkspaceIds, workspaceId],
          updatedAt: Date.now(),
        })
  }, [updateConversation])

  const detachWorkspace = useCallback(async (id: string, workspaceId: string) => {
    const conversation = conversationsRef.current.find(item => item.id === id)
    if (!conversation) return
    const handles = handlesRef.current.get(id)
    const session = handles?.sessions.get(workspaceId)
    if (session) {
      handles!.sessions.delete(workspaceId)
      void window.electron.agentRuntime.cancelSession(session.id).catch(() => undefined)
    }
    updateConversation(id, (conversation) => ({
      ...conversation,
      attachedWorkspaceIds: conversation.attachedWorkspaceIds.filter((item) => item !== workspaceId),
      updatedAt: Date.now(),
    }))
  }, [updateConversation])

  const resolveApproval = useCallback((id: string, approvalId: string, approved: boolean) => {
    const request = runtimesRef.current[id]?.agent.pendingApprovals.find((item) => item.id === approvalId)
    if (!request) return
    void window.electron.agentRuntime.resolveApproval({
      approvalId,
      approved,
      workspaceId: request.workspaceId,
      sessionId: request.sessionId,
      correlationId: request.correlationId,
      toolName: request.toolName,
      actionRisk: request.actionRisk,
    }).then((resolved) => {
      if (!resolved) setRuntime(id, (current) => ({
        ...current,
        error: 'Workspace action approval is no longer active',
      }))
    }).catch((reason: unknown) => {
      setRuntime(id, (current) => ({
        ...current,
        error: reason instanceof Error ? reason.message : 'Workspace action approval failed',
      }))
    })
  }, [setRuntime])

  const selectModel = useCallback((id: string, providerId: string, modelId: string) => {
    const model = modelOptionsRef.current.find((option) =>
      option.providerId === providerId && option.modelId === modelId)
    if (!model) return
    updateConversation(id, (conversation) => ({
      ...conversation,
      providerId,
      modelId,
      updatedAt: Date.now(),
    }))
    const handles = getHandles(id)
    if (handles.noticeTimer !== null) window.clearTimeout(handles.noticeTimer)
    setRuntime(id, (current) => ({ ...current, contextStatus: undefined, modelNotice: `Model switched: ${model.modelId}` }))
    handles.noticeTimer = window.setTimeout(() => {
      handles.noticeTimer = null
      setRuntime(id, (current) => ({ ...current, modelNotice: null }))
    }, 1800)
  }, [getHandles, setRuntime, updateConversation])

  const setApprovalMode = useCallback((id: string, mode: AgentApprovalMode) => {
    const normalized = normalizeAgentApprovalMode(mode)
    const handles = getHandles(id)
    setRuntime(id, (current) => ({ ...current, approvalMode: normalized }))
    for (const session of handles.sessions.values()) {
      void window.electron.agentRuntime.setApprovalMode(session.id, normalized).then((updated) => {
        if (!updated) setRuntime(id, (current) => ({ ...current, error: 'Unable to switch Agent permission mode' }))
      }).catch((error: unknown) => setRuntime(id, (current) => ({
        ...current,
        error: error instanceof Error ? error.message : 'Unable to switch Agent permission mode',
      })))
    }
  }, [getHandles, setRuntime])

  const createConversation = useCallback(() => {
    const conversation = createJanusConversation()
    updateConversations((current) => [conversation, ...current])
    setIslandConversationId(conversation.id)
    return conversation.id
  }, [updateConversations])

  const bindProject = useCallback((context: EngineeringContext, workspaceIds: string[], title: string) => {
    const bound = bindProjectConversation(conversationsRef.current, context, workspaceIds, title)
    updateConversations(() => bound.conversations)
    setIslandConversationId(bound.id)
    return bound.id
  }, [updateConversations])

  const bindPanelProject = useCallback((context: EngineeringContext, workspaceIds: string[], title: string) => {
    const workspace = workspacesRef.current.find(item => item.id === workspaceIds[0])
    panelWorkspaceRef.current = workspace ? `${workspace.id}|${workspace.path}` : ''
    const bound = bindProjectConversation(conversationsRef.current, context, workspaceIds, title)
    ephemeralIdsRef.current.add(bound.id)
    updateConversations(() => bound.conversations)
    return bound.id
  }, [updateConversations])

  const selectConversation = useCallback((id: string) => {
    if (ephemeralIdsRef.current.has(id)) return
    if (conversationsRef.current.some((conversation) => conversation.id === id)) {
      setIslandConversationId(id)
    }
  }, [])

  /* One session maintains exactly one memo. Picking a memo in a session that
   * has none just records it; switching to another memo or leaving the memo
   * ends this session and opens a fresh one, keeping the ended session in the
   * list for later viewing. See .agents/notes/knowledge/user-todo-janus.md */
  const bindMemo = useCallback((id: string, memoId: string | null) => {
    const current = conversationsRef.current.find((item) => item.id === id)
    if (!current) return
    if (!current.memoId) {
      if (memoId) updateConversation(id, (conversation) => ({ ...conversation, memoId, updatedAt: Date.now() }))
      return
    }
    if (current.memoId === memoId) return
    const next = continueConversation(current, memoId ?? undefined)
    updateConversations((list) => [next, ...list])
    setIslandConversationId(next.id)
  }, [updateConversation, updateConversations])

  // The memo panel and the Chat turn read the active session's memo through the
  // store; the conversation record stays the single source of truth.
  useEffect(() => {
    const active = conversationsRef.current.find((item) => item.id === islandConversationId)
    useMemoStore.getState().bindConversation(islandConversationId, active?.memoId ?? null)
  }, [conversations, islandConversationId])

  const renameConversation = useCallback((id: string, title: string) => {
    const normalized = title.trim().replace(/\s+/g, ' ')
    if (!normalized) return
    updateConversation(id, (conversation) => ({
      ...conversation,
      title: normalized.slice(0, 80),
      updatedAt: Date.now(),
    }))
  }, [updateConversation])

  const answerQuestion = useCallback((id: string, callId: string, answer: ChatQuestionAnswer) => {
    const pending = runtimesRef.current[id]?.agent.pendingQuestions.find((item) => item.callId === callId)
    if (!pending) return
    void answerChatQuestion({ requestId: pending.requestId, callId, answer }).catch(() => {})
  }, [])

  const deleteConversation = useCallback((id: string) => {
    const exists = conversationsRef.current.some((conversation) => conversation.id === id)
    if (!exists) return
    invalidateRuntime(id, true)
    handlesRef.current.delete(id)
    setRuntimeStates((current) => {
      const { [id]: _removed, ...next } = current
      runtimesRef.current = next
      return next
    })
    const remaining = conversationsRef.current.filter((conversation) => conversation.id !== id)
    // The panel slot must never become the island fallback.
    const visible = remaining.filter((conversation) => !ephemeralIdsRef.current.has(conversation.id))
    const fallback = visible[0] ?? createJanusConversation()
    const next = visible.length > 0 ? remaining : [...remaining, fallback]
    conversationsRef.current = next
    setConversations(next)
    setIslandConversationId((current) => current === id ? fallback.id : current)
  }, [invalidateRuntime])

  const summaries = useMemo<ConversationSummary[]>(() => conversations
    .filter((conversation) => !ephemeralIdsRef.current.has(conversation.id))
    .map((conversation) => ({
    id: conversation.id,
    title: conversation.title,
    updatedAt: conversation.updatedAt,
    messageCount: conversation.messages.length,
    isStreaming: runtimeStates[conversation.id]?.isStreaming ?? false,
    hasError: !!runtimeStates[conversation.id]?.error,
    ...(conversation.memoId ? { memoId: conversation.memoId } : {}),
  })).sort((a, b) => b.updatedAt - a.updatedAt), [conversations, runtimeStates])

  const getController = useCallback((requestedId?: string): UseJanusChatReturn => {
    const id = requestedId && conversations.some((conversation) => conversation.id === requestedId)
      ? requestedId
      : islandConversationId
    const conversation = conversations.find((item) => item.id === id) ?? conversations[0]
    const runtime = runtimeStates[id] ?? emptyRuntime(defaultApprovalMode)
    const resources = conversation ? workspaceResources(conversation, availableWorkspaces) : []
    const activeModel = modelOptions.find((option) =>
      option.providerId === conversation?.providerId && option.modelId === conversation?.modelId)
      ?? modelOptions.find((option) => option.isDefault)
      ?? modelOptions[0]
      ?? null

    return {
      contextStatus: runtime.contextStatus,
      setModelLimits: async (tokens) => {
        if (!activeModel || (tokens !== null && !validChatModelLimits(tokens))) throw new Error('Invalid model limits')
        const detected = await getChatModelBudget(activeModel.providerId, activeModel.modelId)
        if (tokens !== null && detected.resolved && detected.source !== 'configured') throw new Error('Automatic model limits are available')
        const providers = await getTerminalProviders('janus')
        const provider = providers.find(item => item.id === activeModel.providerId)
        if (!provider) throw new Error('Provider unavailable')
        const limits = provider.extra?.chatModelLimits as Record<string, unknown> | undefined
        const modelLimits = { ...limits }
        if (tokens === null) delete modelLimits[activeModel.modelId]
        else modelLimits[activeModel.modelId] = { ...tokens }
        const saved = await saveTerminalProvider('janus', { ...provider, extra: { ...provider.extra,
          chatModelLimits: modelLimits } })
        if (!saved.success) throw new Error(saved.error ?? 'Failed to save model window')
        const latest = conversationsRef.current.find(item => item.id === id)
        if (!latest || (latest.providerId && latest.providerId !== activeModel.providerId)
          || (latest.modelId && latest.modelId !== activeModel.modelId)) return
        setRuntime(id, current => ({ ...current, contextStatus: undefined }))
      },
      engineeringContext: conversation?.engineeringContext,
      setEngineeringContext: (context) => updateConversation(id, (current) => ({ ...current, engineeringContext: context, updatedAt: Date.now() })),
      repairNote: () => { openPluginManager(); return false },
      proposeMaintenance: openPluginManager,
      conversationId: conversation?.id ?? id,
      conversationTitle: conversation?.title ?? NEW_CONVERSATION_TITLE,
      conversations: summaries,
      messages: conversation?.messages ?? [],
      activeTurnId: handlesRef.current.get(id)?.assistantMessageId ?? undefined,
      pendingContent: runtime.pendingContent,
      pendingReasoning: runtime.pendingReasoning,
      pendingTimeline: runtime.pendingTimeline,
      reasoningByTurn: runtime.reasoningByTurn,
      isStreaming: runtime.isStreaming,
      turnStartedAt: runtime.turnStartedAt,
      turnStatus: runtime.turnStatus,
      error: runtime.error,
      modelOptions,
      activeModel,
      modelNotice: runtime.modelNotice,
      latestRecallTrace: runtime.latestRecallTrace,
      toolTraces: conversation?.toolTraces ?? [],
      todos: runtime.agent.todos,
      pendingQuestions: runtime.agent.pendingQuestions,
      answerQuestion: (callId, answer) => answerQuestion(id, callId, answer),
      resourceController: {
        resources,
        availableWorkspaces,
        attachWorkspace: (workspaceId) => attachWorkspace(id, workspaceId),
        detachWorkspace: (workspaceId) => detachWorkspace(id, workspaceId),
        activities: runtime.agent.activities,
        pendingApprovals: runtime.agent.pendingApprovals,
        resolveApproval: (approvalId, approved) => resolveApproval(id, approvalId, approved),
      },
      send: (text) => send(id, text),
      rewrite: (messageId, text) => rewrite(id, messageId, text),
      stop: () => stop(id),
      retry: () => retry(id),
      clear: () => clear(id),
      pendingSteerIds: runtime.pendingSteerIds,
      cancelSteeredMessage: (queueId) => cancelSteeredMessage(id, queueId),
      selectModel: (providerId, modelId) => selectModel(id, providerId, modelId),
      refreshModels: loadConfiguredModels,
      createConversation,
      selectConversation,
      renameConversation,
      deleteConversation,
      bindMemo: (memoId) => bindMemo(id, memoId),
      approvalMode: runtime.approvalMode,
      setApprovalMode: (mode) => setApprovalMode(id, mode),
    }
  }, [
    answerQuestion,
    attachWorkspace,
    availableWorkspaces,
    bindMemo,
    cancelSteeredMessage,
    clear,
    conversations,
    createConversation,
    defaultApprovalMode,
    deleteConversation,
    detachWorkspace,
    islandConversationId,
    loadConfiguredModels,
    modelOptions,
    renameConversation,
    resolveApproval,
    retry,
    rewrite,
    runtimeStates,
    setRuntime,
    selectConversation,
    selectModel,
    send,
    setApprovalMode,
    stop,
    summaries,
    updateConversation,
  ])

  const getProjectController = (viewRef: NonNullable<EngineeringContext['viewRef']>): UseJanusChatReturn | null => {
    const conversation = conversations.find(item => item.engineeringContext?.domain === 'project'
      && item.engineeringContext.viewRef?.ownerRepoId === viewRef.ownerRepoId
      && item.engineeringContext.viewRef?.viewId === viewRef.viewId)
    return conversation ? getController(conversation.id) : null
  }

  return { islandConversationId, getController, getProjectController, bindProject, bindPanelProject, persistenceReady }
}
