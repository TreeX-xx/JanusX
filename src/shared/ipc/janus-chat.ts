import type { ChatToolTraceEntry } from './llm'
import { normalizeConversationTopic, type ConversationTopic, type TopicRouteRequest, type TopicRoute } from '../conversation-topics'
import { normalizeChatTimeline, type ChatTimelineSnapshot } from '../chat-timeline'
import { normalizeMessageContext, type MessageContext } from '../conversation-context'

export const JANUS_CHAT_CHANNELS = {
  load: 'janus-chat:load',
  save: 'janus-chat:save',
  routeTopic: 'janus-chat:route-topic',
} as const

export interface JanusChatMessage {
  context?: MessageContext
  /** Captured when sent; later workspace navigation never retargets this input. */
  workspaceId?: string | null
  timeline?: ChatTimelineSnapshot
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
}

export type EngineeringDomain = 'personal' | 'project'
export type EngineeringIntent = 'assist' | 'discuss' | 'maintain' | 'implement'
export type EngineeringScope = 'selected' | 'subtree' | 'view'

export interface EngineeringNoteRef {
  /** Checkout selector only; attached sessions authorize access. */
  checkoutPath?: string
  uri: string
  expectedHash?: string
}

export interface EngineeringContext {
  domain: EngineeringDomain
  intent: EngineeringIntent
  noteRefs: EngineeringNoteRef[]
  scope: EngineeringScope
  viewRef?: { ownerRepoId: string; viewId: string }
  repoIds: string[]
  taskRefs?: string[]
  workflow?: { mode: 'xdo' | 'xdel' | 'xflow'; standardVersion: string }
  contextRevision?: number
}

export interface PersistedJanusConversation {
  /** Explicit SuperAgent composer choice; absent means follow configured defaults. */
  superAgentModel?: { providerId: string; modelId: string }
  topic?: ConversationTopic
  contextCheckpoint?: import('../chat-context').ChatContextCheckpoint
  contextEpoch?: number
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messages: JanusChatMessage[]
  providerId?: string
  modelId?: string
  attachedWorkspaceIds: string[]
  toolTraces: ChatToolTraceEntry[]
  engineeringContext?: EngineeringContext
  /** The memo file this session maintains. One session owns exactly one memo;
   *  switching or leaving it ends the session. See .agents/notes/knowledge/user-todo-janus.md */
  memoId?: string
  artifactRefs?: EngineeringNoteRef[]
  activeRunRefs?: Array<{ taskUri: string; runId: string }>
  pendingActions?: Array<{ id: string; kind: string; createdAt: number }>
}

export interface JanusChatStorageSnapshot {
  version: 1
  activeConversationId: string
  conversations: PersistedJanusConversation[]
}

export interface JanusChatAPI {
  routeTopic(request: TopicRouteRequest): Promise<TopicRoute>
  load(): Promise<JanusChatStorageSnapshot | null>
  save(snapshot: JanusChatStorageSnapshot): Promise<void>
}

const MAX_CONVERSATIONS = 100
const MAX_TOOL_TRACES = 48
const MAX_ID_LENGTH = 128
const MAX_TITLE_LENGTH = 80
const MAX_MESSAGE_LENGTH = 100_000
const MAX_TRACE_FIELD_LENGTH = 2_000
const MAX_NOTE_REFS = 64
const MAX_RUN_REFS = 16
const MAX_PENDING_ACTIONS = 16
const MAX_URI_LENGTH = 512

function boundedString(value: unknown, maxLength: number): string | null {
  return typeof value === 'string' && value.trim().length > 0
    ? value.slice(0, maxLength)
    : null
}

