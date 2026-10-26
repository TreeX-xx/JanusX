import { randomUUID } from 'node:crypto'
import type { Blueprint, BlueprintNode, BlueprintRelation } from '../../../shared/janus/types'
import type {
  BlueprintChangeSet,
  BlueprintDeleteNodeImpact,
  BlueprintMaintenanceAuditRecord,
  BlueprintOperation,
} from '../../../shared/janus/maintenance-types'
import {
  assertRelationInvariants,
  normalizeRelationEndpoints,
  relationPairKey,
} from '../../../shared/janus/relations'
import { makeFeatureItem, makeNode, nowIso } from '../blueprint-factory'
import { reconcileBlueprintTree, reconcileNodeWorkspaceBinding } from '../blueprint-migration'

const UPDATE_FIELDS = new Set([
  'title', 'type', 'status', 'progress', 'positioning', 'description',
  'techSolution', 'notes', 'tags', 'features'
])

export class BlueprintChangeSetError extends Error {}

export interface BlueprintApplyOutcome {
  blueprint: Blueprint
  /** Real ids assigned during apply, keyed by proposal temp id. */
  createdNodeIds: Record<string, string>
  createdRelationIds: Record<string, string>
}

export function scopeNodeIds(blueprint: Blueprint, scope: { type: string; nodeId?: string }): Set<string> {
  if (scope.type === 'blueprint') return new Set(blueprint.nodeIds)
  if (!scope.nodeId || !blueprint.nodes[scope.nodeId]) return new Set()
  if (scope.type === 'node') return new Set([scope.nodeId])
  const ids = new Set<string>()
  const visit = (id: string) => {
    if (ids.has(id)) return
    ids.add(id)
    for (const childId of blueprint.nodes[id]?.children ?? []) visit(childId)
  }
  visit(scope.nodeId)
  return ids
}

export function selectOperations(changeSet: BlueprintChangeSet, selectedIds: string[]): BlueprintOperation[] {
  const selected = new Set(selectedIds)
  const operations = changeSet.operations.filter((operation) => selected.has(operation.operationId))
  const available = new Set(operations.map((operation) => operation.operationId))
  for (const operation of operations) {
    const missing = operation.dependsOn.find((id) => !available.has(id))
    if (missing) throw new BlueprintChangeSetError(`操作 ${operation.operationId} 缺少依赖 ${missing}`)
  }
  const byId = new Map(operations.map((operation) => [operation.operationId, operation]))
  const ordered: BlueprintOperation[] = []
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visit = (id: string) => {
    if (visited.has(id)) return
    if (visiting.has(id)) throw new BlueprintChangeSetError('操作依赖不能形成环')
    const operation = byId.get(id)
    if (!operation) return
    visiting.add(id)
    operation.dependsOn.forEach(visit)
    visiting.delete(id)
    visited.add(id)
    ordered.push(operation)
  }
  operations.forEach((operation) => visit(operation.operationId))
  return ordered
}

export function deleteNodeImpact(blueprint: Blueprint, nodeId: string): BlueprintDeleteNodeImpact {
  const node = blueprint.nodes[nodeId]
  const relations = blueprint.relations ?? []
  return {
    title: node?.title ?? nodeId,
    parentId: node?.parentId ?? null,
    childIds: [...(node?.children ?? [])],
    incomingRelationIds: relations.filter((relation) => relation.targetNodeId === nodeId).map((relation) => relation.id),
    outgoingRelationIds: relations.filter((relation) => relation.sourceNodeId === nodeId).map((relation) => relation.id),
  }
}

