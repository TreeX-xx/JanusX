import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Pin, PinOff, X } from 'lucide-react'
import type { SubAgentRun } from '../../../../shared/subAgentRun'
import type { AgentResultCard } from '../../../../shared/roundtable/events'
import type { RoundtableState } from '../../../../shared/roundtable/events'
import { useWorkspaceStore } from '@/stores/workspace'
import { useExperimentalStore } from '@/stores/experimental'
import { useSubAgentRunStore } from '@/stores/subagent-run'
import { useI18n } from '@/i18n/useI18n'
import { useExtensionViews } from '@/extensions/react'
import { ExtensionViewHost } from '@/extensions/ExtensionViewHost'
import { PluginIslandPreview } from '@/extensions/plugin-island'
import { useWorktreeStore } from '@/stores/worktree'
import { JanusIdentityCore } from './JanusIdentityCore'
import { WorkflowXMonitor } from './WorkflowXMonitor'
import { getJanusAgentIdentity } from './janusIdentity'
import { JanusChat } from './JanusChat'
import { JanusRoundtablePane } from './JanusRoundtablePane'
import type { JanusExpandedView, JanusIslandProps, JanusIslandStage, JanusParticle } from './janusIslandTypes'
import {
  SUBAGENT_STATUS_KEY,
  formatRunAge,
  previewIdentityState,
  roleIdentity,
  runEngineLabel,
  runRoleLabel,
  runtimeRoleStyle,
  terminalProviderLabel,
  terminalStatusLabel,
} from './janusIslandRuntime'
import {
  notificationActionLabelKey,
  notificationKickerKey,
  type IslandNotification,
  type IslandNotificationActionId,
} from './islandNotifications'

interface JanusIslandExpandedShellProps extends Pick<JanusIslandProps,
  | 'messages' | 'pendingContent' | 'isStreaming' | 'error'
  | 'modelOptions' | 'activeModel' | 'modelNotice' | 'onChatSelectModel'
  | 'onChatSend' | 'onChatRewrite' | 'onChatStop' | 'onChatRetry' | 'onChatClear'
  | 'conversationController' | 'resourceController' | 'toolTraces'
> {
  pluginActionFailure?: string
  stage: JanusIslandStage
  view: JanusExpandedView
  setView: (view: JanusExpandedView) => void
  parchmentOpen: boolean
  parchmentDetailOpen: boolean
  onToggleParchment: () => void
  onOpenParchmentDetail: () => void
  onOpenAgentResult?: (card: AgentResultCard) => void
  onOpenQuestionsDetail?: () => void
  onRoundtableStateChange?: (state: RoundtableState | null) => void
  onRequestAuxiliaryClose?: () => void
  mode: 'sleep' | 'order' | 'analytics' | 'running'
  janusRunning: boolean
  workspaceLabel: string
  modeLabel: string
  modeColor: string
  statusText: string
  onOpenPlugins: () => void
  /** Expanded-stage notification surface (Note: island-hifi-optimized-alignment.md). */
  notifications: IslandNotification[]
  bannerNotification: IslandNotification | null
  trayOpen: boolean
  notifyPulse: boolean
  onToggleTray: () => void
  onNotificationAction: (notificationId: string, actionId: IslandNotificationActionId, command?: string) => void
  onBannerDismiss: () => void
  onTrayClear: () => void
  /** Island window persistence: a pinned window survives outside click / Esc. */
  islandPinned?: boolean
  onToggleIslandPin?: () => void
}