function finiteTimestamp(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

function normalizeNoteRef(value: unknown): EngineeringNoteRef | null {
  if (!value || typeof value !== 'object') return null
  const source = value as Record<string, unknown>
  const uri = boundedString(source.uri, MAX_URI_LENGTH)
  if (!uri) return null
  const expectedHash = boundedString(source.expectedHash, MAX_ID_LENGTH) ?? undefined
  const checkoutPath = boundedString(source.checkoutPath, 4096) ?? undefined
  return { uri, ...(expectedHash ? { expectedHash } : {}), ...(checkoutPath ? { checkoutPath } : {}) }
}

function normalizeEngineeringContext(value: unknown): EngineeringContext | undefined {
  if (!value || typeof value !== 'object') return undefined
  const source = value as Record<string, unknown>
  if (source.domain !== 'personal' && source.domain !== 'project') return undefined
  if (source.intent !== 'assist' && source.intent !== 'discuss' && source.intent !== 'maintain' && source.intent !== 'implement') {
    return undefined
  }
  if (source.scope !== 'selected' && source.scope !== 'subtree' && source.scope !== 'view') return undefined
  const noteRefs = Array.isArray(source.noteRefs)
    ? source.noteRefs.flatMap((item) => {
        const ref = normalizeNoteRef(item)
        return ref ? [ref] : []
      }).slice(0, MAX_NOTE_REFS)
    : []
  const repoIds = Array.isArray(source.repoIds)
    ? [...new Set(source.repoIds.flatMap((item) => {
        const repoId = boundedString(item, MAX_ID_LENGTH)
        return repoId ? [repoId] : []
      }))].slice(0, 32)
    : []
  const taskRefs = Array.isArray(source.taskRefs)
    ? [...new Set(source.taskRefs.flatMap((item) => {
        const ref = boundedString(item, MAX_URI_LENGTH)
        return ref ? [ref] : []
      }))].slice(0, MAX_NOTE_REFS)
    : undefined
  let viewRef: EngineeringContext['viewRef']
  if (source.viewRef && typeof source.viewRef === 'object') {
    const view = source.viewRef as Record<string, unknown>
    const ownerRepoId = boundedString(view.ownerRepoId, MAX_ID_LENGTH)
    const viewId = boundedString(view.viewId, MAX_ID_LENGTH)
    if (ownerRepoId && viewId) viewRef = { ownerRepoId, viewId }
  }
  let workflow: EngineeringContext['workflow']
  if (source.workflow && typeof source.workflow === 'object') {
    const flow = source.workflow as Record<string, unknown>
    if ((flow.mode === 'xdo' || flow.mode === 'xdel' || flow.mode === 'xflow')
      && typeof flow.standardVersion === 'string' && flow.standardVersion.trim()) {
      workflow = { mode: flow.mode, standardVersion: flow.standardVersion.slice(0, MAX_ID_LENGTH) }
    }
  }
  const contextRevision = typeof source.contextRevision === 'number' && Number.isFinite(source.contextRevision)
    ? Math.floor(source.contextRevision)
    : undefined
  return {
    domain: source.domain,
    intent: source.intent,
    noteRefs,
    scope: source.scope,
    ...(viewRef ? { viewRef } : {}),
    repoIds,
    ...(taskRefs ? { taskRefs } : {}),
    ...(workflow ? { workflow } : {}),
    ...(contextRevision !== undefined ? { contextRevision } : {}),
  }
}

function normalizeConversation(value: unknown): PersistedJanusConversation | null {
  if (!value || typeof value !== 'object') return null
  const source = value as Record<string, unknown>
  const id = boundedString(source.id, MAX_ID_LENGTH)
  const title = boundedString(source.title, MAX_TITLE_LENGTH)
  const createdAt = finiteTimestamp(source.createdAt)
  const updatedAt = finiteTimestamp(source.updatedAt)
  if (!id || !title || createdAt === null || updatedAt === null || !Array.isArray(source.messages)) return null

  const messages = source.messages.flatMap((item): JanusChatMessage[] => {
    if (!item || typeof item !== 'object') return []
    const message = item as Record<string, unknown>
    const messageId = boundedString(message.id, MAX_ID_LENGTH)
    const content = typeof message.content === 'string'
      ? message.content
      : null
    const timestamp = finiteTimestamp(message.timestamp)
    if (!messageId || content === null || timestamp === null) return []
    if (message.role !== 'user' && message.role !== 'assistant') return []
    const timeline = message.role === 'assistant' ? normalizeChatTimeline(message.timeline) : undefined
    const workspaceId = message.workspaceId === null ? null : boundedString(message.workspaceId, MAX_ID_LENGTH) ?? undefined
    const context = message.role === 'user' ? normalizeMessageContext(message.context) : undefined
    return [{ id: messageId, role: message.role, content, timestamp, ...(context ? { context } : {}), ...(workspaceId !== undefined ? { workspaceId } : {}), ...(timeline && (timeline.blocks.length || timeline.truncated) ? { timeline } : {}) }]
  })

  const attachedWorkspaceIds = Array.isArray(source.attachedWorkspaceIds)
    ? [...new Set(source.attachedWorkspaceIds.flatMap((item) => {
        const workspaceId = boundedString(item, MAX_ID_LENGTH)
        return workspaceId ? [workspaceId] : []
      }))].slice(0, 32)
    : []

  const toolTraces = Array.isArray(source.toolTraces)
    ? source.toolTraces.slice(-MAX_TOOL_TRACES).flatMap((item) => {
        if (!item || typeof item !== 'object') return []
        const trace = item as Record<string, unknown>
        const toolName = boundedString(trace.toolName, MAX_ID_LENGTH)
        const workspaceId = boundedString(trace.workspaceId, MAX_ID_LENGTH)
        const status = boundedString(trace.status, MAX_ID_LENGTH)
        const summary = boundedString(trace.summary, MAX_TRACE_FIELD_LENGTH)
        const turnId = boundedString(trace.turnId, MAX_ID_LENGTH) ?? undefined
        const callId = boundedString(trace.callId, 256) ?? undefined
        const argsDigest = boundedString(trace.argsDigest, MAX_TRACE_FIELD_LENGTH) ?? undefined
        const resultDigest = boundedString(trace.resultDigest, MAX_TRACE_FIELD_LENGTH) ?? undefined
        const errorDetail = boundedString(trace.errorDetail, MAX_TRACE_FIELD_LENGTH) ?? undefined
        const startedAt = finiteTimestamp(trace.startedAt) ?? undefined
        const completedAt = finiteTimestamp(trace.completedAt) ?? undefined
        return toolName && workspaceId && status && summary
          ? [{
              toolName,
              workspaceId,
              status,
              summary,
              ...(turnId ? { turnId } : {}),
              ...(callId ? { callId } : {}),
              ...(argsDigest ? { argsDigest } : {}),
              ...(resultDigest ? { resultDigest } : {}),
              ...(errorDetail ? { errorDetail } : {}),
              ...(startedAt !== undefined ? { startedAt } : {}),
              ...(completedAt !== undefined ? { completedAt } : {}),
            }]
          : []
      })
    : []

  const providerId = boundedString(source.providerId, MAX_ID_LENGTH) ?? undefined
  const modelId = boundedString(source.modelId, 256) ?? undefined
  const rawSuperAgentModel = source.superAgentModel as Record<string, unknown> | undefined
  const selectedProvider = rawSuperAgentModel && boundedString(rawSuperAgentModel.providerId, MAX_ID_LENGTH)
  const selectedModel = rawSuperAgentModel && boundedString(rawSuperAgentModel.modelId, 256)
  const memoId = typeof source.memoId === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(source.memoId) ? source.memoId : undefined
  const engineeringContext = normalizeEngineeringContext(source.engineeringContext)
  const rawArtifactRefs = Array.isArray(source.artifactRefs)
    ? source.artifactRefs.flatMap((item) => {
        const ref = normalizeNoteRef(item)
        return ref ? [ref] : []
      }).slice(0, MAX_NOTE_REFS)
    : undefined
  const artifactRefs = rawArtifactRefs?.length ? rawArtifactRefs : undefined
  const rawRunRefs = Array.isArray(source.activeRunRefs)
    ? source.activeRunRefs.flatMap((item) => {
        if (!item || typeof item !== 'object') return []
        const entry = item as Record<string, unknown>
        const taskUri = boundedString(entry.taskUri, MAX_URI_LENGTH)
        const runId = boundedString(entry.runId, MAX_ID_LENGTH)
        return taskUri && runId ? [{ taskUri, runId }] : []
      }).slice(0, MAX_RUN_REFS)
    : undefined
  const activeRunRefs = rawRunRefs?.length ? rawRunRefs : undefined
  const rawPendingActions = Array.isArray(source.pendingActions)
    ? source.pendingActions.flatMap((item) => {
        if (!item || typeof item !== 'object') return []
        const entry = item as Record<string, unknown>
        const id = boundedString(entry.id, MAX_ID_LENGTH)
        const kind = boundedString(entry.kind, MAX_ID_LENGTH)
        const createdAt = finiteTimestamp(entry.createdAt)
        return id && kind && createdAt !== null ? [{ id, kind, createdAt }] : []
      }).slice(0, MAX_PENDING_ACTIONS)
    : undefined
  const pendingActions = rawPendingActions?.length ? rawPendingActions : undefined
  const checkpoint = source.contextCheckpoint as import('../chat-context').ChatContextCheckpoint | undefined
  const contextCheckpoint = checkpoint && typeof checkpoint.summary === 'string' && checkpoint.summary.length <= MAX_MESSAGE_LENGTH
    && Number.isSafeInteger(checkpoint.coveredMessages) && checkpoint.coveredMessages >= 0
    && typeof checkpoint.prefixHash === 'string' && /^[a-f0-9]{64}$/.test(checkpoint.prefixHash)
    && typeof checkpoint.scopeKey === 'string' && checkpoint.scopeKey.length < 16000
    && (checkpoint.references === undefined || (Array.isArray(checkpoint.references) && checkpoint.references.every(ref => typeof ref === 'string' && ref.length <= 16000))) ? checkpoint : undefined
  return {
    ...(contextCheckpoint ? { contextCheckpoint } : {}),
    ...(normalizeConversationTopic(source.topic) ? { topic: normalizeConversationTopic(source.topic) } : {}),
    contextEpoch: Number.isSafeInteger(source.contextEpoch) ? source.contextEpoch as number : 0,
    id,
    title,
    createdAt,
    updatedAt,
    messages,
    ...(providerId ? { providerId } : {}),
    ...(modelId ? { modelId } : {}),
    ...(selectedProvider && selectedModel ? { superAgentModel: { providerId:selectedProvider, modelId:selectedModel } } : {}),
    ...(memoId ? { memoId } : {}),
    attachedWorkspaceIds,
    toolTraces,
    ...(engineeringContext ? { engineeringContext } : {}),
    ...(artifactRefs ? { artifactRefs } : {}),
    ...(activeRunRefs ? { activeRunRefs } : {}),
    ...(pendingActions ? { pendingActions } : {}),
  }
}

export function normalizeJanusChatSnapshot(value: unknown): JanusChatStorageSnapshot | null {
  if (!value || typeof value !== 'object') return null
  const source = value as Record<string, unknown>
  if (source.version !== 1 || !Array.isArray(source.conversations)) return null

  const seen = new Set<string>()
  const conversations = source.conversations.slice(0, MAX_CONVERSATIONS).flatMap((item) => {
    const conversation = normalizeConversation(item)
    if (!conversation || seen.has(conversation.id)) return []
    seen.add(conversation.id)
    return [conversation]
  })
  if (conversations.length === 0) return null

  const requestedActiveId = boundedString(source.activeConversationId, MAX_ID_LENGTH)
  return {
    version: 1,
    activeConversationId: requestedActiveId && seen.has(requestedActiveId)
      ? requestedActiveId
      : conversations[0].id,
    conversations,
  }
}
