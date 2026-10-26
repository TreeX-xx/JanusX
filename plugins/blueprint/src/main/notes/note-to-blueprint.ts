/**
 * @file NoteAdapter v2 — source snapshot to blueprint middle layer
 * @description The single owner of every note->blueprint mapping table
 *  (kind->type, lifecycle->status, kind->sections, relation map) plus the
 *  patch->note translation used by Agent write flows. Display mappings retain
 *  original metadata, URI relations and diagnostics
 *  alongside canvas vocabulary. No renderer interprets frontmatter.
 *  Pure: no filesystem, no Electron, no network, no harness imports.
 *  See .agents/notes/blueprint/navigation/blueprint-note-graph-readonly.md
 */
import type {
  Blueprint,
  BlueprintFeatureItem,
  BlueprintNode,
  BlueprintNodeStatus,
  BlueprintNodeType,
  BlueprintRelation,
} from '../../shared/janus/types'
import { createHash } from 'node:crypto'
import { ADAPTER_VERSION } from './note-types'
import type { NoteDoc, NoteGraph, NoteGraphEntry, NoteKind } from './note-types'

export { ADAPTER_VERSION }
export type { NoteDoc, NoteGraph, NoteGraphEntry, NoteKind }

/** note kind -> canvas node type. Unknown kinds degrade to `issue`. */
export function kindToNodeType(kind: string): BlueprintNodeType {
  switch (kind) {
    case 'task':
      return 'task'
    case 'requirement':
      return 'feature'
    case 'decision':
    case 'module':
    case 'initiative':
      return 'epic'
    case 'idea':
    default:
      return 'issue'
  }
}

export function nodeTypeToKind(type: BlueprintNodeType, preferred?: NoteKind): NoteKind {
  if (preferred) return preferred
  switch (type) {
    case 'task':
      return 'task'
    case 'feature':
      return 'requirement'
    case 'issue':
      return 'requirement'
    case 'epic':
    default:
      return 'initiative'
  }
}

/** lifecycle -> canvas status. Done/completion evidence stays with receipts (S8). */
export function lifecycleToStatus(lifecycle: string): BlueprintNodeStatus {
  switch (lifecycle) {
    case 'draft':
    case 'proposed':
      return 'planning'
    case 'accepted':
      return 'in-progress'
    case 'implemented':
      return 'done'
    case 'rejected':
    case 'archived':
      return 'archived'
    default:
      return 'planning'
  }
}

export function mapStatusToLifecycle(
  kind: NoteKind,
  status: string,
): { ok: true; lifecycle: string } | { ok: false; code: string; message: string } {
  if (status === 'archived') return { ok: true, lifecycle: 'archived' }
  if (status === 'done' && kind === 'task') {
    return { ok: false, code: 'HARNESS_MANAGED', message: 'task completion requires acceptance evidence (task flow)' }
  }
  switch (status) {
    case 'not-started':
    case 'planning':
      return { ok: true, lifecycle: 'draft' }
    case 'in-progress':
    case 'testing':
    case 'bug-fixing':
    case 'blocked':
    case 'paused':
    case 'done':
      return { ok: true, lifecycle: 'accepted' }
    default:
      return { ok: false, code: 'SCHEMA_INVALID', message: `unknown status ${status}` }
  }
}

export { KIND_SECTIONS } from '@janus-agent/harness-core'
export interface NodeFieldPatch {
  title?: string
  description?: string
  positioning?: string
  techSolution?: string
  notes?: string
  status?: string
  tags?: string[]
  parentUri?: string | null
}

const MANAGED_ARRAYS = ['features', 'todos', 'issues', 'analyses', 'children'] as const

/** Rejects maintenance-owned arrays with HARNESS_MANAGED; maps the rest. */
export function checkWritablePatch(patch: Record<string, unknown>): { code: string; message: string } | null {
  for (const key of MANAGED_ARRAYS) {
    const value = patch[key]
    if (Array.isArray(value) && value.length > 0) {
      return { code: 'HARNESS_MANAGED', message: `${key} on project notes is managed by maintenance/execution flows` }
    }
  }
  return null
}

import type { NoteEdit } from '@janus-agent/harness-core'
export type { NoteEdit } from '@janus-agent/harness-core'
/**
 * Translates a canvas field patch into a structured note edit. Frontmatter
 * writes (tags, parent, lifecycle) travel as data; the service merges them
 * and re-serializes through harness-core, preserving unknown fields.
 */
