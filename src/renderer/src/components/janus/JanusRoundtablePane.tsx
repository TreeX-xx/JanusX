import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { UsersRound } from 'lucide-react'
import type { JanusResourceController, Message } from './useJanusChat'
import { RoundtableStage, type RoundtableRole, type RoundtableStageParticipant } from './RoundtableStage'
import type { AgentResultCard } from '../../../../shared/roundtable/events'
import type { RoundtableState } from '../../../../shared/roundtable/events'
import { EMPTY_AGENT_WORK_PROJECTION, reconcilePendingUserMessages, reduceAgentWorkEvent, type AgentWorkProjection, type PendingUserInput } from './agentWorkProjection'
import { AgentResultCard as AgentResultCardView } from './AgentResultCard'
import type { RoundtableHostQuestionBlock } from './JanusChat'
import { buildRoundtableFilename, fetchRoundtableMarkdown, saveMarkdownViaDialog } from './roundtableExport'
import { RoundtableArtifactCard } from './RoundtableArtifactCard'

const ROUNDTABLE_SESSION_KEY = 'janusx.roundtable.sessionId'

interface JanusRoundtablePaneProps {
  className?: string
  onClose: () => void
  embedded?: boolean
  resourceController: JanusResourceController
  parchmentOpen: boolean
  parchmentDetailOpen: boolean
  onToggleParchment: () => void
  onOpenParchmentDetail: () => void
  center?: (onSend: (text: string) => void, messages: Message[], workingRole: RoundtableRole | null, cards: AgentResultCard[], hostQuestions?: RoundtableHostQuestionBlock[], inputPlaceholder?: string) => ReactNode
  workingAgents?: string[]
  resultCards?: AgentResultCard[]
  onOpenAgentResult?: (card: AgentResultCard) => void
  onOpenQuestions?: () => void
  onStateChange?: (state: RoundtableState | null) => void
  /** Animated auxiliary close owned by the Island (same rhythm as Collapse). */
  onRequestAuxiliaryClose?: () => void
}

const stageParticipants: RoundtableStageParticipant[] = [
  { id: 'user', name: '用户', label: '提议人', identity: 'teammate', color: 'var(--role-teammate)' },
  { id: 'host', name: 'JanusX', label: '主持人', identity: 'main', color: 'var(--primary)' },
  { id: 'agent-1', name: 'Agent-1', label: '议题解决者', identity: 'coder', color: 'var(--role-coder)' },
  { id: 'agent-2', name: 'Agent-2', label: '议题完善者', identity: 'evaluator', color: 'var(--role-evaluator)' },
]

/** Map a runtime agent id to its dialog display name and card role. The host
 * runs as `janusx` (see defaultRoundtableWorkflow); it must not fall through
 * to the refiner/challenger branches. */
function describeLiveAgent(agentId: string): { title: string; role: 'host' | 'refiner' | 'challenger' } {
  if (agentId === 'janusx' || agentId === 'host' || agentId.startsWith('host')) return { title: '主持人', role: 'host' }
  if (agentId.startsWith('challenger')) return { title: '议题完善者', role: 'challenger' }
  return { title: '议题解决者', role: 'refiner' }
}

/** Map a runtime agent id to the 3D stage seat. Unknown ids light nothing. */
function toWorkingRole(agentId: string | undefined): RoundtableRole | null {
  if (!agentId) return null
  if (agentId === 'janusx' || agentId === 'host' || agentId.startsWith('host')) return 'host'
  if (agentId === 'agent-2' || agentId.startsWith('challenger')) return 'agent-2'
  if (agentId === 'agent-1' || agentId.startsWith('refiner')) return 'agent-1'
  return null
}

