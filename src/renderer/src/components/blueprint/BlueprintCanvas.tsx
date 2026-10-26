/**
 * @file 蓝图画布（React Flow）— MVP
 * @description
 *  - 从 store 加载蓝图，把 Blueprint.nodes（Record）转成 React Flow nodes + edges。
 *  - 树形布局：根居中、子节点向下展开（简单递归，无 dagre）。
 *  - 交互：拖拽 / 选中 / 双击（onNodeOpen 回调）/ 右键菜单（工作会话 / 终端 / 状态标记，只读）。
 *  - 工具栏：分析选中节点 / 适应画布；新建、删除入口已移除（V2 只读，变更走对话）。
 *  - 详情面板：只读预览 + 终端快捷；内容变更走对话 + Agent 事务。
 *  - canvasLayout：拖拽后防抖写回 Blueprint.canvasLayout。
 */

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  ReactFlow,
  Background,
  MiniMap,
  ViewportPortal,
  type Node,
  type Edge,
  type ReactFlowInstance,
  type NodeMouseHandler
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { X } from 'lucide-react'

import { useBlueprintStore } from '@/stores/blueprint'
import { useWorkspaceStore } from '@/stores/workspace'
import {
  updateBlueprint as updateBlueprintIPC,
  type BlueprintFeatureItem,
  type BlueprintIssueSeverity,
  type BlueprintIssueStatus
} from '@/services/blueprint'
import { BlueprintNodeCard, BlueprintCardActionsContext, type BlueprintNodeData } from './BlueprintNodeCard'
import { BlueprintAdaptiveEdge } from './BlueprintAdaptiveEdge'
import { BlueprintHierarchyEdge } from './BlueprintHierarchyEdge'
import { blueprintStatusOptions, NOTE_KINDS, NOTE_KIND_LABEL_KEY, noteKindOf, getBlueprintStatusVisual } from './blueprintStatus'
import { useThemeStore } from '@/stores/theme'
import { useOptionalBlueprintToolbar, type ToolbarKindFilter, type ToolbarStatusFilter, useHideIsolatedState } from './BlueprintToolbar'
import { PromptDialog } from './PromptDialog'
import { Select } from '../ui/Select'
import { useBlueprintSelectPortal } from './blueprintSelectPortal'
import { useBlueprintDetailPortal } from './blueprintDetailPortal'
import { useAnimatedOpen } from '@/components/shared/CardFrame'
import { useBlueprintAnalysisActions } from '@/features/blueprint/useBlueprintAnalysisActions'
import { useBlueprintGraphController } from '@/features/blueprint/useBlueprintGraphController'
import { useNoteCanvasFocus } from '@/features/blueprint/useNoteCanvasFocus'
import { useNoteFocusStore } from '@/stores/note-focus'
import type { NoteFocusAction } from '../../../../shared/note-chat'
import type { BlueprintLayoutSaveStatus } from '@/features/blueprint/useBlueprintGraphController'
import { collectLocalHierarchyIds, computeInitialCollapsedIds, groupRootsByConnectivity, stepMatchIndex, visibleNodeIds } from '@/features/blueprint/canvas-navigation'
import { buildNodeSearchText, nodeMatchesFocus, normalizeSearchText } from '@/features/blueprint/blueprint-focus'
import { useI18n } from '@/i18n/useI18n'
import { NoteWikiPanel } from './NoteWikiPanel'
import { useBlueprintNavigation } from '@/stores/blueprint-navigation'
import { markNoteRead, useBlueprintReviewStore } from '@/stores/blueprint-review'
import { useBlueprintActivityStore } from '@/stores/blueprint-review-activity'
import { attentionNode } from '@/features/blueprint/attention-model'
import { useNoteNavigationMotion, type NoteVisit } from '@/features/blueprint/useNoteNavigationMotion'
import type { BlueprintNoteDestination, NoteVersion } from '../../../../../plugins/blueprint/src/shared/blueprint-attention'
import { BlueprintCompositionPanel } from './BlueprintCompositionPanel'
import { projectArchitecture } from '@/features/blueprint/architecture-view'
import { projectModuleBrowse, moduleTrail } from '@/features/blueprint/module-browsing'
import { BlueprintBrowserBar } from './BlueprintBrowserBar'
import './module-browsing.css'
import './module-groups.css'
import { BlueprintArchitecturePanel } from './BlueprintArchitecturePanel'
import { BlueprintSourceInfo } from './BlueprintSourceInfo'
import { nodeNoteSnapshot, resolveCompositionNote } from '@/features/blueprint/composition-view'

const EMPTY_NODE_IDS: ReadonlySet<string> = new Set()
const ANALYSIS_COMMIT_LIMIT_MIN = 1
const ANALYSIS_COMMIT_LIMIT_MAX = 50
const NODE_W = 240
const NODE_H = 110
type StatusFilter = ToolbarStatusFilter
type KindFilter = ToolbarKindFilter
const ISSUE_SEVERITY_LABEL_KEY: Record<BlueprintIssueSeverity, string> = {
  low: 'blueprint:issueSeverity.low',
  medium: 'blueprint:issueSeverity.medium',
  high: 'blueprint:issueSeverity.high',
  critical: 'blueprint:issueSeverity.critical'
}
const ISSUE_STATUS_LABEL_KEY: Record<BlueprintIssueStatus, string> = {
  open: 'blueprint:issueStatus.open',
  resolved: 'blueprint:issueStatus.resolved',
  wontfix: 'blueprint:issueStatus.wontfix'
}
const FEATURE_STATUS_LABEL_KEY: Record<BlueprintFeatureItem['status'], string> = {
  planned: 'blueprint:featureStatus.planned',
  'in-progress': 'blueprint:featureStatus.inProgress',
  done: 'blueprint:featureStatus.done',
  blocked: 'blueprint:featureStatus.blocked'
}

const TRIGGER_LABEL_KEY: Record<string, string> = {
  'commit-threshold': 'blueprint:trigger.commitThreshold',
  manual: 'blueprint:trigger.manual',
  'terminal-close': 'blueprint:trigger.terminalClose',
  reconcile: 'blueprint:trigger.reconcile'
}

function splitLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}

/* Context menu */
interface ContextMenu {
  x: number
  y: number
  nodeId: string
}

/* Component */
export interface BlueprintCanvasProps {
  blueprintId: string
  /** 双击节点回调（P3 节点详情入口），MVP 可不传 */
  onNodeOpen?: (nodeId: string) => void
  onDetailOpenChange?: (open: boolean) => void
  onRegisterFlush?: (flush: () => Promise<boolean>) => void
}

function BlueprintDetailMount({ target, children }: { target: HTMLDivElement | null; children: ReactNode }) {
  return target ? createPortal(children, target) : children
}

