import type { BlueprintNode } from '../../shared/janus/types'

const idOrder = new Intl.Collator('en', { numeric: true })
const compareIds = (a: string, b: string): number => idOrder.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0)

/** View-only forest: keep explicit parents, cut one stable edge per cycle. */
export function buildEffectiveHierarchy(nodes: Record<string, BlueprintNode>): {
  roots: string[]
  parentById: Map<string, string>
  childrenByParent: Map<string, string[]>
} {
  const ids = Object.keys(nodes).sort(compareIds)
  const parentById = new Map<string, string>()
  for (const id of ids) {
    const parentId = nodes[id].parentId
    if (parentId && nodes[parentId]) parentById.set(id, parentId)
  }
  const resolved = new Set<string>()
  for (const id of ids) {
    const path: string[] = []
    const pathIndex = new Map<string, number>()
    let current: string | undefined = id
    while (current !== undefined && !resolved.has(current)) {
      const cycleStart = pathIndex.get(current)
      if (cycleStart !== undefined) {
        const representative = path.slice(cycleStart).sort(compareIds)[0]
        parentById.delete(representative)
        break
      }
      pathIndex.set(current, path.length)
      path.push(current)
      current = parentById.get(current)
    }
    path.forEach((entry) => resolved.add(entry))
  }
  const roots: string[] = []
  const childrenByParent = new Map<string, string[]>()
  for (const id of ids) {
    const parentId = parentById.get(id)
    if (parentId === undefined) roots.push(id)
    else {
      const children = childrenByParent.get(parentId) ?? []
      children.push(id)
      childrenByParent.set(parentId, children)
    }
  }
  return { roots, parentById, childrenByParent }
}

export function collectLocalHierarchyIds(nodes: Record<string, BlueprintNode>, nodeId: string, descendantDepth: number): Set<string> {
  const { parentById, childrenByParent } = buildEffectiveHierarchy(nodes)
  const out = new Set<string>([nodeId])
  let parentId = parentById.get(nodeId)
  while (parentId !== undefined) { out.add(parentId); parentId = parentById.get(parentId) }
  const visit = (id: string, depth: number) => {
    if (depth >= descendantDepth) return
    for (const childId of childrenByParent.get(id) ?? []) {
      if (nodes[childId] && !out.has(childId)) { out.add(childId); visit(childId, depth + 1) }
    }
  }
  visit(nodeId, 0)
  return out
}

export function visibleNodeIds(nodes: Record<string, BlueprintNode>, nodeIds: string[], collapsedNodeIds: Set<string>): string[] {
  const { parentById } = buildEffectiveHierarchy(nodes)
  return nodeIds.filter((id) => {
    if (!nodes[id]) return false
    let parentId = parentById.get(id)
    while (parentId) {
      if (collapsedNodeIds.has(parentId)) return false
      parentId = parentById.get(parentId)
    }
    return true
  })
}

export function stepMatchIndex(current: number, step: number, count: number): number {
  return count ? (Math.min(current, count - 1) + step + count) % count : 0
}

/** 大蓝图初始可见节点上限（超出则按层级预折叠） */
export const DEFAULT_COLLAPSE_MAX_VISIBLE = 24

/** 孤立根达到该数量时画布默认将其折叠（矩阵治理），用户可手动展开 */
export const ISOLATED_HIDE_THRESHOLD = 24

export interface BlueprintConnectivity {
  /** nodeId -> 连通分量序号（0 = 最大分量），同簇布局时相邻 */
  clusterOf: Map<string, number>
  /** 无父、无子且无任何关系/接口参与的根节点（确定性 id 序） */
  isolatedRootIds: string[]
}

/**
 * 按层级 + 关系 + 接口边求无向连通分量。
 * 全根图（如 189 节点 0 parent）下，同簇根在布局时相邻，
 * 144 个孤立根可整体折叠，巨大矩形矩阵收成可读块。
 * 纯函数：同输入必同输出，可单测。
 * Note: 矩阵治理的分组依据 — see .agents/notes/blueprint/navigation/tasks/blueprint-matrix-governance.md
 */
