/**
 * NoteAdapter v1 goldens: every mapping table lives here. A note fixture
 * upgrade (new kind/lifecycle/section/relation) must only touch
 * `src/main/notes/note-to-blueprint.ts` plus this file.
 */
import { describe, expect, it } from 'vitest'
import {
  ADAPTER_VERSION,
  applyNodePatch,
  checkWritablePatch,
  kindToNodeType,
  lifecycleToStatus,
  mapStatusToLifecycle,
  nodeTypeToKind,
  projectGraph,
  projectGraphId,
  projectRelations,
} from '../../plugins/blueprint/src/main/notes/note-to-blueprint'
import type { NoteDoc } from '../../plugins/blueprint/src/main/notes/note-types'

const doc = (over: Partial<NoteDoc> = {}): NoteDoc => ({
  id: 'n1',
  kind: 'requirement',
  lifecycle: 'proposed',
  tags: [],
  parent: null,
  title: 'T',
  sections: [{ name: 'Problem', text: 'P.' }],
  acs: [{ id: 'ac1', text: 'AC one.' }],
  relations: [],
  ...over,
})

describe('NoteAdapter v2 version', () => {
  it('pins the adapter version', () => {
    expect(ADAPTER_VERSION).toBe('v2')
  })

  it('stamps the version onto every projection', () => {
    const g = projectGraph(
      {
        repoId: 'repo1',
        repoName: 'R',
        entries: [{ doc: doc({ id: 'root' }), relPath: 'root.md', sha256: 'a' }],
        revision: 1,
      },
      'root-key',
    )
    expect(g.adapterVersion).toBe('v2')
  })
})

describe('kind/lifecycle maps with unknown downgrade', () => {
  it('maps known values onto canvas vocabulary', () => {
    expect(kindToNodeType('task')).toBe('task')
    expect(kindToNodeType('requirement')).toBe('feature')
    expect(kindToNodeType('decision')).toBe('epic')
    expect(kindToNodeType('initiative')).toBe('epic')
    expect(kindToNodeType('idea')).toBe('issue')
    expect(lifecycleToStatus('draft')).toBe('planning')
    expect(lifecycleToStatus('proposed')).toBe('planning')
    expect(lifecycleToStatus('accepted')).toBe('in-progress')
    expect(lifecycleToStatus('implemented')).toBe('done')
    expect(lifecycleToStatus('rejected')).toBe('archived')
    expect(lifecycleToStatus('archived')).toBe('archived')
  })

  it('degrades unknowns without throwing', () => {
    expect(kindToNodeType('milestone')).toBe('issue')
    expect(kindToNodeType('')).toBe('issue')
    expect(lifecycleToStatus('abandoned')).toBe('planning')
    expect(lifecycleToStatus('')).toBe('planning')
  })

  it('round-trips node types back to kinds', () => {
    expect(nodeTypeToKind('task')).toBe('task')
    expect(nodeTypeToKind('feature')).toBe('requirement')
    expect(nodeTypeToKind('issue')).toBe('requirement')
    expect(nodeTypeToKind('epic')).toBe('initiative')
    expect(nodeTypeToKind('epic', 'decision')).toBe('decision')
  })

  it('refuses task completion without evidence and rejects unknown statuses', () => {
    expect(mapStatusToLifecycle('task', 'done')).toMatchObject({ ok: false, code: 'HARNESS_MANAGED' })
    expect(mapStatusToLifecycle('requirement', 'done')).toMatchObject({ ok: true, lifecycle: 'accepted' })
    expect(mapStatusToLifecycle('task', 'archived')).toMatchObject({ ok: true, lifecycle: 'archived' })
    expect(mapStatusToLifecycle('task', 'flying')).toMatchObject({ ok: false, code: 'SCHEMA_INVALID' })
  })
})

describe('relation map', () => {
  it('preserves formal relations and resolves by complete URI', () => {
    const rels = projectRelations([
      { doc: doc({ id: 'a', relations: [{ type: 'depends-on', target: 'note://r/b' }] }), relPath: 'a.md', sha256: 'x' },
      { doc: doc({ id: 'b', relations: [{ type: 'governed-by', target: 'note://external/a', reason: 'policy' }] }), relPath: 'b.md', sha256: 'y' },
    ], 'r')
    expect(rels).toHaveLength(2)
    expect(rels[0]).toMatchObject({ sourceNodeId: 'a', targetNodeId: 'b', type: 'depends-on' })
    expect(rels[0]?.description).toBeUndefined()
    expect(rels[1]).toMatchObject({ sourceNodeId: 'b', targetNodeId: 'note://external/a', type: 'governed-by', reason: 'policy', targetUri: 'note://external/a' })
    expect(rels[1]?.description).toBeUndefined()
  })
})