export function applyNodePatch(
  doc: NoteDoc,
  patch: NodeFieldPatch,
): { edit: NoteEdit } | { code: string; message: string } {
  const kind = doc.kind as NoteKind
  const edit: NoteEdit = { sections: {}, frontmatter: {} }
  if (patch.title !== undefined) {
    if (!patch.title.trim()) return { code: 'SCHEMA_INVALID', message: 'title must not be empty' }
    edit.title = patch.title.trim()
  }
  const sectionFor: Record<string, string[]> = {
    description: kind === 'module' ? ['Responsibility'] : kind === 'note' ? ['Description'] : kind === 'idea' && doc.metadata?.schema === 'harness-note/2' ? ['Intent'] : kind === 'idea' ? ['Background'] : kind === 'initiative' ? ['Goal'] : ['Problem'],
    positioning: ['Background', 'Goal'],
    techSolution: kind === 'module' ? ['Design'] : kind === 'decision' && doc.metadata?.schema === 'harness-note/2' ? ['Decision'] : kind === 'decision' ? ['Proposal', 'Decision'] : ['Scope'],
    notes: ['Open questions'],
  }
  for (const [field, names] of Object.entries(sectionFor)) {
    const value = patch[field as keyof NodeFieldPatch]
    if (typeof value === 'string') edit.sections[names[0]] = value
  }
  if (patch.tags !== undefined) edit.frontmatter.tags = [...patch.tags]
  if (patch.parentUri !== undefined) edit.frontmatter.parent = patch.parentUri
  if (patch.status !== undefined) {
    if (kind === 'module') return { code: 'HARNESS_MANAGED', message: 'Module state must be maintained explicitly through moduleState; document status does not complete a module' }
    const mapped = mapStatusToLifecycle(kind, patch.status)
    if (!mapped.ok) return { code: mapped.code, message: mapped.message }
    edit.frontmatter.lifecycle = mapped.lifecycle
  }
  return { edit }
}

function sectionText(doc: NoteDoc, names: string[]): string {
  for (const name of names) {
    const hit = doc.sections.find((s) => s.name === name)
    if (hit && hit.text.trim()) return hit.text.trim()
  }
  return ''
}

function featuresFromAcs(doc: NoteDoc): BlueprintFeatureItem[] {
  const now = doc.created ?? '1970-01-01'
  return doc.acs.map((ac) => ({
    id: ac.id,
    title: ac.text,
    description: '',
    progress: 0,
    status: 'planned',
    requirementNotes: [],
    createdAt: now,
    updatedAt: now,
  }))
}

export function projectNode(repoId: string | null, entry: NoteGraphEntry): BlueprintNode {
  const { doc, relPath, sha256 } = entry
  const now = doc.created ?? '1970-01-01'
  return {
    id: doc.id,
    title: doc.title,
    type: kindToNodeType(doc.kind),
    status: doc.kind === 'module' ? ({ planned: 'planning', partial: 'in-progress', implemented: 'done', retired: 'archived' } as const)[doc.moduleState ?? 'planned'] ?? 'planning' : lifecycleToStatus(doc.lifecycle),
    kind: doc.kind,
    lifecycle: doc.lifecycle,
    progress: 0,
    statusSource: 'manual',
    positioning: sectionText(doc, ['Background', 'Goal']),
    description: sectionText(doc, ['Responsibility', 'Description', 'Intent', 'Expected behavior', 'Problem', 'Goal', 'Background', 'Idea']),
    features: featuresFromAcs(doc),
    completedItems: [],
    techSolution: sectionText(doc, ['Design', 'Decision', 'Proposal']),
    notes: sectionText(doc, ['Open questions', 'Scope']),
    todos: [],
    issues: [],
    activities: [],
    analyses: [],
    workspaceId: null,
    primaryWorkspaceId: null,
    linkedWorkspaceIds: [],
    workspaceSnapshot: null,
    // E0-4 discounted: registry-UUID bindings stay null on purpose. The pure
    // adapter cannot know renderer registry ids, and repositories.primary
    // needs E0-2 (P3). Checkout identity rides workspaceSnapshot instead
    // (stamped in projectGraph below); the canvas resolves it by path.
    boundTerminalId: null,
    terminalHistory: [],
    lastAnalyzedCommitSha: null,
    children: [],
    parentId: null,
    tags: [...doc.tags],
    createdAt: doc.created ?? now,
    updatedAt: doc.updated ?? now,
    sourceUri: repoId ? `note://${repoId}/${doc.id}` : undefined,
    sourceHash: sha256,
    sourceRelPath: relPath,
    note: doc,
  }
}

const RELATION_MAP: Record<string, BlueprintRelation['type']> = {
  parent: 'parent',
  'governed-by': 'governed-by',
  'derived-from': 'derived-from',
  supersedes: 'supersedes',
  'depends-on': 'depends-on',
  implements: 'implements',
  'related-to': 'related-to',
}

