/**
 * @file Canvas focus → Janus context scope.
 * @description The right-hand Janus panel used to require an explicit
 *  "维护此节点" click, which pinned the conversation to exactly one Note.
 *  This module derives that batch from live canvas state instead: whatever the
 *  user is looking at (filter/search hits, else the selected subtree, else the
 *  whole graph) becomes the Note set Janus reads.
 *
 *  Read scope and write scope stay separate on purpose. Janus may *read* a wide
 *  batch, but proposals only widen past one node when the user has expressed a
 *  batch intent through the filters — an idle selection keeps the narrow
 *  `node` scope it has always had.
 *
 *  Pure: no stores, no IPC. Callers supply the active checkout path.
 */
import type { Blueprint, BlueprintNode } from '@/services/blueprint'
import { blueprintStatusFilter } from '../../../../../plugins/blueprint/src/shared/blueprint-note-status'
import type { BlueprintStatusFilter } from '@/components/blueprint/blueprintStatus'
import { noteKindOf, type NoteKindFilter } from '@/components/blueprint/blueprintStatus'
import type { BlueprintMaintenanceScope } from '../../../../../plugins/blueprint/src/shared/janus/maintenance-types'
import { buildEffectiveHierarchy } from './canvas-navigation'
import { sameCheckoutPath } from './resolveNodeWorkspace'
import { projectArchitecture } from './architecture-view'
import { projectModuleBrowse } from './module-browsing'

export type FocusStatusFilter = BlueprintStatusFilter
export type FocusKindFilter = NoteKindFilter

/** Matches the shared IPC normalizer cap; main rejects larger ref lists. */
export const MAX_CONTEXT_NOTE_REFS = 64

export type BlueprintContextReason = 'filter' | 'selection' | 'view'

export interface BlueprintContextNoteRef {
  uri: string
  expectedHash?: string
  checkoutPath: string
}

export interface BlueprintContextScope {
  /** Why this batch was chosen — drives the panel banner. */
  reason: BlueprintContextReason
  /** Note identities Janus receives as source text. */
  noteRefs: BlueprintContextNoteRef[]
  /** Writable scope for maintenance proposals. */
  maintenanceScope: BlueprintMaintenanceScope
  /** `selected` / `subtree` / `view` mirror of the read batch. */
  scope: 'selected' | 'subtree' | 'view'
  /** Matched but cut by MAX_CONTEXT_NOTE_REFS. */
  droppedNodeIds: string[]
  /** Matched but living in a checkout other than the active one. */
  foreignNodeIds: string[]
  /** Checkout that owns `foreignNodeIds` — the switch target when the batch is unreadable here. */
  foreignCheckoutPath: string | null
  /** Matched nodes with no Note identity at all. */
  sourcelessNodeIds: string[]
}

export interface BlueprintFocusInput {
  searchQuery: string
  statusFilter: FocusStatusFilter
  kindFilter: FocusKindFilter
  selectedId: string | null
  /** Undefined for legacy document canvases; null denotes multi-root aggregation. */
  moduleScopeId?: string | null
}

export const EMPTY_FOCUS: BlueprintFocusInput = {
  searchQuery: '',
  statusFilter: 'all',
  kindFilter: 'all',
  selectedId: null,
}

export function normalizeSearchText(value: string): string {
  return value.trim().toLowerCase()
}

export function buildNodeSearchText(node: BlueprintNode): string {
  return [
    node.title,
    node.sourceUri,
    node.sourceRelPath,
    ...(node.note?.metadata?.codeRefs?.map(ref => ref.path) ?? []),
    node.kind,
    node.lifecycle,
    node.type,
    node.status,
    node.positioning,
    node.techSolution,
    node.description,
    ...(node.tags ?? []),
    ...(node.features ?? []).flatMap((feature) => [
      feature.title,
      feature.description,
      feature.status,
      ...(feature.requirementNotes ?? [])
    ]),
    ...(node.issues ?? []).flatMap((issue) => [
      issue.title,
      issue.description,
      issue.severity,
      issue.status
    ])
  ]
    .filter(Boolean)
    .join('\n')
    .toLowerCase()
}