export function normalizeProposedOperations(
  blueprint: Blueprint,
  allowed: Set<string>,
  input: BlueprintOperation[],
): BlueprintOperation[] {
  const operationIds = new Set<string>()
  const relations = blueprint.relations ?? []
  const relationById = new Map(relations.map((relation) => [relation.id, relation]))
  const tempNodeOwners = new Map(input
    .filter((item) => item.type === 'create-node')
    .map((item) => [item.tempNodeId, item.operationId]))
  const requireTempDependency = (targetId: string, operation: BlueprintOperation) => {
    const owner = tempNodeOwners.get(targetId)
    if (owner && !operation.dependsOn.includes(owner)) {
      throw new BlueprintChangeSetError(`操作 ${operation.operationId} 必须依赖临时节点创建操作 ${owner}`)
    }
  }
  const requireNodeRef = (id: string, operation: BlueprintOperation, label: string) => {
    if (tempNodeOwners.has(id)) { requireTempDependency(id, operation); return }
    if (!blueprint.nodes[id]) throw new BlueprintChangeSetError(`${label}不存在：${id}`)
  }
  const inScopeOrTemp = (id: string) => allowed.has(id) || tempNodeOwners.has(id)
  const proposedRelationKeys = new Set<string>()

  return input.map((operation) => {
    if (operationIds.has(operation.operationId)) throw new BlueprintChangeSetError(`重复 operationId：${operation.operationId}`)
    operationIds.add(operation.operationId)

    switch (operation.type) {
      case 'create-node': {
        if (!inScopeOrTemp(operation.parentId)) {
          throw new BlueprintChangeSetError(`新节点超出维护范围：${operation.parentId}`)
        }
        requireTempDependency(operation.parentId, operation)
        return operation
      }
      case 'add-relation': {
        const { sourceNodeId, targetNodeId, relationType } = operation.after
        if (sourceNodeId === targetNodeId) throw new BlueprintChangeSetError('关系不允许节点自关联')
        requireNodeRef(sourceNodeId, operation, '关系源节点')
        requireNodeRef(targetNodeId, operation, '关系目标节点')
        if (!inScopeOrTemp(sourceNodeId) && !inScopeOrTemp(targetNodeId)) {
          throw new BlueprintChangeSetError('关系两端都超出维护范围，请先申请范围扩展')
        }
        // Temp endpoints resolve at apply; duplicate detection here covers real endpoints only.
        if (!tempNodeOwners.has(sourceNodeId) && !tempNodeOwners.has(targetNodeId)) {
          const key = relationPairKey(relationType, sourceNodeId, targetNodeId)
          const exists = relations.some((relation) =>
            relationPairKey(relation.type, relation.sourceNodeId, relation.targetNodeId) === key)
          if (exists || proposedRelationKeys.has(key)) {
            throw new BlueprintChangeSetError(`关系已存在：${relationType} ${sourceNodeId} -> ${targetNodeId}`)
          }
          proposedRelationKeys.add(key)
        }
        return operation
      }
      case 'update-relation':
      case 'remove-relation': {
        const relation = relationById.get(operation.relationId)
        if (!relation) throw new BlueprintChangeSetError(`关系不存在：${operation.relationId}`)
        if (!allowed.has(relation.sourceNodeId) && !allowed.has(relation.targetNodeId)) {
          throw new BlueprintChangeSetError(`关系两端都超出维护范围：${operation.relationId}`)
        }
        if (operation.type === 'remove-relation') {
          return { ...operation, before: structuredClone(relation) }
        }
        if (operation.after.relationType === undefined && operation.after.description === undefined) {
          throw new BlueprintChangeSetError(`关系更新缺少变更内容：${operation.relationId}`)
        }
        return { ...operation, before: { type: relation.type, description: relation.description } }
      }
      case 'update-workspace-binding': {
        if (!allowed.has(operation.nodeId) || !blueprint.nodes[operation.nodeId]) {
          throw new BlueprintChangeSetError(`操作超出维护范围：${operation.nodeId}`)
        }
        const { primaryWorkspaceId, linkedWorkspaceIds } = operation.after
        if (primaryWorkspaceId && linkedWorkspaceIds.includes(primaryWorkspaceId)) {
          throw new BlueprintChangeSetError('主要工作区不能同时出现在辅助列表中')
        }
        if (new Set(linkedWorkspaceIds).size !== linkedWorkspaceIds.length) {
          throw new BlueprintChangeSetError('辅助工作区列表不能重复')
        }
        const node = blueprint.nodes[operation.nodeId]
        return {
          ...operation,
          before: {
            primaryWorkspaceId: node.primaryWorkspaceId ?? node.workspaceId ?? null,
            linkedWorkspaceIds: [...(node.linkedWorkspaceIds ?? [])],
          },
        }
      }
      case 'archive-node': {
        if (!allowed.has(operation.nodeId) || !blueprint.nodes[operation.nodeId]) {
          throw new BlueprintChangeSetError(`操作超出维护范围：${operation.nodeId}`)
        }
        return { ...operation, beforeStatus: blueprint.nodes[operation.nodeId].status }
      }
      case 'delete-node': {
        if (!allowed.has(operation.nodeId) || !blueprint.nodes[operation.nodeId]) {
          throw new BlueprintChangeSetError(`操作超出维护范围：${operation.nodeId}`)
        }
        if (operation.nodeId === blueprint.rootNodeId) {
          throw new BlueprintChangeSetError('根节点不能删除')
        }
        return { ...operation, risk: 'high' as const, impact: deleteNodeImpact(blueprint, operation.nodeId) }
      }
      case 'restore-node': {
        throw new BlueprintChangeSetError('restore-node 只能由撤销流程生成，不接受模型提案')
      }
      default: {
        let nodeOperation = operation as Extract<BlueprintOperation, { type: 'update-node' | 'move-node' }>
        if (!allowed.has(nodeOperation.nodeId) || !blueprint.nodes[nodeOperation.nodeId]) {
          throw new BlueprintChangeSetError(`操作超出维护范围：${nodeOperation.nodeId}`)
        }
        if (nodeOperation.type === 'move-node') {
          if (!inScopeOrTemp(nodeOperation.afterParentId)) {
            throw new BlueprintChangeSetError(`移动目标超出维护范围：${nodeOperation.afterParentId}`)
          }
          requireTempDependency(nodeOperation.afterParentId, nodeOperation)
          return { ...nodeOperation, beforeParentId: blueprint.nodes[nodeOperation.nodeId].parentId }
        }
        if (nodeOperation.after.features) {
          const currentFeatures = new Map(blueprint.nodes[nodeOperation.nodeId].features.map((feature) => [feature.id, feature]))
          nodeOperation = {
            ...nodeOperation,
            after: {
              ...nodeOperation.after,
              features: nodeOperation.after.features.map((feature) => {
                const current = feature.id ? currentFeatures.get(feature.id) : undefined
                return makeFeatureItem({
                  ...feature,
                  id: current?.id,
                  createdAt: current?.createdAt,
                  updatedAt: nowIso(),
                })
              }),
            },
          }
        }
        const before = Object.fromEntries(Object.keys(nodeOperation.after).map((key) => [
          key,
          (blueprint.nodes[nodeOperation.nodeId] as unknown as Record<string, unknown>)[key],
        ])) as Partial<BlueprintNode>
        return { ...nodeOperation, before }
      }
    }
  })
}

