// Note: maintenance-to-harness translation table lives here — see .agents/notes/agent/maintenance-harness-apply-s6.md
/**
 * @file Maintenance -> harness operation bridge (S6-c slice 2a, pure)
 * @description Translates BlueprintMaintenance operations into harness
 *  NoteChangeSet operations without touching the filesystem or Electron.
 *  The mapping is explicit and lossy by design; every refusal carries a
 *  reason so the future service wiring fails the apply loudly instead of
 *  forking prose or silently dropping intent.
 *
 *  Mapping table (maintenance op -> harness op):
 *  - create-node      -> one create with full prose (title/H1, sections, tags, parent)
 *  - update-node      -> one replace via applyNodePatch (title/prose/tags/status;
 *                        type change, progress, and features are refused)
 *  - move-node        -> one replace touching frontmatter parent only
 *  - add-relation     -> one replace on the owning note (depends-on stays,
 *                        blocks flips direction, implements needs task->requirement,
 *                        related-to lands on the lexicographically smaller URI)
 *  - update-relation  -> one replace on the owning note (description maps to
 *                        reason; a type change stays on the same owner)
 *  - remove-relation  -> one replace dropping the edge on the owning note
 *  - archive-node     -> one replace setting lifecycle archived
 *  - delete-node      -> archive downgrade (contract C2), flagged for the caller
 *  - restore-node     -> one replace restoring a live lifecycle; snapshot edges
 *                        must still exist (archives never remove edges)
 *  - update-workspace-binding -> refused (bindings are local-only in harness)
 *
 *  Fusion rule: the transaction layer pre-checks every expectedHash against
 *  current disk, so chained same-file replaces in one changeset always
 *  conflict. The translator fuses all touches of one URI into a single op:
 *  creates compose onto the minted markdown, replaces compose onto the base
 *  snapshot. Emission order follows first touch; harness dependsOn carries
 *  the maintenance dependency constraints (stable topo order, cycles refuse).
 *  Read-only kind checks never touch fusion state. Output is single-use:
 *  create URIs mint fresh note ids, so translating twice forks identity.
 *  No filesystem, no Electron.
 */
import {
  parseNote,
  RELATION_TYPES,
  serializeNote,
  validateNote,
  type ParsedNote,
  type Relation,
} from '@janus-agent/harness-core'
import {
  applyNodePatch,
  createNoteInput,
  mapStatusToLifecycle,
  mergeNoteEdit,
  nodeTypeToKind,
  type NodeFieldPatch,
} from './artifact-producer'
import { toNoteDoc } from '@janus-agent/harness-node'
import type { BlueprintOperation } from '../../shared/janus/maintenance-types'
import type { NoteAuthoringContext } from './note-authoring'
import { editMaintenanceSections } from './maintenance-sections'

export interface BridgeNoteSnapshot {
  uri: string
  expectedHash: string
  markdown: string
}

export interface MaintenanceBridgeContext {
  repoId: string
  authoring?: NoteAuthoringContext
  resolveNote: (nodeId: string) => BridgeNoteSnapshot | null
}

export interface BridgedOp {
  operationId: string
  maintenanceOperationIds: string[]
  type: 'create' | 'replace'
  uri: string
  expectedHash: string | null
  afterMarkdown: string
  dependsOn: string[]
  reason: string
  evidenceRefs: string[]
  downgraded?: 'archive-for-delete'
}

export interface BridgeRefusal {
  operationId: string
  reason: string
}

export interface CreatedRelationRef {
  ownerId: string
  type: string
  targetId: string
  /** Synthetic projection id `${ownerId}:${type}:${targetId}` using the edge type in the final file. */
  relationId: string
}

export interface BridgeResult {
  ops: BridgedOp[]
  untranslatable: BridgeRefusal[]
  /** False when any op was refused; the caller must not apply a partial bridge. */
  complete: boolean
  /** tempNodeId -> minted note id, only for creates in the emitted ops. */
  createdNodeIds: Record<string, string>
  /** tempRelationId -> final edge ref, only for adds whose owner file is emitted. */
  createdRelations: Record<string, CreatedRelationRef>
  /** Actual pre-operation section content, including preceding selected edits. */
  sectionBaselines: Record<string, Record<string, string | null>>
}

