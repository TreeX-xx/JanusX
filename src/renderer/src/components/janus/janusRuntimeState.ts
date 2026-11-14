import type { AgentRuntimeEvent, ApprovalRequest } from '../../../../shared/ipc/agent-runtime'
import type { ChatAgentEvent, ChatAskQuestion, ChatTodoItem } from '../../../../shared/ipc/llm'

export type JanusToolActivityStatus = 'requested' | 'approval' | 'running' | 'completed' | 'failed' | 'cancelled'

export interface JanusToolActivity {
  correlationId: string
  toolName: string
  status: JanusToolActivityStatus
  summary?: string
  argsDigest?: string
  argumentChars?: number
  resultDigest?: string
  errorDetail?: string
}

export interface JanusPendingQuestion {
  requestId: string
  callId: string
  questions: ChatAskQuestion[]
  allowCustom: boolean
}

export interface JanusRuntimeState {
  activities: JanusToolActivity[]
  pendingApprovals: ApprovalRequest[]
  /** Latest todo snapshot from the agent loop (mirrored wholesale per event). */
  todos: ChatTodoItem[]
  /** Open mid-turn questions awaiting a renderer answer. */
  pendingQuestions: JanusPendingQuestion[]
}

export const EMPTY_JANUS_RUNTIME_STATE: JanusRuntimeState = { activities: [], pendingApprovals: [], todos: [], pendingQuestions: [] }

/**
 * agentX store.ts parity：ChatAgentEvent -> 聊天状态行（思考/输出/工具/等待）。
 * 返回 null 表示该事件不改变状态行（沿用上一状态）。
 */
export type JanusChatStatusKind = 'connecting' | 'thinking' | 'writing' | 'preparing' | 'running' | 'awaiting' | 'finishing'

export interface JanusChatStatus {
  kind: JanusChatStatusKind
  toolName?: string
}

export const INITIAL_JANUS_CHAT_STATUS: JanusChatStatus = { kind: 'connecting' }

export function chatStatusForEvent(event: ChatAgentEvent): JanusChatStatus | null {
  switch (event.type) {
    case 'agent_start':
      return { kind: 'connecting' }
    case 'reasoning_delta':
      return { kind: 'thinking' }
    case 'text_delta':
      return { kind: 'writing' }
    case 'tool_call_start':
    case 'tool_call_ready':
      return { kind: 'preparing' }
    case 'tool_execution_start':
    case 'tool_execution_update':
      return { kind: 'running', toolName: event.toolName }
    case 'tool_execution_end':
      return null
    case 'model_finish':
      if (event.reason === 'tool_calls') return { kind: 'running' }
      return { kind: 'finishing' }
    case 'question_requested':
      return { kind: 'awaiting' }
    case 'question_resolved':
    case 'todo_update':
    case 'steering_consumed':
    case 'tool_call_delta':
      return null
    default:
      return null
  }
}

function replaceActivity(state: JanusRuntimeState, activity: JanusToolActivity): JanusToolActivity[] {
  const previous = state.activities.find((item) => item.correlationId === activity.correlationId)
  return [
    ...state.activities.filter((item) => item.correlationId !== activity.correlationId),
    { ...previous, ...activity },
  ].slice(-8)
}

function activity(state: JanusRuntimeState, correlationId: string): JanusToolActivity | undefined {
  return state.activities.find((item) => item.correlationId === correlationId)
}