export function applyOperations(
  source: Blueprint,
  operations: BlueprintOperation[],
  allowedNodeIds: Set<string>
): BlueprintApplyOutcome {
  const blueprint = structuredClone(source)
  if (!Array.isArray(blueprint.relations)) blueprint.relations = []
  const tempNodeIds = new Map<string, string>()
  const tempRelationIds = new Map<string, string>()
  const resolveNodeId = (id: string) => tempNodeIds.get(id) ?? id
  const resolveRelationId = (id: string) => tempRelationIds.get(id) ?? id
  const relationIndex = () => new Map(blueprint.relations.map((relation) => [relation.id, relation]))

  for (const operation of operations) {
    switch (operation.type) {
      case 'create-node': {
        const parentId = resolveNodeId(operation.parentId)
        if (!blueprint.nodes[parentId] || (!allowedNodeIds.has(parentId) && !tempNodeIds.has(operation.parentId))) {
          throw new BlueprintChangeSetError(`新节点父节点不在维护范围内：${operation.parentId}`)
        }
        const node = makeNode({ ...operation.after, parentId, id: randomUUID() })
        tempNodeIds.set(operation.tempNodeId, node.id)
        blueprint.nodes[node.id] = node
        blueprint.nodeIds.push(node.id)
        allowedNodeIds.add(node.id)
        break
      }
      case 'add-relation': {
        const sourceNodeId = resolveNodeId(operation.after.sourceNodeId)
        const targetNodeId = resolveNodeId(operation.after.targetNodeId)
        if (!blueprint.nodes[sourceNodeId] || !blueprint.nodes[targetNodeId]) {
          throw new BlueprintChangeSetError('关系端点节点不存在')
        }
        if (sourceNodeId === targetNodeId) throw new BlueprintChangeSetError('关系不允许节点自关联')
        const type = operation.after.relationType
        const key = relationPairKey(type, sourceNodeId, targetNodeId)
        if (blueprint.relations.some((relation) =>
          relationPairKey(relation.type, relation.sourceNodeId, relation.targetNodeId) === key)) {
          throw new BlueprintChangeSetError(`关系已存在：${type} ${sourceNodeId} -> ${targetNodeId}`)
        }
        const endpoints = normalizeRelationEndpoints(type, sourceNodeId, targetNodeId)
        const now = nowIso()
        const relation: BlueprintRelation = {
          id: randomUUID(), ...endpoints, type,
          description: operation.after.description, createdAt: now, updatedAt: now,
        }
        tempRelationIds.set(operation.tempRelationId, relation.id)
        blueprint.relations.push(relation)
        break
      }
      case 'update-relation': {
        const relation = relationIndex().get(resolveRelationId(operation.relationId))
        if (!relation) throw new BlueprintChangeSetError(`关系不存在：${operation.relationId}`)
        if (operation.after.relationType !== undefined && operation.after.relationType !== relation.type) {
          relation.type = operation.after.relationType
          const endpoints = normalizeRelationEndpoints(relation.type, relation.sourceNodeId, relation.targetNodeId)
          relation.sourceNodeId = endpoints.sourceNodeId
          relation.targetNodeId = endpoints.targetNodeId
        }
        if (operation.after.description !== undefined) relation.description = operation.after.description
        relation.updatedAt = nowIso()
        break
      }
      case 'remove-relation': {
        const realId = resolveRelationId(operation.relationId)
        if (!blueprint.relations.some((relation) => relation.id === realId)) {
          throw new BlueprintChangeSetError(`关系不存在：${operation.relationId}`)
        }
        blueprint.relations = blueprint.relations.filter((relation) => relation.id !== realId)
        break
      }
      case 'update-workspace-binding': {
        const nodeId = resolveNodeId(operation.nodeId)
        const node = blueprint.nodes[nodeId]
        if (!node || !allowedNodeIds.has(nodeId)) {
          throw new BlueprintChangeSetError(`目标节点不在维护范围内：${operation.nodeId}`)
        }
        const { primaryWorkspaceId, linkedWorkspaceIds } = operation.after
        if (primaryWorkspaceId && linkedWorkspaceIds.includes(primaryWorkspaceId)) {
          throw new BlueprintChangeSetError('主要工作区不能同时出现在辅助列表中')
        }
        if (node.primaryWorkspaceId !== primaryWorkspaceId) node.workspaceSnapshot = null
        node.primaryWorkspaceId = primaryWorkspaceId
        node.linkedWorkspaceIds = [...new Set(linkedWorkspaceIds)]
        reconcileNodeWorkspaceBinding(node)
        node.updatedAt = nowIso()
        break
      }
      case 'archive-node': {
        const nodeId = resolveNodeId(operation.nodeId)
        const node = blueprint.nodes[nodeId]
        if (!node || !allowedNodeIds.has(nodeId)) {
          throw new BlueprintChangeSetError(`目标节点不在维护范围内：${operation.nodeId}`)
        }
        node.status = 'archived'
        node.updatedAt = nowIso()
        break
      }
      case 'delete-node': {
        const nodeId = resolveNodeId(operation.nodeId)
        const node = blueprint.nodes[nodeId]
        if (!node || !allowedNodeIds.has(nodeId)) {
          throw new BlueprintChangeSetError(`目标节点不在维护范围内：${operation.nodeId}`)
        }
        if (nodeId === blueprint.rootNodeId) throw new BlueprintChangeSetError('根节点不能删除')
        const remainingChildren = blueprint.nodeIds.filter((id) => blueprint.nodes[id]?.parentId === nodeId)
        if (remainingChildren.length) {
          throw new BlueprintChangeSetError(`删除前必须先处理子节点：${remainingChildren.join(', ')}`)
        }
        const touching = blueprint.relations.filter((relation) =>
          relation.sourceNodeId === nodeId || relation.targetNodeId === nodeId)
        if (touching.length) {
          throw new BlueprintChangeSetError(`删除前必须先清理关系：${touching.map((relation) => relation.id).join(', ')}`)
        }
        const parent = node.parentId ? blueprint.nodes[node.parentId] : null
        if (parent) parent.children = parent.children.filter((id) => id !== nodeId)
        delete blueprint.nodes[nodeId]
        blueprint.nodeIds = blueprint.nodeIds.filter((id) => id !== nodeId)
        delete blueprint.canvasLayout[nodeId]
        allowedNodeIds.delete(nodeId)
        break
      }
      case 'restore-node': {
        const node = structuredClone(operation.node)
        if (blueprint.nodes[node.id]) throw new BlueprintChangeSetError(`节点已存在，无法恢复：${node.id}`)
        const parentId = node.parentId
        if (parentId && !blueprint.nodes[parentId]) {
          throw new BlueprintChangeSetError(`恢复节点的父节点不存在：${parentId}`)
        }
        node.children = []
        blueprint.nodes[node.id] = node
        blueprint.nodeIds.push(node.id)
        allowedNodeIds.add(node.id)
        for (const relation of operation.relations) {
          if (!blueprint.nodes[relation.sourceNodeId] || !blueprint.nodes[relation.targetNodeId]) continue
          const key = relationPairKey(relation.type, relation.sourceNodeId, relation.targetNodeId)
          if (blueprint.relations.some((existing) =>
            relationPairKey(existing.type, existing.sourceNodeId, existing.targetNodeId) === key)) continue
          blueprint.relations.push(structuredClone(relation))
        }
        break
      }
      case 'update-node': {
        const nodeId = resolveNodeId(operation.nodeId)
        const node = blueprint.nodes[nodeId]
        if (!node || !allowedNodeIds.has(nodeId)) {
          throw new BlueprintChangeSetError(`目标节点不在维护范围内：${operation.nodeId}`)
        }
        for (const [key, value] of Object.entries(operation.after)) {
          if (!UPDATE_FIELDS.has(key)) throw new BlueprintChangeSetError(`不允许更新字段：${key}`)
          if (key === 'progress' && (typeof value !== 'number' || value < 0 || value > 100)) {
            throw new BlueprintChangeSetError('节点进度必须在 0 到 100 之间')
          }
          ;(node as unknown as Record<string, unknown>)[key] = value
        }
        node.updatedAt = nowIso()
        break
      }
      case 'move-node': {
        const nodeId = resolveNodeId(operation.nodeId)
        const node = blueprint.nodes[nodeId]
        if (!node || !allowedNodeIds.has(nodeId)) {
          throw new BlueprintChangeSetError(`目标节点不在维护范围内：${operation.nodeId}`)
        }
        const parentId = resolveNodeId(operation.afterParentId)
        if (!blueprint.nodes[parentId] || (!allowedNodeIds.has(parentId) && !tempNodeIds.has(operation.afterParentId))) {
          throw new BlueprintChangeSetError(`目标父节点不在维护范围内：${operation.afterParentId}`)
        }
        if (nodeId === blueprint.rootNodeId || nodeId === parentId) {
          throw new BlueprintChangeSetError('根节点不能移动，节点也不能成为自己的父节点')
        }
        node.parentId = parentId
        node.updatedAt = nowIso()
        break
      }
    }
  }

  for (const id of blueprint.nodeIds) {
    const seen = new Set<string>()
    let cursor: string | null = id
    while (cursor) {
      if (seen.has(cursor)) throw new BlueprintChangeSetError('节点层级不能形成环')
      seen.add(cursor)
      cursor = blueprint.nodes[cursor]?.parentId ?? null
    }
  }
  reconcileBlueprintTree(blueprint)
  assertRelationInvariants(blueprint.relations, new Set(blueprint.nodeIds))
  blueprint.contentRevision = source.contentRevision + 1
  blueprint.updatedAt = nowIso()
  return {
    blueprint,
    createdNodeIds: Object.fromEntries(tempNodeIds),
    createdRelationIds: Object.fromEntries(tempRelationIds),
  }
}

