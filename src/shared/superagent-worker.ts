import type { ConversationSnapshot } from './conversation-display'
import type { SuperAgentInputReceipt, SuperAgentReport, SuperAgentSubmitInput, SuperAgentWork } from './superagent'
import type { SuperAgentGitOperation } from './superagent-environment'
import type { ConversationQuestionAnswer } from './conversation-questions'

export interface SuperAgentCommitRequest {
  id: string
  message: string
  paths: string[]
  head: string
  changes: Array<{ path: string; sha256: string; bytes: number; patch: string; truncated: boolean }>
  status: 'pending' | 'executing' | 'succeeded' | 'declined' | 'stale' | 'unknown'
  commit?: string
  error?: string
}

export interface SuperAgentWorkerSnapshot {
  workspaceId: string
  conversationId: string
  workId: string
  executionId: string
  instanceId: string
  phase: 'starting' | 'running' | 'waiting' | 'idle' | 'ready' | 'stopping' | 'stopped' | 'failed' | 'interrupted'
  conversation: ConversationSnapshot
  report?: SuperAgentReport
  commitRequest?: SuperAgentCommitRequest
  diagnostic?: string
  disabledExtensions: string[]
  stopConfirmed: boolean
  idleSince?: number
  retiredAt?: number
  restored?: boolean
  recovery?: 'resumed' | 'rebuilt'
}

export interface SuperAgentPreparedWork {
  receipt: SuperAgentInputReceipt
  work: SuperAgentWork
  operation?: SuperAgentGitOperation
}

export type SuperAgentWorkerControl = { workspaceId: string; workId: string; executionId: string } & (
  | { type: 'stop' }
  | { type: 'approve'; requestId: string | number; decision: string }
  | { type: 'answer'; requestId: string | number; version: number; answer: ConversationQuestionAnswer }
  | { type: 'commit'; requestId: string; approved: boolean }
)

export interface SuperAgentAppendInput extends SuperAgentSubmitInput { workId: string; executionId: string }
export interface SuperAgentContinueInput extends SuperAgentSubmitInput { workId: string }

export interface SuperAgentNativeLog { text: string; truncated: boolean; available: boolean }
