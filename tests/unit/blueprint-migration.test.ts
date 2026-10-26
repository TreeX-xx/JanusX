import { describe, expect, it } from 'vitest'
import type { Blueprint } from '../../plugins/blueprint/src/shared/janus/types'
import { BLUEPRINT_SCHEMA_VERSION, migrateBlueprint, reconcileBlueprintTree } from '../../plugins/blueprint/src/main/janus/blueprint-migration'

function blueprintFixture(): Blueprint {
  const node = (id: string, parentId: string | null, children: string[] = []) => ({
    id, title: id, type: 'task' as const, status: 'not-started' as const, progress: 0,
    statusSource: 'manual' as const, positioning: '', description: '', features: [], completedItems: [],
    techSolution: '', notes: '', todos: [], issues: [], activities: [], analyses: [], workspaceId: null,
    workspaceSnapshot: null, boundTerminalId: null, terminalHistory: [], lastAnalyzedCommitSha: null,
    children, parentId, tags: [], createdAt: '', updatedAt: ''
  })
  return {
    contentRevision: 0, id: 'bp', name: 'Blueprint', description: '', rootNodeId: 'root', nodeIds: ['root', 'a', 'b'],
    nodes: { root: node('root', null, ['missing']), a: node('a', 'b'), b: node('b', 'a') },
    requirementCandidates: [], mountedTo: null, canvasLayout: {}, createdAt: '', updatedAt: ''
  }
}

describe('blueprint migration boundary', () => {
  it('repairs stale children, orphan references, and cycles from parentId authority', () => {
    const blueprint = blueprintFixture()

    expect(reconcileBlueprintTree(blueprint)).toBe(true)
    expect(blueprint.nodes.root.children).toEqual([])
    expect([blueprint.nodes.a.parentId, blueprint.nodes.b.parentId]).toContain(null)
    expect(blueprint.nodes.a.children).not.toContain('missing')
  })

  it('version-converts legacy detail fields once at the read migration boundary', () => {
    const blueprint = blueprintFixture()
    blueprint.nodes.root.description = 'Legacy description'
    blueprint.nodes.root.completedItems = ['Completed']
    blueprint.nodes.root.todos = [{ id: 'todo', text: 'Pending', done: false }]

    expect(migrateBlueprint(blueprint)).toBe(true)
    expect(blueprint.schemaVersion).toBe(BLUEPRINT_SCHEMA_VERSION)
    expect(blueprint.contentRevision).toBe(0)
    expect(blueprint.nodes.root.features.map((feature) => feature.title)).toEqual([
      'Legacy description', 'Completed', 'Pending'
    ])
    expect(blueprint.nodes.root.description).toBe('')
    expect(migrateBlueprint(blueprint)).toBe(false)
  })

  it('preserves every legacy value when generated feature titles collide', () => {
    const blueprint = blueprintFixture()
    const root = blueprint.nodes.root
    root.features = [{
      id: 'existing', title: 'Duplicate', description: '', progress: 0, status: 'planned',
      requirementNotes: [], createdAt: '', updatedAt: ''
    }]
    root.description = 'Duplicate\nFull legacy description'
    root.completedItems = ['Duplicate']
    root.todos = [{ id: 'todo', text: 'Duplicate', done: false }]

    migrateBlueprint(blueprint)

    expect(root.features.map((feature) => feature.title)).toEqual([
      'Duplicate', 'Duplicate (2)', 'Duplicate (3)', 'Duplicate (4)'
    ])
    expect(root.features[1].description).toBe('Duplicate\nFull legacy description')
    expect(root.features).toHaveLength(4)
  })

  it('migrates v2 data to v3: workspace binding trio and empty relations', () => {
    const blueprint = blueprintFixture()
    blueprint.nodes.root.workspaceId = 'ws-1'

    expect(migrateBlueprint(blueprint)).toBe(true)
    expect(blueprint.schemaVersion).toBe(BLUEPRINT_SCHEMA_VERSION)
    expect(blueprint.relations).toEqual([])
    expect(blueprint.nodes.root.primaryWorkspaceId).toBe('ws-1')
    expect(blueprint.nodes.root.workspaceId).toBe('ws-1')
    expect(blueprint.nodes.root.linkedWorkspaceIds).toEqual([])
    expect(migrateBlueprint(blueprint)).toBe(false)
  })

  it('keeps an explicit empty collapsed state distinct from an uninitialized one', () => {
    const blueprint = blueprintFixture()
    blueprint.schemaVersion = 3

    expect(migrateBlueprint(blueprint)).toBe(true)
    expect(blueprint.collapsedNodeIds).toBeNull()

    blueprint.collapsedNodeIds = []
    expect(migrateBlueprint(blueprint)).toBe(false)
    expect(blueprint.collapsedNodeIds).toEqual([])
  })

  it('sanitizes persisted relations: drops invalid entries and normalizes related-to', () => {
    const blueprint = blueprintFixture()
    const relation = (id: string, source: string, target: string, type: string) => ({
      id, sourceNodeId: source, targetNodeId: target, type, createdAt: '', updatedAt: ''
    })
    blueprint.relations = [
      relation('ok', 'root', 'a', 'related-to'),
      relation('dup-symmetric', 'a', 'root', 'related-to'),
      relation('self', 'a', 'a', 'depends-on'),
      relation('ghost', 'a', 'missing', 'blocks'),
      relation('cycle-1', 'root', 'a', 'depends-on'),
      relation('cycle-2', 'a', 'root', 'depends-on'),
    ] as Blueprint['relations']

    migrateBlueprint(blueprint)

    const ids = blueprint.relations.map((item) => item.id)
    expect(ids).toContain('ok')
    expect(ids).not.toContain('dup-symmetric')
    expect(ids).not.toContain('self')
    expect(ids).not.toContain('ghost')
    // One edge of the depends-on cycle is dropped so the graph is acyclic.
    expect(ids.filter((id) => id.startsWith('cycle-'))).toHaveLength(1)
    const kept = blueprint.relations.find((item) => item.id === 'ok')!
    expect(kept.sourceNodeId < kept.targetNodeId).toBe(true)
  })
})
