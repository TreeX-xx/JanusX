import { randomUUID } from 'node:crypto'
import type { Blueprint, BlueprintFeatureItem, BlueprintNode } from '../../shared/janus/types'
import { sanitizeRelations } from '../../shared/janus/relations'

export const BLUEPRINT_SCHEMA_VERSION = 4

type VersionedBlueprint = Blueprint & { schemaVersion?: number }

function legacyFeature(input: {
  title: string
  description?: string
  done?: boolean
  note: string
}): BlueprintFeatureItem {
  const now = new Date().toISOString()
  return {
    id: randomUUID(),
    title: input.title,
    description: input.description ?? '',
    progress: input.done ? 100 : 0,
    status: input.done ? 'done' : 'planned',
    requirementNotes: [input.note],
    createdAt: now,
    updatedAt: now
  }
}

function migrateLegacyNodeFields(node: BlueprintNode): boolean {
  const features = Array.isArray(node.features) ? node.features : []
  const titles = new Set(features.map((feature) => feature.title.trim().toLowerCase()).filter(Boolean))
  const additions: BlueprintFeatureItem[] = []
  const add = (feature: BlueprintFeatureItem) => {
    const baseTitle = feature.title.trim()
    if (!baseTitle) return
    let title = baseTitle
    let suffix = 2
    while (titles.has(title.toLowerCase())) {
      title = `${baseTitle} (${suffix++})`
    }
    feature.title = title
    const key = title.toLowerCase()
    titles.add(key)
    additions.push(feature)
  }

  const description = node.description?.trim()
  if (description) {
    add(legacyFeature({
      title: description.split(/\r?\n/)[0].slice(0, 48),
      description,
      note: '由旧版节点描述迁移'
    }))
  }
  for (const item of node.completedItems ?? []) {
    const title = item.trim()
    if (title) add(legacyFeature({ title, done: true, note: '由旧版已完成事项迁移' }))
  }
  for (const todo of node.todos ?? []) {
    const title = todo.text.trim()
    if (title) add(legacyFeature({ title, done: todo.done, note: '由旧版待办迁移' }))
  }

  if (!additions.length && !description && !(node.completedItems?.length) && !(node.todos?.length)) {
    return false
  }
  node.features = [...features, ...additions]
  node.description = ''
  node.completedItems = []
  node.todos = []
  return true
}

export function reconcileBlueprintTree(blueprint: Blueprint): boolean {
  let changed = false
  const validIds = new Set(Object.keys(blueprint.nodes))
  const normalizedIds = [
    ...blueprint.nodeIds.filter((id, index, ids) => validIds.has(id) && ids.indexOf(id) === index),
    ...Object.keys(blueprint.nodes).filter((id) => !blueprint.nodeIds.includes(id))
  ]
  if (normalizedIds.length !== blueprint.nodeIds.length || normalizedIds.some((id, i) => id !== blueprint.nodeIds[i])) {
    blueprint.nodeIds = normalizedIds
    changed = true
  }
  if (!blueprint.nodeIds.length) return changed

  if (!validIds.has(blueprint.rootNodeId)) {
    blueprint.rootNodeId = blueprint.nodeIds.find((id) => !blueprint.nodes[id].parentId) ?? blueprint.nodeIds[0]
    changed = true
  }
  if (blueprint.nodes[blueprint.rootNodeId].parentId !== null) {
    blueprint.nodes[blueprint.rootNodeId].parentId = null
    changed = true
  }

  for (const id of blueprint.nodeIds) {
    const node = blueprint.nodes[id]
    if (node.parentId === id || (node.parentId && !validIds.has(node.parentId))) {
      node.parentId = null
      changed = true
    }
    const seen = new Set([id])
    let cursor = node.parentId
    while (cursor) {
      if (seen.has(cursor)) {
        node.parentId = null
        changed = true
        break
      }
      seen.add(cursor)
      cursor = blueprint.nodes[cursor]?.parentId ?? null
    }
  }

  const expectedChildren = Object.fromEntries(blueprint.nodeIds.map((id) => [id, [] as string[]]))
  for (const id of blueprint.nodeIds) {
    const parentId = blueprint.nodes[id].parentId
    if (parentId) expectedChildren[parentId].push(id)
  }
  for (const id of blueprint.nodeIds) {
    const current = Array.isArray(blueprint.nodes[id].children) ? blueprint.nodes[id].children : []
    const expected = expectedChildren[id]
    if (current.length !== expected.length || current.some((childId, index) => childId !== expected[index])) {
      blueprint.nodes[id].children = expected
      changed = true
    }
  }
  return changed
}

