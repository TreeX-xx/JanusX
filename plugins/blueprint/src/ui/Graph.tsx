import { blueprintText as bt } from './blueprint-text'
import { BlueprintNodeCard, BlueprintCardActionsContext, BlueprintCardReviewContext } from './BlueprintNodeCard'
import { BlueprintBrowserBar } from './BlueprintBrowserBar'
import { BlueprintAdaptiveEdge } from './BlueprintAdaptiveEdge'
import { BlueprintHierarchyEdge } from './BlueprintHierarchyEdge'
import { getBlueprintStatusVisual, NOTE_KIND_LABEL_KEY } from './blueprintStatus'
import './blueprint.css'
import './blueprint-refinement.css'
import './module-browsing.css'
import './module-groups.css'
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import {
  ReactFlow,
  Background,
  MiniMap,
  ViewportPortal,
  applyNodeChanges,
  type Node,
  type ReactFlowInstance,
} from '@xyflow/react'
import type { Blueprint } from '../shared/janus/types'
import type { BlueprintNodeData } from '../shared/card'
import { deriveBlueprintFlow } from './graph/canvas-layout'
import { projectArchitecture } from './graph/architecture-view'
import { moduleTrail, projectModuleBrowse, UNASSIGNED_SCOPE } from './graph/module-browsing'
import type { GraphViewport, NavigationEntry } from './graph/navigation-history'
import '@xyflow/react/dist/style.css'

const nodeTypes = { blueprint: BlueprintNodeCard }
const edgeTypes = { blueprintAdaptive: BlueprintAdaptiveEdge, blueprintHierarchy: BlueprintHierarchyEdge }

