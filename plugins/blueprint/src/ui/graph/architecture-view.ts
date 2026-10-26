// Note: document-driven structure keeps decisions and task contracts independent — see .agents/notes/blueprint/navigation/document-driven-module-view.md
// Note: cross-module ownership and typed associations — see .agents/notes/blueprint/workspaces/architect-workspace-model.md
import type { Blueprint, BlueprintNode } from '../../shared/janus/types'
import type { CompositionDiagnostic, CompositionInterface } from '../../shared/blueprint-composition'

export type ArchitectureRole = 'project' | 'module'
const uuid = '[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}'
const noteUri = new RegExp(`^note://${uuid}/${uuid}$`, 'i')
export interface ArchitectureLink { type: string; sourceUri: string; targetUri: string; sourceNodeId: string; targetNodeId?: string; criteria?: string[]; scope?: string; reason?: string }
export interface ArchitectureAssociation { nodeId?: string; uri: string; via: string; links?: ArchitectureLink[] }
export interface ArchitectureProjection {
  graph: Blueprint
  roles: Record<string, ArchitectureRole>
  diagnostics: CompositionDiagnostic[]
  related: Record<string, ArchitectureAssociation[]>
}

/** Source checkout identity, never workspace bindings to implementation repositories. */
function sourceKey(graph: Blueprint, id: string): string {
  const member = graph.composition?.nodes[id]
  return member ? `${member.repoId ?? ''}|${member.checkoutId ?? ''}|${member.path}` : 'local'
}

function declaredParents(graph: Blueprint, id: string): string[] {
  const node = graph.nodes[id]
  return [...new Set([
    node?.note?.parent, node?.note?.metadata?.parent,
    ...(node?.note?.relations.filter(row => row.type === 'parent').map(row => row.target) ?? []),
    ...graph.relations.filter(row => row.type === 'parent' && row.sourceNodeId === id).map(row => row.targetUri ?? graph.nodes[row.targetNodeId]?.sourceUri),
  ].filter((uri): uri is string => !!uri))]
}

export function resolveArchitectureNote(graph: Blueprint, from: string, uri: string): string | undefined {
  const matches = graph.nodeIds.filter(id => graph.nodes[id]?.sourceUri === uri)
  const local = matches.filter(id => sourceKey(graph, id) === sourceKey(graph, from))
  if (local.length) return local.length === 1 ? local[0] : undefined
  const repo = uri.split('/')[2]
  const checkouts = graph.composition?.checkouts.filter(row => row.repoId === repo) ?? []
  if (checkouts.length) {
    const selected = checkouts.filter(row => row.selected)
    const chosen = selected.length === 1 ? selected[0] : !selected.length && checkouts.length === 1 ? checkouts[0] : undefined
    if (!chosen || chosen.status === 'unbound') return undefined
    const candidates = matches.filter(id => {
      const member = graph.composition?.nodes[id]
      return member?.repoId === chosen.repoId && member.checkoutId === chosen.checkoutId
    })
    return candidates.length === 1 ? candidates[0] : undefined
  }
  return matches.length === 1 ? matches[0] : undefined
}

