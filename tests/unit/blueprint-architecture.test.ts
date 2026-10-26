import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseNote, serializeNote, taskContractHash, validateNote, type HarnessNoteMeta } from '@janus-agent/harness-core'
import { stringify } from 'yaml'
import { projectGraph } from '../../plugins/blueprint/src/main/notes/note-to-blueprint'
import { toNoteDoc } from '../../src/main/notes/note-provider'
import { composeBlueprint, compositionNodeId } from '../../plugins/blueprint/src/main/blueprint/blueprint-composition'
import { projectArchitecture, resolveArchitectureNote } from '../../src/renderer/src/features/blueprint/architecture-view'
import { deriveBlueprintFlow } from '../../src/renderer/src/features/blueprint/canvas-layout'

const R = '11111111-1111-4111-8111-111111111111', D = '22222222-2222-4222-8222-222222222222'
const id = (n: number) => `${String(n).padStart(8, '0')}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`
const uri = (n: number, repo = R) => `note://${repo}/${id(n)}`
const meta = (n: number, extra: Partial<HarnessNoteMeta> = {}): HarnessNoteMeta => ({ schema: 'harness-note/1', id: id(n), kind: 'initiative', lifecycle: 'accepted', created: '2026-10-03', tags: ['architecture:module'], parent: n === 1 ? undefined : uri(1), ...extra })
function raw(value: HarnessNoteMeta) {
  return `---\n${stringify(value)}---\n# ${value.id}\n\n## Goal\nResponsibility\n\n## Scope\nBoundary\n\n## Acceptance criteria\n- [ ] AC-1: Works.\n\n## Verification\nRun checks.\n`
}
function graph(values = [meta(1, { tags: ['architecture:project'], parent: undefined }), meta(2)], repo = R) {
  return projectGraph({ repoId: repo, repoName: repo, revision: 1, entries: values.map(value => ({ doc: toNoteDoc(parseNote(raw(value))), relPath: `.agents/notes/${value.id}.md`, sha256: 'a'.repeat(64) })) }, `C:/${repo}`)
}
describe('current system structure', () => {
  it('filters exact roles and lifecycle, retaining source bytes, full graph and layout', () => {
    const source = graph([meta(1, { tags: ['architecture:project'], parent: undefined }), meta(2), meta(3, { lifecycle: 'proposed' }), meta(4, { lifecycle: 'archived' }), meta(5, { tags: ['architecture:module', 'architecture:example'] }), meta(6, { tags: ['Architecture:module'] }), meta(7, { kind: 'decision', tags: ['architecture:module'] }), meta(8, { tags: ['architecture:module', 'architecture:project'] })])
    source.canvasLayout = { [id(1)]: { x: 19, y: 33 } }
    const before = structuredClone(source), result = projectArchitecture(source)
    expect(result.graph.nodeIds).toEqual([id(1), id(2)])
    expect(result.graph.nodes[id(2)].parentId).toBe(id(1))
    expect(result.graph.nodes[id(1)].children).toEqual([id(2)])
    expect(result.diagnostics.map(item => item.code)).toEqual(['INVALID_ARCHITECTURE_ROLE', 'INVALID_ARCHITECTURE_ROLE'])
    expect(result.graph.canvasLayout).toEqual({})
    expect(source).toEqual(before)
    expect(projectArchitecture(graph([meta(1, { tags: [] })])).graph.nodeIds).toEqual([])
  })
  it('keeps missing, nonstructural, planned and cyclic parents visibly unresolved', () => {
    const source = graph([meta(1, { lifecycle: 'proposed' }), meta(2), meta(3, { parent: uri(99) }), meta(4, { parent: uri(5) }), meta(5, { parent: uri(4) }), meta(6, { tags: [], parent: undefined }), meta(7, { parent: uri(6) })])
    const result = projectArchitecture(source)
    expect(result.graph.nodeIds).toHaveLength(5)
    expect(result.graph.nodeIds.every(key => result.graph.nodes[key].parentId === null)).toBe(true)
    expect(result.diagnostics.filter(item => item.code === 'CYCLIC_ARCHITECTURE_PARENT')).toHaveLength(2)
    expect(deriveBlueprintFlow(result.graph, undefined, {}, new Set(), false).nodes).toHaveLength(5)
  })
  it('connects only explicit providers and matching names, never task dependencies', () => {
    const source = graph([meta(1, { tags: ['architecture:project'], interfaces: [{ name: 'ReadPort', direction: 'provides' }] }), meta(2, { interfaces: [{ name: 'ReadPort', direction: 'needs', provider: uri(1) }, { name: 'ReadPort', direction: 'needs' }, { name: 'OtherPort', direction: 'needs', provider: uri(1) }] }), meta(3, { kind: 'task', tags: [], relations: [{ type: 'depends-on', target: uri(2) }] })])
    const result = projectArchitecture(source)
    expect(result.graph.relations).toEqual([])
    expect(result.graph.composition?.interfaces.filter(port => port.providerNodeId)).toHaveLength(1)
    expect(result.diagnostics.filter(item => item.code === 'UNRESOLVED_ARCHITECTURE_INTERFACE')).toHaveLength(2)
    expect(deriveBlueprintFlow(result.graph, undefined, {}, new Set(), false).edges.filter(edge => edge.id.startsWith('e-interface-'))).toMatchObject([{ source: id(1), target: id(2) }])
  })
  it('accepts a legacy typed parent, withholds conflicting parents and diagnoses non-root projects', () => {
    const source = graph([meta(1, { tags: ['architecture:project'], parent: uri(2) }), meta(2, { parent: undefined, relations: [{ type: 'parent', target: uri(1) }] }), meta(3, { parent: uri(1), relations: [{ type: 'parent', target: uri(2) }] })])
    const result = projectArchitecture(source)
    expect(result.graph.nodes[id(1)].parentId).toBeNull()
    expect(result.graph.nodes[id(2)].parentId).toBe(id(1))
    expect(result.graph.nodes[id(3)].parentId).toBeNull()
    expect(result.diagnostics.map(item => item.code)).toEqual(['ARCHITECTURE_PROJECT_PARENT', 'CONFLICTING_ARCHITECTURE_PARENT'])
  })
  it('derives deduplicated decisions and tasks from relations and ancestor chains without reparenting', () => {
    const source = graph([meta(1, { tags: ['architecture:project'] }), meta(2, { relations: [{ type: 'governed-by', target: uri(4) }, { type: 'related-to', target: uri(99) }] }), meta(3, { parent: uri(2), tags: [] }), meta(4, { kind: 'decision', lifecycle: 'implemented', tags: [], parent: uri(3) }), meta(5, { kind: 'task', tags: [], parent: uri(3), relations: [{ type: 'governed-by', target: uri(4) }] }), meta(6, { relations: [{ type: 'related-to', target: uri(5) }] })])
    const before = structuredClone(source), result = projectArchitecture(source)
    expect(result.related[id(2)].filter(row => row.nodeId === id(4))).toHaveLength(1)
    expect(result.related[id(2)].some(row => row.nodeId === id(5))).toBe(true)
    expect(result.related[id(6)].some(row => row.nodeId === id(5))).toBe(true)
    expect(result.related[id(2)]).toContainEqual(expect.objectContaining({ uri: uri(99), nodeId: undefined, via: 'related-to' }))
    expect(source).toEqual(before)
  })
  it('preserves distinct checkout instances and refuses ambiguous external providers', () => {
    const skeleton = graph([meta(1, { tags: ['architecture:project'], interfaces: [{ name: 'ReadPort', direction: 'needs', provider: uri(2, D) }] })])
    const provider = graph([meta(2, { parent: undefined, interfaces: [{ name: 'ReadPort', direction: 'provides' }] })], D)
    const inputs = ['x', 'y'].map(checkoutId => ({ repoId: D, checkoutId, path: `C:/${checkoutId}`, blueprint: provider }))
    const ambiguous = composeBlueprint({ skeleton, checkouts: inputs })
    expect(projectArchitecture(ambiguous).graph.composition?.interfaces.some(port => port.providerNodeId)).toBe(false)
    const selected = composeBlueprint({ skeleton, checkouts: [inputs[0], { ...inputs[1], selected: true }] })
    const y = compositionNodeId(D, 'y', uri(2, D)), x = compositionNodeId(D, 'x', uri(2, D))
    expect(resolveArchitectureNote(selected, id(1), uri(2, D))).toBe(y)
    expect(resolveArchitectureNote(selected, x, uri(2, D))).toBe(x)
    expect(projectArchitecture(selected).graph.composition?.interfaces[0].providerNodeId).toBe(y)
    expect(projectArchitecture(selected).graph.nodeIds).toEqual([id(1), x, y])
  })
  it('rejects duplicate local identities and duplicate interface offers', () => {
    const source = graph([meta(1, { tags: ['architecture:project'], interfaces: [{ name: 'ReadPort', direction: 'provides' }, { name: 'ReadPort', direction: 'provides' }] }), meta(2, { interfaces: [{ name: 'ReadPort', direction: 'needs', provider: uri(1) }] })])
    expect(projectArchitecture(source).graph.composition?.interfaces.some(port => port.providerNodeId)).toBe(false)
    source.nodes.duplicate = { ...source.nodes[id(2)], id: 'duplicate' }; source.nodeIds.push('duplicate')
    const result = projectArchitecture(source)
    expect(result.graph.nodeIds).toEqual([id(1)])
    expect(result.diagnostics.filter(item => item.code === 'INVALID_ARCHITECTURE_IDENTITY')).toHaveLength(2)
    source.nodes[id(1)].sourceUri = 'not-a-note-uri'
    expect(projectArchitecture(source).graph.nodeIds).toEqual([])
  })
  it('keeps module metadata through the installed parser and serializer, and task contracts through projection', () => {
    const module = parseNote(raw(meta(2, { interfaces: [{ name: 'ReadPort', direction: 'needs', provider: uri(1) }] })))
    expect(parseNote(serializeNote(module)).meta).toEqual(module.meta)
    expect(validateNote(module)).toEqual([])
    const task = parseNote(readFileSync(resolve('../WorkFlowX/standards/harness-note/1/fixtures/valid-task.md'), 'utf8'))
    expect(validateNote(task)).toEqual([])
    const before = taskContractHash(task)
    const source = projectGraph({ repoId: R, repoName: R, revision: 1, entries: [module, task].map(note => ({ doc: toNoteDoc(note), relPath: note.meta.id + '.md', sha256: 'a'.repeat(64) })) }, 'C:/fixture')
    projectArchitecture(source)
    const reread = parseNote(serializeNote({ ...task, meta: source.nodes[task.meta.id].note!.metadata! }))
    expect(validateNote(reread)).toEqual([])
    expect(taskContractHash(reread)).toBe(before)
  })
})
