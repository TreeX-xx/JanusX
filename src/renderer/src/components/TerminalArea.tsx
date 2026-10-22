import { memo, useState, useCallback, useEffect, useLayoutEffect, useMemo, useRef, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useShallow } from 'zustand/react/shallow'
import { ChevronDown, ChevronRight, Globe, Minimize2, PanelRightClose, Puzzle, X } from 'lucide-react'
import { useGlobalToolsStore } from '@/stores/global-tools'
import { GlobalToolsLayout } from './GlobalToolsLayout'
import { TerminalSelector } from './TerminalSelector'
import { useWorkspaceStore } from '@/stores/workspace'
import { useWorktreeStore } from '@/stores/worktree'
import { useAppStore } from '@/stores/app'
import { useBrowserStore } from '@/stores/browser'
import { BrowserSurface } from './browser/BrowserSurface'
import { destroyBrowserSurface, popOutBrowserSurface } from '@/services/browser'
import { TerminalContextTooltip, TerminalRuntime, TerminalUsageStats } from './TerminalUsageDetails'
import { MarkdownPane } from './MarkdownPane'
import { ExtensionViewHost } from '@/extensions/ExtensionViewHost'
import { useExtensionCommands, useExtensionViews } from '@/extensions/react'
import { extensionCommands } from '@/extensions/commands'
import { extensionRegistry } from '@/extensions/registry'
import { openExtensionView } from '@/extensions/workbench'
import { MarkdownIcon } from './ui/MarkdownIcon'
import {
  applyTerminalDraftLifecycle,
  clampDrawerHeight,
  DRAWER_DEFAULT_HEIGHT,
  DRAWER_MIN_HEIGHT,
  DRAWER_MIN_PANE_HEIGHT,
  getDrawerHeight,
  getDrawerPanelId,
} from './note/quick-note-behavior'
import { CLITerminal } from './CLITerminal'
import { TurnChangeIsland } from './TurnChangeIsland'
import { HoldToConfirm } from './ui/HoldToConfirm'
import { useBrowserOcclusion } from '@/hooks/useBrowserOcclusion'
import { useI18n } from '@/i18n/useI18n'
import { getContextPopoverPosition, type PopoverAnchorRect, type PopoverSize } from './context-popover-position'
import {
  contextExactLabel,
  contextLabel,
  contextPercentLabel,
  contextRatio,
  contextRatioColor,
  modelLabel,
  providerLabel,
} from '@/lib/terminal-labels'
import type { TerminalPreset, Terminal } from '@/types'
import {
  getActiveBrowserTabDragId,
  getActiveTerminalDragId,
  hasBrowserTabDrag,
  hasTerminalDrag,
  hasWorkspaceFileDrag,
  readBrowserTabDragData,
  readTerminalDragData,
} from '@/lib/terminal-file-reference'
import {
  getLeafPanes,
  type PaneDropEdge,
  type WorkspacePaneLeaf,
  type WorkspacePaneNode,
  type WorkspacePaneSplit,
} from '@/lib/workspace-pane'
import { getPaneDropHint, midpointInsertIndex, paneDropHintLabel, SPLIT_RATIO_EQUAL, type PaneDropHint } from '@/lib/pane-drop-hint'
import { startPaneTabDrag } from '@/lib/pane-tab-drag'
import { attachWheelScrollX, revealStripItem } from '@/lib/wheel-scroll-x'
import { getTerminalStatusVisual } from '@/lib/terminal-sidebar-visual'
import { getTerminalPresetMeta } from '../../../shared/terminalLaunch'
import {
  describeShellEntry,
  listVisibleCliPresets,
  listVisibleShellEntries,
  type ShellProfilesSettings,
} from '../../../shared/shellProfiles'
import { useShellProfilesStore } from '@/stores/shell-profiles'
import {
  launchTerminalPreset,
  retryTerminalCreate,
  warmDefaultShellCache,
  warmShellProfilesCache,
  warmTerminalCreatePath,
} from '@/lib/terminal-launch'
// Note: terminal event subscriptions (created/status/exit/focus) are owned by
// App via useTerminalLifecycle — mounting them here dropped main-side launches
// whenever this area was unmounted (empty pane tree).
import { useTurnChangesStore } from '@/stores/turn-changes'
import { useThemeStore } from '@/stores/theme'
import { ThemedTooltip } from '@/components/ui/ThemedTooltip'
import { SlidingSelection } from '@/components/shared/SlidingSelection'
import { TerminalStatusLight } from '@/components/ui/TerminalStatusLight'
import { TerminalPresetIcon } from '@/components/ui/TerminalPresetIcon'
import styles from './TerminalArea.module.css'
import {
  buildWorkspaceTerminalSurfaces,
  GLOBAL_PANE_SCOPE,
  HOT_WORKSPACE_EVICTION_GRACE_MS,
  MAX_HOT_WORKSPACE_SURFACES,
  touchWorkspaceSurfaceRecency,
} from '@/lib/workspace-front-surface'

/** 新建终端菜单项：CLI 预设卡片 + 用户自建 shell 条目（默认项带标记）。 */
interface TerminalPresetOption {
  key: string
  type: TerminalPreset
  name: string
  /** shell 条目的完整启动行，菜单行放不下，走 tooltip。 */
  command?: string
  shellProfileId?: string
  isDefaultShell?: boolean
}

function createPreset(type: TerminalPreset): TerminalPresetOption {
  return { key: type, type, name: getTerminalPresetMeta(type).label }
}

/**
 * 菜单内容按「已配置 + 显示」过滤：shell 条目在前（默认项带标记），其后是可见的
 * CLI 预设卡片。隐藏只影响这里，已有终端与会话照常运行。
 */
function buildTerminalMenuItems(settings: ShellProfilesSettings): TerminalPresetOption[] {
  const shellEntries: TerminalPresetOption[] = listVisibleShellEntries(settings).map((entry) => ({
    key: `shell:${entry.id}`,
    type: 'shell' as TerminalPreset,
    name: entry.name,
    command: describeShellEntry(entry),
    shellProfileId: entry.id,
    isDefaultShell: entry.isDefault,
  }))
  const cliPresets = listVisibleCliPresets(
    settings,
    ['janus', 'claude', 'codex', 'opencode', 'pi', 'dsh'],
  ).map(createPreset)
  return [...shellEntries, ...cliPresets]
}

// 收起态 24×24 圆角 4,与工具栏相邻 h-6 w-6 rounded 按钮对齐
const TERMINAL_MENU_COLLAPSED_SIZE = 24
// 展开态为 portal 浮层（2 列 x 3 行，与空态 TerminalSelector 同取 6 的约数），
// 不占 tab 条宽度；窄 pane / 窄窗口下靠 getContextPopoverPosition 钳制在视口内。
// 不再用“展开宽度写死 = f(类型数量)”的内联胶囊——类型从 4 加到 6 时旧 166px
// 会把后两个图标裁掉，加第 7 个又得重算。
const TERMINAL_MENU_PANEL_WIDTH = 240
// 分组后（Shell 整行 + CLI 两列网格 + 两个分区标题）面板比早期纯网格高，
// 预估值只用于挂载首帧的视口钳制，量到真实尺寸后由 useLayoutEffect 纠正。
const TERMINAL_MENU_PANEL_ESTIMATED_HEIGHT = 240
// 收回动画时长：关闭时先播 terminal-menu-out 再卸载，与弹入 140ms 对称
const TERMINAL_MENU_EXIT_MS = 120

/*-- pane tab 条上的浏览器标签：标题跟随 surface 活动 tab --*/
function BrowserPaneTabLabel({ surfaceId, isActive }: { surfaceId: string; isActive: boolean }) {
  const surface = useBrowserStore((s) => s.surfaces[surfaceId])
  const activeTab = surface?.tabs.find((tab) => tab.tabId === surface.activeTabId) ?? null
  return (
    <>
      <Globe size={13} aria-hidden="true" style={{ opacity: isActive ? 0.95 : 0.55, flexShrink: 0 }} />
      <span className="min-w-0 flex-1 truncate" style={{ color: isActive ? 'var(--shell-text)' : 'inherit' }}>
        {activeTab?.title || activeTab?.url || 'Browser'}
      </span>
    </>
  )
}

interface PaneTreeViewProps {
  toolsRegion?: boolean
  node: WorkspacePaneNode | null
  workspaceVisible: boolean
  terminalsById: Map<string, Terminal>
  focusedPaneId: string | null
  activeTerminalId: string | null
  showFocusChrome: boolean
  onCollapseLayout: () => void
  onPaneFocus: (paneId: string) => void
  onTabSelect: (paneId: string, tabId: string) => void
  onKillTerminalFromTab: (terminalId: string, e?: React.MouseEvent) => void
  onCloseBrowserTab: (paneId: string, tabId: string, surfaceId: string) => void
  onCloseMarkdownTab: (paneId: string, tabId: string) => void
  onBrowserPopOut: (paneId: string, tabId: string, surfaceId: string) => void
  onBrowserTabDrop: (surfaceId: string, paneId: string, edge: PaneDropEdge | null, ratio: number) => void
  onKillTerminal: (terminalId: string, event?: React.MouseEvent) => void
  onTerminalDrop: (terminalId: string, paneId: string, edge: PaneDropEdge | null, ratio: number) => void
  onReorderTab: (paneId: string, tabId: string, targetIndex: number) => void
  onMoveTabToIndex: (contentId: string, paneId: string, targetIndex: number) => void
  onFluidCandidate: (contentId: string, paneId: string, event: React.PointerEvent) => void
  onResize: (splitId: string, ratio: number) => void
  terminalMenuPaneId: string | null
  onToggleTerminalMenu: (paneId: string) => void
  onCloseTerminalMenu: () => void
  onCreateTerminal: (preset: TerminalPresetOption) => void
  /** 新建终端菜单内容（shell 条目 + 可见 CLI 预设），由顶层按设置算出。 */
  terminalMenuItems: TerminalPresetOption[]
}

