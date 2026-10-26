import { useEffect, useRef, useState, type ReactNode } from 'react'
// Note: .agents/notes/workbench/service-integrations.md — declared CPA launcher in the global tools menu.
import { ChevronDown, Globe, Puzzle } from 'lucide-react'
import { ThemedTooltip } from './ui/ThemedTooltip'
import { MarkdownIcon } from './ui/MarkdownIcon'
import { ToolboxIcon } from './ui/ToolboxIcon'
import { useGlobalToolsStore } from '@/stores/global-tools'
import { useWorkspaceStore } from '@/stores/workspace'
import { useExperimentalStore } from '@/stores/experimental'
import { useRightToolStore } from '@/stores/right-tools'
import { canonicalRightToolId } from '@/right-tools/registry'
import { useExtensionCommands, useToolbarWorkbenches } from '@/extensions/react'
import { extensionCommands } from '@/extensions/commands'
import { installExtensionShortcuts } from '@/extensions/command-shortcuts'
import { openExtensionView } from '@/extensions/workbench'
import { getLeafPanes } from '@/lib/workspace-pane'
import { useBrowserOcclusion } from '@/hooks/useBrowserOcclusion'
import { openGlobalTool, resolveGlobalToolOpenState } from '@/lib/global-tool-entry'
import { useI18n } from '@/i18n/useI18n'
import { useAppStore } from '@/stores/app'
import styles from './TitlebarToolGroup.module.css'

/**
 * 顶栏全局工具入口：一个可展开的工具菜单。
 *
 * 触发器只有一枚通用工具图标（工具箱=一个控件装多件工具），
 * 展开后是浏览器 / Markdown 与声明 tool-menu 入口的扩展视图，
 * 触发器外形不再随工具数量变化。
 *
 * 每个工具的目标都是"打开中央内容"，与终端流程解耦——没有终端、没有项目时
 * 同样可达。pane 工具走 {@link openGlobalTool}：先翻回工作区正面并收起遮挡的
 * 工作台，再打开目标 pane；工作台插件直接打开或定位自身，保留当前实例。
 * 本组与其余工作台入口同排，由竖分隔线隔开
 * （见 markdown-pane-entry.md 的顶栏分组）。
 *
 * 全局工具只有一个实例；重复点击定位原工具，并展开已收起的工具区。
 */
