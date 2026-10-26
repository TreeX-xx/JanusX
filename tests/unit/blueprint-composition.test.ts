import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { stringify } from 'yaml'
import { parseNote, type HarnessNoteMeta } from '@janus-agent/harness-core'
import { SUPPORTED_HARNESS_PROFILE } from '@janus-agent/harness-node'
import { composeBlueprint, compositionNodeId } from '../../plugins/blueprint/src/main/blueprint/blueprint-composition'
import { projectGraph } from '../../plugins/blueprint/src/main/notes/note-to-blueprint'
import { toNoteDoc } from '../../src/main/notes/note-provider'
import { BlueprintNoteService as HarnessNoteService } from '../../plugins/blueprint/src/main/notes/service'
import { nodeNoteSnapshot, resolveCompositionNote } from '../../src/renderer/src/features/blueprint/composition-view'
import { deriveBlueprintFlow } from '../../src/renderer/src/features/blueprint/canvas-layout'

const R = '11111111-1111-4111-8111-111111111111', D = '22222222-2222-4222-8222-222222222222'
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const uri = (repo: string, id = A) => 'note://' + repo + '/' + id
function raw(id = A, meta: Partial<HarnessNoteMeta> = {}) {
  return ['---', stringify({ schema: 'harness-note/1', id, kind: 'initiative', lifecycle: 'accepted', created: '2026-09-25', ...meta }).trim(), '---', '', '# ' + id, '', '## Goal', '', 'A goal.', '', '## Scope', '', 'One module.', '', '## Acceptance criteria', '', '- [ ] AC-1: Module is usable.', ''].join(String.fromCharCode(10))
}
function graph(repo = R, path = 'C:/architect', meta: Partial<HarnessNoteMeta> = {}) {
  const doc = toNoteDoc(parseNote(raw(A, meta)))
  const result = projectGraph({ repoId: repo, repoName: repo, revision: 1, entries: [{ doc, relPath: '.agents/notes/a.md', sha256: 'a'.repeat(64) }] }, path)
  result.noteSnapshot = { repoId: repo, entries: [{ uri: uri(repo), relPath: '.agents/notes/a.md', sourceHash: 'a'.repeat(64), classification: 'valid', diagnostics: [], doc }], relations: [], mentions: [], diagnostics: [], coverage: { status: 'complete', checkoutRoot: path, snapshotHash: path, diagnostics: [] } }
  return result
}
const checkout = (id = 'dev', meta: Partial<HarnessNoteMeta> = {}) => ({ repoId: D, checkoutId: id, path: 'C:/' + id, blueprint: graph(D, 'C:/' + id, meta) })