export function BlueprintCanvas({ blueprintId, onNodeOpen, onDetailOpenChange, onRegisterFlush }: BlueprintCanvasProps) {
  const { t } = useI18n('blueprint')
  const sourceBlueprint = useBlueprintStore((s) => s.currentBlueprint)
  const architecture = useMemo(() => sourceBlueprint ? projectArchitecture(sourceBlueprint) : null, [sourceBlueprint])
  const [requestedScopeId, setScopeId] = useState<string | null>(null)
  const moduleBrowse = useMemo(() => sourceBlueprint && architecture ? projectModuleBrowse(sourceBlueprint, architecture, requestedScopeId) : null, [sourceBlueprint, architecture, requestedScopeId])
  const scopeId = moduleBrowse?.scopeId ?? null
  const homeModuleId = moduleBrowse?.homeModuleId ?? null
  const loading = useBlueprintStore((s) => s.loading)
  const error = useBlueprintStore((s) => s.error)
  const loadBlueprint = useBlueprintStore((s) => s.loadBlueprint)
  const mergeCanvasLayout = useBlueprintStore((s) => s.mergeCanvasLayout)
  const workspaces = useWorkspaceStore((s) => s.workspaces)
  const plancheCanvas = useThemeStore((s) => s.theme) === 'planche'

  // 工作台开启时由 BlueprintWorkbench 通过 Context 注入专属承载层节点；
  // embedded 模式下为 null，Select 回退到 document.body，行为不变。
  const selectPortal = useBlueprintSelectPortal()
  const getSelectPortalContainer = selectPortal ? () => selectPortal : undefined
  const detailPortal = useBlueprintDetailPortal()

  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const firstNodeClick = useRef<{ id: string; x: number; y: number; time: number } | null>(null)
  const [detailNodeId, setDetailNodeId] = useState<string | null>(null)
  const [wikiAnchor, setWikiAnchor] = useState<{ uri: string; value?: string } | null>(null)
  const [noteVisit, setNoteVisit] = useState<NoteVisit | null>(null)
  const visitCounter = useRef(0)
  const [sourceReady, setSourceReady] = useState<number | null>(null)
  const readyVersion = useRef<NoteVersion | null>(null)
  const acknowledgedVisit = useRef(0)
  const detailElement = useRef<HTMLDivElement | null>(null)
  const detailScrollRestore = useRef<{ top: number; open: string[]; collapsed: string[]; reviewExpanded: boolean } | null>(null)
  const [toolbarExpanded, setToolbarExpanded] = useState(false)
  // 统一顶栏（workbench）存在时过滤走 provider 受控；embedded 无 provider 时走本地态。
  const toolbarState = useOptionalBlueprintToolbar()
  const moduleBrowsing = !!architecture?.graph.nodeIds.length
  const currentBlueprint = moduleBrowse?.graph ?? sourceBlueprint
  const viewKey = blueprintId + ':' + (scopeId ?? 'overview')
  const [innerSearchQuery, setInnerSearchQuery] = useState('')
  const [innerStatusFilter, setInnerStatusFilter] = useState<StatusFilter>('all')
  const [innerKindFilter, setInnerKindFilter] = useState<KindFilter>('all')
  const searchQuery = toolbarState?.searchQuery ?? innerSearchQuery
  const setSearchQuery = toolbarState?.setSearchQuery ?? setInnerSearchQuery
  const statusFilter = toolbarState?.statusFilter ?? innerStatusFilter
  const setStatusFilter = toolbarState?.setStatusFilter ?? setInnerStatusFilter
  const kindFilter = toolbarState?.kindFilter ?? innerKindFilter
  const setKindFilter = toolbarState?.setKindFilter ?? setInnerKindFilter
  // 孤立折叠与搜索/过滤同源：provider 受控优先，embedded 走本地同逻辑 hook。
  const [innerHideIsolated, setInnerHideIsolated, innerIsolatedCount] = useHideIsolatedState(currentBlueprint)
  const hideIsolated = toolbarState?.hideIsolated ?? innerHideIsolated
  const setHideIsolated = toolbarState?.setHideIsolated ?? setInnerHideIsolated
  const isolatedCount = toolbarState?.isolatedCount ?? innerIsolatedCount
  const [localFocusActive, setLocalFocusActive] = useState(false)
  const [descendantDepth, setDescendantDepth] = useState(2)
  const [collapsedNodeIds, setCollapsedNodeIds] = useState<Set<string>>(() => new Set())
  const [matchIndex, setMatchIndex] = useState(0)
  const [actionError, setActionError] = useState<string | null>(null)
  const [layoutSaveStatus, setLayoutSaveStatus] = useState<BlueprintLayoutSaveStatus>('clean')
  const {
    analyzing,
    analysisCommitLimit,
    setAnalysisCommitLimit,
    analysisHistoryOpen,
    analysisHistory,
    selectedAnalysisId,
    setSelectedAnalysisId,
    analysisHistoryLoading,
    applyingAnalysisId,
    loadAnalysisHistory,
    toggleAnalysisHistory,
    reapplyAnalysis,
    analyzeSelected,
    normalizeAnalysisCommitLimit,
  } = useBlueprintAnalysisActions({ blueprintId, selectedId, detailNodeId, setActionError })
  const [restoreLayoutConfirmOpen, setRestoreLayoutConfirmOpen] = useState(false)

  const rfInstanceRef = useRef<ReactFlowInstance<Node<BlueprintNodeData, 'blueprint'>, Edge> | null>(null)
  const canvasMainRef = useRef<HTMLDivElement | null>(null)
  const fitFrameRef = useRef<number | null>(null)
  const initialFitBlueprintRef = useRef<string | null>(null)
  const detailOpenRef = useRef<boolean | null>(null)
  type BrowseLocation = { scopeId: string | null; selectedId: string | null; detailNodeId: string | null; wikiAnchor: typeof wikiAnchor; viewport: { x: number; y: number; zoom: number } | null;
    searchQuery: string; statusFilter: StatusFilter; kindFilter: KindFilter; hideIsolated: boolean; reading: { top: number; open: string[]; collapsed: string[]; reviewExpanded: boolean } }
  const history = useRef<BrowseLocation[]>([])
  const [historyLength, setHistoryLength] = useState(0)
  const pendingViewport = useRef<BrowseLocation['viewport']>(null)
  const pendingCenter = useRef<string | null>(null)
  const collapseInitRef = useRef<string | null>(null)
  const detailInitRef = useRef<string | null>(null)
  const navigationMotion = useNoteNavigationMotion(noteVisit, viewKey, rfInstanceRef, canvasMainRef, sourceReady)

  const workspaceNameById = useMemo(
    () => Object.fromEntries(workspaces.map((w) => [w.id, w.name])),
    [workspaces]
  )
  const activeDetailNode = sourceBlueprint && detailNodeId ? sourceBlueprint.nodes[detailNodeId] ?? null : null
  // Detail exit keeps the last node rendered while the slide-out plays; the
  // slot track / open signal follow the display value so the layout collapses
  // right after the content is gone (sequential, no pop).
  const detailAnim = useAnimatedOpen(Boolean(activeDetailNode))
  const leavingNodeRef = useRef<typeof activeDetailNode>(null)
  if (activeDetailNode) leavingNodeRef.current = activeDetailNode
  const detailNode = activeDetailNode ?? (detailAnim.rendered ? leavingNodeRef.current : null)
  const detailSnapshot = sourceBlueprint && detailNode ? nodeNoteSnapshot(sourceBlueprint, detailNode.id) : undefined
  const detailInCanvas = Boolean(detailNode && !detailPortal)
  const selectedNode = sourceBlueprint && selectedId ? sourceBlueprint.nodes[selectedId] ?? null : null
  /** 详情展示 note 原始词汇（HTML 高保真同构；legacy 缺透传时回退映射标签） */
  const detailKind = detailNode ? noteKindOf(detailNode) : ''
  const initialCollapsedNodeIds = useMemo(
    () => {
      if (currentBlueprint?.id !== blueprintId) return new Set<string>()
      if (currentBlueprint.collapsedNodeIds !== null && currentBlueprint.collapsedNodeIds !== undefined) {
        return new Set(currentBlueprint.collapsedNodeIds)
      }
      return computeInitialCollapsedIds(currentBlueprint.nodes, currentBlueprint.nodeIds)
    },
    [blueprintId, currentBlueprint],
  )
  const canvasLoadPlan = useMemo(() => {
    if (!currentBlueprint || currentBlueprint.id !== blueprintId) return null
    return {
      blueprintId: viewKey,
      collapsedNodeIds: collapseInitRef.current === viewKey
        ? collapsedNodeIds
        : initialCollapsedNodeIds,
    }
  }, [blueprintId, collapsedNodeIds, currentBlueprint, initialCollapsedNodeIds, viewKey])
  const emptyCollapsedNodeIds = useMemo(() => new Set<string>(), [])
  const effectiveCollapsedNodeIds = useMemo(
    () => canvasLoadPlan?.collapsedNodeIds ?? emptyCollapsedNodeIds,
    [canvasLoadPlan, emptyCollapsedNodeIds],
  )
  const normalizedSearchQuery = useMemo(() => normalizeSearchText(searchQuery), [searchQuery])
  // Note: deferred query keeps typing responsive while large graphs filter — see .agents/notes/2026-09-26-blueprint-edge-partial-refresh--edge-refresh.md
  const deferredSearchQuery = useDeferredValue(normalizedSearchQuery)
  const searchFilterActive = deferredSearchQuery.length > 0 || statusFilter !== 'all' || kindFilter !== 'all'
  const nodeSearchTextById = useMemo(() => {
    if (!sourceBlueprint) return new Map<string, string>()
    return new Map(sourceBlueprint.nodeIds.map(id => [id, buildNodeSearchText(sourceBlueprint.nodes[id]).toLowerCase()]))
  }, [sourceBlueprint])
  const allSearchMatchIds = useMemo(() => sourceBlueprint?.nodeIds.filter(id => {
    const node = sourceBlueprint.nodes[id]
    return node ? nodeMatchesFocus(node, deferredSearchQuery, statusFilter, kindFilter, nodeSearchTextById.get(id)) : false
  }) ?? [], [sourceBlueprint, deferredSearchQuery, statusFilter, kindFilter, nodeSearchTextById])
  const searchMatchIds = useMemo(() => moduleBrowsing ? allSearchMatchIds : currentBlueprint
    ? visibleNodeIds(currentBlueprint.nodes, allSearchMatchIds, effectiveCollapsedNodeIds)
    : [], [moduleBrowsing, allSearchMatchIds, currentBlueprint, effectiveCollapsedNodeIds])
  const searchMatchKey = searchMatchIds.join('\u0000')
  const focusActive = searchFilterActive || (localFocusActive && !!selectedId)
  const focusedNodeIds = useMemo(() => {
    if (!currentBlueprint || !focusActive) return new Set<string>()
    if (localFocusActive && selectedId) return collectLocalHierarchyIds(currentBlueprint.nodes, selectedId, descendantDepth)
    return new Set(searchMatchIds)
  }, [currentBlueprint, descendantDepth, focusActive, localFocusActive, searchMatchIds, selectedId])
  const focusedNodeCount = focusedNodeIds.size
  // 孤立折叠：搜索/过滤激活时自动放行，避免“搜得到、看不见”。
  const isolatedIds = useMemo(() => {
    if (!currentBlueprint) return new Set<string>()
    return new Set(groupRootsByConnectivity(
      currentBlueprint.nodes,
      currentBlueprint.relations ?? [],
      currentBlueprint.composition?.interfaces ?? [],
    ).isolatedRootIds)
  }, [currentBlueprint])
  const hiddenNodeIds = !moduleBrowsing && hideIsolated && !searchFilterActive ? isolatedIds : EMPTY_NODE_IDS
  useEffect(() => setMatchIndex(0), [searchMatchKey])
  const detailWorkspaceMissing = !!detailNode?.workspaceId && !workspaceNameById[detailNode.workspaceId]
  const latestAnalysis = detailNode?.analyses?.length
    ? detailNode.analyses[detailNode.analyses.length - 1]
    : null
  const selectedAnalysis = useMemo(() => {
    if (!analysisHistory.length) return null
    if (selectedAnalysisId) {
      return analysisHistory.find((analysis) => analysis.id === selectedAnalysisId) ?? analysisHistory[0]
    }
    return analysisHistory[0]
  }, [analysisHistory, selectedAnalysisId])
  const fitViewWhenReady = useCallback((duration = 180) => {
    if (fitFrameRef.current !== null) cancelAnimationFrame(fitFrameRef.current)
    let attempts = 0
    const settle = () => {
      fitFrameRef.current = null
      const container = canvasMainRef.current
      const instance = rfInstanceRef.current
      const rect = container?.getBoundingClientRect()
      if (!instance || !rect || rect.width < 80 || rect.height < 80) {
        if (attempts < 12) {
          attempts += 1
          fitFrameRef.current = requestAnimationFrame(settle)
        }
        return
      }
      instance.fitView({ padding: 0.2, duration, ...(moduleBrowsing ? { maxZoom: 1 } : {}) })
    }
    fitFrameRef.current = requestAnimationFrame(() => {
      fitFrameRef.current = requestAnimationFrame(settle)
    })
  }, [moduleBrowsing])

  const persistCollapsedNodeIds = useCallback(async (nodeIds: Set<string>) => {
    if (moduleBrowsing) return
    const cwd = useBlueprintStore.getState().workspacePathFor(blueprintId)
    if (!cwd) throw new Error('找不到该图谱所属的工作区')
    const updated = await updateBlueprintIPC(cwd, blueprintId, {
      collapsedNodeIds: [...nodeIds]
    })
    if (!updated) throw new Error('Failed to persist blueprint collapse state')
  }, [blueprintId, moduleBrowsing])

  // 没有历史状态时才按层级预折叠；保存空数组代表用户选择全部展开。
  useEffect(() => {
    if (!currentBlueprint || currentBlueprint.id !== blueprintId) return
    if (collapseInitRef.current === viewKey) return
    collapseInitRef.current = viewKey
    const persistedCollapsedNodeIds = currentBlueprint.collapsedNodeIds
    const nextCollapsedNodeIds = persistedCollapsedNodeIds === null || persistedCollapsedNodeIds === undefined
      ? initialCollapsedNodeIds
      : new Set(persistedCollapsedNodeIds)
    setCollapsedNodeIds(nextCollapsedNodeIds)
    if (persistedCollapsedNodeIds === null || persistedCollapsedNodeIds === undefined) {
      void persistCollapsedNodeIds(nextCollapsedNodeIds).catch((error: unknown) => {
        setActionError(error instanceof Error ? error.message : String(error))
      })
    }
  }, [currentBlueprint, blueprintId, initialCollapsedNodeIds, persistCollapsedNodeIds, viewKey, moduleBrowsing, setHideIsolated])

  useEffect(() => () => {
    if (fitFrameRef.current !== null) cancelAnimationFrame(fitFrameRef.current)
  }, [])

  const {
    nodes: rfNodes,
    edges: rfEdges,
    onNodesChange,
    autoLayout,
    layoutSubtree,
    restoreDefaultLayout,
    undoRestoreDefaultLayout,
    canUndoRestoreDefaultLayout,
    flushLayoutSave
  } = useBlueprintGraphController({
    blueprint: currentBlueprint,
    blueprintId,
    viewKey,
    persistLayout: !moduleBrowsing,
    workspaceNameById,
    focusedNodeIds,
    focusActive,
    collapsedNodeIds: effectiveCollapsedNodeIds,
    hiddenNodeIds,
    onSelectionChange: setSelectedId,
    onError: setActionError,
    onLayoutPersisted: (savedBlueprintId, layout) => mergeCanvasLayout(savedBlueprintId, layout),
    onLayoutSaveStatus: setLayoutSaveStatus
  })
  useEffect(() => {
    const flush = () => { void flushLayoutSave() }
    document.addEventListener('visibilitychange', flush)
    window.addEventListener('beforeunload', flush)
    return () => {
      document.removeEventListener('visibilitychange', flush)
      window.removeEventListener('beforeunload', flush)
    }
  }, [flushLayoutSave])
  useEffect(() => window.electron.system.onPrepareQuit(async () => { await flushLayoutSave() }), [flushLayoutSave])
  useEffect(() => {
    onRegisterFlush?.(flushLayoutSave)
    return () => onRegisterFlush?.(() => Promise.resolve(true))
  }, [flushLayoutSave, onRegisterFlush])
  const graphReady = !currentBlueprint || currentBlueprint.nodeIds.length === 0 || rfNodes.length > 0
  const ownerPath = useBlueprintStore(state => state.blueprintWorkspace[blueprintId] ?? null)
  // Note: local module navigation preserves source/layout — see .agents/notes/blueprint/navigation/requirements/module-browsing.md
  const rememberLocation = useCallback(() => {
    history.current.push({ scopeId, selectedId, detailNodeId, wikiAnchor, viewport: rfInstanceRef.current?.getViewport() ?? null,
      searchQuery, statusFilter, kindFilter, hideIsolated, reading: { top: detailElement.current?.scrollTop ?? 0,
        collapsed: [...(detailElement.current?.querySelectorAll<HTMLDetailsElement>('.bp-note-wiki__body .bp-note-chapter:not([open])') ?? [])].flatMap(element => element.querySelector<HTMLElement>('[data-note-anchor]')?.dataset.noteAnchor ?? []),
        reviewExpanded: detailElement.current?.querySelector('.bp-note-review__toggle')?.getAttribute('aria-expanded') === 'true',
        open: [...(detailElement.current?.querySelectorAll<HTMLDetailsElement>('details[data-finding-id][open]') ?? [])].map(element => element.dataset.findingId!) } })
    setHistoryLength(history.current.length)
  }, [scopeId, selectedId, detailNodeId, wikiAnchor, searchQuery, statusFilter, kindFilter, hideIsolated])
  const navigateScope = useCallback((nextScope: string | null, previewId: string | null = nextScope) => {
    pendingCenter.current = null
    setNoteVisit(null); setSourceReady(null)
    const targetScope = nextScope ?? homeModuleId
    if (targetScope !== scopeId) {
      rememberLocation()
      setScopeId(targetScope)
    }
    setSelectedId(previewId); setDetailNodeId(previewId); setWikiAnchor(null)
  }, [scopeId, homeModuleId, rememberLocation])
  const beginVisit = useCallback((id: string, destination?: BlueprintNoteDestination, move = true, userInitiated = true, scopeOverride?: string) => {
    if (!sourceBlueprint?.nodes[id]) return
    const node = sourceBlueprint.nodes[id], root = nodeNoteSnapshot(sourceBlueprint, id)?.coverage.checkoutRoot
    if (!root || !node.sourceUri) return
    setSourceReady(null); readyVersion.current = null
    const targetScope = scopeOverride ?? (currentBlueprint?.nodes[id] ? scopeId : moduleBrowse?.owners[id] ?? homeModuleId)
    const sequence = ++visitCounter.current
    setNoteVisit({ root, context: useBlueprintReviewStore.getState().views[root]?.context, noteId: node.sourceUri.split('/').pop()!, intent: 'body', hash: node.sourceHash, ...destination,
      nodeId: id, sequence, viewKey: blueprintId + ':' + (targetScope ?? 'overview'),
      move: move && (!moduleBrowsing || Boolean(currentBlueprint?.nodes[id] || moduleBrowse?.owners[id] || architecture?.roles[id])), userInitiated })
    if (move) {
      pendingCenter.current = null
      initialFitBlueprintRef.current = blueprintId + ':' + (targetScope ?? 'overview')
      if (fitFrameRef.current !== null) cancelAnimationFrame(fitFrameRef.current)
    }
  }, [sourceBlueprint, currentBlueprint, scopeId, moduleBrowse, homeModuleId, blueprintId, moduleBrowsing, architecture])
  const openModule = useCallback((id: string) => {
    if (architecture?.roles[id]) { navigateScope(id); beginVisit(id, undefined, true, true, id) }
  }, [architecture, navigateScope, beginVisit])
  const goBack = useCallback(() => {
    const previous = history.current.pop()
    if (!previous) return
    pendingViewport.current = previous.viewport
    setNoteVisit(null); setSourceReady(null)
    setSearchQuery(previous.searchQuery); setStatusFilter(previous.statusFilter); setKindFilter(previous.kindFilter); setHideIsolated(previous.hideIsolated)
    detailScrollRestore.current = previous.reading
    pendingCenter.current = null
    setScopeId(previous.scopeId); setSelectedId(previous.selectedId); setDetailNodeId(previous.detailNodeId); setWikiAnchor(previous.wikiAnchor)
    setHistoryLength(history.current.length)
  }, [setSearchQuery, setStatusFilter, setKindFilter, setHideIsolated])
  const revealNode = useCallback((id: string, anchor?: string, userInitiated = true, destination?: BlueprintNoteDestination): boolean => {
    const node = sourceBlueprint?.nodes[id]
    if (!node) return false
    if (moduleBrowsing && !currentBlueprint?.nodes[id] && moduleBrowse?.owners[id]) navigateScope(moduleBrowse.owners[id], id)
    else if (moduleBrowsing && architecture?.roles[id] && !currentBlueprint?.nodes[id]) navigateScope(null, id)
    else { if (id !== detailNodeId) rememberLocation(); setSelectedId(id); setDetailNodeId(id) }
    setWikiAnchor(anchor && node.sourceUri ? { uri: node.sourceUri, value: anchor } : null)
    setLocalFocusActive(false)
    setCollapsedNodeIds(new Set()); setHideIsolated(false)
    beginVisit(id, destination, true, userInitiated)
    onNodeOpen?.(id)
    return !moduleBrowsing || !!architecture?.roles[id] || !!moduleBrowse?.owners[id]
  }, [sourceBlueprint, moduleBrowsing, currentBlueprint, moduleBrowse, architecture, navigateScope, setHideIsolated, onNodeOpen, beginVisit, detailNodeId, rememberLocation])
  const selectCompositionNode = useCallback((id: string): void => {
    setSearchQuery(''); setStatusFilter('all'); setKindFilter('all'); setLocalFocusActive(false)
    revealNode(id)
  }, [setSearchQuery, setStatusFilter, setKindFilter, revealNode])
  useEffect(() => {
    if (!toolbarState) return
    toolbarState.revealSourceNodeRef.current = selectCompositionNode
    return () => { toolbarState.revealSourceNodeRef.current = null }
  }, [toolbarState, selectCompositionNode])
  useEffect(() => {
    history.current = []; setHistoryLength(0); setScopeId(null); setSelectedId(null); setDetailNodeId(null); setWikiAnchor(null)
    setNoteVisit(null); setSourceReady(null)
    pendingViewport.current = null; pendingCenter.current = null
  }, [blueprintId, ownerPath])
  useEffect(() => {
    if (requestedScopeId && !architecture?.roles[requestedScopeId]) {
      setScopeId(null); history.current = []; setHistoryLength(0)
    }
  }, [requestedScopeId, architecture])
  const revealAssistantNode = useCallback((id: string, action: NoteFocusAction) => {
    if (!sourceBlueprint?.nodes[id]) return null
    const visible = !!currentBlueprint?.nodes[id]
    let targetScope = scopeId
    if (action === 'enter') {
      if (!architecture?.roles[id]) return null
      targetScope = id
      navigateScope(id)
    } else {
      const onCanvas = revealNode(id, undefined, false)
      setNoteVisit(null)
      pendingCenter.current = null
      if (!onCanvas || action === 'preview' && visible) return null
      if (moduleBrowsing && !visible) targetScope = moduleBrowse?.owners[id] ?? homeModuleId
    }
    if (fitFrameRef.current !== null) cancelAnimationFrame(fitFrameRef.current)
    const page = sourceBlueprint && architecture ? projectModuleBrowse(sourceBlueprint, architecture, targetScope) : null
    const targetViewKey = blueprintId + ':' + (targetScope ?? 'overview')
    // The focus hook owns this fit; a queued page fit must not zoom away from its target.
    initialFitBlueprintRef.current = targetViewKey
    return { viewKey: targetViewKey,
      nodeIds: action === 'enter' ? page?.graph.nodeIds ?? [id] : [...new Set([...(moduleBrowsing && targetScope ? [targetScope] : []), id])] }
  }, [sourceBlueprint, currentBlueprint, scopeId, architecture, navigateScope, revealNode, moduleBrowsing, moduleBrowse, homeModuleId, blueprintId])
  const assistantCanvas = useNoteCanvasFocus(sourceBlueprint, ownerPath, rfNodes, rfEdges, rfInstanceRef, viewKey, revealAssistantNode)
  const navigationRequest = useBlueprintNavigation(state => state.request)
  useEffect(() => {
    if (!navigationRequest || navigationRequest.blueprintId !== blueprintId || !sourceBlueprint) return
    const id = attentionNode(sourceBlueprint, navigationRequest.root, navigationRequest.noteId)
    useBlueprintNavigation.getState().consume(navigationRequest.sequence)
    const currentContext = useBlueprintReviewStore.getState().views[navigationRequest.root]?.context
      ?? useBlueprintActivityStore.getState().statuses[navigationRequest.root]?.automatic?.context
    if (!id || navigationRequest.context && (navigationRequest.context.branch !== currentContext?.branch || navigationRequest.context.repoId !== currentContext?.repoId)) { setActionError(t('attention.unavailable')); return }
    revealNode(id, undefined, true, navigationRequest)
    setSearchQuery(''); setStatusFilter('all'); setKindFilter('all')
  }, [navigationRequest, blueprintId, sourceBlueprint, revealNode, setSearchQuery, setStatusFilter, setKindFilter, t])
  useEffect(() => {
    const version = readyVersion.current
    if (!noteVisit || !version || navigationMotion.status.sequence !== noteVisit.sequence || navigationMotion.status.phase !== 'ready'
      || !noteVisit.userInitiated || noteVisit.intent !== 'body' || acknowledgedVisit.current === noteVisit.sequence) return
    acknowledgedVisit.current = noteVisit.sequence
    if (noteVisit.hash && version.hash !== noteVisit.hash) return
    void markNoteRead(noteVisit.root, [version], false, noteVisit.context).catch(error => setActionError(String(error)))
  }, [noteVisit, navigationMotion.status])
  const noteSourceReady = useCallback((version: NoteVersion | null, sequence?: number) => {
    if (detailScrollRestore.current && version) {
      const saved = detailScrollRestore.current; detailScrollRestore.current = null
      requestAnimationFrame(() => {
        if (!detailElement.current) return
        const restore = () => {
          if (!detailElement.current) return
          for (const finding of detailElement.current.querySelectorAll<HTMLDetailsElement>('details[data-finding-id]')) finding.open = saved.open.includes(finding.dataset.findingId!)
          for (const chapter of detailElement.current.querySelectorAll<HTMLDetailsElement>('.bp-note-wiki__body .bp-note-chapter')) chapter.open = !saved.collapsed.includes(chapter.querySelector<HTMLElement>('[data-note-anchor]')?.dataset.noteAnchor ?? '')
          detailElement.current.scrollTop = saved.top
        }
        const toggle = detailElement.current.querySelector<HTMLButtonElement>('.bp-note-review__toggle')
        if (toggle && (toggle.getAttribute('aria-expanded') === 'true') !== saved.reviewExpanded) { toggle.click(); requestAnimationFrame(restore) }
        else restore()
      })
    }
    if (!noteVisit || sequence !== noteVisit.sequence) return
    readyVersion.current = version
    setSourceReady(version ? noteVisit.sequence : -noteVisit.sequence)
  }, [noteVisit])
  useEffect(() => {
    if (!ownerPath) return
    useNoteFocusStore.getState().setBrowser({ blueprintId, workspacePath: ownerPath, moduleBrowsing, moduleId: scopeId, selectedId,
      visibleIds: rfNodes.filter(node => !node.hidden).map(node => node.id) })
  }, [blueprintId, ownerPath, moduleBrowsing, scopeId, selectedId, rfNodes])
  useEffect(() => () => {
    if (useNoteFocusStore.getState().browser?.blueprintId === blueprintId) useNoteFocusStore.getState().setBrowser(null)
  }, [blueprintId])

  useEffect(() => {
    if (!canvasLoadPlan || !rfInstanceRef.current) return
    if (pendingViewport.current) {
      const viewport = pendingViewport.current
      pendingViewport.current = null
      initialFitBlueprintRef.current = canvasLoadPlan.blueprintId
      if (fitFrameRef.current !== null) cancelAnimationFrame(fitFrameRef.current)
      void rfInstanceRef.current.setViewport(viewport)
      return
    }
    if (noteVisit?.move && noteVisit.viewKey === canvasLoadPlan.blueprintId) return
    if (initialFitBlueprintRef.current !== canvasLoadPlan.blueprintId && rfNodes.length) {
      initialFitBlueprintRef.current = canvasLoadPlan.blueprintId
      fitViewWhenReady(0)
    }
    const id = pendingCenter.current
    const node = id ? rfNodes.find(node => node.id === id) : undefined
    if (node) {
      pendingCenter.current = null
      if (fitFrameRef.current !== null) cancelAnimationFrame(fitFrameRef.current)
      void rfInstanceRef.current.setCenter(node.position.x + NODE_W / 2, node.position.y + NODE_H / 2, { zoom: 1, duration: 0 })
    }
  }, [canvasLoadPlan, fitViewWhenReady, rfNodes, noteVisit])

  useEffect(() => {
    const isDetailOpen = Boolean(activeDetailNode)
    if (detailOpenRef.current === null) {
      detailOpenRef.current = isDetailOpen
      return
    }
    if (detailOpenRef.current === isDetailOpen) return
    detailOpenRef.current = isDetailOpen
    if (moduleBrowsing) return
    const timer = window.setTimeout(() => fitViewWhenReady(180), 220)
    return () => window.clearTimeout(timer)
  }, [activeDetailNode, fitViewWhenReady, moduleBrowsing])

  useEffect(() => {
    onDetailOpenChange?.(Boolean(detailNode))
  }, [detailNode, onDetailOpenChange])

  // 高保真左列常驻（Note 预览）：蓝图载入后默认选中根并展开预览；
  // 后续单击选中即展开预览，保证左列始终有内容而非常开空白。
  useEffect(() => {
    if (!currentBlueprint || currentBlueprint.id !== blueprintId) return
    if (moduleBrowsing) return
    if (detailInitRef.current === blueprintId) return
    const root = currentBlueprint.rootNodeId && currentBlueprint.nodes[currentBlueprint.rootNodeId]
      ? currentBlueprint.rootNodeId
      : currentBlueprint.nodeIds[0] ?? null
    if (!root) return
    detailInitRef.current = blueprintId
    setSelectedId(root)
    setDetailNodeId(root)
  }, [currentBlueprint, blueprintId, detailNodeId, selectedId, moduleBrowsing])

  // 统一顶栏接线（workbench）：注册 fit 入口，回報选中与保存态
  useEffect(() => {
    if (!toolbarState) return
    toolbarState.fitRef.current = () => fitViewWhenReady(200)
    toolbarState.toggleDetailRef.current = () => setDetailNodeId(id => id ? null : selectedId ?? currentBlueprint?.rootNodeId ?? null)
    toolbarState.restoreLayoutRef.current = () => setRestoreLayoutConfirmOpen(true)
    toolbarState.undoLayoutRef.current = () => { void undoRestoreDefaultLayout().then(() => fitViewWhenReady(200)) }
    return () => {
      toolbarState.fitRef.current = null
      toolbarState.toggleDetailRef.current = null
      toolbarState.restoreLayoutRef.current = null
      toolbarState.undoLayoutRef.current = null
    }
  }, [toolbarState, fitViewWhenReady, selectedId, currentBlueprint?.rootNodeId, undoRestoreDefaultLayout])
  useEffect(() => {
    toolbarState?.reportDetailOpen(Boolean(activeDetailNode))
    toolbarState?.reportCanUndoLayout(canUndoRestoreDefaultLayout)
  }, [toolbarState, activeDetailNode, canUndoRestoreDefaultLayout])
  useEffect(() => {
    toolbarState?.reportSelectedId(selectedId)
  }, [toolbarState, selectedId])
  useEffect(() => {
    toolbarState?.reportSaveStatus(layoutSaveStatus)
  }, [toolbarState, layoutSaveStatus])

  useEffect(() => {
    if (!detailAnim.rendered) leavingNodeRef.current = null
  }, [detailAnim.rendered])

  useEffect(() => () => onDetailOpenChange?.(false), [onDetailOpenChange])

  const toggleCollapse = useCallback((nodeId: string) => {
    if (moduleBrowsing) return
    const next = new Set(effectiveCollapsedNodeIds)
    if (!next.delete(nodeId)) next.add(nodeId)
    setCollapsedNodeIds(next)
    void persistCollapsedNodeIds(next).catch((error: unknown) => {
      setActionError(error instanceof Error ? error.message : String(error))
    })
  }, [effectiveCollapsedNodeIds, persistCollapsedNodeIds, moduleBrowsing])
  const showSuggestions = useCallback((id: string) => {
    const node = sourceBlueprint?.nodes[id], root = sourceBlueprint && nodeNoteSnapshot(sourceBlueprint, id)?.coverage.checkoutRoot
    if (node?.sourceUri && root) revealNode(id, undefined, true, { root, noteId: node.sourceUri.split('/').pop()!, intent: 'suggestions' })
  }, [sourceBlueprint, revealNode])
  const cardActions = useMemo(() => ({ toggleCollapse, moduleBrowsing, architectureRoles: architecture?.roles, moduleDocuments: moduleBrowse?.owned, moduleChildren: architecture?.graph.nodes, openModule, showSuggestions }), [toggleCollapse, moduleBrowsing, architecture, moduleBrowse?.owned, openModule, showSuggestions])

  const activateNode = useCallback(
    (id: string) => {
      if (architecture?.roles[id]) openModule(id)
      else revealNode(id)
    },
    [architecture, openModule, revealNode]
  )

  const onCanvasDoubleClick = useCallback((event: MouseEvent<HTMLDivElement>) => {
    // Note: preview reflow can move the second click onto another card or the pane.
    // See .agents/notes/blueprint/workspaces/architect-workspace-model.md.
    const first = firstNodeClick.current
    firstNodeClick.current = null
    if (!first || event.timeStamp - first.time >= 1000 || Math.hypot(event.clientX - first.x, event.clientY - first.y) >= 8) return
    event.preventDefault()
    event.stopPropagation()
    activateNode(first.id)
  }, [activateNode])

  const onNodeContextMenu: NodeMouseHandler = useCallback(
    (e, node) => {
      e.preventDefault()
      setSelectedId(node.id)
      setContextMenu({ x: e.clientX, y: e.clientY, nodeId: node.id })
    },
    []
  )

  // 关闭右键菜单
  useEffect(() => {
    if (!contextMenu) return
    const close = () => setContextMenu(null)
    window.addEventListener('click', close)
    window.addEventListener('contextmenu', close)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('contextmenu', close)
    }
  }, [contextMenu])

  /* 详情只读：内容变更走对话 + Agent 事务，本文件不再直写节点字段 */
  const fitView = useCallback(() => {
    fitViewWhenReady(200)
  }, [fitViewWhenReady])

  const focusMatch = useCallback((step: number) => {
    if (!searchMatchIds.length) return
    const nextIndex = stepMatchIndex(matchIndex, step, searchMatchIds.length)
    const nodeId = searchMatchIds[nextIndex]
    setMatchIndex(nextIndex)
    revealNode(nodeId)
  }, [matchIndex, searchMatchIds, revealNode])

  const nodeTypes = useMemo(() => ({ blueprint: BlueprintNodeCard }), [])
  const edgeTypes = useMemo(
    () => ({ blueprintAdaptive: BlueprintAdaptiveEdge, blueprintHierarchy: BlueprintHierarchyEdge }),
    [],
  )
  const statusFilterOptions = useMemo(
    () => [
      { value: 'all', label: t('blueprint:search.statusAll') },
      ...blueprintStatusOptions(Object.values(sourceBlueprint?.nodes ?? {}), t)
    ],
    [t, sourceBlueprint]
  )
  const kindFilterOptions = useMemo(
    () => [
      { value: 'all', label: t('blueprint:search.kindAll') },
      ...NOTE_KINDS.map((kind) => ({ value: kind, label: t(NOTE_KIND_LABEL_KEY[kind]) }))
    ],
    [t]
  )
  return (
    <div className={`blueprint-canvas-wrapper blueprint-canvas-wrapper--browsing${detailInCanvas ? ' blueprint-canvas-wrapper--detail-open' : ''}`}>
      <div ref={canvasMainRef} className="blueprint-canvas-main" data-graph-ready={graphReady ? 'true' : 'false'}
        data-navigation={navigationMotion.status.phase} aria-busy={navigationMotion.status.phase === 'loading'}
        onPointerDownCapture={() => { navigationMotion.cancel(); assistantCanvas.onPointerDown() }} onWheelCapture={() => { navigationMotion.cancel(); assistantCanvas.onWheel() }}>
      {noteVisit && navigationMotion.status.sequence === noteVisit.sequence && ['loading', 'failed'].includes(navigationMotion.status.phase) && <div className="bp-navigation-status" role="status" data-phase={navigationMotion.status.phase}>
        <span className="bp-navigation-status__line" />{t(navigationMotion.status.phase === 'loading' ? 'attention.locating' : 'attention.locateFailed')}
        {navigationMotion.status.phase === 'failed' && <button type="button" onClick={() => { setSelectedId(noteVisit.nodeId); setDetailNodeId(noteVisit.nodeId); beginVisit(noteVisit.nodeId, noteVisit) }}>{t('attention.retry')}</button>}
      </div>}
      {/* 画布操作工具栏（embedded 保留；workbench 已收敛到顶栏统一栏，此处不再渲染） */}
      {toolbarState ? null : (
      <div className="blueprint-toolbar blueprint-toolbar--canvas">
        <div className="blueprint-toolbar__main">
          <div className="blueprint-toolbar__identity">
            <span className="blueprint-toolbar__title">
              {currentBlueprint ? currentBlueprint.name : t('blueprint:toolbar.loading')}
            </span>
            {selectedNode ? (
              <span className="blueprint-toolbar__hint">
                {selectedNode.workspaceId ? workspaceNameById[selectedNode.workspaceId] ?? selectedNode.workspaceSnapshot?.name ?? t('blueprint:detailPanel.warningWorkspaceInvalid') : t('blueprint:detailPanel.workspaceUnbound')}
              </span>
            ) : null}
          </div>

          <div className="blueprint-toolbar__actions">
            <div className="blueprint-toolbar__group blueprint-toolbar__group--focus" role="group" aria-label={t('blueprint:ariaLabel.focus')}>
              <div className="blueprint-toolbar__search-wrap">
                <input
                  className="blueprint-toolbar__search"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.currentTarget.value)}
                  placeholder={t('blueprint:search.placeholder')}
                  aria-label={t('blueprint:ariaLabel.search')}
                />
                {focusActive ? (
                  <span className="blueprint-toolbar__match-count">{t('blueprint:toolbar.matchCount', { count: focusedNodeCount })}</span>
                ) : null}
              </div>
              <Select
                value={statusFilter}
                onChange={(value) => setStatusFilter(value as StatusFilter)}
                options={statusFilterOptions}
                className="blueprint-select blueprint-select--status-filter"
                getPortalContainer={getSelectPortalContainer}
              />
              <Select
                value={kindFilter}
                onChange={(value) => setKindFilter(value as KindFilter)}
                options={kindFilterOptions}
                className="blueprint-select blueprint-select--status-filter"
                getPortalContainer={getSelectPortalContainer}
              />
              <button className="blueprint-btn" onClick={() => focusMatch(-1)} disabled={!searchMatchIds.length} title={t('blueprint:action.prevMatch')} aria-label={t('blueprint:ariaLabel.prevMatch')}>‹</button>
              <button className="blueprint-btn" onClick={() => focusMatch(1)} disabled={!searchMatchIds.length} title={t('blueprint:action.nextMatch')} aria-label={t('blueprint:ariaLabel.nextMatch')}>›</button>
              <button
                className="blueprint-btn"
                onClick={() => {
                  setSearchQuery('')
                  setStatusFilter('all')
                  setKindFilter('all')
                }}
                disabled={!searchFilterActive}
              >
                {t('blueprint:action.clear')}
              </button>
            </div>

            <div
              className="blueprint-toolbar__group blueprint-toolbar__group--node"
              role="group"
              aria-label={t('blueprint:ariaLabel.nodeActions')}
              data-active={selectedId ? 'true' : 'false'}
            >
              <button className="blueprint-btn" onClick={() => selectedId && setDetailNodeId(selectedId)} disabled={!selectedId}>
                {t('blueprint:action.nodeDetail')}
              </button>
              <button className={`blueprint-btn${localFocusActive ? ' blueprint-btn--active' : ''}`} onClick={() => setLocalFocusActive((value) => !value)} disabled={!selectedId} aria-pressed={localFocusActive}>
                {localFocusActive ? t('blueprint:action.exitLocalFocus') : t('blueprint:action.focusHierarchy')}
              </button>
            </div>

            <div className="blueprint-toolbar__group blueprint-toolbar__group--utility" role="group" aria-label={t('blueprint:ariaLabel.utility')}>
              {/* 画布只做检视：内容变更与派发都走右侧对话，不再有主行动按钮 */}
              <button className="blueprint-btn" onClick={fitView} title={t('blueprint:action.fitCanvas')}>
                {t('blueprint:action.fitCanvas')}
              </button>
              {sourceBlueprint && architecture && <BlueprintSourceInfo key={sourceBlueprint.id} source={sourceBlueprint} projection={architecture} onSelect={selectCompositionNode} />}
              {!moduleBrowsing && isolatedCount > 0 && (
                <button
                  className={`blueprint-btn blueprint-toolbar__toggle${hideIsolated ? ' blueprint-toolbar__toggle--active' : ''}`}
                  onClick={() => setHideIsolated((visible) => !visible)}
                  aria-pressed={hideIsolated}
                  title={hideIsolated ? t('blueprint:action.showIsolated', { count: isolatedCount }) : t('blueprint:action.hideIsolated', { count: isolatedCount })}
                >
                  {hideIsolated ? t('blueprint:action.showIsolated', { count: isolatedCount }) : t('blueprint:action.hideIsolated', { count: isolatedCount })}
                </button>
              )}
              <button className="blueprint-btn" onClick={() => loadBlueprint(blueprintId)} title={t('blueprint:action.replayLoading')}>
                {t('blueprint:action.replayLoading')}
              </button>
              {moduleBrowsing ? <span className="blueprint-toolbar__save-status">{t('blueprint:action.autoLayout')}</span> : layoutSaveStatus !== 'clean' ? (
                <span className={`blueprint-toolbar__save-status blueprint-toolbar__save-status--${layoutSaveStatus}`}>
                  {layoutSaveStatus === 'saving' ? '保存中…' : layoutSaveStatus === 'pending' ? '待保存' : layoutSaveStatus === 'failed' ? '保存失败' : '已保存'}
                </span>
              ) : (
                <span className="blueprint-toolbar__save-status blueprint-toolbar__save-status--saved">布局已保存（本机）</span>
              )}
              <button
                className={`blueprint-btn blueprint-toolbar__toggle${toolbarExpanded ? ' blueprint-toolbar__toggle--active' : ''}`}
                onClick={() => setToolbarExpanded((current) => !current)}
                aria-expanded={toolbarExpanded}
                aria-controls="blueprint-toolbar-panel"
                aria-label={toolbarExpanded ? t('blueprint:ariaLabel.collapseMore') : t('blueprint:ariaLabel.expandMore')}
              >
                {toolbarExpanded ? t('blueprint:action.collapse') : t('blueprint:action.more')}
              </button>
            </div>
          </div>
        </div>

        <div
          id="blueprint-toolbar-panel"
          className={`blueprint-toolbar__panel-wrap${toolbarExpanded ? ' blueprint-toolbar__panel-wrap--expanded' : ''}`}
          aria-hidden={!toolbarExpanded}
        >
          <div className="blueprint-toolbar__panel">
            <div className="blueprint-toolbar__zone" role="group" aria-label={t('blueprint:toolbar.zoneNode')}>
              <span className="blueprint-toolbar__zone-title">{t('blueprint:toolbar.zoneNode')}</span>
              <div className="blueprint-toolbar__zone-body">
                <label className="blueprint-toolbar__commit-limit">
                  <span>{t('blueprint:toolbar.recent')}</span>
                  <input
                    type="number"
                    min={ANALYSIS_COMMIT_LIMIT_MIN}
                    max={ANALYSIS_COMMIT_LIMIT_MAX}
                    value={analysisCommitLimit}
                    onChange={(event) => setAnalysisCommitLimit(event.target.value)}
                    onBlur={() => setAnalysisCommitLimit(String(normalizeAnalysisCommitLimit(analysisCommitLimit)))}
                  />
                  <span>{t('blueprint:toolbar.times')}</span>
                </label>
                <button className="blueprint-btn" onClick={analyzeSelected} disabled={!selectedId || analyzing}>
                  {analyzing ? t('blueprint:action.analyzing') : t('blueprint:action.analyzeSelected')}
                </button>
                <button
                  className="blueprint-btn"
                  onClick={() => selectedId && void layoutSubtree(selectedId)}
                  disabled={!selectedId || moduleBrowsing}
                >
                  {t('blueprint:action.layoutSubtree')}
                </button>
                <button className="blueprint-btn" onClick={() => selectedId && toggleCollapse(selectedId)} disabled={!selectedId || moduleBrowsing} aria-label={t('blueprint:ariaLabel.toggleSubtree')}>
                  {selectedId && effectiveCollapsedNodeIds.has(selectedId) ? t('blueprint:action.expandSubtree') : t('blueprint:action.collapseSubtree')}
                </button>
              </div>
            </div>

            <div className="blueprint-toolbar__zone" role="group" aria-label={t('blueprint:toolbar.zoneFocus')}>
              <span className="blueprint-toolbar__zone-title">{t('blueprint:toolbar.zoneFocus')}</span>
              <div className="blueprint-toolbar__zone-body">
                <label className="blueprint-toolbar__commit-limit"><span>{t('blueprint:toolbar.descendantLevel')}</span><input type="number" min={0} max={8} value={descendantDepth} onChange={(event) => setDescendantDepth(Math.max(0, Math.min(8, Number(event.target.value) || 0)))} /></label>
                <button className="blueprint-btn" onClick={() => focusMatch(0)} disabled={!searchMatchIds.length}>{t('blueprint:action.locateMatch')}</button>
              </div>
            </div>

            <div className="blueprint-toolbar__zone" role="group" aria-label={t('blueprint:toolbar.zoneCanvas')}>
              <span className="blueprint-toolbar__zone-title">{t('blueprint:toolbar.zoneCanvas')}</span>
              <div className="blueprint-toolbar__zone-body">
                <button className="blueprint-btn" onClick={fitView}>{t('blueprint:action.fitCanvas')}</button>
                <button className="blueprint-btn" disabled={moduleBrowsing} onClick={() => void autoLayout()}>{t('blueprint:action.autoLayout')}</button>
                <button
                  className="blueprint-btn"
                  disabled={moduleBrowsing} onClick={() => setRestoreLayoutConfirmOpen(true)}
                >
                  {t('blueprint:action.restoreDefaultLayout')}
                </button>
                <button className="blueprint-btn" onClick={() => void undoRestoreDefaultLayout()} disabled={!canUndoRestoreDefaultLayout}>
                  {t('blueprint:action.undoRestore')}
                </button>
              </div>
            </div>

            {loading ? <span className="blueprint-toolbar__loading">{t('blueprint:toolbar.loading')}</span> : null}
            {layoutSaveStatus !== 'clean' ? <span className={`blueprint-toolbar__save-status blueprint-toolbar__save-status--${layoutSaveStatus}`}>{layoutSaveStatus === 'saving' ? '保存中…' : layoutSaveStatus === 'pending' ? '待保存' : layoutSaveStatus === 'failed' ? '保存失败' : '已保存'}</span> : null}
          </div>
        </div>

        {actionError || error ? <span className="blueprint-toolbar__error">{actionError ?? error}</span> : null}
      </div>
      )}

      {sourceBlueprint && moduleBrowse && architecture && <BlueprintBrowserBar source={sourceBlueprint} trail={moduleTrail(architecture, scopeId)} showOverview={!homeModuleId} canGoBack={historyLength > 0} onBack={goBack} onScope={navigateScope} searching={searchFilterActive} matches={allSearchMatchIds} unassigned={moduleBrowse.unassigned} onReveal={revealNode} hasModules={moduleBrowsing} />}
      <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
      {toolbarState && actionError && <div className="blueprint-canvas-error" role="alert">{actionError}</div>}
      {moduleBrowsing && scopeId && currentBlueprint?.nodeIds.length === 1 && <p className="bp-browser-empty">{t('blueprint:browse.emptyModule')}</p>}
      {!graphReady ? <div className="blueprint-canvas-loading" aria-live="polite" aria-label={t('blueprint:toolbar.loading')} /> : null}
      <BlueprintCardActionsContext.Provider value={cardActions}>
      <ReactFlow<Node<BlueprintNodeData, 'blueprint'>, Edge>
        nodes={assistantCanvas.nodes.map(node => ({ ...node, selected: node.id === selectedId, className: [node.className, node.id === navigationMotion.focused ? 'bp-navigation-focused' : ''].filter(Boolean).join(' ') }))}
        edges={assistantCanvas.edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onNodeDragStop={() => { void flushLayoutSave() }}
        onDoubleClickCapture={onCanvasDoubleClick}
        onNodeDoubleClick={(_event, node) => activateNode(node.id)}
        onNodeClick={(event, node) => {
          if (event.detail === 2 && firstNodeClick.current) return
          firstNodeClick.current = { id: node.id, x: event.clientX, y: event.clientY, time: event.timeStamp }
          setSelectedId(node.id); setDetailNodeId(node.id); setWikiAnchor(null)
          beginVisit(node.id, undefined, false)
        }}
        onMove={(event) => { if (event) firstNodeClick.current = null }}
        onNodeDragStart={() => { firstNodeClick.current = null }}
        nodesDraggable={!moduleBrowsing}
        zoomOnDoubleClick={false}
        onNodeContextMenu={onNodeContextMenu}
        onInit={(inst) => {
          rfInstanceRef.current = inst
          if (canvasLoadPlan && rfNodes.length && initialFitBlueprintRef.current !== canvasLoadPlan.blueprintId) {
            initialFitBlueprintRef.current = canvasLoadPlan.blueprintId
            fitViewWhenReady(0)
          }
        }}
        onlyRenderVisibleElements
        proOptions={{ hideAttribution: true }}
        colorMode={plancheCanvas ? 'light' : 'dark'}
        minZoom={0.05}
        maxZoom={4}
        style={{ background: 'transparent' }}
      >
        <Background color={plancheCanvas ? 'rgba(28,52,59,0.16)' : 'rgba(255,255,255,0.05)'} gap={24} />
        {moduleBrowsing && <ViewportPortal>
          {moduleBrowse?.groups.map(group => <div key={group.id} className="bp-module-document-group" data-module-id={group.moduleId} data-kind={group.kind}
            style={{ left: group.x, top: group.y, width: group.width, height: group.height }}>
            <span>{t(NOTE_KIND_LABEL_KEY[group.kind] ?? group.kind)}</span>
          </div>)}
        </ViewportPortal>}
        {!moduleBrowsing && rfNodes.length <= 250 ? (
          <MiniMap
            pannable
            zoomable
            nodeColor={(n) => {
              const d = n.data as BlueprintNodeData | undefined
              return d && !d.noteId ? getBlueprintStatusVisual(d.status).color : plancheCanvas ? 'rgba(28,52,59,0.45)' : '#555'
            }}
            style={{ background: plancheCanvas ? '#DCCFA8' : 'rgba(12,12,12,0.9)' }}
          />
        ) : null}
      </ReactFlow>
      <div className="bp-canvas-legend" aria-hidden="true">
        <span><i className="ld" style={{ background: 'var(--shell-accent, #b98736)' }} />{t('blueprint:review.pendingLegend')}</span>
        {(!moduleBrowsing && Object.values(sourceBlueprint?.nodes ?? {}).some(node => !node.note && !node.sourceUri) ? ['planning', 'in-progress', 'done', 'archived'] as const : []).map((status) => (
          <span key={status}>
            <i className="ld" style={{ background: getBlueprintStatusVisual(status).color }} />
            {t(getBlueprintStatusVisual(status).labelKey)}
          </span>
        ))}
        <span><i style={{ color: 'var(--shell-muted)' }}>━</i> {t('blueprint:legend.parent')}</span>
        {(!moduleBrowsing ? [
          { type: 'depends-on', dash: '5 4', labelKey: 'blueprint:maintenance.relationType.dependsOn' },
          { type: 'implements', dash: '2 3', labelKey: 'blueprint:maintenance.relationType.implements' },
          { type: 'related-to', dash: '5 5', labelKey: 'blueprint:maintenance.relationType.relatedTo' },
        ] as const : []).map((entry) => (
              <span key={entry.type}>
                <svg width="18" height="6" aria-hidden="true">
                  <line x1="0" y1="3" x2="18" y2="3" strokeWidth="1.5" strokeDasharray={entry.dash} style={{ stroke: 'var(--shell-muted)' }} />
                </svg>
                {t(entry.labelKey)}
              </span>
        ))}
      </div>
      </BlueprintCardActionsContext.Provider>
      </div>

      {/* 右键菜单只保留检视入口：写内容与派发都在右侧对话里 */}
      {contextMenu ? (
        <div
          className="bp-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <button className="bp-context-menu__item" onClick={() => { setDetailNodeId(contextMenu.nodeId); beginVisit(contextMenu.nodeId, undefined, false); setContextMenu(null) }}>
            {t('blueprint:contextMenu.nodeDetail')}
          </button>
        </div>
      ) : null}
      </div>

      {detailNode ? (
        <BlueprintDetailMount target={detailPortal}>
        <aside
          className="bp-node-detail"
          key={detailNode.id}
          data-visible={detailAnim.visible ? 'true' : 'false'}
          aria-hidden={detailAnim.visible ? undefined : 'true'}
        >
          <div className="bp-node-detail__header">
            <div className="bp-node-detail__heading">
              <div className="bp-node-detail__eyebrow">{detailKind} · {detailNode.lifecycle ?? t(getBlueprintStatusVisual(detailNode.status)?.labelKey ?? `blueprint:status.${detailNode.status}`)}</div>
              <div className="bp-node-detail__title">{detailNode.title || <span className="bp-node-detail__title--empty">{t('blueprint:detailPanel.untitled')}</span>}</div>
              <div className="bp-node-detail__summary">
                <span>{detailKind && NOTE_KIND_LABEL_KEY[detailKind] ? t(NOTE_KIND_LABEL_KEY[detailKind]) : detailKind}</span>
                <span>{detailNode.lifecycle ?? t(getBlueprintStatusVisual(detailNode.status)?.labelKey ?? `blueprint:status.${detailNode.status}`)}</span>
                {(detailNode.tags ?? []).map((tag) => <span key={tag}>#{tag}</span>)}
              </div>
            </div>
            <button className="bp-panel-close" onClick={() => { setDetailNodeId(null); setNoteVisit(null); setSourceReady(null) }} aria-label={t('blueprint:ariaLabel.closeNodeDetail')} title={t('common:action.close')}>
              <X size={16} aria-hidden="true" />
            </button>
          </div>

          <div className="bp-node-detail__scroll" ref={detailElement}>
          {sourceBlueprint && architecture?.roles[detailNode.id] && <details className="bp-browser-related"><summary>{t('blueprint:browse.related')}</summary><BlueprintArchitecturePanel source={sourceBlueprint} projection={architecture} nodeId={detailNode.id} onSelect={selectCompositionNode} /></details>}
          {sourceBlueprint && !architecture?.roles[detailNode.id] && <BlueprintCompositionPanel blueprint={sourceBlueprint} nodeId={detailNode.id} onSelect={selectCompositionNode} />}
          {sourceBlueprint && detailSnapshot ? (
            <NoteWikiPanel
              compact={moduleBrowsing || Boolean(toolbarState)}
              visit={noteVisit?.nodeId === detailNode.id ? noteVisit : undefined}
              onSourceReady={noteSourceReady}
              onRetryNavigation={noteVisit ? () => beginVisit(detailNode.id, noteVisit, noteVisit.move, noteVisit.userInitiated) : undefined}
              onReadBody={async version => {
                await markNoteRead(detailSnapshot.coverage.checkoutRoot, [version], false)
              }}
              motionReady={navigationMotion.status.sequence === noteVisit?.sequence && navigationMotion.status.phase === 'ready'}
              snapshot={detailSnapshot}
              rootPath={detailSnapshot.coverage.checkoutRoot}
              uri={detailNode.sourceUri}
              anchor={wikiAnchor?.uri === detailNode.sourceUri ? wikiAnchor?.value : undefined}
              onRefresh={() => { void loadBlueprint(blueprintId) }}
              canNavigate={(uri) => !!resolveCompositionNote(sourceBlueprint, detailNode.id, uri)}
              onNavigate={(uri, anchor) => {
                const targetId = resolveCompositionNote(sourceBlueprint, detailNode.id, uri)
                const target = targetId ? sourceBlueprint.nodes[targetId] : undefined
                if (!target) return
                setSearchQuery(''); setStatusFilter('all'); setKindFilter('all')
                revealNode(target.id, anchor)
              }}
            />
          ) : (<>
          <div className="bp-node-detail__section bp-node-detail__section--content">
            <label className="bp-node-detail__label">{t('blueprint:detailPanel.description')}</label>
            {detailNode.description ? (
              <p className="bp-node-detail__text">{detailNode.description}</p>
            ) : (
              <div className="bp-feature-empty">{t('blueprint:detailPanel.none')}</div>
            )}
          </div>

          <div className="bp-node-detail__section bp-node-detail__section--content">
            <div className="bp-node-detail__section-head">
              <label className="bp-node-detail__label">{t('blueprint:detailPanel.positioning')}</label>
            </div>
            <div className="bp-item-list">
              {splitLines(detailNode.positioning).map((item, index) => (
                <div className="bp-item-card" key={`${detailNode.id}-positioning-${index}`}>
                  <span className="bp-item-card__text">{item}</span>
                </div>
              ))}
              {splitLines(detailNode.positioning).length === 0 ? <div className="bp-feature-empty">{t('blueprint:detailPanel.noPositioning')}</div> : null}
            </div>
          </div>

          <div className="bp-node-detail__section bp-node-detail__section--content">
            <div className="bp-node-detail__section-head">
              <label className="bp-node-detail__label">{t('blueprint:detailPanel.techSolution')}</label>
            </div>
            <div className="bp-item-list">
              {splitLines(detailNode.techSolution).map((item, index) => (
                <div className="bp-item-card" key={`${detailNode.id}-tech-${index}`}>
                  <span className="bp-item-card__text">{item}</span>
                </div>
              ))}
              {splitLines(detailNode.techSolution).length === 0 ? <div className="bp-feature-empty">{t('blueprint:detailPanel.noTechSolution')}</div> : null}
            </div>
          </div>

          <div className="bp-node-detail__section bp-node-detail__section--content">
            <div className="bp-node-detail__section-head">
              <label className="bp-node-detail__label">{t('blueprint:detailPanel.requirementDesc')}</label>
            </div>
            <div className="bp-feature-list">
              {(detailNode.features ?? []).map((feature) => (
                <div className="bp-feature-card" key={feature.id}>
                  <div className="bp-feature-card__row">
                    <span className="bp-feature-card__title">{feature.title}</span>
                  </div>
                  {feature.description ? <p className="bp-feature-card__desc">{feature.description}</p> : null}
                  <div className="bp-feature-card__readonly">
                    <span>
                      {t('blueprint:detailPanel.janusProgress')} <strong>{Math.max(0, Math.min(100, feature.progress))}%</strong>
                    </span>
                    <span>{t(FEATURE_STATUS_LABEL_KEY[feature.status] ?? `blueprint:featureStatus.${feature.status}`)}</span>
                  </div>
                  <div className="bp-feature-card__notes">
                    {feature.requirementNotes?.length ? feature.requirementNotes.map((note) => <span key={note}>{note}</span>) : <span>{t('blueprint:detailPanel.noJanusNote')}</span>}
                  </div>
                </div>
              ))}
              {(detailNode.features ?? []).length === 0 ? <div className="bp-feature-empty">{t('blueprint:detailPanel.noFeature')}</div> : null}
            </div>
          </div>

          <div className="bp-node-detail__section bp-node-detail__section--content">
            <div className="bp-node-detail__section-head">
              <label className="bp-node-detail__label">{t('blueprint:detailPanel.issueLog')}</label>
            </div>
            <div className="bp-feature-list">
              {(detailNode.issues ?? []).map((issue) => (
                <div className="bp-feature-card" key={issue.id}>
                  <div className="bp-feature-card__row">
                    <span className="bp-feature-card__title">{issue.title}</span>
                  </div>
                  <div className="bp-feature-card__readonly">
                    <span>{t(ISSUE_SEVERITY_LABEL_KEY[issue.severity])}</span>
                    <span>{t(ISSUE_STATUS_LABEL_KEY[issue.status])}</span>
                  </div>
                  {issue.description ? <p className="bp-feature-card__desc">{issue.description}</p> : null}
                </div>
              ))}
              {(detailNode.issues ?? []).length === 0 ? <div className="bp-feature-empty">{t('blueprint:detailPanel.noIssue')}</div> : null}
            </div>
          </div>

          <div className="bp-node-detail__section bp-node-detail__section--system">
            <div className="bp-node-detail__section-head">
              <label className="bp-node-detail__label">{t('blueprint:detailPanel.bindWorkspace')}</label>
            </div>
            <div className="bp-item-list">
              <div className="bp-item-card">
                <span className="bp-item-card__text">
                  {detailNode.workspaceId
                    ? (workspaceNameById[detailNode.workspaceId] ?? detailNode.workspaceSnapshot?.name ?? detailNode.workspaceId)
                    : t('blueprint:detailPanel.unbindWorkspace')}
                </span>
              </div>
            </div>
            {detailWorkspaceMissing ? (
              <div className="bp-node-detail__warning">
                {t('blueprint:detailPanel.workspaceMissing')}
                {detailNode.workspaceSnapshot ? ` ${t('blueprint:detailPanel.workspaceSnapshot', { name: detailNode.workspaceSnapshot.name, path: detailNode.workspaceSnapshot.path })}` : ''}
              </div>
            ) : null}
          </div>

          <div className="bp-node-detail__section bp-node-detail__section--system">
            <label className="bp-node-detail__label">{t('blueprint:detailPanel.mountPosition')}</label>
            <div className="bp-item-list">
              <div className="bp-item-card">
                <span className="bp-item-card__text">
                  {detailNode.parentId
                    ? (sourceBlueprint?.nodes[detailNode.parentId]?.title || detailNode.parentId)
                    : t('blueprint:detailPanel.asRoot')}
                </span>
              </div>
            </div>
          </div>

          <div className="bp-node-detail__meta">
            <div>
              <span>{t('blueprint:detailPanel.status')}</span>
              <strong>{t(getBlueprintStatusVisual(detailNode.status)?.labelKey ?? `blueprint:status.${detailNode.status}`)}</strong>
            </div>
            <div>
              <span>{t('blueprint:detailPanel.source')}</span>
              <strong>{detailNode.statusSource === 'janus' ? t('blueprint:statusSource.janus') : t('blueprint:statusSource.manual')}</strong>
            </div>
            {detailNode.sourceRelPath ? (
              <div>
                <span>{t('blueprint:detailPanel.sourceFile')}</span>
                <strong title={detailNode.sourceRelPath}>{detailNode.sourceRelPath}</strong>
              </div>
            ) : null}
            {detailNode.sourceHash ? (
              <div>
                <span>{t('blueprint:detailPanel.sourceHash')}</span>
                <strong title={detailNode.sourceHash}>{detailNode.sourceHash.length > 10 ? `${detailNode.sourceHash.slice(0, 6)}…${detailNode.sourceHash.slice(-4)}` : detailNode.sourceHash}</strong>
              </div>
            ) : null}
            <div>
              <span>{t('blueprint:detailPanel.analysisCursor')}</span>
              <strong>{detailNode.lastAnalyzedCommitSha ? detailNode.lastAnalyzedCommitSha.slice(0, 8) : '—'}</strong>
            </div>
          </div>

          <div className="bp-node-detail__section bp-node-detail__section--analysis">
            <div className="bp-node-detail__section-head">
              <label className="bp-node-detail__label">{t('blueprint:detailPanel.janusAnalysis')}</label>
              <span className="bp-node-detail__count">{detailNode.analyses?.length ?? 0}</span>
            </div>
            {latestAnalysis ? (
              <div className="bp-history-card">
                <div className="bp-history-card__title">{latestAnalysis.result.summary || latestAnalysis.error || t('blueprint:detailPanel.noSummary')}</div>
                <div className="bp-history-card__meta">
                  {t('blueprint:detailPanel.analysisMeta', {
                    date: new Date(latestAnalysis.createdAt).toLocaleString(),
                    trigger: t(TRIGGER_LABEL_KEY[latestAnalysis.trigger] ?? `blueprint:trigger.${latestAnalysis.trigger}`),
                    applied: latestAnalysis.applied ? t('blueprint:applied.yes') : t('blueprint:applied.no'),
                    confidence: t('blueprint:detailPanel.confidence', { percent: Math.round((latestAnalysis.result.confidence ?? 0) * 100) })
                  })}
                </div>
                {latestAnalysis.result.evidence?.length ? (
                  <ul className="bp-history-card__list">
                    {latestAnalysis.result.evidence.slice(0, 3).map((item) => <li key={item}>{item}</li>)}
                  </ul>
                ) : null}
                {latestAnalysis.result.unresolved?.length ? (
                  <ul className="bp-history-card__list bp-history-card__list--warn">
                    {latestAnalysis.result.unresolved.slice(0, 3).map((item) => <li key={item}>{item}</li>)}
                  </ul>
                ) : null}
                <div className="bp-history-card__actions">
                  <button className="blueprint-btn" onClick={() => toggleAnalysisHistory(detailNode)}>
                    {analysisHistoryOpen ? t('blueprint:action.collapseHistory') : t('blueprint:action.viewHistory')}
                  </button>
                  {analysisHistoryOpen ? (
                    <button className="blueprint-btn" onClick={() => loadAnalysisHistory(detailNode)} disabled={analysisHistoryLoading}>
                      {analysisHistoryLoading ? t('blueprint:action.refreshing') : t('blueprint:action.refresh')}
                    </button>
                  ) : null}
                </div>
              </div>
            ) : (
              <div className="bp-node-detail__empty">{t('blueprint:detailPanel.noAnalysis')}</div>
            )}
            {analysisHistoryOpen ? (
              <div className="bp-analysis-history">
                <div className="bp-analysis-history__list">
                  {analysisHistoryLoading ? <div className="bp-node-detail__empty">{t('blueprint:detailPanel.loadingHistory')}</div> : null}
                  {!analysisHistoryLoading && analysisHistory.length === 0 ? <div className="bp-node-detail__empty">{t('blueprint:detailPanel.noHistory')}</div> : null}
                  {analysisHistory.map((analysis) => (
                    <button
                      key={analysis.id}
                      className={`bp-analysis-history__item${selectedAnalysis?.id === analysis.id ? ' bp-analysis-history__item--active' : ''}`}
                      onClick={() => setSelectedAnalysisId(analysis.id)}
                    >
                      <span>{new Date(analysis.createdAt).toLocaleString()}</span>
                      <strong>{analysis.result.summary || analysis.error || t('blueprint:detailPanel.noSummary')}</strong>
                      <em>
                        {t(TRIGGER_LABEL_KEY[analysis.trigger] ?? `blueprint:trigger.${analysis.trigger}`)} · {t(getBlueprintStatusVisual(analysis.result.status)?.labelKey ?? `blueprint:status.${analysis.result.status}`)} · {analysis.result.progress}%
                      </em>
                    </button>
                  ))}
                </div>

                {selectedAnalysis ? (
                  <div className="bp-analysis-detail">
                    <div className="bp-analysis-detail__head">
                      <div>
                        <strong>{selectedAnalysis.result.summary || selectedAnalysis.error || t('blueprint:detailPanel.noSummary')}</strong>
                        <span>
                          {selectedAnalysis.applied ? t('blueprint:applied.yes') : t('blueprint:applied.no')} · {t('blueprint:detailPanel.confidence', { percent: Math.round((selectedAnalysis.result.confidence ?? 0) * 100) })}
                        </span>
                      </div>
                      <button
                        className="blueprint-btn"
                        onClick={() => reapplyAnalysis(detailNode, selectedAnalysis)}
                        disabled={!selectedAnalysis.applied || applyingAnalysisId === selectedAnalysis.id}
                      >
                        {applyingAnalysisId === selectedAnalysis.id ? t('blueprint:action.applying') : t('blueprint:action.reapply')}
                      </button>
                    </div>

                    <div className="bp-analysis-detail__grid">
                      <div><span>{t('blueprint:detailPanel.status')}</span><strong>{t(getBlueprintStatusVisual(selectedAnalysis.result.status)?.labelKey ?? `blueprint:status.${selectedAnalysis.result.status}`)}</strong></div>
                      <div><span>{t('blueprint:detailPanel.progress')}</span><strong>{selectedAnalysis.result.progress}%</strong></div>
                      <div><span>{t('blueprint:detailPanel.trigger')}</span><strong>{t(TRIGGER_LABEL_KEY[selectedAnalysis.trigger] ?? `blueprint:trigger.${selectedAnalysis.trigger}`)}</strong></div>
                      <div><span>{t('blueprint:detailPanel.time')}</span><strong>{new Date(selectedAnalysis.createdAt).toLocaleString()}</strong></div>
                    </div>

                    {selectedAnalysis.error ? <div className="bp-analysis-detail__error">{selectedAnalysis.error}</div> : null}

                    <div className="bp-analysis-detail__section">
                      <label>{t('blueprint:detailPanel.inputSummary')}</label>
                      <pre>{`${t('blueprint:detailPanel.blueprintExpected')}\n${selectedAnalysis.inputSummary.blueprint || t('blueprint:detailPanel.none')}\n\n${t('blueprint:detailPanel.actualChangesLabel')}\n${selectedAnalysis.inputSummary.actual || t('blueprint:detailPanel.none')}`}</pre>
                    </div>

                    {selectedAnalysis.result.evidence?.length ? (
                      <div className="bp-analysis-detail__section">
                        <label>{t('blueprint:detailPanel.evidence')}</label>
                        <ul>{selectedAnalysis.result.evidence.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul>
                      </div>
                    ) : null}

                    {selectedAnalysis.result.unresolved?.length ? (
                      <div className="bp-analysis-detail__section bp-analysis-detail__section--warn">
                        <label>{t('blueprint:detailPanel.unresolved')}</label>
                        <ul>{selectedAnalysis.result.unresolved.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul>
                      </div>
                    ) : null}

                    {selectedAnalysis.result.featureUpdates?.length ? (
                      <div className="bp-analysis-detail__section">
                        <label>{t('blueprint:detailPanel.featureUpdates')}</label>
                        <ul>
                          {selectedAnalysis.result.featureUpdates.map((item, index) => (
                            <li key={`${item.featureId}-${index}`}>
                              {item.featureId} · {item.status ? t(FEATURE_STATUS_LABEL_KEY[item.status] ?? `blueprint:featureStatus.${item.status}`) : t('blueprint:detailPanel.statusUnchanged')} · {item.progress ?? t('blueprint:detailPanel.progressUnchanged')}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}

                    {selectedAnalysis.result.discoveredRequirements?.length ? (
                      <div className="bp-analysis-detail__section">
                        <label>{t('blueprint:detailPanel.newRequirementProposal')}</label>
                        <ul>
                          {selectedAnalysis.result.discoveredRequirements.map((item, index) => (
                            <li key={`${item.title}-${index}`}>{item.title} · {Math.round(item.confidence * 100)}%</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="bp-node-detail__section">
            <div className="bp-node-detail__section-head">
              <label className="bp-node-detail__label">{t('blueprint:detailPanel.activityLog')}</label>
              <span className="bp-node-detail__count">{detailNode.activities?.length ?? 0}</span>
            </div>
            <div className="bp-activity-list">
              {(detailNode.activities ?? []).slice(-6).reverse().map((activity) => (
                <div className="bp-activity-item" key={activity.id}>
                  <span>{activity.type}</span>
                  <strong>{activity.content}</strong>
                  <em>{new Date(activity.createdAt).toLocaleString()}</em>
                </div>
              ))}
              {(detailNode.activities ?? []).length === 0 ? <div className="bp-node-detail__empty">{t('blueprint:detailPanel.noActivity')}</div> : null}
            </div>
          </div>

          </>)}
          </div>
        </aside>
        </BlueprintDetailMount>
      ) : null}
      <PromptDialog
        open={restoreLayoutConfirmOpen}
        title={t('blueprint:confirm.restoreLayoutTitle')}
        description={t('blueprint:confirm.restoreLayoutDesc')}
        confirmOnly
        confirmText={t('blueprint:confirm.restoreConfirm')}
        onConfirm={() => {
          setRestoreLayoutConfirmOpen(false)
          void restoreDefaultLayout().then(() => fitViewWhenReady(200))
        }}
        onCancel={() => setRestoreLayoutConfirmOpen(false)}
      />
    </div>
  )
}