/** Canvas relation -> harness edge type for projection matching. */
const PROJECTED_EDGE: Record<string, string> = {
  'depends-on': 'depends-on',
  implements: 'implements',
  'related-to': 'related-to',
}

function projectEdgeType(harnessType: string): string {
  return PROJECTED_EDGE[harnessType] ?? 'related-to'
}

function targetId(target: string): string {
  return target.split('/').pop() ?? target
}

function parseProjectedRelationId(relationId: string): { from: string; type: string; target: string } | null {
  const parts = relationId.split(':')
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) return null
  return { from: parts[0], type: parts[1], target: parts[2] }
}

function reparse(markdown: string): { ok: true; note: ParsedNote } | { ok: false; reason: string } {
  try {
    const note = parseNote(markdown)
    const problems = validateNote(note)
    if (problems.length > 0) return { ok: false, reason: `SCHEMA_INVALID: ${problems[0].message}` }
    return { ok: true, note }
  } catch (e) {
    return { ok: false, reason: `SCHEMA_INVALID: ${(e as Error).message}` }
  }
}

interface PendingFile {
  uri: string
  /** Null for notes minted inside this bridge (create path). */
  baseHash: string | null
  markdown: string
  firstIndex: number
  maintenanceOperationIds: string[]
  reasons: string[]
  evidenceRefs: string[]
  downgraded?: 'archive-for-delete'
}

interface TempEdge {
  ownerUri: string
  type: string
  target: string
}

function stableTopoSort(ops: BlueprintOperation[]): { sorted: BlueprintOperation[]; cyclic: Set<string> } {
  const ids = new Set(ops.map((op) => op.operationId))
  const indegree = new Map<string, number>()
  const outgoing = new Map<string, string[]>()
  for (const op of ops) {
    indegree.set(op.operationId, 0)
    outgoing.set(op.operationId, [])
  }
  for (const op of ops) {
    for (const dep of new Set(op.dependsOn)) {
      if (!ids.has(dep)) continue
      outgoing.get(dep)?.push(op.operationId)
      indegree.set(op.operationId, (indegree.get(op.operationId) ?? 0) + 1)
    }
  }
  const position = new Map(ops.map((op, i) => [op.operationId, i] as const))
  const byPosition = (a: BlueprintOperation, b: BlueprintOperation): number =>
    (position.get(a.operationId) ?? 0) - (position.get(b.operationId) ?? 0)
  const ready = ops.filter((op) => (indegree.get(op.operationId) ?? 0) === 0).sort(byPosition)
  const byId = new Map(ops.map((op) => [op.operationId, op] as const))
  const sorted: BlueprintOperation[] = []
  while (ready.length > 0) {
    const op = ready.shift() as BlueprintOperation
    sorted.push(op)
    for (const next of outgoing.get(op.operationId) ?? []) {
      indegree.set(next, (indegree.get(next) ?? 1) - 1)
      if (indegree.get(next) === 0) {
        ready.push(byId.get(next) as BlueprintOperation)
        ready.sort(byPosition)
      }
    }
  }
  const placed = new Set(sorted.map((op) => op.operationId))
  return { sorted, cyclic: new Set([...ids].filter((id) => !placed.has(id))) }
}

/**
 * Translates a maintenance selection into harness operations. Single-use
 * output: create URIs mint fresh note ids, so translating twice forks
 * identity. The caller applies the whole bridge or nothing (see complete).
 */
