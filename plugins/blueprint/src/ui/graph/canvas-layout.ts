import type { Edge, Node } from '@xyflow/react'
import type { Blueprint, BlueprintNode } from '../../shared/janus/types'
import type { BlueprintNodeData } from '../../shared/card'
import { buildEffectiveHierarchy, groupRootsByConnectivity } from './canvas-navigation'
import { nodeNoteSnapshot } from './composition-view'
import { blueprintNoteStatusParts } from '../../shared/blueprint-note-status'

const SEVERITY_RANK = { low: 0, medium: 1, high: 2, critical: 3 } as const
const SEVERITY_LABEL = ['低', '中', '高', '严重'] as const

interface BlueprintGraphIndex {
  childrenByParent: Map<string, string[]>
  descendantsById: Map<string, BlueprintNode[]>
}

function buildBlueprintGraphIndex(blueprint: Blueprint): BlueprintGraphIndex {
  const { childrenByParent } = buildEffectiveHierarchy(blueprint.nodes)
  const descendantsById = new Map<string, BlueprintNode[]>()
  const collect = (id: string): BlueprintNode[] => {
    const cached = descendantsById.get(id)
    if (cached) return cached
    const descendants: BlueprintNode[] = []
    for (const childId of childrenByParent.get(id) ?? []) {
      const child = blueprint.nodes[childId]
      if (child) descendants.push(child, ...collect(childId))
    }
    descendantsById.set(id, descendants)
    return descendants
  }
  for (const id of blueprint.nodeIds) collect(id)
  return { childrenByParent, descendantsById }
}

export function deriveBlueprintCardData(
  blueprint: Blueprint,
  node: BlueprintNode,
  workspaceNameById: Record<string, string>,
  focused: boolean,
  focusActive: boolean,
  collapsed: boolean,
  index: BlueprintGraphIndex = buildBlueprintGraphIndex(blueprint),
): BlueprintNodeData {
  const openIssues = (node.issues ?? []).filter((issue) => issue.status === 'open')
  const highestSeverity = openIssues.reduce((highest, issue) => Math.max(highest, SEVERITY_RANK[issue.severity]), -1)
  const latest = node.analyses?.at(-1)
  const analysisAge = latest ? Math.max(0, Math.round((Date.now() - new Date(latest.createdAt).getTime()) / 86400000)) : 0
  const descendants = collapsed ? index.descendantsById.get(node.id) ?? [] : []
  const children = index.childrenByParent.get(node.id) ?? []
  const subtreeOpenIssues = descendants.flatMap((item) => item.issues ?? []).filter((issue) => issue.status === 'open')
  const subtreeDone = descendants.filter((item) => item.status === 'done').length
  return {
    title: node.title,
    status: node.status,
    nodeType: node.type,
    kind: node.kind ?? null,
    moduleState: node.note?.moduleState,
    noteStatus: blueprintNoteStatusParts(node),
    reviewRoot: nodeNoteSnapshot(blueprint, node.id)?.coverage.checkoutRoot,
    noteId: node.note?.id ?? node.sourceUri?.split('/').at(-1),
    progress: node.progress,
    workspaceName: node.workspaceId ? workspaceNameById[node.workspaceId] ?? node.workspaceSnapshot?.name ?? null : null,
    boundTerminalId: node.boundTerminalId,
    childCount: children.length,
    collapsed,
    childSummary: children.length ? `${children.filter((id) => blueprint.nodes[id]?.status === 'done').length}/${children.length} 子项完成` : undefined,
    issueSummary: openIssues.length ? `${openIssues.length} 问题 · ${SEVERITY_LABEL[highestSeverity]}` : undefined,
    blockedReason: node.status === 'blocked' ? (openIssues[0]?.title || '状态阻塞') : undefined,
    analysisSummary: latest ? `分析 ${Math.round((latest.result.confidence ?? 0) * 100)}% · ${analysisAge === 0 ? '今日' : `${analysisAge}天前`}` : undefined,
    collapsedSummary: collapsed && descendants.length ? `已折叠 ${descendants.length} · ${subtreeDone}/${descendants.length} 完成${subtreeOpenIssues.length ? ` · ${subtreeOpenIssues.length} 风险` : ''}` : undefined,
    searchMatched: focusActive && focused,
    searchDimmed: focusActive && !focused,
  }
}