export function JanusRoundtablePane({
  className,
  onClose,
  embedded = false,
  resourceController,
  parchmentOpen,
  parchmentDetailOpen,
  onToggleParchment,
  onOpenParchmentDetail,
  center,
  onOpenAgentResult,
  onOpenQuestions,
  onStateChange,
  onRequestAuxiliaryClose,
}: JanusRoundtablePaneProps) {
  void onClose
  void resourceController
  const [roundtableState, setRoundtableState] = useState<RoundtableState | null>(null)
  const [work, setWork] = useState<AgentWorkProjection>(EMPTY_AGENT_WORK_PROJECTION)
  const [pendingInputs, setPendingInputs] = useState<PendingUserInput[]>([])
  const restoreAttempted = useRef(false)
  // Stage E: at-most-once dispatch per click. Renderer state lags behind the
  // main process, so rapid clicks would otherwise send duplicate IPC calls.
  const dispatchBusy = useRef(false)
  // Optimistic UI keeps the dialog status responsive while the first runtime
  // event is still crossing IPC. It intentionally drives STATUS TEXT ONLY —
  // no synthetic named cards: fake refiner/challenger placeholders flashed on
  // every send and misled the dialog about who is actually working.
  const [optimisticRun, setOptimisticRun] = useState(false)
  // Ended-meeting export feedback. Canceled/failed saves never clear the
  // dialog; the FINAL draft stays until the user starts a new topic.
  const [exportBusy, setExportBusy] = useState(false)
  const [exportNotice, setExportNotice] = useState<string | null>(null)
  // Staged new-topic exit: the auxiliary Island plays its shared exit first
  // while the dialog fades, and state resets only after both finished —
  // instead of everything snapping to empty in the same frame.
  const [dismissing, setDismissing] = useState(false)
  const dismissTimer = useRef<number | null>(null)
  useEffect(() => () => {
    if (dismissTimer.current !== null) window.clearTimeout(dismissTimer.current)
  }, [])
  const updateState = (next: RoundtableState | null) => {
    setRoundtableState(next)
    if (next?.cards?.length) setWork((current) => ({ ...current, cards: next.cards }))
    // Snapshots also carry agent failures (`agentId: message`). Merge them so
    // errors stay visible even when their events were missed (remount gap).
    if (next?.errors?.length) setWork((current) => {
      const errors = { ...current.errors }
      for (const entry of next.errors) {
        const sep = entry.indexOf(':')
        if (sep > 0) errors[entry.slice(0, sep)] = entry.slice(sep + 1).trim()
      }
      return Object.keys(errors).length === Object.keys(current.errors).length ? current : { ...current, errors }
    })
    if (next && (next.phase === 'awaiting-user' || next.phase === 'ended')) {
      // The snapshot says the round is over, so the optimistic running status
      // is over too. Clear it here as well as on the event stream: the IPC
      // resolve and the event can arrive in either order.
      setOptimisticRun(false)
      // The snapshot says the round is over, but its lifecycle events may have
      // been missed (remount gap, restore). Mirror the reducer's round-boundary
      // clearing so stale working flags can't outlive the round.
      setWork((current) => (current.workingAgents.length === 0 && current.queuedAgents.length === 0
        ? current
        : { ...current, workingAgents: [], queuedAgents: [] }))
    }
    if (next) setPendingInputs((items) => reconcilePendingUserMessages(next.userMessages, items))
    onStateChange?.(next)
  }

  // Stage D: the store is the stable source. Reattach to the last session on
  // mount (Island remount, refresh) instead of starting blank.
  useEffect(() => {
    try {
      if (roundtableState?.sessionId) localStorage.setItem(ROUNDTABLE_SESSION_KEY, roundtableState.sessionId)
    } catch { /* private mode: stay memory-only */ }
  }, [roundtableState?.sessionId])

  useEffect(() => {
    if (roundtableState || restoreAttempted.current) return
    restoreAttempted.current = true
    let id: string | null = null
    try { id = localStorage.getItem(ROUNDTABLE_SESSION_KEY) } catch { id = null }
    if (!id || !window.electron.roundtable) return
    let cancelled = false
    void window.electron.roundtable.restore(id).then((restored) => {
      if (!restored || cancelled) return
      updateState(restored)
    }).catch(() => undefined)
    return () => { cancelled = true; restoreAttempted.current = false }
  })

  useEffect(() => window.electron.roundtable?.onEvent((event) => {
    setWork((current) => reduceAgentWorkEvent(current, event))
    // user:message events arrive before the start/advance round-trip resolves,
    // so the discussion stream stays responsive and survives remounts.
    if (event.type === 'user:message') {
      setRoundtableState((current) => {
        if (!current || current.sessionId !== event.sessionId) return current
        if (current.userMessages.some((item) => item.id === event.message.id)) return current
        return { ...current, userMessages: [...current.userMessages, event.message] }
      })
      // NOTE: do NOT clear pendingInputs here. On initial start current is
      // null (no session yet), so the state update above is a no-op while the
      // start() IPC stays pending for the whole first round. Clearing pending
      // on the event would make the just-sent user bubble vanish until the
      // round completes. Render already dedupes pending vs confirmed, and
      // updateState() reconciles pending once start()/advance() resolves.
      return
    }
      setRoundtableState((current) => {
      if (!current) return current
      if (event.type === 'session:ended') { setOptimisticRun(false); return { ...current, phase: 'ended' } }
      if (event.type === 'round:started') return { ...current, phase: 'running', roundNumber: event.roundNumber, userInput: event.userInput }
      if (event.type === 'round:awaiting-user') { setOptimisticRun(false); return { ...current, phase: 'awaiting-user', roundNumber: event.roundNumber } }
      return current
      })
  }) ?? (() => undefined), [])

  const handleCenterSend = async (text: string) => {
    const current = roundtableState
    const trimmed = text.trim()
    const willStart = !current || current.phase === 'idle' || current.phase === 'ended'
    const willAdvance = !willStart && current.phase === 'awaiting-user' && !!current.sessionId
    // Empty input is a valid advance ("continue from shared state"); only a
    // fresh start requires non-empty text. Previously `!trimmed` rejected the
    // "开启下一轮" button outright, making it a dead control.
    if ((!willStart && !willAdvance) || (willStart && !trimmed)) return
    if (!window.electron.roundtable || dispatchBusy.current) return
    // Optimistic UI: show the user bubble on the right immediately, while the
    // left agent deck shows working cards. The pending entry survives until
    // start()/advance() resolves and updateState() reconciles it against the
    // confirmed userMessages. Empty advances intentionally leave no bubble.
    const hasSupplement = trimmed.length > 0
    const pendingId = hasSupplement ? `roundtable-user-${Date.now()}-${Math.random().toString(36).slice(2)}` : null
    const targetRound = willStart ? 1 : (current?.roundNumber ?? 0) + 1
    const pendingTimestamp = Date.now()
    setOptimisticRun(true)
    if (pendingId) {
      setPendingInputs((items) => [...items, {
        id: pendingId,
        content: trimmed, roundNumber: targetRound, timestamp: pendingTimestamp,
      }])
    }
    try {
      if (willStart) {
        dispatchBusy.current = true
        try {
          const next = await window.electron.roundtable.start({
            prompt: text,
            workspaceResources: resourceController.resources.map(({ workspaceId, workspacePath, workspaceName }) => ({ workspaceId, workspacePath, workspaceName })),
          })
          updateState(next)
        } finally {
          dispatchBusy.current = false
        }
        return
      }
      if (willAdvance && current?.sessionId) {
        dispatchBusy.current = true
        try {
          const requestId = `advance-${Date.now()}-${Math.random().toString(36).slice(2)}`
          const next = await window.electron.roundtable.advance(current.sessionId, trimmed, requestId)
          updateState(next)
        } finally {
          dispatchBusy.current = false
        }
      }
    } catch {
      // Dispatch failed: roll back the optimistic bubble so a retry shows a
      // single message. Runtime errors otherwise surface via the event stream.
      if (pendingId) setPendingInputs((items) => items.filter((item) => item.id !== pendingId))
      setOptimisticRun(false)
    }
  }
  const handleEnd = async () => {
    if (!roundtableState?.sessionId || roundtableState.phase === 'running' || dispatchBusy.current) return
    if (!window.electron.roundtable) return
    dispatchBusy.current = true
    try {
      // Retain the FINAL draft: the ended banner offers save/new-topic
      // on top of the final state instead of discarding it unseen.
      const final = await window.electron.roundtable.end(roundtableState.sessionId)
      updateState({ ...final, phase: 'ended' })
      onOpenParchmentDetail()
    } catch {
      // End failures keep the dialog: the error surfaces via events and the
      // user can retry. Per product rule, a failed end must not wipe history.
      setExportNotice('结束会议失败，请重试。')
    } finally {
      dispatchBusy.current = false
    }
  }
  const handleDismissToNewTopic = () => {
    // Explicit "new topic" is the only path that clears an ended meeting.
    // Staged: shared auxiliary exit + dialog fade run first; the reset lands
    // after, so the room never blinks to empty mid-animation.
    if (dismissing) return
    setDismissing(true)
    onRequestAuxiliaryClose?.()
    if (dismissTimer.current !== null) window.clearTimeout(dismissTimer.current)
    dismissTimer.current = window.setTimeout(() => {
      dismissTimer.current = null
      try { localStorage.removeItem(ROUNDTABLE_SESSION_KEY) } catch { /* private mode */ }
      setRoundtableState(null)
      setWork(EMPTY_AGENT_WORK_PROJECTION)
      setPendingInputs([])
      setOptimisticRun(false)
      setExportNotice(null)
      setDismissing(false)
      onStateChange?.(null)
    }, 300)
  }
  const handleSaveFinal = async () => {
    const sessionId = roundtableState?.sessionId
    if (!sessionId || exportBusy) return
    setExportBusy(true)
    setExportNotice(null)
    try {
      const markdown = await fetchRoundtableMarkdown(sessionId)
      const outcome = await saveMarkdownViaDialog(buildRoundtableFilename({ userInput: roundtableState?.userInput, roundNumber: roundtableState?.roundNumber ?? 0, phase: 'ended' }), markdown)
      setExportNotice(outcome === 'saved' ? '纪要已保存。' : '已取消保存，终稿仍保留。')
    } catch {
      setExportNotice('保存失败，终稿仍保留，请重试。')
    } finally {
      setExportBusy(false)
    }
  }
  const dialogStatus = !roundtableState || roundtableState.phase === 'idle'
    ? (optimisticRun || pendingInputs.length > 0
        ? `第 ${pendingInputs[0]?.roundNumber ?? 1} 轮讨论中`
        : '等待议题')
    : roundtableState.phase === 'running'
      ? `第 ${roundtableState.roundNumber} 轮讨论中`
      : roundtableState.phase === 'ended'
        ? '会议已结束 · FINAL'
        : `第 ${roundtableState.roundNumber} 轮已完成`
  const roundtableMessages: Message[] = [
    ...(roundtableState?.userMessages ?? []).map((item) => ({
      id: item.id, role: 'user' as const, content: item.text, timestamp: Date.parse(item.createdAt) || 0,
    })),
    ...pendingInputs
      .filter((item) => !(roundtableState?.userMessages.some((msg) => msg.text === item.content && msg.roundNumber === item.roundNumber)))
      .map((item) => ({ id: item.id, role: 'user' as const, content: item.content, timestamp: item.timestamp })),
  ]
  // History: an optimistic refiner+challenger pair used to fill the
  // send -> first-event gap, but it flashed fake named cards on every send
  // and once resurrected mid-round (5 cards instead of 3). Live cards are now
  // real runtime events only; the gap shows status text + deck empty state.
  // Live cards are driven EXCLUSIVELY by real runtime events (working, else
  // queued for inter-stage handoff, e.g. challenger done and host `janusx`
  // queued). No synthetic placeholders: before the first event the dialog
  // shows the running status text and the deck keeps its empty state.
  const liveAgentIds = work.workingAgents.length > 0
    ? work.workingAgents
    : work.queuedAgents.length > 0
      ? work.queuedAgents
      : []
  // Stable key: the arrays above are rebuilt every render, so memoizing on
  // array identity would mint fresh timestamps each render and keep the
  // placeholders pinned after the real cards.
  const liveAgentKey = liveAgentIds.join(',')
  const workingKey = work.workingAgents.join(',')
  const liveAgentCards = useMemo<AgentResultCard[]>(() => liveAgentKey.split(',').filter(Boolean).map((agentId) => {
    const isQueuedOnly = !work.workingAgents.includes(agentId)
    const { title, role } = describeLiveAgent(agentId)
    return {
      id: `working-${agentId}`, sessionId: roundtableState?.sessionId ?? '', roundId: `round-${roundtableState?.roundNumber ?? 0}`,
      agentId, role,
      title, status: isQueuedOnly ? 'queued' : 'working', summary: isQueuedOnly ? '已排队，等待开始本轮工作…' : '正在分析本轮上下文并准备结构化结果…',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), sourceEventIds: [],
    }
    // liveAgentKey/workingKey carry the value semantics; the source arrays
    // intentionally stay out of the dep list (new identity every render).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [liveAgentKey, workingKey, roundtableState?.roundNumber, roundtableState?.sessionId])
  const deckCards = [...liveAgentCards, ...work.cards]
  const workingRole = toWorkingRole(liveAgentIds[0])
  // §37.8: open member questions surface without opening any card. Resolved
  // and rejected entries leave the list; the banner pins above the composer
  // while the bubble below joins the discussion stream.
  const openQuestions = (roundtableState?.facts ?? []).filter((fact) => fact.kind === 'question' && fact.status !== 'resolved' && fact.status !== 'rejected')
  const answeredCount = (roundtableState?.facts ?? []).filter((fact) => fact.kind === 'question' && fact.status === 'resolved').length
  const showQuestions = !!roundtableState && (roundtableState.phase === 'awaiting-user' || roundtableState.phase === 'running') && openQuestions.length > 0
  const questionBlocks: RoundtableHostQuestionBlock[] = showQuestions && roundtableState
    ? [{
        roundNumber: roundtableState.roundNumber,
        questions: openQuestions.map((fact) => ({ id: fact.id, text: fact.content })),
        answeredCount,
        timestamp: Math.max(...openQuestions.map((fact) => Date.parse(fact.updatedAt) || 0)),
      }]
    : []
  const showQuestionsBanner = roundtableState?.phase === 'awaiting-user' && openQuestions.length > 0
  const questionsPlaceholder = showQuestionsBanner ? '回答 Q1… 或补充想法开启下一轮' : undefined

  const stopPointerPropagation = (event: ReactPointerEvent) => event.stopPropagation()

  return (
    <div
      className={`janus-roundtable-overlay${embedded ? ' janus-roundtable-overlay--embedded' : ''}${className ? ` ${className}` : ''}`}
      role="dialog"
      aria-modal={!embedded}
      aria-label="圆桌会议"
      onPointerDown={stopPointerPropagation}
      onPointerMove={stopPointerPropagation}
      onPointerUp={stopPointerPropagation}
      onPointerCancel={stopPointerPropagation}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <div className={`janus-roundtable-panel${dismissing ? ' janus-roundtable-panel--leaving' : ''}`}>
        <header className="janus-roundtable-header">
          <div className="janus-roundtable-title">
            <UsersRound size={16} aria-hidden="true" />
            <span>圆桌会议</span>
            <small>准备开始</small>
          </div>
        </header>

        <div className="janus-roundtable-body" data-parchment-open={parchmentOpen}>
          <aside className="janus-roundtable-participants" aria-label="参与者">
            <RoundtableStage
              participants={stageParticipants}
              workingRole={workingRole}
              ended={false}
              parchmentOpen={parchmentOpen}
              onToggleParchment={onToggleParchment}
            />
          </aside>
          <main className="janus-roundtable-center">
            <div className="janus-roundtable-dialog-toolbar" aria-label="会议操作">
              <span className="janus-roundtable-dialog-status">{dialogStatus}</span>
              <div className="janus-roundtable-dialog-actions">
                {roundtableState?.phase === 'awaiting-user' && <button type="button" className="janus-roundtable-advance" title="沿用当前方案继续讨论（可先在输入框补充想法）" onClick={() => void handleCenterSend('')}>开启下一轮</button>}
                {roundtableState?.phase === 'awaiting-user' && <button type="button" className="janus-roundtable-end" title="结束会议并生成终稿纪要" onClick={() => void handleEnd()}>结束会议</button>}
              </div>
            </div>
            {roundtableState?.phase === 'ended' ? (
              <div className="janus-roundtable-ended-banner" role="status" aria-label="会议已结束">
                <span className="janus-roundtable-ended-banner__text">会议已结束 · FINAL 纪要已生成</span>
                <div className="janus-roundtable-ended-banner__actions">
                  <button type="button" className="janus-roundtable-advance" disabled={exportBusy || dismissing} onClick={() => void handleSaveFinal()}>保存 Markdown</button>
                  <button type="button" className="janus-roundtable-end" disabled={dismissing} onClick={handleDismissToNewTopic}>开新议题</button>
                </div>
                {exportNotice ? <span className="janus-roundtable-ended-banner__notice">{exportNotice}</span> : null}
              </div>
            ) : null}
            {roundtableState?.sessionId && (roundtableState.facts?.length ?? 0) > 0 ? (
              <RoundtableArtifactCard
                sessionId={roundtableState.sessionId}
                facts={roundtableState.facts}
                roundNumber={roundtableState.roundNumber}
                cwd={resourceController.resources[0]?.workspacePath ?? null}
              />
            ) : null}
            {Object.keys(work.errors).length > 0 ? (
              <div className="janus-roundtable-error-banner" role="alert" aria-label="Agent 失败">
                {Object.entries(work.errors).map(([agentId, message]) => (
                  <details key={agentId} className="janus-roundtable-error-item" open={Object.keys(work.errors).length === 1}>
                    <summary>{agentId} 失败</summary>
                    <p>{message}</p>
                  </details>
                ))}
              </div>
            ) : null}
            {showQuestionsBanner ? (
              <div className="janus-roundtable-questions-banner" role="status" aria-label="待回答问题">
                <span className="janus-roundtable-questions-banner__text">待回答 {openQuestions.length} · {openQuestions.slice(0, 2).map((fact, index) => `Q${index + 1}${fact.content.slice(0, 24)}`).join('；')}{openQuestions.length > 2 ? '…' : ''}</span>
                <span className="janus-roundtable-questions-banner__hint">在下方直接回答，或点「开启下一轮」跳过</span>
                {onOpenQuestions ? <button type="button" className="janus-roundtable-questions-banner__detail" onClick={onOpenQuestions}>查看详情</button> : null}
              </div>
            ) : null}
            {center?.(handleCenterSend, roundtableMessages, workingRole, deckCards, questionBlocks, questionsPlaceholder)}
          </main>
          <aside className="janus-roundtable-state">
            <div className="janus-roundtable-agent-deck" aria-label="Agent 工作卡片">
              <div className="janus-roundtable-deck-heading"><span>AGENT WORK DECK</span><small>{deckCards.length} ITEMS</small></div>
              {deckCards.length === 0 ? <p className="janus-roundtable-deck-empty">等待 Agent 返回可追溯结果</p> : deckCards.map((card) => (
                <AgentResultCardView key={card.id} card={card} onOpen={() => onOpenAgentResult?.(card)} />
              ))}
              {work.toolCalls.length > 0 ? (
                <div className="janus-roundtable-tool-trace" aria-label="工作区读取记录">
                  <div className="janus-roundtable-tool-trace-heading"><span>WORKSPACE READS</span><small>{work.toolCalls.filter((item) => item.status === 'started').length} ACTIVE / {work.toolCalls.length}</small></div>
                  {work.toolCalls.slice(-5).map((tool) => (
                    <div key={tool.toolCallId} className="janus-roundtable-tool-trace-item" data-status={tool.status}>
                      <span className="janus-roundtable-tool-trace-name">{tool.toolName}</span>
                      <span className="janus-roundtable-tool-trace-state">{tool.status === 'started' ? '读取中…' : tool.status}</span>
                      {tool.status === 'failed' ? (
                        <details className="janus-roundtable-tool-trace-error">
                          <summary>{tool.errorCode ?? 'FAILED'}</summary>
                          <p>{tool.error}</p>
                        </details>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
            <button
              type="button"
              className="janus-roundtable-parchment-expand"
              aria-label="展开羊皮纸"
              title="展开羊皮纸"
              aria-expanded={parchmentDetailOpen}
              aria-controls="janus-roundtable-parchment-detail"
              onClick={onOpenParchmentDetail}
            >
              <span className="janus-greek-expand-mark" aria-hidden="true">⟫</span>
            </button>
          </aside>
        </div>
      </div>
    </div>
  )
}