/**
 * Keeps the workspace binding trio coherent on every load:
 * primaryWorkspaceId is canonical, the legacy workspaceId field mirrors it,
 * and linkedWorkspaceIds never contains the primary or duplicates.
 */
export function reconcileNodeWorkspaceBinding(node: BlueprintNode): boolean {
  let changed = false
  if (node.primaryWorkspaceId === undefined) {
    node.primaryWorkspaceId = node.workspaceId ?? null
    changed = true
  }
  if (node.workspaceId !== node.primaryWorkspaceId) {
    node.workspaceId = node.primaryWorkspaceId
    changed = true
  }
  const linked = Array.isArray(node.linkedWorkspaceIds) ? node.linkedWorkspaceIds : []
  const normalized = linked.filter((id, index) =>
    typeof id === 'string' && id !== node.primaryWorkspaceId && linked.indexOf(id) === index)
  if (!Array.isArray(node.linkedWorkspaceIds)
    || normalized.length !== node.linkedWorkspaceIds.length) {
    node.linkedWorkspaceIds = normalized
    changed = true
  }
  return changed
}

export function migrateBlueprint(blueprint: Blueprint): boolean {
  const versioned = blueprint as VersionedBlueprint
  let changed = reconcileBlueprintTree(blueprint)
  if (blueprint.collapsedNodeIds !== undefined
    && blueprint.collapsedNodeIds !== null
    && !Array.isArray(blueprint.collapsedNodeIds)) {
    blueprint.collapsedNodeIds = null
    changed = true
  }
  if (Array.isArray(blueprint.collapsedNodeIds)) {
    const validIds = new Set(Object.keys(blueprint.nodes))
    const normalized = [...new Set(blueprint.collapsedNodeIds.filter((id) => validIds.has(id)))]
    if (normalized.length !== blueprint.collapsedNodeIds.length
      || normalized.some((id, index) => id !== blueprint.collapsedNodeIds![index])) {
      blueprint.collapsedNodeIds = normalized
      changed = true
    }
  }
  const version = Number.isInteger(versioned.schemaVersion) ? versioned.schemaVersion as number : 0
  if (version < 1) {
    for (const node of Object.values(blueprint.nodes)) {
      changed = migrateLegacyNodeFields(node) || changed
    }
    versioned.schemaVersion = 1
    changed = true
  }
  if (version < 2) {
    blueprint.contentRevision = Number.isInteger(blueprint.contentRevision)
      ? Math.max(0, blueprint.contentRevision)
      : 0
    versioned.schemaVersion = 2
    changed = true
  }
  if (version < 3) {
    versioned.schemaVersion = BLUEPRINT_SCHEMA_VERSION
    changed = true
  }
  if (version < 4) {
    if (blueprint.collapsedNodeIds === undefined) {
      blueprint.collapsedNodeIds = null
      changed = true
    }
    versioned.schemaVersion = BLUEPRINT_SCHEMA_VERSION
    changed = true
  }
  const sanitized = sanitizeRelations(blueprint.relations, new Set(Object.keys(blueprint.nodes)))
  if (sanitized.changed) {
    blueprint.relations = sanitized.relations
    changed = true
  }
  for (const node of Object.values(blueprint.nodes)) {
    changed = reconcileNodeWorkspaceBinding(node) || changed
  }
  return changed
}