export function translateMaintenanceOpsToHarness(
  operations: BlueprintOperation[],
  ctx: MaintenanceBridgeContext,
): BridgeResult {
  const untranslatable: BridgeRefusal[] = []
  const refused = new Set<string>()
  const refuse = (operationId: string, reason: string): null => {
    untranslatable.push({ operationId, reason })
    refused.add(operationId)
    return null
  }

  const pending = new Map<string, PendingFile>()
  const tempNodes = new Map<string, string>()
  const tempRelations = new Map<string, TempEdge>()
  const sectionBaselines: BridgeResult['sectionBaselines'] = Object.create(null)
  let order = 0

  const nodeUri = (nodeId: string): string | null =>
    tempNodes.get(nodeId) ?? ctx.resolveNote(nodeId)?.uri ?? null

  /** Resolve and cache without fusion bookkeeping (read-only checks). */
  const peek = (uri: string): PendingFile | null => {
    const hit = pending.get(uri)
    if (hit) return hit
    const snapshot = ctx.resolveNote(targetId(uri))
    if (!snapshot || snapshot.uri !== uri) return null
    const file: PendingFile = {
      uri,
      baseHash: snapshot.expectedHash,
      markdown: snapshot.markdown,
      firstIndex: order++,
      maintenanceOperationIds: [],
      reasons: [],
      evidenceRefs: [],
    }
    pending.set(uri, file)
    return file
  }

  const touch = (uri: string, operationId: string, reason: string, evidenceRefs: string[]): PendingFile | null => {
    const file = peek(uri)
    if (!file) {
      refuse(operationId, `unknown note for ${uri}`)
      return null
    }
    if (!file.maintenanceOperationIds.includes(operationId)) file.maintenanceOperationIds.push(operationId)
    file.reasons.push(reason)
    for (const ref of evidenceRefs) {
      if (!file.evidenceRefs.includes(ref)) file.evidenceRefs.push(ref)
    }
    return file
  }

  const seedCreated = (uri: string, markdown: string, operationId: string, reason: string, evidenceRefs: string[]): PendingFile => {
    const file: PendingFile = {
      uri,
      baseHash: null,
      markdown,
      firstIndex: order++,
      maintenanceOperationIds: [operationId],
      reasons: [reason],
      evidenceRefs: [...evidenceRefs],
    }
    pending.set(uri, file)
    return file
  }

  const setMarkdown = (file: PendingFile, operationId: string, markdown: string): boolean => {
    const checked = reparse(markdown)
    if (!checked.ok) {
      refuse(operationId, checked.reason)
      return false
    }
    file.markdown = markdown
    return true
  }

  const editRelations = (
    file: PendingFile,
    operationId: string,
    mutate: (relations: Relation[]) => string | null,
  ): boolean => {
    const parsed = reparse(file.markdown)
    if (!parsed.ok) {
      refuse(operationId, `base note unreadable: ${parsed.reason}`)
      return false
    }
    const relations = [...(parsed.note.meta.relations ?? [])]
    const problem = mutate(relations)
    if (problem) {
      refuse(operationId, problem)
      return false
    }
    const merged: ParsedNote = {
      ...parsed.note,
      meta: { ...parsed.note.meta, ...(relations.length > 0 || parsed.note.meta.relations ? { relations } : {}) },
      body: parsed.note.body,
    }
    if (merged.meta.schema === 'harness-note/2' && JSON.stringify(merged.meta.relations) !== JSON.stringify(parsed.note.meta.relations)) merged.meta.updated = new Date().toISOString()
    return setMarkdown(file, operationId, serializeNote(merged))
  }

  const helpers: TranslateHelpers = {
    nodeUri, peek, touch, setMarkdown, editRelations, tempNodes, tempRelations, refuse, sectionBaselines,
  }

  const { sorted, cyclic } = stableTopoSort(operations)
  for (const id of cyclic) refuse(id, 'dependency cycle')

  for (const op of sorted) {
    if (refused.has(op.operationId)) continue
    const unknownDep = op.dependsOn.find((dep) => !operations.some((o) => o.operationId === dep))
    if (unknownDep) {
      refuse(op.operationId, `unknown dependency ${unknownDep}`)
      continue
    }
    const blockedDep = op.dependsOn.find((dep) => refused.has(dep))
    if (blockedDep) {
      refuse(op.operationId, `depends on untranslatable ${blockedDep}`)
      continue
    }
    translateOne(op, ctx, helpers, seedCreated)
  }

  // Refused touches leave bookkeeping behind; strip them so no unchanged
  // file emits a no-op replace and no refused id anchors dependencies.
  for (const file of pending.values()) {
    file.maintenanceOperationIds = file.maintenanceOperationIds.filter((id) => !refused.has(id))
  }
  const ops: BridgedOp[] = [...pending.values()]
    .filter((file) => file.maintenanceOperationIds.length > 0)
    .sort((a, b) => a.firstIndex - b.firstIndex)
    .map((file) => ({
      operationId: file.maintenanceOperationIds[0],
      maintenanceOperationIds: [...file.maintenanceOperationIds],
      type: (file.baseHash === null ? 'create' : 'replace') as 'create' | 'replace',
      uri: file.uri,
      expectedHash: file.baseHash,
      afterMarkdown: file.markdown,
      dependsOn: [],
      reason: file.reasons.join('；'),
      evidenceRefs: [...file.evidenceRefs],
      ...(file.downgraded ? { downgraded: file.downgraded } : {}),
    }))
  const harnessIdOf = new Map(ops.flatMap((o) => o.maintenanceOperationIds.map((id) => [id, o.operationId] as const)))
  const opById = new Map(operations.map((o) => [o.operationId, o] as const))
  for (const op of ops) {
    const deps = new Set<string>()
    for (const id of op.maintenanceOperationIds) {
      for (const dep of opById.get(id)?.dependsOn ?? []) {
        const target = harnessIdOf.get(dep)
        if (target && target !== op.operationId) deps.add(target)
      }
    }
    op.dependsOn = [...deps]
  }
  const emittedUris = new Set(ops.map((o) => o.uri))
  const createdNodeIds: Record<string, string> = {}
  for (const [tempId, uri] of tempNodes) {
    if (emittedUris.has(uri)) createdNodeIds[tempId] = targetId(uri)
  }
  const createdRelations: Record<string, CreatedRelationRef> = {}
  for (const [tempId, temp] of tempRelations) {
    const file = pending.get(temp.ownerUri)
    if (!file || !emittedUris.has(temp.ownerUri)) continue
    // Same-changeset type updates rewrite the edge, so read the final file
    // instead of trusting the add-time type; fall back when ambiguous.
    let edgeType = temp.type
    const live = reparse(file.markdown)
    if (live.ok) {
      const hits = (live.note.meta.relations ?? []).filter((r) => r.target === temp.target)
      if (hits.length === 1) edgeType = hits[0].type
    }
    const ownerId = targetId(temp.ownerUri)
    const targetNoteId = targetId(temp.target)
    createdRelations[tempId] = {
      ownerId,
      type: edgeType,
      targetId: targetNoteId,
      relationId: `${ownerId}:${edgeType}:${targetNoteId}`,
    }
  }
  return { ops, untranslatable, complete: untranslatable.length === 0, createdNodeIds, createdRelations, sectionBaselines }
}