export function TitlebarToolGroup() {
  const { t } = useI18n()
  const openBrowserInWorkspace = useWorkspaceStore((s) => s.openBrowserInWorkspace)
  const openMarkdownInWorkspace = useWorkspaceStore((s) => s.openMarkdownInWorkspace)
  const paneTree = useGlobalToolsStore((s) => s.paneTree)
  const projectTree = useWorkspaceStore((s) => s.paneTree)
  const browserSurfaceId = useGlobalToolsStore((s) => s.browserSurfaceId)
  const workspaceId = useWorkspaceStore((s) => s.activeWorkspaceId)
  const openRightTools = useRightToolStore((s) => s.openToolIds)
  const activeWorkbench = useAppStore(s => s.activeWorkbench)
  useExtensionCommands()
  useEffect(() => installExtensionShortcuts(window), [])
  const [menuOpen, setMenuOpen] = useState(false)
  useBrowserOcclusion(menuOpen)
  const comboRef = useRef<HTMLDivElement | null>(null)

  const openState = { ...resolveGlobalToolOpenState(paneTree), browser: browserSurfaceId !== null }

  // 展开后点外面或按 Esc 收起（与 ShellCard 的菜单同一套收合规则）。
  useEffect(() => {
    if (!menuOpen) return
    const handlePointerDown = (event: PointerEvent) => {
      if (!comboRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [menuOpen])

  // Built-in tools and declared extension launchers share the same opening and reveal semantics.
  const tools: Array<{
    id: string
    icon: ReactNode
    label: string
    actionLabel: string
    opened: boolean
    disabled?: boolean
    workbench?: boolean
    open: () => void | Promise<void>
  }> = [
    {
      id: 'browser',
      icon: <Globe className={styles.menuIcon} size={14} strokeWidth={1.5} aria-hidden="true" />,
      label: t('common:toolGroup.browser'),
      actionLabel: openState.browser ? t('common:toolGroup.browserOpened') : t('common:toolGroup.browserAction'),
      opened: openState.browser,
      open: () => openBrowserInWorkspace(),
    },
    {
      id: 'markdown',
      icon: <MarkdownIcon className={`${styles.menuIcon} ${styles.markdownIcon}`} strokeWidth={1.75} aria-hidden="true" />,
      label: t('common:toolGroup.markdown'),
      actionLabel: openState.markdown ? t('common:toolGroup.markdownOpened') : t('common:toolGroup.markdownAction'),
      opened: openState.markdown,
      open: () => openMarkdownInWorkspace(),
    },
    ...extensionCommands.getMenus('toolbox', Boolean(workspaceId)).map((entry) => {
      const view = entry.view
      const Icon = view.icon ?? Puzzle
      const title = extensionCommands.getSnapshot().commands.find((command) => command.id === entry.commandId)?.title ?? view.title
      const workbench = view.location === 'workbench'
      const workbenchOpen = workbench && activeWorkbench === view.id
      const label = workbenchOpen ? t('common:toolGroup.returnToTool', { name: view.title }) : title
      return {
        id: entry.id,
        icon: <Icon className={styles.menuIcon} size={14} strokeWidth={1.5} aria-hidden="true" />,
        label,
        actionLabel: label,
        workbench,
        disabled: !extensionCommands.canExecute(entry.commandId, Boolean(workspaceId)),
        opened: workbench ? workbenchOpen : view.location === 'right'
          ? openRightTools.some((id) => id === canonicalRightToolId(view.id))
          : getLeafPanes(view.scope === 'application' ? paneTree : projectTree).some((leaf) => leaf.tabs.some((tab) => tab.type === 'extension' && tab.viewId === view.id)),
        open: () => { extensionCommands.execute(entry.commandId, Boolean(workspaceId), openExtensionView) },
      }
    }),
  ]

  const pick = (tool: typeof tools[number]) => {
    setMenuOpen(false)
    // Reopening the active workbench must preserve its page and return target.
    if (tool.workbench) void tool.open()
    else openGlobalTool(tool.open)
  }

  return (
    <div className={styles.group} aria-label={t('common:toolGroup.aria')}>
      <div className={styles.combo} ref={comboRef}>
        <ThemedTooltip label={t('common:toolGroup.triggerAction')} disabled={menuOpen}>
          <button
            type="button"
            className={`${styles.trigger}${menuOpen ? ` ${styles.triggerOpen}` : ''}`}
            data-id="tool-menu"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label={t('common:toolGroup.triggerAction')}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <ToolboxIcon className={styles.icon} size={16} strokeWidth={1.5} aria-hidden="true" />
            <ChevronDown className={styles.chevron} size={11} strokeWidth={2} aria-hidden="true" />
          </button>
        </ThemedTooltip>

        {menuOpen && (
          <div className={styles.menu} role="menu" aria-label={t('common:toolGroup.aria')}>
            {tools.map((tool) => (
              <button
                key={tool.id}
                type="button"
                role="menuitem"
                className={styles.menuItem}
                data-id={tool.id}
                disabled={tool.disabled}
                title={tool.actionLabel}
                aria-label={tool.actionLabel}
                onClick={() => pick(tool)}
              >
                {tool.icon}
                <span className={styles.menuLabel}>{tool.label}</span>
                {tool.opened && <span className={styles.menuBadge}>{t('common:toolGroup.openedBadge')}</span>}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/** 工具组与工作台分组之间的竖分隔线；没有可见工作台按钮时收起。 */
export function TitlebarToolSeparator() {
  const knowledge = useExperimentalStore((s) => s.persona)
  const loadExperimental = useExperimentalStore((s) => s.load)
  const projectOpen = useWorkspaceStore(s => Boolean(s.activeWorkspaceId))
  const pluginWorkbench = useToolbarWorkbenches(projectOpen).length > 0

  useEffect(() => {
    void loadExperimental()
  }, [loadExperimental])

  // 没有剩余工作台按钮时，分隔线也收起。
  if (!knowledge && !pluginWorkbench) return null
  return <span className={styles.separator} aria-hidden="true" />
}