export function Graph({
  blueprint,
  navigation,
  navigationKey,
  select,
  save,
  enter,
  remember,
  suggestions,
  openSuggestions = select,
  query,
  matches,
  back,
  canGoBack = false,
  fitRef,
  reviews,
}: {
  blueprint: Blueprint
  navigation: NavigationEntry
  navigationKey: number
  select(id: string): void
  save(patch: { canvasLayout?: Blueprint['canvasLayout']; collapsedNodeIds?: string[] | null }): void
  enter(scopeId: string | null, nodeId: string | null): void
  remember(viewport: GraphViewport): void
  suggestions: Record<string, number>
  openSuggestions?(id: string): void
  query: string
  matches?: string[]
  back?: () => void
  canGoBack?: boolean
  fitRef?: { current: (() => void) | null }
  reviews?: Record<string, { suggestions: number; unread?: boolean; awaitingReview?: boolean }>
}) {
  const scope = navigation.scopeId
  const currentNavigation = useRef(navigation)
  currentNavigation.current = navigation
  const container = useRef<HTMLDivElement>(null),
    canvas = useRef<ReactFlowInstance<Node<BlueprintNodeData>>>()
  const firstClick = useRef<{ id: string; x: number; y: number; time: number }>()
  const [contextMenu, setContextMenu] = useState<{ nodeId: string; x: number; y: number }>()
  const [theme, setTheme] = useState(document.documentElement.dataset.theme)
  const planche = theme === 'planche'
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(document.documentElement.dataset.theme))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    if (!contextMenu) return
    const dismiss = () => setContextMenu(undefined)
    window.addEventListener('click', dismiss); window.addEventListener('contextmenu', dismiss); window.addEventListener('resize', dismiss)
    return () => { window.removeEventListener('click', dismiss); window.removeEventListener('contextmenu', dismiss); window.removeEventListener('resize', dismiss) }
  }, [contextMenu])
  const projection = useMemo(() => projectArchitecture(blueprint), [blueprint])
  const browse = useMemo(() => projectModuleBrowse(blueprint, projection, scope), [blueprint, projection, scope])
  const source = browse.graph
  const modules = useMemo(() => new Set(projection.graph.nodeIds), [projection])
  useEffect(() => {
    if (!fitRef) return
    fitRef.current = () => { void canvas.current?.fitView({ padding: 0.2, maxZoom: modules.size ? 1 : 4, duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 200 }) }
    return () => { fitRef.current = null }
  }, [fitRef, modules.size])
  const collapsed = useMemo(() => new Set(modules.size ? [] : blueprint.collapsedNodeIds ?? []), [modules, blueprint.collapsedNodeIds])
  const flow = useMemo(
    () => {
      const result = deriveBlueprintFlow(
        source,
        undefined,
        {},
        new Set(matches ?? source.nodeIds.filter((id) => source.nodes[id]?.title.toLowerCase().includes(query.toLowerCase()))),
        Boolean(query || matches && matches.length !== blueprint.nodeIds.length),
        collapsed,
      )
      // Same entry classes stay on existing DOM during refresh/selection. A new
      // module mounts its nodes together; CSS reveals them in the original order.
      return {
        nodes: result.nodes.map((node, index) => ({ ...node, className: `bp-flow-node--enter bp-flow-node--enter-${Math.min(index, 8)}`,
          style: { ...node.style, '--bp-entry-index': Math.min(index, 8) } as CSSProperties })),
        edges: result.edges.map(edge => ({ ...edge, className: `${edge.className ?? ''} bp-flow-edge--enter`,
          style: { ...edge.style, '--bp-edge-entry-index': Math.min(Math.max(0, result.nodes.findIndex(node => node.id === edge.target)), 8) } as CSSProperties })),
      }
    },
    [source, collapsed, query, matches, blueprint.nodeIds.length],
  )
  const [nodes, setNodes] = useState<Node<BlueprintNodeData>[]>(flow.nodes)
  useEffect(() => setNodes(current => {
    const measured = new Map(current.map(node => [node.id, node.measured]))
    // DTO refreshes must retain measured sizes: an unchanged DOM box may not
    // emit another resize after the native page is covered by Settings.
    return flow.nodes.map(node => ({ ...node, measured: measured.get(node.id) }))
  }), [flow.nodes])
  const visibleIds = flow.nodes.map((node) => node.id).join('|')
  useEffect(() => {
    if (!container.current) return
    let timer: ReturnType<typeof setTimeout>, frame = 0
    let width = container.current.clientWidth, height = container.current.clientHeight
    const settle = (restore: boolean) => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        let attempts = 0
        const fit = () => {
          const instance = canvas.current
          if (!instance || !container.current?.clientWidth || !container.current.clientHeight || instance.getNodes().some(node => !node.measured?.width)) {
            if (++attempts < 12) frame = requestAnimationFrame(fit)
            return
          }
          const viewport = restore ? currentNavigation.current.viewport : undefined
          if (viewport) void instance.setViewport(viewport)
          else void instance.fitView({ padding: 0.2, maxZoom: modules.size ? 1 : 4 })
        }
        frame = requestAnimationFrame(() => { frame = requestAnimationFrame(fit) })
      }, 220)
    }
    const observer = new ResizeObserver(() => {
      const next = container.current
      if (!next || next.clientWidth === width && next.clientHeight === height) return
      width = next.clientWidth; height = next.clientHeight
      // A side card changes the available canvas. Refit after its transition,
      // rather than reapplying coordinates captured for the wider canvas.
      settle(false)
    })
    observer.observe(container.current)
    const viewport = currentNavigation.current.viewport, actual = canvas.current?.getViewport()
    // Selecting another card in the same view already carries this viewport.
    // Replaying fit here can overwrite the user's next wheel/pan gesture.
    if (!viewport || !actual || Math.abs(viewport.x - actual.x) > 0.01 || Math.abs(viewport.y - actual.y) > 0.01 || Math.abs(viewport.zoom - actual.zoom) > 0.0001) settle(true)
    return () => {
      observer.disconnect()
      clearTimeout(timer)
      cancelAnimationFrame(frame)
    }
  }, [scope, navigationKey, visibleIds, ready, modules.size])

  const activate = (id: string) => {
    if (projection.roles[id]) enter(id, id)
    else select(id)
  }

  return (
    <BlueprintCardReviewContext.Provider value={reviews ?? Object.fromEntries(Object.entries(suggestions).map(([id, count]) => [id, { suggestions: count }]))}><BlueprintCardActionsContext.Provider
      value={{ moduleBrowsing: modules.size > 0, architectureRoles: projection.roles, moduleDocuments: browse.owned, moduleChildren: projection.graph.nodes, openModule: id => enter(id, id), showSuggestions: openSuggestions, toggleCollapse: (id) => {
        const next = new Set(collapsed)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        save({ collapsedNodeIds: [...next] })
      } }}
    >
      <div className="graph blueprint-canvas-wrapper">
        <div className="blueprint-canvas-main">
        <BlueprintBrowserBar source={blueprint} trail={moduleTrail(projection, scope === UNASSIGNED_SCOPE ? browse.homeModuleId : browse.scopeId)}
          showOverview={!browse.homeModuleId} canGoBack={canGoBack} onBack={() => back?.()} onScope={id => enter(id, id ?? blueprint.rootNodeId)}
          searching={Boolean(query) || Boolean(matches && matches.length !== blueprint.nodeIds.length)} matches={matches ?? []}
          unassigned={browse.unassigned} onReveal={select} hasModules={modules.size > 0} />
        <div ref={container} style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        {modules.size > 0 && browse.scopeId && source.nodeIds.length === 1 && <p className="bp-browser-empty">{bt('browse.emptyModule')}</p>}
        <ReactFlow<Node<BlueprintNodeData>>
          nodes={nodes.map((node) => ({ ...node, selected: node.id === navigation.nodeId }))}
          edges={flow.edges}
          edgeTypes={edgeTypes}
          nodeTypes={nodeTypes}
          onInit={(value) => {
            canvas.current = value
            setReady(true)
          }}
          onNodesChange={(changes) => setNodes((current) => applyNodeChanges(changes, current))}
          onNodeClick={(event, node) => {
            if (event.detail === 2 && firstClick.current) return
            firstClick.current = { id: node.id, x: event.clientX, y: event.clientY, time: event.timeStamp }
            select(node.id)
          }}
          onDoubleClickCapture={event => {
            const first = firstClick.current
            firstClick.current = undefined
            if (!first || event.timeStamp - first.time >= 1000 || Math.hypot(event.clientX - first.x, event.clientY - first.y) >= 8) return
            event.preventDefault(); event.stopPropagation(); activate(first.id)
          }}
          onMove={event => { if (event) firstClick.current = undefined }}
          onNodeDragStart={() => { firstClick.current = undefined }}
          onMoveEnd={(_event, viewport) => remember(viewport)}
          onNodeDragStop={(_event, node) => save({ canvasLayout: { ...blueprint.canvasLayout, [node.id]: node.position } })}
          onNodeDoubleClick={(_event, node) => activate(node.id)}
          onNodeContextMenu={(event, node) => {
            event.preventDefault()
            event.stopPropagation()
            setContextMenu({ nodeId: node.id, x: Math.max(8, Math.min(event.clientX, innerWidth - 190)), y: Math.max(8, Math.min(event.clientY, innerHeight - 60)) })
          }}
          nodesDraggable={!modules.size}
          nodesConnectable={false}
          zoomOnDoubleClick={false}
          deleteKeyCode={null}
          proOptions={{ hideAttribution: true }}
          style={{ background: 'transparent' }}
          defaultViewport={navigation.viewport}
          colorMode={planche ? 'light' : 'dark'}
          minZoom={0.05}
          maxZoom={4}
          onlyRenderVisibleElements
          key={scope ?? 'home'}
        >
          <ViewportPortal>{browse.groups.map(group => <div key={group.id} className="bp-module-document-group" data-module-id={group.moduleId} data-kind={group.kind}
            style={{ left: group.x, top: group.y, width: group.width, height: group.height }}><span>{bt(NOTE_KIND_LABEL_KEY[group.kind] ?? group.kind)}</span></div>)}</ViewportPortal>
          <Background color={planche ? 'rgba(28,52,59,0.16)' : 'rgba(255,255,255,0.05)'} gap={24} />
          {!modules.size && nodes.length <= 250 && <MiniMap pannable zoomable
            nodeColor={node => node.data.noteId ? planche ? 'rgba(28,52,59,0.45)' : '#555' : getBlueprintStatusVisual(node.data.status as BlueprintNodeData['status']).color}
            style={{ background: planche ? '#DCCFA8' : 'rgba(12,12,12,0.9)' }} />}
        </ReactFlow>
        <div className="bp-canvas-legend" aria-hidden="true">
          <span><i className="ld" style={{ background: 'var(--shell-accent, #b98736)' }} />{bt('review.pendingLegend')}</span>
          {(!modules.size && Object.values(blueprint.nodes).some(node => !node.note && !node.sourceUri) ? ['planning', 'in-progress', 'done', 'archived'] as const : []).map(status => <span key={status}><i className="ld" style={{ background: getBlueprintStatusVisual(status).color }} />{bt(getBlueprintStatusVisual(status).labelKey)}</span>)}
          <span><i style={{ color: 'var(--shell-muted)' }}>━</i>{bt('legend.parent')}</span>
          {!modules.size && [{ type: 'dependsOn', dash: '5 4' }, { type: 'implements', dash: '2 3' }, { type: 'relatedTo', dash: '5 5' }].map(relation => <span key={relation.type}><svg width="18" height="6"><line x1="0" y1="3" x2="18" y2="3" strokeWidth="1.5" strokeDasharray={relation.dash} style={{ stroke: 'var(--shell-muted)' }} /></svg>{bt('maintenance.relationType.' + relation.type)}</span>)}
        </div>
        </div>
        </div>
        {contextMenu && <div className="bp-context-menu" style={{ left: contextMenu.x, top: contextMenu.y }} onClick={event => event.stopPropagation()} onContextMenu={event => event.preventDefault()} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setContextMenu(undefined) } }}>
          <button type="button" className="bp-context-menu__item" autoFocus onClick={() => { select(contextMenu.nodeId); setContextMenu(undefined) }}>{bt('contextMenu.nodeDetail')}</button>
        </div>}
      </div>
    </BlueprintCardActionsContext.Provider></BlueprintCardReviewContext.Provider>
  )
}