interface TranslateHelpers {
  sectionBaselines: BridgeResult['sectionBaselines']
  nodeUri: (nodeId: string) => string | null
  peek: (uri: string) => PendingFile | null
  touch: (uri: string, operationId: string, reason: string, evidenceRefs: string[]) => PendingFile | null
  setMarkdown: (file: PendingFile, operationId: string, markdown: string) => boolean
  editRelations: (file: PendingFile, operationId: string, mutate: (relations: Relation[]) => string | null) => boolean
  tempNodes: Map<string, string>
  tempRelations: Map<string, TempEdge>
  refuse: (operationId: string, reason: string) => null
}

function translateOne(
  op: BlueprintOperation,
  ctx: MaintenanceBridgeContext,
  h: TranslateHelpers,
  seedCreated: (uri: string, markdown: string, operationId: string, reason: string, evidenceRefs: string[]) => PendingFile,
): void {
  switch (op.type) {
    case 'create-node': return translateCreate(op, ctx, h, seedCreated)
    case 'update-node': return translateUpdate(op, h)
    case 'move-node': return translateMove(op, h)
    case 'add-relation': return translateAddRelation(op, h)
    case 'update-relation': return translateUpdateRelation(op, h)
    case 'remove-relation': return translateRemoveRelation(op, h)
    case 'archive-node': return translateArchive(op, h, false)
    case 'delete-node': return translateArchive(op, h, true)
    case 'restore-node': return translateRestore(op, h)
    case 'update-workspace-binding':
      h.refuse(op.operationId, 'no harness equivalent: bindings are local-only')
      return
  }
}