// Stable tab props let a selection update render only the old and new labels.
const PaneTab = memo(function PaneTab({ tab, terminal, isActive, paneId, tabNodeRefs,
  onFluidCandidate, onTabSelect, onKillTerminalFromTab, onCloseBrowserTab, onCloseMarkdownTab,
}: Pick<PaneTreeViewProps, 'onFluidCandidate' | 'onTabSelect' | 'onKillTerminalFromTab' | 'onCloseBrowserTab' | 'onCloseMarkdownTab'> & {
  tab: WorkspacePaneLeaf['tabs'][number]
  terminal: Terminal | undefined
  isActive: boolean
  paneId: string
  tabNodeRefs: React.MutableRefObject<Map<string, HTMLDivElement>>
}) {
  const { t } = useI18n('terminal')
  useExtensionViews()
  const tabVisual = terminal ? getTerminalStatusVisual(terminal.status) : undefined
  const tabStatusLabel = tabVisual ? t(tabVisual.labelKey) : undefined
  return (
    <ThemedTooltip
      label={
        terminal && tabStatusLabel
          ? `${providerLabel(terminal.preset, t)} · ${tabStatusLabel} · ${terminal.cwd}`
          : tab.type === 'browser'
            ? 'Browser'
            : tab.type === 'markdown'
              ? t('terminal:tab.view.note')
              : tab.type === 'extension'
                ? extensionRegistry.getView(tab.viewId)?.title ?? tab.viewId
                : tab.terminalId
      }
    >
    <div
      role="button"
      tabIndex={0}
      draggable={false}
      data-tab-id={tab.id}
      ref={(node) => {
        if (node) tabNodeRefs.current.set(tab.id, node)
        else tabNodeRefs.current.delete(tab.id)
      }}
      onPointerDown={(event) => onFluidCandidate(tab.id, paneId, event)}
      onClick={() => onTabSelect(paneId, tab.id)}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        onTabSelect(paneId, tab.id)
      }}
      className={`${styles.tab} group/tab font-mono`}
      data-active={isActive ? 'true' : 'false'}
      aria-pressed={isActive}
    >
      {/*-- tab 左侧状态灯：与左侧工作区同一盏灯（TerminalStatusLight 紧凑环），
           色/形/动效三编码；8px 环比原来 6px 点宽 2px，仍在 144px 预算余量内。 --*/}
      {terminal && (
        <TerminalStatusLight status={terminal.status} compact />
      )}
      {terminal && (
        <TerminalPresetIcon
          preset={terminal.preset}
          className="h-3.5 w-3.5 shrink-0"
          style={{ opacity: isActive ? 0.95 : 0.55 }}
        />
      )}
      {tab.type === 'browser' ? (
        <BrowserPaneTabLabel surfaceId={tab.surfaceId} isActive={isActive} />
      ) : tab.type === 'markdown' ? (
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          <MarkdownIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate" style={{ color: isActive ? 'var(--shell-text)' : 'inherit' }}>
            {t('terminal:tab.view.note')}
          </span>
        </span>
      ) : tab.type === 'extension' ? (
        <span className="min-w-0 flex-1 truncate">
          {extensionRegistry.getView(tab.viewId)?.title ?? tab.viewId}
        </span>
      ) : (
        <span className="min-w-0 flex-1 truncate" style={{ color: isActive ? 'var(--shell-text)' : 'inherit' }}>
          {terminal?.name ?? (tab.type === 'terminal' ? tab.terminalId.slice(0, 8) : '')}
        </span>
      )}
      {/* Note: .agents/notes/workbench/service-integrations.md — all workspace views share hold-to-close. */}
      <HoldToConfirm
        as="span"
        data-tab-close="true"
        label={tab.type === 'terminal' ? t('terminal:tab.closeTerminal')
          : tab.type === 'browser' ? t('terminal:tab.closeBrowser')
            : tab.type === 'markdown' ? t('terminal:tab.closeMarkdown') : t('common:action.close')}
        className="ml-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-[4px] text-[13px] leading-none opacity-0 transition-[opacity,color,background] group-hover/tab:opacity-45 hover:!opacity-100 focus:opacity-100 hover:bg-[color-mix(in_srgb,var(--shell-text)_12%,transparent)]"
        style={{ color: tab.type === 'terminal' ? 'var(--shell-diff-del)' : 'var(--shell-muted)' }}
        onConfirm={() => {
          if (tab.type === 'terminal') onKillTerminalFromTab(tab.terminalId)
          else if (tab.type === 'browser') onCloseBrowserTab(paneId, tab.id, tab.surfaceId)
          // Closing a document or extension only closes its presentation.
          else onCloseMarkdownTab(paneId, tab.id)
        }}
      >
        <X size={12} strokeWidth={1.8} />
      </HoldToConfirm>
    </div>
    </ThemedTooltip>
  )
})

function PaneTreeView(props: PaneTreeViewProps) {
  const { t } = useI18n('terminal')
  if (!props.node) {
    return (
      <div className="flex h-full items-center justify-center text-sm font-mono text-[var(--shell-dim)]">
        {t('terminal:paneTree.waitingTerminal')}
      </div>
    )
  }

  if (props.node.type === 'split') {
    return <SplitPaneNode split={props.node} {...props} />
  }

  return <LeafPane leaf={props.node} {...props} />
}

function SplitPaneNode({ split, onResize, ...props }: PaneTreeViewProps & { split: WorkspacePaneSplit }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [resizing, setResizing] = useState(false)
  const isHorizontal = split.direction === 'horizontal'

  const resizeFromPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const container = containerRef.current
    if (!container || !event.currentTarget.hasPointerCapture(event.pointerId)) return
    const rect = container.getBoundingClientRect()
    const dividerSize = isHorizontal ? event.currentTarget.offsetWidth : event.currentTarget.offsetHeight
    onResize(split.id, isHorizontal
      ? (event.clientX - rect.left - dividerSize / 2) / (rect.width - dividerSize)
      : (event.clientY - rect.top - dividerSize / 2) / (rect.height - dividerSize))
  }

  const endResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    setResizing(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  return (
    <div
      ref={containerRef}
      className={`flex h-full w-full min-h-0 min-w-0 ${isHorizontal ? 'flex-row' : 'flex-col'}`}
    >
      <div className="min-h-0 min-w-0" style={{ flexBasis: `calc((100% - var(--pane-divider-size)) * ${split.ratio})`, flexGrow: 0, flexShrink: 0 }}>
        <PaneTreeView {...props} node={split.first} onResize={onResize} />
      </div>
      <div className={styles.divider} data-direction={split.direction}>
        <div
          role="separator"
          aria-orientation={isHorizontal ? 'vertical' : 'horizontal'}
          aria-valuemin={15}
          aria-valuemax={85}
          aria-valuenow={Math.round(split.ratio * 100)}
          tabIndex={0}
          className={styles.resize}
          data-resizing={resizing}
          onPointerDown={(event) => {
            if (event.button !== 0) return
            event.preventDefault()
            event.stopPropagation()
            event.currentTarget.focus()
            event.currentTarget.setPointerCapture(event.pointerId)
            setResizing(true)
          }}
          onPointerMove={resizeFromPointer}
          onPointerUp={endResize}
          onPointerCancel={endResize}
          onLostPointerCapture={() => setResizing(false)}
          onDoubleClick={() => onResize(split.id, 0.5)}
          onKeyDown={(event) => {
            const decrease = isHorizontal ? 'ArrowLeft' : 'ArrowUp'
            const increase = isHorizontal ? 'ArrowRight' : 'ArrowDown'
            if (![decrease, increase, 'Home', 'End'].includes(event.key)) return
            event.preventDefault()
            event.stopPropagation()
            onResize(split.id, event.key === 'Home' ? 0.15 : event.key === 'End' ? 0.85
              : split.ratio + (event.key === decrease ? -0.05 : 0.05))
          }}
        />
      </div>
      <div className="min-h-0 min-w-0 flex-1">
        <PaneTreeView {...props} node={split.second} onResize={onResize} />
      </div>
    </div>
  )
}

