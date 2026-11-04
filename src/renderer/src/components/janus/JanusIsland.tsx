import { useState, useCallback, useEffect, useMemo, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { Download, X } from 'lucide-react'
import { useAppStore } from '@/stores/app'
import { useI18n } from '@/i18n/useI18n'
import { JanusEye } from './JanusEye'
import { useIslandGesture } from './useIslandGesture'
import { useJanusGaze, type JanusGazeControls } from './useJanusGaze'
import { useIslandSpeak, type IslandSpeakControls } from './useIslandSpeak'
import { IslandNotificationCenter, notificationClock } from './IslandNotificationCenter'
import { useJanusState } from './useJanusState'
import { formatKnowledgeMatch } from './islandKnowledgePeek'
import {
  assembleNotifications,
  capsuleTier,
  EMPTY_CAPSULE_NOTIFICATION_ID,
  isEmptyCapsuleRequested,
  knowledgeNotification,
  memoryNotification,
  notificationActionLabelKey,
  notificationKickerKey,
  productNotification,
  topNotification,
  type IslandNotificationActionId,
} from './islandNotifications'
import { JanusIslandExpandedShell } from './JanusIslandExpandedShell'
import { pluginRequest, usePluginSnapshot } from '@/extensions/plugin-runtime'
import { pluginIslandNotifications, PluginIslandPreview } from '@/extensions/plugin-island'
import '@/extensions/plugin-surfaces.css'
import { useExtensionViews } from '@/extensions/react'
import { openPluginManager } from '@/extensions/plugin-configuration-navigation'
import { useIslandStore } from '@/stores/island'
import { useAutomationIslandLayout } from '../automations/useAutomationIslandLayout'
import { useAutomationsStore, subscribeAutomations, openAutomationRun } from '@/stores/automations'
import { automationNotification } from './islandNotifications'
import { useBrowserOcclusionStore } from '@/stores/browser-occlusion'
import {
  JanusAuxiliaryIsland,
  type JanusAuxiliaryModuleDescriptor,
  type JanusAuxiliaryModuleType,
} from './JanusAuxiliaryIsland'
import { JanusRoundtableParchment } from './JanusRoundtableParchment'
import { JanusRoundtableQuestions } from './JanusRoundtableQuestions'
import { buildRoundtableFilename, copyTextToClipboard, fetchRoundtableMarkdown, saveMarkdownViaDialog, withDraftWatermark } from './roundtableExport'
import type { AgentWorkState } from '../../../../shared/roundtable/events'

/** i18n keys for the six card states shown in the agent-result eyebrow. */
const ROUNDTABLE_CARD_STATUS_KEYS: Record<AgentWorkState, string> = {
  queued: 'janus:roundtable.cardDetail.status.queued',
  working: 'janus:roundtable.cardDetail.status.working',
  completed: 'janus:roundtable.cardDetail.status.completed',
  failed: 'janus:roundtable.cardDetail.status.failed',
  'awaiting-input': 'janus:roundtable.cardDetail.status.awaitingInput',
  cancelled: 'janus:roundtable.cardDetail.status.cancelled',
}
import { faceClass } from './janusIslandRuntime'
import { ISLAND_CHAT_ONLY } from './janusIslandTypes'

import { useRightToolStore } from '@/stores/right-tools'
import { useExperimentalStore } from '@/stores/experimental'
import { getUserMemoryOverview } from '@/services/knowledge'
import type { JanusExpandedView, JanusIslandProps } from './janusIslandTypes'
import type { RoundtableState } from '../../../../shared/roundtable/events'
import type { RoundtableToolCall } from './agentWorkProjection'
import { projectParchment } from '../../../../shared/roundtable/parchment'
import { useProjectRunning } from './useProjectRunning'
import { useIslandPresence } from '../island/islandMotion'
import { useAuxiliaryIslandLayout } from './useAuxiliaryIslandLayout'

/* ════════════════════════════════════════════════════════════
   JanusIsland �?52×26px 折叠态胶�?
   状态由 useJanusState 统一管理，视觉由 data-mode 属性驱�?
   ════════════════════════════════════════════════════════════ */

export function JanusIsland({
  stage = 'collapsed',
  onSingleActivate,
  onDoubleActivate,
  onDismiss,
  messages,
  pendingContent,
  isStreaming,
  error,
  modelOptions,
  activeModel,
  modelNotice,
  onChatSelectModel,
  onChatSend,
  onChatRewrite,
  onChatStop,
  onChatRetry,
  onChatClear,
  conversationController = null,
  resourceController,
  toolTraces = [],
  knowledgeTrace = null,
  knowledgePeekActive = false,
  knowledgePeekEmpty = false,
  productNotice = null,
  onOpenProductFile,
}: JanusIslandProps) {
  const { t } = useI18n('janus')
  const automationNotices = useAutomationsStore(state => state.notices)
  const removedAutomations = useAutomationsStore(state => state.removedIds)
  useEffect(subscribeAutomations, [])
  const { mode, isSwitching, activeWorkspace, eyeContainerRef, hasRunning } = useJanusState()
  const { janusRunning } = useProjectRunning(activeWorkspace)
  const shellRef = useRef<HTMLDivElement | null>(null)
  const companionToolId = useIslandStore(state => state.companionToolId)
  const [view, setStoredView] = useState<JanusExpandedView>('chat')
  const companionVeil = useAutomationIslandLayout(shellRef, stage === 'expanded' && view === 'chat' && companionToolId === 'automations')
  const setView = useCallback((next: JanusExpandedView) => setStoredView(ISLAND_CHAT_ONLY ? 'chat' : next), [])
  const pluginSnapshot = usePluginSnapshot()
  const hostCovered = useBrowserOcclusionStore(s => s.count > 0)
  const pluginViews = useExtensionViews()
  const pluginViewRequest = useIslandStore(s => s.pluginViewRequest)
  const lastPluginRequest = useRef(0)
  const [pluginActionFailure, setPluginActionFailure] = useState('')
  useEffect(() => {
    if (pluginViewRequest && pluginViewRequest.sequence !== lastPluginRequest.current && pluginViews.some(view => view.id === pluginViewRequest.viewId && view.location === 'island')) {
      lastPluginRequest.current = pluginViewRequest.sequence; setView(pluginViewRequest.viewId)
    }
  }, [pluginViewRequest, pluginViews, setView])
  useEffect(() => {
    useIslandStore.setState({ activePluginViewId: stage === 'expanded' && view.startsWith('extension:') ? view as `extension:${string}/${string}` : null })
  }, [stage, view])
  useEffect(() => {
    if (view.startsWith('extension:') && !pluginViews.some(item => item.id === view && item.location === 'island')) setView('monitor')
  }, [view, pluginViews, setView])

  const chatLoading = isStreaming || pendingContent.length > 0
  // P4 通知中心展开态（island 整体纵向变大；非 stage）
  const [notifOpen, setNotifOpen] = useState(false)
  const [trayOpen, setTrayOpen] = useState(false)
  const [selectedNoticeKey, setSelectedNoticeKey] = useState<string | null>(null)
  const notificationOpenerRef = useRef<HTMLElement | null>(null)

  // Legacy: the expanded island no longer drags, so a persisted offset from an
  // earlier build is dead state. Drop it once instead of leaving it behind.
  useEffect(() => {
    try {
      window.localStorage.removeItem('janus:island-drag-offset')
      window.localStorage.removeItem('janus:island-chat-pinned')
    } catch {
      /* persistence is best-effort */
    }
  }, [])
  const [parchmentOpen, setParchmentOpen] = useState(false)
  const [auxiliaryModule, setAuxiliaryModule] = useState<JanusAuxiliaryModuleType | null>(null)
  const [activeAgentCard, setActiveAgentCard] = useState<import('../../../../shared/roundtable/events').AgentResultCard | null>(null)
  const [roundtableState, setRoundtableState] = useState<RoundtableState | null>(null)
  const [roundtableToolCalls, setRoundtableToolCalls] = useState<RoundtableToolCall[]>([])
  const auxiliaryPresence = useIslandPresence(stage === 'expanded' && view === 'roundtable' && auxiliaryModule !== null)
  const lastAuxiliaryModule = useRef(auxiliaryModule)
  if (auxiliaryModule) lastAuxiliaryModule.current = auxiliaryModule
  const displayedAuxiliary = auxiliaryPresence.present ? auxiliaryModule ?? lastAuxiliaryModule.current : null
  const auxiliaryLayout = useAuxiliaryIslandLayout(shellRef, auxiliaryPresence.present, !auxiliaryModule || stage !== 'expanded' || view !== 'roundtable')
  const auxiliaryOpener = useRef<Element | null>(null)
  const openAuxiliary = (module: JanusAuxiliaryModuleType) => {
    if (!auxiliaryPresence.present) auxiliaryOpener.current = document.activeElement
    setAuxiliaryModule(module)
  }
  // Parchment detail export (mid-meeting DRAFT or ended FINAL). Read-only
  // snapshot: never advances the round or ends the meeting.
  const [parchmentExportBusy, setParchmentExportBusy] = useState(false)
  const [parchmentExportNotice, setParchmentExportNotice] = useState<string | null>(null)

  const handleParchmentExport = useCallback(async () => {
    const state = roundtableState
    if (!state?.sessionId || state.phase === 'idle' || state.phase === 'running' || parchmentExportBusy) return
    setParchmentExportBusy(true)
    setParchmentExportNotice(null)
    try {
      const raw = await fetchRoundtableMarkdown(state.sessionId)
      const markdown = state.phase === 'ended' ? raw : withDraftWatermark(raw, state.roundNumber)
      const outcome = await saveMarkdownViaDialog(buildRoundtableFilename(state), markdown)
      setParchmentExportNotice(outcome === 'saved' ? 'saved' : 'canceled')
    } catch {
      setParchmentExportNotice('error')
    } finally {
      setParchmentExportBusy(false)
    }
  }, [roundtableState, parchmentExportBusy])

  const handleParchmentCopy = useCallback(async () => {
    const state = roundtableState
    if (!state?.sessionId || parchmentExportBusy) return
    setParchmentExportBusy(true)
    setParchmentExportNotice(null)
    try {
      const raw = await fetchRoundtableMarkdown(state.sessionId)
      await copyTextToClipboard(state.phase === 'ended' ? raw : withDraftWatermark(raw, state.roundNumber))
      setParchmentExportNotice('copied')
    } catch {
      setParchmentExportNotice('error')
    } finally {
      setParchmentExportBusy(false)
    }
  }, [roundtableState, parchmentExportBusy])

  // Ending a meeting clears the dialog (pane reports null): drop the detail
  // island and its card/parchment state so no stale session stays visible.
  useEffect(() => {
    if (roundtableState) return
    setActiveAgentCard(null)
    setAuxiliaryModule((module) => (module === 'agent-result' || module === 'roundtable-parchment' || module === 'roundtable-questions' ? null : module))
    setParchmentOpen(false)
  }, [roundtableState])
  const setActiveWorkbench = useAppStore((s) => s.setActiveWorkbench)
  const roundtableEnabled = useExperimentalStore((s) => s.roundtable)
  const personaEnabled = useExperimentalStore((s) => s.persona)
  const loadExperimental = useExperimentalStore((s) => s.load)

  useEffect(() => {
    void loadExperimental()
  }, [loadExperimental])

  // 创新开关关闭圆桌时，若正停在圆桌视图则退回聊天，避免悬空态。
  useEffect(() => {
    if (!roundtableEnabled && view === 'roundtable') setView('chat')
  }, [roundtableEnabled, view, setView])

  // User memory M4: quiet badge for habit candidates awaiting review. Mount
  // plus recall-turn refresh; failures stay silent (no badge, no banner).
  const knowledgeTraceRequestId = knowledgeTrace?.requestId
  const [memoryPending, setMemoryPending] = useState(0)
  useEffect(() => {
    if (!personaEnabled) {
      setMemoryPending(0)
      return
    }
    let alive = true
    void getUserMemoryOverview().then((overview) => {
      if (alive) setMemoryPending(overview?.pendingHabitCount ?? 0)
    }).catch(() => undefined)
    return () => {
      alive = false
    }
  }, [knowledgeTraceRequestId, personaEnabled])

  const janusGazeRef = useRef<JanusGazeControls | null>(null)
  const islandSpeakRef = useRef<IslandSpeakControls | null>(null)

  const selectNotice = useCallback((key: string | null) => {
    setSelectedNoticeKey(key)
    if (key) islandSpeakRef.current?.markRead(key)
  }, [])
  const prepareNoticeReader = useCallback((key?: string) => {
    notificationOpenerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const speak = islandSpeakRef.current
    const history = speak?.snapshot.history ?? []
    selectNotice(key ?? speak?.snapshot.speaking?.key ?? [...history].reverse().find(item => !item.read)?.key ?? history.at(-1)?.key ?? null)
    speak?.silence()
  }, [selectNotice])
  const openNotifCenter = useCallback((key?: string) => {
    prepareNoticeReader(key)
    setNotifOpen(true)
  }, [prepareNoticeReader])
  const closeNotifications = useCallback((restoreFocus = true) => {
    setNotifOpen(false)
    setTrayOpen(false)
    if (restoreFocus) {
      // The opener may be hidden until the reader has actually unmounted.
      requestAnimationFrame(() => {
        const opener = notificationOpenerRef.current
        const target = opener?.isConnected && opener.getClientRects().length ? opener
          : shellRef.current?.querySelector<HTMLElement>('.janus-island')
        target?.focus({ preventScroll: true })
      })
    }
  }, [])
  const closeNotifCenter = useCallback(() => closeNotifications(), [closeNotifications])
  const toggleTray = useCallback(() => {
    if (trayOpen) closeNotifications()
    else { prepareNoticeReader(); setTrayOpen(true) }
  }, [trayOpen, closeNotifications, prepareNoticeReader])
  const handleDoubleTap = useCallback(() => {
    closeNotifications(false)
    onDoubleActivate()
  }, [closeNotifications, onDoubleActivate])
  const handleSingleTap = useCallback(() => {
    if (stage === 'collapsed') {
      if (notifOpen) closeNotifCenter()
      else openNotifCenter()
      return
    }
    onSingleActivate()
  }, [stage, notifOpen, closeNotifCenter, openNotifCenter, onSingleActivate])

  const handleIslandKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.repeat || event.target !== event.currentTarget) return
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    event.stopPropagation()
    handleSingleTap()
  }, [handleSingleTap])

  const handleSwipeDown = useCallback(() => {
    // 下拉达到阈值后松手展开通知面板；面板已展开时保持展开。
    if (stage === 'peek') onDismiss()
    if (!notifOpen) openNotifCenter()
  }, [stage, onDismiss, notifOpen, openNotifCenter])

  const handleOpenPlugins = useCallback(() => {
    onDismiss()
    openPluginManager()
  }, [onDismiss])

  // Eye gestures keep their companion animation; only explicit controls dismiss a notice.
  const handleQuickTap = useCallback(() => { janusGazeRef.current?.react('flinch') }, [])

  const {
    islandRef,
    pullHintRef,
    isDraggingRef,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handlePointerCancel,
  } = useIslandGesture({
    onSwipeDown: handleSwipeDown,
    onDoubleTap: handleDoubleTap,
    onSingleTap: handleSingleTap,
    onQuickTap: handleQuickTap,
    isRunning: janusRunning,
    enableComplexGestures: stage !== 'expanded',
    pullHint: notifOpen
      ? {
          keep: t('janus:island.pullHint.keepOpen'),
          release: t('janus:island.pullHint.releaseOpen'),
        }
      : {
          keep: t('janus:island.pullHint.keep'),
          release: t('janus:island.pullHint.release'),
        },
  })

  // P1 行为系统：凝视/眨眼/摸头循环（折叠胶囊态）；P2 事件原语映射见下。
  // 待机动作（2026-10-24 移植）：传话中让位（busyRef），摸头/点击/开面在内核让位。
  const speakBusyRef = useRef(false)
  const janusGaze = useJanusGaze({
    faceRef: eyeContainerRef,
    islandRef,
    mode,
    enabled: stage === 'collapsed',
    panelOpen: notifOpen,
    suspendRef: isDraggingRef,
    busyRef: speakBusyRef,
  })
  janusGazeRef.current = janusGaze

  const islandSpeak = useIslandSpeak()
  islandSpeakRef.current = islandSpeak
  speakBusyRef.current = islandSpeak.snapshot.speaking !== null
  const { enqueue, silence, setPaused, removeAutomation } = islandSpeak
  useEffect(() => { removedAutomations.forEach(removeAutomation) }, [removedAutomations, removeAutomation])
  const speaking = stage === 'collapsed' && !notifOpen ? islandSpeak.snapshot.speaking : null

  useEffect(() => {
    if (stage !== 'collapsed' || notifOpen || trayOpen) silence()
  }, [stage, notifOpen, trayOpen, silence])
  useEffect(() => {
    if (!notifOpen && !trayOpen) return
    const handleOutsideDown = (event: PointerEvent) => {
      const target = event.target
      const surface = trayOpen ? shellRef.current?.querySelector('.janus-notify-anchor') : shellRef.current
      if (target instanceof Node && surface?.contains(target)) return
      closeNotifications(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopImmediatePropagation()
      closeNotifications()
    }
    document.addEventListener('pointerdown', handleOutsideDown, true)
    window.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('pointerdown', handleOutsideDown, true)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [notifOpen, trayOpen, closeNotifications])
  useEffect(() => {
    if (stage !== 'collapsed') setNotifOpen(false)
    if (stage !== 'expanded') setTrayOpen(false)
  }, [stage])

  // P2 真实事件 → 原语：nod=回合完成（流式下降沿且无错误）、fail=出错、greet=工作区落定。
  const prevStreamingRef = useRef(isStreaming)
  const prevErrorRef = useRef(error)
  const prevWorkspaceRef = useRef(activeWorkspace)
  useEffect(() => {
    const was = prevStreamingRef.current
    prevStreamingRef.current = isStreaming
    if (was && !isStreaming && !error) janusGazeRef.current?.react('nod')
  }, [isStreaming, error])
  useEffect(() => {
    const prev = prevErrorRef.current
    prevErrorRef.current = error
    if (!prev && error) janusGazeRef.current?.react('fail')
  }, [error])
  useEffect(() => {
    if (prevWorkspaceRef.current === activeWorkspace) return
    prevWorkspaceRef.current = activeWorkspace
    janusGazeRef.current?.react('greet')
  }, [activeWorkspace])

  const runNotificationAction = useCallback((notificationId: string, actionId: IslandNotificationActionId, commandId?: string) => {
    const record = islandSpeakRef.current?.snapshot.history.find(item => item.id === notificationId)
    const notification = record?.notification
    if (record) islandSpeakRef.current?.markRead(record.key)
    closeNotifications(false)
    if (actionId === 'open-automation') {
      const run = notification?.automation ?? useAutomationsStore.getState().notices.find(item => 'automation:' + item.id === notificationId)
      if (run) openAutomationRun(run)
      onDismiss()
    } else if (actionId === 'open-plugin') {
      const entry = notification?.plugin
      const command = commandId ?? notification?.actions[0]?.command
      if (entry && command) {
        onDismiss(); setPluginActionFailure('')
        void pluginRequest({ type: 'islandAction', pluginId: entry.pluginId, id: entry.id, instanceId: entry.instanceId, command })
          .catch(cause => setPluginActionFailure(cause instanceof Error ? cause.message : 'INTERNAL_ERROR'))
      }
    } else if (actionId === 'open-knowledge') {
      if (useExperimentalStore.getState().persona) setActiveWorkbench('knowledge')
      onDismiss()
    } else if (actionId === 'open-memory') {
      if (useExperimentalStore.getState().persona) useRightToolStore.getState().openTool('persona')
      onDismiss()
    } else if (actionId === 'open-blueprint' || actionId === 'open-maintenance') {
      handleOpenPlugins()
    } else if (actionId === 'open-product' && notification?.productPath) {
      onOpenProductFile?.(notification.productPath)
    }
  }, [closeNotifications, handleOpenPlugins, onDismiss, onOpenProductFile, setActiveWorkbench])

  // Minimal stage-B tool trace for the agent-result detail: the pane owns the
  // full work projection, the Island only mirrors tool calls so the detail can
  // show reads/failures next to evidence without re-plumbing props.
  useEffect(() => window.electron.roundtable?.onEvent((event) => {
    if (event.type === 'workspace:tool-started') {
      setRoundtableToolCalls((items) => items.some((item) => item.toolCallId === event.toolCallId)
        ? items
        : [...items.slice(-19), { toolCallId: event.toolCallId, toolName: event.toolName, workspaceId: event.workspaceId, agentId: event.agentId, roundId: event.roundId, status: 'started' as const }])
    } else if (event.type === 'workspace:tool-completed') {
      setRoundtableToolCalls((items) => {
        const record: RoundtableToolCall = { toolCallId: event.toolCallId, toolName: event.toolName, workspaceId: event.workspaceId, agentId: event.agentId, roundId: event.roundId, status: 'completed' }
        const index = items.findIndex((item) => item.toolCallId === event.toolCallId)
        if (index < 0) return [...items.slice(-19), record]
        const next = [...items]; next[index] = record; return next
      })
    } else if (event.type === 'workspace:tool-failed') {
      setRoundtableToolCalls((items) => {
        const record: RoundtableToolCall = { toolCallId: event.toolCallId, toolName: event.toolName, workspaceId: event.workspaceId, agentId: event.agentId, roundId: event.roundId, status: 'failed', errorCode: event.errorCode, error: event.error }
        const index = items.findIndex((item) => item.toolCallId === event.toolCallId)
        if (index < 0) return [...items.slice(-19), record]
        const next = [...items]; next[index] = record; return next
      })
    } else if (event.type === 'workspace:tool-cancelled') {
      setRoundtableToolCalls((items) => {
        const record: RoundtableToolCall = { toolCallId: event.toolCallId, toolName: event.toolName, workspaceId: event.workspaceId, agentId: event.agentId, roundId: event.roundId, status: 'cancelled' }
        const index = items.findIndex((item) => item.toolCallId === event.toolCallId)
        if (index < 0) return [...items.slice(-19), record]
        const next = [...items]; next[index] = record; return next
      })
    }
  }) ?? (() => undefined), [])

  // Notification projection (Note: island-hifi-optimized-alignment.md):
  // peek/expanded surfaces render from IslandNotification only; the former
  // per-kind title/subtitle/status chains live in islandNotifications.ts.
  const notifications = useMemo(() => assembleNotifications([
    ...automationNotices.map(automationNotification),
    productNotification(productNotice),
    knowledgeNotification({
      active: knowledgePeekActive,
      empty: knowledgePeekEmpty,
      trace: knowledgeTrace,
      matchLabel: knowledgeTrace?.topHit ? formatKnowledgeMatch(knowledgeTrace.topHit.score, t) : undefined,
    }),
    personaEnabled ? memoryNotification({ pendingHabitCount: memoryPending }) : null,
    ...pluginIslandNotifications(pluginSnapshot),
  ]), [automationNotices, knowledgePeekActive, knowledgePeekEmpty, knowledgeTrace, memoryPending, productNotice, personaEnabled, t, pluginSnapshot])
  const visibleNotifications = useMemo(() => {
    const retained = new Set(islandSpeak.snapshot.history.map(entry => entry.id))
    return notifications.filter(notification => retained.has(notification.id))
  }, [notifications, islandSpeak.snapshot.history])
  const topNotificationItem = topNotification(visibleNotifications)
  // The knowledge surface (recall result or empty capsule) owns the peek
  // capsule while it presents; a sticky product notice yields to it and stays
  // reachable through the click intent instead (islandInteraction).
  const capsuleNotifications = useMemo(
    () => knowledgePeekActive
      ? visibleNotifications.filter((notification) => notification.kind !== 'product')
      : visibleNotifications,
    [knowledgePeekActive, visibleNotifications],
  )
  const capsuleTopNotification = topNotification(capsuleNotifications)
  const emptyCapsule = isEmptyCapsuleRequested(knowledgePeekEmpty, capsuleNotifications)
  const capsuleTierValue = capsuleTier(capsuleTopNotification, emptyCapsule)
  // Split compact (hifi DI pattern): when the knowledge surface is NOT
  // presenting and 2+ notifications are alive, the capsule splits into one
  // clickable cell per notification; the knowledge surface keeps capsule
  // ownership when it presents (product yields, tray keeps everything).
  const splitCapsule = !knowledgePeekActive && capsuleNotifications.length >= 2

  const modeStatusFallback = janusRunning
    ? t('janus:island.status.runningActive')
    : mode === 'analytics'
      ? t('janus:island.status.analyticsProcessing')
      : t('janus:island.status.orderIdle')
  const statusText = topNotificationItem?.copy.metaKey
    ? t(topNotificationItem.copy.metaKey, topNotificationItem.copy.metaValues)
    : modeStatusFallback

  // Every source feeds the same history, including arrivals while Chat is active.
  // Baseline notices are retained silently. Only the idle capsule auto-presents new occurrences.
  const notificationsInitialized = useRef(false)
  useEffect(() => {
    const present = notificationsInitialized.current && stage === 'collapsed' && !notifOpen && !trayOpen
    notificationsInitialized.current = true
    for (const notification of [...notifications].sort((a, b) => a.createdAt - b.createdAt)) {
      enqueue({
        id: notification.id,
        title: notification.copy.titleText ?? t(notification.copy.titleKey),
        body: notification.copy.subtitleKey ? t(notification.copy.subtitleKey, notification.copy.subtitleValues)
          : notification.copy.subtitleText || notification.copy.titleText || t(notification.copy.titleKey),
        kicker: notification.plugin?.pluginId ?? t(notificationKickerKey(notification.kind)),
        at: notification.createdAt,
        groupKey: notification.groupKey,
        notification,
      }, present)
    }
  }, [notifications, stage, notifOpen, trayOpen, enqueue, t])

  // P3 念词伴随：开讲时眼神扫向文字侧。
  const prevSpeakIdRef = useRef<string | null>(null)
  useEffect(() => {
    const id = islandSpeak.snapshot.speaking?.id ?? null
    if (id && id !== prevSpeakIdRef.current) {
      janusGazeRef.current?.lookAt(1.8, 0, 2000)
    }
    prevSpeakIdRef.current = id
  }, [islandSpeak.snapshot.speaking])

  const modeLabel = mode === 'analytics' ? t('janus:island.modeLabel.analytics') : mode === 'running' ? t('janus:island.modeLabel.running') : t('janus:island.modeLabel.order')
  const modeColor = mode === 'running' ? 'var(--status-success)' : 'var(--primary)'
  const workspaceLabel = activeWorkspace?.name ?? t('janus:island.workspaceFallback')
  const messageCount = messages.length
  const prevMessageCountRef = useRef(messageCount)

  useEffect(() => {
    if (stage === 'peek') setView('monitor')
  }, [stage, setView])

  useEffect(() => {
    if (stage === 'expanded' && view === 'roundtable') return
    setAuxiliaryModule(null)
    if (stage === 'collapsed') setParchmentOpen(false)
  }, [stage, view])

  const requestCloseAuxiliary = useCallback(() => {
    setAuxiliaryModule(null)
    setParchmentOpen(false)
  }, [])

  useEffect(() => {
    if (auxiliaryPresence.present) return
    const opener = auxiliaryOpener.current
    auxiliaryOpener.current = null
    if (stage === 'expanded' && view === 'roundtable' && opener instanceof HTMLElement && opener.isConnected) opener.focus({ preventScroll: true })
  }, [auxiliaryPresence.present, stage, view])

  useEffect(() => {
    if (!auxiliaryModule) return
    const handleAuxiliaryEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      requestCloseAuxiliary()
    }
    document.addEventListener('keydown', handleAuxiliaryEscape, true)
    return () => document.removeEventListener('keydown', handleAuxiliaryEscape, true)
  }, [auxiliaryModule, requestCloseAuxiliary])

  // A newly arrived user turn follows into the chat view from the monitor
  // overview. Streaming/thinking ticks (isStreaming, pendingContent) never
  // steal the view, so loading never yanks the island around — and the
  // roundtable keeps its own discussion while the main chat streams.
  useEffect(() => {
    const grew = messageCount > prevMessageCountRef.current
    prevMessageCountRef.current = messageCount
    if (!grew) return
    if (stage === 'expanded' && view === 'monitor') {
      setView('chat')
    }
  }, [messageCount, stage, view, setView])

  // Collapsing does not stop the conversation stream.
  useEffect(() => {
    if (stage === 'collapsed') return
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null
      const targetElement = target instanceof Element ? target : target?.parentElement
      const shell = shellRef.current
      if (!shell || !target || shell.contains(target) || targetElement?.closest('[data-select-dropdown], [data-island-companion]')) return
      onDismiss()
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (stage === 'expanded' && trayOpen) {
        setTrayOpen(false)
        return
      }
      onDismiss()
    }
    document.addEventListener('pointerdown', handlePointerDown, true)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [onDismiss, stage, trayOpen])

  const auxiliaryDescriptor: JanusAuxiliaryModuleDescriptor | null = displayedAuxiliary === 'roundtable-parchment'
    ? {
        id: 'janus-roundtable-parchment-detail',
        type: 'roundtable-parchment',
        title: t('janus:roundtable.auxiliary.parchmentTitle'),
        ariaLabel: t('janus:roundtable.auxiliary.parchmentAria'),
      }
    : displayedAuxiliary === 'agent-result' ? { id: 'janus-agent-result-detail', type: 'agent-result', title: t('janus:roundtable.auxiliary.agentResultTitle'), ariaLabel: t('janus:roundtable.auxiliary.agentResultAria') }
    : displayedAuxiliary === 'roundtable-questions' ? { id: 'janus-roundtable-questions-detail', type: 'roundtable-questions', title: t('janus:roundtable.auxiliary.questionsTitle'), ariaLabel: t('janus:roundtable.auxiliary.questionsAria') } : null

  // §37.10: question pool projection shared by the questions detail island.
  const roundtableOpenQuestions = (roundtableState?.facts ?? [])
    .filter((fact) => fact.kind === 'question' && fact.status !== 'resolved' && fact.status !== 'rejected')
    .map((fact) => ({ id: fact.id, text: fact.content, updatedAt: fact.updatedAt }))
  const roundtableAnsweredQuestions = (roundtableState?.facts ?? [])
    .filter((fact) => fact.kind === 'question' && fact.status === 'resolved')
    .slice(-10)
    .map((fact) => ({ id: fact.id, text: fact.content, updatedAt: fact.updatedAt }))

  useEffect(() => {
    document.body.classList.toggle('is-running', janusRunning)
    document.body.classList.toggle('has-running', hasRunning)
    return () => {
      document.body.classList.remove('is-running')
      document.body.classList.remove('has-running')
    }
  }, [janusRunning, hasRunning])

  // The veil is a viewport backdrop (position:fixed inset:0). It must live at
  // body level: any transformed ancestor (shell translateX, cluster centering,
  // drag offset) would trap it into a shell-sized square with sharp corners
  // painting above the panel instead of a full-viewport dim below it.
  const veil = stage === 'expanded' && !hostCovered && typeof document !== 'undefined'
    ? createPortal(
      <div className="janus-veil" aria-hidden="true" style={{ zIndex: 1999, ...(companionVeil ?? {}) }} />,
      document.body,
    )
    : null

  return (
    <>
      {veil}
    <div
      ref={shellRef}
      style={{ visibility: hostCovered ? 'hidden' : undefined }}
      className={`janus-island-shell ${faceClass(mode)}`}
      data-stage={stage}
      data-view={view}
      data-plugin-active={view.startsWith('extension:') ? 'true' : 'false'}
      data-mode={mode}
      data-auxiliary-open={auxiliaryModule ? 'true' : 'false'}
      data-auxiliary-module={auxiliaryDescriptor?.type ?? 'none'}
      data-peek-kind={splitCapsule ? 'split' : capsuleTopNotification?.kind ?? 'empty'}
      data-peek-layout={splitCapsule ? 'split' : 'single'}
      data-capsule-tier={capsuleTierValue}
      data-loading={chatLoading ? 'true' : 'false'}
      data-speaking={speaking ? 'true' : 'false'}
      data-notif={notifOpen ? 'true' : 'false'}
      data-notif-empty={islandSpeak.snapshot.historyCount === 0}
      onMouseDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {stage === 'collapsed' && (pluginSnapshot.island?.length ?? 0) > 0 && <button type="button" className="plugin-island-count"
        data-plugin-island-count aria-label={t('plugins:islandStatusCount', { count: pluginSnapshot.island!.length })}
        onClick={() => useIslandStore.getState().dispatch({ type: 'plugin-peek' })}>{pluginSnapshot.island!.length}</button>}
      <div ref={pullHintRef} className="pull-hint" />
      <div
        ref={islandRef}
        data-mode={mode}
        data-stage={stage}
        className={`janus-island${isSwitching ? ' switching' : ''}`}
        role={stage !== 'expanded' && !splitCapsule && !speaking && !notifOpen ? 'button' : undefined}
        tabIndex={stage !== 'expanded' && !splitCapsule ? 0 : undefined}
        aria-expanded={stage === 'collapsed' && !speaking ? notifOpen : undefined}
        aria-label={stage !== 'expanded' && !splitCapsule
          ? capsuleTopNotification?.kind === 'product' && productNotice
            ? t('janus:island.aria.openProductPreview', { path: productNotice.relPath })
            : stage === 'peek'
              ? t('janus:island.aria.closeKnowledgePeek')
              : notifOpen
                ? t('janus:island.aria.closeNotif')
                : islandSpeak.snapshot.historyCount > 0
                  ? t('janus:island.notif.badgeAria', { count: islandSpeak.snapshot.unreadCount })
                  : t('janus:island.aria.openNotif')
          : undefined}
        onKeyDown={stage !== 'expanded' ? handleIslandKeyDown : undefined}
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={event => setPaused(event.currentTarget.contains(document.activeElement))}
        onFocusCapture={() => setPaused(true)}
        onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setPaused(event.currentTarget.matches(':hover')) }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
      >
        <div className="janus-collapsed-core">
          <div ref={(el) => { eyeContainerRef.current = el }} className="janus-face-mini">
            <JanusEye mode={stage === 'expanded' && mode === 'sleep' ? 'order' : mode} className="janus-eye-group" />
          </div>
        </div>

        {speaking && <div className="janus-speak-strip" onPointerDown={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
          <button type="button" className="janus-speak-read" onClick={() => openNotifCenter(speaking.key)} aria-label={t('janus:island.notif.readNotice', { title: speaking.title })}>
            <span className="janus-speak-kicker">{speaking.kicker}<time>{notificationClock(speaking.at)}</time>{speaking.count > 1 && <span>×{speaking.count}</span>}</span>
            <span className="janus-speak-body" role="status">{speaking.body}</span>
          </button>
          <button type="button" className="janus-speak-close" aria-label={t('janus:island.notif.collapse')} onClick={() => islandSpeak.dismiss()}><X size={13} /></button>
          <div className="janus-speak-actions">
            <button type="button" onClick={() => openNotifCenter(speaking.key)}>{t('janus:island.notif.read')}</button>
            {speaking.notification?.actions[0] && <button type="button" className="janus-notif-action" onClick={() => {
              const action = speaking.notification!.actions[0]
              runNotificationAction(speaking.id, action.id, action.command)
              islandSpeak.silence()
            }}>{speaking.notification.actions[0].label ?? t(notificationActionLabelKey(speaking.notification.actions[0].id))}</button>}
          </div>
        </div>}

        {notifOpen && <div className="janus-notif-sheet">
          <IslandNotificationCenter entries={islandSpeak.snapshot.history} unreadCount={islandSpeak.snapshot.unreadCount}
            selectedKey={selectedNoticeKey} onSelect={selectNotice} onClose={closeNotifCenter}
            onClear={islandSpeak.clear} onAction={runNotificationAction} />
        </div>}

        <div className="janus-peek-shell">
          <div className="janus-peek-core">
            {emptyCapsule ? (
              <div className="janus-capsule" key={EMPTY_CAPSULE_NOTIFICATION_ID}>
                <div className="janus-capsule-row">
                  <span className="janus-capsule-led sev-info" aria-hidden="true" />
                  <div className="janus-capsule-copy">
                    <span className="janus-capsule-kicker">{t('janus:island.capsule.kicker.janus')}</span>
                    <span className="janus-capsule-title">{t('janus:island.capsule.empty.title')}</span>
                    <span className="janus-capsule-subtitle">{t('janus:island.capsule.empty.subtitle')}</span>
                  </div>
                </div>
              </div>
            ) : splitCapsule ? (
              <div className="janus-capsule janus-capsule-split" key={`split:${capsuleNotifications.map((notification) => notification.id).join('|')}`}>
                {capsuleNotifications.slice(0, 3).map((notification) => (
                  <button
                    key={notification.id}
                    type="button"
                    className="janus-capsule-cell"
                    title={notification.copy.titleText ?? t(notification.copy.titleKey)}
                    onClick={(event) => {
                      event.stopPropagation()
                      onDismiss()
                      openNotifCenter(notification.groupKey ?? notification.id)
                    }}
                  >
                    <span className={`janus-capsule-led sev-${notification.severity}`} aria-hidden="true" />
                    <span className="janus-capsule-cell-copy">
                      <span className="janus-capsule-kicker">{notification.plugin?.pluginId ?? t(notificationKickerKey(notification.kind))}</span>
                      <span className="janus-capsule-cell-title">{notification.copy.titleText ?? t(notification.copy.titleKey)}</span>
                    </span>
                  </button>
                ))}
              </div>
            ) : capsuleTopNotification ? (
              <div className="janus-capsule" key={capsuleTopNotification.id}>
                <div className="janus-capsule-row">
                  <span className={`janus-capsule-led sev-${capsuleTopNotification.severity}`} aria-hidden="true" />
                  <div className="janus-capsule-copy">
                    <span className="janus-capsule-kicker">{capsuleTopNotification.plugin?.pluginId ?? t(notificationKickerKey(capsuleTopNotification.kind))}</span>
                    <span className="janus-capsule-title">{capsuleTopNotification.copy.titleText ?? t(capsuleTopNotification.copy.titleKey)}</span>
                    {capsuleTopNotification.copy.subtitleKey ? (
                      <span className="janus-capsule-subtitle">{t(capsuleTopNotification.copy.subtitleKey, capsuleTopNotification.copy.subtitleValues)}</span>
                    ) : capsuleTopNotification.copy.subtitleText ? (
                      <span className="janus-capsule-subtitle">{capsuleTopNotification.copy.subtitleText}</span>
                    ) : null}
                    <PluginIslandPreview notification={capsuleTopNotification} />
                  </div>
                  {capsuleTopNotification.copy.metaKey ? (
                    <span className="janus-capsule-meta">{t(capsuleTopNotification.copy.metaKey, capsuleTopNotification.copy.metaValues)}</span>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <JanusIslandExpandedShell
          pluginActionFailure={pluginActionFailure}
          stage={stage}
          view={view}
          setView={setView}
          parchmentOpen={parchmentOpen}
          parchmentDetailOpen={auxiliaryModule === 'roundtable-parchment'}
          onToggleParchment={() => {
            if (auxiliaryModule === 'roundtable-parchment') {
              requestCloseAuxiliary()
              return
            }
            setParchmentOpen(true)
            openAuxiliary('roundtable-parchment')
          }}
          onOpenParchmentDetail={() => {
            setParchmentOpen(true)
            openAuxiliary('roundtable-parchment')
          }}
          onOpenAgentResult={(card) => { setActiveAgentCard(card); openAuxiliary('agent-result') }}
          onOpenQuestionsDetail={() => openAuxiliary('roundtable-questions')}
          onRequestAuxiliaryClose={requestCloseAuxiliary}
          onRoundtableStateChange={setRoundtableState}
          mode={mode}
          janusRunning={janusRunning}
          workspaceLabel={workspaceLabel}
          modeLabel={modeLabel}
          modeColor={modeColor}
          statusText={statusText}
          onOpenPlugins={handleOpenPlugins}
          notificationCenter={{ entries: islandSpeak.snapshot.history, unreadCount: islandSpeak.snapshot.unreadCount,
            selectedKey: selectedNoticeKey, onSelect: selectNotice, onClose: closeNotifCenter,
            onClear: islandSpeak.clear, onAction: runNotificationAction }}
          trayOpen={trayOpen}
          onToggleTray={toggleTray}
          messages={messages}
          pendingContent={pendingContent}
          isStreaming={isStreaming}
          error={error}
          modelOptions={modelOptions}
          activeModel={activeModel}
          modelNotice={modelNotice}
          onChatSelectModel={onChatSelectModel}
          onChatSend={onChatSend}
          onChatRewrite={onChatRewrite}
          onChatStop={onChatStop}
          onChatRetry={onChatRetry}
          onChatClear={onChatClear}
          conversationController={conversationController}
          resourceController={resourceController}
          toolTraces={toolTraces}
        />
      </div>
      {stage === 'expanded' && auxiliaryDescriptor && auxiliaryLayout ? (
        <JanusAuxiliaryIsland
          module={auxiliaryDescriptor}
          phase={auxiliaryPresence.phase}
          layout={auxiliaryLayout}
          onClose={requestCloseAuxiliary}
          actions={displayedAuxiliary === 'roundtable-parchment' && roundtableState?.sessionId && roundtableState.phase !== 'idle' ? (
            <>
              {parchmentExportNotice ? (
                <span className="janus-auxiliary-export-notice" role="status">{
                  parchmentExportNotice === 'saved' ? t('janus:roundtable.export.saved') : parchmentExportNotice === 'copied' ? t('janus:roundtable.export.copied') : parchmentExportNotice === 'canceled' ? t('janus:roundtable.export.canceled') : t('janus:roundtable.export.failed')
                }</span>
              ) : null}
              {parchmentExportNotice === 'error' ? (
                <button type="button" className="janus-auxiliary-export" disabled={parchmentExportBusy} onClick={() => void handleParchmentCopy()}>
                  {t('janus:roundtable.export.copy')}
                </button>
              ) : null}
              <button
                type="button"
                className="janus-auxiliary-export"
                aria-label={t('janus:roundtable.export.actionAria')}
                title={roundtableState.phase === 'running' ? t('janus:roundtable.export.lockedTitle') : t('janus:roundtable.export.actionTitle')}
                disabled={parchmentExportBusy || roundtableState.phase === 'running'}
                onClick={() => void handleParchmentExport()}
              >
                <Download size={15} strokeWidth={1.7} aria-hidden="true" />
              </button>
            </>
          ) : undefined}
        >
          {displayedAuxiliary === 'roundtable-parchment' ? <JanusRoundtableParchment detailed document={roundtableState ? projectParchment(roundtableState) : undefined} /> : displayedAuxiliary === 'roundtable-questions' ? <JanusRoundtableQuestions roundNumber={roundtableState?.roundNumber ?? 0} open={roundtableOpenQuestions} answered={roundtableAnsweredQuestions} /> : <div key={activeAgentCard?.id ?? 'agent-result-empty'} className="janus-agent-result-detail" data-detailed="true">
            <div className="janus-agent-result-detail__eyebrow">{t('janus:roundtable.cardDetail.eyebrow')} // {activeAgentCard?.status ? t(ROUNDTABLE_CARD_STATUS_KEYS[activeAgentCard.status]) : t('janus:roundtable.cardDetail.waiting')}</div>
            <h2>{activeAgentCard?.title ?? t('janus:roundtable.cardDetail.titleFallback')}</h2>
            <p className="janus-agent-result-detail__summary">{activeAgentCard?.summary ?? t('janus:roundtable.cardDetail.summaryFallback')}</p>
            {activeAgentCard?.sections?.map((section) => <section key={section.id}><h3>{section.title}</h3><p>{section.markdown}</p></section>)}
            {!!activeAgentCard?.evidenceRefs?.length && <div className="janus-agent-result-detail__evidence"><strong>{t('janus:roundtable.cardDetail.evidence')}</strong><span>{activeAgentCard.evidenceRefs.map((ref) => ref.kind === 'workspace-file' ? `${ref.workspaceId}/${ref.relativePath}${typeof ref.lineStart === 'number' ? `#L${ref.lineStart}${typeof ref.lineEnd === 'number' && ref.lineEnd !== ref.lineStart ? `-${ref.lineEnd}` : ''}` : ''}${ref.sha256 ? ` · ${ref.sha256.slice(0, 8)}` : ''}` : ref.kind === 'agent-card' ? ref.cardId : ref.eventId).join(' · ')}</span></div>}
            {(() => {
              const tools = roundtableToolCalls.filter((item) => item.agentId === activeAgentCard?.agentId)
              if (!tools.length) return null
              return <div className="janus-agent-result-detail__evidence"><strong>{t('janus:roundtable.cardDetail.workspaceReads')}</strong><span>{tools.map((item) => `${item.toolName}:${item.status}${item.errorCode ? `(${item.errorCode})` : ''}`).join(' · ')}</span></div>
            })()}
            {activeAgentCard && <div className="janus-agent-result-detail__evidence"><strong>{t('janus:roundtable.cardDetail.sourceIndex')}</strong><span>{activeAgentCard.sourceEventIds.join(', ') || t('janus:roundtable.cardDetail.noSources')}</span></div>}
            {activeAgentCard && <small>{t('janus:roundtable.cardDetail.updated', { time: new Date(activeAgentCard.updatedAt || activeAgentCard.createdAt).toLocaleString() })}</small>}
          </div>}
        </JanusAuxiliaryIsland>
      ) : null}
    </div>
    </>
  )
}
