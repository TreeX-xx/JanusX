import type { BlueprintRelation, BlueprintRelationType } from './types'

export const BLUEPRINT_RELATION_TYPES: BlueprintRelationType[] = [
  'depends-on', 'blocks', 'related-to', 'implements',
]

/** Directed relation types that must never form a cycle, each checked on its own graph. */
export const ACYCLIC_RELATION_TYPES: BlueprintRelationType[] = ['depends-on', 'blocks']

/** related-to is symmetric: exactly one canonical record per unordered node pair. */
export function normalizeRelationEndpoints(
  type: BlueprintRelationType,
  sourceNodeId: string,
  targetNodeId: string,
): { sourceNodeId: string; targetNodeId: string } {
  if (type === 'related-to' && targetNodeId < sourceNodeId) {
    return { sourceNodeId: targetNodeId, targetNodeId: sourceNodeId }
  }
  return { sourceNodeId, targetNodeId }
}

/** Canonical duplicate key: unordered pair for related-to, ordered pair otherwise. */
export function relationPairKey(
  type: BlueprintRelationType,
  sourceNodeId: string,
  targetNodeId: string,
): string {
  const { sourceNodeId: a, targetNodeId: b } = normalizeRelationEndpoints(type, sourceNodeId, targetNodeId)
  return `${type}|${a}|${b}`
}

export class BlueprintRelationError extends Error {}

/**
 * Validates the full relation set against the given node ids.
 * Throws on: unknown endpoints, self relations, duplicates (related-to treated
 * as unordered), and directed cycles in depends-on / blocks graphs.
 */
export function assertRelationInvariants(
  relations: BlueprintRelation[],
  nodeIds: Set<string>,
): void {
  const keys = new Set<string>()
  for (const relation of relations) {
    if (!nodeIds.has(relation.sourceNodeId) || !nodeIds.has(relation.targetNodeId)) {
      throw new BlueprintRelationError(`关系 ${relation.id} 的端点节点不存在`)
    }
    if (relation.sourceNodeId === relation.targetNodeId) {
      throw new BlueprintRelationError(`关系 ${relation.id} 不允许节点自关联`)
    }
    const key = relationPairKey(relation.type, relation.sourceNodeId, relation.targetNodeId)
    if (keys.has(key)) {
      throw new BlueprintRelationError(`关系重复：${relation.type} ${relation.sourceNodeId} -> ${relation.targetNodeId}`)
    }
    keys.add(key)
  }
  for (const type of ACYCLIC_RELATION_TYPES) {
    const cycleNode = findDirectedCycle(relations.filter((relation) => relation.type === type))
    if (cycleNode) {
      throw new BlueprintRelationError(`${type} 关系不允许形成有向环（涉及节点 ${cycleNode}）`)
    }
  }
}

/** Returns a node id that participates in a directed cycle, or null when acyclic. */
export function findDirectedCycle(relations: BlueprintRelation[]): string | null {
  const edges = new Map<string, string[]>()
  for (const relation of relations) {
    const targets = edges.get(relation.sourceNodeId) ?? []
    targets.push(relation.targetNodeId)
    edges.set(relation.sourceNodeId, targets)
  }
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visit = (id: string): string | null => {
    if (visited.has(id)) return null
    if (visiting.has(id)) return id
    visiting.add(id)
    for (const next of edges.get(id) ?? []) {
      const found = visit(next)
      if (found) return found
    }
    visiting.delete(id)
    visited.add(id)
    return null
  }
  for (const id of edges.keys()) {
    const found = visit(id)
    if (found) return found
  }
  return null
}

/**
 * Repairs a persisted relation array in place for migration: drops entries with
 * missing endpoints, self relations, unknown types, and duplicates; normalizes
 * related-to endpoint order. Returns true when anything changed.
 */
export function sanitizeRelations(
  relations: unknown,
  nodeIds: Set<string>,
): { relations: BlueprintRelation[]; changed: boolean } {
  if (!Array.isArray(relations)) return { relations: [], changed: true }
  const keys = new Set<string>()
  const kept: BlueprintRelation[] = []
  let changed = false
  for (const raw of relations) {
    const relation = raw as BlueprintRelation
    const valid = relation
      && typeof relation.id === 'string'
      && typeof relation.sourceNodeId === 'string'
      && typeof relation.targetNodeId === 'string'
      && BLUEPRINT_RELATION_TYPES.includes(relation.type)
      && relation.sourceNodeId !== relation.targetNodeId
      && nodeIds.has(relation.sourceNodeId)
      && nodeIds.has(relation.targetNodeId)
    if (!valid) { changed = true; continue }
    const key = relationPairKey(relation.type, relation.sourceNodeId, relation.targetNodeId)
    if (keys.has(key)) { changed = true; continue }
    keys.add(key)
    const normalized = normalizeRelationEndpoints(relation.type, relation.sourceNodeId, relation.targetNodeId)
    if (normalized.sourceNodeId !== relation.sourceNodeId) {
      changed = true
      kept.push({ ...relation, ...normalized })
    } else {
      kept.push(relation)
    }
  }
  // Cycles in persisted data cannot be auto-repaired safely; drop later edges until acyclic.
  for (const type of ACYCLIC_RELATION_TYPES) {
    let cycleNode = findDirectedCycle(kept.filter((relation) => relation.type === type))
    while (cycleNode) {
      let index = -1
      for (let i = kept.length - 1; i >= 0; i -= 1) {
        const relation = kept[i]
        if (relation.type === type && (relation.sourceNodeId === cycleNode || relation.targetNodeId === cycleNode)) {
          index = i
          break
        }
      }
      if (index < 0) break
      kept.splice(index, 1)
      changed = true
      cycleNode = findDirectedCycle(kept.filter((relation) => relation.type === type))
    }
  }
  return { relations: kept, changed }
}
