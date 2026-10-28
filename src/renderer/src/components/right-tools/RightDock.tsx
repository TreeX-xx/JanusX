import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from 'react'
import type { RightToolId } from '@/right-tools/types'
import { isRightToolEnabled } from '@/right-tools/registry'
import { useExtensionViews } from '@/extensions/react'
import { useExperimentalStore } from '@/stores/experimental'
import { useRightToolStore } from '@/stores/right-tools'
import { useWorkspaceStore } from '@/stores/workspace'
import { useI18n } from '@/i18n/useI18n'
import {
  clampRightToolPanelWidth,
  preferredRightToolPanelWidth,
  rightToolPanelMinWidth,
} from '@/right-tools/state'
import { RightToolHost } from './RightToolHost'
import { RightToolRail } from './RightToolRail'
import { useAnimatedOpen } from '@/components/shared/CardFrame'
import styles from './RightDock.module.css'

export interface RightDockProps {
  effectiveCollapsed: boolean
  effectiveMaxWidth: number
  forcedCollapsed: boolean
  onResizingChange: (resizing: boolean) => void
}

interface ResizeSession {
  pointerId: number
  target: HTMLDivElement
  startX: number
  startWidth: number
}

export function RightDock({
  effectiveCollapsed,
  effectiveMaxWidth,
  forcedCollapsed,
  onResizingChange,
}: RightDockProps) {
  const { t } = useI18n('common')
  const extensionViews = useExtensionViews()
  const storedOpenToolIds = useRightToolStore((state) => state.openToolIds)
  const storedActiveToolId = useRightToolStore((state) => state.activeToolId)
  const panelWidth = useRightToolStore((state) => state.panelWidth)
  const panelWidths = useRightToolStore((state) => state.panelWidths)
  const closeTool = useRightToolStore((state) => state.closeTool)
  const toggleFromRail = useRightToolStore((state) => state.toggleFromRail)
  const setPanelWidth = useRightToolStore((state) => state.setPanelWidth)
  const personaEnabled = useExperimentalStore((state) => state.persona)
  const knowledgeEnabled = useExperimentalStore((state) => state.knowledge)
  const features = { persona: personaEnabled, knowledge: knowledgeEnabled }
  const openToolIds = storedOpenToolIds.filter(toolId => isRightToolEnabled(toolId, features))
  const activeToolId = storedActiveToolId && isRightToolEnabled(storedActiveToolId, features) ? storedActiveToolId : null
  const loadExperimental = useExperimentalStore((state) => state.load)
  const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId)
  const workspaces = useWorkspaceStore((state) => state.workspaces)
  const resizeSessionRef = useRef<ResizeSession | null>(null)
  const bodyStyleRef = useRef<{ cursor: string; userSelect: string } | null>(null)
  const [resizing, setResizing] = useState(false)
  const workspacePath = workspaces.find(({ id }) => id === activeWorkspaceId)?.path ?? null
  const contentVisible = !effectiveCollapsed && activeToolId !== null
  const dockRef = useRef<HTMLElement>(null)
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const focusPreviewRef = useRef(false)
  const [previewToolId, setPreviewToolId] = useState<RightToolId | null>(null)
  const railOnly = !contentVisible
  const previewId = railOnly && previewToolId && isRightToolEnabled(previewToolId, features) ? previewToolId : null
  const panelVisible = contentVisible || previewId !== null
  const motion = useAnimatedOpen(panelVisible, 320)
  const lastVisibleToolRef = useRef<RightToolId | null>(null)
  const lastTransientRef = useRef(false)
  // 工具在浮动卡片存活期内保持挂载：来回悬浮切换只是 hidden 翻转，不再整棵卸载重挂。
  // 卡片退出（motion.rendered 变 false）后释放，与 right-dock.md 记录的退出释放语义一致。
  const previewedToolIdsRef = useRef<RightToolId[]>([])
  if (panelVisible) {
    lastVisibleToolRef.current = previewId ?? activeToolId
    lastTransientRef.current = previewId !== null
  }
  const displayedToolId = panelVisible ? previewId ?? activeToolId : motion.rendered ? lastVisibleToolRef.current : activeToolId
  if (motion.rendered) {
    if (displayedToolId && !openToolIds.includes(displayedToolId) && isRightToolEnabled(displayedToolId, features)
      && !previewedToolIdsRef.current.includes(displayedToolId)) {
      previewedToolIdsRef.current = [...previewedToolIdsRef.current, displayedToolId]
    }
  } else if (previewedToolIdsRef.current.length) {
    previewedToolIdsRef.current = []
  }
  const hostToolIds = motion.rendered
    ? [...openToolIds, ...previewedToolIdsRef.current.filter((id) => !openToolIds.includes(id) && isRightToolEnabled(id, features))]
    : openToolIds
  const cancelPreviewTimer = useCallback(() => {
    if (previewTimer.current) clearTimeout(previewTimer.current)
    previewTimer.current = null
  }, [])
  const dismissPreview = useCallback(() => {
    cancelPreviewTimer()
    focusPreviewRef.current = false
    setPreviewToolId(null)
  }, [cancelPreviewTimer])
  const schedulePreview = (toolId: RightToolId) => {
    cancelPreviewTimer()
    if (!railOnly) return
    // Dwell guards entry into the rail, not navigation within a live card.
    // Include its exit lifetime so re-entry reverses the fade without stalling.
    if (motion.rendered && lastTransientRef.current) {
      setPreviewToolId(toolId)
      return
    }
    previewTimer.current = setTimeout(() => {
      previewTimer.current = null
      setPreviewToolId(toolId)
    }, 220)
  }
  const scheduleDismiss = () => {
    cancelPreviewTimer()
    previewTimer.current = setTimeout(() => {
      // Keep keyboard navigation inside the interactive card alive.
      if (!dockRef.current?.querySelector('#right-tool-panel')?.contains(document.activeElement)) setPreviewToolId(null)
    }, 180)
  }
  useEffect(() => dismissPreview(), [activeWorkspaceId, contentVisible, extensionViews, personaEnabled, knowledgeEnabled, dismissPreview])
  useEffect(() => cancelPreviewTimer, [cancelPreviewTimer])
  useEffect(() => {
    if (!focusPreviewRef.current || !panelVisible) return
    focusPreviewRef.current = false
    dockRef.current?.querySelector<HTMLElement>('#right-tool-panel section:not([hidden]) input, #right-tool-panel section:not([hidden]) button')?.focus()
  }, [previewId, panelVisible])
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      const focusedInside = dockRef.current?.querySelector('#right-tool-panel')?.contains(document.activeElement)
      if (previewToolId && focusedInside && displayedToolId) document.getElementById(`right-tool-rail-${displayedToolId}`)?.focus()
      // Restoring rail focus can request a preview; Escape must win over it.
      dismissPreview()
    }
    const onOutside = (event: globalThis.PointerEvent) => {
      if (!dockRef.current?.contains(event.target as Node)) dismissPreview()
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onOutside)
    window.addEventListener('resize', dismissPreview)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onOutside)
      window.removeEventListener('resize', dismissPreview)
    }
  }, [previewToolId, displayedToolId, contentVisible, dismissPreview])
  // Per-tool drag preference and responsive display width stay separate.
  // See .agents/notes/workbench/right-dock.md
  const minimum = rightToolPanelMinWidth(activeToolId)
  const maximum = Math.max(minimum, effectiveMaxWidth)
  const preferredWidth = preferredRightToolPanelWidth(panelWidth, panelWidths, displayedToolId)
  const renderedPanelWidth = previewId ? preferredWidth : clampRightToolPanelWidth(preferredWidth, maximum, activeToolId)

  const finishResize = useCallback(() => {
    const session = resizeSessionRef.current
    if (session?.target.hasPointerCapture(session.pointerId)) {
      session.target.releasePointerCapture(session.pointerId)
    }
    resizeSessionRef.current = null
    if (session) {
      onResizingChange(false)
      setResizing(false)
    }
    if (bodyStyleRef.current) {
      document.body.style.cursor = bodyStyleRef.current.cursor
      document.body.style.userSelect = bodyStyleRef.current.userSelect
      bodyStyleRef.current = null
    }
  }, [onResizingChange])

  useEffect(() => finishResize, [finishResize])

  useEffect(() => {
    if (effectiveCollapsed) finishResize()
  }, [effectiveCollapsed, finishResize])

  useEffect(() => finishResize(), [activeToolId, finishResize])

  useEffect(() => {
    void loadExperimental()
  }, [loadExperimental])

  // Close disabled tools as well as hiding them so re-enabling starts closed.
  useEffect(() => {
    for (const toolId of storedOpenToolIds) {
      if (!isRightToolEnabled(toolId, { persona: personaEnabled, knowledge: knowledgeEnabled })) closeTool(toolId)
    }
  }, [personaEnabled, knowledgeEnabled, storedOpenToolIds, closeTool, extensionViews])

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    finishResize()
    resizeSessionRef.current = {
      pointerId: event.pointerId,
      target: event.currentTarget,
      startX: event.clientX,
      startWidth: renderedPanelWidth,
    }
    bodyStyleRef.current = {
      cursor: document.body.style.cursor,
      userSelect: document.body.style.userSelect,
    }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    event.currentTarget.setPointerCapture(event.pointerId)
    onResizingChange(true)
    setResizing(true)
    event.preventDefault()
  }

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const session = resizeSessionRef.current
    if (!session || session.pointerId !== event.pointerId) return
    setPanelWidth(clampRightToolPanelWidth(session.startWidth + session.startX - event.clientX, maximum, activeToolId), activeToolId)
  }

  const handlePointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    if (resizeSessionRef.current?.pointerId === event.pointerId) finishResize()
  }

  const handleResizeKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const widths: Partial<Record<string, number>> = {
      ArrowLeft: renderedPanelWidth + 16,
      ArrowRight: renderedPanelWidth - 16,
      Home: minimum,
      End: maximum,
    }
    const width = widths[event.key]
    if (width === undefined) return
    setPanelWidth(clampRightToolPanelWidth(width, maximum, activeToolId), activeToolId)
    event.preventDefault()
  }

  const handleRailTool = (toolId: RightToolId) => {
    cancelPreviewTimer()
    if (forcedCollapsed) {
      setPreviewToolId(previewId === toolId ? null : toolId)
      return
    }
    setPreviewToolId(null)
    toggleFromRail(toolId)
  }

  return (
    <aside ref={dockRef} className={styles.dock} data-collapsed={railOnly} data-preview={motion.rendered}
      onKeyDown={(event) => {
        const toolId = (event.target as HTMLElement).closest<HTMLElement>('[data-rail-tool]')?.dataset.railTool as RightToolId | undefined
        if (event.key !== 'ArrowLeft' || !toolId) return
        event.preventDefault()
        cancelPreviewTimer()
        if (contentVisible) {
          dockRef.current?.querySelector<HTMLElement>('#right-tool-panel section:not([hidden]) input, #right-tool-panel section:not([hidden]) button')?.focus()
        } else {
          if (previewId === toolId) {
            dockRef.current?.querySelector<HTMLElement>('#right-tool-panel section:not([hidden]) input, #right-tool-panel section:not([hidden]) button')?.focus()
            return
          }
          focusPreviewRef.current = true
          setPreviewToolId(toolId)
        }
      }}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) scheduleDismiss() }} aria-label={t('common:rightDock.dockAria')}>
      <div
        className={styles.panel}
        id="right-tool-panel"
        style={{ '--right-tool-content-width': `${renderedPanelWidth}px` } as CSSProperties}
        data-visible={motion.visible}
        data-preview={lastTransientRef.current}
        data-transient={lastTransientRef.current}
        onPointerEnter={cancelPreviewTimer}
        onPointerLeave={scheduleDismiss}
        data-resizing={resizing}
        aria-hidden={!panelVisible}
        {...(!panelVisible ? { inert: '' } : {})}
        data-testid="right-tool-panel-shell"
      >
          <div
            className={styles.resizeHandle}
            data-resizing={resizing}
            role="separator"
            aria-label={t('common:rightDock.resizeAria')}
            aria-orientation="vertical"
            aria-valuemin={minimum}
            aria-valuemax={Math.round(maximum)}
            aria-valuenow={Math.round(renderedPanelWidth)}
            tabIndex={previewId ? -1 : 0}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerEnd}
            onPointerCancel={handlePointerEnd}
            onLostPointerCapture={handlePointerEnd}
            onKeyDown={handleResizeKeyDown}
          />
          <RightToolHost
            openToolIds={hostToolIds}
            activeToolId={displayedToolId}
            workspaceId={activeWorkspaceId}
            workspacePath={workspacePath}
            dockVisible={motion.rendered}
            onClose={(id) => { dismissPreview(); closeTool(id) }}
          />
      </div>
      <RightToolRail
        openToolIds={openToolIds}
        activeToolId={activeToolId}
        onToggleTool={handleRailTool}
        collapsed={railOnly}
        forcedCollapsed={forcedCollapsed}
        previewToolId={previewId}
        onPreview={schedulePreview}
        onPreviewLeave={scheduleDismiss}
      />
    </aside>
  )
}