describe('projectGraph', () => {
  it('derives directory children and retains dangling parent declarations', () => {
    const g = projectGraph(
      {
        repoId: 'repo1',
        repoName: 'R',
        entries: [
          { doc: doc({ id: 'root' }), relPath: 'root.md', sha256: 'a' },
          { doc: doc({ id: 'child', parent: 'note://repo1/root' }), relPath: 'c.md', sha256: 'b' },
          { doc: doc({ id: 'orphan', parent: 'note://repo1/missing' }), relPath: 'o.md', sha256: 'c' },
        ],
        revision: 7,
      },
      'root-key',
    )
    expect(g.id).toBe(projectGraphId('repo1', 'root-key'))
    expect(g.id.startsWith('harness:project:')).toBe(true)
    expect(g.contentRevision).toBe(7)
    expect(g.nodes['root']?.children).toEqual(['child'])
    expect(g.nodes['orphan']?.parentId).toBeNull()
    expect(g.relations).toContainEqual(expect.objectContaining({ sourceNodeId: 'orphan', targetUri: 'note://repo1/missing', type: 'parent' }))
    expect(g.nodes['child']?.sourceUri).toBe('note://repo1/child')
    expect(g.nodes['child']?.sourceHash).toBe('b')
  })

  it('renders unknown kinds instead of throwing', () => {
    const g = projectGraph(
      {
        repoId: null,
        repoName: 'R',
        entries: [{ doc: doc({ id: 'u', kind: 'milestone', lifecycle: 'abandoned' }), relPath: 'u.md', sha256: 'z' }],
        revision: 1,
      },
      'root-key',
    )
    expect(g.nodes['u']?.type).toBe('issue')
    expect(g.nodes['u']?.status).toBe('planning')
    expect(g.nodes['u']?.sourceUri).toBeUndefined()
  })

  it('passes raw kind/lifecycle through for eyebrow/chips/kind filter', () => {
    const g = projectGraph(
      {
        repoId: 'repo1',
        repoName: 'R',
        entries: [{ doc: doc({ id: 'n', kind: 'decision', lifecycle: 'implemented' }), relPath: 'n.md', sha256: 'z' }],
        revision: 1,
      },
      'root-key',
    )
    expect(g.nodes['n']?.kind).toBe('decision')
    expect(g.nodes['n']?.lifecycle).toBe('implemented')
    expect(g.nodes['n']?.type).toBe('epic')
    expect(g.nodes['n']?.status).toBe('done')
  })

  it('scopes graph ids per checkout, not per repo (E0-1)', () => {
    // Same repo, two worktrees: renderer dedup must keep both entries.
    const sameRepoA = projectGraphId('972afef3-2fc7-49de-a3ee-7e041225d28c', 'C:\\Users\\Tree\\Desktop\\git\\JanusX')
    const sameRepoB = projectGraphId('972afef3-2fc7-49de-a3ee-7e041225d28c', 'C:\\Users\\Tree\\Desktop\\git\\JanusX-buleadjust')
    expect(sameRepoA).not.toBe(sameRepoB)
    // Null repoId: no `C:\Users`-style prefix collision across directories.
    const nullA = projectGraphId(null, 'C:\\Users\\Tree\\a')
    const nullB = projectGraphId(null, 'C:\\Users\\Tree\\b')
    expect(nullA).not.toBe(nullB)
    // Same checkout, spelling variants: one stable id.
    expect(projectGraphId(null, 'C:\\W\\R')).toBe(projectGraphId(null, 'c:/w/r'))
    expect(projectGraphId('repo1', 'root-key')).toBe(projectGraphId(null, 'root-key'))
  })

  it('stamps checkout snapshot without registry bindings (E0-4 discounted)', () => {
    const g = projectGraph(
      {
        repoId: 'repo1',
        repoName: 'R',
        entries: [{ doc: doc({ id: 'n' }), relPath: 'n.md', sha256: 'z' }],
        revision: 1,
      },
      'C:\\W\\R',
    )
    expect(g.nodes['n']?.workspaceSnapshot).toEqual({ name: 'R', path: 'C:\\W\\R' })
    // Registry-UUID bindings stay null: the pure adapter cannot know them,
    // and repositories.primary needs E0-2 (P3).
    expect(g.nodes['n']?.workspaceId).toBeNull()
    expect(g.nodes['n']?.primaryWorkspaceId).toBeNull()
  })
})

describe('applyNodePatch', () => {
  it('maps prose fields onto kind sections', () => {
    const produced = applyNodePatch(doc({ kind: 'requirement' }), { title: 'T2', description: 'D.' })
    if (!('edit' in produced)) throw new Error('patch rejected')
    expect(produced.edit.title).toBe('T2')
    expect(produced.edit.sections['Problem']).toBe('D.')
  })

  it('maps status onto lifecycle', () => {
    const produced = applyNodePatch(doc({ kind: 'requirement' }), { status: 'in-progress' })
    if (!('edit' in produced)) throw new Error('patch rejected')
    expect(produced.edit.frontmatter.lifecycle).toBe('accepted')
  })

  it('rejects empty titles and unknown statuses', () => {
    expect(applyNodePatch(doc(), { title: '  ' })).toMatchObject({ code: 'SCHEMA_INVALID' })
    expect(applyNodePatch(doc(), { status: 'flying' })).toMatchObject({ code: 'SCHEMA_INVALID' })
  })

  it('rejects maintenance-owned arrays', () => {
    expect(checkWritablePatch({ features: [{ title: 'x' }] })).toMatchObject({ code: 'HARNESS_MANAGED' })
    expect(checkWritablePatch({ features: [] })).toBeNull()
    expect(checkWritablePatch({ title: 'x' })).toBeNull()
  })
})