const NODE_W = 240
const NODE_H = 110
const X_GAP = 32
const Y_GAP = 64
/** 网格行距比层级行距更紧凑，让同父叶子读作一个分组块 */
const GRID_ROW_GAP = 48
/** 兄弟子树之间的额外间距，用于视觉分组 */
const SUBTREE_GAP = 64
/** 独立根树之间的间距 */
const ROOT_GAP = 120
const ROOT_MAX_COLS = 4
const GRID_MAX_COLS = 4
const ROW_PITCH = NODE_H + Y_GAP
const GRID_ROW_PITCH = NODE_H + GRID_ROW_GAP
const layoutCache = new Map<string, Record<string, { x: number; y: number }>>()
/** Bound the layout cache: signatures churn while dragging, entries are cheap to recompute. */
const LAYOUT_CACHE_LIMIT = 64

function layoutSignature(
  collapsedNodeIds: Set<string>,
  overrides: Blueprint['canvasLayout'],
  extraHidden?: ReadonlySet<string>,
  relationsKey?: string,
): string {
  const collapsed = [...collapsedNodeIds].sort().join(',')
  const positions = Object.entries(overrides ?? {})
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([id, point]) => `${id}:${point.x},${point.y}`)
    .join('|')
  const hidden = extraHidden ? [...extraHidden].sort().join(',') : ''
  return `${collapsed}::${positions}::${hidden}::${relationsKey ?? ''}`
}

/** 叶子网格列数：接近正方形，上限 GRID_MAX_COLS，避免画布单向铺开 */
function gridColumns(count: number): number {
  return Math.max(1, Math.min(GRID_MAX_COLS, Math.ceil(Math.sqrt(count))))
}

function gridBlockWidth(count: number): number {
  const cols = gridColumns(count)
  return cols * NODE_W + (cols - 1) * X_GAP
}

/** 无任何关联的孤立根数量（矩阵治理开关的计数来源） */
export function countIsolatedRoots(blueprint: Blueprint): number {
  return groupRootsByConnectivity(
    blueprint.nodes,
    blueprint.relations ?? [],
    blueprint.composition?.interfaces ?? [],
  ).isolatedRootIds.length
}

