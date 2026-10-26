// Note: explicit checkouts compose outside source parsing — see .agents/notes/blueprint/workspaces/tasks/blueprint-r4.md
import { createHash } from 'node:crypto'
import type { Blueprint, BlueprintNode, BlueprintRelation } from '../../shared/janus/types'
import type { NoteReadSnapshot } from '@janus-agent/harness-node'
import type { BlueprintComposition, CompositionStatus } from '../../shared/blueprint-composition'

export interface BlueprintCheckoutInput {
  repoId: string | null
  checkoutId: string
  path: string
  selected?: boolean
  name?: string
  blueprint?: Blueprint
  snapshot?: NoteReadSnapshot
  revision?: number
  bound?: boolean
  stale?: boolean
  dirty?: boolean
  diagnostic?: string
  expectedSourceHashes?: Record<string, string>
}
export interface BlueprintCompositionInput { skeleton: Blueprint; checkouts: readonly BlueprintCheckoutInput[]; localOnly?: boolean }
export type BlueprintCompositionOutput = Blueprint & { composition: BlueprintComposition }
export function checkoutKey(repoId: string | null, checkoutId: string): string { return (repoId ?? '') + '::' + checkoutId }
export function compositionNodeId(repoId: string | null, checkoutId: string, uri: string): string {
  return 'checkout:' + encodeURIComponent(checkoutId) + ':' + createHash('sha256').update(checkoutKey(repoId, checkoutId) + '\0' + uri).digest('hex').slice(0, 20)
}
const uriRepo = (uri?: string): string | undefined => uri?.startsWith('note://') && uri.split('/').length === 4 ? uri.split('/')[2] : undefined

