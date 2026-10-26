// Note: scoped module navigation — see .agents/notes/blueprint/navigation/requirements/module-browsing.md
import type { Blueprint } from '../../shared/janus/types'
import { resolveArchitectureNote, type ArchitectureProjection } from './architecture-view'

export const DOCUMENT_KINDS = ['note', 'idea', 'requirement', 'decision', 'task'] as const
export const UNASSIGNED_SCOPE = '@unassigned'
export interface ModuleDocumentGroup {
  id: string; moduleId: string; kind: string; nodeIds: string[]
  x: number; y: number; width: number; height: number
}

/** Ownership resolves within the selected checkout. References never confer ownership. */
export function moduleOwners(source: Blueprint, projection: ArchitectureProjection): Record<string, string> {
  const owners: Record<string, string> = {}
  for (const id of source.nodeIds) {
    if (projection.roles[id]) {
      const parent = projection.graph.nodes[id].parentId
      if (parent) owners[id] = parent
      continue
    }
    const node = source.nodes[id]
    if (!node) continue
    const ownerUri = node.note?.module ?? node.note?.metadata?.module
    if (ownerUri) {
      const owner = resolveArchitectureNote(source, id, ownerUri)
      if (owner && projection.roles[owner]) owners[id] = owner
      continue
    }
    // V1 documents used parent for ownership; v2 requires an explicit module.
    if (node.note?.metadata?.schema === 'harness-note/2') continue
    const seen = new Set([id])
    let cursor = id
    while (source.nodes[cursor]) {
      const current = source.nodes[cursor]
      const uri = current.note?.parent ?? current.note?.metadata?.parent
      const parent = uri ? resolveArchitectureNote(source, cursor, uri) : current.parentId
      if (!parent || seen.has(parent)) break
      if (projection.roles[parent]) { owners[id] = parent; break }
      seen.add(parent); cursor = parent
    }
  }
  return owners
}

export function moduleTrail(projection: ArchitectureProjection, id: string | null): string[] {
  const trail: string[] = [], seen = new Set<string>()
  let cursor = id
  while (cursor && projection.graph.nodes[cursor] && !seen.has(cursor)) {
    seen.add(cursor); trail.unshift(cursor)
    cursor = projection.graph.nodes[cursor].parentId
  }
  return trail
}

/** A disposable module root and its immediate children. Source data stays available to search/wiki. */
export function projectModuleBrowse(source: Blueprint, projection: ArchitectureProjection, scopeId: string | null) {
  const owners = moduleOwners(source, projection)
  const owned: Record<string, string[]> = Object.fromEntries(projection.graph.nodeIds.map(id => [id, []]))
  for (const id of source.nodeIds) if (!projection.roles[id] && owners[id]) owned[owners[id]].push(id)
  const unassigned = source.nodeIds.filter(id => !projection.roles[id] && !owners[id])
  const groups: ModuleDocumentGroup[] = []
  const roots = projection.graph.nodeIds.filter(id => !projection.graph.nodes[id].parentId)
  const homeModuleId = roots.length === 1 ? roots[0] : null
  if (!projection.graph.nodeIds.length) return { graph: source, groups, owners, owned, unassigned: [], scopeId: null, homeModuleId }
  if (scopeId === UNASSIGNED_SCOPE) {
    const graph: Blueprint = { ...source, nodeIds: unassigned,
      nodes: Object.fromEntries(unassigned.map(id => [id, { ...source.nodes[id], parentId: null, children: [] }])),
      rootNodeId: unassigned[0] ?? '', canvasLayout: {}, collapsedNodeIds: [],
      relations: source.relations.filter(edge => unassigned.includes(edge.sourceNodeId) && unassigned.includes(edge.targetNodeId)) }
    return { graph, groups, owners, owned, unassigned, scopeId, homeModuleId }
  }
  // A single root is already the home page; null and its id share one layout and navigation identity.
  const scope = projection.graph.nodes[scopeId ?? ''] ?? projection.graph.nodes[homeModuleId ?? '']
  const moduleIds = scope ? scope.children : roots.flatMap(id => [id, ...projection.graph.nodes[id].children])
  const documents = scope ? owned[scope.id] : []
  const nodeIds = [...new Set([...(scope ? [scope.id] : []), ...moduleIds, ...documents])]
  const graph: Blueprint = { ...projection.graph, nodeIds,
    nodes: Object.fromEntries(nodeIds.map(id => {
      const node = source.nodes[id]
      const parent = scope ? (id === scope.id ? null : scope.id) : projection.graph.nodes[id].parentId
      return [id, { ...node, parentId: parent, children: [] }]
    })),
    rootNodeId: scope?.id ?? roots[0] ?? '',
    canvasLayout: {}, collapsedNodeIds: [],
    relations: source.relations.filter(edge => nodeIds.includes(edge.sourceNodeId) && nodeIds.includes(edge.targetNodeId)),
  }
  for (const id of nodeIds) {
    const parent = graph.nodes[id].parentId
    if (parent && graph.nodes[parent]) graph.nodes[parent].children.push(id)
  }
  if (!scope) {
    let x = 0
    for (const root of roots) {
      const children = graph.nodes[root].children, width = Math.max(1, children.length) * 304
      graph.canvasLayout[root] = { x: x + width / 2 - 120, y: 0 }
      children.forEach((id, i) => { graph.canvasLayout[id] = { x: x + i * 304 + 32, y: 190 } })
      x += width + 100
    }
  } else {
    const childTop = 190
    moduleIds.forEach((id, i) => { graph.canvasLayout[id] = { x: i % 3 * 304 + 24, y: childTop + Math.floor(i / 3) * 164 } })
    const columns = [childTop + Math.ceil(moduleIds.length / 3) * 164 + 24, childTop + Math.ceil(moduleIds.length / 3) * 164 + 24]
    const kinds = [...DOCUMENT_KINDS, ...new Set(documents.map(id => source.nodes[id].note?.kind ?? source.nodes[id].kind ?? 'note').filter(kind => !DOCUMENT_KINDS.includes(kind as typeof DOCUMENT_KINDS[number])))]
    for (const kind of kinds) {
      const ids = documents.filter(id => (source.nodes[id].note?.kind ?? source.nodes[id].kind ?? 'note') === kind)
      if (!ids.length) continue
      const column = columns[0] <= columns[1] ? 0 : 1
      const group = { id: `${scope.id}:${kind}`, moduleId: scope.id, kind, nodeIds: ids,
        x: column * 604, y: columns[column], width: 568, height: 48 + Math.ceil(ids.length / 2) * 150 }
      groups.push(group)
      ids.forEach((id, i) => { graph.canvasLayout[id] = { x: group.x + 24 + i % 2 * 280, y: group.y + 40 + Math.floor(i / 2) * 150 } })
      columns[column] += group.height + 28
    }
    const width = Math.max(240, ...moduleIds.map(id => graph.canvasLayout[id].x + 240), ...groups.map(group => group.x + group.width))
    graph.canvasLayout[scope.id] = { x: width / 2 - 120, y: 0 }
  }
  return { graph, groups, owners, owned, unassigned, scopeId: scope?.id ?? null, homeModuleId }
}