function translateCreate(
  op: Extract<BlueprintOperation, { type: 'create-node' }>,
  ctx: MaintenanceBridgeContext,
  h: TranslateHelpers,
  seedCreated: (uri: string, markdown: string, operationId: string, reason: string, evidenceRefs: string[]) => PendingFile,
): void {
  if (!op.after.title.trim()) {
    h.refuse(op.operationId, 'empty title')
    return
  }
  let parentUri: string | null = null
  if (op.parentId) {
    parentUri = h.nodeUri(op.parentId)
    if (!parentUri) {
      h.refuse(op.operationId, `unknown parent ${op.parentId}`)
      return
    }
  }
  const kind = nodeTypeToKind(op.after.type)
  if (ctx.authoring?.schema === 'harness-note/2' && kind === 'task') {
    h.refuse(op.operationId, 'Create a Task through note.write with its explicit scope, acceptance, verification and review contract')
    return
  }
  const parent = op.parentId ? ctx.resolveNote(op.parentId) : null
  const parentMeta = parent ? parseNote(parent.markdown).meta : undefined
  const module = parentMeta?.kind === 'module' ? parent!.uri : parentMeta?.module ?? ctx.authoring?.module
  const actualKind = ctx.authoring?.schema === 'harness-note/2' && kind === 'initiative' ? 'note' : kind
  const { id, markdown } = createNoteInput(actualKind, op.after.title.trim(), parentUri, { ...ctx.authoring, module })
  const uri = `note://${ctx.repoId}/${id}`
  const patch: NodeFieldPatch = {}
  if (op.after.description) patch.description = op.after.description
  if (op.after.positioning) patch.positioning = op.after.positioning
  if (op.after.techSolution) patch.techSolution = op.after.techSolution
  if (op.after.notes) patch.notes = op.after.notes
  if (op.after.tags.length > 0) patch.tags = [...op.after.tags]
  let finalMarkdown = markdown
  if (Object.keys(patch).length > 0) {
    const skeleton = reparse(markdown)
    if (!skeleton.ok) {
      h.refuse(op.operationId, `skeleton unreadable: ${skeleton.reason}`)
      return
    }
    const produced = applyNodePatch(toNoteDoc(skeleton.note), patch)
    if (!('edit' in produced)) {
      h.refuse(op.operationId, `${produced.code}: ${produced.message}`)
      return
    }
    try {
      finalMarkdown = mergeNoteEdit(skeleton.note, markdown, produced.edit, op.reason)
    } catch (e) {
      h.refuse(op.operationId, `SCHEMA_INVALID: ${(e as Error).message ?? e}`)
      return
    }
  } else {
    const checked = reparse(markdown)
    if (!checked.ok) {
      h.refuse(op.operationId, checked.reason)
      return
    }
  }
  h.tempNodes.set(op.tempNodeId, uri)
  seedCreated(uri, finalMarkdown, op.operationId, op.reason, op.evidenceRefs)
}

function translateUpdate(
  op: Extract<BlueprintOperation, { type: 'update-node' }>,
  h: TranslateHelpers,
): void {
  if (op.after.type !== undefined) {
    h.refuse(op.operationId, 'kind change unsupported: keep the note kind, derive a new note instead')
    return
  }
  if (op.after.progress !== undefined) {
    h.refuse(op.operationId, 'progress has no note equivalent')
    return
  }
  if (op.after.features && op.after.features.length > 0) {
    h.refuse(op.operationId, 'HARNESS_MANAGED: features on project notes are managed by execution flows')
    return
  }
  const uri = h.nodeUri(op.nodeId)
  if (!uri) {
    h.refuse(op.operationId, `unknown node ${op.nodeId}`)
    return
  }
  const patch: NodeFieldPatch = {}
  if (op.after.title !== undefined) patch.title = op.after.title
  if (op.after.description !== undefined) patch.description = op.after.description
  if (op.after.positioning !== undefined) patch.positioning = op.after.positioning
  if (op.after.techSolution !== undefined) patch.techSolution = op.after.techSolution
  if (op.after.notes !== undefined) patch.notes = op.after.notes
  if (op.after.tags !== undefined) patch.tags = [...op.after.tags]
  if (op.after.status !== undefined) patch.status = op.after.status
  if (Object.keys(patch).length === 0 && !Object.keys(op.after.sections ?? {}).length) {
    h.refuse(op.operationId, 'no writable fields')
    return
  }
  const file = h.touch(uri, op.operationId, op.reason, op.evidenceRefs)
  if (!file) return
  const parsed = reparse(file.markdown)
  if (!parsed.ok) {
    h.refuse(op.operationId, `base note unreadable: ${parsed.reason}`)
    return
  }
  const produced = applyNodePatch(toNoteDoc(parsed.note), patch)
  if (!('edit' in produced)) {
    h.refuse(op.operationId, `${produced.code}: ${produced.message}`)
    return
  }
  try {
    let out = mergeNoteEdit(parsed.note, file.markdown, produced.edit, op.reason)
    if (op.after.sections) {
      const note = parseNote(out)
      const edited = editMaintenanceSections(note.body, op.after.sections)
      h.sectionBaselines[op.operationId] = editMaintenanceSections(parsed.note.body, op.after.sections).before
      out = serializeNote({ ...note, body: edited.body })
    }
    h.setMarkdown(file, op.operationId, out)
  } catch (e) {
    h.refuse(op.operationId, `SCHEMA_INVALID: ${(e as Error).message ?? e}`)
  }
}