export interface ReverseOperationsResult {
  operations: BlueprintOperation[]
  /** Non-blocking findings: later Blueprint changes that make a reverse step risky or impossible. */
  conflicts: string[]
}

/**
 * Builds a reverse ChangeSet operation list from an applied audit record,
 * against the current Blueprint (doc §12.2: never restores raw snapshots).
 * Reverse operations are chained with sequential dependsOn so approval keeps
 * the inverse application order intact under partial selection.
 */
export function buildReverseOperations(
  audit: BlueprintMaintenanceAuditRecord,
  current: Blueprint,
): ReverseOperationsResult {
  const applied = selectOperations(audit.changeSetSnapshot, audit.selectedOperationIds)
  const beforeBlueprint = audit.beforeSnapshot as Blueprint | undefined
  const conflicts: string[] = []
  const operations: BlueprintOperation[] = []
  const relations = current.relations ?? []
  const base = (original: BlueprintOperation, risk: 'low' | 'medium' | 'high' = 'low') => ({
    operationId: `undo-${original.operationId}`,
    reason: `撤销：${original.reason}`,
    evidenceRefs: [],
    dependsOn: operations.length ? [operations[operations.length - 1].operationId] : [],
    risk,
  })

  for (const original of [...applied].reverse()) {
    switch (original.type) {
      case 'create-node': {
        const realId = audit.createdNodeIds?.[original.tempNodeId]
        if (!realId) { conflicts.push(`无法定位新建节点“${original.after.title}”的实际 ID，已跳过`); break }
        if (!current.nodes[realId]) { conflicts.push(`节点“${original.after.title}”已不存在，无需删除`); break }
        const impact = deleteNodeImpact(current, realId)
        if (impact.childIds.length || impact.incomingRelationIds.length || impact.outgoingRelationIds.length) {
          conflicts.push(`节点“${impact.title}”此后新增了子节点或关系，需先处理才能删除`)
        }
        operations.push({ ...base(original, 'high'), type: 'delete-node', nodeId: realId, risk: 'high', impact })
        break
      }
      case 'update-node': {
        const node = current.nodes[original.nodeId]
        if (!node) { conflicts.push(`节点 ${original.nodeId} 已不存在，无法回退更新`); break }
        const after: Record<string, unknown> = {}
        const before: Record<string, unknown> = {}
        for (const key of Object.keys(original.after)) {
          const restored = (original.before as Record<string, unknown>)[key]
          if (restored === undefined) continue
          after[key] = restored
          // Note sections are absent from the canvas projection. Their inverse
          // comes from translated source bytes; sourceHashes guard all drift.
          if (key === 'sections') continue
          before[key] = (node as unknown as Record<string, unknown>)[key]
          const expected = (original.after as Record<string, unknown>)[key]
          if (JSON.stringify(before[key]) !== JSON.stringify(expected)) {
            conflicts.push(`节点“${node.title}”的 ${key} 此后又被修改过，回退将覆盖较新的值`)
          }
        }
        if (!Object.keys(after).length) { conflicts.push(`节点 ${original.nodeId} 的更新没有可回退字段`); break }
        operations.push({
          ...base(original), type: 'update-node', nodeId: original.nodeId,
          before: before as Partial<BlueprintNode>,
          after: after as Extract<BlueprintOperation, { type: 'update-node' }>['after'],
        })
        break
      }
      case 'move-node': {
        const node = current.nodes[original.nodeId]
        if (!node) { conflicts.push(`节点 ${original.nodeId} 已不存在，无法移回`); break }
        if (!original.beforeParentId) { conflicts.push(`节点 ${original.nodeId} 缺少原父节点，无法移回`); break }
        if (!current.nodes[original.beforeParentId]) { conflicts.push(`原父节点 ${original.beforeParentId} 已不存在，无法移回`); break }
        if (node.parentId !== original.afterParentId) {
          conflicts.push(`节点“${node.title}”此后又被移动过，回退将覆盖较新的位置`)
        }
        operations.push({
          ...base(original), type: 'move-node', nodeId: original.nodeId,
          beforeParentId: node.parentId, afterParentId: original.beforeParentId,
        })
        break
      }
      case 'add-relation': {
        const realId = audit.createdRelationIds?.[original.tempRelationId]
        if (!realId) { conflicts.push('无法定位新建关系的实际 ID，已跳过'); break }
        const relation = relations.find((item) => item.id === realId)
        if (!relation) { conflicts.push('该关系已不存在，无需移除'); break }
        operations.push({ ...base(original), type: 'remove-relation', relationId: realId, before: structuredClone(relation) })
        break
      }
      case 'remove-relation': {
        const removed = original.before
        if (!removed) { conflicts.push(`关系 ${original.relationId} 缺少删除前快照，无法恢复`); break }
        if (!current.nodes[removed.sourceNodeId] || !current.nodes[removed.targetNodeId]) {
          conflicts.push(`关系 ${original.relationId} 的端点节点已不存在，无法恢复`); break
        }
        const key = relationPairKey(removed.type, removed.sourceNodeId, removed.targetNodeId)
        if (relations.some((item) => relationPairKey(item.type, item.sourceNodeId, item.targetNodeId) === key)) {
          conflicts.push(`同类关系已重新存在，无需恢复 ${original.relationId}`); break
        }
        operations.push({
          ...base(original), type: 'add-relation', tempRelationId: `undo-rel-${original.relationId}`,
          after: {
            sourceNodeId: removed.sourceNodeId, targetNodeId: removed.targetNodeId,
            relationType: removed.type, description: removed.description,
          },
        })
        break
      }
      case 'update-relation': {
        const relation = relations.find((item) => item.id === original.relationId)
        if (!relation) { conflicts.push(`关系 ${original.relationId} 已不存在，无法回退更新`); break }
        operations.push({
          ...base(original), type: 'update-relation', relationId: original.relationId,
          before: { type: relation.type, description: relation.description },
          after: {
            ...(original.before.type !== undefined ? { relationType: original.before.type } : {}),
            ...(original.before.description !== undefined ? { description: original.before.description } : {}),
          },
        })
        break
      }
      case 'update-workspace-binding': {
        const node = current.nodes[original.nodeId]
        if (!node) { conflicts.push(`节点 ${original.nodeId} 已不存在，无法回退工作区归属`); break }
        operations.push({
          ...base(original), type: 'update-workspace-binding', nodeId: original.nodeId,
          before: {
            primaryWorkspaceId: node.primaryWorkspaceId ?? node.workspaceId ?? null,
            linkedWorkspaceIds: [...(node.linkedWorkspaceIds ?? [])],
          },
          after: structuredClone(original.before),
        })
        break
      }
      case 'archive-node': {
        const node = current.nodes[original.nodeId]
        if (!node) { conflicts.push(`节点 ${original.nodeId} 已不存在，无法取消归档`); break }
        operations.push({
          ...base(original), type: 'update-node', nodeId: original.nodeId,
          before: { status: node.status }, after: { status: original.beforeStatus },
        })
        break
      }
      case 'delete-node': {
        const snapshotNode = beforeBlueprint?.nodes?.[original.nodeId]
        if (!snapshotNode) { conflicts.push(`审计缺少节点 ${original.nodeId} 的删除前快照，无法恢复`); break }
        if (current.nodes[original.nodeId]) { conflicts.push(`节点 ${original.nodeId} 已存在，无需恢复`); break }
        if (snapshotNode.parentId && !current.nodes[snapshotNode.parentId]) {
          conflicts.push(`节点“${snapshotNode.title}”的原父节点已不存在，恢复后将由主进程重新校验层级`)
        }
        const snapshotRelations = (beforeBlueprint?.relations ?? []).filter((relation) =>
          relation.sourceNodeId === original.nodeId || relation.targetNodeId === original.nodeId)
        operations.push({
          ...base(original), type: 'restore-node', nodeId: original.nodeId,
          node: structuredClone(snapshotNode), relations: structuredClone(snapshotRelations),
        })
        break
      }
      case 'restore-node': {
        if (!current.nodes[original.nodeId]) { conflicts.push(`节点 ${original.nodeId} 已不存在，无需再删除`); break }
        operations.push({
          ...base(original, 'high'), type: 'delete-node', nodeId: original.nodeId,
          risk: 'high', impact: deleteNodeImpact(current, original.nodeId),
        })
        break
      }
    }
  }
  return { operations, conflicts }
}

