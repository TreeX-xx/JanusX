/**
 * Bulk approval — the one-click path over everything except deletion.
 *
 * The interesting case is a non-delete operation that depends on a delete
 * (remove-then-recreate): the closure drags the delete in, and a bulk approval
 * that silently covered it would be a hole in the high-risk gate.
 *
 * Note: see .agents/notes/blueprint/maintenance/blueprint-dispatch-panel.md
 */
import { describe, expect, it } from 'vitest'
import {
  bulkApproval,
  maintenanceSelection,
} from '../../src/renderer/src/components/blueprint/maintenanceSelection'
import type { BlueprintChangeSet, BlueprintOperation } from '../../plugins/blueprint/src/shared/janus/maintenance-types'

const update = (id: string, dependsOn: string[] = []): BlueprintOperation =>
  ({ operationId: id, type: 'update-node', nodeId: id, before: {}, after: { title: id }, reason: 'r', evidenceRefs: [], dependsOn, risk: 'low' })

const remove = (id: string, dependsOn: string[] = []): BlueprintOperation =>
  ({
    operationId: id, type: 'delete-node', nodeId: id, dependsOn, risk: 'high',
    impact: { title: id, parentId: 'p', childIds: [], incomingRelationIds: [], outgoingRelationIds: [] },
    reason: 'r', evidenceRefs: [],
  })

function changeSet(operations: BlueprintOperation[]): BlueprintChangeSet {
  return {
    id: 'cs', taskId: 't', blueprintId: 'b', baseRevision: 1, version: 1, status: 'ready',
    createdAt: '2026-09-30T00:00:00Z', reason: 'r', operations, digest: '', groups: [],
  } as BlueprintChangeSet
}

describe('maintenanceSelection', () => {
  it('pulls prerequisites in and refuses cycles and unknown ids', () => {
    expect(maintenanceSelection(changeSet([update('a'), update('b', ['a'])]), ['b']).map(op => op.operationId)).toEqual(['a', 'b'])
    expect(() => maintenanceSelection(changeSet([update('a', ['b']), update('b', ['a'])]), ['a'])).toThrow('Cyclic')
    expect(() => maintenanceSelection(changeSet([update('a')]), ['ghost'])).toThrow('Missing')
  })
})

describe('bulkApproval', () => {
  it('covers every non-delete operation and reports the excluded deletions', () => {
    const bulk = bulkApproval(changeSet([update('rename'), update('body', ['rename']), remove('del-a'), remove('del-b')]))
    expect(bulk.operations.map(op => op.operationId)).toEqual(['rename', 'body'])
    expect(bulk.blockedDeletes).toEqual([])
    expect(bulk.excludedDeletes.map(op => op.operationId)).toEqual(['del-a', 'del-b'])
  })

  it('refuses to hide a delete that a non-delete operation depends on', () => {
    const bulk = bulkApproval(changeSet([remove('del'), update('recreate', ['del'])]))
    expect(bulk.operations.map(op => op.operationId)).toEqual(['del', 'recreate'])
    expect(bulk.blockedDeletes.map(op => op.operationId)).toEqual(['del'])
    // Reached through the closure, so it is no longer merely "excluded".
    expect(bulk.excludedDeletes).toEqual([])
  })

  it('returns nothing to apply when the proposal is deletions only', () => {
    const bulk = bulkApproval(changeSet([remove('a'), remove('b')]))
    expect(bulk.operations).toEqual([])
    expect(bulk.blockedDeletes).toEqual([])
    expect(bulk.excludedDeletes).toHaveLength(2)
  })

  it('keeps an empty proposal harmless', () => {
    const bulk = bulkApproval(changeSet([]))
    expect(bulk.operations).toEqual([])
  })
})