function translateMove(
  op: Extract<BlueprintOperation, { type: 'move-node' }>,
  h: TranslateHelpers,
): void {
  const uri = h.nodeUri(op.nodeId)
  if (!uri) {
    h.refuse(op.operationId, `unknown node ${op.nodeId}`)
    return
  }
  const parentUri = h.nodeUri(op.afterParentId)
  if (!parentUri) {
    h.refuse(op.operationId, `unknown parent ${op.afterParentId}`)
    return
  }
  if (parentUri === uri) {
    h.refuse(op.operationId, 'self parent refused')
    return
  }
  const file = h.touch(uri, op.operationId, op.reason, op.evidenceRefs)
  if (!file) return
  const parsed = reparse(file.markdown)
  if (!parsed.ok) {
    h.refuse(op.operationId, `base note unreadable: ${parsed.reason}`)
    return
  }
  try {
    const out = mergeNoteEdit(parsed.note, file.markdown, { sections: {}, frontmatter: { parent: parentUri } }, op.reason)
    h.setMarkdown(file, op.operationId, out)
  } catch (e) {
    h.refuse(op.operationId, `SCHEMA_INVALID: ${(e as Error).message ?? e}`)
  }
}

function translateAddRelation(
  op: Extract<BlueprintOperation, { type: 'add-relation' }>,
  h: TranslateHelpers,
): void {
  const sourceUri = h.nodeUri(op.after.sourceNodeId)
  const targetUri = h.nodeUri(op.after.targetNodeId)
  if (!sourceUri) {
    h.refuse(op.operationId, `unknown source node ${op.after.sourceNodeId}`)
    return
  }
  if (!targetUri) {
    h.refuse(op.operationId, `unknown target node ${op.after.targetNodeId}`)
    return
  }
  if (sourceUri === targetUri) {
    h.refuse(op.operationId, 'self reference refused')
    return
  }
  // Harness edges carry no prose: reason lives on supersedes only, so a
  // relation description must move into note prose instead of the edge.
  if (op.after.description) {
    h.refuse(op.operationId, 'description has no edge equivalent: fold it into note prose first')
    return
  }
  let ownerUri = sourceUri
  let edge: Relation
  const reason = op.reason
  if (op.after.relationType === 'depends-on') {
    edge = { type: 'depends-on', target: targetUri }
  } else if (op.after.relationType === 'blocks') {
    ownerUri = targetUri
    edge = { type: 'depends-on', target: sourceUri }
  } else if (op.after.relationType === 'implements') {
    const sourceFile = h.peek(sourceUri)
    const targetFile = h.peek(targetUri)
    if (kindOf(sourceFile) !== 'task' || kindOf(targetFile) !== 'requirement') {
      h.refuse(op.operationId, 'implements needs a task source and a requirement target')
      return
    }
    edge = { type: 'implements', target: targetUri }
  } else {
    const [first] = [sourceUri, targetUri].sort()
    ownerUri = first
    edge = { type: 'related-to', target: ownerUri === sourceUri ? targetUri : sourceUri }
  }
  const file = h.touch(ownerUri, op.operationId, reason, op.evidenceRefs)
  if (!file) return
  const ok = h.editRelations(file, op.operationId, (relations) => {
    if (relations.some((r) => r.type === edge.type && r.target === edge.target)) {
      return 'edge already exists'
    }
    relations.push(edge)
    return null
  })
  if (ok) h.tempRelations.set(op.tempRelationId, { ownerUri, type: edge.type, target: edge.target })
}

