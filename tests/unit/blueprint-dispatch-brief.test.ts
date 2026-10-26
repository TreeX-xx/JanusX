/**
 * Dispatch brief: schema bounds, host-side rendering, and the guards that keep a
 * model-invented reference or a cross-scope node out of the terminal.
 *
 * Note: dispatch is not a change-set operation — see .agents/notes/blueprint/maintenance/blueprint-dispatch-panel.md
 */
import { describe, expect, it } from 'vitest'
import {
  DISPATCH_BRIEF_MAX,
  authorizedNoteRefs,
  dispatchAnchorNodeId,
  dispatchBriefSchema,
  renderDispatchBrief,
  type DispatchBrief,
} from '../../plugins/blueprint/src/main/janus/maintenance/dispatch-brief'
import type { BlueprintMaintenanceScope } from '../../plugins/blueprint/src/shared/janus/maintenance-types'

const brief = (over: Partial<DispatchBrief> = {}): DispatchBrief => ({
  goal: 'Ship the retry path',
  steps: ['add the backoff helper', 'cover it with tests'],
  acceptance: ['retry fires twice on a 503'],
  constraints: ['do not touch public types'],
  noteRefs: ['note://r/a', 'note://r/b'],
  ...over,
})

const render = (input: Partial<Parameters<typeof renderDispatchBrief>[0]> = {}) =>
  renderDispatchBrief({
    brief: brief(),
    blueprintName: 'Project',
    workspaceName: 'WS',
    workspacePath: 'C:/repo',
    notePaths: new Map([['note://r/a', '.agents/notes/a.md']]),
    ...input,
  })

describe('dispatchBriefSchema', () => {
  it('defaults the optional lists', () => {
    expect(dispatchBriefSchema.parse({ goal: 'do it' })).toEqual({
      goal: 'do it', steps: [], acceptance: [], constraints: [], noteRefs: [],
    })
  })

  it('refuses an empty goal and oversized sections', () => {
    expect(dispatchBriefSchema.safeParse({ goal: '' }).success).toBe(false)
    expect(dispatchBriefSchema.safeParse({ goal: 'g', steps: Array(DISPATCH_BRIEF_MAX.steps + 1).fill('s') }).success).toBe(false)
    expect(dispatchBriefSchema.safeParse({ goal: 'g', noteRefs: Array(DISPATCH_BRIEF_MAX.noteRefs + 1).fill('n') }).success).toBe(false)
  })
})

describe('authorizedNoteRefs', () => {
  const authorized = new Set(['note://r/a'])

  it('keeps only refs the host can prove, deduplicated', () => {
    expect(authorizedNoteRefs(brief(), authorized)).toEqual(['note://r/a'])
  })

  it('drops everything when the model cites nothing authorized', () => {
    expect(authorizedNoteRefs(brief({ noteRefs: ['note://r/ghost'] }), authorized)).toEqual([])
  })
})

describe('renderDispatchBrief', () => {
  it('carries goal, note paths, steps, acceptance and the note-write constraint', () => {
    const text = render()
    expect(text).toContain('Ship the retry path')
    expect(text).toContain('.agents/notes/a.md（note://r/a）')
    // A cited Note with no resolvable path still appears by identity.
    expect(text).toContain('- note://r/b')
    expect(text).toContain('1. add the backoff helper')
    expect(text).toContain('- retry fires twice on a 503')
    expect(text).toContain('只改实现，不改 Note 正文')
  })

  it('omits the note section entirely when nothing is cited', () => {
    expect(render({ brief: brief({ noteRefs: [] }) })).not.toContain('需求依据')
  })
})

describe('dispatchAnchorNodeId', () => {
  const nodes = {
    a: { sourceUri: 'note://r/a' },
    b: { sourceUri: 'note://r/b' },
    orphan: { sourceUri: null },
  }
  const allowed = new Set(['a', 'b', 'orphan'])
  const authorized = new Set(['note://r/a', 'note://r/b'])

  it('prefers the scoped node', () => {
    expect(dispatchAnchorNodeId({ nodes }, { type: 'node', nodeId: 'b' }, allowed, authorized)).toBe('b')
    expect(dispatchAnchorNodeId({ nodes }, { type: 'subtree', nodeId: 'b' }, allowed, authorized)).toBe('b')
  })

  it('falls back to the first readable node for a whole-graph scope', () => {
    expect(dispatchAnchorNodeId({ nodes }, { type: 'blueprint' }, allowed, authorized)).toBe('a')
  })

  it('never anchors on a node outside the scope or without a Note', () => {
    const scope: BlueprintMaintenanceScope = { type: 'node', nodeId: 'orphan' }
    expect(dispatchAnchorNodeId({ nodes }, scope, new Set(['orphan']), authorized)).toBeNull()
    expect(dispatchAnchorNodeId({ nodes }, { type: 'blueprint' }, new Set(['orphan']), new Set())).toBeNull()
  })
})