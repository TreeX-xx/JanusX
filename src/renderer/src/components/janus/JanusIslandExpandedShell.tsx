import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Inbox } from 'lucide-react'
import type { SubAgentRun } from '../../../../shared/subAgentRun'
import type { AgentResultCard } from '../../../../shared/roundtable/events'
import type { RoundtableState } from '../../../../shared/roundtable/events'
import { useWorkspaceStore } from '@/stores/workspace'
import { useExperimentalStore } from '@/stores/experimental'
import { useSubAgentRunStore } from '@/stores/subagent-run'
import { useI18n } from '@/i18n/useI18n'
import { useExtensionViews } from '@/extensions/react'
import { ExtensionViewHost } from '@/extensions/ExtensionViewHost'
import { useWorktreeStore } from '@/stores/worktree'
import { JanusIdentityCore } from './JanusIdentityCore'
import { WorkflowXMonitor } from './WorkflowXMonitor'
import { getJanusAgentIdentity } from './janusIdentity'
import { JanusChat } from './JanusChat'
import { JanusRoundtablePane } from './JanusRoundtablePane'
import { ISLAND_CHAT_ONLY } from './janusIslandTypes'
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
import { IslandNotificationCenter, type IslandNotificationCenterProps } from './IslandNotificationCenter'

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
  notificationCenter: IslandNotificationCenterProps
  trayOpen: boolean
  onToggleTray: () => void
}

export function JanusIslandExpandedShell({
  stage, view, setView, mode, janusRunning,
  parchmentOpen, parchmentDetailOpen, onToggleParchment, onOpenParchmentDetail,
  workspaceLabel, modeLabel, modeColor, statusText, onOpenPlugins,
  onOpenAgentResult,
  onOpenQuestionsDetail,
  onRoundtableStateChange,
  onRequestAuxiliaryClose,
  notificationCenter, trayOpen, onToggleTray,
  messages, pendingContent,
  isStreaming, error, modelOptions, activeModel, modelNotice,
  onChatSelectModel, onChatSend, onChatRewrite, onChatStop, onChatRetry,
  onChatClear, conversationController,
  resourceController, toolTraces = [],
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
    if (ISLAND_CHAT_ONLY) return
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
    if (ISLAND_CHAT_ONLY || stage !== 'expanded') {
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
                  <div className="janus-expanded-brand island-title">
                    {t('janus:island.expanded.brand')}
                  </div>
                </div>
                {!ISLAND_CHAT_ONLY && <div className="janus-expanded-view-switch" aria-label={t('janus:island.expanded.viewSwitchAria')}>
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
                </div>}
                <div className="janus-notify-anchor">
                  <button type="button" className="janus-notify-badge" data-active={trayOpen}
                    data-unread={notificationCenter.unreadCount > 0} aria-expanded={trayOpen}
                    onClick={onToggleTray} aria-label={t('janus:island.notif.badgeAria', { count: notificationCenter.unreadCount })}>
                    <Inbox size={13} aria-hidden="true" />
                    <span>{t('janus:island.notif.title')}</span>
                    {notificationCenter.unreadCount > 0 && <span className="janus-notify-count" aria-hidden="true">{notificationCenter.unreadCount}</span>}
                  </button>
                  {trayOpen && <div className="janus-notify-tray"><IslandNotificationCenter {...notificationCenter} /></div>}
                </div>
                <div className="janus-expanded-meta">
                  <span className="janus-expanded-meta-text">{t('janus:island.expanded.dismissHint')}</span>
                </div>
              </div>

              <div className="janus-expanded-body">
                {pluginActionFailure && <p role="alert">{pluginActionFailure}</p>}
                {!ISLAND_CHAT_ONLY && stage === 'expanded' && selectedPlugin && <section className="plugin-island-tool" data-plugin-island-tool={selectedPlugin.id}>
                  <header>{selectedPlugin.extensionId} · {selectedPlugin.title}</header>
                  <div className="flex-1 min-h-0"><ExtensionViewHost viewId={selectedPlugin.id} location="island" active={!trayOpen}
                    workspaceId={projectId} workspacePath={workspace?.path ?? null} /></div>
                </section>}
                {!ISLAND_CHAT_ONLY && <div className="janus-feedback-panel">
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
                </div>}
                {!ISLAND_CHAT_ONLY && <div className={view === 'roundtable' ? 'janus-roundtable-view' : 'janus-roundtable-view janus-roundtable-view--hidden'}>
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
                </div>}
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

              {!ISLAND_CHAT_ONLY && <div className="janus-expanded-bottombar">
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
              </div>}
            </div>
  )
}
