import { useWorktreeStore } from '@/stores/worktree'
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useCallback,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { useAppStore } from '@/stores/app'
import { useWorkspaceStore } from '@/stores/workspace'
import { useI18n } from '@/i18n/useI18n'
import { useCheckpointStore } from '@/stores/checkpoint'
import { useRightToolStore } from '@/stores/right-tools'
import { invalidateEditorFileCache, useEditorStore } from '@/stores/editor'
import { Titlebar } from '@/components/Titlebar'
import { Sidebar } from '@/components/Sidebar'
import { TerminalArea } from '@/components/TerminalArea'
import { WorkbenchErrorBoundary } from '@/components/WorkbenchErrorBoundary'
import { TerminalSelector } from '@/components/TerminalSelector'
import { Panel, RightDockLayoutProvider } from '@/components/Panel'
import { getAuxiliaryWorkspaceLayout, EDITOR_MIN_WIDTH } from '@/lib/auxiliary-layout'
import { useAuxiliaryPanelsStore } from '@/stores/auxiliary-panels'
import { StatusBar } from '@/components/StatusBar'
import { FileEditor } from '@/components/FileEditor'
import { AgentNotificationHost } from '@/components/AgentNotificationHost'
import { JanusChatProvider } from '@/components/janus/JanusChatProvider'
import { warmDefaultShellCache, warmTerminalCreatePath } from '@/lib/terminal-launch'
import { preloadBuiltinRightTools } from '@/extensions/builtins'
import dockStyles from '@/components/right-tools/RightDock.module.css'
import { useWorkspaceBootstrap } from '@/features/workspace/useWorkspaceBootstrap'
// Terminal event subscriptions live at app level, not inside TerminalArea:
// the area unmounts whenever the pane tree is null (empty workspace or after
// the last terminal closes), so a Continue/Resume-spawned terminal's
// `terminal:created` event would arrive with no subscriber and the workbench
// could never bootstrap its first terminal from a main-side launch.
import { useTerminalLifecycle } from '@/features/terminal/useTerminalLifecycle'
import { useTeamStore } from '@/stores/team'
import { TeamSetupGate } from '@/components/team/TeamSetupGate'
import { FolderOpen } from 'lucide-react'
import { chooseAndCreateWorkspace, getActiveScopePath, loadWorkspaceFileTree } from '@/features/workspace/actions'
import { useGlobalToolsStore } from '@/stores/global-tools'
import { shouldRenderWorkspacePane } from '@/lib/workspace-front-surface'
import { OnboardingHost } from '@/components/onboarding/OnboardingHost'
import { LearningButton } from '@/components/onboarding/LearningButton'
import styles from './App.module.css'


type IdleWindow = Window & {
  requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number
  cancelIdleCallback?: (id: number) => void
}

const SIDE_PANEL_WIDTH = 'clamp(252px, 15vw, 288px)'
const SIDE_PANEL_COLLAPSED_WIDTH = '52px'
const EMBEDDED_EDITOR_MIN_WIDTH = EDITOR_MIN_WIDTH

function clampEmbeddedEditorWidth(width: number, maxWidth: number): number {
  return Math.max(EMBEDDED_EDITOR_MIN_WIDTH, Math.min(maxWidth, width))
}


interface EditorResizeSession {
  pointerId: number
  target: HTMLDivElement
  editorRightEdge: number
  maxWidth: number
}