function TerminalPresetCapsule({
  open,
  onToggle,
  onSelect,
  onClose,
  items,
}: {
  open: boolean
  onToggle: (event: React.MouseEvent<HTMLButtonElement>) => void
  onSelect: (preset: TerminalPresetOption) => void
  onClose: () => void
  items: TerminalPresetOption[]
}) {
  const toggleRef = useRef<HTMLDivElement | null>(null)
  useExtensionCommands()
  const workspaceId = useWorkspaceStore((state) => state.activeWorkspaceId)
  const workspaceEntries = extensionCommands.getMenus('workspace-add', Boolean(workspaceId))
  const panelRef = useRef<HTMLDivElement | null>(null)
  const exitTimerRef = useRef<number | null>(null)
  const wasOpenRef = useRef(open)
  // Shell 与 CLI 分两组：前者是"可切换的 shell 清单"，后者是终端类型卡片
  const shellItems = items.filter((item) => item.type === 'shell')
  const cliItems = items.filter((item) => item.type !== 'shell')
  // Shell 区默认折叠：头部即默认 shell，展开后才铺开全部
  const defaultShell = shellItems.find((item) => item.isDefaultShell) ?? shellItems[0]
  const [shellOpen, setShellOpen] = useState(false)
  const [anchorRect, setAnchorRect] = useState<PopoverAnchorRect | null>(null)
  const [panelSize, setPanelSize] = useState<PopoverSize>({
    width: TERMINAL_MENU_PANEL_WIDTH,
    height: TERMINAL_MENU_PANEL_ESTIMATED_HEIGHT,
  })
  // renderPanel 滞后于 open：关闭时先播收回动画再卸载；exiting 期间仍按旧锚点定位
  const [renderPanel, setRenderPanel] = useState(false)
  const [exiting, setExiting] = useState(false)
  // 浮层 portal 到 body 后与原生网页（CPA / 浏览器）的视图矩形相交时会被盖住——
  // WebContentsView 永远在 DOM 之上。按既有对话框/工具箱同一套让位规则持租约，
  // 覆盖整个 renderPanel 生命周期（含收回动画），原生视图让位后菜单可点。
  useBrowserOcclusion(renderPanel)
  // planche 下预设菜单走纸面 + 朱红，悬浮不再是深棕黑底
  const plancheMenu = useThemeStore((s) => s.theme) === 'planche'
  const { t } = useI18n('terminal')

  useEffect(() => {
    if (open) {
      wasOpenRef.current = true
      if (exitTimerRef.current !== null) {
        window.clearTimeout(exitTimerRef.current)
        exitTimerRef.current = null
      }
      setExiting(false)
      setRenderPanel(true)
      // 打开时记录触发按钮位置；浮层 portal 到 body 后按它定位，不受 tab 条 overflow 裁剪
      const rect = toggleRef.current?.getBoundingClientRect()
      if (rect) {
        const next = { top: rect.top, bottom: rect.bottom, left: rect.left, width: rect.width }
        setAnchorRect((current) =>
          current &&
          current.top === next.top &&
          current.bottom === next.bottom &&
          current.left === next.left &&
          current.width === next.width
            ? current
            : next,
        )
      }
      return
    }
    // 从未打开过则无需收回动画
    if (!wasOpenRef.current) return
    wasOpenRef.current = false
    setExiting(true)
    exitTimerRef.current = window.setTimeout(() => {
      exitTimerRef.current = null
      setRenderPanel(false)
      setExiting(false)
    }, TERMINAL_MENU_EXIT_MS)
    return () => {
      if (exitTimerRef.current !== null) {
        window.clearTimeout(exitTimerRef.current)
        exitTimerRef.current = null
      }
    }
  }, [open])

  useEffect(() => {
    return () => {
      if (exitTimerRef.current !== null) {
        window.clearTimeout(exitTimerRef.current)
        exitTimerRef.current = null
      }
    }
  }, [])

  useLayoutEffect(() => {
    if (!renderPanel || !panelRef.current) return
    const rect = panelRef.current.getBoundingClientRect()
    if (rect.width !== panelSize.width || rect.height !== panelSize.height) {
      setPanelSize({ width: rect.width, height: rect.height })
    }
  }, [renderPanel, panelSize.height, panelSize.width])

  // 瞬态菜单：窗口缩放/滚动直接关闭（下次打开重新定位），Escape 关闭
  useEffect(() => {
    if (!open) return
    const handleViewportChange = () => onClose()
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('resize', handleViewportChange)
    window.addEventListener('scroll', handleViewportChange, true)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('resize', handleViewportChange)
      window.removeEventListener('scroll', handleViewportChange, true)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose, open])

  const position =
    renderPanel && anchorRect
      ? getContextPopoverPosition(anchorRect, panelSize, {
          width: window.innerWidth,
          height: window.innerHeight,
        })
      : null

  return (
    <div
      ref={toggleRef}
      data-terminal-menu-root="true"
      className="flex shrink-0 items-center font-mono"
      onMouseDown={(event) => event.stopPropagation()}
    >
      <ThemedTooltip label={open ? 'Close terminal menu' : 'New Terminal'}>
      <button
        type="button"
        data-onboarding="new-terminal"
        aria-label={open ? 'Close terminal menu' : 'New Terminal'}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={onToggle}
        className={styles.action}
        style={{
          width: TERMINAL_MENU_COLLAPSED_SIZE,
          height: TERMINAL_MENU_COLLAPSED_SIZE,
        }}
      >
        {/* 用两条细条绘制 +,文本字形在行框内偏上,旋转 45° 后偏差会沿对角放大 */}
        <span
          aria-hidden="true"
          className="relative block h-[9px] w-[9px] transition-transform duration-200 ease-out"
          style={{ transform: open ? 'rotate(45deg)' : 'rotate(0deg)' }}
        >
          <span className="absolute left-0 top-[4px] h-px w-full bg-current" />
          <span className="absolute left-[4px] top-0 h-full w-px bg-current" />
        </span>
      </button>
      </ThemedTooltip>
      {/* 外壳浮层都在菜单默认层级之上（toast 栈 10000 / Titlebar 9999 /
          TeamSetupGate 2000 / 侧栏弹窗 1200），菜单落点又在右上角，正好会被盖住；
          提到所有外壳浮层之上。 */}
      {renderPanel &&
        position &&
        createPortal(
          <div
            ref={panelRef}
            data-terminal-menu-root="true"
            role="menu"
            aria-label="New terminal"
            className="fixed z-[11000] rounded-[10px] border font-mono"
            onMouseDown={(event) => event.stopPropagation()}
            style={{
              top: position.top,
              left: position.left,
              width: TERMINAL_MENU_PANEL_WIDTH,
              maxWidth: 'calc(100vw - 16px)',
              padding: 6,
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
              borderColor: 'var(--control-border)',
              background: 'var(--popover-background)',
              boxShadow: 'var(--popover-shadow)',
              transformOrigin: position.placement === 'above' ? 'bottom right' : 'top right',
              animation: exiting
                ? `terminal-menu-out ${TERMINAL_MENU_EXIT_MS}ms ease-in forwards`
                : 'terminal-menu-in 140ms ease-out',
            }}
          >
            {/* Shell 区默认折叠：头部一行就是默认 shell（点了直接开终端），
                箭头展开后才铺开全部已配置 shell —— 与空白页 Shell 卡片同一套交互 */}
            {shellItems.length > 0 && (
              <>
                <div className="terminal-menu-section" role="presentation">
                  {t('terminal:shellMenu.shell')}
                </div>
                <div className="terminal-menu-shell-head">
                  <ThemedTooltip
                    label={
                      defaultShell?.command
                        ? `${defaultShell.name} · ${defaultShell.command}`
                        : (defaultShell?.name ?? '')
                    }
                  >
                  <button
                    type="button"
                    role="menuitem"
                    aria-label={`New ${defaultShell?.name ?? 'shell'} terminal`}
                    className={`terminal-preset-item terminal-preset-item-wide flex min-w-0 items-center gap-2 rounded-md border px-2 py-[7px] text-left text-[12px] leading-none transition-[background,border-color] focus:outline-none focus-visible:ring-1 ${plancheMenu ? 'focus-visible:ring-[rgba(212,61,42,0.5)]' : 'focus-visible:ring-[rgba(255,120,48,0.35)]'}`}
                    style={{
                      borderColor: 'transparent',
                      background: 'transparent',
                      color: plancheMenu ? '#1C343B' : '#d4d4d4',
                    }}
                    onClick={(event) => {
                      event.stopPropagation()
                      if (defaultShell) onSelect(defaultShell)
                    }}
                  >
                    <TerminalPresetIcon preset="shell" className="h-4 w-4 shrink-0" />
                    <span className="min-w-0 flex-1 truncate">
                      {defaultShell?.name ?? t('terminal:provider.shell')}
                    </span>
                    {defaultShell?.isDefaultShell && (
                      <span
                        aria-hidden="true"
                        className="shrink-0 rounded-[3px] px-1 text-[9px] leading-[14px]"
                        style={{
                          background: plancheMenu ? 'rgba(212,61,42,0.14)' : 'rgba(255,120,48,0.16)',
                          color: plancheMenu ? '#D43D2A' : '#ffb27d',
                        }}
                      >
                        {t('terminal:shellMenu.default')}
                      </span>
                    )}
                  </button>
                  </ThemedTooltip>
                  {/* 只有一条 shell 时没有可铺开的内容，箭头不出现 */}
                  {shellItems.length > 1 && (
                    <ThemedTooltip label={t('terminal:shellMenu.pickShell')}>
                    <button
                      type="button"
                      className={`terminal-preset-item terminal-menu-shell-toggle flex items-center justify-center rounded-md border transition-[background,border-color] focus:outline-none focus-visible:ring-1 ${plancheMenu ? 'focus-visible:ring-[rgba(212,61,42,0.5)]' : 'focus-visible:ring-[rgba(255,120,48,0.35)]'}`}
                      style={{
                        borderColor: 'transparent',
                        background: 'transparent',
                        color: plancheMenu ? '#1C343B' : '#d4d4d4',
                      }}
                      aria-expanded={shellOpen}
                      aria-label={t('terminal:shellMenu.pickShell')}
                      onClick={(event) => {
                        event.stopPropagation()
                        setShellOpen((open) => !open)
                      }}
                    >
                      <ChevronDown
                        size={13}
                        strokeWidth={2}
                        aria-hidden="true"
                        style={{
                          transition: 'transform 160ms ease',
                          transform: shellOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                        }}
                      />
                    </button>
                    </ThemedTooltip>
                  )}
                </div>

                {shellOpen && (
                  <div className="flex flex-col gap-1">
                    {shellItems.map((item) => (
                      <ThemedTooltip key={item.key} label={item.command ? `${item.name} · ${item.command}` : item.name}>
                      <button
                        type="button"
                        role="menuitem"
                        aria-label={`New ${item.name} terminal`}
                        className={`terminal-preset-item terminal-preset-item-wide terminal-preset-item-nested flex min-w-0 items-center gap-2 rounded-md border px-2 py-[7px] text-left text-[12px] leading-none transition-[background,border-color] focus:outline-none focus-visible:ring-1 ${plancheMenu ? 'focus-visible:ring-[rgba(212,61,42,0.5)]' : 'focus-visible:ring-[rgba(255,120,48,0.35)]'}`}
                        style={{
                          borderColor: 'transparent',
                          background: 'transparent',
                          color: plancheMenu ? '#1C343B' : '#d4d4d4',
                        }}
                        onClick={(event) => {
                          event.stopPropagation()
                          onSelect(item)
                        }}
                      >
                        <TerminalPresetIcon preset={item.type} className="h-4 w-4 shrink-0" />
                        <span className="min-w-0 flex-1 truncate">{item.name}</span>
                        {item.isDefaultShell && (
                          <span
                            aria-hidden="true"
                            className="shrink-0 rounded-[3px] px-1 text-[9px] leading-[14px]"
                            style={{
                              background: plancheMenu ? 'rgba(212,61,42,0.14)' : 'rgba(255,120,48,0.16)',
                              color: plancheMenu ? '#D43D2A' : '#ffb27d',
                            }}
                          >
                            {t('terminal:shellMenu.default')}
                          </span>
                        )}
                      </button>
                      </ThemedTooltip>
                    ))}
                  </div>
                )}
              </>
            )}

            {cliItems.length > 0 && (
              <>
                <div className="terminal-menu-section" role="presentation">
                  {t('terminal:shellMenu.cli')}
                </div>
                <div
                  className="grid"
                  style={{
                    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                    gap: 4,
                  }}
                >
                  {cliItems.map((item) => (
                    <ThemedTooltip key={item.key} label={item.command ? `${item.name} · ${item.command}` : item.name}>
                    <button
                      type="button"
                      role="menuitem"
                      aria-label={`New ${item.name} terminal`}
                      className={`terminal-preset-item flex min-w-0 items-center gap-2 rounded-md border px-2 py-[7px] text-left text-[12px] leading-none transition-[background,border-color] focus:outline-none focus-visible:ring-1 ${plancheMenu ? 'focus-visible:ring-[rgba(212,61,42,0.5)]' : 'focus-visible:ring-[rgba(255,120,48,0.35)]'}`}
                      style={{
                        borderColor: 'transparent',
                        background: 'transparent',
                        color: plancheMenu ? '#1C343B' : '#d4d4d4',
                      }}
                      onClick={(event) => {
                        event.stopPropagation()
                        onSelect(item)
                      }}
                    >
                      <TerminalPresetIcon preset={item.type} className="h-4 w-4 shrink-0" />
                      <span className="min-w-0 flex-1 truncate">{item.name}</span>
                    </button>
                    </ThemedTooltip>
                  ))}
                </div>
              </>
            )}
            {workspaceEntries.map((entry) => {
              const view = entry.view
              const Icon = view.icon ?? Puzzle
              return (
                <button key={entry.id} type="button" role="menuitem"
                  disabled={!extensionCommands.canExecute(entry.commandId, Boolean(workspaceId))}
                  className="terminal-preset-item flex items-center gap-2 rounded-md px-2 py-[7px] text-left text-xs"
                  style={{ color: 'var(--shell-text)' }}
                  onClick={() => { extensionCommands.execute(entry.commandId, Boolean(workspaceId), openExtensionView); onClose() }}>
                  <Icon size={16} aria-hidden="true" /><span className="truncate">{extensionCommands.getSnapshot().commands.find((command) => command.id === entry.commandId)?.title ?? view.title}</span>
                </button>
              )
            })}
          </div>,
          document.body,
        )}
    </div>
  )
}

