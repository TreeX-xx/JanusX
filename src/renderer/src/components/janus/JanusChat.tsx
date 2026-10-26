/**
 * @file JanusChat �?虚幻模糊风格的对话组�?
 * @description �?Janus 数字形象风格一致的对话界面
 */

import { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, CircleCheck, CircleX, Copy, LoaderCircle, PanelLeftClose, PanelLeftOpen, Pencil, Plus, RotateCcw, Send, ShieldX, Trash2, X } from 'lucide-react'
import type { ChatModelOption, JanusResourceController, Message, UseJanusChatReturn } from './useJanusChat'
import type { ChatQuestionAnswer, ChatTodoItem, ChatToolTraceEntry } from '../../../../shared/ipc/llm'
import type { AgentApprovalMode } from '../../../../shared/ipc/agent-runtime'
import type { AgentResultCard } from '../../../../shared/roundtable/events'
import { AgentResultCard as AgentResultCardView } from './AgentResultCard'
import { useOptionalJanusChatController } from './JanusChatProvider'
import { MarkdownContent, StreamingText } from '../chat/ChatContent'
import { useI18n } from '@/i18n/useI18n'
import { PromptDialog } from '../common/PromptDialog'
import { ToolCallGroup } from './ToolCallCard'
import { ThinkingRegion } from './ThinkingRegion'
import { ChatTimeline, type ChatTimelineProps } from './ChatTimeline'
import type { ChatTimelineSnapshot } from '../../../../shared/chat-timeline'
import { NoteTimelineDetails } from '../note/NoteTimelineDetails'
import { formatThinkingDuration, type ReasoningSnapshot } from './janusReasoning'
import type { JanusChatStatus, JanusPendingQuestion } from './janusRuntimeState'
import { Select } from '../ui/Select'
import { ChatContextIndicator } from './ChatContextIndicator'
import { MemoPanel } from '../memo/MemoPanel'
import { useMemoStore } from '@/stores/memo'

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

export function resolveChatSelectionShortcut(event: ChatShortcutEvent): SelectionMenu | null {
  if (event.isComposing || event.altKey) return null
  if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'f') return 'permission'
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
  /** 是否显示 */
  visible: boolean
  /** 停靠态：作为右侧 flex 列，而非绝对浮层 */
  docked?: boolean
  compactNavigation?: boolean
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
  activeModel?: ChatModelOption | null
  modelNotice?: string | null
  resourceController?: JanusResourceController
  toolTraces?: ChatToolTraceEntry[]
  conversationController?: UseJanusChatReturn | null
  onSelectModel?: (providerId: string, modelId: string) => void
  /** 发送一条用户消息 */
  onSend: (text: string) => void
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
  onAnswerQuestion?: ((callId: string, answer: ChatQuestionAnswer) => void) | null
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

function QuestionGate({ gate, onAnswer }: { gate: JanusPendingQuestion; onAnswer: (answer: ChatQuestionAnswer) => void }) {
  const { t } = useI18n('janus')
  const [selected, setSelected] = useState<Record<number, string[]>>({})
  const [custom, setCustom] = useState<Record<number, string>>({})

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
    if (!submittable) return
    onAnswer({
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
      </div>
      {gate.questions.map((question, questionIndex) => (
        <fieldset key={`${question.header}-${questionIndex}`} className="janus-question-item">
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
            <input
              type="text"
              className="janus-question-custom"
              value={custom[questionIndex] ?? ''}
              placeholder={t('janus:chat.question.customPlaceholder')}
              aria-label={t('janus:chat.question.customAria', { header: question.header })}
              onChange={(event) => setCustom((current) => ({ ...current, [questionIndex]: event.target.value }))}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  submit()
                }
              }}
            />
          )}
        </fieldset>
      ))}
      <div className="janus-question-gate-actions">
        <button type="button" className="janus-question-cancel" onClick={() => onAnswer({ status: 'cancelled' })}>
          {t('janus:chat.question.cancel')}
        </button>
        <button type="button" className="janus-question-submit" disabled={!submittable} onClick={submit}>
          {t('janus:chat.question.submit')}
        </button>
      </div>
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
    : status.kind === 'thinking'
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
const FALLBACK_TURN_STATUS: JanusChatStatus = { kind: 'thinking' }
const CHAT_SIDEBAR_STORAGE_KEY = 'janus:chat-sidebar-collapsed'