function kindOf(file: PendingFile | null): string | null {
  if (!file) return null
  const parsed = reparse(file.markdown)
  return parsed.ok ? parsed.note.meta.kind : null
}

function resolveRelationOwner(
  relationId: string,
  op: { operationId: string },
  h: TranslateHelpers,
): { ownerUri: string; type: string; target: string } | null {
  const temp = h.tempRelations.get(relationId)
  if (temp) return temp
  const parsed = parseProjectedRelationId(relationId)
  if (!parsed) {
    h.refuse(op.operationId, `unparseable relation id ${relationId}`)
    return null
  }
  const ownerUri = h.nodeUri(parsed.from)
  if (!ownerUri) {
    h.refuse(op.operationId, `unknown relation owner ${parsed.from}`)
    return null
  }
  return { ownerUri, type: parsed.type, target: parsed.target }
}

function locateEdge(
  relations: Relation[],
  type: string,
  target: string,
  temp: TempEdge | null,
): { index: number } | { problem: string } {
  if (temp) {
    const hits: number[] = []
    relations.forEach((edge, index) => {
      if (edge.type === temp.type && edge.target === temp.target) hits.push(index)
    })
    if (hits.length !== 1) return { problem: 'temp relation is ambiguous or missing' }
    return { index: hits[0] }
  }
  const hits: number[] = []
  relations.forEach((edge, index) => {
    if (projectEdgeType(edge.type) === type && targetId(edge.target) === target) hits.push(index)
  })
  if (hits.length === 0) return { problem: 'relation edge not found' }
  if (hits.length > 1) return { problem: 'relation edge ambiguous' }
  return { index: hits[0] }
}

function translateUpdateRelation(
  op: Extract<BlueprintOperation, { type: 'update-relation' }>,
  h: TranslateHelpers,
): void {
  const resolved = resolveRelationOwner(op.relationId, op, h)
  if (!resolved) return
  const file = h.touch(resolved.ownerUri, op.operationId, op.reason, op.evidenceRefs)
  if (!file) return
  const parsed = reparse(file.markdown)
  if (!parsed.ok) {
    h.refuse(op.operationId, `base note unreadable: ${parsed.reason}`)
    return
  }
  if (op.after.description !== undefined) {
    h.refuse(op.operationId, 'description has no edge equivalent: fold it into note prose first')
    return
  }
  const relations = [...(parsed.note.meta.relations ?? [])]
  const temp = h.tempRelations.get(op.relationId) ?? null
  const located = locateEdge(relations, resolved.type, resolved.target, temp)
  if ('problem' in located) {
    h.refuse(op.operationId, located.problem)
    return
  }
  const current = relations[located.index]
  const nextType = op.after.relationType
  if (nextType === undefined || nextType === current.type) {
    h.refuse(op.operationId, 'empty update')
    return
  }
  if (nextType === 'blocks') {
    h.refuse(op.operationId, 'blocks travels through remove plus add')
    return
  }
  const mapped = nextType as Relation['type']
  if (!RELATION_TYPES.includes(mapped)) {
    h.refuse(op.operationId, `unknown relation type ${nextType}`)
    return
  }
  if (mapped === 'parent') {
    h.refuse(op.operationId, 'parent travels through move-node, not relations')
    return
  }
  if (current.type !== 'depends-on' && current.type !== 'implements' && current.type !== 'related-to') {
    h.refuse(op.operationId, `foreign edge ${current.type} needs manual review`)
    return
  }
  if (mapped === 'implements') {
    const targetFile = h.peek(current.target)
    if (kindOf(file) !== 'task' || kindOf(targetFile) !== 'requirement') {
      h.refuse(op.operationId, 'implements needs a task source and a requirement target')
      return
    }
  }
  if (mapped === 'related-to') {
    const [first] = [resolved.ownerUri, current.target].sort()
    if (first !== resolved.ownerUri) {
      h.refuse(op.operationId, 'owner change unsupported: split into remove plus add')
      return
    }
  }
  relations[located.index] = { type: mapped, target: current.target }
  h.editRelations(file, op.operationId, (live) => {
    live.length = 0
    live.push(...relations)
    return null
  })
}

