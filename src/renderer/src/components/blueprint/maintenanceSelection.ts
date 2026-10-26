import type { BlueprintChangeSet, BlueprintOperation } from '../../../../../plugins/blueprint/src/shared/janus/maintenance-types'

/** Approval includes prerequisites, but never grants deletion confirmation. */
export function maintenanceSelection(changeSet: BlueprintChangeSet, requested: string[]): BlueprintOperation[] {
  const byId = new Map(changeSet.operations.map(op => [op.operationId, op]))
  if (byId.size !== changeSet.operations.length) throw new Error('Duplicate operation identity')
  const visiting = new Set<string>()
  const selected = new Set<string>()
  const visit = (id: string): void => {
    if (visiting.has(id)) throw new Error('Cyclic operation dependency: ' + id)
    if (selected.has(id)) return
    const op = byId.get(id)
    if (!op) throw new Error('Missing operation dependency: ' + id)
    visiting.add(id)
    op.dependsOn.forEach(visit)
    visiting.delete(id)
    selected.add(id)
  }
  requested.forEach(visit)
  return [...selected].map(id => byId.get(id)!)
}

export interface BulkApproval {
  /** Full closure of the requested operations, ready for `apply`. */
  operations: BlueprintOperation[]
  /**
   * Deletes the closure pulled in transitively. A non-delete operation may
   * depend on a delete (remove-then-recreate), and that delete still needs its
   * own confirmation — so a bulk approval that silently covered it would be a
   * hole in the high-risk gate.
   */
  blockedDeletes: BlueprintOperation[]
  /** Deletes present in the proposal but not reached by the closure. */
  excludedDeletes: BlueprintOperation[]
}

/**
 * The fast approval path: one click over everything except deletion. Requested
 * set is "all non-delete operations", expanded through the dependency closure.
 */
export function bulkApproval(changeSet: BlueprintChangeSet): BulkApproval {
  const requested = changeSet.operations.filter(op => op.type !== 'delete-node').map(op => op.operationId)
  const operations = maintenanceSelection(changeSet, requested)
  const blocked = operations.filter(op => op.type === 'delete-node')
  const reached = new Set(operations.map(op => op.operationId))
  return {
    operations,
    blockedDeletes: blocked,
    excludedDeletes: changeSet.operations.filter(op => op.type === 'delete-node' && !reached.has(op.operationId)),
  }
}