export function nodeMatchesFocus(
  node: BlueprintNode,
  query: string,
  statusFilter: FocusStatusFilter,
  kindFilter: FocusKindFilter,
  searchText?: string,
): boolean {
  const statusMatches = statusFilter === 'all' || blueprintStatusFilter(node) === statusFilter
  const kindMatches = kindFilter === 'all' || noteKindOf(node) === kindFilter
  const queryMatches = !query || (searchText ?? buildNodeSearchText(node)).includes(query)
  return statusMatches && kindMatches && queryMatches
}

/** Selected node plus every descendant, following the cycle-safe hierarchy. */
export function focusSubtreeIds(blueprint: Blueprint, nodeId: string): string[] {
  const { childrenByParent } = buildEffectiveHierarchy(blueprint.nodes)
  const out: string[] = []
  const seen = new Set<string>()
  const visit = (id: string): void => {
    if (seen.has(id) || !blueprint.nodes[id]) return
    seen.add(id)
    out.push(id)
    for (const childId of childrenByParent.get(id) ?? []) visit(childId)
  }
  visit(nodeId)
  return out
}

export interface BlueprintContextPaths {
  /** Checkout the conversation is authorized against. */
  active: string | null
  /** Checkout that owns this graph; the fallback when there is no composition. */
  owner: string | null
}

export function resolveBlueprintContextScope(
  blueprint: Blueprint,
  focus: BlueprintFocusInput,
  paths: BlueprintContextPaths,
): BlueprintContextScope {
  const query = normalizeSearchText(focus.searchQuery)
  const filterActive = query.length > 0 || focus.statusFilter !== 'all' || focus.kindFilter !== 'all'
  const selected = focus.selectedId && blueprint.nodes[focus.selectedId] ? focus.selectedId : null

  let candidates: string[]
  let reason: BlueprintContextReason
  if (filterActive) {
    candidates = blueprint.nodeIds.filter((id) => {
      const node = blueprint.nodes[id]
      return node ? nodeMatchesFocus(node, query, focus.statusFilter, focus.kindFilter) : false
    })
    reason = 'filter'
  } else if (focus.moduleScopeId !== undefined) {
    candidates = projectModuleBrowse(blueprint, projectArchitecture(blueprint), focus.moduleScopeId).graph.nodeIds
    if (selected) candidates = [selected, ...candidates.filter(id => id !== selected)]
    reason = 'view'
  } else if (selected) {
    candidates = focusSubtreeIds(blueprint, selected)
    reason = 'selection'
  } else {
    candidates = [...blueprint.nodeIds]
    reason = 'view'
  }

  const noteRefs: BlueprintContextNoteRef[] = []
  const droppedNodeIds: string[] = []
  const foreignNodeIds: string[] = []
  const foreignPaths = new Set<string>()
  const sourcelessNodeIds: string[] = []
  const seenUris = new Set<string>()

  for (const id of candidates) {
    const node = blueprint.nodes[id]
    if (!node?.sourceUri) {
      sourcelessNodeIds.push(id)
      continue
    }
    // A composition member names its own checkout; everything else belongs to
    // the graph owner.
    const path = blueprint.composition?.nodes[id]?.path || paths.owner
    if (!path || !paths.active || !sameCheckoutPath(path, paths.active)) {
      foreignNodeIds.push(id)
      if (path) foreignPaths.add(path)
      continue
    }
    if (seenUris.has(node.sourceUri)) continue
    if (noteRefs.length >= MAX_CONTEXT_NOTE_REFS) {
      droppedNodeIds.push(id)
      continue
    }
    seenUris.add(node.sourceUri)
    noteRefs.push({
      uri: node.sourceUri,
      ...(node.sourceHash ? { expectedHash: node.sourceHash } : {}),
      checkoutPath: path,
    })
  }

  return {
    reason,
    noteRefs,
    // A batch expressed through the filters authorizes the whole graph;
    // an idle single selection keeps the narrow node scope.
    maintenanceScope: filterActive || !selected ? { type: 'blueprint' } : { type: 'node', nodeId: selected },
    scope: reason === 'filter' ? 'selected' : reason === 'selection' ? 'subtree' : 'view',
    droppedNodeIds,
    foreignNodeIds,
    // One switch target only: a batch spanning checkouts has no single answer.
    foreignCheckoutPath: foreignPaths.size === 1 ? [...foreignPaths][0] : null,
    sourcelessNodeIds,
  }
}
