/**
 * @file JanusChat �?虚幻模糊风格的对话组�?
 * @description �?Janus 数字形象风格一致的对话界面
 */

import { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo, useId } from 'react'
import { createPortal } from 'react-dom'
import { ArrowDown, ArrowUp, Check, ChevronDown, CircleCheck, CircleX, Copy, LoaderCircle, PanelLeftClose, PanelLeftOpen, Pencil, Plus, RotateCcw, Send, ShieldX, Trash2, X } from 'lucide-react'
import { JanusIcon } from '../ui/JanusIcon'
import type { ChatModelOption, JanusResourceController, Message, UseJanusChatReturn } from './useJanusChat'
import type { ChatQuestionAnswer, ChatTodoItem, ChatToolTraceEntry } from '../../../../shared/ipc/llm'
import type { AgentApprovalMode } from '../../../../shared/ipc/agent-runtime'
import type { AgentResultCard } from '../../../../shared/roundtable/events'
import { AgentResultCard as AgentResultCardView } from './AgentResultCard'
import { useOptionalJanusChatController } from './JanusChatProvider'
import { MarkdownContent, StreamingText } from '../chat/ChatContent'
import { ChatErrorCard } from '../chat/ChatErrorCard'
import { useI18n } from '@/i18n/useI18n'
import { PromptDialog } from '../common/PromptDialog'
import { ToolCallGroup } from './ToolCallCard'
import { ThinkingRegion } from './ThinkingRegion'
import { VirtualHistory } from '../chat/VirtualHistory'
import { WorkerReportMessage } from './WorkerReportCard'
import { SuperAgentMessage } from './SuperAgentPresentation'
import { TranscriptNavigation } from './TranscriptNavigation'
import { useWorkerShortcuts } from './useWorkerShortcuts'
import { SuperAgentReply, messageRounds } from './SuperAgentReply'
import { ConversationInput, type ConversationInputHandle } from '../ConversationInput'
import { QuestionAnswerInput } from '../QuestionAnswerInput'
import { JanusContextComposer } from './JanusContextComposer'
import { useConversationContext } from '../../stores/conversation-context'
import { activeConversationReferences, conversationPrompt, referenceToken, type ConversationReference, type MessageContext } from '../../../../shared/conversation-context'
import { MessageContextChips } from './MessageContextChips'
import { ConversationPrompt } from '../ConversationPrompt'
import { WorkDisclosureScope } from '../chat/WorkDisclosure'
import { ChatTimeline, type ChatTimelineProps } from './ChatTimeline'
import type { ChatTimelineSnapshot } from '../../../../shared/chat-timeline'
import { NoteTimelineDetails } from '../note/NoteTimelineDetails'
import { formatThinkingDuration, type ReasoningSnapshot } from './janusReasoning'
import type { JanusChatStatus, JanusPendingQuestion } from './janusRuntimeState'
import { Select } from '../ui/Select'
import { ChatContextIndicator } from './ChatContextIndicator'
import { MemoPanel } from '../memo/MemoPanel'
import { useWorkspaceStore } from '@/stores/workspace'
import { useSuperAgentUIStore } from '@/stores/superagent-ui'
import { parseCompactCommand } from './janusChatConversations'
import { AgentModeSelect } from './AgentModeSelect'
import { useMemoStore } from '@/stores/memo'
import { useIslandStore } from '@/stores/island'
import nativeScrollbars from '../../styles/native-scrollbars.module.css'
import { ComposerOptions, ComposerOptionTrigger, composerOptionIndex, type ComposerChoice } from '../ComposerOptions'

type SelectionMenu = 'provider' | 'model' | 'permission'
type PermissionOption = { value: AgentApprovalMode; label: string }

interface ChatShortcutEvent {
  key: string
  altKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  isComposing: boolean
}

export function resolveChatSelectionShortcut(event: ChatShortcutEvent, showModelSelector = true): SelectionMenu | null {
  if (event.isComposing || event.altKey) return null
  if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'f') return 'permission'
  if (!showModelSelector) return null
  if (event.shiftKey) return null
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'p') return 'model'
  if (!event.ctrlKey && !event.metaKey && event.key === 'Tab') return 'provider'
  return null
}

function getProviderMenuOptions(options: ChatModelOption[]): ChatModelOption[] {
  return [...new Set(options.map((option) => option.providerId))]
    .map((providerId) => options.find((option) => option.providerId === providerId && option.isProviderDefault)
      ?? options.find((option) => option.providerId === providerId))
    .filter((option): option is ChatModelOption => option !== undefined)
}

function formatMessageTime(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(timestamp)
}

/* ════════════════════════════════════════════════════════════
   类型定义
   ════════════════════════════════════════════════════════════ */

/** §37.8: one host question bubble groups all currently open questions. */
export interface RoundtableHostQuestionBlock {
  roundNumber: number
  questions: Array<{ id: string; text: string }>
  answeredCount: number
  timestamp: number
}

interface JanusChatProps {
  workerShortcuts?: { workspaceId: string | null }
  superAgentTranscript?: boolean
  latestReplyId?: string
  contextComposer?: { id: string; workspacePath?: string }
  transcriptOnly?: boolean
  transcriptContent?: React.ReactNode
  /** 是否显示 */
  visible: boolean
  /** 停靠态：作为右侧 flex 列，而非绝对浮层 */
  docked?: boolean
  compactNavigation?: boolean
  /** Hosts such as SuperAgent own their context and omit manual navigation. */
  showConversationNavigation?: boolean
  showWorkspaceScope?: boolean
  showContextIndicator?: boolean
  /** Standard chat hosts that do not provide their own mode control. */
  showAgentMode?: boolean
  /** Shared Island/SuperAgent appearance based on the native conversation view. */
  conversationStyle?: boolean
  /** Embed only the discussion and composer (workspace scope stays in the main chat view). */
  discussionOnly?: boolean
  /**
   * V2 blueprint column: chipless composer matching design/blueprint-note-graph.html.
   * Hides the thread toolbar, resource scope, message edit actions, model
   * notice and the whole status bar; selection menus never open. Kept:
   * messages (author/time + thinking + tool cards), approval slot, todo strip,
   * question gates, composer (with › prefix + square orange send).
   */
  minimalComposer?: boolean
  /** Host-owned actions rendered after the discussion, inside its scroll area. */
  discussionFooter?: React.ReactNode
  /** Host-owned empty transcript state; falls back to the JANUSX banner. */
  emptyState?: React.ReactNode
  /** Host-owned evidence attached to an assistant turn; undefined is the live turn. */
  renderTurnFooter?: (turnId?: string, timeline?: ChatTimelineSnapshot) => React.ReactNode
  renderToolDetails?: ChatTimelineProps['renderToolDetails']
  /**
   * Host-owned actions pinned directly above the composer, outside the message
   * scroll area — for anything that must stay reachable while discussing.
   */
  aboveComposer?: React.ReactNode
  /** Keep the transcript mounted while a host document occupies its space. */
  messagesHidden?: boolean
  /** Only the focused presentation owns input focus and global shortcuts. */
  focused?: boolean
  /** 当前模式颜色 */
  modeColor: string
  /** 消息列表 */
  messages: Message[]
  /** Optional roundtable work cards rendered inline with the discussion. */
  roundtableCards?: AgentResultCard[]
  /**
   * §37.8: open member questions rendered as host text bubbles inside the
   * discussion stream, so questions stay visible without opening any card.
   */
  roundtableQuestions?: RoundtableHostQuestionBlock[]
  /** Roundtable-only composer hint, e.g. answering open questions. */
  inputPlaceholderOverride?: string
  /** §37.10: open the questions detail island from the flow bubble. */
  onOpenQuestions?: () => void
  onOpenAgentResult?: (card: AgentResultCard) => void
  /** 当前正在流式接收的内�?*/
  pendingContent: string
  /** 本轮流式推理快照（仅展示；默认取 conversationController，同 approvalMode 模式） */
  pendingReasoning?: ReasoningSnapshot | null
  /** 已提交消息的思维链快照（key 为消息 id；默认取 conversationController） */
  reasoningByTurn?: Record<string, ReasoningSnapshot> | null
  /** 是否正在流式输出 */
  isStreaming: boolean
  /** 本轮开始时间（默认取 conversationController；agentX Activity parity）。 */
  turnStartedAt?: number | null
  /** 本轮状态（默认取 conversationController；agentX store.ts parity）。 */
  turnStatus?: JanusChatStatus | null
  /** 错误信息 */
  error: string | null
  modelOptions?: ChatModelOption[]
  /** Settings-owned surfaces hide both model/provider menus and their shortcuts. */
  showModelSelector?: boolean
  activeModel?: ChatModelOption | null
  modelNotice?: string | null
  resourceController?: JanusResourceController
  toolTraces?: ChatToolTraceEntry[]
  conversationController?: UseJanusChatReturn | null
  onSelectModel?: (providerId: string, modelId: string) => void
  /** 发送一条用户消息 */
  onSend: (text: string, context?: MessageContext) => void | Promise<void>
  /** 重写历史用户消息并从该轮重新生成 */
  onRewrite: (messageId: string, text: string) => void
  /** 停止当前流式输出 */
  onStop: () => void
  /** 重试最后一条用户消�?*/
  onRetry: () => void
  /** 清空对话 */
  onClear: () => void
  approvalMode?: AgentApprovalMode
  onApprovalModeChange?: (mode: AgentApprovalMode) => void
  /** Latest agent todo snapshot (defaults to conversationController). */
  todos?: ChatTodoItem[] | null
  /** Open mid-turn questions (defaults to conversationController). */
  pendingQuestions?: JanusPendingQuestion[] | null
  /** Answer one pending mid-turn question (defaults to conversationController). */
  onAnswerQuestion?: ((callId: string, answer: ChatQuestionAnswer) => void | Promise<void>) | null
}

/* ════════════════════════════════════════════════════════════
   Markdown 渲染组件（内联代�?+ 代码块复制）
   ════════════════════════════════════════════════════════════ */

function StopIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="6" y="6" width="12" height="12" rx="1.5" />
    </svg>
  )
}

const PIXEL_WORDMARK = {
  J: ['0011', '0001', '0001', '1001', '0110'],
  A: ['0110', '1001', '1111', '1001', '1001'],
  N: ['1001', '1101', '1011', '1001', '1001'],
  U: ['1001', '1001', '1001', '1001', '0110'],
  S: ['0111', '1000', '0110', '0001', '1110'],
  X: ['10002', '01020', '00100', '02010', '20001'],
} as const

function PixelChar({ pattern, isX = false }: { pattern: readonly string[]; isX?: boolean }) {
  return (
    <span
      className={`janus-chat-pixel-char${isX ? ' janus-chat-pixel-char--x' : ''}`}
      data-cells={pattern[0]?.length ?? 4}
      aria-hidden="true"
    >
      {pattern.flatMap((row, rowIndex) =>
        [...row].map((cell, cellIndex) => {
          const className =
            cell === '0'
              ? ''
              : isX && cell === '1'
                ? 'x-orange'
                : isX && cell === '2'
                  ? 'x-gray'
                  : 'active'
          return <span key={`${rowIndex}-${cellIndex}`} className={className} />
        })
      )}
    </span>
  )
}