export function computeBlueprintLayout(
  nodes: Record<string, BlueprintNode>,
  rootNodeId: string,
  canvasLayout: Blueprint['canvasLayout'],
  rootRank?: ReadonlyMap<string, number>,
): Record<string, { x: number; y: number }> {
  const { childrenByParent, roots } = buildEffectiveHierarchy(nodes)
  roots.sort((a, b) => {
    if (a === rootNodeId) return -1
    if (b === rootNodeId) return 1
    // 同簇根相邻：大分量在前，无关根沉底（矩阵变簇块）
    const rank = (rootRank?.get(a) ?? Number.POSITIVE_INFINITY) - (rootRank?.get(b) ?? Number.POSITIVE_INFINITY)
    return rank === 0 ? 0 : rank
  })

  const splitChildren = (id: string) => {
    const children = childrenByParent.get(id) ?? []
    return {
      branches: children.filter((childId) => (childrenByParent.get(childId)?.length ?? 0) > 0),
      leaves: children.filter((childId) => (childrenByParent.get(childId)?.length ?? 0) === 0)
    }
  }

  const widths: Record<string, number> = {}
  const heights: Record<string, number> = {}
  const measure = (id: string): number => {
    const { branches, leaves } = splitChildren(id)
    const units = branches.map(measure)
    if (leaves.length) units.push(gridBlockWidth(leaves.length))
    widths[id] = units.length
      ? Math.max(NODE_W, units.reduce((sum, width) => sum + width, 0) + SUBTREE_GAP * (units.length - 1))
      : NODE_W
    const childHeights = branches.map((childId) => heights[childId])
    if (leaves.length) childHeights.push(NODE_H + (Math.ceil(leaves.length / gridColumns(leaves.length)) - 1) * GRID_ROW_PITCH)
    heights[id] = childHeights.length ? ROW_PITCH + Math.max(...childHeights) : NODE_H
    return widths[id]
  }

  const positions: Record<string, { x: number; y: number }> = {}
  const place = (id: string, left: number, y: number): void => {
    const width = widths[id]
    const { branches, leaves } = splitChildren(id)
    if (!branches.length && !leaves.length) {
      positions[id] = { x: left + (width - NODE_W) / 2, y }
      return
    }
    const unitWidths = branches.map((childId) => widths[childId])
    if (leaves.length) unitWidths.push(gridBlockWidth(leaves.length))
    const unitsTotal = unitWidths.reduce((sum, unitWidth) => sum + unitWidth, 0) + SUBTREE_GAP * (unitWidths.length - 1)
    let cursor = left + (width - unitsTotal) / 2
    let extentLeft = Number.POSITIVE_INFINITY
    let extentRight = Number.NEGATIVE_INFINITY
    const track = (x: number) => {
      extentLeft = Math.min(extentLeft, x)
      extentRight = Math.max(extentRight, x + NODE_W)
    }
    for (const childId of branches) {
      place(childId, cursor, y + ROW_PITCH)
      track(positions[childId].x)
      cursor += widths[childId] + SUBTREE_GAP
    }
    if (leaves.length) {
      const cols = gridColumns(leaves.length)
      leaves.forEach((leafId, index) => {
        const position = {
          x: cursor + (index % cols) * (NODE_W + X_GAP),
          y: y + ROW_PITCH + Math.floor(index / cols) * GRID_ROW_PITCH
        }
        positions[leafId] = position
        track(position.x)
      })
    }
    positions[id] = { x: (extentLeft + extentRight) / 2 - NODE_W / 2, y }
  }

  roots.forEach(measure)
  // Pack whole tree bounds onto shelves; the tallest tree controls row height.
  const area = roots.reduce((sum, id) => sum + (widths[id] + ROOT_GAP) * (heights[id] + ROOT_GAP), 0)
  const rowWidth = Math.max(NODE_W, ...roots.map((id) => widths[id]), Math.sqrt(area * 1.6) - ROOT_GAP)
  let rootLeft = 0
  let rootTop = 0
  let rowHeight = 0
  let columns = 0
  for (const rootId of roots) {
    if (columns && (columns >= ROOT_MAX_COLS || rootLeft + widths[rootId] > rowWidth)) {
      rootLeft = 0
      rootTop += rowHeight + ROOT_GAP
      rowHeight = 0
      columns = 0
    }
    place(rootId, rootLeft, rootTop)
    rootLeft += widths[rootId] + ROOT_GAP
    rowHeight = Math.max(rowHeight, heights[rootId])
    columns++
  }
  for (const id of Object.keys(canvasLayout ?? {})) {
    if (nodes[id] && canvasLayout?.[id]) positions[id] = canvasLayout[id]
  }
  return positions
}

/** 收集 nodeId 及其全部后代（含 nodeId 自身） */
export function collectSubtreeIds(blueprint: Blueprint, nodeId: string): Set<string> {
  const subtreeIds = new Set<string>()
  const childrenByParent = buildBlueprintGraphIndex(blueprint).childrenByParent
  const visit = (id: string) => {
    if (subtreeIds.has(id) || !blueprint.nodes[id]) return
    subtreeIds.add(id)
    for (const childId of childrenByParent.get(id) ?? []) visit(childId)
  }
  visit(nodeId)
  return subtreeIds
}

/** 折叠集合展开为被隐藏的后代 id 集合 */
export function collectHiddenNodeIds(blueprint: Blueprint, collapsedNodeIds: Set<string>): Set<string> {
  const hidden = new Set<string>()
  const childrenByParent = buildBlueprintGraphIndex(blueprint).childrenByParent
  const queue = [...collapsedNodeIds]
  while (queue.length) {
    const id = queue.shift()!
    for (const childId of childrenByParent.get(id) ?? []) {
      if (!hidden.has(childId)) { hidden.add(childId); queue.push(childId) }
    }
  }
  return hidden
}

