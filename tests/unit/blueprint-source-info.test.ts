import { describe, expect, it } from 'vitest'
import type { Blueprint } from '../../plugins/blueprint/src/shared/janus/types'
import type { NoteReadSnapshot } from '../../src/shared/notes'
import type { ArchitectureProjection } from '../../src/renderer/src/features/blueprint/architecture-view'
import { attentionRoots } from '../../src/renderer/src/features/blueprint/attention-model'
import { blueprintSourceInfo } from '../../src/renderer/src/features/blueprint/source-info'

function fixture() {
  const snapshot = { repoId: 'repo', coverage: { checkoutRoot: 'C:/root', status: 'complete', diagnostics: [], snapshotHash: 'hash' }, entries: [], relations: [], mentions: [], diagnostics: [] } as NoteReadSnapshot
  const source = { id: 'source', name: 'Source', nodeIds: [], nodes: {}, noteSnapshot: snapshot,
    composition: { version: 'r4', checkouts: [], nodes: {}, interfaces: [], evidence: [], diagnostics: [] } } as unknown as Blueprint
  const projection: ArchitectureProjection = { graph: source, roles: {}, related: {}, diagnostics: [] }
  return { source, snapshot, projection }
}

describe('source inspection', () => {
  it('healthy snapshots and unused provided interfaces do not demand attention', () => {
    const { source, projection } = fixture()
    source.composition!.interfaces.push({ id: 'port', nodeId: 'module', name: 'read', direction: 'provides', status: 'idle' })
    expect(blueprintSourceInfo(source, projection).hasAttention).toBe(false)
  })

  it('retains source and projection diagnostics and deduplicates the same scan error', () => {
    const { source, snapshot, projection } = fixture()
    const diagnostic = { code: 'READ_ERROR', message: 'unreadable', path: 'C:/root/file.md' }
    snapshot.diagnostics.push(diagnostic)
    snapshot.coverage.diagnostics.push(diagnostic)
    source.invalidNotes = [{ relPath: 'broken.md', diagnostics: [{ code: 'INVALID', message: 'invalid metadata' }] }]
    projection.diagnostics.push({ code: 'PARENT_MISSING', message: 'Parent unavailable', nodeId: 'module' })
    const before = structuredClone(source)
    const result = blueprintSourceInfo(source, projection)
    expect(result.hasAttention).toBe(true)
    expect(result.issues).toHaveLength(3)
    expect(result.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'READ_ERROR' }), expect.objectContaining({ path: 'broken.md' }), expect.objectContaining({ nodeId: 'module' })]))
    expect(source).toEqual(before)
  })

  it('shows only the current snapshot and retains local interface warnings', () => {
    const { source, snapshot, projection } = fixture()
    source.composition!.checkouts.push({ repoId: 'repo', checkoutId: 'other', path: 'C:/other', nodeIds: [], revision: 1, status: 'stale', snapshot: { ...snapshot, coverage: { ...snapshot.coverage, checkoutRoot: 'C:/other' } } })
    expect(blueprintSourceInfo(source, projection).snapshots.map(row => row.coverage.checkoutRoot)).toEqual(['C:/root'])
    expect(blueprintSourceInfo(source, projection).hasAttention).toBe(false)
    source.composition!.checkouts = []
    source.composition!.interfaces.push({ id: 'port', nodeId: 'module', name: 'read', direction: 'needs', status: 'dangling' })
    expect(blueprintSourceInfo(source, projection).hasAttention).toBe(true)
  })

  it('silently ignores cross-repository references for bound, missing and unbound targets', () => {
    const { source, snapshot, projection } = fixture()
    const uri = 'note://repo/source', target = 'note://external/target'
    const diagnostic = { code: 'NOT_READY', message: 'repository not bound in this index: external', path: uri }
    source.nodeIds.push('source')
    source.nodes.source = { id: 'source', title: 'Architecture decision', sourceUri: uri } as Blueprint['nodes'][string]
    snapshot.entries.push({ uri, relPath: 'decision.md', classification: 'valid', sourceHash: 'hash', doc: { title: 'Architecture decision' } } as NoteReadSnapshot['entries'][number])
    snapshot.relations.push({ sourceUri: uri, targetUri: target, resolution: { status: 'unavailable', reason: 'unbound-repository', diagnostics: [{ code: diagnostic.code, message: diagnostic.message }] } } as NoteReadSnapshot['relations'][number])
    snapshot.diagnostics.push(diagnostic)
    source.composition!.interfaces.push({ id: 'external-port', nodeId: 'source', name: 'read', direction: 'needs', provider: target, status: 'unbound' })
    source.composition!.diagnostics.push({ code: 'UNBOUND_RELATION', sourceUri: target, message: 'Relation target not uniquely bound' })
    const result = blueprintSourceInfo(source, projection)
    expect(result.graph.composition?.interfaces).toEqual([])
    expect(result.hasAttention).toBe(false)
    expect(result.issues).toEqual([])

    source.composition!.checkouts.push({ repoId: 'external', checkoutId: 'external-1', path: 'C:/external', nodeIds: ['target'], revision: 1, status: 'bound' })
    source.composition!.diagnostics = []
    source.nodes.target = { id: 'target', sourceUri: target } as Blueprint['nodes'][string]
    expect(blueprintSourceInfo(source, projection).issues).toEqual([])
    source.composition!.checkouts[0].nodeIds = []
    expect(blueprintSourceInfo(source, projection).issues).toEqual([])
    expect(blueprintSourceInfo(source, projection).hasAttention).toBe(false)
  })

  it('does not report a bound foreign checkout scan as a current-workspace parse error', () => {
    const { source, snapshot, projection } = fixture()
    const foreign = { ...snapshot, repoId: 'external', coverage: { ...snapshot.coverage, checkoutRoot: 'C:/external' },
      diagnostics: [{ code: 'SCHEMA_INVALID', message: 'foreign note malformed', path: 'foreign.md' }] }
    source.composition!.checkouts.push({ repoId: 'external', checkoutId: 'foreign', path: 'C:/external', nodeIds: [], revision: 1, status: 'bound', snapshot: foreign })
    expect(blueprintSourceInfo(source, projection).issues).toEqual([])
  })

  it('ignores external ownership, parent and interface diagnostics while preserving missing local targets', () => {
    const { source, snapshot, projection } = fixture()
    const uri = 'note://repo/source', external = 'note://external/missing', local = 'note://repo/missing'
    source.nodeIds.push('module')
    source.nodes.module = { id: 'module', sourceUri: uri, note: { metadata: { repositories: { primary: 'external' } } } } as Blueprint['nodes'][string]
    source.composition!.diagnostics.push({ code: 'UNBOUND_MODULE', nodeId: 'module', message: 'External implementation repository unavailable' })
    projection.diagnostics.push(
      { code: 'UNRESOLVED_ARCHITECTURE_PARENT', nodeId: 'module', sourceUri: external, message: 'External parent unavailable' },
      { code: 'UNRESOLVED_ARCHITECTURE_INTERFACE', nodeId: 'module', sourceUri: external, message: 'External provider unavailable' },
      { code: 'UNRESOLVED_ARCHITECTURE_PARENT', nodeId: 'module', sourceUri: local, message: 'Local parent unavailable' },
    )
    const foreignDiagnostic = { code: 'NOT_READY', message: 'External reference unavailable', path: uri }
    snapshot.mentions.push({ sourceUri: uri, targetUri: external, resolution: { status: 'unavailable', reason: 'unbound-repository', diagnostics: [foreignDiagnostic] } } as NoteReadSnapshot['mentions'][number])
    snapshot.coverage.diagnostics.push(foreignDiagnostic, { code: 'NOT_FOUND', message: 'Local reference missing', path: uri })
    const result = blueprintSourceInfo(source, projection)
    expect(result.issues.map(issue => issue.message)).toEqual(['Local reference missing', 'Local parent unavailable'])
    expect(result.hasAttention).toBe(true)
  })
  it('scopes review subscriptions to the selected workspace, including while the graph is loading', () => {
    const { source, snapshot } = fixture()
    source.composition!.checkouts.push({ repoId: 'external', checkoutId: 'foreign', path: 'C:/external', nodeIds: [], revision: 1, status: 'bound', snapshot: { ...snapshot, coverage: { ...snapshot.coverage, checkoutRoot: 'C:/external' } } })
    expect(attentionRoots(source, 'C:/root')).toEqual(['C:/root'])
    expect(attentionRoots(source, 'C:/external')).toEqual(['C:/external'])
    expect(attentionRoots(null, 'C:/external')).toEqual(['C:/external'])
    expect(attentionRoots(source)).toEqual(['C:/root'])
  })
})
