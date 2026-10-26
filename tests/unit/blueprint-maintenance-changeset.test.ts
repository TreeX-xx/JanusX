import { describe, expect, it } from 'vitest'
import type { Blueprint, BlueprintRelation } from '../../plugins/blueprint/src/shared/janus/types'
import type {
  BlueprintChangeSet,
  BlueprintMaintenanceAuditRecord,
  BlueprintOperation,
} from '../../plugins/blueprint/src/shared/janus/maintenance-types'
import {
  applyOperations,
  buildGroupDigest,
  buildReverseOperations,
  expandGroupSelection,
  groupMaintenanceOperations,
  normalizeProposedOperations,
  resolveOperationRisk,
  selectOperations,
} from '../../plugins/blueprint/src/main/janus/maintenance/changeset'

function fixture(): Blueprint {
  const node = (id: string, parentId: string | null, children: string[] = []) => ({
    id, title: id, type: 'task' as const, status: 'not-started' as const, progress: 0,
    statusSource: 'manual' as const, positioning: '', description: '', features: [], completedItems: [],
    techSolution: '', notes: '', todos: [], issues: [], activities: [], analyses: [], workspaceId: null,
    primaryWorkspaceId: null, linkedWorkspaceIds: [],
    workspaceSnapshot: null, boundTerminalId: null, terminalHistory: [], lastAnalyzedCommitSha: null,
    children, parentId, tags: [], createdAt: '', updatedAt: ''
  })
  return {
    schemaVersion: 3, contentRevision: 3, id: 'bp', name: 'BP', description: '', rootNodeId: 'root',
    nodeIds: ['root', 'child'], nodes: { root: node('root', null, ['child']), child: node('child', 'root') },
    relations: [], requirementCandidates: [], mountedTo: null, canvasLayout: {}, createdAt: '', updatedAt: ''
  }
}

function baseOp(operationId: string): { operationId: string; reason: string; evidenceRefs: string[]; dependsOn: string[]; risk: 'low' } {
  return { operationId, reason: 'r', evidenceRefs: [], dependsOn: [], risk: 'low' }
}

function relation(id: string, source: string, target: string, type: BlueprintRelation['type']): BlueprintRelation {
  return { id, sourceNodeId: source, targetNodeId: target, type, createdAt: '', updatedAt: '' }
}

