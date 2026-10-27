import { WindowControls } from './WindowControls'
import type { IslandControllerAction } from '@/components/janus/islandController'
import { useState, useCallback, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useWorkspaceStore } from '@/stores/workspace'
import { useAppStore } from '@/stores/app'
import { JanusIsland } from '@/components/janus'
import { AppSettingsModal, type SettingsTab } from '@/components/AppSettingsModal'
import { PersonalMemoryWorkbench } from '@/components/knowledge'
import { UpdaterBadge } from '@/components/UpdaterBadge'
import { PromptDialog } from '@/components/common/PromptDialog'
import { WorkbenchSwitcher } from '@/components/WorkbenchSwitcher'
import { PluginWorkbenchHost } from '@/extensions/PluginWorkbenchHost'
import { PluginWorkspaceHandoffHost } from '@/extensions/PluginWorkspaceHandoffHost'
import { TitlebarToolGroup, TitlebarToolSeparator } from '@/components/TitlebarToolGroup'
import { useJanusChatController } from '@/components/janus/JanusChatProvider'
import { useGlobalRunning } from '@/components/janus/useGlobalRunning'
import { JanusRunOrbs } from '@/components/janus/JanusRunOrbs'
import { TitlebarRunButton } from './TitlebarRunButton'
import { KNOWLEDGE_PEEK_TIMEOUT_MS } from '@/components/janus/islandKnowledgePeek'
import { useIslandStore } from '@/stores/island'
import { useExperimentalStore } from '@/stores/experimental'
import { useTeamStore } from '@/stores/team'
import { useWorkflowXDetection } from './janus/useWorkflowXDetection'
import { useI18n } from '@/i18n/useI18n'
import { PLUGIN_CONFIGURATION_EVENT, PLUGIN_MANAGEMENT_EVENT, PLUGIN_SETTINGS_EVENT, type PluginAuthorizationTarget, type PluginConfigurationTarget } from '@/extensions/plugin-configuration-navigation'
import { extensionRegistry, isExtensionViewId } from '@/extensions/registry'

/* ════════════════════════════════════════════════════════════
   Titlebar �?标题栏（简化版�?
   灵动岛逻辑已提取至 janus/ 模块
   新增：LLM 配置隐藏触发器（参考神性设计原型）
   ════════════════════════════════════════════════════════════ */