/**
 * Server-side risk resolution. Never trusts the model-supplied `risk` field:
 * delete/restore is always high, structural edits are medium, and plain
 * content updates stay low so they can be one-click approved.
 */
export function resolveOperationRisk(operation: BlueprintOperation): 'low' | 'medium' | 'high' {
  switch (operation.type) {
    case 'delete-node':
    case 'restore-node':
      return 'high'
    case 'create-node':
    case 'move-node':
    case 'archive-node':
    case 'add-relation':
    case 'update-relation':
    case 'remove-relation':
    case 'update-workspace-binding':
      return 'medium'
    case 'update-node': {
      const keys = Object.keys(operation.after)
      const significant = keys.some((key) =>
        key === 'title' || key === 'type' || key === 'positioning' || key === 'techSolution')
      return significant ? 'medium' : 'low'
    }
  }
}

function groupTargetNodeId(operation: BlueprintOperation): string | undefined {
  switch (operation.type) {
    case 'create-node': return operation.tempNodeId
    case 'update-node':
    case 'move-node':
    case 'archive-node':
    case 'delete-node':
    case 'restore-node':
    case 'update-workspace-binding': return operation.nodeId
    default: return undefined
  }
}

function groupTargetTitle(operation: BlueprintOperation, blueprint?: Blueprint): string {
  const nodeId = groupTargetNodeId(operation)
  if (operation.type === 'create-node') return operation.after.title
  if (operation.type === 'restore-node') return operation.node.title
  if (operation.type === 'delete-node') return operation.impact.title
  if (nodeId && blueprint?.nodes[nodeId]?.title) return blueprint.nodes[nodeId].title
  return nodeId ?? operation.operationId
}