/** Reduces safe Chat Agent IPC events into the same cards used by Runtime tool events. */
export function reduceChatAgentEvent(state: JanusRuntimeState, event: ChatAgentEvent): JanusRuntimeState {
  if (event.type === 'agent_start') {
    return { ...state, todos: [], pendingQuestions: [] }
  }
  if (event.type === 'todo_update') {
    return { ...state, todos: event.todos }
  }
  if (event.type === 'question_requested') {
    const question: JanusPendingQuestion = {
      requestId: event.requestId,
      callId: event.callId,
      questions: event.questions,
      allowCustom: event.allowCustom,
    }
    return {
      ...state,
      pendingQuestions: [...state.pendingQuestions.filter((item) => item.callId !== event.callId), question],
    }
  }
  if (event.type === 'question_resolved') {
    const pendingQuestions = state.pendingQuestions.filter((item) => item.callId !== event.callId)
    if (pendingQuestions.length === state.pendingQuestions.length) return state
    return { ...state, pendingQuestions }
  }
  if (event.type === 'tool_call_start') {
    return {
      ...state,
      activities: replaceActivity(state, {
        correlationId: event.callId,
        toolName: event.toolName ?? activity(state, event.callId)?.toolName ?? 'tool',
        status: 'requested',
        summary: 'Preparing tool input',
        argumentChars: 0,
      }),
    }
  }
  if (event.type === 'tool_call_delta') {
    const current = activity(state, event.callId)
    const argumentChars = (current?.argumentChars ?? 0) + event.argumentDeltaLength
    return {
      ...state,
      activities: replaceActivity(state, {
        correlationId: event.callId,
        toolName: current?.toolName ?? 'tool',
        status: 'requested',
        summary: `Preparing tool input (${argumentChars} chars)`,
        argumentChars,
      }),
    }
  }
  if (event.type === 'tool_call_ready') {
    const argsDigest = event.argumentKeys.length ? event.argumentKeys.join(', ') : undefined
    return {
      ...state,
      activities: replaceActivity(state, {
        correlationId: event.callId,
        toolName: event.toolName,
        status: 'requested',
        summary: argsDigest ? `Input keys: ${argsDigest}` : 'Tool input ready',
        argsDigest,
      }),
    }
  }
  if (event.type === 'tool_execution_start' || event.type === 'tool_execution_update') {
    return {
      ...state,
      activities: replaceActivity(state, {
        correlationId: event.callId,
        toolName: event.toolName,
        status: 'running',
        summary: 'Executing',
      }),
    }
  }
  if (event.type === 'tool_execution_end') {
    return {
      ...state,
      activities: replaceActivity(state, {
        correlationId: event.callId,
        toolName: event.toolName,
        status: event.status,
        summary: event.status === 'completed' ? 'Completed' : 'Failed',
      }),
    }
  }
  return state
}

export function runtimeEventSessionId(event: AgentRuntimeEvent): string | null {
  if (event.parentSessionId) return event.parentSessionId
  if (event.type === 'session-created' || event.type === 'session-updated' || event.type === 'session-ended') return event.session.id
  if (event.type === 'approval-requested') return event.request.sessionId
  if (event.type === 'policy-decided') return event.decision.sessionId
  if ('sessionId' in event) return event.sessionId
  return event.result.sessionId
}

export function reduceJanusRuntimeState(state: JanusRuntimeState, event: AgentRuntimeEvent): JanusRuntimeState {
  if (event.type === 'session-created') return state
  if (event.type === 'session-updated') return state
  if (event.type === 'session-ended') return { ...state, pendingApprovals: [] }
  if (event.type === 'policy-decided') return state

  if (event.type === 'approval-requested') {
    return {
      ...state,
      activities: replaceActivity(state, {
        correlationId: event.request.correlationId,
        toolName: event.request.toolName,
        status: 'approval',
        summary: event.request.preview?.summary,
      }),
      pendingApprovals: [
        ...state.pendingApprovals.filter((item) => item.id !== event.request.id),
        event.request,
      ],
    }
  }

  if (event.type === 'tool-requested' || event.type === 'tool-started') {
    const correlationId = event.correlationId
    return {
      ...state,
      activities: replaceActivity(state, {
        correlationId,
        toolName: event.toolName,
        status: event.type === 'tool-started' ? 'running' : 'requested',
      }),
      pendingApprovals: state.pendingApprovals.filter((item) => item.correlationId !== correlationId),
    }
  }

  const status: JanusToolActivityStatus = event.type === 'tool-completed'
    ? 'completed'
    : event.type === 'tool-cancelled'
      ? 'cancelled'
      : 'failed'
  return {
    ...state,
    activities: replaceActivity(state, {
      correlationId: event.result.correlationId,
      toolName: event.result.toolName,
      status,
      summary: event.result.summary || event.result.error,
    }),
    pendingApprovals: state.pendingApprovals.filter((item) =>
      item.correlationId !== event.result.correlationId),
  }
}