/** Immutable, disposable projection. No parser, source mutation or persisted graph. */
export function projectArchitecture(source: Blueprint): ArchitectureProjection {
  const roles: Record<string, ArchitectureRole> = {}
  const diagnostics: CompositionDiagnostic[] = []
  const report = (code: string, nodeId: string, message: string, sourceUri?: string) => diagnostics.push({ code, nodeId, message, sourceUri })
  for (const id of source.nodeIds) {
    const node = source.nodes[id]
    if (!node) continue
    const tags = node.note?.tags ?? node.tags
    const kind = node.note?.kind ?? node.kind
    if (kind === 'module') {
      const metadata = node.note?.metadata
      if (node.note?.moduleState === 'retired' || ['rejected', 'archived'].includes(node.note?.lifecycle ?? node.lifecycle ?? '')) continue
      if (!node.sourceUri || !noteUri.test(node.sourceUri) || resolveArchitectureNote(source, id, node.sourceUri) !== id) {
        report('INVALID_ARCHITECTURE_IDENTITY', id, 'Missing or duplicate source identity'); continue
      }
      roles[id] = metadata?.role === 'project' ? 'project' : 'module'
      continue
    }
    const project = tags.includes('architecture:project'), module = tags.includes('architecture:module')
    if (!project && !module) continue
    if (tags.filter(tag => tag === 'architecture:project' || tag === 'architecture:module').length !== 1 || (node.note?.kind ?? node.kind) !== 'initiative') {
      report('INVALID_ARCHITECTURE_ROLE', id, 'Expected an initiative with exactly one architecture role'); continue
    }
    if (tags.includes('architecture:example') || (node.note?.lifecycle ?? node.lifecycle) !== 'accepted') continue
    if (!node.sourceUri || !noteUri.test(node.sourceUri) || (node.note && node.sourceUri.split('/')[3] !== node.note.id) || resolveArchitectureNote(source, id, node.sourceUri) !== id) {
      report('INVALID_ARCHITECTURE_IDENTITY', id, 'Missing or duplicate source identity'); continue
    }
    roles[id] = project ? 'project' : 'module'
  }
  const nodeIds = source.nodeIds.filter(id => roles[id])
  const nodes: Record<string, BlueprintNode> = Object.fromEntries(nodeIds.map(id => [id, { ...source.nodes[id], parentId: null, children: [] }]))
  const parentCandidates = new Map<string, string>()
  for (const id of nodeIds) {
    const parents = declaredParents(source, id)
    if (roles[id] === 'project') {
      if (parents.length) report('ARCHITECTURE_PROJECT_PARENT', id, 'Projects are roots; parent declaration is ignored', parents.join(', '))
      continue
    }
    if (parents.length > 1) {
      report('CONFLICTING_ARCHITECTURE_PARENT', id, 'Conflicting parent declarations; placement withheld', parents.join(', ')); continue
    }
    const uri = parents[0]
    const parent = uri ? resolveArchitectureNote(source, id, uri) : undefined
    if (!parent || !roles[parent]) report('UNRESOLVED_ARCHITECTURE_PARENT', id, 'Parent must resolve to a current project or module', uri ?? undefined)
    else parentCandidates.set(id, parent)
  }
  for (const [id, parent] of parentCandidates) {
    const seen = new Set([id]); let cursor: string | undefined = parent
    while (cursor && !seen.has(cursor)) { seen.add(cursor); cursor = parentCandidates.get(cursor) }
    if (cursor) report('CYCLIC_ARCHITECTURE_PARENT', id, 'Cyclic parent chain; placement withheld')
    else { nodes[id].parentId = parent; nodes[parent].children.push(id) }
  }
  const interfaces: CompositionInterface[] = []
  for (const id of nodeIds) {
    const declared = source.nodes[id].note?.metadata?.interfaces
    const ports = declared?.map((port, index) => ({ ...port, id: `${id}:architecture:${index}`, nodeId: id }))
      ?? source.composition?.interfaces.filter(port => port.nodeId === id) ?? []
    for (const port of ports) interfaces.push({ ...port, providerNodeId: undefined, status: port.direction === 'provides' ? 'idle' : 'dangling' })
  }
  for (const port of interfaces.filter(port => port.direction === 'needs')) {
    const provider = port.provider ? resolveArchitectureNote(source, port.nodeId, port.provider) : undefined
    const matches = interfaces.filter(other => other.nodeId === provider && other.direction === 'provides' && other.name === port.name)
    if (!provider || !roles[provider] || matches.length !== 1 || source.composition?.nodes[provider]?.status === 'unbound' || source.composition?.nodes[port.nodeId]?.status === 'unbound') {
      report('UNRESOLVED_ARCHITECTURE_INTERFACE', port.nodeId, `Interface requires one explicit matching provider: ${port.name}`, port.provider); continue
    }
    port.providerNodeId = provider
    port.status = source.composition?.nodes[provider]?.status === 'stale' || source.composition?.nodes[port.nodeId]?.status === 'stale' ? 'stale' : 'connected'
    matches[0].status = port.status
  }
  const related: Record<string, ArchitectureAssociation[]> = Object.fromEntries(nodeIds.map(id => [id, []]))
  const ancestors = (id: string): string[] => {
    const result: string[] = [], seen = new Set<string>()
    let cursor: string | undefined = id
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor)
      if (roles[cursor]) {
        result.push(cursor)
        cursor = nodes[cursor].parentId ?? undefined
        continue
      }
      const node: BlueprintNode | undefined = source.nodes[cursor]
      const ownerUri = node?.note?.module ?? node?.note?.metadata?.module
      if (ownerUri || node?.note?.metadata?.schema === 'harness-note/2') {
        cursor = ownerUri ? resolveArchitectureNote(source, cursor, ownerUri) : undefined
        continue
      }
      const parents = declaredParents(source, cursor)
      cursor = parents.length === 1 ? resolveArchitectureNote(source, cursor, parents[0]) : parents.length > 1 ? undefined : node?.parentId ?? undefined
    }
    return result
  }
  const add = (module: string, id: string | undefined, uri: string, via: string, link?: ArchitectureLink) => {
    if (id === module || id && !roles[id] && !['note', 'idea', 'decision', 'task', 'requirement'].includes(source.nodes[id]?.note?.kind ?? source.nodes[id]?.kind ?? '')) return
    // Ownership traversal does not list every nested module as an associated document.
    if (id && roles[id] && !link) return
    let row = related[module].find(row => id ? row.nodeId === id : row.uri === uri)
    if (!row) { row = { nodeId: id, uri, via }; related[module].push(row) }
    if (link) {
      row.links ??= []
      if (!row.links.some(existing => JSON.stringify(existing) === JSON.stringify(link))) row.links.push(link)
    }
  }
  const associate = (id: string, targetUri: string, type: string, details: Pick<ArchitectureLink, 'criteria' | 'scope' | 'reason'> = {}) => {
    const sourceUri = source.nodes[id]?.sourceUri
    if (!sourceUri) return
    const target = resolveArchitectureNote(source, id, targetUri)
    const link: ArchitectureLink = { type, sourceUri, targetUri, sourceNodeId: id, ...(target ? { targetNodeId: target } : {}), ...details }
    for (const module of ancestors(id)) add(module, target, targetUri, type, link)
    if (target) for (const module of ancestors(target)) add(module, id, sourceUri, type, link)
  }
  for (const id of source.nodeIds) {
    const node = source.nodes[id]
    if (!node) continue
    const ownerUri = node.note?.module ?? node.note?.metadata?.module
    const owner = ownerUri ? resolveArchitectureNote(source, id, ownerUri) : undefined
    if (owner && roles[owner]) add(owner, id, node.sourceUri ?? id, 'module')
    for (const module of ancestors(id)) if (module !== id) add(module, id, node.sourceUri ?? id, 'parent')
    const relations = [
      ...(node.note?.relations ?? []),
      ...source.relations.filter(edge => edge.sourceNodeId === id).map(edge => ({ type: edge.type, target: edge.targetUri ?? source.nodes[edge.targetNodeId]?.sourceUri ?? edge.targetNodeId,
        ...(edge.criteria ? { criteria: edge.criteria } : {}), ...(edge.scope ? { scope: edge.scope } : {}), ...(edge.reason ? { reason: edge.reason } : {}),
      })),
    ]
    for (const relation of relations) {
      if (relation.type === 'parent') continue
      associate(id, relation.target, relation.type, {
        ...(relation.criteria ? { criteria: relation.criteria } : {}), ...(relation.scope ? { scope: relation.scope } : {}), ...(relation.reason ? { reason: relation.reason } : {}),
      })
    }
    for (const ref of node.note?.metadata?.work?.acceptanceRefs ?? []) {
      associate(id, ref.uri, 'acceptance', { criteria: [ref.criterionId] })
    }
    const member = source.composition?.nodes[id]
    const snapshot = member?.layer === 'evidence'
      ? source.composition?.checkouts.find(row => row.repoId === member.repoId && row.checkoutId === member.checkoutId)?.snapshot
      : source.noteSnapshot
    for (const mention of snapshot?.mentions ?? []) {
      if (mention.sourceUri !== node.sourceUri) continue
      const target = mention.targetUri ?? mention.destinations.find(destination => noteUri.test(destination))
      if (target) associate(id, target, 'reference')
    }
  }
  const composition = { version: 'r4' as const, checkouts: source.composition?.checkouts ?? [], nodes: source.composition?.nodes ?? {}, interfaces, evidence: source.composition?.evidence ?? [], diagnostics: [...(source.composition?.diagnostics ?? []), ...diagnostics] }
  return { graph: { ...source, nodes, nodeIds, rootNodeId: nodeIds.find(id => roles[id] === 'project') ?? nodeIds[0] ?? '', relations: [], composition, canvasLayout: {}, collapsedNodeIds: [] }, roles, diagnostics, related }
}