export function groupRootsByConnectivity(
  nodes: Record<string, BlueprintNode>,
  relations: ReadonlyArray<{ sourceNodeId?: string | null; targetNodeId?: string | null }> = [],
  interfaces: ReadonlyArray<{ nodeId: string; providerNodeId?: string | null }> = [],
): BlueprintConnectivity {
  const ids = Object.keys(nodes).sort(compareIds)
  const indexOf = new Map(ids.map((id, index) => [id, index]))
  const parent = ids.map((_, index) => index)
  const find = (x: number): number => {
    let root = x
    while (parent[root] !== root) root = parent[root]
    while (parent[x] !== root) { const next = parent[x]; parent[x] = root; x = next }
    return root
  }
  const union = (a: string | null | undefined, b: string | null | undefined): void => {
    if (!a || !b) return
    const ia = indexOf.get(a)
    const ib = indexOf.get(b)
    if (ia === undefined || ib === undefined) return
    const ra = find(ia)
    const rb = find(ib)
    if (ra !== rb) parent[rb] = ra
  }
  const { parentById, childrenByParent } = buildEffectiveHierarchy(nodes)
  for (const [id, parentId] of parentById) union(id, parentId)
  for (const rel of relations) union(rel.sourceNodeId, rel.targetNodeId)
  for (const port of interfaces) union(port.nodeId, port.providerNodeId)
  const members = new Map<number, string[]>()
  for (const id of ids) {
    const root = find(indexOf.get(id)!)
    const list = members.get(root) ?? []
    list.push(id)
    members.set(root, list)
  }
  const components = [...members.values()].sort((a, b) =>
    b.length - a.length || compareIds(a[0], b[0]))
  const clusterOf = new Map<string, number>()
  components.forEach((list, rank) => list.forEach((id) => clusterOf.set(id, rank)))
  const isolatedRootIds = components
    .filter((list) => list.length === 1)
    .map((list) => list[0])
    .filter((id) => !parentById.has(id) && !(childrenByParent.get(id)?.length))
    .sort(compareIds)
  return { clusterOf, isolatedRootIds }
}

/**
 * 大蓝图初次加载的预折叠集合：
 * 取累计可见节点数不超过 maxVisible 的最深完整层 D（至少保留根+第一层），
 * 折叠深度 ≥ D 的所有含子节点的节点，之后逐层展开。
 * 节点总数不超过 maxVisible 时不折叠。
 */
export function computeInitialCollapsedIds(
  nodes: Record<string, BlueprintNode>,
  nodeIds: string[],
  maxVisible = DEFAULT_COLLAPSE_MAX_VISIBLE
): Set<string> {
  const validIds = nodeIds.filter((id) => nodes[id])
  if (validIds.length <= maxVisible) return new Set()

  const { parentById, childrenByParent } = buildEffectiveHierarchy(nodes)
  const depthOf = new Map<string, number>()
  const depth = (id: string): number => {
    const known = depthOf.get(id)
    if (known !== undefined) return known
    const parentId = parentById.get(id)
    const value = parentId ? depth(parentId) + 1 : 0
    depthOf.set(id, value)
    return value
  }
  const countAtDepth: number[] = []
  for (const id of validIds) {
    const d = depth(id)
    countAtDepth[d] = (countAtDepth[d] ?? 0) + 1
  }

  let collapseDepth = 1
  let visible = (countAtDepth[0] ?? 0) + (countAtDepth[1] ?? 0)
  for (let d = 2; d < countAtDepth.length; d++) {
    if (visible + (countAtDepth[d] ?? 0) > maxVisible) break
    visible += countAtDepth[d] ?? 0
    collapseDepth = d
  }

  return new Set(validIds.filter((id) =>
    depth(id) >= collapseDepth && (childrenByParent.get(id)?.length ?? 0) > 0
  ))
}