/** 只对折叠后可见的树计算布局，折叠子树时画布随之收紧 */
export function computeVisibleBlueprintLayout(
  blueprint: Blueprint,
  collapsedNodeIds: Set<string>,
  overrides: Blueprint['canvasLayout'],
  index: BlueprintGraphIndex = buildBlueprintGraphIndex(blueprint),
  extraHidden?: ReadonlySet<string>,
): Record<string, { x: number; y: number }> {
  const relationsKey = JSON.stringify([
    (blueprint.relations ?? []).map((rel) => [rel.sourceNodeId, rel.type, rel.targetNodeId]),
    (blueprint.composition?.interfaces ?? []).map((port) => [port.nodeId, port.providerNodeId]),
  ])
  const signature = layoutSignature(collapsedNodeIds, overrides, extraHidden, relationsKey)
  // Note: the cache used to be a WeakMap keyed by the blueprint object, but
  // every IPC load deserializes a fresh object, so it never hit. Key by
  // stable identity plus content instead; nodeIds join the key because the
  // signature alone does not cover membership changes.
  const cacheKey = `${blueprint.id}::${[...blueprint.nodeIds].sort().join(',')}::${signature}`
  const cached = layoutCache.get(cacheKey)
  if (cached) return cached
  const hidden = new Set<string>()
  const queue = [...collapsedNodeIds]
  while (queue.length) {
    const id = queue.shift()!
    for (const childId of index.childrenByParent.get(id) ?? []) {
      if (!hidden.has(childId)) { hidden.add(childId); queue.push(childId) }
    }
  }
  const visibleNodes: Record<string, BlueprintNode> = {}
  for (const id of blueprint.nodeIds) {
    if (!hidden.has(id) && !extraHidden?.has(id) && blueprint.nodes[id]) visibleNodes[id] = blueprint.nodes[id]
  }
  const { clusterOf } = groupRootsByConnectivity(
    blueprint.nodes,
    blueprint.relations ?? [],
    blueprint.composition?.interfaces ?? [],
  )
  const layout = computeBlueprintLayout(visibleNodes, blueprint.rootNodeId, overrides ?? {}, clusterOf)
  if (layoutCache.size >= LAYOUT_CACHE_LIMIT) layoutCache.clear()
  layoutCache.set(cacheKey, layout)
  return layout
}

export function computeBlueprintSubtreeLayout(
  blueprint: Blueprint,
  nodeId: string,
  current: Record<string, { x: number; y: number }>,
): Record<string, { x: number; y: number }> {
  if (!blueprint.nodes[nodeId]) return current
  const subtreeIds = collectSubtreeIds(blueprint, nodeId)

  const defaults = computeBlueprintLayout(
    blueprint.nodes,
    blueprint.rootNodeId,
    {},
    groupRootsByConnectivity(
      blueprint.nodes,
      blueprint.relations ?? [],
      blueprint.composition?.interfaces ?? [],
    ).clusterOf,
  )
  const anchor = current[nodeId] ?? defaults[nodeId] ?? { x: 0, y: 0 }
  const defaultAnchor = defaults[nodeId] ?? { x: 0, y: 0 }
  const next = { ...current }
  for (const id of subtreeIds) {
    const position = defaults[id]
    if (position) next[id] = {
      x: anchor.x + position.x - defaultAnchor.x,
      y: anchor.y + position.y - defaultAnchor.y,
    }
  }
  return next
}