/**
 * Aggregates fine-grained operations into node-level approval groups.
 * The operations array stays the source of truth for apply; groups are a
 * UI-facing projection with server-resolved risk.
 */
export function groupMaintenanceOperations(
  operations: BlueprintOperation[],
  blueprint?: Blueprint,
): import('../../../shared/janus/maintenance-types').BlueprintMaintenanceIntentGroup[] {
  const groups: import('../../../shared/janus/maintenance-types').BlueprintMaintenanceIntentGroup[] = []
  const byNode = new Map<string, BlueprintOperation[]>()
  const relationOps: BlueprintOperation[] = []
  const pushNodeGroup = (nodeId: string, kind: 'node' | 'bindings' | 'deletes', ops: BlueprintOperation[]) => {
    const riskRank = { low: 0, medium: 1, high: 2 } as const
    const risk = ops.map(resolveOperationRisk).sort((a, b) => riskRank[b] - riskRank[a])[0] ?? 'low'
    const evidenceRefs = [...new Set(ops.flatMap((op) => op.evidenceRefs))].slice(0, 12)
    const title = kind === 'deletes'
      ? `删除：${groupTargetTitle(ops[0], blueprint)}`
      : kind === 'bindings'
        ? `工作区归属：${groupTargetTitle(ops[0], blueprint)}`
        : `节点：${groupTargetTitle(ops[0], blueprint)}`
    groups.push({
      id: `group-${kind}-${nodeId}`,
      kind,
      nodeId: kind === 'node' || kind === 'bindings' || kind === 'deletes' ? nodeId : undefined,
      title,
      summary: ops.map(operationSummary).join('；'),
      risk,
      operationIds: ops.map((op) => op.operationId),
      evidenceRefs,
    })
  }
  for (const operation of operations) {
    if (operation.type === 'add-relation' || operation.type === 'update-relation' || operation.type === 'remove-relation') {
      relationOps.push(operation)
      continue
    }
    if (operation.type === 'delete-node' || operation.type === 'restore-node') {
      const nodeId = groupTargetNodeId(operation) ?? operation.operationId
      const list = byNode.get(`deletes:${nodeId}`) ?? []
      list.push(operation)
      byNode.set(`deletes:${nodeId}`, list)
      continue
    }
    if (operation.type === 'update-workspace-binding') {
      const nodeId = operation.nodeId
      const list = byNode.get(`bindings:${nodeId}`) ?? []
      list.push(operation)
      byNode.set(`bindings:${nodeId}`, list)
      continue
    }
    const nodeId = groupTargetNodeId(operation) ?? operation.operationId
    const list = byNode.get(`node:${nodeId}`) ?? []
    list.push(operation)
    byNode.set(`node:${nodeId}`, list)
  }
  for (const [key, ops] of byNode) {
    const separator = key.indexOf(':')
    const kind = key.slice(0, separator) as 'node' | 'bindings' | 'deletes'
    const nodeId = key.slice(separator + 1)
    pushNodeGroup(nodeId, kind, ops)
  }
  if (relationOps.length) {
    const riskRank = { low: 0, medium: 1, high: 2 } as const
    const risk = relationOps.map(resolveOperationRisk).sort((a, b) => riskRank[b] - riskRank[a])[0] ?? 'medium'
    groups.push({
      id: 'group-relations',
      kind: 'relations',
      title: `关系：${relationOps.length} 项`,
      summary: relationOps.map(operationSummary).join('；'),
      risk,
      operationIds: relationOps.map((op) => op.operationId),
      evidenceRefs: [...new Set(relationOps.flatMap((op) => op.evidenceRefs))].slice(0, 12),
    })
  }
  const kindOrder = { node: 0, bindings: 1, relations: 2, deletes: 3 } as const
  return groups.sort((a, b) => kindOrder[a.kind] - kindOrder[b.kind] || a.title.localeCompare(b.title))
}