/** Pure assembly: no scan, registry guessing, derived frontmatter, or writes. */
export function composeBlueprint({ skeleton: input, checkouts: inputCheckouts, localOnly = false }: BlueprintCompositionInput): BlueprintCompositionOutput {
  const inputs = localOnly ? [] : inputCheckouts
  const blueprint = structuredClone(input)
  const composition: BlueprintComposition = { version: 'r4', checkouts: [], nodes: {}, interfaces: [], evidence: [], diagnostics: [] }
  const rootRepo = blueprint.noteSnapshot?.repoId ?? uriRepo(blueprint.nodes[blueprint.rootNodeId]?.sourceUri) ?? null
  const rootPath = blueprint.noteSnapshot?.coverage.checkoutRoot ?? blueprint.nodes[blueprint.rootNodeId]?.workspaceSnapshot?.path ?? ''
  const rootByUri = new Map(blueprint.nodeIds.flatMap(id => blueprint.nodes[id]?.sourceUri ? [[blueprint.nodes[id].sourceUri!, id] as const] : []))
  const byCheckout = new Map<string, Map<string, string>>()
  const sourceFor = new Map<string, BlueprintCheckoutInput | undefined>()
  const checkouts: BlueprintCheckoutInput[] = []
  const duplicate = new Set<string>()
  const seen = new Set<string>()
  for (const row of inputs) {
    const key = checkoutKey(row.repoId, row.checkoutId)
    if (seen.has(key)) duplicate.add(key)
    seen.add(key)
  }
  for (const row of inputs) {
    const key = checkoutKey(row.repoId, row.checkoutId)
    if (checkouts.some(item => checkoutKey(item.repoId, item.checkoutId) === key)) continue
    const invalid = duplicate.has(key) || !row.repoId || !row.checkoutId || !row.path || row.bound === false || !row.blueprint
    checkouts.push(invalid ? { ...row, bound: false, blueprint: undefined, snapshot: undefined } : row)
    if (duplicate.has(key)) composition.diagnostics.push({ code: 'DUPLICATE_CHECKOUT', checkoutId: row.checkoutId, message: 'Conflicting checkout records; projection withheld: ' + key })
  }
  // A target repo resolves only through a single explicit selection or a unique binding.
  const select = (repoId: string): BlueprintCheckoutInput | undefined => {
    const candidates = checkouts.filter(row => row.repoId === repoId)
    const selected = candidates.filter(row => row.selected)
    const chosen = selected.length === 1 ? selected[0] : selected.length === 0 && candidates.length === 1 ? candidates[0] : undefined
    return chosen?.bound === false ? undefined : chosen
  }
  for (const id of blueprint.nodeIds) {
    const node = blueprint.nodes[id]
    if (!node) continue
    const targetRepo = node.note?.metadata?.repositories?.primary
    const binding = targetRepo ? select(targetRepo) : undefined
    const local = targetRepo === rootRepo
    // A local Note stays readable even when its implementation repository is outside this workspace.
    const status: CompositionStatus = !localOnly && targetRepo && !binding && !local ? 'unbound' : 'bound'
    composition.nodes[id] = { layer: 'skeleton', status, repoId: rootRepo, path: rootPath, sourceUri: node.sourceUri,
      ...(binding ? { binding: { repoId: binding.repoId!, checkoutId: binding.checkoutId, path: binding.path } } : {}) }
    if (binding) node.workspaceSnapshot = { name: binding.name ?? targetRepo!, path: binding.path }
    if (status === 'unbound') composition.diagnostics.push({ code: 'UNBOUND_MODULE', nodeId: id, message: 'Module repo requires an explicit unique checkout: ' + targetRepo })
    sourceFor.set(id, undefined)
  }
  for (const row of checkouts) {
    const ids: string[] = []
    const byUri = new Map<string, string>()
    byCheckout.set(checkoutKey(row.repoId, row.checkoutId), byUri)
    const projection = row.blueprint
    for (const originalId of projection?.nodeIds ?? []) {
      const original = projection!.nodes[originalId]
      if (!original?.sourceUri || uriRepo(original.sourceUri) !== row.repoId) {
        composition.diagnostics.push({ code: 'INVALID_IDENTITY', checkoutId: row.checkoutId, message: 'Projection node has no matching repository URI: ' + originalId }); continue
      }
      const id = compositionNodeId(row.repoId, row.checkoutId, original.sourceUri)
      byUri.set(original.sourceUri, id)
      const node = structuredClone(original)
      node.id = id
      node.parentId = null; node.children = []
      node.workspaceSnapshot = { name: row.name ?? projection!.name, path: row.path }
      const expected = row.expectedSourceHashes?.[original.sourceUri]
      const stale = row.stale || (expected !== undefined && expected !== original.sourceHash)
      composition.nodes[id] = { layer: 'evidence', status: stale ? 'stale' : 'bound', repoId: row.repoId, checkoutId: row.checkoutId, path: row.path, sourceUri: original.sourceUri }
      blueprint.nodes[id] = node; blueprint.nodeIds.push(id); ids.push(id); sourceFor.set(id, row)
      if (stale) composition.diagnostics.push({ code: 'STALE_EVIDENCE', nodeId: id, checkoutId: row.checkoutId, message: 'Source hash changed: ' + original.sourceUri })
    }
    for (const originalId of projection?.nodeIds ?? []) {
      const node = projection!.nodes[originalId]
      const id = node?.sourceUri && byUri.get(node.sourceUri)
      if (!id) continue
      const parent = node.parentId && projection!.nodes[node.parentId]?.sourceUri
      blueprint.nodes[id].parentId = parent ? byUri.get(parent) ?? null : null
      blueprint.nodes[id].children = node.children.flatMap(child => { const uri = projection!.nodes[child]?.sourceUri; const target = uri && byUri.get(uri); return target ? [target] : [] })
    }
    const status = row.bound === false || !projection ? 'unbound' : ids.some(id => composition.nodes[id].status === 'stale') ? 'stale' : 'bound'
    composition.checkouts.push({ repoId: row.repoId, checkoutId: row.checkoutId, path: row.path, selected: row.selected, name: row.name, revision: row.revision ?? projection?.contentRevision ?? null, status, nodeIds: ids, snapshot: row.snapshot ?? projection?.noteSnapshot, dirty: row.dirty, diagnostic: row.diagnostic })
    if (status === 'unbound') composition.diagnostics.push({ code: 'UNBOUND_CHECKOUT', checkoutId: row.checkoutId, message: row.diagnostic ?? 'Checkout projection unavailable: ' + row.path })
    if (row.dirty) composition.diagnostics.push({ code: 'DIRTY_CHECKOUT', checkoutId: row.checkoutId, message: 'Checkout contains uncommitted changes: ' + row.path })
  }
  const resolve = (uri: string, source?: BlueprintCheckoutInput): string | undefined => {
    if (source && uriRepo(uri) === source.repoId) return byCheckout.get(checkoutKey(source.repoId, source.checkoutId))?.get(uri)
    if (uriRepo(uri) === rootRepo) return rootByUri.get(uri)
    const chosen = select(uriRepo(uri) ?? '')
    return chosen ? byCheckout.get(checkoutKey(chosen.repoId, chosen.checkoutId))?.get(uri) : undefined
  }
  const relations: BlueprintRelation[] = []
  const relationKeys = new Set<string>()
  const append = (edge: BlueprintRelation, graph: Blueprint, row?: BlueprintCheckoutInput): void => {
    const sourceUri = edge.sourceUri ?? graph.nodes[edge.sourceNodeId]?.sourceUri
    const targetUri = edge.targetUri ?? graph.nodes[edge.targetNodeId]?.sourceUri
    const sourceId = sourceUri ? resolve(sourceUri, row) : edge.sourceNodeId
    const targetId = targetUri ? resolve(targetUri, row) : edge.targetNodeId
    if (!sourceId || !blueprint.nodes[sourceId]) return
    const key = [sourceId, edge.type, targetUri ?? targetId, JSON.stringify([edge.criteria, edge.scope, edge.reason])].join('|')
    if (relationKeys.has(key)) return
    relationKeys.add(key)
    const resolved = !!targetId && !!blueprint.nodes[targetId]
    relations.push({ ...structuredClone(edge), id: key, sourceNodeId: sourceId, targetNodeId: targetId ?? targetUri ?? edge.targetNodeId, sourceUri, targetUri,
      resolution: resolved ? { status: 'resolved', diagnostics: [] } : { status: 'unavailable', diagnostics: [] } })
    if (!resolved) composition.diagnostics.push({ code: 'UNBOUND_RELATION', nodeId: sourceId, sourceUri: targetUri, message: 'Relation target not uniquely bound: ' + (targetUri ?? edge.targetNodeId) })
  }
  for (const edge of input.relations) append(edge, input)
  for (const row of checkouts) for (const edge of row.blueprint?.relations ?? []) append(edge, row.blueprint!, row)
  blueprint.relations = relations
  for (const id of blueprint.nodeIds) {
    const node: BlueprintNode = blueprint.nodes[id]
    if (!node) continue
    composition.evidence.push({ nodeId: id, sourceUri: node.sourceUri, sourceHash: node.sourceHash, codeRefs: structuredClone(node.note?.metadata?.codeRefs ?? []), execution: structuredClone(node.note?.metadata?.execution) })
    for (const [index, port] of (node.note?.metadata?.interfaces ?? []).entries()) {
      composition.interfaces.push({ id: id + ':interface:' + index, nodeId: id, ...port, status: composition.nodes[id]?.status === 'unbound' ? 'unbound' : composition.nodes[id]?.status === 'stale' ? 'stale' : port.direction === 'provides' ? 'idle' : 'dangling' })
    }
  }
  for (const port of composition.interfaces.filter(port => port.direction === 'needs')) {
    if (!port.provider) {
      if (port.status !== 'unbound' && port.status !== 'stale') port.status = 'dangling'
      composition.diagnostics.push({ code: 'DANGLING_INTERFACE', nodeId: port.nodeId, message: 'Interface has no explicit provider: ' + port.name }); continue
    }
    const target = resolve(port.provider, sourceFor.get(port.nodeId))
    const providers = composition.interfaces.filter(other => other.nodeId === target && other.direction === 'provides' && other.name === port.name)
    if (!target || providers.length !== 1 || composition.nodes[target]?.status === 'unbound' || composition.nodes[port.nodeId]?.status === 'unbound') { port.status = 'unbound'; continue }
    port.providerNodeId = target
    const stale = composition.nodes[target]?.status === 'stale' || composition.nodes[port.nodeId]?.status === 'stale'
    port.status = stale ? 'stale' : 'connected'
    providers[0].status = stale || providers[0].status === 'stale' ? 'stale' : 'connected'
  }
  blueprint.invalidNotes = [...(blueprint.invalidNotes ?? []), ...checkouts.flatMap(row => (row.blueprint?.invalidNotes ?? []).map(item => ({ ...item, relPath: row.checkoutId + ': ' + item.relPath })))]
  return { ...blueprint, composition }
}