export function Titlebar() {
  const { t } = useI18n('common')
  useGlobalRunning()
  useWorkflowXDetection()
  const islandStage = useIslandStore((state) => state.stage)
  const knowledgePeek = useIslandStore((state) => state.knowledge)
  // Stable wrapper: the store dispatch is created once, and a useCallback keeps
  // the effect/callback dependency arrays honest.
  const dispatchIsland = useCallback((action: IslandControllerAction) => useIslandStore.getState().dispatch(action), [])
  // Pinned island window (owned by JanusIsland): while pinned, a terminal
  // switch must not collapse the conversation back to the capsule.
  const [islandPinned, setIslandPinned] = useState(false)
  const islandPinnedRef = useRef(islandPinned)
  islandPinnedRef.current = islandPinned
  const [settingsModalOpen, setSettingsModalOpen] = useState(false)
  const [settingsInitialTab, setSettingsInitialTab] = useState<SettingsTab>('general')
  const [pluginConfiguration, setPluginConfiguration] = useState<PluginConfigurationTarget | null>(null)
  const [pluginAuthorization, setPluginAuthorization] = useState<PluginAuthorizationTarget | null>(null)
  useEffect(() => {
    const open = (event: Event) => {
      setPluginConfiguration((event as CustomEvent<PluginConfigurationTarget>).detail)
      setPluginAuthorization(null)
      setSettingsInitialTab('plugins')
      setSettingsModalOpen(true)
    }
    window.addEventListener(PLUGIN_CONFIGURATION_EVENT, open)
    return () => window.removeEventListener(PLUGIN_CONFIGURATION_EVENT, open)
  }, [])
  useEffect(() => {
    const open = (event: Event) => {
      const id: unknown = (event as CustomEvent).detail
      if (typeof id !== 'string' || !isExtensionViewId(id) || extensionRegistry.getView(id)?.location !== 'settings') return
      setSettingsInitialTab(id)
      setSettingsModalOpen(true)
    }
    window.addEventListener(PLUGIN_SETTINGS_EVENT, open)
    return () => window.removeEventListener(PLUGIN_SETTINGS_EVENT, open)
  }, [])
  useEffect(() => {
    const openPlugins = (event: Event) => {
      setPluginConfiguration(null)
      const target = (event as CustomEvent<PluginAuthorizationTarget | undefined>).detail
      setPluginAuthorization(target && typeof target.pluginId === 'string' && typeof target.projectId === 'string' ? target : null)
      setSettingsInitialTab('plugins')
      setSettingsModalOpen(true)
    }
    window.addEventListener(PLUGIN_MANAGEMENT_EVENT, openPlugins)
    window.addEventListener('janusx:open-knowledge-settings', openPlugins)
    return () => {
      window.removeEventListener(PLUGIN_MANAGEMENT_EVENT, openPlugins)
      window.removeEventListener('janusx:open-knowledge-settings', openPlugins)
    }
  }, [])
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false)
  // 侧栏团队区请求打开设置 team 页（计数器变化即打开）。
  // 创新开关关闭时忽略请求：入口已隐藏，不应再弹出 team 页。
  const teamSettingsRequest = useTeamStore((s) => s.settingsRequest)
  const teamCollabEnabled = useExperimentalStore((s) => s.teamCollab)
  const lastTeamSettingsRequest = useRef(teamSettingsRequest)
  useEffect(() => {
    if (teamSettingsRequest !== lastTeamSettingsRequest.current) {
      lastTeamSettingsRequest.current = teamSettingsRequest
      if (!teamCollabEnabled) return
      setSettingsInitialTab('team')
      setSettingsModalOpen(true)
    }
  }, [teamSettingsRequest, teamCollabEnabled])

  const conversationController = useJanusChatController()
  const {
    messages,
    pendingContent,
    isStreaming,
    error,
    modelOptions,
    activeModel,
    modelNotice,
    latestRecallTrace,
    toolTraces,
    resourceController,
    send: handleChatSend,
    rewrite: handleChatRewrite,
    stop: handleChatStop,
    retry: handleChatRetry,
    clear: handleChatClear,
    selectModel: handleChatSelectModel,
  } = conversationController

  const activeWorkbench = useAppStore((s) => s.activeWorkbench)
  const setActiveWorkbench = useAppStore((s) => s.setActiveWorkbench)
  const knowledgeEnabled = useExperimentalStore((s) => s.persona)
  const loadExperimental = useExperimentalStore((s) => s.load)

  useEffect(() => {
    void loadExperimental()
  }, [loadExperimental])
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId)
  const activeTerminalId = useWorkspaceStore((s) => s.activeTerminalId)
  const previousActiveWorkspaceId = useRef(activeWorkspaceId)
  // Note: old blueprint shortcuts lead to installation; downloaded plugins own their UI.
  useEffect(() => {
    if (activeWorkbench !== 'blueprint') return
    setActiveWorkbench(null)
    setSettingsInitialTab('plugins')
    setSettingsModalOpen(true)
  }, [activeWorkbench, setActiveWorkbench])

  useEffect(() => {
    dispatchIsland({ type: 'trace', trace: latestRecallTrace })
  }, [dispatchIsland, latestRecallTrace])

  useEffect(() => {
    if (previousActiveWorkspaceId.current === activeWorkspaceId) return
    previousActiveWorkspaceId.current = activeWorkspaceId
    dispatchIsland({ type: 'invalidate' })

  }, [dispatchIsland, activeWorkspaceId])

  useEffect(() => {
    if (islandStage !== 'peek' || knowledgePeek.presentation === 'hidden') return
    const version = knowledgePeek.version
    const timer = window.setTimeout(() => {
      dispatchIsland({ type: 'timeout', version })
    }, KNOWLEDGE_PEEK_TIMEOUT_MS)
    return () => window.clearTimeout(timer)
  }, [dispatchIsland, islandStage, knowledgePeek.presentation, knowledgePeek.version])

  // Note: product discovery and jumps retired — .agents/notes/workbench/unified-file-window.md
  const handleIslandSingleActivate = useCallback(() => dispatchIsland({ type: 'single-activate' }), [dispatchIsland])
  const handleIslandDoubleActivate = useCallback(() => dispatchIsland({ type: 'double-activate' }), [dispatchIsland])
  const handleIslandDismiss = useCallback(() => dispatchIsland({ type: 'dismiss' }), [dispatchIsland])

  const handleChatClearAndInvalidatePeek = useCallback(() => {
    handleChatClear()
    dispatchIsland({ type: 'invalidate' })
  }, [dispatchIsland, handleChatClear])

  const previousActiveTerminalId = useRef(activeTerminalId)
  useEffect(() => {
    if (previousActiveTerminalId.current !== activeTerminalId) {
      previousActiveTerminalId.current = activeTerminalId
      if (islandPinnedRef.current) return
      dispatchIsland({ type: 'terminal-changed' })
    }
  }, [dispatchIsland, activeTerminalId])


  const handleSettingsTriggerClick = useCallback(() => {
    setSettingsInitialTab('general')
    setSettingsModalOpen(true)
  }, [])

  const handleUpdaterBadgeClick = useCallback(() => {
    setSettingsInitialTab('about')
    setSettingsModalOpen(true)
  }, [])

  const handleCloseClick = useCallback(() => {
    setCloseConfirmOpen(true)
  }, [])

  const handleCloseConfirm = useCallback(() => {
    setCloseConfirmOpen(false)
    void window.electron.window.close()
  }, [])

  const handleCloseCancel = useCallback(() => {
    setCloseConfirmOpen(false)
  }, [])

  return (
    <div
      className="h-[38px] flex items-center px-3 select-none titlebar-drag relative overflow-visible"
      style={{
        background: 'var(--chrome-bg)',
        backdropFilter: 'blur(20px)',
        borderBottom: '1px solid var(--shell-border)',
        zIndex: 9999,
      }}
    >
      {/* Platform window controls */}
      <WindowControls onClose={handleCloseClick} />

      {/* Logo + 隐藏�?LLM 配置触发�?*/}
      <div
        className="relative flex shrink-0 items-center gap-2 titlebar-no-drag cursor-pointer group"
        onClick={handleSettingsTriggerClick}
        title={t('common:titlebar.settings')}
      >
        {/* X 形图标（悬浮时变成两个横杠） */}
        <div className="relative w-4 h-4">
          <div
            className="llm-trigger-line-1 absolute w-3.5 h-[1.5px] top-1/2 left-1/2 rounded-[1px] transition-all duration-[400ms] ease-[cubic-bezier(0.175,0.885,0.32,1.275)]"
            style={{
              background: 'var(--shell-muted)',
              transform: 'translate(-50%, -50%) rotate(45deg)',
            }}
          />
          <div
            className="llm-trigger-line-2 absolute w-3.5 h-[1.5px] top-1/2 left-1/2 rounded-[1px] transition-all duration-[400ms] ease-[cubic-bezier(0.175,0.885,0.32,1.275)]"
            style={{
              background: 'var(--shell-accent)',
              transform: 'translate(-50%, -50%) rotate(-45deg)',
            }}
          />
        </div>

        {/* 文字 */}
        <span className="text-[13px] font-medium tracking-[0.5px] transition-all duration-[400ms] group-hover:text-[var(--shell-text)] group-hover:drop-shadow-[0_0_10px_rgba(255,120,48,0.4)]" style={{ color: 'var(--shell-muted)' }}>
          JanusX
        </span>

        {/* 更新状态入口：点击关于页查看进度、重试或选择安装。 */}
        <UpdaterBadge onOpenSettings={handleUpdaterBadgeClick} />

        {/* 隐藏的后缀代码（悬浮时滑出�?*/}
        <span
          className="llm-trigger-reveal font-mono text-[9px] font-semibold text-[var(--shell-accent)] tracking-[1px] opacity-0 transition-all duration-[400ms] ease-[cubic-bezier(0.175,0.885,0.32,1.275)]"
          style={{
            transform: 'translateX(-8px) scale(0.9)',
          }}
        >
          {t('common:titlebar.settingsReveal')}
        </span>
      </div>

      <AppSettingsModal
        isOpen={settingsModalOpen}
        onClose={() => { setSettingsModalOpen(false); setPluginConfiguration(null); setPluginAuthorization(null) }}
        initialTab={settingsInitialTab}
        pluginConfiguration={pluginConfiguration}
        pluginAuthorization={pluginAuthorization}
      />

      {createPortal(
        <PromptDialog
          open={closeConfirmOpen}
          confirmOnly
          tone="danger"
          title={t('common:titlebar.closeConfirmTitle')}
          description={t('common:titlebar.closeConfirmDesc')}
          confirmText={t('common:titlebar.closeConfirmExit')}
          cancelText={t('common:action.cancel')}
          onConfirm={handleCloseConfirm}
          onCancel={handleCloseCancel}
        />,
        document.body,
      )}

      {/*-- 右侧两组：全局工具（浏览器/Markdown）与工作台（蓝图/知识库），
           组间 12px 并由短竖分隔线隔开；无可见工作台时分隔线自动收起。
           学习入口归属设置与空工作区，见 .agents/notes/workbench/first-run-learning.md --*/}
      <div className="ml-auto flex shrink-0 items-center gap-3 titlebar-no-drag">
        <TitlebarRunButton />
        <TitlebarToolSeparator />
        <TitlebarToolGroup />
        <TitlebarToolSeparator />
        <WorkbenchSwitcher />
      </div>

      <PersonalMemoryWorkbench
        isOpen={knowledgeEnabled && activeWorkbench === 'knowledge'}
        onClose={() => setActiveWorkbench(null)}
      />
      <PluginWorkbenchHost />
      <PluginWorkspaceHandoffHost />

      {/* 灵动岛 + 运行球簇 */}
      <div
        className="titlebar-no-drag janus-island-cluster"
        style={{ zIndex: 2000 }}
      >
        <JanusIsland
          stage={islandStage}
          onSingleActivate={handleIslandSingleActivate}
          onDoubleActivate={handleIslandDoubleActivate}
          onDismiss={handleIslandDismiss}
          messages={messages}
          pendingContent={pendingContent}
          isStreaming={isStreaming}
          error={error}
          modelOptions={modelOptions}
          activeModel={activeModel}
          modelNotice={modelNotice}
          onChatSelectModel={handleChatSelectModel}
          onChatSend={handleChatSend}
          onChatRewrite={handleChatRewrite}
          onChatStop={handleChatStop}
          onChatRetry={handleChatRetry}
          onChatClear={handleChatClearAndInvalidatePeek}
          conversationController={conversationController}
          resourceController={resourceController}
          toolTraces={toolTraces}
          knowledgeTrace={knowledgePeek.trace}
          knowledgePeekActive={knowledgePeek.presentation !== 'hidden'}
          knowledgePeekEmpty={knowledgePeek.presentation === 'empty'}
          onIslandPinnedChange={setIslandPinned}
        />
        <JanusRunOrbs />
      </div>

    </div>
  )
}