function JanusXTerminalBanner() {
  return (
    <div className="janus-chat-terminal-banner" role="img" aria-label="JanusX">
      <div className="janus-chat-terminal-logo">
        <PixelChar pattern={PIXEL_WORDMARK.J} />
        <PixelChar pattern={PIXEL_WORDMARK.A} />
        <PixelChar pattern={PIXEL_WORDMARK.N} />
        <PixelChar pattern={PIXEL_WORDMARK.U} />
        <PixelChar pattern={PIXEL_WORDMARK.S} />
        <PixelChar pattern={PIXEL_WORDMARK.X} isX />
      </div>
    </div>
  )
}

/* ════════════════════════════════════════════════════════════
   Agent todo strip + mid-turn question gate (janus-agent parity)
   ════════════════════════════════════════════════════════════ */

function TodoStrip({ todos }: { todos: ChatTodoItem[] }) {
  const { t } = useI18n('janus')
  if (todos.length === 0) return null
  const done = todos.filter((todo) => todo.status === 'completed').length
  const current = todos.find((todo) => todo.status === 'in_progress')
  return (
    <div className="janus-todo-strip" role="status" aria-label={t('janus:chat.todo.aria')}>
      <span className="janus-todo-summary">{t('janus:chat.todo.summary', { done, total: todos.length })}</span>
      {current && <span className="janus-todo-current">{t('janus:chat.todo.current', { content: current.content })}</span>}
      <ul className="janus-todo-list">
        {todos.slice(-8).map((todo, index) => (
          <li key={`${todo.content}-${index}`} data-status={todo.status}>
            <span aria-hidden="true">
              {todo.status === 'completed' ? '●' : todo.status === 'in_progress' ? '◐' : todo.status === 'cancelled' ? '✕' : '○'}
            </span>
            <span>{todo.content}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function QuestionGate({ gate, onAnswer }: { gate: JanusPendingQuestion; onAnswer: (answer: ChatQuestionAnswer) => void | Promise<void> }) {
  const { t } = useI18n('janus')
  const [selected, setSelected] = useState<Record<number, string[]>>({})
  const [custom, setCustom] = useState<Record<number, string>>({})
  const [deferred, setDeferred] = useState(false)
  const [sending, setSending] = useState(false)
  const [composing, setComposing] = useState(false)
  const [answerError, setAnswerError] = useState('')
  const submitting = useRef(false)
  const deliver = async (answer: ChatQuestionAnswer) => {
    if (submitting.current) return
    submitting.current = true; setSending(true); setAnswerError('')
    try { await onAnswer(answer) } catch (error) {
      submitting.current = false; setSending(false); setAnswerError(String(error))
    }
  }

  const toggleOption = (questionIndex: number, label: string, multiple: boolean) => {
    setSelected((current) => {
      const previous = current[questionIndex] ?? []
      const next = previous.includes(label)
        ? previous.filter((item) => item !== label)
        : multiple ? [...previous, label] : [label]
      return { ...current, [questionIndex]: next }
    })
  }

  const submittable = gate.questions.every((_question, index) => {
    if ((selected[index] ?? []).length > 0) return true
    return gate.allowCustom && (custom[index] ?? '').trim().length > 0
  })

  const submit = () => {
    if (!submittable || sending || composing) return
    void deliver({
      status: 'answered',
      answers: gate.questions.map((question, index) => {
        const customText = (custom[index] ?? '').trim()
        return {
          header: question.header,
          selected: selected[index] ?? [],
          ...(customText ? { custom: customText } : {}),
        }
      }),
    })
  }

  return (
    <div className="janus-question-gate" role="region" aria-label={t('janus:chat.question.regionAria')}>
      <div className="janus-question-gate-heading">
        <strong>{t('janus:chat.question.heading')}</strong>
        <button type="button" onClick={() => setDeferred(!deferred)}>{t(deferred ? 'janus:topics.answerNow' : 'janus:topics.defer')}</button>
      </div>
      <div hidden={deferred}>
      {gate.questions.map((question, questionIndex) => (
        <fieldset key={`${question.header}-${questionIndex}`} className="janus-question-item" disabled={sending}>
          <legend>
            <strong>{question.header}</strong>
            <span>{question.question}</span>
          </legend>
          {question.options.map((option) => {
            const picked = (selected[questionIndex] ?? []).includes(option.label)
            return (
              <label key={option.label} className="janus-question-option" data-picked={picked}>
                <input
                  type={question.multiple ? 'checkbox' : 'radio'}
                  name={`janus-question-${gate.callId}-${questionIndex}`}
                  checked={picked}
                  onChange={() => toggleOption(questionIndex, option.label, question.multiple)}
                />
                <span className="janus-question-option-label">{option.label}</span>
                {option.description && <span className="janus-question-option-desc">{option.description}</span>}
              </label>
            )
          })}
          {gate.allowCustom && (
            <QuestionAnswerInput
              className="janus-question-custom"
              value={custom[questionIndex] ?? ''}
              placeholder={t('janus:chat.question.customPlaceholder')}
              label={t('janus:chat.question.customAria', { header: question.header })}
              disabled={sending} onComposingChange={setComposing} onSubmit={submit}
              onChange={text => setCustom(current => ({ ...current, [questionIndex]: text }))}
            />
          )}
        </fieldset>
      ))}
      <div className="janus-question-gate-actions">
        <button type="button" className="janus-question-cancel" disabled={sending} onClick={() => void deliver({ status: 'cancelled' })}>
          {t('janus:chat.question.cancel')}
        </button>
        <button type="button" className="janus-question-submit" disabled={!submittable || sending || composing} onClick={submit}>
          {t(sending ? 'janus:topics.submitted' : 'janus:chat.question.submit')}
        </button>
      </div>
      </div>
      {answerError && <p role="alert">{answerError}</p>}
    </div>
  )
}

/* ════════════════════════════════════════════════════════════
   agentX Activity parity：流式状态行（状态文案 + 实时耗时）
   ════════════════════════════════════════════════════════════ */

function TurnStatusRow({ status, startedAt }: { status: JanusChatStatus; startedAt: number | null }) {
  const { t } = useI18n('janus')
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 250)
    return () => window.clearInterval(timer)
  }, [startedAt])
  const elapsed = typeof startedAt === 'number' ? formatThinkingDuration(Math.max(0, now - startedAt)) : null
  const text = status.kind === 'running' && status.toolName
    ? t('janus:chat.turnStatus.running', { tool: status.toolName })
    : status.kind === 'connecting' ? t('janus:chat.turnStatus.connecting') : status.kind === 'thinking'
      ? t('janus:chat.turnStatus.thinking')
      : status.kind === 'writing'
        ? t('janus:chat.turnStatus.writing')
        : status.kind === 'preparing'
          ? t('janus:chat.turnStatus.preparing')
          : status.kind === 'awaiting'
            ? t('janus:chat.turnStatus.awaiting')
            : t('janus:chat.turnStatus.finishing')
  return (
    <div className="janus-chat-turn-status" role="status" aria-live="polite">
      <LoaderCircle size={11} className="janus-runtime-tool-spinner" aria-hidden="true" />
      <span>{text}</span>
      {elapsed && <span className="janus-chat-turn-elapsed">· {elapsed}</span>}
    </div>
  )
}

/* ════════════════════════════════════════════════════════════
   JanusChat 组件
   ════════════════════════════════════════════════════════════ */

const EMPTY_REASONING_SNAPSHOT: ReasoningSnapshot = { text: '', chars: 0, truncated: false }
const EMPTY_REASONING_BY_TURN: Record<string, ReasoningSnapshot> = {}
const FALLBACK_TURN_STATUS: JanusChatStatus = { kind: 'connecting' }
const CHAT_SIDEBAR_STORAGE_KEY = 'janus:chat-sidebar-collapsed'
const EMPTY_REFERENCES: ConversationReference[] = []

export function JanusChat({
  superAgentTranscript = false,
  latestReplyId,
  contextComposer,
  visible,
  docked = false,
  compactNavigation = false,
  showConversationNavigation = true,
  showWorkspaceScope = true,
  showContextIndicator = true,
  showAgentMode = false,
  conversationStyle = false,
  discussionOnly = false,
  minimalComposer = false,
  discussionFooter,
  transcriptOnly = false,
  transcriptContent,
  workerShortcuts,
  emptyState,
  renderTurnFooter,
  renderToolDetails = block => <NoteTimelineDetails block={block} />,
  aboveComposer,
  messagesHidden = false,
  focused = true,
  modeColor,
  messages,
  pendingContent,
  pendingReasoning: pendingReasoningProp = null,
  reasoningByTurn: reasoningByTurnProp = null,
  isStreaming,
  turnStartedAt: turnStartedAtProp = null,
  turnStatus: turnStatusProp = null,
  error,
  modelOptions = [],
  showModelSelector = true,
  activeModel = null,
  modelNotice = null,
  roundtableCards = [],
  roundtableQuestions = [],
  inputPlaceholderOverride,
  onOpenQuestions,
  onOpenAgentResult,
  resourceController,
  toolTraces = [],
  conversationController: controllerOverride = null,
  onSelectModel = () => {},
  onSend,
  onRewrite,
  onStop,
  onRetry,
  onClear,
  approvalMode,
  onApprovalModeChange,
  todos: todosProp = null,
  pendingQuestions: pendingQuestionsProp = null,
  onAnswerQuestion: onAnswerQuestionProp = null,
}: JanusChatProps) {
  const { t } = useI18n('janus')
  const memoTitle = (memoId: string) => useMemoStore.getState().memos.find(memo => memo.id === memoId)?.title
  const [input, setInput] = useState('')
  const chatRequest = useIslandStore(state => state.chatRequest)
  useEffect(() => {
    if (transcriptOnly || !chatRequest || !visible) return
    if (chatRequest.prefill) setInput(chatRequest.prefill)
    useIslandStore.getState().consumeChat(chatRequest.sequence)
  }, [chatRequest, visible, transcriptOnly])
  const [historyPageSize, setHistoryPageSize] = useState(100)
  const historyEntries = useMemo(() => [...messages.slice(-historyPageSize).map((msg) => ({ kind: 'message' as const, timestamp: msg.timestamp, msg })), ...roundtableCards.map((card) => ({ kind: 'card' as const, timestamp: Date.parse(card.updatedAt || card.createdAt) || 0, card })), ...roundtableQuestions.map((block) => ({ kind: 'questions' as const, timestamp: block.timestamp, block}))]
          .sort((a, b) => transcriptOnly ? 0 : a.timestamp - b.timestamp), [messages, historyPageSize, roundtableCards, roundtableQuestions, transcriptOnly])

  // Composer auto-grows from content (including soft-wrapped long lines) up to
  // MAX_COMPOSER_HEIGHT, then scrolls internally. Counting '\n' is not enough:
  // a single long line without newlines would stay one row high and overflow.
  const [showNewMessageBadge, setShowNewMessageBadge] = useState(false)
  const [showLatest, setShowLatest] = useState(false)
  const [selectionMenu, setSelectionMenu] = useState<SelectionMenu | null>(null)
  const [menuIndex, setMenuIndex] = useState(0)
  const [menuSearch, setMenuSearch] = useState(''), [menuProvider, setMenuProvider] = useState('')
  const menuId = useId()
  const modelButtonRef = useRef<HTMLButtonElement>(null)
  const [historyIndex, setHistoryIndex] = useState<number | null>(null)
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null)
  const [editingContent, setEditingContent] = useState('')
  const [threadMenuOpen, setThreadMenuOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem(CHAT_SIDEBAR_STORAGE_KEY) === '1'
    } catch {
      return false
    }
  })
  const [renamingConversationId, setRenamingConversationId] = useState<string | null>(null)
  const [renamingTitle, setRenamingTitle] = useState('')
  const [pendingDeleteConversation, setPendingDeleteConversation] = useState<{ id: string; title: string } | null>(null)
  const [isRestoringScroll, setIsRestoringScroll] = useState(true)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const transcriptContentRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const richInputRef = useRef<ConversationInputHandle>(null)
  const shortcuts = useWorkerShortcuts(workerShortcuts, input, setInput, richInputRef)
  const [sendingShortcut, setSendingShortcut] = useState(false)
  const shortcutSendRef = useRef(false)
  const composerInput = contextComposer ? richInputRef : inputRef
  const references = useConversationContext(state => contextComposer ? state.entries[contextComposer.id] : undefined) ?? EMPTY_REFERENCES
  const [contextImporting, setContextImporting] = useState(false)
  const editInputRef = useRef<HTMLTextAreaElement>(null)
  const chatRootRef = useRef<HTMLDivElement>(null)
  const threadSelectorRef = useRef<HTMLDivElement>(null)
  const selectionMenuRef = useRef<HTMLDivElement>(null)
  const isAtBottomRef = useRef(true)
  // Roundtable-only: timestamp of the last send, used to anchor the viewport
  // on the user's own message instead of the bottom working cards.
  const pendingUserAnchorTimeRef = useRef<number | null>(null)
  // A chat pane can stay mounted while hidden by the roundtable view.  The
  // first layout after it becomes visible must land at the latest message
  // immediately; otherwise the normal smooth-scroll effect animates the
  // entire history from the top of the newly laid out container.
  const immediateScrollRef = useRef(true)
  // Start hidden so a freshly mounted, visible Chat is treated as an
  // activation as well. Chat is conditionally mounted alongside Roundtable.
  const previousVisibleRef = useRef(false)
  const previousMessageCountRef = useRef(messages.length)
  const historyDraftRef = useRef('')
  const contextConversations = useOptionalJanusChatController()
  const conversations = controllerOverride ?? contextConversations
  const explicitSuperAgent = useSuperAgentUIStore(state => !!workerShortcuts || (showAgentMode && state.agentMode === 'superagent'))
  const availabilityCheck = useRef<symbol | null>(null)
  const [unavailable, setUnavailable] = useState(false)
  // A late availability reply belongs to the draft and destination that requested it.
  useLayoutEffect(() => {
    setUnavailable(false)
    return () => { availabilityCheck.current = null }
  }, [explicitSuperAgent, input, visible, conversations?.conversationId, contextComposer?.id, inputPlaceholderOverride, shortcuts.selected, references, isStreaming])
  const rounds = useMemo(() => messageRounds(messages), [messages])
  const pendingRound = superAgentTranscript ? [...rounds.values()].at(-1) : undefined
  const activeApprovalMode = approvalMode ?? conversations?.approvalMode ?? 'per-action'
  const activeTimeline = conversations?.pendingTimeline
  const activePendingReasoning = pendingReasoningProp ?? conversations?.pendingReasoning ?? EMPTY_REASONING_SNAPSHOT
  const activeReasoningByTurn = reasoningByTurnProp ?? conversations?.reasoningByTurn ?? EMPTY_REASONING_BY_TURN
  const activeTurnStartedAt = turnStartedAtProp ?? conversations?.turnStartedAt ?? null
  const activeTurnStatus = turnStatusProp ?? conversations?.turnStatus ?? FALLBACK_TURN_STATUS
  // R6-full：在途 steering 以消息内徽标呈现（文本已乐观进历史）；无 controller
  // 的展示路径（圆桌中央等）没有在途集合，不渲染徽标。
  const pendingSteerIds = conversations?.pendingSteerIds ?? []
  const cancelSteeredMessage = conversations?.cancelSteeredMessage
  const activeTodos = todosProp ?? conversations?.todos ?? []
  const activePendingQuestions = pendingQuestionsProp ?? conversations?.pendingQuestions ?? []
  const answerQuestion = onAnswerQuestionProp ?? conversations?.answerQuestion

  const toggleSidebarCollapsed = useCallback(() => {
    setSidebarCollapsed((current) => {
      const next = !current
      try {
        window.localStorage.setItem(CHAT_SIDEBAR_STORAGE_KEY, next ? '1' : '0')
      } catch {
        /* persistence is best-effort */
      }
      return next
    })
  }, [])

  const showConversationSidebar = showConversationNavigation && !!docked && !!conversations && !discussionOnly && !compactNavigation
  const copyMessage = useCallback((content: string) => {
    if (!navigator.clipboard) return
    void navigator.clipboard.writeText(content).catch(() => undefined)
  }, [])

  const inputHistory = messages
    .filter((message) => message.role === 'user')
    .map((message) => message.content)
  const providerOptions = getProviderMenuOptions(modelOptions)
  const activeProviderModels = activeModel && !contextComposer
    ? modelOptions.filter((option) => option.providerId === activeModel.providerId)
    : modelOptions
  const permissionOptions = useMemo<PermissionOption[]>(() => [
    { value: 'per-action', label: t('janus:chat.permission.perAction') },
    { value: 'auto-run', label: t('janus:chat.permission.autoRun') },
    { value: 'plan', label: t('janus:chat.permission.plan') },
  ], [t])
  const menuProviders = [...new Map(activeProviderModels.map(option => [option.providerId, {id:option.providerId,name:option.providerName}])).values()]
  const menuOptions = (selectionMenu === 'provider' ? providerOptions : activeProviderModels).filter(option =>
    (!contextComposer || selectionMenu !== 'model' || !menuProvider || option.providerId === menuProvider)
    && `${option.modelId} ${option.providerName}`.toLowerCase().includes(menuSearch.toLowerCase()))
  const workspaceNames = new Map((resourceController?.resources ?? []).map((resource) => [resource.workspaceId, resource.workspaceName]))
  const attachedWorkspaceIds = new Set(resourceController?.resources.map((resource) => resource.workspaceId) ?? [])
  const attachableWorkspaces = resourceController?.availableWorkspaces.filter((workspace) =>
    !attachedWorkspaceIds.has(workspace.id)) ?? []
  const attachableWorkspaceOptions = [
    ...attachableWorkspaces.filter((workspace) => !workspace.sidebarGroup).map((workspace) => ({
      value: workspace.id,
      label: workspace.name,
    })),
    ...Array.from(new Map(attachableWorkspaces.filter((workspace) => workspace.sidebarGroup).map((workspace) => [workspace.sidebarGroup!.id, workspace.sidebarGroup!])).values())
      .flatMap((group) => [
        { value: `group:${group.id}`, label: group.name, depth: 0, disabled: true },
        ...attachableWorkspaces.filter((workspace) => workspace.sidebarGroup?.id === group.id).map((workspace) => ({
          value: workspace.id,
          label: workspace.name,
          depth: 1,
        })),
      ]),
  ]
  const lastAssistantMessageId = [...messages].reverse().find((message) => message.role === 'assistant')?.id
  const committedCalls = new Set(messages.flatMap(message => message.timeline?.blocks.flatMap(block => block.kind === 'tool' ? [block.callId] : []) ?? []))
  const liveToolTraces: ChatToolTraceEntry[] = (resourceController?.activities ?? [])
    .filter(activity => !committedCalls.has(activity.correlationId))
    .map((activity) => ({
      callId: activity.correlationId,
      toolName: activity.toolName,
      workspaceId: '',
      status: activity.status,
      summary: activity.summary ?? activity.toolName,
      argsDigest: activity.argsDigest,
      resultDigest: activity.resultDigest,
      errorDetail: activity.errorDetail,
      turnId: 'live',
    }))

  // 聚焦定时器句柄，effect 清理时清除，避免视图可见性变化打断流
  const focusTimerRef = useRef<number | null>(null)

  // 滚动到底�?
  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    const container = messagesContainerRef.current
    if (!container || transcriptOnly) return
    container.dispatchEvent(new Event('janus:cancel-location'))
    if (behavior === 'auto') {
      // Bypass CSS scroll-behavior so history hydration never animates.
      container.scrollTop = container.scrollHeight
      return
    }
    container.scrollTo({ top: container.scrollHeight, behavior })
  }, [transcriptOnly])

  // 监听滚动，判断用户是否在底部
  const handleScroll = useCallback(() => {
    const container = messagesContainerRef.current
    if (!container) return
    if (container.dataset.transcriptView==='panes') return
    const threshold = 20
    const atBottom = container.scrollHeight - container.scrollTop - container.clientHeight <= threshold
    isAtBottomRef.current = atBottom
    setShowLatest(!atBottom)
    if (atBottom) {
      setShowNewMessageBadge(false)
    }
  }, [])

  // Topic transcripts grow independently of the outer chat's message array.
  // Observe their layout, following only while the reader remains at the end.
  const hasTranscriptContent = transcriptContent != null
  useEffect(()=>{
    const container=messagesContainerRef.current
    if(!hasTranscriptContent||!container)return
    const change=(event:Event)=>{
      container.dataset.transcriptView=(event as CustomEvent<{view:string}>).detail.view
      isAtBottomRef.current=false
      setShowLatest(false);setShowNewMessageBadge(false)
    }
    container.addEventListener('janus:transcript-view',change)
    return()=>{container.removeEventListener('janus:transcript-view',change);delete container.dataset.transcriptView}
  },[hasTranscriptContent])
  useLayoutEffect(() => {
    const content = transcriptContentRef.current, container = messagesContainerRef.current
    if (!visible || !hasTranscriptContent || !content || !container) return
    const observer = new ResizeObserver(() => {
      if(container.dataset.transcriptView==='panes')return
      if (isAtBottomRef.current) container.scrollTop = container.scrollHeight
      handleScroll()
    })
    observer.observe(content)
    observer.observe(container)
    return () => observer.disconnect()
  }, [visible, hasTranscriptContent, handleScroll])

  useLayoutEffect(() => {
    const becameVisible = visible && !previousVisibleRef.current
    previousVisibleRef.current = visible
    if (!becameVisible) return

    immediateScrollRef.current = true
    const container = messagesContainerRef.current
    if (container) container.scrollTop = container.scrollHeight
    isAtBottomRef.current = true
    setShowLatest(false)
    setShowNewMessageBadge(false)
    setIsRestoringScroll(true)
    const frame = window.requestAnimationFrame(() => {
      const current = messagesContainerRef.current
      if (current) current.scrollTop = current.scrollHeight
      setIsRestoringScroll(false)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [visible])

  // 消息/流式内容/圆桌卡片变化时自动滚动（仅当用户已在底部）。
  // 注意依赖的是内容签名而不是数组身份：上层（如圆桌）每 render 都可能
  // 重建数组，旧写法会在每次渲染都触发滚动/提示，造成底部持续被拽走或
  // 误弹“新信息”。卡片必须纳入签名，否则圆桌结果到达时既不跟随也不提示。
  const lastMessage = messages[messages.length - 1]
  const contentSignature = `${messages.length}|${lastMessage?.id ?? ''}|${lastMessage?.timestamp ?? 0}|${pendingContent?.length ?? 0}|${activePendingReasoning.text.length}|${activeTimeline?.blocks.map(block => block.kind === 'tool' ? `${block.id}:${block.entry.status}:${block.details?.length}` : `${block.id}:${block.chars}:${block.endedAt}`).join('|') ?? ''}|s${pendingSteerIds.join(',')}`
  const cardsSignature = roundtableCards.map((card) => `${card.id}@${card.updatedAt || card.createdAt}`).join('|')
  const questionsSignature = roundtableQuestions.map((block) => `r${block.roundNumber}@${block.timestamp}#${block.questions.map((item) => item.id).join(',')}`).join('|')
  useLayoutEffect(() => {
    if (isAtBottomRef.current) {
      // Conversation history may hydrate after the pane mounts. Treat the
      // empty -> populated transition like initial layout so it never plays
      // a long smooth-scroll animation through persisted messages.
      const hydratedHistory = previousMessageCountRef.current === 0 && messages.length > 0
      const behavior = immediateScrollRef.current || hydratedHistory || pendingContent ? 'auto' : 'smooth'
      immediateScrollRef.current = false
      scrollToBottom(behavior)
    } else {
      setShowNewMessageBadge(true)
    }
    previousMessageCountRef.current = messages.length
    // messages.length / pendingContent / reasoning length are encoded in
    // contentSignature; they are listed explicitly to satisfy exhaustive-deps (no extra runs).
  }, [contentSignature, cardsSignature, questionsSignature, messages.length, pendingContent, activePendingReasoning.text.length, scrollToBottom])

  // Roundtable-only: after sending, land on the user's own message. Working
  // cards carry fresh timestamps and would otherwise pin the viewport below
  // the message the user just sent. Later arrivals then show the new-message
  // badge instead of yanking the viewport.
  useLayoutEffect(() => {
    if (!discussionOnly || pendingUserAnchorTimeRef.current == null) return
    const since = pendingUserAnchorTimeRef.current
    pendingUserAnchorTimeRef.current = null
    const container = messagesContainerRef.current
    if (!container) return
    const nodes = container.querySelectorAll('.janus-chat-message.user')
    for (const node of Array.from(nodes)) {
      const stamp = node.querySelector('time')?.getAttribute('dateTime')
      const ts = stamp ? Date.parse(stamp) : NaN
      if (Number.isNaN(ts) || ts < since - 1000) continue
      const top = (node as HTMLElement).getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop
      container.scrollTop = Math.max(0, top - 8)
      isAtBottomRef.current = false
      break
    }
  }, [messages, discussionOnly])

  // 聚焦输入框；流的实际生命周期�?useJanusChat 持有，视图可见性变化不�?abort �?
  useEffect(() => {
    if (visible && focused) {
      chatRootRef.current?.focus({ preventScroll: true })
      focusTimerRef.current = window.setTimeout(() => {
        const inputElement = composerInput.current
        // Respect focus moved to a companion control or dialog during the opening delay.
        if (inputElement && !('disabled' in inputElement && inputElement.disabled) && document.activeElement === chatRootRef.current) inputElement.focus()
      }, 100)
    }
    return () => {
      if (focusTimerRef.current !== null) {
        window.clearTimeout(focusTimerRef.current)
        focusTimerRef.current = null
      }
    }
  }, [focused, visible, composerInput])

  // 发送消息（支持重试传入指定文本�?
  const MAX_COMPOSER_HEIGHT = 150
  const autoGrowComposer = useCallback(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, MAX_COMPOSER_HEIGHT)}px`
  }, [])

  // Grow/shrink on every value change (covers typing, history recall, send,
  // clear). Runs in layout phase so no overflow flash is painted.
  useLayoutEffect(() => {
    if (!visible) return
    autoGrowComposer()
  }, [autoGrowComposer, input, visible])

  // The Island shell animates width 52px -> ~880px and height 26px -> ~560px
  // for ~0.38s after expand, and the composer mounts on the same commit when
  // reopening directly into the chat view. Measuring scrollHeight mid-transition
  // over-estimates soft-wrapped lines (or the zero-height flex artifact for an
  // empty box) and then ratchets: scrollHeight >= clientHeight keeps returning
  // the clamped 150px on later reads. Re-measure once the transition settles
  // and whenever the composer width changes, so no tab switch is needed.
  useLayoutEffect(() => {
    if (!visible) return
    const el = inputRef.current
    if (!el) return
    let disposed = false
    const regrow = () => {
      if (!disposed) autoGrowComposer()
    }
    const frame = window.requestAnimationFrame(regrow)
    // Longest island transition is 0.38s height + 0.16s visibility delay.
    const timer = window.setTimeout(regrow, 450)
    let lastWidth = el.clientWidth
    let observer: ResizeObserver | null = null
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => {
        const width = el.clientWidth
        if (Math.abs(width - lastWidth) >= 1) {
          lastWidth = width
          regrow()
        }
      })
      observer.observe(el)
    }
    return () => {
      disposed = true
      window.cancelAnimationFrame(frame)
      window.clearTimeout(timer)
      observer?.disconnect()
    }
  }, [autoGrowComposer, visible])

  const handleSend = useCallback(
    async (textOverride?: string) => {
      const text = (textOverride ?? input).trim()
      // R6-lite：流式中发送由 hook 路由进排队（自然结束边界自动发出），此处不再拦截。
      if (!text || contextImporting || shortcutSendRef.current) return

      if (explicitSuperAgent && (workerShortcuts || (!isStreaming && !parseCompactCommand(text)))) {
        if (availabilityCheck.current) return
        const workspaceId = useWorkspaceStore.getState().activeWorkspaceId
        const check = Symbol()
        availabilityCheck.current = check
        let available = false
        try { available = await window.electron?.superAgent?.available() === true }
        catch { /* A disconnected host cannot accept this input. */ }
        if (availabilityCheck.current !== check) return
        availabilityCheck.current = null
        if (workspaceId !== useWorkspaceStore.getState().activeWorkspaceId) return
        setUnavailable(!available)
        if (!available) return
      }
      setInput('')
      setHistoryIndex(null)
      historyDraftRef.current = ''
      setShowNewMessageBadge(false)
      if (discussionOnly) {
        // The anchor effect positions the viewport on the sent message after
        // render; pre-scrolling to the bottom would flash the working cards.
        pendingUserAnchorTimeRef.current = Date.now()
      } else {
        isAtBottomRef.current = true
        scrollToBottom('auto')
      }
      const restore = () => setInput(current => current ? `${text}\n\n${current}` : text)
      const activeRefs = contextComposer ? activeConversationReferences(text, references) : []
      const prompt = contextComposer ? conversationPrompt(text, activeRefs) : text
      const context = activeRefs.length || shortcuts.selected ? { text:activeRefs.reduce((plain, ref) => plain.replaceAll(referenceToken(ref), ''),text).trim(), references:activeRefs.map(ref => ({...ref})), worker: shortcuts.selected } : undefined
      if (shortcuts.selected) { shortcutSendRef.current = true; setSendingShortcut(true) }
      try { void Promise.resolve(onSend(prompt, context)).then(() => { if (shortcuts.selected) shortcuts.clear() }).catch(restore)
        .finally(() => { if (shortcuts.selected) { shortcutSendRef.current = false; setSendingShortcut(false) } })
      } catch { restore(); if (shortcuts.selected) { shortcutSendRef.current = false; setSendingShortcut(false) } }
    },
    [input, onSend, scrollToBottom, discussionOnly, contextImporting, contextComposer, references, shortcuts, explicitSuperAgent, workerShortcuts, isStreaming]
  )

  // 输入变化；高度由上面的 auto-grow effect 按 scrollHeight 调整，
  // Shift+Enter 换行、长文本软换行都会长高，到上限后内部滚动。
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value)
    setHistoryIndex(null)
  }, [])

  const openSelectionMenu = useCallback((menu: SelectionMenu) => {
    if (minimalComposer || (!showModelSelector && menu !== 'permission')) return
    setMenuSearch(''); setMenuProvider('')
    if (menu === 'permission') {
      const activeIndex = permissionOptions.findIndex((option) => option.value === activeApprovalMode)
      setSelectionMenu(menu)
      setMenuIndex(activeIndex >= 0 ? activeIndex : 0)
      window.requestAnimationFrame(() => composerInput.current?.focus())
      return
    }
    const options = menu === 'provider'
      ? getProviderMenuOptions(modelOptions)
      : activeModel && !contextComposer
        ? modelOptions.filter((option) => option.providerId === activeModel.providerId)
        : modelOptions
    const activeIndex = options.findIndex((option) => menu === 'provider'
      ? option.providerId === activeModel?.providerId
      : option.providerId === activeModel?.providerId && option.modelId === activeModel?.modelId)
    setSelectionMenu(menu)
    setMenuIndex(activeIndex >= 0 ? activeIndex : 0)
    window.requestAnimationFrame(() => selectionMenuRef.current?.querySelector('input')?.focus())
  }, [activeApprovalMode, activeModel, minimalComposer, modelOptions, permissionOptions, showModelSelector, composerInput, contextComposer])

  const selectMenuOption = useCallback((option: ChatModelOption | { value: AgentApprovalMode; label: string }) => {
    if (selectionMenu === 'permission') {
      const nextMode = (option as PermissionOption).value
      // Some Chat hosts provide the controller but omit the legacy callback;
      // use the controller as the canonical permission-mode update path.
      const updateApprovalMode = onApprovalModeChange ?? conversations?.setApprovalMode
      updateApprovalMode?.(nextMode)
    } else if (selectionMenu === 'provider') {
      const modelOption = option as ChatModelOption
      const providerModel = modelOptions.find((candidate) =>
        candidate.providerId === modelOption.providerId && candidate.isProviderDefault)
        ?? modelOptions.find((candidate) => candidate.providerId === modelOption.providerId)
      if (providerModel) onSelectModel(providerModel.providerId, providerModel.modelId)
    } else {
      const modelOption = option as ChatModelOption
      onSelectModel(modelOption.providerId, modelOption.modelId)
    }
    setSelectionMenu(null)
    window.requestAnimationFrame(() => composerInput.current?.focus())
  }, [conversations, modelOptions, onApprovalModeChange, onSelectModel, selectionMenu, composerInput])

  const closeSelectionMenu = useCallback(() => {
    setSelectionMenu(null)
    if (selectionMenu === 'model') modelButtonRef.current?.focus()
    else composerInput.current?.focus()
  }, [selectionMenu, composerInput])

  const handleMenuKey = useCallback((key: string): boolean => {
    if (!selectionMenu) return false
    if (key === 'Escape' || contextComposer && key === 'Tab') {
      closeSelectionMenu()
      return true
    }
    const optionsLength = selectionMenu === 'permission' ? permissionOptions.length : menuOptions.length
    const navigationKey = !contextComposer && key === 'ArrowRight' ? 'ArrowDown' : !contextComposer && key === 'ArrowLeft' ? 'ArrowUp' : key
    const nextIndex = composerOptionIndex(navigationKey, menuIndex, optionsLength)
    if (nextIndex !== undefined) {
      setMenuIndex(nextIndex)
      return true
    }
    if (key === 'Enter') {
      const index = Math.min(menuIndex, optionsLength - 1)
      const option = selectionMenu === 'permission' ? permissionOptions[index] : menuOptions[index]
      if (option) selectMenuOption(option)
      return true
    }
    return false
  }, [menuIndex, menuOptions, permissionOptions, selectMenuOption, selectionMenu, closeSelectionMenu, contextComposer])

  const composerChoices: ComposerChoice[] = selectionMenu === 'permission'
    ? permissionOptions.map(option => ({id:option.value,label:option.label,description:'',selected:activeApprovalMode===option.value,run:()=>selectMenuOption(option)}))
    : menuOptions.map(option => ({id:JSON.stringify([option.providerId,option.modelId]),label:option.modelId,description:contextComposer?'':option.providerName,
      provider:contextComposer && selectionMenu==='model'?{id:option.providerId,name:option.providerName}:undefined,
      selected:activeModel?.providerId===option.providerId && (selectionMenu==='provider'||activeModel.modelId===option.modelId),run:()=>selectMenuOption(option)}))

  const replaceInput = useCallback((value: string) => {
    setInput(value)
    window.requestAnimationFrame(() => composerInput.current?.setSelectionRange(value.length, value.length))
  }, [composerInput])

  const handleEditMessage = useCallback((message: Message) => {
    setEditingMessageId(message.id)
    setEditingContent(message.content)
  }, [])

  const cancelMessageEdit = useCallback(() => {
    setEditingMessageId(null)
    setEditingContent('')
  }, [])

  const confirmMessageEdit = useCallback((messageId: string) => {
    const text = editingContent.trim()
    if (!text || isStreaming) return
    onRewrite(messageId, text)
    cancelMessageEdit()
  }, [cancelMessageEdit, editingContent, isStreaming, onRewrite])

  useEffect(() => {
    if (!editingMessageId) return
    if (!messages.some((message) => message.id === editingMessageId)) {
      cancelMessageEdit()
      return
    }
    window.requestAnimationFrame(() => {
      const editor = editInputRef.current
      editor?.focus()
      editor?.setSelectionRange(editor.value.length, editor.value.length)
    })
  }, [cancelMessageEdit, editingMessageId, messages])

  const handleChatKeyDownCapture = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if ((event.target as Element).closest('[data-island-companion], [data-question-answer-input]')) return
    if ((event.target as Element).closest('[data-composer-options]') || event.nativeEvent.isComposing || event.keyCode === 229) return
    if (event.target === richInputRef.current?.element && shortcuts.keyDown(event)) return
    if (contextComposer && event.key === 'Tab') { setSelectionMenu(null); return }
    const shortcutMenu = resolveChatSelectionShortcut({
      key: event.key,
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
      isComposing: event.nativeEvent.isComposing,
    }, showModelSelector)
    if (contextComposer && shortcutMenu && shortcutMenu !== 'model') return
    if (shortcutMenu) {
      event.preventDefault()
      event.stopPropagation()
      openSelectionMenu(shortcutMenu)
      return
    }
    if (selectionMenu && handleMenuKey(event.key)) {
      event.preventDefault()
      event.stopPropagation()
    }
  }, [handleMenuKey, openSelectionMenu, selectionMenu, showModelSelector, contextComposer, shortcuts])

  const handleChatPointerDownCapture = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as Element).closest('[data-island-companion]')) return
    // A user press takes focus ownership: cancel the pending mount-time
    // composer autofocus so typing after clicking message text never lands
    // in the composer.
    if (focusTimerRef.current !== null) {
      window.clearTimeout(focusTimerRef.current)
      focusTimerRef.current = null
    }
    const target = e.target as HTMLElement
    if (target.closest('button, input, textarea, select, a, [contenteditable="true"]')) return
    chatRootRef.current?.focus({ preventScroll: true })
  }, [])

  const handleSelectionTriggerPointerDown = useCallback((
    event: React.PointerEvent<HTMLButtonElement>,
    menu: SelectionMenu,
  ) => {
    if (event.button !== 0) return
    event.stopPropagation()
    openSelectionMenu(menu)
  }, [openSelectionMenu])

  // 快捷键：Enter 发送，Shift+Enter 换行。组字中（中文输入法选词）的 Enter
  // 必须放行，否则选词会误触发送。
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement | HTMLDivElement>) => {
    if (!e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.nativeEvent.isComposing) {
      const textarea = composerInput.current
      if (!textarea) return
      const caret = textarea.selectionStart
      const selectionCollapsed = caret === textarea.selectionEnd
      const firstLineEnd = input.indexOf('\n') < 0 ? input.length : input.indexOf('\n')
      const lastLineStart = input.lastIndexOf('\n') + 1
      if (e.key === 'ArrowUp' && selectionCollapsed && caret <= firstLineEnd && inputHistory.length) {
        e.preventDefault()
        if (historyIndex === null) historyDraftRef.current = input
        const nextIndex = historyIndex === null
          ? inputHistory.length - 1
          : Math.max(0, historyIndex - 1)
        setHistoryIndex(nextIndex)
        replaceInput(inputHistory[nextIndex])
        return
      }
      if (e.key === 'ArrowDown' && selectionCollapsed && caret >= lastLineStart && historyIndex !== null) {
        e.preventDefault()
        const nextIndex = historyIndex + 1
        if (nextIndex >= inputHistory.length) {
          setHistoryIndex(null)
          replaceInput(historyDraftRef.current)
        } else {
          setHistoryIndex(nextIndex)
          replaceInput(inputHistory[nextIndex])
        }
        return
      }
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'j' && !e.nativeEvent.isComposing) {
      // Ctrl+J / Cmd+J 换行（与终端侧多行输入约定一致），不触发发送。
      e.preventDefault()
      const textarea = composerInput.current
      if (!textarea) return
      const start = textarea.selectionStart ?? input.length
      const end = textarea.selectionEnd ?? input.length
      setInput(`${input.slice(0, start)}\n${input.slice(end)}`)
      setHistoryIndex(null)
      const caret = start + 1
      window.requestAnimationFrame(() => {
        const el = composerInput.current
        if (!el) return
        el.focus()
        el.setSelectionRange(caret, caret)
      })
      return
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      handleSend()
    }
  }, [handleSend, historyIndex, input, inputHistory, replaceInput, composerInput])

  useEffect(() => {
    if (!visible || discussionOnly || transcriptOnly) return
    const handleGlobalKeyDown = (event: KeyboardEvent) => {
      const chatRoot = chatRootRef.current
      if (!chatRoot) return

      const activeElement = document.activeElement
      if (activeElement?.closest('[data-island-companion], [data-question-answer-input]')) return
      if (activeElement?.closest('[data-composer-options]') || event.isComposing || event.keyCode === 229) return
      const activeChat = activeElement instanceof Element
        ? activeElement.closest('.janus-chat')
        : null
      // Blueprint reader and toolbar controls keep native Tab navigation while Chat is open.
      // See .agents/notes/blueprint/navigation/note-updates-and-suggestion-navigation.md
      if (event.key === 'Tab' && !activeChat && activeElement instanceof Element && activeElement.closest('.bp-note-wiki, .blueprint-toolbar')) return
      // A DOM-focused Chat always owns its shortcuts. Otherwise the workspace
      // focus state chooses the owner, so switching tabs does not depend on a
      // browser focus update landing in exactly the same frame.
      if (activeChat ? activeChat !== chatRoot : !focused) return

      const shortcutMenu = resolveChatSelectionShortcut(event, showModelSelector)
      if (contextComposer && event.key === 'Tab') { setSelectionMenu(null); return }
      if (contextComposer && shortcutMenu && shortcutMenu !== 'model') return
      if (shortcutMenu) {
        event.preventDefault()
        event.stopPropagation()
        openSelectionMenu(shortcutMenu)
        return
      }
      if (selectionMenu && handleMenuKey(event.key)) {
        event.preventDefault()
        event.stopPropagation()
      }
    }
    const handleDocumentKeyDown = (event: KeyboardEvent) => {
      const activeElement = document.activeElement
      const activeChat = activeElement instanceof Element
        ? activeElement.closest('.janus-chat')
        : null
      // The Chat's own capture handler owns events inside Chat. Document-level
      // capture is only the fallback for terminal/editor focus, where xterm can
      // otherwise consume the event before it reaches window.
      if (activeChat) return
      handleGlobalKeyDown(event)
    }
    document.addEventListener('keydown', handleDocumentKeyDown, true)
    window.addEventListener('keydown', handleGlobalKeyDown, true)
    return () => {
      document.removeEventListener('keydown', handleDocumentKeyDown, true)
      window.removeEventListener('keydown', handleGlobalKeyDown, true)
    }
  }, [discussionOnly, transcriptOnly, focused, handleMenuKey, openSelectionMenu, selectionMenu, showModelSelector, visible, contextComposer])

  useEffect(() => {
    if (!threadMenuOpen && !selectionMenu) return

    const closeMenusOutside = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (threadMenuOpen && !threadSelectorRef.current?.contains(target)) {
        setThreadMenuOpen(false)
      }
      if (
        selectionMenu
        && !selectionMenuRef.current?.contains(target)
        && !(target instanceof Element && target.closest('[data-selection-trigger]'))
      ) {
        setSelectionMenu(null)
      }
    }
    const closeMenusOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setThreadMenuOpen(false)
      if (selectionMenu && !selectionMenuRef.current?.contains(event.target as Node)) closeSelectionMenu()
    }

    // Let menu items receive their pointer/click sequence before handling
    // clicks outside the menu. Capture-phase closing can unmount the menu
    // before the permission option's click handler runs.
    document.addEventListener('pointerdown', closeMenusOutside)
    document.addEventListener('keydown', closeMenusOnEscape, true)
    return () => {
      document.removeEventListener('pointerdown', closeMenusOutside)
      document.removeEventListener('keydown', closeMenusOnEscape, true)
    }
  }, [selectionMenu, threadMenuOpen, closeSelectionMenu])

  // 停止生成
  const handleStop = useCallback(() => {
    onStop()
  }, [onStop])

  // 重试：重新发送最后一条用户消�?
  const handleRetry = useCallback(() => {
    onRetry()
  }, [onRetry])

  // 清空对话
  const handleClear = useCallback(() => {
    onClear()
    setInput('')
    setHistoryIndex(null)
    historyDraftRef.current = ''
  }, [onClear])

  // The normal Chat keeps its memo editor alive across view changes. Other
  // presentations have no memo and retain their lightweight hidden behavior.
  if (!visible && (discussionOnly || minimalComposer || !conversations)) return null

  const canClear = messages.length > 0 || !!pendingContent || !!error
  const hasConversation = messages.length > 0 || !!pendingContent || isStreaming || !!error
  const activeModelLabel = activeModel?.modelId ?? t('janus:chat.model.noneConfigured')
  const compactComposerActions = conversationStyle && Boolean(contextComposer)
  const hasComposerDraft = Boolean(input.trim())
  const sendControls = <>
    {isStreaming && <button
      className="janus-chat-stop" onClick={handleStop}
      data-secondary={compactComposerActions && hasComposerDraft || undefined}
      style={{ '--accent-color': modeColor } as React.CSSProperties}
      title={t('janus:chat.stop.title')} aria-label={t('janus:chat.stop.aria')} type="button"
    ><StopIcon /></button>}
    {(!compactComposerActions || !isStreaming || hasComposerDraft) && <button className="janus-chat-send" onClick={() => handleSend()} disabled={!hasComposerDraft || contextImporting || sendingShortcut}
      title={t(isStreaming ? 'janus:chat.queue.sendTitle' : 'janus:chat.send.title')}
      aria-label={t(isStreaming ? 'janus:chat.queue.sendAria' : 'janus:chat.send.aria')} type="button">
      {minimalComposer ? <span aria-hidden="true">↑</span>
        : conversationStyle ? <ArrowUp size={18} aria-hidden="true" /> : <Send size={14} strokeWidth={2} aria-hidden="true" />}
    </button>}
  </>

  return (
    <WorkDisclosureScope scopeKey={conversations?.conversationId ?? 'chat'}>
      <div
        ref={chatRootRef}
        hidden={!visible}
        data-compact-navigation={compactNavigation || undefined}
        data-minimal-composer={minimalComposer || undefined}
        data-conversation-style={conversationStyle || undefined}
        data-transcript-only={transcriptOnly || undefined}
      tabIndex={-1}
      className={visible ? `janus-chat${conversationStyle ? ` ${nativeScrollbars.scope}` : ''}${docked ? ' janus-chat--docked' : ''}${discussionOnly ? ' janus-chat--discussion-only' : ''}${showConversationSidebar ? ' janus-chat--with-sidebar' : ''}${showConversationSidebar && sidebarCollapsed ? ' janus-chat--sidebar-collapsed' : ''}${hasConversation ? ' janus-chat--active' : ' janus-chat--empty'}${isRestoringScroll ? ' janus-chat--restoring-scroll' : ''}` : undefined}
      onKeyDownCapture={handleChatKeyDownCapture}
      onPointerDownCapture={handleChatPointerDownCapture}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {showConversationSidebar && conversations && (sidebarCollapsed ? (
        <aside className="janus-chat-sidebar janus-chat-sidebar--collapsed" aria-label={t('janus:chat.thread.menuHeader')}>
          <button
            type="button"
            className="janus-chat-new-thread"
            aria-label={t('janus:chat.thread.expandAria')}
            title={t('janus:chat.thread.expandTitle')}
            onClick={toggleSidebarCollapsed}
          >
            <PanelLeftOpen size={14} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="janus-chat-new-thread"
            aria-label={t('janus:chat.thread.newAria')}
            title={t('janus:chat.thread.newTitle')}
            onClick={() => {
              conversations.createConversation()
              setRenamingConversationId(null)
            }}
          >
            <Plus size={14} aria-hidden="true" />
          </button>
        </aside>
      ) : (
        <aside className="janus-chat-sidebar" aria-label={t('janus:chat.thread.menuHeader')}>
          <div className="janus-chat-sidebar-header">
            <div>
              <span className="janus-chat-sidebar-kicker">{t('janus:chat.thread.kicker')}</span>
              <strong>{t('janus:chat.thread.menuHeader')}</strong>
            </div>
            <div className="janus-chat-sidebar-header-actions">
              <button
                type="button"
                className="janus-chat-new-thread"
                aria-label={t('janus:chat.thread.collapseAria')}
                title={t('janus:chat.thread.collapseTitle')}
                onClick={toggleSidebarCollapsed}
              >
                <PanelLeftClose size={14} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="janus-chat-new-thread"
                aria-label={t('janus:chat.thread.newAria')}
                title={t('janus:chat.thread.newTitle')}
                onClick={() => {
                  conversations.createConversation()
                  setRenamingConversationId(null)
                }}
              >
                <Plus size={14} aria-hidden="true" />
              </button>
            </div>
          </div>
          <div className="janus-chat-sidebar-list">
            {conversations.conversations.map((conversation) => (
              <div key={conversation.id} className="janus-chat-sidebar-row" data-active={conversation.id === conversations.conversationId}>
                {renamingConversationId === conversation.id ? (
                  <input
                    autoFocus
                    value={renamingTitle}
                    aria-label={t('janus:chat.thread.titleAria')}
                    onChange={(event) => setRenamingTitle(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') setRenamingConversationId(null)
                      if (event.key === 'Enter') {
                        conversations.renameConversation(conversation.id, renamingTitle)
                        setRenamingConversationId(null)
                      }
                    }}
                    onBlur={() => {
                      conversations.renameConversation(conversation.id, renamingTitle)
                      setRenamingConversationId(null)
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    className="janus-chat-sidebar-main"
                    onClick={() => conversations.selectConversation(conversation.id)}
                  >
                    <strong>
                      {conversation.isStreaming && <LoaderCircle size={11} className="janus-runtime-tool-spinner" aria-hidden="true" />}
                      {!conversation.isStreaming && conversation.hasError && <CircleX size={11} aria-hidden="true" />}
                      {conversation.title}
                    </strong>
                    <span>{t('janus:chat.thread.messagesCount', { count: conversation.messageCount })}{conversation.memoId ? ` · ${memoTitle(conversation.memoId) ?? t('janus:memo.title')}` : ''}</span>
                  </button>
                )}
                <div className="janus-chat-sidebar-actions">
                  <button
                    type="button"
                    className="janus-chat-thread-action"
                    aria-label={t('janus:chat.thread.renameAria', { title: conversation.title })}
                    title={t('janus:chat.thread.renameTitle')}
                    onClick={() => {
                      setRenamingConversationId(conversation.id)
                      setRenamingTitle(conversation.title)
                    }}
                  >
                    <Pencil size={11} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="janus-chat-thread-action danger"
                    aria-label={t('janus:chat.thread.deleteAria', { title: conversation.title })}
                    title={t('janus:chat.thread.deleteTitle')}
                    onClick={() => setPendingDeleteConversation({ id: conversation.id, title: conversation.title })}
                  >
                    <Trash2 size={11} aria-hidden="true" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </aside>
      ))}
      <div className="janus-chat-main" style={transcriptOnly ? { display: 'block', flex: 'none', height: 'auto', minHeight: 0, padding: 0, overflow: 'visible' } : undefined}>
      {showConversationNavigation && !discussionOnly && !minimalComposer && <div className="janus-chat-toolbar">
        <div ref={threadSelectorRef} className="janus-chat-thread-selector">
          <button
            type="button"
            className="janus-chat-thread-trigger"
            aria-label={t('janus:chat.thread.selectAria')}
            aria-expanded={threadMenuOpen}
            onClick={() => setThreadMenuOpen((open) => !open)}
            disabled={!conversations || compactNavigation}
          >
            <span>
              <span className="janus-chat-toolbar-kicker">{t('janus:chat.thread.kicker')}</span>
              <strong>{conversations?.conversationTitle ?? t('janus:chat.thread.fallbackTitle')}</strong>
            </span>
            {conversations && !compactNavigation && <ChevronDown size={13} aria-hidden="true" />}
          </button>
          {threadMenuOpen && conversations && !compactNavigation && (
            <div className="janus-chat-thread-menu" role="menu" aria-label={t('janus:chat.thread.menuHeader')}>
              <div className="janus-chat-thread-menu-header">
                <span>{t('janus:chat.thread.menuHeader')}</span>
                <button
                  type="button"
                  aria-label={t('janus:chat.thread.newAria')}
                  title={t('janus:chat.thread.newTitle')}
                  onClick={() => {
                    conversations.createConversation()
                    setRenamingConversationId(null)
                  }}
                >
                  <Plus size={13} aria-hidden="true" />
                </button>
              </div>
              <div className="janus-chat-thread-list">
                {conversations.conversations.map((conversation) => (
                  <div
                    key={conversation.id}
                    className="janus-chat-thread-row"
                    data-active={conversation.id === conversations.conversationId}
                  >
                    {renamingConversationId === conversation.id ? (
                      <input
                        autoFocus
                        value={renamingTitle}
                        aria-label={t('janus:chat.thread.titleAria')}
                        onChange={(event) => setRenamingTitle(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Escape') setRenamingConversationId(null)
                          if (event.key === 'Enter') {
                            conversations.renameConversation(conversation.id, renamingTitle)
                            setRenamingConversationId(null)
                          }
                        }}
                        onBlur={() => {
                          conversations.renameConversation(conversation.id, renamingTitle)
                          setRenamingConversationId(null)
                        }}
                      />
                    ) : (
                      <button
                        type="button"
                        className="janus-chat-thread-main"
                        onClick={() => {
                          conversations.selectConversation(conversation.id)
                          setThreadMenuOpen(false)
                        }}
                      >
                        <strong>
                          {conversation.isStreaming && (
                             <LoaderCircle size={11} className="janus-runtime-tool-spinner" aria-label={t('janus:chat.thread.generatingAria')} />
                           )}
                           {!conversation.isStreaming && conversation.hasError && (
                             <CircleX size={11} aria-label={t('janus:chat.thread.errorAria')} />
                           )}
                           {conversation.title}
                         </strong>
                         <span>{t('janus:chat.thread.messagesCount', { count: conversation.messageCount })}</span>
                      </button>
                    )}
                    <button
                      type="button"
                      className="janus-chat-thread-action"
                      aria-label={t('janus:chat.thread.renameAria', { title: conversation.title })}
                      title={t('janus:chat.thread.renameTitle')}
                      onClick={() => {
                        setRenamingConversationId(conversation.id)
                        setRenamingTitle(conversation.title)
                      }}
                    >
                      <Pencil size={12} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="janus-chat-thread-action danger"
                      aria-label={t('janus:chat.thread.deleteAria', { title: conversation.title })}
                      title={t('janus:chat.thread.deleteTitle')}
                      onClick={() => setPendingDeleteConversation({ id: conversation.id, title: conversation.title })}
                    >
                      <Trash2 size={12} aria-hidden="true" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>}

      {showWorkspaceScope && resourceController && (resourceController.resources.length > 0 || attachableWorkspaces.length > 0) && !discussionOnly && !minimalComposer && (
        <div className="janus-resource-scope" aria-label={t('janus:chat.resource.scopeAria')}>
          <div className="janus-resource-list">
            {resourceController.resources.map((resource) => (
                <div
                  key={resource.workspaceId}
                  className="janus-resource-chip"
                >
                  <span className="janus-resource-label" title={resource.workspacePath}>
                    <span>{resource.workspaceName}</span>
                  </span>
                  <button
                    type="button"
                    className="janus-resource-remove"
                    aria-label={t('janus:chat.resource.removeAria', { name: resource.workspaceName })}
                    title={t('janus:chat.resource.removeTitle', { name: resource.workspaceName })}
                    onClick={() => resourceController.detachWorkspace(resource.workspaceId)}
                  >
                    <X size={11} strokeWidth={1.8} aria-hidden="true" />
                  </button>
                </div>
            ))}
          </div>
          {attachableWorkspaces.length > 0 && (
            <div className="janus-resource-attach" title={t('janus:chat.resource.attachTitle')}>
              <Select
                ariaLabel={t('janus:chat.resource.attachAria')}
                value=""
                placeholder={t('janus:chat.resource.attachPlaceholder')}
                prefix={<Plus size={12} strokeWidth={1.8} aria-hidden="true" />}
                options={attachableWorkspaceOptions}
                className="janus-resource-attach-select"
                dropdownClassName="janus-resource-attach-dropdown"
                onChange={(workspaceId) => {
                  if (workspaceId) resourceController.attachWorkspace(workspaceId)
                }}
              />
            </div>
          )}
        </div>
      )}

      {resourceController && !discussionOnly && (resourceController.pendingApprovals[0] ? (() => {
          const approval = resourceController.pendingApprovals[0]
          return (
            <div
              className="janus-runtime-approval"
              aria-label={t('janus:chat.approval.regionAria')}
              aria-live="polite"
              role="region"
            >
              <div className="janus-runtime-approval-header">
                <div className="janus-runtime-approval-heading">
                  <span>{t('janus:chat.approval.heading')}</span>
                  <strong>{t('janus:chat.approval.headingStrong')}</strong>
                </div>
                <span className="janus-runtime-approval-tool" title={approval.toolName}>
                  {approval.toolName} / {approval.actionRisk}
                </span>
              </div>
              {approval.preview && (
                <div className="janus-runtime-approval-preview">
                  <strong>{approval.preview.summary}</strong>
                  {approval.preview.paths.length > 0 && <span>{approval.preview.paths.join(', ')}</span>}
                  {approval.preview.detail && <pre>{approval.preview.detail}</pre>}
                </div>
              )}
              <div className="janus-runtime-approval-actions">
                <button
                  type="button"
                  className="janus-runtime-approval-reject"
                  onClick={() => resourceController.resolveApproval(approval.id, false)}
                  title={t('janus:chat.approval.rejectTitle')}
                  aria-label={t('janus:chat.approval.rejectAria')}
                >
                  <ShieldX size={13} aria-hidden="true" />
                  <span>{t('janus:chat.approval.reject')}</span>
                </button>
                <button
                  type="button"
                  className="janus-runtime-approval-approve"
                  onClick={() => resourceController.resolveApproval(approval.id, true)}
                  title={t('janus:chat.approval.approveTitle')}
                  aria-label={t('janus:chat.approval.approveAria')}
                >
                  <Check size={13} aria-hidden="true" />
                  <span>{t('janus:chat.approval.approve')}</span>
                </button>
              </div>
            </div>
          )
        })() : resourceController.activities.length > 0 && (
          <div className="janus-runtime-activity" aria-label={t('janus:chat.activity.aria')}>
            {(() => {
              const activity = resourceController.activities.at(-1)!
              const pending = activity.status === 'requested' || activity.status === 'running'
              return (
                <>
                  {pending
                    ? <LoaderCircle size={11} className="janus-runtime-tool-spinner" aria-hidden="true" />
                    : activity.status === 'completed'
                      ? <CircleCheck size={11} aria-hidden="true" />
                      : <CircleX size={11} aria-hidden="true" />}
                  <span className="janus-runtime-tool-name">{activity.toolName}</span>
                  <span className="janus-runtime-tool-state">{activity.status}</span>
                </>
              )
            })()}
          </div>
        ))}

      {/* 消息区域 */}
      <div className={hasTranscriptContent ? 'janus-chat-transcript-viewport' : undefined} style={!hasTranscriptContent ? { display: 'contents' } : messagesHidden ? { display: 'none' } : undefined}>
      <div
        ref={messagesContainerRef}
        className="janus-chat-messages"
        data-following={showLatest?'false':'true'}
        style={messagesHidden ? { display: 'none' } : transcriptOnly ? { overflow: 'visible', height: 'auto', flex: 'none', padding: '12px 16px', maxHeight: 'none' } : undefined}
        onScroll={handleScroll}
      >
        {hasTranscriptContent ? <div ref={transcriptContentRef} className="janus-chat-transcript-content">{transcriptContent}</div> : <>
        {messages.length === 0 && (emptyState ?? (
          <div className="janus-chat-empty">
            {!conversationStyle && <JanusXTerminalBanner />}
          </div>
        ))}

        {messages.length > historyPageSize && <button type="button" className="janus-chat-load-history" onClick={() => setHistoryPageSize(size => size + 100)}>{t('janus:chat.context.older')}</button>}
        {<VirtualHistory virtualize={!transcriptOnly} rowStyle={{ display: 'flex', flexDirection: 'column' }} gap={6} key={conversations?.conversationId ?? 'chat'} items={historyEntries} itemKey={entry => entry.kind === 'message' ? entry.msg.id : entry.kind === 'card' ? 'card:' + entry.card.id : 'questions:' + entry.block.roundNumber} scrollRef={messagesContainerRef} following={isAtBottomRef} active={visible} pinnedKey={editingMessageId ?? undefined} renderItem={(entry) => entry.kind === 'card' ? (
          <div key={entry.card.id} className="janus-chat-message assistant janus-chat-agent-card-message">
            <div className="janus-chat-message-author">{entry.card.title}</div>
            <AgentResultCardView card={entry.card} onOpen={() => onOpenAgentResult?.(entry.card)} />
          </div>
        ) : entry.kind === 'questions' ? (
          <div key={`host-questions-${entry.block.roundNumber}`} className="janus-chat-message assistant janus-chat-host-questions-message">
            <div className="janus-chat-message-author">JanusX · 第{entry.block.roundNumber}轮 · 待确认{entry.block.questions.length}{entry.block.answeredCount > 0 ? ` · 已解决${entry.block.answeredCount}` : ''}</div>
            <div className="janus-chat-message-content janus-chat-host-questions">
              <p>本轮讨论产生{entry.block.questions.length}个待确认问题，直接在下方回答即可{entry.block.answeredCount > 0 ? `（已解决${entry.block.answeredCount}个）` : ''}。</p>
              {onOpenQuestions ? (
                <button type="button" className="janus-chat-host-questions-detail" onClick={onOpenQuestions}>
                  {t('janus:roundtable.questions.viewDetail')}
                </button>
              ) : null}
            </div>
          </div>
        ) : (() => { const msg = entry.msg;
          if (conversationStyle && msg.role === 'assistant' && msg.id.startsWith('worker-report:')) return <WorkerReportMessage key={msg.id} content={msg.content} reportId={msg.id.slice('worker-report:'.length)} />
          return (
          <SuperAgentMessage
            key={msg.id}
            userMessage={msg.role === 'user' ? { id: msg.id, text: msg.context?.text ?? msg.content } : undefined}
            className={`janus-chat-message ${msg.role}`}
            round={superAgentTranscript ? rounds.get(msg.id) : undefined}
          >
            {transcriptOnly && conversationStyle && msg.role === 'user' && <div className="janus-chat-message-speaker">{t('janus:topics.you')}</div>}
            {conversationStyle && msg.role === 'assistant' && <div className="janus-chat-message-author">
              <JanusIcon size={14} />{t('janus:chat.author.assistant')}
            </div>}
            {transcriptOnly && msg.role === 'user' && pendingSteerIds.includes(msg.id) && <div className="janus-chat-steering-status">
              <span className="janus-chat-queued-badge" role="status">{t('janus:chat.queue.badge')}</span>
              <button className="janus-chat-message-edit" type="button" title={t('janus:chat.queue.cancelTitle')}
                aria-label={t('janus:chat.queue.cancelAria')} onClick={() => cancelSteeredMessage?.(msg.id)}>
                <X size={13} strokeWidth={1.8} aria-hidden="true" />
              </button>
            </div>}
            <div className="janus-chat-message-meta">
              {!conversationStyle && msg.role === 'assistant' && (
                <div className="janus-chat-message-author">
                  {t('janus:chat.author.assistant')}
                </div>
              )}
              <time className="janus-chat-message-time" dateTime={new Date(msg.timestamp).toISOString()}>
                {formatMessageTime(msg.timestamp)}
              </time>
              {!transcriptOnly && !discussionOnly && !minimalComposer && <div className="janus-chat-message-edit-actions">
                <button
                  className="janus-chat-message-edit"
                  type="button"
                  title={t('janus:chat.message.copyTitle')}
                  aria-label={t('janus:chat.message.copyAria')}
                  onClick={() => copyMessage(msg.content)}
                >
                  <Copy size={13} strokeWidth={1.8} aria-hidden="true" />
                </button>
              {msg.role === 'user' && pendingSteerIds.includes(msg.id) ? (
                <>
                  <span className="janus-chat-queued-badge">{t('janus:chat.queue.badge')}</span>
                  <button
                    className="janus-chat-message-edit"
                    type="button"
                    title={t('janus:chat.queue.cancelTitle')}
                    aria-label={t('janus:chat.queue.cancelAria')}
                    onClick={() => cancelSteeredMessage?.(msg.id)}
                  >
                    <X size={13} strokeWidth={1.8} aria-hidden="true" />
                  </button>
                </>
              ) : null}
              {msg.role === 'user' && editingMessageId === msg.id ? (
                <>
                  <button
                    className="janus-chat-message-edit"
                    type="button"
                    title={t('janus:chat.edit.cancelTitle')}
                    aria-label={t('janus:chat.edit.cancelAria')}
                    onClick={cancelMessageEdit}
                  >
                    <X size={13} strokeWidth={1.8} aria-hidden="true" />
                  </button>
                  <button
                    className="janus-chat-message-edit"
                    type="button"
                    title={t('janus:chat.edit.confirmTitle')}
                    aria-label={t('janus:chat.edit.confirmAria')}
                    onClick={() => confirmMessageEdit(msg.id)}
                    disabled={!editingContent.trim() || isStreaming}
                  >
                    <Check size={13} strokeWidth={1.8} aria-hidden="true" />
                  </button>
                </>
              ) : msg.role === 'user' ? (
                <button
                  className="janus-chat-message-edit"
                  type="button"
                  title={t('janus:chat.edit.editTitle')}
                  aria-label={t('janus:chat.edit.editAria')}
                  onClick={() => handleEditMessage(msg)}
                  disabled={isStreaming}
                >
                  <Pencil size={13} strokeWidth={1.8} aria-hidden="true" />
                </button>
              ) : msg.id === lastAssistantMessageId ? (
                <button
                  className="janus-chat-message-edit"
                  type="button"
                  title={t('janus:chat.message.retryTitle')}
                  aria-label={t('janus:chat.message.retryAria')}
                  onClick={onRetry}
                  disabled={isStreaming}
                >
                  <RotateCcw size={13} strokeWidth={1.8} aria-hidden="true" />
                </button>
              ) : null}
              </div>}
            </div>
            <SuperAgentReply enabled={superAgentTranscript && msg.role === 'assistant'} latest={msg.id === (latestReplyId ?? lastAssistantMessageId) && !isStreaming} summary={msg.content}>
            {editingMessageId === msg.id ? (
              <textarea
                ref={editInputRef}
                className="janus-chat-inline-editor"
                value={editingContent}
                onChange={(event) => setEditingContent(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.preventDefault()
                    cancelMessageEdit()
                  } else if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault()
                    confirmMessageEdit(msg.id)
                  }
                }}
                aria-label={t('janus:chat.edit.historyAria')}
                rows={Math.min(6, Math.max(2, (editingContent.match(/\n/g) || []).length + 1))}
              />
            ) : (
              <div className="janus-chat-message-content">
                {msg.role === 'assistant' && msg.timeline ? <ChatTimeline snapshot={msg.timeline} workspaceNames={workspaceNames} renderToolDetails={renderToolDetails} /> : <>
                {msg.role === 'assistant' && activeReasoningByTurn[msg.id] && (
                  <ThinkingRegion snapshot={activeReasoningByTurn[msg.id]} streaming={false} defaultExpanded={false} />
                )}
                {msg.role === 'user' && (contextComposer || superAgentTranscript)
                  ? <div className="janus-user-inline-prompt" style={{ whiteSpace: 'pre-wrap' }}><ConversationPrompt text={msg.content} /></div>
                  : <MarkdownContent content={msg.role === 'user' ? msg.context?.text ?? msg.content : msg.content} variant="conversation" />}
                {msg.role === 'user' && <MessageContextChips context={msg.context} hideReferences={!!contextComposer || superAgentTranscript} />}
                {msg.role === 'assistant' && (
                  <ToolCallGroup
                    entries={toolTraces.filter((entry) => entry.turnId === msg.id)}
                    workspaceNames={workspaceNames}
                    collapsible
                  />
                )}
                </>}
                {msg.role === 'assistant' && renderTurnFooter?.(msg.id, msg.timeline)}
              </div>
            )}
            </SuperAgentReply>
          </SuperAgentMessage>
        )})()} />}

        {(isStreaming || pendingContent || (error && liveToolTraces.length > 0)) && (
          <SuperAgentMessage className="janus-chat-message assistant streaming" round={pendingRound}>
            <div className="janus-chat-message-author">{conversationStyle && <JanusIcon size={14} />}{t('janus:chat.author.assistant')}</div>
            <div className="janus-chat-message-content">
              {isStreaming && <TurnStatusRow status={activeTurnStatus} startedAt={activeTurnStartedAt} />}
              {(activeTimeline?.blocks.length || activeTimeline?.truncated) ? <ChatTimeline snapshot={activeTimeline} streaming={isStreaming} workspaceNames={workspaceNames} renderToolDetails={renderToolDetails} /> : <>
              <ThinkingRegion snapshot={activePendingReasoning} streaming={isStreaming} startedAt={activeTurnStartedAt} defaultExpanded={false} />
              {pendingContent ? (
                <StreamingText content={pendingContent} />
              ) : (
                isStreaming && (
                  <div className="janus-chat-loading" role="status" aria-label={t('janus:chat.turnStatus.thinking')}>
                    <span className="janus-chat-dot" />
                    <span className="janus-chat-dot" />
                    <span className="janus-chat-dot" />
                  </div>
                )
              )}
              <ToolCallGroup entries={liveToolTraces} workspaceNames={workspaceNames} collapsible />
              </>}
              {renderTurnFooter?.(undefined, activeTimeline)}
            </div>
          </SuperAgentMessage>
        )}

        {error && (
          <ChatErrorCard message={error}
            status={isStreaming && <div role="status">{t('janus:chat.recoveringTools')}</div>}
            actions={<button type="button" onClick={handleRetry} disabled={isStreaming}>
                {t('common:action.retry')}
              </button>} />
        )}

        {discussionFooter}
        <span className="janus-chat-end-anchor" />

        {showNewMessageBadge && !conversationStyle && !transcriptOnly && (
          <button
            className="janus-chat-new-message-badge"
            onClick={() => {
              isAtBottomRef.current = true
              setShowNewMessageBadge(false)
              scrollToBottom('smooth')
            }}
          >
            {t('janus:chat.newMessage')}
          </button>
        )}
        </>}
      </div>

      {hasTranscriptContent && visible && !messagesHidden && <TranscriptNavigation scrollRef={messagesContainerRef} following={isAtBottomRef} onNavigate={() => { setShowLatest(true); setShowNewMessageBadge(false) }} />}
      </div>

      {conversationStyle && !transcriptOnly && !messagesHidden && <div className="janus-chat-latest-anchor">
        {showLatest && <button type="button" className="janus-chat-latest" aria-label={t('terminal:conversation.latest')} title={t('terminal:conversation.latest')}
          onClick={() => {
            isAtBottomRef.current = true
            setShowLatest(false)
            setShowNewMessageBadge(false)
            scrollToBottom('auto')
          }}><ArrowDown size={16} aria-hidden="true" /></button>}
      </div>}

      {/* Agent todo 条 + 中途提问门（janus-agent parity，位于 composer 上方） */}
      <TodoStrip todos={activeTodos} />
      {answerQuestion && activePendingQuestions.map((gate) => (
        <QuestionGate key={gate.callId} gate={gate} onAnswer={(answer) => answerQuestion(gate.callId, answer)} />
      ))}

      {aboveComposer}
      {unavailable && <p role="alert">{t('janus:superagent.hostUnavailable')}</p>}
      {showContextIndicator && <ChatContextIndicator controller={conversations} />}

      {/* 输入区域：opencode 风格方框 composer；minimal 下加 › 前缀（对齐蓝图高保真） */}
      <JanusContextComposer context={contextComposer} inputRef={richInputRef} references={references} draft={input} setDraft={setInput} onImporting={setContextImporting} pickerActive={!!selectionMenu}>
      {contextControl => <div className="janus-chat-input-wrapper" hidden={transcriptOnly} style={transcriptOnly ? { display: 'none' } : undefined} data-has-input={input.length > 0}>
        {shortcuts.control}
        <div className="janus-chat-composer-row">
          {minimalComposer && <span className="janus-chat-prompt-prefix" aria-hidden="true">›</span>}
          {contextComposer ? <ConversationInput ref={richInputRef} className="janus-chat-input" value={input} references={references} disabled={sendingShortcut} engineShortcuts={!!workerShortcuts}
            placeholder={inputPlaceholderOverride ?? t('janus:chat.inputPlaceholder')} label={t('janus:chat.inputPlaceholder')} title=""
            onChange={value => { setInput(value); setHistoryIndex(null) }} onKeyDown={handleKeyDown} /> : <textarea
            ref={inputRef}
            className="janus-chat-input"
            rows={1}
            wrap="soft"
            placeholder={isStreaming ? t('janus:chat.queue.inputPlaceholder') : (inputPlaceholderOverride ?? t('janus:chat.inputPlaceholder'))}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            style={{ '--accent-color': modeColor } as React.CSSProperties}
          />}
          {!conversationStyle && sendControls}
        </div>
        {!discussionOnly && !minimalComposer && <div className="janus-chat-status-bar">
          {contextControl}
          {showModelSelector && <ComposerOptionTrigger
            ref={modelButtonRef}
            aria-expanded={selectionMenu === 'model'}
            data-selection-trigger="model"
            aria-label={t('terminal:conversation.chooseModel')}
            onClick={() => selectionMenu === 'model' ? closeSelectionMenu() : openSelectionMenu('model')}
            title={t('janus:chat.model.menuShortcutTitle')}
          >
            <span>{activeModelLabel}</span><ChevronDown size={12} aria-hidden="true" />
          </ComposerOptionTrigger>}
          {!contextComposer && <div className="janus-chat-status-actions">
            {showAgentMode && <AgentModeSelect disabled={isStreaming} />}
            {conversations && <MemoPanel compactTrigger onBindMemo={conversations.bindMemo} />}
            <div className="janus-chat-shortcuts">
              {showModelSelector && <button
                type="button"
                data-selection-trigger="provider"
                aria-label={t('janus:chat.selectionMenu.aria', { kind: 'provider' })}
                onPointerDown={(event) => handleSelectionTriggerPointerDown(event, 'provider')}
                onClick={() => openSelectionMenu('provider')}
              >
                <kbd>tab</kbd> {t('janus:chat.shortcuts.providers')}
              </button>}
              {showModelSelector && !conversationStyle && <button
                type="button"
                data-selection-trigger="model"
                aria-label={t('janus:chat.selectionMenu.aria', { kind: 'model' })}
                onPointerDown={(event) => handleSelectionTriggerPointerDown(event, 'model')}
                onClick={() => openSelectionMenu('model')}
              >
                <kbd>ctrl+p</kbd> {t('janus:chat.shortcuts.models')}
              </button>}
              <button
                type="button"
                className="janus-chat-permission-select"
                data-selection-trigger="permission"
                aria-label={t('janus:chat.permission.aria')}
                onPointerDown={(event) => handleSelectionTriggerPointerDown(event, 'permission')}
                onClick={() => openSelectionMenu('permission')}
              >
                <kbd>ctrl+f</kbd> {t('janus:chat.shortcuts.permission')}
              </button>
            </div>
            <button
              className="janus-chat-clear-button"
              onClick={handleClear}
              disabled={!canClear}
              title={t('janus:chat.clear.title')}
              aria-label={t('janus:chat.clear.aria')}
              type="button"
            >
              <Trash2 size={14} strokeWidth={1.8} aria-hidden="true" />
            </button>
          </div>}
          {conversationStyle && contextComposer && <span className="janus-chat-input-hint" role="status">{t(isStreaming ? 'janus:chat.stop.title' : 'terminal:conversation.inputHint')}</span>}
          {conversationStyle && <div className="janus-chat-composer-submit">{sendControls}</div>}
          {selectionMenu && <ComposerOptions id={menuId} kind={selectionMenu} selectionMenu={selectionMenu} containerRef={selectionMenuRef}
            title={selectionMenu === 'model'?t('terminal:conversation.picker.model'):selectionMenu === 'provider'?t('janus:chat.model.providersHeading'):t('janus:chat.permission.label')}
            options={composerChoices} active={menuIndex} onActiveChange={setMenuIndex} autoFocus
            onKeyDown={event=>{
              if(event.nativeEvent.isComposing || event.keyCode===229)return
              const next=resolveChatSelectionShortcut({...event,isComposing:false},showModelSelector)
              if(next && (!contextComposer || next==='model')){event.preventDefault();event.stopPropagation();openSelectionMenu(next);return}
              if(handleMenuKey(event.key)){event.preventDefault();event.stopPropagation()}
            }}
            search={selectionMenu !== 'permission'?{value:menuSearch,onChange:value=>{setMenuSearch(value);setMenuIndex(0)},label:t('terminal:conversation.searchOptions')}:undefined}
            providers={contextComposer && selectionMenu==='model'?{label:t('terminal:conversation.modelProvider'),allLabel:t('terminal:conversation.allProviders'),value:menuProvider,options:menuProviders,onChange:value=>{setMenuProvider(value);setMenuIndex(0)}}:undefined}
            hint={{label:t('terminal:conversation.compactCommandKeys'),title:t('terminal:conversation.commandKeys')}}
            footer={selectionMenu!=='permission'&&<span title={t('terminal:conversation.nextTurnSettings')}>{t('terminal:conversation.nextTurnShort')}</span>}>
            {!composerChoices.length && <p role="status">{t('terminal:conversation.noOptions')}</p>}
          </ComposerOptions>}
          </div>
        }
      </div>
      }</JanusContextComposer>
      {modelNotice && !minimalComposer && <div className="janus-chat-model-notice">{modelNotice}</div>}
      </div>
      {/* The portaled confirmation belongs to the island, including its backdrop.
          Gated like every other createPortal site so SSR-style unit renders never
          evaluate document.body with the dialog closed. */}
      {visible && pendingDeleteConversation !== null && createPortal(<div data-island-companion onPointerDown={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}><PromptDialog
        open={visible && pendingDeleteConversation !== null}
        title={t('janus:chat.thread.deleteTitle')}
        description={t('janus:chat.thread.deleteConfirm', { title: pendingDeleteConversation?.title ?? '' })}
        confirmOnly
        tone="danger"
        confirmText={t('common:action.delete')}
        cancelText={t('common:action.cancel')}
        onConfirm={() => {
          if (pendingDeleteConversation && conversations) {
            conversations.deleteConversation(pendingDeleteConversation.id)
          }
          setPendingDeleteConversation(null)
        }}
        onCancel={() => setPendingDeleteConversation(null)}
      /></div>, document.body)}
    </div>
    </WorkDisclosureScope>
  )
}
