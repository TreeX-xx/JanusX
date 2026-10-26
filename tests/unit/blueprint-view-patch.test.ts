import { describe, expect, it } from 'vitest'
import type { Blueprint } from '../../plugins/blueprint/src/shared/janus/types'
import {
  applyViewPatch,
  blueprintViewPatchSchema,
  createJanusBlueprintTools,
  validateViewPatch,
} from '../../plugins/blueprint/src/main/janus/maintenance/blueprint-tools'

function fixture(): Blueprint {
  const nodes = {
    root: { id: 'root' },
    leaf: { id: 'leaf' },
  }
  return {
    contentRevision: 3,
    source: 'harness',
    id: 'harness:project:testtest',
    name: 'T',
    description: '',
    rootNodeId: 'root',
    nodeIds: ['root', 'leaf'],
    nodes: nodes as unknown as Blueprint['nodes'],
    relations: [],
    requirementCandidates: [],
    mountedTo: null,
    canvasLayout: { root: { x: 0, y: 0 } },
    collapsedNodeIds: null,
    createdAt: '2026-09-23T00:00:00.000Z',
    updatedAt: '2026-09-23T00:00:00.000Z',
  }
}

describe('blueprint ViewPatch validation', () => {
  it('accepts an overlay-only patch inside the live scope', () => {
    const checked = validateViewPatch(fixture(), {
      summary: 'Tidy the canvas',
      layout: { leaf: { x: 10, y: 20 } },
      collapsedNodeIds: ['root'],
      focusNodeId: 'leaf',
    })
    expect(checked.ok).toBe(true)
  })

  it('rejects raw file-edit fields at the schema boundary', () => {
    expect(() => blueprintViewPatchSchema.parse({
      summary: 'Sneaky',
      title: 'New title',
      features: [{ title: 'x' }],
      status: 'done',
    })).toThrow()
    const checked = validateViewPatch(fixture(), { summary: 'Sneaky', title: 'x' })
    expect(checked).toMatchObject({ ok: false, code: 'SCHEMA_INVALID' })
  })

  it('rejects unknown node ids without touching the graph', () => {
    expect(validateViewPatch(fixture(), { summary: 'x', layout: { ghost: { x: 1, y: 1 } } }))
      .toMatchObject({ ok: false, code: 'NOT_FOUND' })
    expect(validateViewPatch(fixture(), { summary: 'x', collapsedNodeIds: ['ghost'] }))
      .toMatchObject({ ok: false, code: 'NOT_FOUND' })
    expect(validateViewPatch(fixture(), { summary: 'x', focusNodeId: 'ghost' }))
      .toMatchObject({ ok: false, code: 'NOT_FOUND' })
  })

  it('rejects oversized layouts and non-finite coordinates', () => {
    const layout = Object.fromEntries(
      Array.from({ length: 201 }, (_, i) => [`n${i}`, { x: i, y: i }]),
    )
    expect(validateViewPatch(fixture(), { summary: 'x', layout }))
      .toMatchObject({ ok: false, code: 'SCHEMA_INVALID' })
    expect(validateViewPatch(fixture(), { summary: 'x', layout: { leaf: { x: Number.NaN, y: 0 } } }))
      .toMatchObject({ ok: false, code: 'SCHEMA_INVALID' })
  })

  it('merges overlay state purely, preserving untouched entries', () => {
    const applied = applyViewPatch(fixture(), {
      summary: 'x',
      layout: { leaf: { x: 5, y: 6 } },
    })
    expect(applied.canvasLayout).toMatchObject({ root: { x: 0, y: 0 }, leaf: { x: 5, y: 6 } })
    expect(applied.collapsedNodeIds).toBeNull()
    expect(applied.focusNodeId).toBeNull()
  })
})

describe('janus.blueprint.view tool', () => {
  it('is exposed alongside read and propose and enforces the patch contract', async () => {
    const tools = createJanusBlueprintTools({ blueprint: fixture(), allowedNodeIds: new Set(['root', 'leaf']) })
    expect(tools.map((t) => t.name)).toEqual(['janus.blueprint.read', 'janus.blueprint.propose', 'janus.blueprint.view'])
    const view = tools.find((t) => t.name === 'janus.blueprint.view')!
    const ok = await view.execute({ id: 'v1', name: view.name, arguments: { summary: 'x', focusNodeId: 'leaf' } } as never, new AbortController().signal)
    expect(JSON.parse(ok.content as string)).toMatchObject({ focusNodeId: 'leaf' })
    await expect(view.execute({ id: 'v2', name: view.name, arguments: { summary: 'x', title: 'hack' } } as never, new AbortController().signal))
      .rejects.toThrow('SCHEMA_INVALID')
  })
})