describe('explicit blueprint composition', () => {
  it('keeps local Notes readable without importing their implementation workspace in local-only mode', () => {
    const skeleton = graph(R, 'C:/architect', { repositories: { primary: D }, interfaces: [{ name: 'read', direction: 'provides' }] })
    const result = composeBlueprint({ skeleton, checkouts: [checkout()], localOnly: true })
    expect(result.nodeIds).toEqual([A])
    expect(result.composition.nodes[A].status).toBe('bound')
    expect(result.composition.interfaces[0].status).toBe('idle')
    expect(result.composition.checkouts).toEqual([])
    expect(result.composition.diagnostics).toEqual([])
  })
  it('preserves root identity, distinct worktree instances, snapshots and evidence ownership', () => {
    const skeleton = graph(R, 'C:/architect', { repositories: { primary: D } })
    const x = checkout('x', { codeRefs: [{ repoId: D, path: 'src/a.ts', role: 'entry' }] }), y = checkout('y')
    const result = composeBlueprint({ skeleton, checkouts: [x, y] })
    expect(result.id).toBe(skeleton.id)
    expect(new Set(result.nodeIds).size).toBe(3)
    expect(result.composition.nodes[A].status).toBe('unbound')
    const xid = compositionNodeId(D, 'x', uri(D)), yid = compositionNodeId(D, 'y', uri(D))
    expect(nodeNoteSnapshot(result, xid)?.coverage.checkoutRoot).toBe('C:/x')
    expect(nodeNoteSnapshot(result, yid)?.coverage.checkoutRoot).toBe('C:/y')
    expect(resolveCompositionNote(result, A, uri(D))).toBeUndefined()
    expect(resolveCompositionNote(result, xid, uri(D))).toBe(xid)
    expect(result.composition.evidence.find(e => e.nodeId === A)?.codeRefs).toEqual([])
    expect(result.composition.evidence.find(e => e.nodeId === xid)?.codeRefs).toHaveLength(1)
    expect(skeleton.nodeIds).toEqual([A])
  })
  it('uses explicit selected checkout for module binding and interface matching', () => {
    const skeleton = graph(R, 'C:/architect', { repositories: { primary: D }, interfaces: [{ name: 'read', direction: 'needs', provider: uri(D) }] })
    const provider = { interfaces: [{ name: 'read', direction: 'provides' as const }] }
    const result = composeBlueprint({ skeleton, checkouts: [checkout('x', provider), { ...checkout('y', provider), selected: true }] })
    const yid = compositionNodeId(D, 'y', uri(D))
    expect(result.composition.nodes[A].binding?.checkoutId).toBe('y')
    expect(result.composition.interfaces.find(p => p.nodeId === A)).toMatchObject({ status: 'connected', providerNodeId: yid })
    expect(resolveCompositionNote(result, A, uri(D))).toBe(yid)
    expect(deriveBlueprintFlow(result, undefined, {}, new Set(), false).edges.find(e => e.id.startsWith('e-interface-'))).toMatchObject({ source: yid, target: A })
  })
  it('does not match by name; distinguishes dangling, idle, unbound and stale', () => {
    const skeleton = graph(R, 'C:/architect', { interfaces: [{ name: 'read', direction: 'needs' }, { name: 'missing', direction: 'needs', provider: uri(D, B) }] })
    const input = checkout('x', { interfaces: [{ name: 'read', direction: 'provides' }] })
    const result = composeBlueprint({ skeleton, checkouts: [input] })
    expect(result.composition.interfaces.map(p => p.status)).toEqual(['dangling', 'unbound', 'idle'])
    expect(deriveBlueprintFlow(result, undefined, {}, new Set(), false).edges).toHaveLength(0)
    skeleton.nodes[A].note!.metadata!.interfaces![0].provider = uri(D)
    const stale = composeBlueprint({ skeleton, checkouts: [{ ...input, expectedSourceHashes: { [uri(D)]: 'old' } }] })
    expect(stale.composition.interfaces[0].status).toBe('stale')
    expect(stale.composition.checkouts[0].status).toBe('stale')
  })
  it('keeps relation metadata and full identity without duplicating or guessing', () => {
    const skeleton = graph()
    skeleton.relations = [{ id: 'r', sourceNodeId: A, targetNodeId: uri(D), sourceUri: uri(R), targetUri: uri(D), type: 'implements', criteria: ['AC-1'], scope: 'partial', reason: 'evidence', createdAt: '', updatedAt: '' }]
    const result = composeBlueprint({ skeleton, checkouts: [checkout()] })
    expect(result.relations).toHaveLength(1)
    expect(result.relations[0]).toMatchObject({ targetNodeId: compositionNodeId(D, 'dev', uri(D)), targetUri: uri(D), type: 'implements', criteria: ['AC-1'], scope: 'partial', reason: 'evidence', resolution: { status: 'resolved' } })
    expect(composeBlueprint({ skeleton, checkouts: [checkout('x'), checkout('y')] }).relations[0].targetNodeId).toBe(uri(D))
  })
  it('withholds duplicate bindings and preserves unavailable modules and dirty diagnostics', () => {
    const result = composeBlueprint({ skeleton: graph(), checkouts: [checkout(), checkout(), { ...checkout('missing'), blueprint: undefined, bound: false }, { ...checkout('dirty'), dirty: true }] })
    expect(result.composition.checkouts.map(r => r.status)).toEqual(['unbound', 'unbound', 'bound'])
    expect(result.nodeIds).toHaveLength(2)
    expect(result.composition.diagnostics.map(d => d.code)).toEqual(expect.arrayContaining(['DUPLICATE_CHECKOUT', 'DIRTY_CHECKOUT']))
  })
})

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
async function root(repoId: string) {
  const path = await mkdtemp(join(tmpdir(), 'janus-r4-')); roots.push(path)
  await mkdir(join(path, '.agents', 'notes'), { recursive: true })
  await writeFile(join(path, '.agents', 'harness.json'), JSON.stringify({ schemaVersion: 1, repoId, name: repoId, profile: SUPPORTED_HARNESS_PROFILE }))
  await writeFile(join(path, '.agents', 'notes', 'a.md'), raw())
  return path
}
describe('workspace projection gateway', () => {
  it('keeps referenced workspaces out of the graph and shows them only after switching roots', async () => {
    const svc = new HarnessNoteService(), architecture = await root(R), dev = await root(D)
    await writeFile(join(architecture, '.agents', 'notes', 'a.md'), raw(B, { relations: [{ type: 'related-to', target: uri(D) }] }))
    const view = await svc.projectView(architecture)
    expect(view.blueprint.nodeIds).toEqual([B])
    expect(view.blueprint.composition?.checkouts).toEqual([])
    expect(view.blueprint.relations[0].resolution?.status).toBe('unavailable')
    const switched = await svc.projectView(dev)
    expect(switched.blueprint.nodeIds).toEqual([A])
    expect(switched.blueprint.noteSnapshot?.repoId).toBe(D)
    expect(await svc.getBindings(architecture)).toEqual([])
  })
  it('keeps explicit bindings without loading their Note contents or revisions', async () => {
    const svc = new HarnessNoteService(), architecture = await root(R), dev = await root(D)
    await svc.setBinding(architecture, { repoId: D, checkoutId: 'dev', path: dev, selected: true })
    const first = await svc.projectView(architecture)
    expect(first.blueprint.nodeIds).toEqual([A])
    expect(first.blueprint.composition?.nodes[A].status).toBe('bound')
    expect(first.blueprint.composition?.diagnostics).toEqual([])
    await writeFile(join(dev, '.agents', 'notes', 'a.md'), raw().replace('A goal.', 'Changed goal.'))
    const second = await svc.projectView(architecture)
    expect(second.rev).toBe(first.rev)
    expect(second.blueprint.composition?.checkouts).toEqual([])
    expect(second.blueprint.nodes[A].positioning).toBe('A goal.')
    expect((await svc.projectView(dev)).blueprint.nodes[A].positioning).toBe('Changed goal.')
    expect(await svc.getBindings(architecture)).toMatchObject([{ checkoutId: 'dev', path: dev }])
  })
  it('rejects wrong repository bindings while removed foreign checkouts do not affect the current graph', async () => {
    const svc = new HarnessNoteService(), architecture = await root(R), dev = await root(D)
    await expect(svc.setBinding(architecture, { repoId: R, checkoutId: 'bad', path: dev, selected: true })).rejects.toMatchObject({ code: 'SCHEMA_INVALID' })
    await svc.setBinding(architecture, { repoId: D, checkoutId: 'dev', path: dev, selected: true })
    await rm(join(dev, '.agents'), { recursive: true })
    expect((await svc.projectView(architecture)).blueprint.composition?.checkouts).toEqual([])
  })
})