function LeafPane({
  toolsRegion = false,
  leaf,
  workspaceVisible,
  terminalsById,
  focusedPaneId,
  showFocusChrome,
  onCollapseLayout,
  onPaneFocus,
  onTabSelect,
  onKillTerminalFromTab,
  onCloseBrowserTab,
  onCloseMarkdownTab,
  onBrowserPopOut,
  onBrowserTabDrop,
  onKillTerminal,
  onTerminalDrop,
  onReorderTab,
  onMoveTabToIndex,
  onFluidCandidate,
  terminalMenuPaneId,
  onToggleTerminalMenu,
  onCloseTerminalMenu,
  onCreateTerminal,
  terminalMenuItems,
}: PaneTreeViewProps & { leaf: WorkspacePaneLeaf }) {
  const { t } = useI18n('terminal')
  useExtensionViews()
  const plancheEmpty = useThemeStore((s) => s.theme) === 'planche'
  const [dragHint, setDragHint] = useState<{ zone: PaneDropHint; ratio: number } | null>(null)
  /*-- tab 条排序占位：插入位是摘除拖拽 tab 后的数组下标，与 reorderPaneTab 语义一致 --*/
  const [tabInsertIndex, setTabInsertIndex] = useState<number | null>(null)
  const tabNodeRefs = useRef(new Map<string, HTMLDivElement>())
  const tabStripRef = useRef<HTMLDivElement>(null)
  const tabDragInFlight = useWorkspaceStore((state) => state.tabDragInFlight)
  const isFocused = leaf.id === focusedPaneId
  const activeTabId = leaf.activeTabId ?? leaf.tabs[0]?.id ?? null
  const activeTab = activeTabId ? leaf.tabs.find((tab) => tab.id === activeTabId) ?? null : null
  const activeTerminal = activeTab?.type === 'terminal' ? terminalsById.get(activeTab.terminalId) ?? null : null
  const terminalMenuOpen = terminalMenuPaneId === leaf.id

  const openMenu = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault()
      event.stopPropagation()
      onToggleTerminalMenu(leaf.id)
    },
    [leaf.id, onToggleTerminalMenu]
  )

  /*-- 原生拖拽（仅侧栏终端拖入）解析被拖 tab 的内容 id；tab 条内排序走指针会话 --*/
  const resolveStripDraggedTabId = useCallback((event: React.DragEvent) => {
    const dragTerminalId =
      readTerminalDragData(event.dataTransfer) || getActiveTerminalDragId()
    if (dragTerminalId) return `terminal:${dragTerminalId}`
    const dragBrowserSurfaceId =
      readBrowserTabDragData(event.dataTransfer) || getActiveBrowserTabDragId()
    if (dragBrowserSurfaceId) return `browser:${dragBrowserSurfaceId}`
    return null
  }, [])

  const acceptsNativeDrag = useCallback((event: React.DragEvent) => {
    const id = resolveStripDraggedTabId(event)
    const global = !!id && getLeafPanes(useGlobalToolsStore.getState().paneTree).some((pane) => pane.tabs.some((tab) => tab.id === id))
    return toolsRegion ? global : !global
  }, [resolveStripDraggedTabId, toolsRegion])

  const nativeTerminalId = getActiveTerminalDragId()
  const nativeBrowserId = getActiveBrowserTabDragId()
  const stripDraggedTabId = nativeTerminalId ? `terminal:${nativeTerminalId}` : nativeBrowserId ? `browser:${nativeBrowserId}` : null
  const stripDraggedIsLocal = leaf.tabs.some((tab) => tab.id === stripDraggedTabId)

  useEffect(() => {
    const clear = () => { setTabInsertIndex(null); setDragHint(null) }
    window.addEventListener('dragend', clear)
    window.addEventListener('drop', clear)
    window.addEventListener('blur', clear)
    return () => {
      window.removeEventListener('dragend', clear)
      window.removeEventListener('drop', clear)
      window.removeEventListener('blur', clear)
    }
  }, [])

  /*-- 标签条滚动条隐藏，竖向滚轮换轴横向滚、选中 tab 自动入视口（与文件窗口 filetab 同规） --*/
  useEffect(() => {
    const strip = tabStripRef.current
    return strip ? attachWheelScrollX(strip) : undefined
  }, [])
  useEffect(() => {
    const strip = tabStripRef.current
    if (strip) revealStripItem(strip, 'data-tab-id', activeTabId)
  }, [activeTabId, leaf.tabs])

  /*-- 按指针 X 落在哪个 tab 中线左侧决定插入位；被拖 tab 先摘除再算 --*/
  const computeTabInsertIndex = useCallback((clientX: number, draggedId: string | null) => {
    const rects: { left: number; width: number }[] = []
    for (const tab of leaf.tabs) {
      if (tab.id === draggedId) continue
      const node = tabNodeRefs.current.get(tab.id)
      if (!node) continue
      const rect = node.getBoundingClientRect()
      rects.push({ left: rect.left, width: rect.width })
    }
    return midpointInsertIndex(rects, clientX)
  }, [leaf.tabs])

  const handleTabStripDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (hasWorkspaceFileDrag(event.dataTransfer)) return
    if (!acceptsNativeDrag(event)) return
    const draggedId = resolveStripDraggedTabId(event)
    if (!draggedId && !hasTerminalDrag(event.dataTransfer) && !hasBrowserTabDrag(event.dataTransfer)) return
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'move'
    setDragHint(null)
    const index = computeTabInsertIndex(event.clientX, draggedId)
    setTabInsertIndex((current) => (current === index ? current : index))
  }, [computeTabInsertIndex, resolveStripDraggedTabId, acceptsNativeDrag])

  const handleTabStripDragLeave = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
    setTabInsertIndex(null)
  }, [])

  const handleTabStripDrop = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (hasWorkspaceFileDrag(event.dataTransfer)) return
    if (!acceptsNativeDrag(event)) return
    const draggedId = resolveStripDraggedTabId(event)
    if (!draggedId && !hasTerminalDrag(event.dataTransfer) && !hasBrowserTabDrag(event.dataTransfer)) return
    event.preventDefault()
    event.stopPropagation()
    const index = computeTabInsertIndex(event.clientX, draggedId)
    setTabInsertIndex(null)
    setDragHint(null)
    if (!draggedId) return
    if (leaf.tabs.some((tab) => tab.id === draggedId)) {
      onReorderTab(leaf.id, draggedId, index)
      return
    }
    onMoveTabToIndex(draggedId, leaf.id, index)
  }, [computeTabInsertIndex, leaf.id, leaf.tabs, onMoveTabToIndex, onReorderTab, resolveStripDraggedTabId, acceptsNativeDrag])

  const handleDragOver = useCallback((event: React.DragEvent<HTMLElement>) => {
    if (hasWorkspaceFileDrag(event.dataTransfer)) return
    if (!acceptsNativeDrag(event)) return

    const dragTerminalId =
      readTerminalDragData(event.dataTransfer) || getActiveTerminalDragId()
    const dragBrowserSurfaceId =
      readBrowserTabDragData(event.dataTransfer) || getActiveBrowserTabDragId()
    if (!hasTerminalDrag(event.dataTransfer) && !dragTerminalId && !hasBrowserTabDrag(event.dataTransfer) && !dragBrowserSurfaceId) return
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'move'
    const zone = getPaneDropHint(event.currentTarget, event.clientX, event.clientY)
    /*-- 预览比例 = 松手后实际应用的比例（预览即结果）：落点分屏固定平分 --*/
    const ratio = SPLIT_RATIO_EQUAL
    setDragHint((current) => (current && current.zone === zone && current.ratio === ratio ? current : { zone, ratio }))
  }, [acceptsNativeDrag])

  const handleDragLeave = useCallback((event: React.DragEvent<HTMLElement>) => {
    if (hasWorkspaceFileDrag(event.dataTransfer)) return

    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setDragHint(null)
    }
  }, [])

  const handleDrop = useCallback((event: React.DragEvent<HTMLElement>) => {
    if (hasWorkspaceFileDrag(event.dataTransfer)) return
    if (!acceptsNativeDrag(event)) return

    const dragTerminalId =
      readTerminalDragData(event.dataTransfer) || getActiveTerminalDragId()
    const dragBrowserSurfaceId =
      readBrowserTabDragData(event.dataTransfer) || getActiveBrowserTabDragId()
    if (!hasTerminalDrag(event.dataTransfer) && !dragTerminalId && !hasBrowserTabDrag(event.dataTransfer) && !dragBrowserSurfaceId) return
    event.preventDefault()
    event.stopPropagation()
    const hint = getPaneDropHint(event.currentTarget, event.clientX, event.clientY)
    /*-- center = 合并到本 pane（move 语义）；边缘 = 平分分屏（与预览一致） --*/
    const edge: PaneDropEdge | null = hint === 'center' ? null : hint
    const ratio = SPLIT_RATIO_EQUAL
    setDragHint(null)
    if (dragBrowserSurfaceId && !dragTerminalId) {
      onBrowserTabDrop(dragBrowserSurfaceId, leaf.id, edge, ratio)
      return
    }
    const terminalId = dragTerminalId
    if (!terminalId) return
    onTerminalDrop(terminalId, leaf.id, edge, ratio)
  }, [leaf.id, onTerminalDrop, onBrowserTabDrop, acceptsNativeDrag])

  const renderPaneTab = (tab: WorkspacePaneLeaf['tabs'][number]) => (
    <PaneTab key={tab.id} tab={tab}
      terminal={tab.type === 'terminal' ? terminalsById.get(tab.terminalId) : undefined}
      isActive={tab.id === activeTabId} paneId={leaf.id} tabNodeRefs={tabNodeRefs}
      onFluidCandidate={onFluidCandidate} onTabSelect={onTabSelect}
      onKillTerminalFromTab={onKillTerminalFromTab} onCloseBrowserTab={onCloseBrowserTab}
      onCloseMarkdownTab={onCloseMarkdownTab} />
  )

  return (
      <section
      data-pane-id={leaf.id}
      className={styles.pane}
      data-focused={isFocused}
      data-split={showFocusChrome}
      onPointerDownCapture={() => { if (!isFocused) onPaneFocus(leaf.id) }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {dragHint && (
        <div
          className={`${styles.dropHint} pointer-events-none absolute z-20`}
          style={{
            /*-- 预览区域 = 松手后新 pane 的真实占比（first/second 语义与 splitPaneTree 一致） --*/
            top: dragHint.zone === 'bottom' ? `${dragHint.ratio * 100}%` : 0,
            right: dragHint.zone === 'left' ? `${(1 - dragHint.ratio) * 100}%` : 0,
            bottom: dragHint.zone === 'top' ? `${(1 - dragHint.ratio) * 100}%` : 0,
            left: dragHint.zone === 'right' ? `${dragHint.ratio * 100}%` : 0,
            transition: 'top 70ms ease-out, right 70ms ease-out, bottom 70ms ease-out, left 70ms ease-out',
            animation: 'pane-drop-hint-in 110ms ease-out',
          }}
        >
          {/*-- 预览语义标签：让落点结果（分屏方向/合并）在松手前自解释 --*/}
          <span
            className={styles.dropLabel}
          >
            {paneDropHintLabel(dragHint.zone)}
          </span>
        </div>
      )}
      <div className={styles.header}>
        {/*-- 仅标签滚动，动作区保持为不可收缩的兄弟节点，窄 pane 与多 tab 不会把按钮滚出视口。 --*/}
        <div
          data-tab-strip={leaf.id}
          ref={tabStripRef}
          onDragOver={handleTabStripDragOver}
          onDragLeave={handleTabStripDragLeave}
          onDrop={handleTabStripDrop}
          className={styles.strip}
        >
          <SlidingSelection containerRef={tabStripRef} activeId={activeTabId} itemAttribute="data-tab-id"
            layoutKey={leaf.tabs.map((tab) => tab.id).join(',')} hidden={tabDragInFlight || tabInsertIndex !== null}
            className={styles.tabIndicator} testId="pane-tab-indicator" />
          {(() => {
            /*-- 排序占位：同 pane 拖拽先摘除源 tab，异 pane 全量保留；
                 占位与 tab 同宽（basis 144px），兄弟 tab 被 flex 自然挤开即让位。
                 占位与正式标签使用相同圆角和间隔。 --*/
            if (tabInsertIndex == null) {
              return leaf.tabs.map(renderPaneTab)
            }
            const ordered = stripDraggedIsLocal && stripDraggedTabId
              ? leaf.tabs.filter((tab) => tab.id !== stripDraggedTabId)
              : leaf.tabs
            const slots: ReactNode[] = []
            for (let slot = 0; slot <= ordered.length; slot += 1) {
              if (slot === tabInsertIndex) {
                slots.push(
                  <div
                    key={`tab-drop-placeholder-${leaf.id}`}
                    aria-hidden="true"
                    data-tab-placeholder="true"
                    className={styles.placeholder}
                    style={{
                      animation: 'pane-drop-hint-in 110ms ease-out',
                    }}
                  >
                    <span className="block h-[3px] w-10 rounded-full" style={{ background: 'var(--shell-accent)' }} />
                  </div>
                )
              }
              if (slot < ordered.length) {
                slots.push(renderPaneTab(ordered[slot]))
              }
            }
            return slots
          })()}
          <div data-tab-drag-spacer="" aria-hidden="true" style={{ width: 0, flexShrink: 0 }} />
          <div data-tab-drag-slot="" aria-hidden="true" className={styles.slot} />
        </div>
        <div className={styles.controls}>
          {toolsRegion && <ThemedTooltip label={t('common:toolGroup.collapseTools')}>
            <button type="button" className={styles.action} aria-expanded={true}
              aria-label={t('common:toolGroup.collapseTools')}
              onClick={() => useGlobalToolsStore.getState().setCollapsed(true)}>
              <PanelRightClose size={14} aria-hidden="true" />
            </button>
          </ThemedTooltip>}
          {showFocusChrome && (
            <HoldToConfirm label={t('terminal:tab.collapseLayout')} onConfirm={onCollapseLayout} className={styles.action}>
              <Minimize2 size={13} strokeWidth={1.6} aria-hidden="true" />
            </HoldToConfirm>
          )}
          {!toolsRegion && <TerminalPresetCapsule
            open={terminalMenuOpen}
            onToggle={openMenu}
            onSelect={onCreateTerminal}
            onClose={onCloseTerminalMenu}
            items={terminalMenuItems}
          />}
          {!toolsRegion && <HoldToConfirm
            label={t('terminal:tab.killCurrentTerminal')}
            disabled={!activeTerminal}
            className={`${styles.action} ${styles.danger} text-[14px] leading-none`}
            onConfirm={() => activeTerminal && onKillTerminal(activeTerminal.id)}
          >
            -
          </HoldToConfirm>}
        </div>
      </div>

      <div
        className="relative min-h-0 flex-1 overflow-hidden"
        style={{
          background: 'var(--shell-canvas)',
        }}
      >
        {leaf.tabs.map((tab) => {
          if (tab.type === 'browser') {
            const isActive = tab.id === activeTabId
            return (
              <div
                key={tab.id}
                className="absolute inset-0"
                style={{
                  visibility: isActive ? 'visible' : 'hidden',
                  pointerEvents: isActive ? 'auto' : 'none',
                  zIndex: isActive ? 1 : 0,
                }}
                aria-hidden={!isActive}
              >
                <BrowserSurface
                  surfaceId={tab.surfaceId}
                  carrier="pane"
                  visible={workspaceVisible && isActive}
                  onRequestPopOut={() => onBrowserPopOut(leaf.id, tab.id, tab.surfaceId)}
                />
              </div>
            )
          }

          if (tab.type === 'markdown') {
            const isActive = tab.id === activeTabId
            return (
              <div
                key={tab.id}
                className="absolute inset-0"
                style={{
                  visibility: isActive ? 'visible' : 'hidden',
                  pointerEvents: isActive ? 'auto' : 'none',
                  zIndex: isActive ? 1 : 0,
                }}
                aria-hidden={!isActive}
              >
                <MarkdownPane panelId={tab.panelId} />
              </div>
            )
          }

          if (tab.type === 'extension') {
            const isActive = tab.id === activeTabId
            const workspace = useWorkspaceStore.getState().workspaces.find((item) => item.id === tab.projectId)
            return (
              <div key={tab.id} className="absolute inset-0" hidden={!isActive}
                aria-hidden={!isActive} {...(!isActive ? { inert: '' } : {})}>
                <ExtensionViewHost viewId={tab.viewId} location="workspace" active={workspaceVisible && isActive}
                  workspaceId={tab.projectId} workspacePath={workspace?.path ?? null} />
              </div>
            )
          }

          if (tab.type !== 'terminal') return null
          const terminal = terminalsById.get(tab.terminalId)
          if (!terminal) return null
          const isActive = tab.id === activeTabId

          return (
            <div
              key={tab.id}
              className={`${styles.terminalContent} absolute inset-0`}
              style={{
                visibility: isActive ? 'visible' : 'hidden',
                pointerEvents: isActive ? 'auto' : 'none',
                zIndex: isActive ? 1 : 0,
              }}
              aria-hidden={!isActive}
            >
              <CLITerminal
                terminalId={terminal.id}
                visible={workspaceVisible && isActive}
                focused={workspaceVisible && isFocused && isActive}
                workspaceVisible={workspaceVisible}
              />
              {/* 仅 PTY 真死才弹模态遮罩：创建失败（errorMessage）或非零退出（exitCode）。
                  Turn 级失败（429/5xx）主进程上报 'degraded' 保持可用，此处再加一道兜底，
                  避免无 message 的裸 'error'（历史残留/误报）锁死输入。 */}
              {(terminal.status === 'error' && (terminal.errorMessage || terminal.exitCode !== undefined)) && (
                <div
                  className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center"
                  style={{ background: 'rgba(10, 10, 10, 0.72)' }}
                >
                  <div
                    className="pointer-events-auto flex max-w-[320px] flex-col items-center gap-3 rounded-lg border px-5 py-4 text-center font-mono"
                    style={{
                      borderColor: 'rgba(255, 88, 88, 0.28)',
                      background: 'var(--shell-chrome-raised)',
                      boxShadow: '0 12px 32px rgba(0,0,0,0.35)',
                    }}
                  >
                    <div className="text-[12px]" style={{ color: 'var(--shell-diff-del)' }}>
                      Terminal failed to start
                    </div>
                    <div className="text-[11px] leading-relaxed text-[var(--shell-muted)]">
                      {terminal.errorMessage || t('terminal:error.unknown')}
                    </div>
                    <button
                      type="button"
                      className="rounded border px-3 py-1.5 text-[11px] transition-colors hover:bg-[rgba(255,120,48,0.08)]"
                      style={{ borderColor: 'rgba(255,120,48,0.28)', color: 'var(--shell-accent)' }}
                      onClick={() => {
                        void retryTerminalCreate(terminal.id)
                      }}
                    >
                      Retry
                    </button>
                  </div>
                </div>
              )}
              <TurnChangeIsland
                terminalId={terminal.id}
                focused={workspaceVisible && isFocused && isActive}
              />
            </div>
          )
        })}
        {leaf.tabs.length === 0 && (
          <div
            className="flex h-full flex-col items-center justify-center gap-3 text-center font-mono text-[12px]"
            style={{ color: plancheEmpty ? 'rgba(28,52,59,0.62)' : '#666' }}
          >
            <div>Empty pane</div>
            <button
              type="button"
              onClick={openMenu}
              className="terminal-empty-new rounded border px-3 py-1.5 text-[11px] transition-colors"
              style={{
                borderColor: plancheEmpty ? '#1C343B' : 'rgba(255,120,48,0.22)',
                color: plancheEmpty ? '#D43D2A' : '#ffb27d',
                background: 'transparent',
              }}
            >
              New Terminal
            </button>
          </div>
        )}
      </div>
    </section>
  )
}