export function JanusIslandExpandedShell({
  stage, view, setView, mode, janusRunning,
  parchmentOpen, parchmentDetailOpen, onToggleParchment, onOpenParchmentDetail,
  workspaceLabel, modeLabel, modeColor, statusText, onOpenPlugins,
  onOpenAgentResult,
  onOpenQuestionsDetail,
  onRoundtableStateChange,
  onRequestAuxiliaryClose,
  notifications, bannerNotification, trayOpen, notifyPulse,
  onToggleTray, onNotificationAction, onBannerDismiss, onTrayClear,
  messages, pendingContent,
  isStreaming, error, modelOptions, activeModel, modelNotice,
  onChatSelectModel, onChatSend, onChatRewrite, onChatStop, onChatRetry,
  onChatClear, conversationController,
  resourceController, toolTraces = [],
  islandPinned = false, onToggleIslandPin,
  pluginActionFailure,
}: JanusIslandExpandedShellProps) {
  const { t } = useI18n('janus')
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [particles, setParticles] = useState<JanusParticle[]>([])
  const particleIdRef = useRef(0)
  const subAgentRuns = useSubAgentRunStore((state) => state.runs)
  const fetchSubAgentRuns = useSubAgentRunStore((state) => state.fetchRuns)
  const subscribeToSubAgentRuns = useSubAgentRunStore((state) => state.subscribeToEvents)
  const activeTerminalId = useWorkspaceStore((state) => state.activeTerminalId)
  const terminals = useWorkspaceStore((state) => state.terminals)
  const roundtableEnabled = useExperimentalStore((state) => state.roundtable)
  const projectId = useWorkspaceStore(s => s.activeWorkspaceId)
  const workspace = useWorkspaceStore(s => s.workspaces.find(w => w.id === projectId))
  const pluginViews = useExtensionViews().filter(item => item.location === 'island' && (item.scope === 'application' || projectId))
  const selectedPlugin = pluginViews.find(item => item.id === view)
  const pluginRoot = useWorktreeStore(s => projectId ? s.activePaths[projectId] ?? workspace?.path ?? null : null)
  const previousPluginScope = useRef('')
  useEffect(() => {
    const scope = selectedPlugin?.scope === 'project' ? JSON.stringify([projectId, pluginRoot]) : 'application'
    const key = selectedPlugin ? `${selectedPlugin.id}:${scope}` : ''
    if (selectedPlugin && previousPluginScope.current.startsWith(`${selectedPlugin.id}:`) && previousPluginScope.current !== key) setView('monitor')
    previousPluginScope.current = key
  }, [selectedPlugin, projectId, pluginRoot, setView])
  useEffect(() => { if (view.startsWith('extension:') && !selectedPlugin) setView('monitor') }, [view, selectedPlugin, setView])
  const visibleViews = (['monitor', 'chat', 'roundtable'] as JanusExpandedView[]).filter(
    (item) => item !== 'roundtable' || roundtableEnabled,
  )

  const activeTerminal = useMemo(
    () => activeTerminalId ? terminals.find((terminal) => terminal.id === activeTerminalId) ?? null : null,
    [activeTerminalId, terminals],
  )
  const runsById = useMemo(() => new Map(subAgentRuns.map((run) => [run.id, run])), [subAgentRuns])
  const monitoredRun = useMemo(
    () => activeTerminalId
      ? subAgentRuns.find((run) => run.terminalId === activeTerminalId || run.rootTerminalId === activeTerminalId) ?? null
      : null,
    [activeTerminalId, subAgentRuns],
  )
  const activeMissionId = monitoredRun?.missionId ?? activeTerminalId ?? null
  const activeRootRunId = monitoredRun?.rootRunId ?? monitoredRun?.id ?? (activeTerminalId ? `terminal:${activeTerminalId}` : null)
  const missionSubAgentRuns = useMemo(() => {
    if (!activeTerminalId) return []

    const belongsToActiveMission = (run: SubAgentRun): boolean => {
      if (run.terminalId === activeTerminalId || run.rootTerminalId === activeTerminalId) return true
      if (activeMissionId && run.missionId === activeMissionId) return true
      if (activeRootRunId && run.rootRunId === activeRootRunId) return true
      const visited = new Set<string>()
      let parentId = run.parentRunId
      while (parentId && !visited.has(parentId)) {
        visited.add(parentId)
        const parent = runsById.get(parentId)
        if (!parent) return false
        if (parent.terminalId === activeTerminalId || parent.rootTerminalId === activeTerminalId) return true
        if (activeMissionId && parent.missionId === activeMissionId) return true
        if (activeRootRunId && (parent.id === activeRootRunId || parent.rootRunId === activeRootRunId)) return true
        parentId = parent.parentRunId
      }
      return false
    }

    return subAgentRuns.filter(belongsToActiveMission)
  }, [activeMissionId, activeRootRunId, activeTerminalId, runsById, subAgentRuns])
  const visibleSubAgentRuns = useMemo(() => missionSubAgentRuns.slice(0, 6), [missionSubAgentRuns])
  const mainMissionRun = useMemo(() => missionSubAgentRuns.find((run) => run.role === 'main') ?? null, [missionSubAgentRuns])
  const defaultMonitorRun = mainMissionRun ?? monitoredRun ?? null
  const selectedMonitorRun = selectedRunId ? missionSubAgentRuns.find((run) => run.id === selectedRunId) ?? null : null
  const previewRun = selectedMonitorRun ?? defaultMonitorRun
  const previewIdentity = previewRun ? roleIdentity(previewRun.role) : 'main'
  const previewState = previewIdentityState(previewRun)
  const previewIdentitySpec = getJanusAgentIdentity(previewIdentity)
  const monitorTitle = previewRun?.title ?? activeTerminal?.name ?? workspaceLabel
  const monitorStatusText = previewRun
    ? `${runEngineLabel(previewRun, t)} // ${t(SUBAGENT_STATUS_KEY[previewRun.status])}`
    : activeTerminal
      ? `${terminalProviderLabel(activeTerminal.preset, t)} // ${terminalStatusLabel(activeTerminal.status, t)}`
      : statusText

  const focusRunTerminal = useCallback((run: SubAgentRun) => {
    if (!run.terminalId) return
    const workspaceState = useWorkspaceStore.getState()
    if (workspaceState.terminals.some((terminal) => terminal.id === run.terminalId)) {
      workspaceState.setActiveTerminal(run.terminalId)
    }
  }, [])

  useEffect(() => {
    void fetchSubAgentRuns()
    return subscribeToSubAgentRuns()
  }, [fetchSubAgentRuns, subscribeToSubAgentRuns])

  useEffect(() => {
    setSelectedRunId((current) => {
      if (current && visibleSubAgentRuns.some((run) => run.id === current)) return current
      return mainMissionRun?.id ?? monitoredRun?.id ?? null
    })
  }, [mainMissionRun, monitoredRun, visibleSubAgentRuns])

  useEffect(() => {
    if (!selectedRunId || missionSubAgentRuns.some((run) => run.id === selectedRunId)) return
    setSelectedRunId(null)
  }, [missionSubAgentRuns, selectedRunId])

  useEffect(() => {
    if (stage !== 'expanded') {
      setParticles([])
      return
    }
    const active = mode === 'analytics' || janusRunning
    const speed = active ? 200 : 800
    const spawn = () => {
      const id = ++particleIdRef.current
      const left = 20 + Math.random() * 60
      const size = active && Math.random() > 0.5 ? 6 : Math.random() > 0.8 ? 12 : 6
      const duration = active ? 1.5 + Math.random() * 2 : 3 + Math.random() * 4
      setParticles((current) => [...current, { id, left, size, duration }])
      window.setTimeout(() => setParticles((current) => current.filter((particle) => particle.id !== id)), duration * 1000)
    }
    const interval = window.setInterval(spawn, speed)
    return () => window.clearInterval(interval)
  }, [janusRunning, mode, stage])

  return (
            <div className="janus-expanded-shell">
              <div className="janus-expanded-topbar">
                <div className="janus-expanded-left">
                  {onToggleIslandPin ? (
                    <button
                      type="button"
                      className="janus-chat-tool-button janus-pin-button"
                      data-pinned={islandPinned ? 'true' : 'false'}
                      aria-pressed={islandPinned}
                      aria-label={islandPinned ? t('janus:island.expanded.unpinChat') : t('janus:island.expanded.pinChat')}
                      title={islandPinned ? t('janus:island.expanded.unpinChat') : t('janus:island.expanded.pinChat')}
                      onClick={(event) => { event.stopPropagation(); onToggleIslandPin() }}
                    >
                      {islandPinned
                        ? <PinOff size={12} strokeWidth={1.7} aria-hidden="true" />
                        : <Pin size={12} strokeWidth={1.7} aria-hidden="true" />}
                      <span>{islandPinned ? t('janus:island.expanded.unpinChat') : t('janus:island.expanded.pinChat')}</span>
                    </button>
                  ) : null}
                  <div className="janus-expanded-brand island-title">
                    <span>*</span> {t('janus:island.expanded.brand')}
                  </div>
                </div>
                <div className="janus-expanded-view-switch" aria-label={t('janus:island.expanded.viewSwitchAria')}>
                  {visibleViews.map((item) => (
                    <button
                      key={item}
                      type="button"
                      role="tab"
                      className="janus-expanded-view-button"
                      data-view={item}
                      data-active={view === item}
                      aria-pressed={view === item}
                      aria-selected={view === item}
                      onClick={() => setView(item)}
                    >
                      {item === 'monitor'
                        ? t('janus:island.expanded.view.monitor')
                        : item === 'chat'
                          ? t('janus:island.expanded.view.chat')
                          : t('janus:island.expanded.view.roundtable')}
                    </button>
                  ))}
                  {pluginViews.map(item => <button key={item.id} type="button" role="tab" className="janus-expanded-view-button"
                    data-view={item.id} data-active={view === item.id} aria-selected={view === item.id}
                    title={`${item.extensionId} · ${item.title}`} onClick={() => setView(item.id)}>{item.title}</button>)}
                </div>
                <div className="janus-notify-anchor">
                  {notifications.length > 0 ? (
                    <button
                      type="button"
                      className="janus-notify-badge"
                      data-pulse={notifyPulse}
                      data-active={trayOpen}
                      onClick={onToggleTray}
                      aria-label={t('janus:island.capsule.tray.badgeAria', { count: notifications.length })}
                    >
                      <span className={`janus-capsule-led sev-${notifications[0]!.severity}`} aria-hidden="true" />
                      <span>{notifications.length}</span>
                    </button>
                  ) : null}
                  {trayOpen ? (
                    <div className="janus-notify-tray" role="region" aria-label={t('janus:island.capsule.tray.title')}>
                      <div className="janus-notify-tray-header">
                        <span className="janus-notify-tray-title">{t('janus:island.capsule.tray.title')}</span>
                        <button type="button" className="janus-notify-tray-clear" onClick={onTrayClear}>
                          {t('janus:island.capsule.tray.clearAll')}
                        </button>
                      </div>
                      {notifications.length === 0 ? (
                        <div className="janus-notify-tray-empty">{t('janus:island.capsule.tray.empty')}</div>
                      ) : notifications.map((notification) => (
                        <div key={notification.id} className="janus-notify-row" data-severity={notification.severity}>
                          <span className={`janus-capsule-led sev-${notification.severity}`} aria-hidden="true" />
                          <div className="janus-notify-row-copy">
                            <span className="janus-notify-row-kicker">
                              {notification.plugin?.pluginId ?? t(notificationKickerKey(notification.kind))}
                              <span className="janus-notify-row-time">{formatRunAge(new Date(notification.createdAt).toISOString(), t)}</span>
                            </span>
                            <span className="janus-notify-row-title">{notification.copy.titleText ?? t(notification.copy.titleKey)}</span>
                            {notification.copy.subtitleKey ? (
                              <span className="janus-notify-row-subtitle">{t(notification.copy.subtitleKey, notification.copy.subtitleValues)}</span>
                            ) : notification.copy.subtitleText ? (
                              <span className="janus-notify-row-subtitle">{notification.copy.subtitleText}</span>
                            ) : null}
                            {notification.progress != null ? (
                              <div className="janus-notify-row-progress" aria-hidden="true">
                                <div className="janus-notify-row-progress-fill" style={{ width: `${Math.max(0, Math.min(100, notification.progress))}%` }} />
                              </div>
                            ) : null}
                          </div>
                          <PluginIslandPreview notification={notification} />
                          {notification.actions.map(action => (
                            <button
                              key={action.command ?? action.id}
                              type="button"
                              className="janus-capsule-action janus-capsule-action--primary"
                              onClick={(event) => { event.stopPropagation(); onNotificationAction(notification.id, action.id, action.command) }}
                            >
                              {action.label ?? t(notificationActionLabelKey(action.id))}
                            </button>
                          ))}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
                <div className="janus-expanded-meta">
                  <span className="janus-expanded-meta-text">{islandPinned ? t('janus:island.expanded.pinnedHint') : t('janus:island.expanded.dismissHint')}</span>
                </div>
              </div>

              {bannerNotification ? (
                <div className="janus-notify-banner" key={bannerNotification.id} data-severity={bannerNotification.severity}>
                  <span className={`janus-capsule-led sev-${bannerNotification.severity}`} aria-hidden="true" />
                  <span className="janus-notify-row-kicker">{bannerNotification.plugin?.pluginId ?? t(notificationKickerKey(bannerNotification.kind))}</span>
                  <div className="janus-notify-banner-copy">
                    <span className="janus-notify-banner-title">{bannerNotification.copy.titleText ?? t(bannerNotification.copy.titleKey)}</span>
                    {bannerNotification.copy.subtitleKey ? (
                      <span className="janus-notify-banner-subtitle">{t(bannerNotification.copy.subtitleKey, bannerNotification.copy.subtitleValues)}</span>
                    ) : bannerNotification.copy.subtitleText ? (
                      <span className="janus-notify-banner-subtitle">{bannerNotification.copy.subtitleText}</span>
                    ) : null}
                  </div>
                  {bannerNotification.actions[0] ? (
                    <button
                      type="button"
                      className="janus-capsule-action janus-capsule-action--primary"
                      onClick={(event) => { event.stopPropagation(); onNotificationAction(bannerNotification.id, bannerNotification.actions[0]!.id) }}
                    >
                      {bannerNotification.actions[0].label ?? t(notificationActionLabelKey(bannerNotification.actions[0].id))}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="janus-notify-banner-close"
                    onClick={onBannerDismiss}
                    aria-label={t('janus:island.capsule.tray.dismiss')}
                  >
                    <X size={12} strokeWidth={1.7} aria-hidden="true" />
                  </button>
                </div>
              ) : null}

              <div className="janus-expanded-body">
                {pluginActionFailure && <p role="alert">{pluginActionFailure}</p>}
                {stage === 'expanded' && selectedPlugin && <section className="plugin-island-tool" data-plugin-island-tool={selectedPlugin.id}>
                  <header>{selectedPlugin.extensionId} · {selectedPlugin.title}</header>
                  <div className="flex-1 min-h-0"><ExtensionViewHost viewId={selectedPlugin.id} location="island" active={!trayOpen}
                    workspaceId={projectId} workspacePath={workspace?.path ?? null} /></div>
                </section>}
                <div className="janus-feedback-panel">
                  <div className="janus-monitor-grid">
                    <div className="janus-monitor-left">
                      <div className="janus-monitor-panel janus-monitor-core-panel">
                        <div className="janus-monitor-section-title">
                          <span>{t('janus:island.expanded.coreVisualization')}</span>
                          <em>{previewRun ? t('janus:island.expanded.roleSelected', { role: runRoleLabel(previewRun.role, t) }) : t('janus:island.expanded.missionOverview')}</em>
                        </div>
                        <div className="janus-monitor-crt">
                          <div className="warp-grid" />
                          <div className="scanline" />
                          <div className="pixel-overlay" />
                          {particles.map(({ id, left, size, duration }) => (
                            <div
                              key={id}
                              className="particle"
                              style={{ left: `${left}%`, width: size, height: size, animation: `float-up ${duration}s ease-in forwards` }}
                            />
                          ))}
                          <div className="levitation-wrapper">
                            <JanusIdentityCore
                              identity={previewIdentity}
                              state={previewState}
                              size="lg"
                              showScanline={false}
                              className="janus-monitor-identity"
                              aria-label={`${monitorTitle} monitor identity`}
                            />
                          </div>
                          <div className="janus-status-text">{monitorTitle}</div>
                        </div>
                      </div>

                      <div className="janus-monitor-stats">
                        <div className="janus-monitor-stat">
                          <span>{t('janus:island.expanded.identityLabel')}</span>
                          <strong style={{ color: previewRun ? previewIdentitySpec.color : undefined }}>
                            {previewRun ? runRoleLabel(previewRun.role, t) : t('janus:island.expanded.mainIdentity')}
                          </strong>
                        </div>
                        <div className="janus-monitor-stat">
                          <span>{t('janus:island.expanded.workspaceLabel')}</span>
                          <strong>{workspaceLabel}</strong>
                        </div>
                        <div className="janus-monitor-stat">
                          <span>{t('janus:island.expanded.statusLabel')}</span>
                          <strong>
                            {previewRun
                              ? t(SUBAGENT_STATUS_KEY[previewRun.status]).toUpperCase()
                              : activeTerminal
                                ? terminalStatusLabel(activeTerminal.status, t).toUpperCase()
                                : modeLabel}
                          </strong>
                        </div>
                        <div className="janus-monitor-stat">
                          <span>{t('janus:island.expanded.engineLabel')}</span>
                          <strong style={{ color: previewRun ? previewIdentitySpec.color : activeTerminal ? modeColor : undefined }}>
                            {previewRun
                              ? runEngineLabel(previewRun, t).toUpperCase()
                              : activeTerminal
                                ? terminalProviderLabel(activeTerminal.preset, t).toUpperCase()
                                : monitorStatusText}
                          </strong>
                        </div>
                        <WorkflowXMonitor />
                      </div>
                    </div>
                    <div className="janus-monitor-right">
                      <div className="janus-monitor-panel janus-runtime-panel">
                        <div className="janus-monitor-section-title">
                          <span>{t('janus:island.expanded.subagentRuntimes')}</span>
                          <em>{activeTerminal ? t('janus:island.expanded.focusedTerminal') : t('janus:island.expanded.noTerminalFocus')}</em>
                        </div>
                        <div className="janus-runtime-list" aria-label={t('janus:island.expanded.runtimeAria')}>
                          {visibleSubAgentRuns.length === 0 ? (
                            <div className="janus-runtime-placeholder">
                              <div className="janus-runtime-core">
                                <span className="janus-runtime-eye" />
                                <span className="janus-runtime-eye" />
                              </div>
                              <div className="janus-runtime-meta">
                                <strong>{t('janus:island.expanded.noRuns')}</strong>
                                <span>{t('janus:island.expanded.noRunsHint')}</span>
                              </div>
                            </div>
                          ) : (
                            visibleSubAgentRuns.map((run) => (
                              <button
                                key={run.id}
                                type="button"
                                className="janus-runtime-run"
                                data-status={run.status}
                                data-selected={previewRun?.id === run.id}
                                aria-pressed={previewRun?.id === run.id}
                                style={runtimeRoleStyle(run.role)}
                                onClick={() => setSelectedRunId(run.id)}
                              >
                                <JanusIdentityCore
                                  identity={roleIdentity(run.role)}
                                  state={previewIdentityState(run)}
                                  size="pod"
                                  aria-label={`${run.title} ${run.status}`}
                                />
                                <div className="janus-runtime-run-main">
                                  <div className="janus-runtime-run-title">
                                    <strong>{run.title}</strong>
                                    <span>{runEngineLabel(run, t)}</span>
                                  </div>
                                  <div className="janus-runtime-run-event">{run.lastEvent ?? t('janus:island.expanded.waitingForEvent')}</div>
                                </div>
                                <div className="janus-runtime-run-side">
                                  <span className="janus-runtime-run-status">{t(SUBAGENT_STATUS_KEY[run.status])}</span>
                                  <span>{formatRunAge(run.updatedAt, t)}</span>
                                  {run.terminalId ? (
                                    <button
                                      type="button"
                                      onClick={(event) => {
                                        event.stopPropagation()
                                        focusRunTerminal(run)
                                      }}
                                    >
                                      {t('janus:island.expanded.focus')}
                                    </button>
                                  ) : null}
                                </div>
                              </button>
                            ))
                          )}

                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className={view === 'roundtable' ? 'janus-roundtable-view' : 'janus-roundtable-view janus-roundtable-view--hidden'}>
                  <JanusRoundtablePane
                    embedded
                    resourceController={resourceController}
                    onClose={() => setView('chat')}
                    parchmentOpen={parchmentOpen}
                    parchmentDetailOpen={parchmentDetailOpen}
                    onToggleParchment={onToggleParchment}
                    onOpenParchmentDetail={onOpenParchmentDetail}
                    onOpenAgentResult={onOpenAgentResult}
                    onOpenQuestions={onOpenQuestionsDetail}
                    onStateChange={onRoundtableStateChange}
                    onRequestAuxiliaryClose={onRequestAuxiliaryClose}
                    center={(onRoundtableSend, roundtableMessages, _workingRole, cards, hostQuestions, inputPlaceholder) => <>
                      <JanusChat
                        visible={stage === 'expanded' && view === 'roundtable'}
                        docked discussionOnly
                        modeColor={modeColor} messages={roundtableMessages} pendingContent="" isStreaming={false} error={null}
                        modelOptions={modelOptions} activeModel={activeModel} modelNotice={null}
                        roundtableCards={cards}
                        roundtableQuestions={hostQuestions}
                        inputPlaceholderOverride={inputPlaceholder}
                        onOpenQuestions={onOpenQuestionsDetail}
                        onOpenAgentResult={onOpenAgentResult}
                        onSelectModel={onChatSelectModel} onSend={onRoundtableSend} onRewrite={onChatRewrite}
                        onStop={() => undefined} onRetry={onChatRetry} onClear={onChatClear} resourceController={resourceController}
                      />
                    </>}
                  />
                </div>
                <div className={view === 'chat' ? 'janus-chat-view' : 'janus-chat-view janus-chat-view--hidden'}><JanusChat
                  // Only the active Island Chat view may own global chat shortcuts.
                  // Keeping the hidden Monitor/collapsed instance mounted would let
                  // it intercept Tab/Ctrl+P and open a menu outside the viewport.
                  visible={stage === 'expanded' && view === 'chat'}
                  docked
                  modeColor={modeColor}
                  messages={messages}
                  pendingContent={pendingContent}
                  isStreaming={isStreaming}
                  error={error}
                  modelOptions={modelOptions}
                  activeModel={activeModel}
                  modelNotice={modelNotice}
                  onSelectModel={onChatSelectModel}
                  onSend={onChatSend}
                  onRewrite={onChatRewrite}
                  onStop={onChatStop}
                  onRetry={onChatRetry}
                  onClear={onChatClear}
                  conversationController={conversationController}
                  resourceController={resourceController}
                  toolTraces={toolTraces}
                /></div>
              </div>

              <div className="janus-expanded-bottombar">
                <div className="janus-expanded-caption">
                  <span>{t('janus:island.expanded.captionJanus')}</span>
                  <span className="janus-expanded-caption-divider" />
                  <span>{statusText}</span>
                </div>
                <div className="janus-expanded-actions">
              <button type="button" className="janus-expanded-action-button" onClick={onOpenPlugins}>
                    {t('janus:island.expanded.openPlugins')}
                  </button>
                </div>
              </div>
            </div>
  )
}
