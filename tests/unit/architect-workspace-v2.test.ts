import { afterEach, describe, expect, it } from 'vitest'
import { rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { createArchitectWorkspace } from '../helpers/architect-workspace'
import { projectArchitecture, resolveArchitectureNote } from '../../src/renderer/src/features/blueprint/architecture-view'
import { moduleOwners, projectModuleBrowse } from '../../src/renderer/src/features/blueprint/module-browsing'
import { composeBlueprint, compositionNodeId } from '../../plugins/blueprint/src/main/blueprint/blueprint-composition'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
async function fixture() { const f = await createArchitectWorkspace(); roots.push(f.root); return f }
describe('v2 architect workspace parsing', () => {
  it('reads a pure Note plan with recursive modules and no special workspace marker', async () => {
    const f = await fixture(), before = structuredClone(f.blueprint), result = projectArchitecture(f.blueprint)
    await expect(stat(join(f.root, 'src'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(f.blueprint.invalidNotes).toEqual([])
    expect(result.graph.nodeIds).toHaveLength(4)
    expect(result.graph.nodes[f.parser.id].parentId).toBe(f.reader.id)
    expect(result.graph.nodes[f.planned.id].note?.moduleState).toBe('planned')
    expect(result.diagnostics).toEqual([])
    expect(f.blueprint).toEqual(before)
  })
  it('keeps a shared requirement in one owner and exposes acceptance and Markdown references from other modules', async () => {
    const f = await fixture(), projection = projectArchitecture(f.blueprint)
    expect(moduleOwners(f.blueprint, projection)[f.requirement.id]).toBe(f.project.id)
    const reader = projection.related[f.reader.id].find(row => row.nodeId === f.requirement.id)!
    expect(reader.links).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'acceptance', sourceUri: f.task.uri, targetUri: f.requirement.uri, criteria: ['AC-1'] })]))
    expect(projection.related[f.planned.id].find(row => row.nodeId === f.requirement.id)?.links).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'reference' })]))
    expect(projection.related[f.parser.id].find(row => row.nodeId === f.requirement.id)?.links).toEqual(expect.arrayContaining([expect.objectContaining({ sourceUri: f.reference.uri, type: 'reference' })]))
    const page = projectModuleBrowse(f.blueprint, projection, f.reader.id)
    expect(page.graph.nodeIds).toContain(f.reader.id)
    expect(page.graph.nodeIds).toContain(f.task.id)
    expect(page.graph.nodeIds).not.toContain(f.requirement.id)
    expect(new Set(f.blueprint.nodeIds).size).toBe(f.blueprint.nodeIds.length)
  })
  it('retains multiple typed reasons, module dependencies and their direction', async () => {
    const f = await fixture(), projection = projectArchitecture(f.blueprint)
    const rows = projection.related[f.reader.id].filter(row => row.nodeId === f.decision.id)
    expect(rows).toHaveLength(1)
    expect(rows[0].links?.map(link => link.type)).toEqual(['governed-by', 'derived-from'])
    expect(projection.related[f.reader.id].find(row => row.nodeId === f.planned.id)?.links).toEqual([expect.objectContaining({ type: 'depends-on', sourceUri: f.reader.uri, targetUri: f.planned.uri })])
    expect(projection.related[f.planned.id].find(row => row.nodeId === f.reader.id)?.links?.some(link => link.type === 'depends-on' && link.sourceUri === f.reader.uri)).toBe(true)
  })
  it('keeps unbound links and uses the selected checkout without merging identities', async () => {
    const f = await fixture(), other = await fixture()
    f.blueprint.nodes[f.reader.id].note!.relations.push({ type: 'governed-by', target: other.decision.uri })
    const rows = ['x', 'y'].map(checkoutId => ({ repoId: other.repoId, checkoutId, path: other.root + '/' + checkoutId, blueprint: other.blueprint, snapshot: other.blueprint.noteSnapshot }))
    const unresolved = composeBlueprint({ skeleton: f.blueprint, checkouts: rows })
    expect(projectArchitecture(unresolved).related[f.reader.id].find(row => row.uri === other.decision.uri)?.nodeId).toBeUndefined()
    const selected = composeBlueprint({ skeleton: f.blueprint, checkouts: [rows[0], { ...rows[1], selected: true }] })
    const y = compositionNodeId(other.repoId, 'y', other.decision.uri)
    expect(resolveArchitectureNote(selected, f.reader.id, other.decision.uri)).toBe(y)
    expect(projectArchitecture(selected).related[f.reader.id].find(row => row.uri === other.decision.uri)).toMatchObject({ nodeId: y })
  })
})