export function TerminalArea() {
  const { t } = useI18n('terminal')
  // Geometry and collapse are owned by GlobalToolsLayout. Subscribing to them
  // here rerenders every terminal/editor on each outer splitter movement.
  const globalTools = useGlobalToolsStore(useShallow((s) => ({
    paneTree: s.paneTree, focused: s.focused, focusedPaneId: s.focusedPaneId,
    collapsePaneLayout: s.collapsePaneLayout, setFocusedPane: s.setFocusedPane,
    setPaneTab: s.setPaneTab, reorderPaneTab: s.reorderPaneTab,
    movePaneTabToIndex: s.movePaneTabToIndex, dropContent: s.dropContent, resizePane: s.resizePane,
  })))
  // P5: useShallow 细粒度订阅——整 store 订阅会让任意无关字段变化都重渲染这棵大组件树
  const {
    workspaces,
    terminals,
    activeTerminalId,
    activeWorkspaceId,
    terminalSnapshots,
    paneTree,
    focusedPaneId,
    setActiveTerminal,
    removeTerminal,
    setFocusedPane,
    setPaneTab,
    collapsePaneLayout,
    resizePane,
    moveTerminalToPane,
    splitPaneWithTerminal,
    movePaneContentToPane,
    splitPaneWithContent,
    reorderPaneTab,
    movePaneTabToIndex,
    closePaneTab,
    setTabDragInFlight,
  } = useWorkspaceStore(
    useShallow((s) => ({
      workspaces: s.workspaces,
      terminals: s.terminals,
      activeTerminalId: s.activeTerminalId,
      activeWorkspaceId: s.activeWorkspaceId,
      terminalSnapshots: s.terminalSnapshots,
      paneTree: s.paneTree,
      focusedPaneId: s.focusedPaneId,
      setActiveTerminal: s.setActiveTerminal,
      removeTerminal: s.removeTerminal,
      setFocusedPane: s.setFocusedPane,
      setPaneTab: s.setPaneTab,
      collapsePaneLayout: s.collapsePaneLayout,
      resizePane: s.resizePane,
      moveTerminalToPane: s.moveTerminalToPane,
      splitPaneWithTerminal: s.splitPaneWithTerminal,
      movePaneContentToPane: s.movePaneContentToPane,
      splitPaneWithContent: s.splitPaneWithContent,
      reorderPaneTab: s.reorderPaneTab,
      movePaneTabToIndex: s.movePaneTabToIndex,
      closePaneTab: s.closePaneTab,
      setTabDragInFlight: s.setTabDragInFlight,
    }))
  )
  const [hotWorkspaceIds, setHotWorkspaceIds] = useState<string[]>(() =>
    touchWorkspaceSurfaceRecency([], activeWorkspaceId)
  )
  const hotWorkspaceEvictionTimerRef = useRef<number | null>(null)
  const setLoadState = useAppStore((s) => s.setLoadState)
  const terminalAreaRef = useRef<HTMLDivElement>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [drawerHeight, setDrawerHeight] = useState<number | undefined>(undefined)
  const [drawerResizing, setDrawerResizing] = useState(false)
  const drawerResizeRef = useRef<{ pointerId: number; target: HTMLDivElement; startY: number; startHeight: number; maximum: number } | null>(null)
  const drawerBodyStyleRef = useRef<{ cursor: string; userSelect: string } | null>(null)
  const drawerKeyboardResizeUntilRef = useRef(0)
  const [terminalMenuPaneId, setTerminalMenuPaneId] = useState<string | null>(null)
  const cancelTabDragRef = useRef<(() => void) | null>(null)
  // AC7: launching guard for handlePresetSelect, mirroring TerminalSelector's
  // launchingPreset pattern. Prevents double-click / rapid preset selection
  // from firing two concurrent terminal:create requests for the same preset.
  const [launchingPreset, setLaunchingPreset] = useState(false)
  // 新建终端菜单按设置里的条目与显隐实时生成；设置「终端管理」改完即生效。
  const shellProfiles = useShellProfilesStore((s) => s.settings)
  const terminalMenuItems = useMemo(() => buildTerminalMenuItems(shellProfiles), [shellProfiles])
  const terminalsById = useMemo(() => {
    const map = new Map<string, Terminal>()
    for (const snapshot of Object.values(terminalSnapshots)) {
      for (const terminal of snapshot.terminals) {
        map.set(terminal.id, terminal)
      }
    }
    for (const terminal of terminals) {
      map.set(terminal.id, terminal)
    }
    return map
  }, [terminalSnapshots, terminals])

  const workspaceSurfaces = useMemo(() => {
    return buildWorkspaceTerminalSurfaces(terminalSnapshots, activeWorkspaceId, {
      paneTree,
      activeTerminalId,
      focusedPaneId,
    }, hotWorkspaceIds)
  }, [activeTerminalId, activeWorkspaceId, focusedPaneId, hotWorkspaceIds, paneTree, terminalSnapshots])

  useEffect(() => {
    setHotWorkspaceIds((recentWorkspaceIds) =>
      touchWorkspaceSurfaceRecency(
        recentWorkspaceIds,
        activeWorkspaceId,
        MAX_HOT_WORKSPACE_SURFACES + 1,
      )
    )

    if (hotWorkspaceEvictionTimerRef.current !== null) {
      window.clearTimeout(hotWorkspaceEvictionTimerRef.current)
    }
    hotWorkspaceEvictionTimerRef.current = window.setTimeout(() => {
      hotWorkspaceEvictionTimerRef.current = null
      setHotWorkspaceIds((recentWorkspaceIds) =>
        recentWorkspaceIds.slice(0, MAX_HOT_WORKSPACE_SURFACES)
      )
    }, HOT_WORKSPACE_EVICTION_GRACE_MS)

    return () => {
      if (hotWorkspaceEvictionTimerRef.current !== null) {
        window.clearTimeout(hotWorkspaceEvictionTimerRef.current)
        hotWorkspaceEvictionTimerRef.current = null
      }
    }
  }, [activeWorkspaceId])

  const closeTerminalMenu = useCallback(() => {
    setTerminalMenuPaneId(null)
  }, [])

  const toggleTerminalMenu = useCallback((paneId: string) => {
    setTerminalMenuPaneId((current) => (current === paneId ? null : paneId))
  }, [])

  // 点击外部关闭弹出环
  useEffect(() => {
    if (!terminalMenuPaneId) return
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null
      if (!target?.closest('[data-terminal-menu-root="true"]')) {
        closeTerminalMenu()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [closeTerminalMenu, terminalMenuPaneId])

  useEffect(() => {
    if (paneTree) return
    if (terminals.length <= 1) {
      setLoadState('no-terminal')
      return
    }
    setActiveTerminal(activeTerminalId ?? terminals[0].id)
  }, [activeTerminalId, paneTree, setActiveTerminal, setLoadState, terminals])

  const handleKillTerminal = useCallback(
    async (id: string, e?: React.MouseEvent) => {
      e?.stopPropagation()
      try {
        await window.electron.terminal.kill(id)
      } catch {
        // ignore
      }
      removeTerminal(id)
      applyTerminalDraftLifecycle('kill-removed', id)
      useTurnChangesStore.getState().clearTerminal(id)
      if (useWorkspaceStore.getState().terminals.length === 0) {
        setLoadState('no-terminal')
      }
    },
    [removeTerminal, setLoadState]
  )

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.shiftKey || (!event.ctrlKey && !event.metaKey)) return
      const key = event.key.toLowerCase()
      /*-- Ctrl/Cmd+Shift+B：主动调用浏览器（已有则激活，否则新建）。
           Markdown 的 Ctrl/Cmd+Shift+N 已随入口移到全局，不再依赖抽屉挂载。 --*/
      if (key === 'b') {
        event.preventDefault()
        void useWorkspaceStore.getState().openBrowserInWorkspace()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  /*-- 关闭浏览器 pane tab：先销毁主进程 surface 再移除 pane 内容 --*/
  const handleCloseBrowserTab = useCallback(
    async (paneId: string, tabId: string, surfaceId: string) => {
      const global = useGlobalToolsStore.getState().browserSurfaceId === surfaceId
      await destroyBrowserSurface(surfaceId)
      if (global) useGlobalToolsStore.getState().forgetBrowser(surfaceId)
      else closePaneTab(paneId, tabId)
    },
    [closePaneTab]
  )

  /*-- 关闭 Markdown 标签只移除呈现，不碰草稿：删除文稿是编辑器里的独立动作 --*/
  const handleCloseMarkdownTab = useCallback(
    (paneId: string, tabId: string) => {
      if (getLeafPanes(useGlobalToolsStore.getState().paneTree).some((pane) => pane.id === paneId)) {
        useGlobalToolsStore.getState().closePaneTab(paneId, tabId)
      } else closePaneTab(paneId, tabId)
    },
    [closePaneTab]
  )

  /*-- 弹出为独立窗口：乐观更新载体后再移除 pane 内容，避免卸载时误隐藏已移交的视图 --*/
  const handleBrowserPopOut = useCallback(
    async (paneId: string, tabId: string, surfaceId: string) => {
      const result = await popOutBrowserSurface(surfaceId)
      if (!result.success) return
      useBrowserStore.getState().markCarrier(surfaceId, 'window')
      if (useGlobalToolsStore.getState().browserSurfaceId === surfaceId) useGlobalToolsStore.getState().closePaneTab(paneId, tabId)
      else closePaneTab(paneId, tabId)
    },
    [closePaneTab]
  )

  const handleTerminalDrop = useCallback(
    (terminalId: string, paneId: string, edge: PaneDropEdge | null, ratio: number) => {
      if (edge) {
        splitPaneWithTerminal(terminalId, paneId, edge, ratio)
        return
      }
      moveTerminalToPane(terminalId, paneId)
    },
    [moveTerminalToPane, splitPaneWithTerminal]
  )

  /*-- browser / markdown tab 拖拽落点：边缘分屏，否则移入目标 pane（与 terminal 同语义） --*/
  const handlePaneContentDrop = useCallback(
    (contentId: string, paneId: string, edge: PaneDropEdge | null, ratio: number) => {
      if (edge) {
        splitPaneWithContent(contentId, paneId, edge, ratio)
        return
      }
      movePaneContentToPane(contentId, paneId)
    },
    [movePaneContentToPane, splitPaneWithContent]
  )

  /*-- 侧栏 HTML5 拖入的 browser tab：带上 browser: 前缀转内容中立的落点处理 --*/
  const handleBrowserTabDrop = useCallback(
    (surfaceId: string, paneId: string, edge: PaneDropEdge | null, ratio: number) => {
      handlePaneContentDrop(`browser:${surfaceId}`, paneId, edge, ratio)
    },
    [handlePaneContentDrop]
  )

  /*-- tab 条内排序落点：同 pane 调整顺序，异 pane 按下标插入（画布中央落点仍走追加合并） --*/
  const handleReorderTab = useCallback(
    (paneId: string, tabId: string, targetIndex: number) => {
      reorderPaneTab(paneId, tabId, targetIndex)
    },
    [reorderPaneTab]
  )

  const handleMoveTabToIndex = useCallback(
    (contentId: string, paneId: string, targetIndex: number) => {
      movePaneTabToIndex(contentId, paneId, targetIndex)
    },
    [movePaneTabToIndex]
  )

  useLayoutEffect(() => () => cancelTabDragRef.current?.(), [activeWorkspaceId, paneTree, globalTools.paneTree])

  const handleFluidCandidate = useCallback((contentId: string, paneId: string, event: React.PointerEvent) => {
    if (event.button !== 0 || !event.isPrimary || !terminalAreaRef.current) return
    const source = event.currentTarget as HTMLElement
    const control = (event.target as Element).closest('[data-tab-close], button, [role="button"]')
    if (control && control !== source) return
    cancelTabDragRef.current?.()
    cancelTabDragRef.current = startPaneTabDrag({
      root: source.closest<HTMLElement>('[data-pane-region]') ?? terminalAreaRef.current,
      source,
      event: event.nativeEvent,
      onActiveChange: setTabDragInFlight,
      onDrop: (target) => {
        if (source.closest('[data-pane-region="tools"]')) {
          const tools = useGlobalToolsStore.getState()
          if (target.index !== undefined) {
            tools.movePaneTabToIndex(contentId, target.paneId, target.index)
            tools.setPaneTab(target.paneId, contentId)
          } else tools.dropContent(contentId, target.paneId, target.zone === 'center' ? null : target.zone, SPLIT_RATIO_EQUAL)
          return
        }
        if (target.index !== undefined) {
          if (target.paneId === paneId) handleReorderTab(paneId, contentId, target.index)
          else handleMoveTabToIndex(contentId, target.paneId, target.index)
          // An unchanged insertion index must still select the dragged tab.
          setPaneTab(target.paneId, contentId)
          return
        }
        const edge = target.zone === 'center' ? null : target.zone
        if (contentId.startsWith('terminal:')) handleTerminalDrop(contentId.slice(9), target.paneId, edge, SPLIT_RATIO_EQUAL)
        else {
          handlePaneContentDrop(contentId, target.paneId, edge, SPLIT_RATIO_EQUAL)
        }
      },
    })
  }, [setTabDragInFlight, handleReorderTab, handleMoveTabToIndex, setPaneTab, handleTerminalDrop, handlePaneContentDrop])

  const handlePresetSelect = useCallback(
    async (item: TerminalPresetOption) => {
      closeTerminalMenu()
      if (!activeWorkspaceId) return
      // AC7: reject concurrent preset launches (double-click, rapid reselect).
      if (launchingPreset) return

      const workspace = useWorkspaceStore.getState().workspaces.find((w) => w.id === activeWorkspaceId)
      if (!workspace) return

      setLaunchingPreset(true)
      try {
        await launchTerminalPreset({
          preset: item.type,
          workspaceId: activeWorkspaceId,
          workspacePath: workspace.path,
          cwd: useWorktreeStore.getState().activePaths[activeWorkspaceId] ?? workspace.path,
          // shell 条目保留用户写的名称（新建后终端显示实际 shell 名），CLI 预设沿用原小写名。
          name: item.type === 'shell' ? item.name : item.name.toLowerCase(),
          // 临时选择只作用本次新建：传条目 id，不动全局默认值。
          ...(item.shellProfileId ? { shellProfileId: item.shellProfileId } : {}),
        })
      } finally {
        setLaunchingPreset(false)
      }
    },
    [activeWorkspaceId, closeTerminalMenu, launchingPreset]
  )

  useEffect(() => {
    warmDefaultShellCache()
    warmShellProfilesCache()
    warmTerminalCreatePath()
  }, [])

  const paneCount = useMemo(() => getLeafPanes(paneTree).length, [paneTree])
  const activeTerminal = activeTerminalId ? terminalsById.get(activeTerminalId) ?? null : null
  const focusedTerminalWorkspace = activeTerminal
    ? workspaces.find((workspace) => workspace.id === activeTerminal.workspaceId) ?? null
    : null
  const otherTerminals = terminals.filter((terminal) => terminal.id !== activeTerminal?.id)

  const getDrawerMaxHeight = useCallback(() => {
    const areaHeight = terminalAreaRef.current?.clientHeight ?? 0
    return Math.max(DRAWER_MIN_HEIGHT, areaHeight - DRAWER_MIN_PANE_HEIGHT)
  }, [])

  const finishDrawerResize = useCallback(() => {
    const session = drawerResizeRef.current
    if (session?.target.hasPointerCapture(session.pointerId)) {
      session.target.releasePointerCapture(session.pointerId)
    }
    drawerResizeRef.current = null
    if (session) setDrawerResizing(false)
    if (drawerBodyStyleRef.current) {
      document.body.style.cursor = drawerBodyStyleRef.current.cursor
      document.body.style.userSelect = drawerBodyStyleRef.current.userSelect
      drawerBodyStyleRef.current = null
    }
  }, [])

  useEffect(() => finishDrawerResize, [finishDrawerResize])

  useEffect(() => {
    if (!drawerOpen) finishDrawerResize()
  }, [drawerOpen, finishDrawerResize])

  const handleDrawerResizeStart = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    finishDrawerResize()
    const maximum = getDrawerMaxHeight()
    drawerResizeRef.current = {
      pointerId: event.pointerId,
      target: event.currentTarget,
      startY: event.clientY,
      startHeight: Math.min(drawerHeight ?? DRAWER_DEFAULT_HEIGHT, maximum),
      maximum,
    }
    drawerBodyStyleRef.current = {
      cursor: document.body.style.cursor,
      userSelect: document.body.style.userSelect,
    }
    document.body.style.cursor = 'row-resize'
    document.body.style.userSelect = 'none'
    event.currentTarget.setPointerCapture(event.pointerId)
    setDrawerResizing(true)
    event.preventDefault()
  }

  const handleDrawerResizeMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const session = drawerResizeRef.current
    if (!session || session.pointerId !== event.pointerId) return
    setDrawerHeight(clampDrawerHeight(session.startHeight + session.startY - event.clientY, session.maximum))
  }

  const handleDrawerResizeEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (drawerResizeRef.current?.pointerId === event.pointerId) finishDrawerResize()
  }

  const handleDrawerResizeKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const maximum = getDrawerMaxHeight()
    const current = Math.min(drawerHeight ?? DRAWER_DEFAULT_HEIGHT, maximum)
    const heights: Partial<Record<string, number>> = {
      ArrowUp: current + 16,
      ArrowDown: current - 16,
      Home: DRAWER_MIN_HEIGHT,
      End: maximum,
    }
    const height = heights[event.key]
    if (height === undefined) return
    event.preventDefault()
    // The focused terminal re-takes DOM focus on every refit; keep the handle focused for the keystrokes that follow.
    drawerKeyboardResizeUntilRef.current = Date.now() + 250
    const clamped = clampDrawerHeight(height, maximum)
    setDrawerHeight(clamped)
  }

  const handleDrawerResizeBlur = (event: React.FocusEvent<HTMLDivElement>) => {
    const stolenByTerminal = event.relatedTarget instanceof HTMLElement && event.relatedTarget.classList.contains('xterm-helper-textarea')
    if (stolenByTerminal && Date.now() < drawerKeyboardResizeUntilRef.current) event.currentTarget.focus()
  }

  return (
      <div
        ref={terminalAreaRef}
        className={styles.area}
    >
      <GlobalToolsLayout hasProject={activeWorkspaceId !== null || paneTree !== null} projectTree={paneTree}
        tools={(visible) => <PaneTreeView
          toolsRegion node={globalTools.paneTree} workspaceVisible={visible}
          terminalsById={terminalsById} focusedPaneId={globalTools.focused ? globalTools.focusedPaneId : null}
          activeTerminalId={null} showFocusChrome={getLeafPanes(globalTools.paneTree).length > 1}
          onCollapseLayout={globalTools.collapsePaneLayout} onPaneFocus={globalTools.setFocusedPane}
          onTabSelect={globalTools.setPaneTab} onKillTerminalFromTab={handleKillTerminal}
          onCloseBrowserTab={handleCloseBrowserTab} onCloseMarkdownTab={handleCloseMarkdownTab}
          onBrowserPopOut={handleBrowserPopOut} onKillTerminal={handleKillTerminal}
          onTerminalDrop={() => {}} onReorderTab={globalTools.reorderPaneTab}
          onMoveTabToIndex={globalTools.movePaneTabToIndex} onFluidCandidate={handleFluidCandidate}
          onBrowserTabDrop={(id, paneId, edge, ratio) => globalTools.dropContent('browser:' + id, paneId, edge, ratio)}
          onResize={globalTools.resizePane} terminalMenuPaneId={null} onToggleTerminalMenu={() => {}}
          onCloseTerminalMenu={closeTerminalMenu} onCreateTerminal={handlePresetSelect} terminalMenuItems={terminalMenuItems}
        />}
        project={(projectVisible) => <>
      <div className={styles.paneHost} data-pane-host="">
        {!paneTree && activeWorkspaceId && <TerminalSelector />}
        {workspaceSurfaces.map((surface) => {
          // 无项目时活动 surface 的宿主是全局哨兵，可见性按哨兵判；
          // 有项目时仍按真实 workspaceId 判。
          const workspaceVisible = projectVisible && (activeWorkspaceId === null
            ? surface.workspaceId === GLOBAL_PANE_SCOPE
            : surface.workspaceId === activeWorkspaceId)
          return (
            <div
              key={surface.workspaceId}
              className="absolute inset-0"
              style={{
                display: workspaceVisible ? 'block' : 'none',
              }}
              {...(!workspaceVisible ? { inert: '' } : {})}
              aria-hidden={!workspaceVisible}
            >
              <PaneTreeView
                node={surface.paneTree}
                workspaceVisible={workspaceVisible}
                terminalsById={terminalsById}
                focusedPaneId={globalTools.focused ? null : surface.focusedPaneId}
                activeTerminalId={surface.activeTerminalId}
                showFocusChrome={workspaceVisible && paneCount > 1}
                onCollapseLayout={collapsePaneLayout}
                onPaneFocus={setFocusedPane}
                onTabSelect={setPaneTab}
                onKillTerminalFromTab={handleKillTerminal}
                onCloseBrowserTab={handleCloseBrowserTab}
                onCloseMarkdownTab={handleCloseMarkdownTab}
                onBrowserPopOut={handleBrowserPopOut}
                onKillTerminal={handleKillTerminal}
                onTerminalDrop={handleTerminalDrop}
                onReorderTab={handleReorderTab}
                onMoveTabToIndex={handleMoveTabToIndex}
                onFluidCandidate={handleFluidCandidate}
                onBrowserTabDrop={handleBrowserTabDrop}
                onResize={resizePane}
                terminalMenuPaneId={terminalMenuPaneId}
                onToggleTerminalMenu={toggleTerminalMenu}
                onCloseTerminalMenu={closeTerminalMenu}
                onCreateTerminal={handlePresetSelect}
                terminalMenuItems={terminalMenuItems}
              />
            </div>
          )
        })}
      </div>

      <div
        data-runtime-drawer=""
        data-open={drawerOpen}
        className={styles.drawer}
        style={{
          height: getDrawerHeight(drawerOpen, drawerHeight),
          maxHeight: `calc(100% - ${DRAWER_MIN_PANE_HEIGHT}px)`,
          transition: drawerResizing ? 'none' : undefined,
        }}
      >
        {drawerOpen && (
          <div
            className="term-drawer-resize"
            data-resizing={drawerResizing}
            role="separator"
            aria-label={t('terminal:tab.drawerResizeAria')}
            aria-orientation="horizontal"
            aria-valuemin={DRAWER_MIN_HEIGHT}
            aria-valuemax={Math.round(getDrawerMaxHeight())}
            aria-valuenow={Math.round(Math.min(drawerHeight ?? DRAWER_DEFAULT_HEIGHT, getDrawerMaxHeight()))}
            tabIndex={0}
            onPointerDown={handleDrawerResizeStart}
            onPointerMove={handleDrawerResizeMove}
            onPointerUp={handleDrawerResizeEnd}
            onPointerCancel={handleDrawerResizeEnd}
            onLostPointerCapture={handleDrawerResizeEnd}
            onKeyDown={handleDrawerResizeKeyDown}
            onBlur={handleDrawerResizeBlur}
          />
        )}
        <button
          type="button"
          className={styles.drawerBar}
          aria-expanded={drawerOpen}
          aria-controls={getDrawerPanelId()}
          aria-label={t('terminal:tab.runtimePanelToggle')}
          onClick={() => setDrawerOpen((value) => !value)}
        >
          <span className={styles.drawerPrimary}>
            <span className={styles.drawerToggle}>
              <ChevronRight size={12} strokeWidth={1.6} aria-hidden="true" className={styles.drawerChevron} />
              <span>{t('terminal:tab.runtimeAria')}</span>
            </span>
            {activeTerminal ? (
              <span className={styles.drawerDetails}>
                {/*-- 抽屉左端补一枚 preset 图标：抽屉条本身是"当前终端"的入口，
                     收起时也要能一眼认出是哪个 CLI，展开时与中部 tab / 左侧栏同一套图标语言。 --*/}
                <ThemedTooltip label={`${providerLabel(activeTerminal.preset, t)} · ${activeTerminal.cwd}`}>
                <span
                  className={`${styles.metadata} ${styles.drawerProvider} font-mono`}
                >
                  <TerminalPresetIcon
                    preset={activeTerminal.preset}
                    className="h-3.5 w-3.5 shrink-0"
                  />
                  <span className="truncate">{providerLabel(activeTerminal.preset, t)}</span>
                </span>
                </ThemedTooltip>
                {focusedTerminalWorkspace && (
                  <ThemedTooltip label={t('terminal:tab.focusWorkspaceTitle', { name: focusedTerminalWorkspace.name, path: focusedTerminalWorkspace.path })}>
                  <span
                    className={`${styles.drawerWorkspace} min-w-0 max-w-[150px] items-center gap-1.5 font-mono text-[10px]`}
                    style={{
                      color: 'var(--shell-dim)',
                    }}
                  >
                    <span
                      aria-hidden="true"
                      className="h-1 w-1 shrink-0 rounded-full"
                      style={{ background: 'var(--shell-dim)' }}
                    />
                    <span className="truncate">{focusedTerminalWorkspace.name}</span>
                  </span>
                  </ThemedTooltip>
                )}
                <span
                  className={`${styles.metadata} ${styles.drawerModel} font-mono`}
                >
                  <span className="truncate">{modelLabel(activeTerminal, t)}</span>
                </span>
                <TerminalContextTooltip terminal={activeTerminal}>
                <span
                  className={`${styles.contextBadge} group font-mono`}
                  style={{
                    background: `${contextRatioColor(contextRatio(activeTerminal))}12`,
                    color: contextRatioColor(contextRatio(activeTerminal)),
                  }}
                >
                  {contextLabel(activeTerminal, t)}
                </span>
                </TerminalContextTooltip>
              </span>
            ) : (
              <span className="truncate text-[var(--shell-dim)]">{t('terminal:tab.noTelemetryData')}</span>
            )}
          </span>
            <span className={styles.drawerOthers}>
              {otherTerminals.slice(0, 3).map((terminal) => {
                return (
                <ThemedTooltip key={terminal.id} label={`${providerLabel(terminal.preset, t)} · ${modelLabel(terminal, t)} · ${contextLabel(terminal, t)}`}>
                <span
                  className={`${styles.metadata} max-w-[126px] overflow-hidden font-mono`}
                  style={{
                    color: 'var(--shell-dim)',
                  }}
                >
                  <TerminalStatusLight status={terminal.status} compact />
                  <TerminalPresetIcon
                    preset={terminal.preset}
                    className="h-3.5 w-3.5 shrink-0"
                  />
                  <span className="truncate">{providerLabel(terminal.preset, t)}</span>
                </span>
                </ThemedTooltip>
                )
              })}
              {otherTerminals.length > 3 && (
                <span className="inline-flex h-5 items-center px-1.5 font-mono text-[var(--shell-dim)]">
                  +{otherTerminals.length - 3}
                </span>
              )}
            </span>
        </button>
        {/*-- Markdown 已迁为独立 pane，底部抽屉只留上下文监控 --*/}
        <div
          id={getDrawerPanelId()}
          hidden={!drawerOpen}
          className="overflow-hidden px-3 pb-3 pt-2 text-[11px] font-mono"
          style={{ height: 'calc(100% - 28px)' }}
        >
          {drawerOpen && (
            <section
              className="flex h-full min-h-0 flex-col overflow-hidden"
              aria-label={t('terminal:tab.runtimeAria')}
            >
              <div className="flex h-8 shrink-0 items-center justify-between px-2.5">
                <span className="text-[var(--shell-muted)]">{t('terminal:tab.terminalRuntime')}</span>
                <span className="text-[var(--shell-dim)]">{terminals.length} {t('terminal:sessions.countSuffix')}</span>
              </div>
              <div className="min-h-0 flex-1 overflow-auto p-2">
                {terminals.length === 0 ? (
                  <div className="px-1 py-3 text-[var(--shell-dim)]">{t('terminal:tab.noTelemetryData')}</div>
                ) : (
                  <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 260px), 1fr))' }}>
                    {terminals.map((terminal) => {
                      const ratio = contextRatio(terminal)
                      const ratioColor = contextRatioColor(ratio)
                      const isActiveCard = terminal.id === activeTerminalId
                      const cardVisual = getTerminalStatusVisual(terminal.status)
                      const cardStatusLabel = cardVisual ? t(cardVisual.labelKey) : undefined
                      const identityLabel = cardStatusLabel
                        ? `${providerLabel(terminal.preset, t)} · ${cardStatusLabel} · ${terminal.cwd}`
                        : `${providerLabel(terminal.preset, t)} · ${terminal.cwd}`
                      return (
                        <button
                          key={terminal.id}
                          type="button"
                          className={`${styles.runtimeCard} group flex min-w-0 cursor-pointer flex-col gap-2 px-2.5 py-2 text-left`}
                          aria-current={isActiveCard ? 'true' : undefined}
                          aria-label={identityLabel}
                          onClick={() => setActiveTerminal(terminal.id)}
                        >
                          {/* Current terminal is marked locally; no perimeter outline. */}
                          {isActiveCard && (
                            <span
                              aria-hidden="true"
                              className="absolute inset-y-0 left-0 w-0.5 rounded-l-md"
                              style={{ background: 'var(--shell-accent-border)' }}
                            />
                          )}
                          <span className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                            <ThemedTooltip label={identityLabel}>
                            <span className="flex min-w-0 items-center gap-1.5">
                              <TerminalStatusLight status={terminal.status} compact />
                              {/*-- 与抽屉条左端 / 中部 tab 同一枚 preset 图标：卡片只给名称时
                                   分不清 codex 与 opencode，图标是唯一稳定的身份锚点。 --*/}
                              <TerminalPresetIcon
                                preset={terminal.preset}
                                className="h-3.5 w-3.5 shrink-0"
                              />
                              <span
                                className="truncate text-[12px] font-medium"
                                style={{ color: isActiveCard ? 'var(--shell-accent)' : 'var(--shell-text)' }}
                              >
                                {providerLabel(terminal.preset, t)}
                              </span>
                            </span>
                            </ThemedTooltip>
                            <TerminalRuntime terminal={terminal} />
                          </span>
                          <span className="truncate text-[10px] text-[var(--shell-dim)]">{modelLabel(terminal, t)}</span>
                          <TerminalContextTooltip terminal={terminal}>
                          <span className="flex min-w-0 flex-col gap-1 pt-1">
                            <span className="flex items-baseline justify-between gap-2">
                              <span className="text-[10px] text-[var(--shell-muted)]">{t('terminal:context.row.context')}</span>
                              <span className="flex items-baseline gap-1.5">
                                <span className="tabular-nums text-[11px] text-[var(--shell-text)]">{contextExactLabel(terminal, t)}</span>
                                <span className="shrink-0 tabular-nums text-[10px]" style={{ color: ratioColor }}>{contextPercentLabel(terminal)}</span>
                              </span>
                            </span>
                            <span
                              className="block h-1 w-full overflow-hidden rounded-full"
                              style={{ background: 'var(--shell-border-soft)' }}
                            >
                              <span
                                className="block h-full rounded-full transition-[width,background] duration-300"
                                style={{
                                  width: `${Math.round((ratio ?? 0) * 100)}%`,
                                  background: ratioColor,
                                }}
                              />
                            </span>
                          </span>
                          </TerminalContextTooltip>
                          <TerminalUsageStats terminal={terminal} layout="grid" />
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            </section>
          )}
        </div>
      </div>

        </>}
      />

    </div>
  )
}