export function deriveBlueprintFlow(
  blueprint: Blueprint,
  overrides: Blueprint['canvasLayout'] | undefined,
  workspaceNameById: Record<string, string>,
  focusedNodeIds: Set<string>,
  focusActive: boolean,
  collapsedNodeIds: Set<string> = new Set(),
  options: { extraHidden?: ReadonlySet<string> } = {},
): { nodes: Node<BlueprintNodeData, 'blueprint'>[]; edges: Edge[] } {
  const index = buildBlueprintGraphIndex(blueprint)
  const hidden = new Set<string>(options.extraHidden ?? [])
  const hideDescendants = (id: string) => (index.childrenByParent.get(id) ?? []).forEach((childId) => {
    if (!hidden.has(childId)) { hidden.add(childId); hideDescendants(childId) }
  })
  collapsedNodeIds.forEach(hideDescendants)
  const layout = computeVisibleBlueprintLayout(blueprint, collapsedNodeIds, overrides ?? blueprint.canvasLayout ?? {}, index, hidden)
  const nodes: Node<BlueprintNodeData, 'blueprint'>[] = blueprint.nodeIds
    .filter((id) => !hidden.has(id))
    .filter((id) => blueprint.nodes[id])
    .map((id) => {
      const node = blueprint.nodes[id]
      const focused = focusedNodeIds.has(id)
      return {
        id,
        type: 'blueprint',
        position: layout[id] ?? { x: 0, y: 0 },
        data: deriveBlueprintCardData(blueprint, node, workspaceNameById, focused, focusActive, collapsedNodeIds.has(id), index),
      }
    })
  const edges: Edge[] = blueprint.nodeIds
    .filter((id) => !hidden.has(id))
    .filter((id) => {
      const node = blueprint.nodes[id]
      return node && node.parentId && blueprint.nodes[node.parentId] && !hidden.has(node.parentId)
    })
    .map((id) => ({
      id: `e-${blueprint.nodes[id].parentId}->${id}`,
      source: blueprint.nodes[id].parentId as string,
      target: id,
      type: 'blueprintHierarchy',
      className: 'bp-flow-edge--hierarchy',
      data: { kind: 'hierarchy' },
      interactionWidth: 24,
      style: {
        // 主题令牌：dark 墨灰可读，planche 纸上自动转为墨线（硬编码白在纸上隐形）。
        stroke: 'var(--shell-muted)',
        strokeWidth: 1.6
      },
    }))
  // Relation edges: gray dashed by type (depends-on 5 4 / implements 2 3 /
  // related-to 5 5). Pairs already joined by a parent edge are skipped to
  // avoid double-drawing the same link.
  const parentPairs = new Set(
    edges.map((edge) => [edge.source, edge.target].sort().join('|'))
  )
  const relationEdges: Edge[] = (blueprint.relations ?? [])
    .filter((rel) => {
      if (!rel.sourceNodeId || !rel.targetNodeId || rel.sourceNodeId === rel.targetNodeId) return false
      if (hidden.has(rel.sourceNodeId) || hidden.has(rel.targetNodeId)) return false
      if (!blueprint.nodes[rel.sourceNodeId] || !blueprint.nodes[rel.targetNodeId]) return false
      return !parentPairs.has([rel.sourceNodeId, rel.targetNodeId].sort().join('|'))
    })
    .map((rel) => ({
      id: `e-rel-${rel.sourceNodeId}-${rel.type}-${rel.targetNodeId}`,
      source: rel.sourceNodeId,
      target: rel.targetNodeId,
      type: 'blueprintAdaptive',
      className: 'bp-flow-edge--relation',
      data: { kind: 'relation' },
      interactionWidth: 16,
      style: {
        // 主题令牌：关系虚线吃 muted， faint 由 .bp-flow-edge--relation 的
        // stroke-opacity 0.55 表达（明暗主题自动适配）。
        stroke: 'var(--shell-muted)',
        strokeWidth: 1.5,
        strokeDasharray: relationDash(rel.type)
      },
    }))
  const interfaceEdges: Edge[] = (blueprint.composition?.interfaces ?? [])
    .filter(port => port.direction === 'needs' && port.providerNodeId && !hidden.has(port.nodeId) && !hidden.has(port.providerNodeId))
    .map(port => ({ id: 'e-interface-' + port.id, source: port.providerNodeId!, target: port.nodeId, type: 'blueprintAdaptive', className: 'bp-flow-edge--interface', data: { kind: 'interface' }, label: port.name, interactionWidth: 16,
      style: { stroke: port.status === 'stale' ? '#eab15f' : '#e78b63', strokeWidth: 1.6, strokeDasharray: '6 3' } }))
  return { nodes, edges: [...edges, ...relationEdges, ...interfaceEdges] }
}

/** Canvas dash language, mirrored by the legend in BlueprintCanvas. */
export function relationDash(type: string): string {
  switch (type) {
    case 'depends-on':
      return '5 4'
    case 'implements':
      return '2 3'
    case 'related-to':
    default:
      return '5 5'
  }
}