function translateRemoveRelation(
  op: Extract<BlueprintOperation, { type: 'remove-relation' }>,
  h: TranslateHelpers,
): void {
  const resolved = resolveRelationOwner(op.relationId, op, h)
  if (!resolved) return
  const file = h.touch(resolved.ownerUri, op.operationId, op.reason, op.evidenceRefs)
  if (!file) return
  const parsed = reparse(file.markdown)
  if (!parsed.ok) {
    h.refuse(op.operationId, `base note unreadable: ${parsed.reason}`)
    return
  }
  const relations = [...(parsed.note.meta.relations ?? [])]
  const temp = h.tempRelations.get(op.relationId) ?? null
  const located = locateEdge(relations, resolved.type, resolved.target, temp)
  if ('problem' in located) {
    h.refuse(op.operationId, located.problem)
    return
  }
  relations.splice(located.index, 1)
  h.editRelations(file, op.operationId, (live) => {
    live.length = 0
    live.push(...relations)
    return null
  })
}

function translateArchive(
  op: Extract<BlueprintOperation, { type: 'archive-node' }> | Extract<BlueprintOperation, { type: 'delete-node' }>,
  h: TranslateHelpers,
  downgraded: boolean,
): void {
  const uri = h.nodeUri(op.nodeId)
  if (!uri) {
    h.refuse(op.operationId, `unknown node ${op.nodeId}`)
    return
  }
  const file = h.touch(uri, op.operationId, op.reason, op.evidenceRefs)
  if (!file) return
  if (downgraded) file.downgraded = 'archive-for-delete'
  const parsed = reparse(file.markdown)
  if (!parsed.ok) {
    h.refuse(op.operationId, `base note unreadable: ${parsed.reason}`)
    return
  }
  try {
    const out = mergeNoteEdit(parsed.note, file.markdown, { sections: {}, frontmatter: { lifecycle: 'archived' } }, op.reason)
    h.setMarkdown(file, op.operationId, out)
  } catch (e) {
    h.refuse(op.operationId, `SCHEMA_INVALID: ${(e as Error).message ?? e}`)
  }
}

function translateRestore(
  op: Extract<BlueprintOperation, { type: 'restore-node' }>,
  h: TranslateHelpers,
): void {
  const uri = h.nodeUri(op.nodeId)
  if (!uri) {
    h.refuse(op.operationId, `unknown node ${op.nodeId}`)
    return
  }
  const file = h.touch(uri, op.operationId, op.reason, op.evidenceRefs)
  if (!file) return
  const parsed = reparse(file.markdown)
  if (!parsed.ok) {
    h.refuse(op.operationId, `base note unreadable: ${parsed.reason}`)
    return
  }
  const mapped = mapStatusToLifecycle(parsed.note.meta.kind, op.node.status)
  if (!mapped.ok) {
    h.refuse(op.operationId, `${mapped.code}: ${mapped.message}`)
    return
  }
  if (mapped.lifecycle === 'archived' || mapped.lifecycle === 'rejected') {
    h.refuse(op.operationId, 'restore target is not live')
    return
  }
  const currentTargets = new Set((parsed.note.meta.relations ?? []).map((e) => targetId(e.target)))
  const absent = op.relations.filter((r) => !currentTargets.has(r.targetNodeId))
  if (absent.length > 0) {
    h.refuse(op.operationId, `snapshot edges missing: ${absent.map((r) => r.id).join(', ')}`)
    return
  }
  try {
    const out = mergeNoteEdit(parsed.note, file.markdown, { sections: {}, frontmatter: { lifecycle: mapped.lifecycle } }, op.reason)
    h.setMarkdown(file, op.operationId, out)
  } catch (e) {
    h.refuse(op.operationId, `SCHEMA_INVALID: ${(e as Error).message ?? e}`)
  }
}
