import { describe, expect, it } from 'vitest'
import { maintenanceSelection } from '../../src/renderer/src/components/blueprint/maintenanceSelection'
import type { BlueprintChangeSet, BlueprintOperation } from '../../plugins/blueprint/src/shared/janus/maintenance-types'

const operation = (operationId: string, dependsOn: string[] = []): BlueprintOperation => ({ operationId, dependsOn, type: 'update-node', nodeId: 'node', before: {}, after: { title: operationId }, reason: operationId, risk: 'low', evidenceRefs: [] })
const proposal = (...operations: BlueprintOperation[]) => ({ operations } as BlueprintChangeSet)

describe('maintenance approval selection', () => {
  it('expands transitive dependencies once, before dependent operations', () => {
    const changeSet = proposal(operation('base'), operation('middle', ['base']), operation('leaf', ['middle', 'base']), operation('unselected'))
    expect(maintenanceSelection(changeSet, ['leaf', 'middle']).map(op => op.operationId)).toEqual(['base', 'middle', 'leaf'])
    expect(maintenanceSelection(changeSet, [])).toEqual([])
    expect(changeSet.operations).toHaveLength(4)
  })
  it('rejects missing, duplicate and cyclic identities instead of approving a partial closure', () => {
    expect(() => maintenanceSelection(proposal(operation('a', ['missing'])), ['a'])).toThrow(/Missing/)
    expect(() => maintenanceSelection(proposal(operation('a'), operation('a')), ['a'])).toThrow(/Duplicate/)
    expect(() => maintenanceSelection(proposal(operation('a', ['b']), operation('b', ['a'])), ['a'])).toThrow(/Cyclic/)
  })
  it('retains required deletions for the separate individual-confirmation gate', () => {
    const deletion: BlueprintOperation = { operationId: 'delete', type: 'delete-node', nodeId: 'old', dependsOn: [], evidenceRefs: [], reason: 'obsolete', risk: 'high', impact: { title: 'Old', parentId: null, childIds: [], incomingRelationIds: [], outgoingRelationIds: [] } }
    expect(maintenanceSelection(proposal(deletion, operation('update', ['delete'])), ['update'])).toEqual([deletion, operation('update', ['delete'])])
  })
})