export function JanusChat({
  visible,
  docked = false,
  compactNavigation = false,
  discussionOnly = false,
  minimalComposer = false,
  discussionFooter,
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
  const [historyPageSize, setHistoryPageSize] = useState(100)
  // Composer auto-grows from content (including soft-wrapped long lines) up to
  // MAX_COMPOSER_HEIGHT, then scrolls internally. Counting '\n' is not enough:
  // a single long line without newlines would stay one row high and overflow.
  const [showNewMessageBadge, setShowNewMessageBadge] = useState(false)
  const [selectionMenu, setSelectionMenu] = useState<SelectionMenu | null>(null)
  const [menuIndex, setMenuIndex] = useState(0)
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
  const messagesEndRef = useRef<HTMLSpanElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
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

  const showConversationSidebar = !!docked && !!conversations && !discussionOnly && !compactNavigation
  const copyMessage = useCallback((content: string) => {
    if (!navigator.clipboard) return
    void navigator.clipboard.writeText(content).catch(() => undefined)
  }, [])

  const inputHistory = messages
    .filter((message) => message.role === 'user')
    .map((message) => message.content)
  const providerOptions = getProviderMenuOptions(modelOptions)
  const activeProviderModels = activeModel
    ? modelOptions.filter((option) => option.providerId === activeModel.providerId)
    : modelOptions
  const permissionOptions = useMemo<PermissionOption[]>(() => [
    { value: 'per-action', label: t('janus:chat.permission.perAction') },
    { value: 'auto-run', label: t('janus:chat.permission.autoRun') },
    { value: 'plan', label: t('janus:chat.permission.plan') },
  ], [t])
  const menuOptions = selectionMenu === 'provider' ? providerOptions : activeProviderModels
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
    if (!container) return
    if (behavior === 'auto') {
      // Bypass CSS scroll-behavior so history hydration never animates.
      container.scrollTop = container.scrollHeight
      return
    }
    messagesEndRef.current?.scrollIntoView({ behavior })
  }, [])

  // 监听滚动，判断用户是否在底部
  const handleScroll = useCallback(() => {
    const container = messagesContainerRef.current
    if (!container) return
    const threshold = 20
    const atBottom = container.scrollHeight - container.scrollTop - container.clientHeight <= threshold
    isAtBottomRef.current = atBottom
    if (atBottom) {
      setShowNewMessageBadge(false)
    }
  }, [])

  useLayoutEffect(() => {
    const becameVisible = visible && !previousVisibleRef.current
    previousVisibleRef.current = visible
    if (!becameVisible) return

    immediateScrollRef.current = true
    const container = messagesContainerRef.current
    if (container) container.scrollTop = container.scrollHeight
    isAtBottomRef.current = true
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
        const inputElement = inputRef.current
        if (inputElement && !inputElement.disabled) inputElement.focus()
      }, 100)
    }
    return () => {
      if (focusTimerRef.current !== null) {
        window.clearTimeout(focusTimerRef.current)
        focusTimerRef.current = null
      }
    }
  }, [focused, visible])

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
    (textOverride?: string) => {
      const text = (textOverride ?? input).trim()
      // R6-lite：流式中发送由 hook 路由进排队（自然结束边界自动发出），此处不再拦截。
      if (!text) return

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
      onSend(text)
    },
    [input, onSend, scrollToBottom, discussionOnly]
  )

  // 输入变化；高度由上面的 auto-grow effect 按 scrollHeight 调整，
  // Shift+Enter 换行、长文本软换行都会长高，到上限后内部滚动。
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value)
    setHistoryIndex(null)
  }, [])

  const openSelectionMenu = useCallback((menu: SelectionMenu) => {
    if (minimalComposer) return
    if (menu === 'permission') {
      const activeIndex = permissionOptions.findIndex((option) => option.value === activeApprovalMode)
      setSelectionMenu(menu)
      setMenuIndex(activeIndex >= 0 ? activeIndex : 0)
      window.requestAnimationFrame(() => inputRef.current?.focus())
      return
    }
    const options = menu === 'provider'
      ? getProviderMenuOptions(modelOptions)
      : activeModel
        ? modelOptions.filter((option) => option.providerId === activeModel.providerId)
        : modelOptions
    const activeIndex = options.findIndex((option) => menu === 'provider'
      ? option.providerId === activeModel?.providerId
      : option.providerId === activeModel?.providerId && option.modelId === activeModel?.modelId)
    setSelectionMenu(menu)
    setMenuIndex(activeIndex >= 0 ? activeIndex : 0)
    window.requestAnimationFrame(() => inputRef.current?.focus())
  }, [activeApprovalMode, activeModel, minimalComposer, modelOptions, permissionOptions])

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
  }, [conversations, modelOptions, onApprovalModeChange, onSelectModel, selectionMenu])

  const handleMenuKey = useCallback((key: string): boolean => {
    if (!selectionMenu) return false
    if (key === 'Escape') {
      setSelectionMenu(null)
      return true
    }
    if (['ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight'].includes(key)) {
      const direction = key === 'ArrowUp' || key === 'ArrowLeft' ? -1 : 1
      const optionsLength = selectionMenu === 'permission' ? permissionOptions.length : menuOptions.length
      setMenuIndex((current) => optionsLength
        ? (current + direction + optionsLength) % optionsLength
        : 0)
      return true
    }
    if (key === 'Enter') {
      const option = selectionMenu === 'permission' ? permissionOptions[menuIndex] : menuOptions[menuIndex]
      if (option) selectMenuOption(option)
      return true
    }
    return false
  }, [menuIndex, menuOptions, permissionOptions, selectMenuOption, selectionMenu])

  const replaceInput = useCallback((value: string) => {
    setInput(value)
    window.requestAnimationFrame(() => inputRef.current?.setSelectionRange(value.length, value.length))
  }, [])

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
    if ((event.target as Element).closest('[data-island-companion]')) return
    const shortcutMenu = resolveChatSelectionShortcut({
      key: event.key,
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
      isComposing: event.nativeEvent.isComposing,
    })
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
  }, [handleMenuKey, openSelectionMenu, selectionMenu])

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
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.nativeEvent.isComposing) {
      const textarea = e.currentTarget
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
      const textarea = e.currentTarget
      const start = textarea.selectionStart ?? input.length
      const end = textarea.selectionEnd ?? input.length
      setInput(`${input.slice(0, start)}\n${input.slice(end)}`)
      setHistoryIndex(null)
      const caret = start + 1
      window.requestAnimationFrame(() => {
        const el = inputRef.current
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
  }, [handleSend, historyIndex, input, inputHistory, replaceInput])

  useEffect(() => {
    if (!visible || discussionOnly) return
    const handleGlobalKeyDown = (event: KeyboardEvent) => {
      const chatRoot = chatRootRef.current
      if (!chatRoot) return

      const activeElement = document.activeElement
      if (activeElement?.closest('[data-island-companion]')) return
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

      const shortcutMenu = resolveChatSelectionShortcut(event)
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
  }, [discussionOnly, focused, handleMenuKey, openSelectionMenu, selectionMenu, visible])

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
        && !(target instanceof Element && target.closest('[data-selection-trigger], .janus-chat-model-tag'))
      ) {
        setSelectionMenu(null)
      }
    }
    const closeMenusOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setThreadMenuOpen(false)
      setSelectionMenu(null)
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
  }, [selectionMenu, threadMenuOpen])

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

  return (
      <div
        ref={chatRootRef}
        hidden={!visible}
        data-compact-navigation={compactNavigation || undefined}
        data-minimal-composer={minimalComposer || undefined}
      tabIndex={-1}
      className={visible ? `janus-chat${docked ? ' janus-chat--docked' : ''}${discussionOnly ? ' janus-chat--discussion-only' : ''}${showConversationSidebar ? ' janus-chat--with-sidebar' : ''}${showConversationSidebar && sidebarCollapsed ? ' janus-chat--sidebar-collapsed' : ''}${hasConversation ? ' janus-chat--active' : ' janus-chat--empty'}${isRestoringScroll ? ' janus-chat--restoring-scroll' : ''}` : undefined}
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
      <div className="janus-chat-main">
      {!discussionOnly && !minimalComposer && <div className="janus-chat-toolbar">
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

      {resourceController && (resourceController.resources.length > 0 || attachableWorkspaces.length > 0) && !discussionOnly && !minimalComposer && (
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
      <div
        ref={messagesContainerRef}
        className="janus-chat-messages"
        style={messagesHidden ? { display: 'none' } : undefined}
        onScroll={handleScroll}
      >
        {messages.length === 0 && (emptyState ?? (
          <div className="janus-chat-empty">
            <JanusXTerminalBanner />
          </div>
        ))}

        {messages.length > historyPageSize && <button type="button" className="janus-chat-load-history" onClick={() => setHistoryPageSize(size => size + 100)}>{t('janus:chat.context.older')}</button>}
        {[...messages.slice(-historyPageSize).map((msg) => ({ kind: 'message' as const, timestamp: msg.timestamp, msg })), ...roundtableCards.map((card) => ({ kind: 'card' as const, timestamp: Date.parse(card.updatedAt || card.createdAt) || 0, card })), ...roundtableQuestions.map((block) => ({ kind: 'questions' as const, timestamp: block.timestamp, block}))]
          .sort((a, b) => a.timestamp - b.timestamp)
          .map((entry) => entry.kind === 'card' ? (
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
        ) : (() => { const msg = entry.msg; return (
          <div
            key={msg.id}
            className={`janus-chat-message ${msg.role}`}
          >
            <div className="janus-chat-message-meta">
              {msg.role === 'assistant' && (
                <div className="janus-chat-message-author">
                  {t('janus:chat.author.assistant')}
                </div>
              )}
              <time className="janus-chat-message-time" dateTime={new Date(msg.timestamp).toISOString()}>
                {formatMessageTime(msg.timestamp)}
              </time>
              {!discussionOnly && !minimalComposer && <div className="janus-chat-message-edit-actions">
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
                  <ThinkingRegion snapshot={activeReasoningByTurn[msg.id]} streaming={false} />
                )}
                <MarkdownContent content={msg.content} />
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
          </div>
        )})() )}

        {(isStreaming || pendingContent || (error && liveToolTraces.length > 0)) && (
          <div className="janus-chat-message assistant streaming">
            <div className="janus-chat-message-author">{t('janus:chat.author.assistant')}</div>
            <div className="janus-chat-message-content">
              {isStreaming && <TurnStatusRow status={activeTurnStatus} startedAt={activeTurnStartedAt} />}
              {(activeTimeline?.blocks.length || activeTimeline?.truncated) ? <ChatTimeline snapshot={activeTimeline} streaming={isStreaming} workspaceNames={workspaceNames} renderToolDetails={renderToolDetails} /> : <>
              <ThinkingRegion snapshot={activePendingReasoning} streaming={isStreaming} startedAt={activeTurnStartedAt} />
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
              <ToolCallGroup entries={liveToolTraces} workspaceNames={workspaceNames} />
              </>}
              {renderTurnFooter?.(undefined, activeTimeline)}
            </div>
          </div>
        )}

        {error && (
          <div className="janus-chat-error-card">
            {isStreaming && <div role="status">{t('janus:chat.recoveringTools')}</div>}
            <div className="janus-chat-error-text">{error}</div>
            <div className="janus-chat-error-actions">
              <button className="janus-chat-retry" onClick={handleRetry} disabled={isStreaming}>
                {t('common:action.retry')}
              </button>
            </div>
          </div>
        )}

        {discussionFooter}
        <span ref={messagesEndRef} className="janus-chat-end-anchor" />

        {showNewMessageBadge && (
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
      </div>

      {/* Agent todo 条 + 中途提问门（janus-agent parity，位于 composer 上方） */}
      <TodoStrip todos={activeTodos} />
      {answerQuestion && activePendingQuestions.map((gate) => (
        <QuestionGate key={gate.callId} gate={gate} onAnswer={(answer) => answerQuestion(gate.callId, answer)} />
      ))}

      {aboveComposer}
      <ChatContextIndicator controller={conversations} />

      {/* 输入区域：opencode 风格方框 composer；minimal 下加 › 前缀（对齐蓝图高保真） */}
      <div className="janus-chat-input-wrapper" data-has-input={input.length > 0}>
        <div className="janus-chat-composer-row">
          {minimalComposer && <span className="janus-chat-prompt-prefix" aria-hidden="true">›</span>}
          <textarea
            ref={inputRef}
            className="janus-chat-input"
            rows={1}
            wrap="soft"
            placeholder={isStreaming ? t('janus:chat.queue.inputPlaceholder') : (inputPlaceholderOverride ?? t('janus:chat.inputPlaceholder'))}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            style={{ '--accent-color': modeColor } as React.CSSProperties}
          />
          {isStreaming ? (
            <>
              <button
                className="janus-chat-stop"
                onClick={handleStop}
                style={{ '--accent-color': modeColor } as React.CSSProperties}
                title={t('janus:chat.stop.title')}
                aria-label={t('janus:chat.stop.aria')}
                type="button"
              >
                <StopIcon />
              </button>
              <button
                className="janus-chat-send"
                onClick={() => handleSend()}
                disabled={!input.trim()}
                title={t('janus:chat.queue.sendTitle')}
                aria-label={t('janus:chat.queue.sendAria')}
                type="button"
              >
                {minimalComposer ? <span aria-hidden="true">↑</span> : <Send size={14} strokeWidth={2} aria-hidden="true" />}
              </button>
            </>
          ) : (
            <button
              className="janus-chat-send"
              onClick={() => handleSend()}
              disabled={!input.trim()}
              title={t('janus:chat.send.title')}
              aria-label={t('janus:chat.send.aria')}
              type="button"
            >
              {minimalComposer ? <span aria-hidden="true">↑</span> : <Send size={14} strokeWidth={2} aria-hidden="true" />}
            </button>
          )}
        </div>
        {!discussionOnly && !minimalComposer && <div className="janus-chat-status-bar">
          <button
            type="button"
            className="janus-chat-model-tag"
            onPointerDown={(event) => handleSelectionTriggerPointerDown(event, 'model')}
            onClick={() => openSelectionMenu('model')}
            title={t('janus:chat.model.menuShortcutTitle')}
          >
            <span>{t('janus:chat.model.tagLabel')}</span>
            <strong>{activeModelLabel}</strong>
          </button>
          <div className="janus-chat-status-actions">
            {conversations && <MemoPanel compactTrigger onBindMemo={conversations.bindMemo} />}
            <div className="janus-chat-shortcuts">
              <button
                type="button"
                data-selection-trigger="provider"
                aria-label={t('janus:chat.selectionMenu.aria', { kind: 'provider' })}
                onPointerDown={(event) => handleSelectionTriggerPointerDown(event, 'provider')}
                onClick={() => openSelectionMenu('provider')}
              >
                <kbd>tab</kbd> {t('janus:chat.shortcuts.providers')}
              </button>
              <button
                type="button"
                data-selection-trigger="model"
                aria-label={t('janus:chat.selectionMenu.aria', { kind: 'model' })}
                onPointerDown={(event) => handleSelectionTriggerPointerDown(event, 'model')}
                onClick={() => openSelectionMenu('model')}
              >
                <kbd>ctrl+p</kbd> {t('janus:chat.shortcuts.models')}
              </button>
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
          </div>
          {selectionMenu && (
            <div
              ref={selectionMenuRef}
              className="janus-chat-model-menu"
              role="listbox"
              data-selection-menu={selectionMenu}
              aria-label={t('janus:chat.selectionMenu.aria', { kind: selectionMenu })}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <div className="janus-chat-model-menu-heading">
                <strong>{selectionMenu === 'provider' ? t('janus:chat.model.providersHeading') : selectionMenu === 'model' ? t('janus:chat.model.modelsHeading') : t('janus:chat.permission.label')}</strong>
                <span>{t('janus:chat.model.menuNavHint')}</span>
              </div>
              {(selectionMenu === 'permission' ? permissionOptions : menuOptions).map((option, index) => {
                const permissionOption = option as PermissionOption
                const modelOption = option as ChatModelOption
                return (
                <button
                  key={selectionMenu === 'permission' ? permissionOption.value : `${modelOption.providerId}:${modelOption.modelId}`}
                  type="button"
                  role="option"
                  aria-selected={index === menuIndex}
                  data-active={selectionMenu === 'permission'
                    ? activeApprovalMode === permissionOption.value
                    : selectionMenu === 'provider'
                    ? activeModel?.providerId === modelOption.providerId
                    : activeModel?.providerId === modelOption.providerId && activeModel.modelId === modelOption.modelId}
                  data-highlighted={index === menuIndex}
                  onMouseEnter={() => setMenuIndex(index)}
                  onClick={() => selectMenuOption(option)}
                >
                  {selectionMenu === 'permission' ? <strong>{permissionOption.label}</strong> : <><span>{modelOption.providerName}</span><strong>{modelOption.modelId}</strong></>}
                </button>
                )
              })}
              {selectionMenu !== 'permission' && menuOptions.length === 0 && (
                <div className="janus-chat-model-menu-empty">
                  {t('janus:chat.model.noConfigured', { kind: selectionMenu })}
                </div>
              )}
            </div>
          )}
          </div>
        }
      </div>
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
  )
}
