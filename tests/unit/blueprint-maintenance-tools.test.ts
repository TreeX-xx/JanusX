import { describe, expect, it } from 'vitest'
import type { Blueprint } from '../../plugins/blueprint/src/shared/janus/types'
import { createJanusBlueprintTools } from '../../plugins/blueprint/src/main/janus/maintenance/blueprint-tools'

function fixture(): Blueprint {
  const node = (id: string, parentId: string | null) => ({
    id, title: id, type: 'task' as const, status: 'not-started' as const, progress: 0,
    statusSource: 'manual' as const, positioning: '', description: '', features: [], completedItems: [],
    techSolution: '', notes: '', todos: [], issues: [], activities: [], analyses: [], workspaceId: null,
    workspaceSnapshot: null, boundTerminalId: null, terminalHistory: [], lastAnalyzedCommitSha: null,
    children: [], parentId, tags: [], createdAt: '', updatedAt: '',
  })
  return {
    schemaVersion: 2, contentRevision: 3, id: 'bp', name: 'BP', description: '', rootNodeId: 'root',
    nodeIds: ['root', 'child'], nodes: { root: node('root', null), child: node('child', 'root') },
    requirementCandidates: [], mountedTo: null, canvasLayout: {}, createdAt: '', updatedAt: '',
  }
}

describe('Janus Blueprint tools', () => {
  it('reads only nodes inside the authorized scope', async () => {
    const tool = createJanusBlueprintTools({ blueprint: fixture(), allowedNodeIds: new Set(['child']) })[0]
    const result = await tool.execute({ id: 'read', name: tool.name, arguments: {} }, new AbortController().signal)
    expect(result.content).toContain('child')
    expect(result.content).not.toContain('"id": "root"')
  })

  it('normalizes proposals and rejects targets outside the authorized scope', async () => {
    const tools = createJanusBlueprintTools({ blueprint: fixture(), allowedNodeIds: new Set(['child']) })
    const tool = tools.find((item) => item.name === 'janus.blueprint.propose')!
    const base = {
      summary: 'Update child',
      operations: [{
        operationId: 'update-1', type: 'update-node', nodeId: 'child', after: { title: 'Changed' },
        reason: 'Requested', evidenceRefs: [], dependsOn: [], risk: 'low',
      }],
    }
    const result = await tool.execute({ id: 'propose', name: tool.name, arguments: base }, new AbortController().signal)
    expect(result.details).toMatchObject({ operations: [{ before: { title: 'child' } }] })

    await expect(tool.execute({
      id: 'outside',
      name: tool.name,
      arguments: { ...base, operations: [{ ...base.operations[0], nodeId: 'root' }] },
    }, new AbortController().signal)).rejects.toThrow('超出维护范围')
  })

  it('accepts structured requirements in update-node proposals', async () => {
    const tools = createJanusBlueprintTools({ blueprint: fixture(), allowedNodeIds: new Set(['child']) })
    const tool = tools.find((item) => item.name === 'janus.blueprint.propose')!
    const result = await tool.execute({
      id: 'requirements', name: tool.name, arguments: {
        summary: 'Add requirement details',
        operations: [{
          operationId: 'requirements-1', type: 'update-node', nodeId: 'child',
          after: { features: [{ title: 'Requirement A', description: 'Acceptance A' }] },
          reason: 'Requested', evidenceRefs: [], dependsOn: [], risk: 'low',
        }],
      },
    }, new AbortController().signal)
    expect(result.details).toMatchObject({ operations: [{
      before: { features: [] },
      after: { features: [{ title: 'Requirement A', description: 'Acceptance A', progress: 0, status: 'planned' }] },
    }] })
  })
})