export default function App() {
  const workspaceReady = useWorkspaceBootstrap()
  useTerminalLifecycle()
  // ToB M2：启动即恢复团队会话（refresh 静默续期），失败即 guest 由挡板接管。
  useEffect(() => { void useTeamStore.getState().bootstrap() }, [])
  // 主题：首屏加载持久化值并挂载 [data-theme]（石板色默认、经典黑第二，两边都显式挂载）。
  useEffect(() => {
    void import('@/stores/theme').then(({ useThemeStore }) => useThemeStore.getState().load())
  }, [])
  // P5: 细粒度 selector——App 是整树根组件，任意 store 字段变化都不应带动整树
  const sidebarCollapsed = useAppStore((s) => s.sidebarCollapsed)
  const panelCollapsed = useAppStore((s) => s.panelCollapsed)
  const subscribeToCheckpointEvents = useCheckpointStore((s) => s.subscribeToEvents)
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId)
  const worktreePath = useWorktreeStore(s => activeWorkspaceId ? s.activePaths[activeWorkspaceId] : undefined)
  const hasWorkspacePane = useWorkspaceStore((s) => s.paneTree !== null)
  const hasRetainedWorkspacePane = useWorkspaceStore((s) =>
    Object.values(s.terminalSnapshots).some((snapshot) => snapshot.paneTree !== null)
  )
  const hasGlobalToolsPane = useGlobalToolsStore((s) => s.paneTree !== null)
  const showWorkspacePane = shouldRenderWorkspacePane(hasWorkspacePane || hasGlobalToolsPane)
  const mountWorkspacePane = showWorkspacePane || hasRetainedWorkspacePane
  const rightToolPanelWidth = useRightToolStore((s) => s.panelWidth)
  const rightToolPanelWidths = useRightToolStore((s) => s.panelWidths)
  const rightToolActiveId = useRightToolStore((s) => s.activeToolId)
  const isEditorEmbedded = useEditorStore((s) => s.isEmbedded && s.isVisible)
  const hasEmbeddedFiles = useEditorStore((s) => s.isEmbedded && s.openFiles.length > 0)
  const toolsCollapsed = useGlobalToolsStore(s => s.collapsed)
  const projectTree = useWorkspaceStore(s => s.paneTree)
  const auxiliaryPriority = useAuxiliaryPanelsStore(s => s.priority)
  const editorCompact = useAuxiliaryPanelsStore(s => s.editorCompact)
  const embeddedEditorWidth = useEditorStore((s) => s.embeddedWidth)
  const [rightDockResizing, setRightDockResizing] = useState(false)
  const [editorResizing, setEditorResizing] = useState(false)
  const appGridRef = useRef<HTMLDivElement | null>(null)
  const centerWorkspaceRef = useRef<HTMLElement | null>(null)
  const editorWorkspaceRef = useRef<HTMLElement | null>(null)
  const editorResizeSessionRef = useRef<EditorResizeSession | null>(null)
  const editorBodyStyleRef = useRef<{ cursor: string; userSelect: string } | null>(null)
  const [appGridWidth, setAppGridWidth] = useState(() => window.innerWidth)
  const sidebarWidth = sidebarCollapsed
    ? 52
    : Math.min(288, Math.max(252, appGridWidth * 0.15))
  const { rightDockLayout, centerReserve, editorMaxWidth, editorVisible: showEmbeddedEditor, editorWidth: editorColumnWidth } = getAuxiliaryWorkspaceLayout({
    availableWidth: appGridWidth - sidebarWidth,
    panelCollapsed, panelWidth: rightToolPanelWidth, panelWidths: rightToolPanelWidths,
    activeToolId: rightToolActiveId, hasActiveTool: rightToolActiveId !== null,
    hasProject: activeWorkspaceId !== null || projectTree !== null, projectTree,
    toolsRequested: hasGlobalToolsPane && !toolsCollapsed,
    editorRequested: isEditorEmbedded, editorWidth: embeddedEditorWidth,
    editorWasCompact: editorCompact, priority: auxiliaryPriority,
  })
  useLayoutEffect(() => {
    useAuxiliaryPanelsStore.setState({ editorCompact: isEditorEmbedded && !showEmbeddedEditor })
  }, [isEditorEmbedded, showEmbeddedEditor])

  useLayoutEffect(() => {
    const grid = appGridRef.current
    if (!grid) return
    const updateWidth = () => setAppGridWidth(grid.getBoundingClientRect().width)
    updateWidth()
    const observer = new ResizeObserver(updateWidth)
    observer.observe(grid)
    return () => observer.disconnect()
  }, [])

  const finishEditorResize = useCallback((updateState = true) => {
    const session = editorResizeSessionRef.current
    if (session?.target.hasPointerCapture(session.pointerId)) {
      session.target.releasePointerCapture(session.pointerId)
    }
    editorResizeSessionRef.current = null
    if (updateState) setEditorResizing(false)
    if (editorBodyStyleRef.current) {
      document.body.style.cursor = editorBodyStyleRef.current.cursor
      document.body.style.userSelect = editorBodyStyleRef.current.userSelect
      editorBodyStyleRef.current = null
    }
  }, [])

  const handleEditorResizeStart = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !centerWorkspaceRef.current || !editorWorkspaceRef.current) return

    finishEditorResize()
    const editorRect = editorWorkspaceRef.current.getBoundingClientRect()
    const centerRect = centerWorkspaceRef.current.getBoundingClientRect()
    editorResizeSessionRef.current = {
      pointerId: event.pointerId,
      target: event.currentTarget,
      editorRightEdge: editorRect.right,
      maxWidth: Math.max(
        EMBEDDED_EDITOR_MIN_WIDTH,
        editorRect.width + centerRect.width - centerReserve,
      ),
    }
    editorBodyStyleRef.current = {
      cursor: document.body.style.cursor,
      userSelect: document.body.style.userSelect,
    }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    event.currentTarget.setPointerCapture(event.pointerId)
    setEditorResizing(true)
    event.preventDefault()
  }, [finishEditorResize, centerReserve])

  const handleEditorResizeMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const session = editorResizeSessionRef.current
    if (!session || session.pointerId !== event.pointerId) return
    useEditorStore.getState().setEmbeddedWidth(
      clampEmbeddedEditorWidth(session.editorRightEdge - event.clientX, session.maxWidth),
    )
  }, [])

  const handleEditorResizeEnd = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (editorResizeSessionRef.current?.pointerId !== event.pointerId) return
    finishEditorResize()
  }, [finishEditorResize])

  const handleEditorResizeKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    const widthByKey: Partial<Record<string, number>> = {
      ArrowLeft: editorColumnWidth + 16,
      ArrowRight: editorColumnWidth - 16,
      Home: EMBEDDED_EDITOR_MIN_WIDTH,
      End: editorMaxWidth,
    }
    const nextWidth = widthByKey[event.key]
    if (nextWidth === undefined) return
    useEditorStore.getState().setEmbeddedWidth(clampEmbeddedEditorWidth(nextWidth, editorMaxWidth))
    event.preventDefault()
  }, [editorColumnWidth, editorMaxWidth])

  useEffect(() => () => finishEditorResize(false), [finishEditorResize])

  /*-- P0: 翻转容器 ref，拖拽时 direct DOM 操作 transform --*/

  useEffect(() => {
    return subscribeToCheckpointEvents()
  }, [subscribeToCheckpointEvents])

  // Note: .agents/notes/workbench/unified-file-window.md
  useEffect(() => {
    const unsubscribe = window.electron.window.onEditorEmbedded(async payload => {
    try {
      await useEditorStore.getState().acceptDelivery(payload)
      if (payload.requestId) window.electron.window.editorReceived(payload.requestId, true)
    } catch {
      if (payload.requestId) window.electron.window.editorReceived(payload.requestId, false)
    }
    })
    window.electron.window.editorHostReady()
    return unsubscribe
  }, [])
  useEffect(() => window.electron.fileTree.onChanged(payload => {
    invalidateEditorFileCache(payload.workspacePath)
    void useEditorStore.getState().reloadOpenFiles(payload.workspacePath, payload.changedFilePath ?? null)
  }), [])
  useEffect(() => {
    const workspace = useWorkspaceStore.getState().workspaces.find(item => item.id === activeWorkspaceId)
    useEditorStore.getState().switchScope(worktreePath ?? workspace?.path ?? null)
  }, [activeWorkspaceId, worktreePath])

  useEffect(() => {
    const idleWindow = window as IdleWindow
    const runWarmup = () => {
      warmDefaultShellCache()
      warmTerminalCreatePath()
      preloadBuiltinRightTools()
    }

    if (idleWindow.requestIdleCallback) {
      const id = idleWindow.requestIdleCallback(runWarmup, { timeout: 2500 })
      return () => idleWindow.cancelIdleCallback?.(id)
    }

    const id = window.setTimeout(runWarmup, 1200)
    return () => window.clearTimeout(id)
  }, [])

  return (
    <JanusChatProvider>
    <div
      className="h-screen flex flex-col"
      style={{
        background: 'var(--bg-app)',
        color: 'var(--text)',
      }}
    >
      <Titlebar />
      <div
        ref={appGridRef}
        className={`flex-1 min-h-0 grid grid-rows-[minmax(0,1fr)_28px] overflow-hidden ${dockStyles.workbenchGrid}`}
        data-resizing={rightDockResizing || editorResizing}
        style={{
          // 文件窗口轨道常驻（隐藏时 0px）：双击打开时 workbenchGrid 的 240ms 过渡才能平滑展开
          gridTemplateColumns: `${sidebarCollapsed ? SIDE_PANEL_COLLAPSED_WIDTH : SIDE_PANEL_WIDTH} minmax(320px, 1fr) ${editorColumnWidth}px ${rightDockLayout.dockWidth}px`,
        }}
      >
        <Sidebar />

        {/* perspective 保留给 pane 拖拽预览的 fixed 包含块语义。 */}
        <main ref={centerWorkspaceRef} className="min-w-0 min-h-0 overflow-hidden relative flex flex-col" style={{ perspective: 1500, background: 'var(--bg-deep)' }}>
          <div className="flex-1 min-h-0 relative">
            {mountWorkspacePane && (
              <div
                className="absolute inset-0"
                style={{
                  display: showWorkspacePane ? 'block' : 'none',
                }}
                {...(!showWorkspacePane ? { inert: '' } : {})}
                aria-hidden={!showWorkspacePane}
              >
                <WorkbenchErrorBoundary>
                  <TerminalArea auxiliaryControls />
                </WorkbenchErrorBoundary>
              </div>
            )}
            {!showWorkspacePane && (
              <>
                {activeWorkspaceId === null && <EmptyWorkspace />}
                {activeWorkspaceId !== null && <TerminalSelector />}
              </>
            )}
          </div>
        </main>

        {/*-- 槽位常驻：关闭时留 0px 空壳占位，网格自动排布才不会把右侧 Panel 挤错轨道 --*/}
        <section
          ref={editorWorkspaceRef}
          className={`relative min-w-0 overflow-hidden${showEmbeddedEditor ? ' border-l border-white/[0.07]' : ''}`}
          aria-label="Embedded file editor"
          aria-hidden={!showEmbeddedEditor}
          {...(showEmbeddedEditor ? {} : { inert: '' })}
        >
          {hasEmbeddedFiles && (
            <>
              <div
                role="separator"
                aria-label="Resize embedded editor"
                aria-orientation="vertical"
                aria-valuemin={EMBEDDED_EDITOR_MIN_WIDTH}
                aria-valuemax={Math.round(editorMaxWidth)}
                aria-valuenow={Math.round(editorColumnWidth)}
                tabIndex={0}
                className={dockStyles.resizeHandle}
                data-resizing={editorResizing}
                style={{ zIndex: 60 }}
                onPointerDown={handleEditorResizeStart}
                onPointerMove={handleEditorResizeMove}
                onPointerUp={handleEditorResizeEnd}
                onPointerCancel={handleEditorResizeEnd}
                onLostPointerCapture={handleEditorResizeEnd}
                onKeyDown={handleEditorResizeKeyDown}
              />
              <FileEditor active={showEmbeddedEditor} />
            </>
          )}
        </section>
        <RightDockLayoutProvider
          effectiveCollapsed={rightDockLayout.effectiveCollapsed}
          effectiveMaxWidth={rightDockLayout.effectiveMaxWidth}
          forcedCollapsed={rightDockLayout.responsiveAutoCollapsed}
          onResizingChange={setRightDockResizing}
        >
          <Panel />
        </RightDockLayoutProvider>
        <div className="col-span-full min-w-0 [&>footer]:h-full">
          <StatusBar />
        </div>
      </div>
      <AgentNotificationHost />
      {/* ToB M2：未登录/无组织时全屏挡板 */}
      <TeamSetupGate />
      <OnboardingHost workspaceReady={workspaceReady} />
    </div>
    </JanusChatProvider>
  )
}

