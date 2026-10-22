import type { ChatToolTraceEntry } from '../../../../shared/ipc/llm'
import type { KnowledgeRecallTrace } from '../../../../shared/knowledge'
import type { ProductFileEntry } from '../../../../shared/product'
import type { ChatModelOption, JanusResourceController, Message, UseJanusChatReturn } from './useJanusChat'

export type JanusIslandStage = 'collapsed' | 'peek' | 'expanded'
export type JanusExpandedView = 'monitor' | 'chat' | 'roundtable' | `extension:${string}/${string}`

export interface JanusIslandProps {
  stage?: JanusIslandStage
  onSingleActivate: () => void
  onDoubleActivate: () => void
  onDismiss: () => void
  messages: Message[]
  pendingContent: string
  isStreaming: boolean
  error: string | null
  modelOptions: ChatModelOption[]
  activeModel: ChatModelOption | null
  modelNotice: string | null
  onChatSelectModel: (providerId: string, modelId: string) => void
  onChatSend: (text: string) => void
  onChatRewrite: (messageId: string, text: string) => void
  onChatStop: () => void
  onChatRetry: () => void
  onChatClear: () => void
  conversationController?: UseJanusChatReturn | null
  resourceController: JanusResourceController
  toolTraces?: ChatToolTraceEntry[]
  knowledgeTrace?: KnowledgeRecallTrace | null
  knowledgePeekActive?: boolean
  knowledgePeekEmpty?: boolean
  productNotice?: (ProductFileEntry & { noticeKind?: 'added' | 'modified' }) | null
  productFiles?: ProductFileEntry[]
  onOpenProductFile?: (relPath: string) => void
  /** Fires when the expanded island window pin state changes (persistence owner). */
  onIslandPinnedChange?: (pinned: boolean) => void
}

export type JanusParticle = { id: number; left: number; size: number; duration: number }