/** Resolve canvas endpoints by full identity. Unbound targets keep their URI. */
export function projectRelations(entries: NoteGraphEntry[], repoId: string | null = null, snapshot?: NoteGraph['snapshot']): BlueprintRelation[] {
  const uriFor = (id: string): string => repoId ? `note://${repoId}/${id}` : id
  const local = new Map(entries.map((e) => [uriFor(e.doc.id), e.doc.id]))
  const declared = snapshot?.relations ?? entries.flatMap(({ doc }) => {
    const refs = [...doc.relations]
    if (doc.parent && !refs.some((r) => r.type === 'parent' && r.target === doc.parent)) refs.unshift({ type: 'parent', target: doc.parent })
    return refs.map((r) => ({
      ...r, sourceUri: uriFor(doc.id), targetUri: r.target, declarations: [r.type === 'parent' ? 'parent' : 'relations'],
      resolution: { status: local.has(r.target) ? 'resolved' as const : 'unavailable' as const, diagnostics: [] },
    }))
  })
  return declared.map((r) => ({
    id: `${local.get(r.sourceUri) ?? r.sourceUri}:${r.type}:${local.get(r.targetUri) ?? r.targetUri}`,
    sourceNodeId: local.get(r.sourceUri) ?? r.sourceUri,
    targetNodeId: local.get(r.targetUri) ?? r.targetUri,
    sourceUri: r.sourceUri,
    targetUri: r.targetUri,
    type: RELATION_MAP[r.type] ?? 'related-to',
    description: RELATION_MAP[r.type] ? undefined : `harness:${r.type}`,
    criteria: r.criteria, scope: r.scope, reason: r.reason,
    declarations: r.declarations, resolution: r.resolution,
    createdAt: '1970-01-01', updatedAt: '1970-01-01',
  }))
}

/**
 * Checkout-scoped graph id (E0-1).
 * Hash of the normalized checkout rootKey — never repoId — so two worktrees
 * of one repo project to two ids and a null repoId cannot collide on
 * `C:\Users`-style path prefixes. Local-only: cross-machine identity stays
 * on repoId / sourceUri, never on this id. Windows forbids case-only sibling
 * directories, so lowercasing is safe canonicalization for slash/case
 * spelling variants of one checkout.
 * See .agents/notes/blueprint/requirements/blueprint-notev2-implementation-plan.md (E0-1).
 */
export function projectGraphId(repoId: string | null, rootKey: string): string {
  void repoId
  const slashes = rootKey.replace(/\\/g, '/')
  const normalized = process.platform === 'win32' && !rootKey.startsWith('janusx-workspace://') ? slashes.toLowerCase() : slashes
  const digest = createHash('sha256').update(normalized, 'utf8').digest('hex').slice(0, 12)
  return `harness:project:${digest}`
}

/** One virtual Blueprint per repo root. Layout/overlay state stays local-only. */
export function projectGraph(input: NoteGraph, rootKey: string): Blueprint {
  const nodes: Record<string, BlueprintNode> = {}
  const nodeIds: string[] = []
  for (const entry of input.entries) {
    const node = projectNode(input.repoId, entry)
    // E0-4 discounted: every projected node carries its checkout identity in
    // existing WorkspaceSnapshot fields (no schema change). Powers path-based
    // terminal resolution plus the focus-view run panel / display fallbacks.
    node.workspaceSnapshot = { name: input.repoName, path: rootKey }
    nodes[node.id] = node
    nodeIds.push(node.id)
  }
  const relations = projectRelations(input.entries, input.repoId, input.snapshot)
  const projectionDiagnostics: NonNullable<Blueprint['projectionDiagnostics']> = []
  const parents = new Map<string, string[]>()
  for (const edge of relations.filter((r) => r.type === 'parent')) {
    if (!nodes[edge.sourceNodeId] || !nodes[edge.targetNodeId] || edge.resolution?.status !== 'resolved') continue
    parents.set(edge.sourceNodeId, [...(parents.get(edge.sourceNodeId) ?? []), edge.targetNodeId])
  }
  for (const [id, targets] of parents) {
    const unique = [...new Set(targets)]
    if (unique.length === 1) nodes[id].parentId = unique[0]
    else projectionDiagnostics.push({ code: 'INVALID_RELATION', message: 'Multiple parent declarations', path: nodes[id].sourceUri })
  }
  // Keep declarations in the relation layer, but never build a recursive tree.
  const cyclic = new Set<string>()
  for (const node of Object.values(nodes)) {
    const seen = new Set<string>()
    let cursor: string | null = node.id
    while (cursor && nodes[cursor]) {
      if (seen.has(cursor)) {
        let member: string | null = cursor
        do { cyclic.add(member!); member = nodes[member!].parentId } while (member && member !== cursor)
        break
      }
      seen.add(cursor)
      cursor = nodes[cursor].parentId
    }
  }
  for (const id of cyclic) {
    nodes[id].parentId = null
    projectionDiagnostics.push({ code: 'INVALID_RELATION', message: 'Parent cycle; declaration retained outside the directory tree', path: nodes[id].sourceUri })
  }
  for (const node of Object.values(nodes)) if (node.parentId) nodes[node.parentId].children.push(node.id)
  const now = input.entries.map((e) => e.doc.updated ?? e.doc.created ?? '1970-01-01').sort().at(-1) ?? '1970-01-01'
  return {
    contentRevision: input.revision,
    source: 'harness',
    adapterVersion: ADAPTER_VERSION,
    id: projectGraphId(input.repoId, rootKey),
    name: input.repoName,
    description: '',
    rootNodeId: nodeIds.find((id) => !nodes[id].parentId) ?? nodeIds[0] ?? '',
    nodeIds,
    nodes,
    relations,
    noteSnapshot: input.snapshot,
    projectionDiagnostics,
    requirementCandidates: [],
    mountedTo: null,
    canvasLayout: {},
    collapsedNodeIds: null,
    createdAt: now,
    updatedAt: now,
  }
}