describe('Blueprint maintenance ChangeSet', () => {
  it('applies selected update and create operations to a clone', () => {
    const source = fixture()
    const operations: BlueprintOperation[] = [
      { ...baseOp('u'), type: 'update-node', nodeId: 'child', before: { title: 'child' }, after: { title: 'Changed' } },
      { ...baseOp('c'), type: 'create-node', tempNodeId: 'new-1', parentId: 'child', after: { title: 'New', type: 'task', description: '', positioning: '', techSolution: '', notes: '', tags: [] } }
    ]
    const result = applyOperations(source, operations, new Set(['root', 'child']))
    expect(result.blueprint.contentRevision).toBe(4)
    expect(result.blueprint.nodes.child.title).toBe('Changed')
    expect(result.blueprint.nodes.child.children).toHaveLength(1)
    expect(Object.keys(result.createdNodeIds)).toEqual(['new-1'])
    expect(source.nodes.child.title).toBe('child')
  })

  it('rejects a partial selection with a missing dependency', () => {
    const changeSet = { operations: [
      { ...baseOp('child'), type: 'update-node', nodeId: 'child', before: {}, after: { title: 'x' }, dependsOn: ['parent'] }
    ] } as BlueprintChangeSet
    expect(() => selectOperations(changeSet, ['child'])).toThrow('缺少依赖')
  })

  it('orders selected operations by dependencies and rejects dependency cycles', () => {
    const dependent = { ...baseOp('child'), type: 'update-node', nodeId: 'child', before: {}, after: { title: 'x' }, dependsOn: ['parent'] } as BlueprintOperation
    const parent = { ...baseOp('parent'), type: 'update-node', nodeId: 'child', before: {}, after: { notes: 'y' } } as BlueprintOperation
    expect(selectOperations({ operations: [dependent, parent] } as BlueprintChangeSet, ['child', 'parent']).map((item) => item.operationId)).toEqual(['parent', 'child'])

    const cyclic = { operations: [{ ...dependent, dependsOn: ['parent'] }, { ...parent, dependsOn: ['child'] }] } as BlueprintChangeSet
    expect(() => selectOperations(cyclic, ['child', 'parent'])).toThrow('依赖不能形成环')
  })

  it('rejects moving a node outside the authorized scope', () => {
    expect(() => applyOperations(fixture(), [{
      ...baseOp('m'), type: 'move-node', nodeId: 'child', beforeParentId: 'root', afterParentId: 'root',
    }], new Set(['child']))).toThrow('目标父节点不在维护范围内')
  })

  it('rejects a move that creates a hierarchy cycle', () => {
    const source = fixture()
    source.nodes.leaf = { ...source.nodes.child, id: 'leaf', title: 'leaf', parentId: 'child', children: [] }
    source.nodes.child.children = ['leaf']
    source.nodeIds.push('leaf')
    expect(() => applyOperations(source, [{
      ...baseOp('m'), type: 'move-node', nodeId: 'child', beforeParentId: 'root', afterParentId: 'leaf',
    }], new Set(['root', 'child', 'leaf']))).toThrow('层级不能形成环')
  })

  it('adds relations with normalized related-to endpoints and rejects duplicates', () => {
    const source = fixture()
    const result = applyOperations(source, [{
      ...baseOp('r1'), type: 'add-relation', tempRelationId: 't-r1',
      after: { sourceNodeId: 'root', targetNodeId: 'child', relationType: 'related-to' },
    }], new Set(['root', 'child']))
    const added = result.blueprint.relations[0]
    // 'child' < 'root' lexicographically, so the symmetric pair is normalized.
    expect(added.sourceNodeId).toBe('child')
    expect(added.targetNodeId).toBe('root')
    expect(result.createdRelationIds['t-r1']).toBe(added.id)

    source.relations = [relation('existing', 'child', 'root', 'related-to')]
    expect(() => applyOperations(source, [{
      ...baseOp('r2'), type: 'add-relation', tempRelationId: 't-r2',
      after: { sourceNodeId: 'root', targetNodeId: 'child', relationType: 'related-to' },
    }], new Set(['root', 'child']))).toThrow('关系已存在')
  })

  it('rejects depends-on relations that would form a directed cycle', () => {
    const source = fixture()
    source.relations = [relation('ab', 'root', 'child', 'depends-on')]
    expect(() => applyOperations(source, [{
      ...baseOp('r'), type: 'add-relation', tempRelationId: 't-r',
      after: { sourceNodeId: 'child', targetNodeId: 'root', relationType: 'depends-on' },
    }], new Set(['root', 'child']))).toThrow('有向环')
  })

  it('blocks delete-node while children or relations remain, and applies after prerequisites', () => {
    const source = fixture()
    source.relations = [relation('rel', 'root', 'child', 'depends-on')]
    expect(() => applyOperations(source, [{
      ...baseOp('d'), type: 'delete-node', nodeId: 'child', risk: 'high',
      impact: { title: 'child', parentId: 'root', childIds: [], incomingRelationIds: ['rel'], outgoingRelationIds: [] },
    }], new Set(['root', 'child']))).toThrow('删除前必须先清理关系')

    const result = applyOperations(source, [
      { ...baseOp('cleanup'), type: 'remove-relation', relationId: 'rel' },
      { ...baseOp('d'), type: 'delete-node', nodeId: 'child', risk: 'high', dependsOn: ['cleanup'],
        impact: { title: 'child', parentId: 'root', childIds: [], incomingRelationIds: ['rel'], outgoingRelationIds: [] } },
    ], new Set(['root', 'child']))
    expect(result.blueprint.nodes.child).toBeUndefined()
    expect(result.blueprint.relations).toHaveLength(0)
  })

  it('updates workspace binding and keeps the legacy mirror field in sync', () => {
    const result = applyOperations(fixture(), [{
      ...baseOp('b'), type: 'update-workspace-binding', nodeId: 'child',
      before: { primaryWorkspaceId: null, linkedWorkspaceIds: [] },
      after: { primaryWorkspaceId: 'ws-1', linkedWorkspaceIds: ['ws-2'] },
    }], new Set(['root', 'child']))
    expect(result.blueprint.nodes.child.primaryWorkspaceId).toBe('ws-1')
    expect(result.blueprint.nodes.child.workspaceId).toBe('ws-1')
    expect(result.blueprint.nodes.child.linkedWorkspaceIds).toEqual(['ws-2'])
  })

  it('normalizes proposals: forces delete risk to high and computes impact', () => {
    const source = fixture()
    source.relations = [relation('rel', 'root', 'child', 'blocks')]
    const [normalized] = normalizeProposedOperations(source, new Set(['root', 'child']), [{
      ...baseOp('d'), type: 'delete-node', nodeId: 'child', risk: 'high',
      impact: { title: '', parentId: null, childIds: [], incomingRelationIds: [], outgoingRelationIds: [] },
    } as BlueprintOperation])
    expect(normalized.type).toBe('delete-node')
    if (normalized.type === 'delete-node') {
      expect(normalized.risk).toBe('high')
      expect(normalized.impact.incomingRelationIds).toEqual(['rel'])
    }
  })

  it('normalizes and applies structured requirement descriptions', () => {
    const source = fixture()
    source.nodes.child.features = [{
      id: 'existing', title: 'Old title', description: '', progress: 10, status: 'planned',
      requirementNotes: [], createdAt: 'created', updatedAt: 'old',
    }]
    const [normalized] = normalizeProposedOperations(source, new Set(['child']), [{
      ...baseOp('requirements'), type: 'update-node', nodeId: 'child', before: {}, after: { features: [{
        id: 'existing', title: 'Revised requirement', description: 'Acceptance details', progress: 25,
        status: 'in-progress', requirementNotes: ['Reviewed by Janus'],
      }, {
        title: 'New requirement', description: 'New acceptance details', progress: 0,
        status: 'planned', requirementNotes: [],
      }] },
    }])
    expect(normalized.type).toBe('update-node')
    if (normalized.type !== 'update-node') return
    expect(normalized.before.features).toEqual(source.nodes.child.features)
    expect(normalized.after.features?.[0]).toMatchObject({ id: 'existing', title: 'Revised requirement' })
    expect(normalized.after.features?.[0].createdAt).toBe('created')
    expect(normalized.after.features?.[1].id).toBeTruthy()

    const result = applyOperations(source, [normalized], new Set(['child']))
    expect(result.blueprint.nodes.child.features).toHaveLength(2)
    expect(result.blueprint.nodes.child.features[1].title).toBe('New requirement')
  })

  it('rejects restore-node in model proposals and relations fully out of scope', () => {
    const source = fixture()
    expect(() => normalizeProposedOperations(source, new Set(['root', 'child']), [{
      ...baseOp('x'), type: 'restore-node', nodeId: 'n', node: source.nodes.child, relations: [],
    } as BlueprintOperation])).toThrow('restore-node')

    source.nodes.other = { ...source.nodes.child, id: 'other', parentId: 'root', children: [] }
    source.nodes.other2 = { ...source.nodes.child, id: 'other2', parentId: 'root', children: [] }
    source.nodeIds.push('other', 'other2')
    expect(() => normalizeProposedOperations(source, new Set(['child']), [{
      ...baseOp('r'), type: 'add-relation', tempRelationId: 't',
      after: { sourceNodeId: 'other', targetNodeId: 'other2', relationType: 'related-to' },
    } as BlueprintOperation])).toThrow('范围扩展')
  })

  it('builds a reverse changeset that restores a deleted node with its relations', () => {
    const before = fixture()
    before.relations = [relation('rel', 'root', 'child', 'implements')]
    const changeSet = {
      id: 'cs', taskId: 'task', blueprintId: 'bp', baseRevision: 3, version: 1, status: 'applied', reason: 'r',
      operations: [
        { ...baseOp('cleanup'), type: 'remove-relation', relationId: 'rel', before: before.relations[0] },
        { ...baseOp('d'), type: 'delete-node', nodeId: 'child', risk: 'high', dependsOn: ['cleanup'],
          impact: { title: 'child', parentId: 'root', childIds: [], incomingRelationIds: ['rel'], outgoingRelationIds: [] } },
      ],
      createdAt: '',
    } as BlueprintChangeSet
    const current = applyOperations(before, changeSet.operations, new Set(['root', 'child'])).blueprint
    const audit = {
      id: 'audit', taskId: 'task', changeSetId: 'cs', blueprintId: 'bp',
      beforeRevision: 3, afterRevision: 4,
      selectedOperationIds: ['cleanup', 'd'], rejectedOperationIds: [],
      status: 'applied', changeSetSnapshot: changeSet, beforeSnapshot: before, createdAt: '',
    } as BlueprintMaintenanceAuditRecord
    const reverse = buildReverseOperations(audit, current)
    // restore-node carries the touching relations itself; the separate
    // add-relation reversal is skipped because the endpoint was still missing.
    expect(reverse.operations.map((item) => item.type)).toEqual(['restore-node'])
    const undone = applyOperations(current, reverse.operations, new Set(current.nodeIds)).blueprint
    expect(undone.nodes.child.title).toBe('child')
    expect(undone.relations).toHaveLength(1)
    expect(undone.relations[0].type).toBe('implements')
  })

  it('reverses create and update operations using audit id maps and detects later edits', () => {
    const before = fixture()
    const changeSet = {
      id: 'cs', taskId: 'task', blueprintId: 'bp', baseRevision: 3, version: 1, status: 'applied', reason: 'r',
      operations: [
        { ...baseOp('u'), type: 'update-node', nodeId: 'child', before: { title: 'child' }, after: { title: 'Renamed' } },
        { ...baseOp('c'), type: 'create-node', tempNodeId: 'tmp', parentId: 'root',
          after: { title: 'Fresh', type: 'task', description: '', positioning: '', techSolution: '', notes: '', tags: [] } },
      ],
      createdAt: '',
    } as BlueprintChangeSet
    const outcome = applyOperations(before, changeSet.operations, new Set(['root', 'child']))
    const audit = {
      id: 'audit', taskId: 'task', changeSetId: 'cs', blueprintId: 'bp',
      beforeRevision: 3, afterRevision: 4,
      selectedOperationIds: ['u', 'c'], rejectedOperationIds: [],
      createdNodeIds: outcome.createdNodeIds,
      status: 'applied', changeSetSnapshot: changeSet, beforeSnapshot: before, createdAt: '',
    } as BlueprintMaintenanceAuditRecord
    const reverse = buildReverseOperations(audit, outcome.blueprint)
    expect(reverse.operations.map((item) => item.type)).toEqual(['delete-node', 'update-node'])
    expect(reverse.conflicts).toHaveLength(0)
    const undone = applyOperations(outcome.blueprint, reverse.operations, new Set(outcome.blueprint.nodeIds)).blueprint
    expect(undone.nodes.child.title).toBe('child')
    expect(Object.keys(undone.nodes)).toHaveLength(2)

    // A later edit on the same field is surfaced as a conflict.
    const edited = structuredClone(outcome.blueprint)
    edited.nodes.child.title = 'Even newer'
    const conflicted = buildReverseOperations(audit, edited)
    expect(conflicted.conflicts.some((item) => item.includes('又被修改过'))).toBe(true)
  })

  it('resolves server-side risk without trusting model input', () => {
    expect(resolveOperationRisk({ ...baseOp('d'), type: 'delete-node', nodeId: 'child', beforeStatus: 'not-started', impact: { title: 'c', parentId: 'root', childIds: [], incomingRelationIds: [], outgoingRelationIds: [] } })).toBe('high')
    expect(resolveOperationRisk({ ...baseOp('u'), type: 'update-node', nodeId: 'child', before: {}, after: { progress: 50 } })).toBe('low')
    expect(resolveOperationRisk({ ...baseOp('t'), type: 'update-node', nodeId: 'child', before: {}, after: { title: 'New' } })).toBe('medium')
  })

  it('groups operations by node and expands group selection with dependencies', () => {
    const operations: BlueprintOperation[] = [
      { ...baseOp('u1'), type: 'update-node', nodeId: 'child', before: {}, after: { progress: 50 }, evidenceRefs: ['src/a.ts'] },
      { ...baseOp('u2'), type: 'update-node', nodeId: 'child', before: {}, after: { notes: 'n' }, dependsOn: ['u1'] },
      { ...baseOp('r1'), type: 'add-relation', tempRelationId: 'rel-1', after: { sourceNodeId: 'root', targetNodeId: 'child', relationType: 'depends-on' } },
    ]
    const groups = groupMaintenanceOperations(operations)
    expect(groups.map((group) => group.kind)).toEqual(['node', 'relations'])
    expect(groups[0].operationIds).toEqual(['u1', 'u2'])
    expect(buildGroupDigest(groups, 1)).toContain('整理稿 v1')
    const changeSet = {
      id: 'cs', taskId: 't', blueprintId: 'bp', baseRevision: 1, version: 1, status: 'ready', reason: 'r',
      operations, groups, createdAt: '',
    } as BlueprintChangeSet
    // Selecting only u2 auto-includes its prerequisite u1.
    const expanded = expandGroupSelection(changeSet, { groupIds: [groups[0].id] })
    expect(expanded.map((op) => op.operationId).sort()).toEqual(['u1', 'u2'])
    expect(() => expandGroupSelection(changeSet, { groupIds: ['group-missing'] })).toThrow('未知的审批分组')
  })
})