function EmptyWorkspace() {
  const { t } = useI18n()
  const addWorkspace = useWorkspaceStore((s) => s.addWorkspace)
  const setActiveWorkspace = useWorkspaceStore((s) => s.setActiveWorkspace)
  const setLoadState = useAppStore((s) => s.setLoadState)

  const handleAdd = async () => {
    try {
      const workspace = await chooseAndCreateWorkspace()
      if (!workspace) return
      addWorkspace(workspace)
      setActiveWorkspace(workspace.id)
      setLoadState('no-terminal')
      await loadWorkspaceFileTree(workspace.path, () => getActiveScopePath() === workspace.path, { visualTransition: true }).catch(() => {})
    } catch (err) {
      console.error('Failed to create workspace:', err)
    }
  }

  return (
    <section className={styles.emptyWorkspace} aria-labelledby="empty-workspace-title">
      <div className={styles.emptyContent}>
        <div className={styles.emptyIcon}>
          <FolderOpen size={28} strokeWidth={1.1} aria-hidden="true" />
        </div>
        <h1 id="empty-workspace-title" className={styles.emptyTitle}>{t('common:emptyWorkspace.title')}</h1>
        <button
          data-onboarding="add-workspace"
          onClick={handleAdd}
          className={styles.emptyAction}
        >
          <FolderOpen size={12} strokeWidth={1.5} aria-hidden="true" />
          {t('common:emptyWorkspace.chooseFolder')}
        </button>
        <p className={styles.emptyHint}>{t('common:emptyWorkspace.hint')}</p>
        <LearningButton />
      </div>
    </section>
  )
}
