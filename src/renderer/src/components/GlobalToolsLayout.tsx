// Note: .agents/notes/workbench/global-tool-layout.md - shared geometry and responsive collapse.
import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { PanelRightOpen } from 'lucide-react'
import { useGlobalToolsStore } from '@/stores/global-tools'
import { useBrowserOcclusion } from '@/hooks/useBrowserOcclusion'
import { useI18n } from '@/i18n/useI18n'
import type { WorkspacePaneNode } from '@/lib/workspace-pane'
import { useReducedMotion } from './shared/CardFrame'
import styles from './GlobalToolsLayout.module.css'
import { projectMinimumWidth, PANEL_RESTORE_MARGIN } from '@/lib/auxiliary-layout'
import { useAuxiliaryPanelsStore } from '@/stores/auxiliary-panels'

const TOOLS_MOTION_MS = 240

/** The two region containers keep their identity when a project or responsive mode changes. */
export function GlobalToolsLayout({ hasProject, projectTree, project, tools, externalControls = false }: {
  hasProject: boolean
  projectTree: WorkspacePaneNode | null
  project: (visible: boolean) => ReactNode
  tools: (visible: boolean) => ReactNode
  externalControls?: boolean
}) {
  const { t } = useI18n('common')
  const paneTree = useGlobalToolsStore((s) => s.paneTree)
  const collapsed = useGlobalToolsStore((s) => s.collapsed)
  const ratio = useGlobalToolsStore((s) => s.projectRatio)
  const setCollapsed = useGlobalToolsStore((s) => s.setCollapsed)
  const setRatio = useGlobalToolsStore((s) => s.setProjectRatio)
  const root = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [resizing, setResizing] = useState(false)
  const [moving, setMoving] = useState(false)
  const reducedMotion = useReducedMotion()
  useBrowserOcclusion(resizing || moving)
  const minimum = projectMinimumWidth(projectTree)
  const available = Math.max(1, width - 9)
  const [compact, setCompact] = useState(false)
  useLayoutEffect(() => {
    setCompact(previous => hasProject && width > 0 && available < minimum + 320 + (previous ? PANEL_RESTORE_MARGIN : -0.5))
  }, [hasProject, width, available, minimum])
  useLayoutEffect(() => {
    if (externalControls) useAuxiliaryPanelsStore.setState({ toolsCompact: compact })
  }, [compact, externalControls])
  // Constrain presentation only; restore the preferred ratio when space returns.
  const requiredRatio = minimum / available
  const allowedRatio = 1 - 320 / available
  const effectiveRatio = width > 0 ? Math.max(0, Math.min(1, Math.max(requiredRatio, Math.min(allowedRatio, ratio)))) : ratio
  // Match stored drag limits, while including a responsive ratio outside those limits.
  const minRatio = Math.min(effectiveRatio, Math.max(0.2, requiredRatio))
  const maxRatio = Math.max(effectiveRatio, Math.min(0.8, allowedRatio))
  useLayoutEffect(() => {
    const element = root.current
    if (!element) return
    const observer = new ResizeObserver(() => setWidth(element.clientWidth))
    observer.observe(element)
    setWidth(element.clientWidth)
    return () => observer.disconnect()
  }, [])
  const toolsVisible = !!paneTree && !collapsed && !compact
  const projectVisible = hasProject
  useLayoutEffect(() => {
    if (!toolsVisible) useGlobalToolsStore.getState().setFocused(false)
  }, [toolsVisible])
  // Motion bookkeeping must not rerender the terminal/editor trees.
  const projectContent = useMemo(() => project(projectVisible), [project, projectVisible])
  const toolsContent = useMemo(() => tools(toolsVisible), [tools, toolsVisible])
  const divided = hasProject && toolsVisible && !compact
  const railVisible = !!paneTree && !toolsVisible && !externalControls
  // The outer right dock also moves native guest bounds, even when tools stay open.
  const presentation = `${toolsVisible}:${projectVisible}:${width}:${effectiveRatio}`
  const previousPresentation = useRef(presentation)
  useLayoutEffect(() => {
    if (reducedMotion) {
      previousPresentation.current = presentation
      setMoving(false)
      return
    }
    if (previousPresentation.current === presentation) return
    previousPresentation.current = presentation
    setMoving(true)
    const timer = setTimeout(() => setMoving(false), TOOLS_MOTION_MS)
    return () => clearTimeout(timer)
  }, [presentation, reducedMotion])
  const resize = (next: number) => setRatio(Math.max(minRatio, Math.min(maxRatio, next)))
  return (
    <div ref={root} className={styles.layout} data-global-tools-layout="" data-compact={compact}
      data-resizing={resizing} data-moving={moving}
      style={{ '--tools-motion': `${TOOLS_MOTION_MS}ms`,
        gridTemplateColumns: `minmax(0, ${projectVisible ? divided ? effectiveRatio : 1 : 0}fr) ${divided ? 9 : 0}px minmax(0, ${toolsVisible ? divided ? 1 - effectiveRatio : 1 : 0}fr) ${railVisible ? 29 : 0}px`,
      } as CSSProperties}>
      <div className={styles.project} data-pane-region="project"
        data-visible={projectVisible}
        aria-hidden={!projectVisible} {...(!projectVisible ? { inert: '' } : {})}>
        <div className={styles.regionContent}>{projectContent}</div>
      </div>
      <div role="separator" tabIndex={divided ? 0 : -1} className={styles.divider}
        data-visible={divided} data-open={toolsVisible} aria-hidden={!divided} {...(!divided ? { inert: '' } : {})}
        onFocus={() => useGlobalToolsStore.getState().setFocused(true)}
        aria-label={t('common:toolGroup.resizeRegions')} aria-orientation="vertical"
        aria-valuemin={Math.round(minRatio * 100)} aria-valuemax={Math.round(maxRatio * 100)} aria-valuenow={Math.round(effectiveRatio * 100)}
        onPointerDown={(event) => {
          if (event.button !== 0) return
          event.preventDefault()
          event.currentTarget.focus()
          event.currentTarget.setPointerCapture(event.pointerId)
          setResizing(true)
        }}
        onPointerMove={(event) => {
          if (!event.currentTarget.hasPointerCapture(event.pointerId) || !root.current) return
          resize((event.clientX - root.current.getBoundingClientRect().left - 4.5) / available)
        }}
        onPointerUp={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
          setResizing(false)
        }}
        onPointerCancel={() => setResizing(false)} onLostPointerCapture={() => setResizing(false)}
        onDoubleClick={() => resize(0.62)}
        onKeyDown={(event) => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
          event.preventDefault()
          event.stopPropagation()
          resize(event.key === 'Home' ? minRatio : event.key === 'End' ? maxRatio : effectiveRatio + (event.key === 'ArrowLeft' ? -0.05 : 0.05))
        }} />
      <div className={styles.tools} data-pane-region="tools" data-visible={toolsVisible}
        aria-hidden={!toolsVisible} {...(!toolsVisible ? { inert: '' } : {})}
        onPointerDownCapture={() => {
          if (externalControls) useAuxiliaryPanelsStore.getState().activate('tools')
          useGlobalToolsStore.getState().setFocused(true)
        }}>
        <div className={styles.regionContent}>{toolsContent}</div>
      </div>
      {!externalControls && <div className={styles.rail} data-visible={railVisible} aria-hidden={!railVisible} {...(!railVisible ? { inert: '' } : {})}><button type="button" className={styles.toggle} data-tools-toggle=""
        aria-label={t('common:toolGroup.expandTools')} title={t(compact ? 'common:toolGroup.toolsNeedSpace' : 'common:toolGroup.expandTools')} disabled={compact}
        aria-expanded={false} onClick={() => setCollapsed(false)}>
        <PanelRightOpen size={14} />
      </button></div>}
    </div>
  )
}