/** Builds the human-readable整理稿 markdown bound to a proposal version. */
export function buildGroupDigest(
  groups: import('../../../shared/janus/maintenance-types').BlueprintMaintenanceIntentGroup[],
  version: number,
): string {
  if (!groups.length) return `## 整理稿 v${version}\n\n未发现需要变更的内容。`
  const lines = [`## 整理稿 v${version}（共 ${groups.length} 组）`, '']
  groups.forEach((group, index) => {
    lines.push(`### ${index + 1}. ${group.title}（${group.risk === 'high' ? '高风险' : group.risk === 'medium' ? '中风险' : '低风险'}）`)
    lines.push(group.summary)
    if (group.evidenceRefs.length) lines.push(`证据：${group.evidenceRefs.slice(0, 3).join('、')}${group.evidenceRefs.length > 3 ? ` 等 ${group.evidenceRefs.length} 项` : ''}`)
    lines.push('')
  })
  lines.push('不满意可点“回到对话”继续说，例如“第 2 组去掉”后重新整理。')
  return lines.join('\n')
}

/**
 * Expands node-group selection to operations with dependency closure.
 * Accepts legacy direct operation ids, new group ids, or both.
 */
export function expandGroupSelection(
  changeSet: BlueprintChangeSet,
  selection: { operationIds?: string[]; groupIds?: string[] },
): BlueprintOperation[] {
  const direct = new Set(selection.operationIds ?? [])
  const groupIds = new Set(selection.groupIds ?? [])
  if (changeSet.groups?.length && groupIds.size) {
    const byGroup = new Map(changeSet.groups.map((group) => [group.id, group]))
    for (const groupId of groupIds) {
      const group = byGroup.get(groupId)
      if (!group) throw new BlueprintChangeSetError(`未知的审批分组：${groupId}`)
      group.operationIds.forEach((id) => direct.add(id))
    }
  }
  if (!direct.size) throw new BlueprintChangeSetError('至少选择一项变更')
  // Dependency closure: selecting a group auto-includes its prerequisites,
  // mirroring the renderer's includeDependencies behavior server-side.
  const byId = new Map(changeSet.operations.map((op) => [op.operationId, op]))
  const closed = new Set(direct)
  let grew = true
  while (grew) {
    grew = false
    for (const id of [...closed]) {
      const op = byId.get(id)
      if (!op) continue
      for (const dep of op.dependsOn) {
        if (!closed.has(dep)) { closed.add(dep); grew = true }
      }
    }
  }
  return selectOperations(changeSet, [...closed])
}

export function operationSummary(operation: BlueprintOperation): string {
  switch (operation.type) {
    case 'create-node': return `新建节点“${operation.after.title}”`
    case 'move-node': return `移动节点 ${operation.nodeId}`
    case 'update-node': return `更新节点 ${operation.nodeId}`
    case 'add-relation': return `新增关系 ${operation.after.relationType}：${operation.after.sourceNodeId} -> ${operation.after.targetNodeId}`
    case 'update-relation': return `更新关系 ${operation.relationId}`
    case 'remove-relation': return `移除关系 ${operation.relationId}`
    case 'update-workspace-binding': return `调整节点 ${operation.nodeId} 的工作区归属`
    case 'archive-node': return `归档节点 ${operation.nodeId}`
    case 'delete-node': return `删除节点“${operation.impact.title}”`
    case 'restore-node': return `恢复节点“${operation.node.title}”`
  }
}
