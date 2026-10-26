import { describe, expect, it } from 'vitest'
import { sha256HexBytes } from '@janus-agent/harness-node'
import { translateMaintenanceOpsToHarness } from '../../plugins/blueprint/src/main/notes/maintenance-bridge'
import type { BlueprintOperation } from '../../plugins/blueprint/src/shared/janus/maintenance-types'

const REPO = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const REQ = '11111111-1111-1111-1111-111111111111'
const TASK = '22222222-2222-2222-2222-222222222222'
const DECISION = '33333333-3333-3333-3333-333333333333'
const TASK_WORK = '44444444-4444-4444-4444-444444444444'

const REQ_MD = `---
schema: harness-note/1
id: ${REQ}
kind: requirement
lifecycle: accepted
created: 2026-09-17
---

# Requirement one

## Problem

The widget fails.

## Expected behavior

It works.

## Scope

Widget only.

## Acceptance criteria

- [ ] AC-1: widget works
`

const TASK_MD = `---
schema: harness-note/1
id: ${TASK}
kind: task
lifecycle: draft
created: 2026-09-17
---

# Task one

## Scope

Do the thing.

## Acceptance criteria

- [ ] AC-1: thing done

## Verification

Run the checks.
`

const DECISION_MD = `---
schema: harness-note/1
id: ${DECISION}
kind: decision
lifecycle: accepted
created: 2026-09-17
---

# Decision one

## Problem

Which way.

## Proposal

This way.

## Alternatives considered

That way.

## Risks

Low.
`

const TASK_WORK_MD = `---
schema: harness-note/1
id: ${TASK_WORK}
kind: task
lifecycle: accepted
created: 2026-09-17
work:
  scope:
    - repoId: ${REPO}
      paths: ['./']
  acceptanceRefs:
    - uri: note://${REPO}/${REQ}
      criterionId: AC-1
  verification:
    - id: v1
      kind: manual
      required: true
      repoId: ${REPO}
      cwd: .
      description: Eyeball it.
---

# Task two

## Scope

Do the other thing.

## Acceptance criteria

- [ ] AC-1: other thing done

## Verification

Eyeball it.
`

const NOTES = new Map([[REQ, REQ_MD], [TASK, TASK_MD], [DECISION, DECISION_MD], [TASK_WORK, TASK_WORK_MD]])

const ctx = {
  repoId: REPO,
  resolveNote: (nodeId: string) => {
    const markdown = NOTES.get(nodeId)
    if (!markdown) return null
    return {
      uri: `note://${REPO}/${nodeId}`,
      expectedHash: sha256HexBytes(Buffer.from(markdown, 'utf8')),
      markdown,
    }
  },
}

const uri = (id: string): string => `note://${REPO}/${id}`

function baseOp(operationId: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { operationId, reason: `reason ${operationId}`, evidenceRefs: [], dependsOn: [], risk: 'low', ...extra }
}

describe('maintenance bridge (S6-c slice 2a)', () => {
  it('creates one note with full prose and resolves its temp id later', () => {
    const result = translateMaintenanceOpsToHarness([
      {
        ...baseOp('op-create'),
        type: 'create-node',
        tempNodeId: 'tmp-new',
        parentId: REQ,
        after: {
          title: 'Fresh requirement',
          type: 'feature',
          description: 'Fresh problem.',
          positioning: '',
          techSolution: '',
          notes: '',
          tags: ['fresh'],
        },
      },
      {
        ...baseOp('op-move-new', { dependsOn: ['op-create'] }),
        type: 'move-node',
        nodeId: 'tmp-new',
        beforeParentId: null,
        afterParentId: TASK,
      },
    ] as unknown as BlueprintOperation[], ctx)

    expect(result.complete).toBe(true)
    expect(result.ops).toHaveLength(1)
    const [op] = result.ops
    expect(op.type).toBe('create')
    expect(op.expectedHash).toBeNull()
    expect(op.maintenanceOperationIds).toEqual(['op-create', 'op-move-new'])
    expect(op.afterMarkdown).toContain('# Fresh requirement')
    expect(op.afterMarkdown).toContain('Fresh problem.')
    expect(op.afterMarkdown).toContain(`parent: ${uri(TASK)}`)
    expect(op.afterMarkdown).toContain('fresh')
    expect(op.afterMarkdown).not.toContain(uri(REQ))
  })

  it('refuses creates with unknown parents or empty titles', () => {
    const parent = translateMaintenanceOpsToHarness([
      { ...baseOp('op-bad-parent'), type: 'move-node', nodeId: TASK, beforeParentId: null, afterParentId: 'nope' },
    ] as unknown as BlueprintOperation[], ctx)
    expect(parent.complete).toBe(false)
    expect(parent.ops).toHaveLength(0)
    expect(parent.untranslatable[0]).toMatchObject({ operationId: 'op-bad-parent' })

    const title = translateMaintenanceOpsToHarness([
      {
        ...baseOp('op-bad-title'),
        type: 'create-node',
        tempNodeId: 'tmp-x',
        parentId: REQ,
        after: { title: '  ', type: 'feature', description: '', positioning: '', techSolution: '', notes: '', tags: [] },
      },
    ] as unknown as BlueprintOperation[], ctx)
    expect(title.complete).toBe(false)
    expect(title.ops).toHaveLength(0)
  })

  it('updates prose and status through one fused replace', () => {
    const result = translateMaintenanceOpsToHarness([
      {
        ...baseOp('op-update'),
        type: 'update-node',
        nodeId: DECISION,
        before: {},
        after: { title: 'Decision one revised', description: 'Which way, revised.', status: 'planning' },
      },
      {
        ...baseOp('op-move'),
        type: 'move-node',
        nodeId: DECISION,
        beforeParentId: null,
        afterParentId: REQ,
      },
    ] as unknown as BlueprintOperation[], ctx)

    expect(result.complete).toBe(true)
    expect(result.ops).toHaveLength(1)
    const [op] = result.ops
    expect(op.type).toBe('replace')
    expect(op.uri).toBe(uri(DECISION))
    expect(op.expectedHash).toBe(ctx.resolveNote(DECISION)?.expectedHash)
    expect(op.afterMarkdown).toContain('# Decision one revised')
    expect(op.afterMarkdown).toContain('Which way, revised.')
    expect(op.afterMarkdown).toContain(`parent: ${uri(REQ)}`)
    expect(op.afterMarkdown).toContain('lifecycle: draft')
  })

  it('refuses kind changes, progress, features, and evidence-less task completion', () => {
    const kinds = translateMaintenanceOpsToHarness([
      { ...baseOp('op-kind'), type: 'update-node', nodeId: REQ, before: {}, after: { type: 'task' } },
      { ...baseOp('op-progress'), type: 'update-node', nodeId: REQ, before: {}, after: { progress: 50 } },
      { ...baseOp('op-features'), type: 'update-node', nodeId: REQ, before: {}, after: { features: [{ id: 'f1' }] } },
      { ...baseOp('op-empty'), type: 'update-node', nodeId: REQ, before: {}, after: {} },
      { ...baseOp('op-done'), type: 'update-node', nodeId: TASK, before: {}, after: { status: 'done' } },
    ] as unknown as BlueprintOperation[], ctx)

    expect(kinds.complete).toBe(false)
    expect(kinds.ops).toHaveLength(0)
    expect(kinds.untranslatable.map((u) => u.operationId)).toEqual(
      ['op-kind', 'op-progress', 'op-features', 'op-empty', 'op-done'],
    )
    expect(kinds.untranslatable.find((u) => u.operationId === 'op-features')?.reason).toContain('HARNESS_MANAGED')
    expect(kinds.untranslatable.find((u) => u.operationId === 'op-done')?.reason).toContain('HARNESS_MANAGED')
  })

  it('preserves the work contract when touching an accepted task', () => {
    const result = translateMaintenanceOpsToHarness([
      { ...baseOp('op-touch'), type: 'update-node', nodeId: TASK_WORK, before: {}, after: { title: 'Task two revised' } },
    ] as unknown as BlueprintOperation[], ctx)

    expect(result.complete).toBe(true)
    expect(result.ops).toHaveLength(1)
    expect(result.ops[0].afterMarkdown).toContain('# Task two revised')
    expect(result.ops[0].afterMarkdown).toContain('acceptanceRefs:')
    expect(result.ops[0].afterMarkdown).toContain('lifecycle: accepted')
  })

  it('adds depends-on on the source and flips blocks onto the target', () => {
    const depends = translateMaintenanceOpsToHarness([
      {
        ...baseOp('op-dep'),
        type: 'add-relation',
        tempRelationId: 'tmp-rel-1',
        after: { sourceNodeId: TASK, targetNodeId: REQ, relationType: 'depends-on' },
      },
    ] as unknown as BlueprintOperation[], ctx)
    expect(depends.complete).toBe(true)
    expect(depends.ops).toHaveLength(1)
    expect(depends.ops[0].uri).toBe(uri(TASK))
    expect(depends.ops[0].afterMarkdown).toContain('depends-on')
    expect(depends.ops[0].afterMarkdown).toContain(uri(REQ))

    const blocks = translateMaintenanceOpsToHarness([
      {
        ...baseOp('op-blocks'),
        type: 'add-relation',
        tempRelationId: 'tmp-rel-2',
        after: { sourceNodeId: REQ, targetNodeId: TASK, relationType: 'blocks' },
      },
    ] as unknown as BlueprintOperation[], ctx)
    expect(blocks.complete).toBe(true)
    expect(blocks.ops).toHaveLength(1)
    expect(blocks.ops[0].uri).toBe(uri(TASK))
    expect(blocks.ops[0].afterMarkdown).toContain('depends-on')
    expect(blocks.ops[0].afterMarkdown).toContain(uri(REQ))
  })

  it('stores related-to on the smaller URI and guards implements kinds', () => {
    const related = translateMaintenanceOpsToHarness([
      {
        ...baseOp('op-rel'),
        type: 'add-relation',
        tempRelationId: 'tmp-rel-3',
        after: { sourceNodeId: TASK, targetNodeId: REQ, relationType: 'related-to' },
      },
    ] as unknown as BlueprintOperation[], ctx)
    expect(related.complete).toBe(true)
    // 1111... sorts before 2222..., so the requirement note owns the edge.
    expect(related.ops[0].uri).toBe(uri(REQ))

    const badImpl = translateMaintenanceOpsToHarness([
      {
        ...baseOp('op-impl-bad'),
        type: 'add-relation',
        tempRelationId: 'tmp-rel-4',
        after: { sourceNodeId: REQ, targetNodeId: TASK, relationType: 'implements' },
      },
    ] as unknown as BlueprintOperation[], ctx)
    expect(badImpl.complete).toBe(false)
    expect(badImpl.untranslatable[0].reason).toContain('task source')

    const dup = translateMaintenanceOpsToHarness([
      {
        ...baseOp('op-dup-a'),
        type: 'add-relation',
        tempRelationId: 'tmp-rel-5',
        after: { sourceNodeId: TASK, targetNodeId: REQ, relationType: 'depends-on' },
      },
      {
        ...baseOp('op-dup-b'),
        type: 'add-relation',
        tempRelationId: 'tmp-rel-6',
        after: { sourceNodeId: TASK, targetNodeId: REQ, relationType: 'depends-on' },
      },
    ] as unknown as BlueprintOperation[], ctx)
    expect(dup.complete).toBe(false)
    expect(dup.untranslatable.map((u) => u.operationId)).toEqual(['op-dup-b'])
    expect(dup.untranslatable[0].reason).toContain('already exists')
    expect(dup.ops.map((o) => o.operationId)).toEqual(['op-dup-a'])

    const described = translateMaintenanceOpsToHarness([
      {
        ...baseOp('op-desc'),
        type: 'add-relation',
        tempRelationId: 'tmp-rel-7',
        after: { sourceNodeId: TASK, targetNodeId: REQ, relationType: 'depends-on', description: 'because reasons' },
      },
    ] as unknown as BlueprintOperation[], ctx)
    expect(described.complete).toBe(false)
    expect(described.untranslatable[0].reason).toContain('no edge equivalent')
  })

  it('updates and removes projected edges by synthetic id', () => {
    const seeded = new Map(NOTES)
    const taskWithEdge = TASK_MD.replace('created: 2026-09-17\n---', `created: 2026-09-17\nrelations:\n  - type: depends-on\n    target: ${uri(REQ)}\n---`)
    seeded.set(TASK, taskWithEdge)
    const localCtx = {
      repoId: REPO,
      resolveNote: (nodeId: string) => {
        const markdown = seeded.get(nodeId)
        if (!markdown) return null
        return { uri: uri(nodeId), expectedHash: sha256HexBytes(Buffer.from(markdown, 'utf8')), markdown }
      },
    }
    const relId = `${TASK}:depends-on:${REQ}`

    const updated = translateMaintenanceOpsToHarness([
      { ...baseOp('op-rel-upd'), type: 'update-relation', relationId: relId, before: {}, after: { relationType: 'related-to' } },
    ] as unknown as BlueprintOperation[], localCtx)
    expect(updated.complete).toBe(false)
    // 1111... sorts before 2222..., so related-to must refuse the owner change.
    expect(updated.untranslatable.map((u) => u.operationId)).toEqual(['op-rel-upd'])
    expect(updated.untranslatable[0].reason).toContain('owner change')

    const removed = translateMaintenanceOpsToHarness([
      { ...baseOp('op-rel-del'), type: 'remove-relation', relationId: relId },
    ] as unknown as BlueprintOperation[], localCtx)
    expect(removed.complete).toBe(true)
    expect(removed.ops).toHaveLength(1)
    expect(removed.ops[0].afterMarkdown).not.toContain('depends-on')

    const missing = translateMaintenanceOpsToHarness([
      { ...baseOp('op-rel-miss'), type: 'remove-relation', relationId: `${TASK}:depends-on:${DECISION}` },
    ] as unknown as BlueprintOperation[], localCtx)
    expect(missing.complete).toBe(false)
    expect(missing.untranslatable[0].reason).toContain('not found')
  })

  it('archives in place and downgrades deletes explicitly', () => {
    const result = translateMaintenanceOpsToHarness([
      { ...baseOp('op-arch'), type: 'archive-node', nodeId: DECISION, beforeStatus: 'in-progress' },
      { ...baseOp('op-del'), type: 'delete-node', nodeId: REQ, risk: 'high', impact: { title: 'Requirement one', parentId: null, childIds: [], incomingRelationIds: [], outgoingRelationIds: [] } },
    ] as unknown as BlueprintOperation[], ctx)

    expect(result.complete).toBe(true)
    expect(result.ops).toHaveLength(2)
    for (const op of result.ops) {
      expect(op.type).toBe('replace')
      expect(op.afterMarkdown).toContain('lifecycle: archived')
      expect(op.afterMarkdown).toContain('disposition:')
    }
    expect(result.ops[0].downgraded).toBeUndefined()
    expect(result.ops[1].downgraded).toBe('archive-for-delete')
  })

  it('restores archived notes and checks snapshot edges', () => {
    const archived = DECISION_MD
      .replace('lifecycle: accepted', 'lifecycle: archived')
      .replace('created: 2026-09-17\n---', 'created: 2026-09-17\ndisposition:\n  reason: stale\n---')
    const seeded = new Map(NOTES)
    seeded.set(DECISION, archived)
    const localCtx = {
      repoId: REPO,
      resolveNote: (nodeId: string) => {
        const markdown = seeded.get(nodeId)
        if (!markdown) return null
        return { uri: uri(nodeId), expectedHash: sha256HexBytes(Buffer.from(markdown, 'utf8')), markdown }
      },
    }
    const restored = translateMaintenanceOpsToHarness([
      {
        ...baseOp('op-restore'),
        type: 'restore-node',
        nodeId: DECISION,
        node: { id: DECISION, status: 'in-progress' },
        relations: [],
      },
    ] as unknown as BlueprintOperation[], localCtx)
    expect(restored.complete).toBe(true)
    expect(restored.ops[0].afterMarkdown).toContain('lifecycle: accepted')
    expect(restored.ops[0].afterMarkdown).not.toContain('disposition:')

    const withEdges = translateMaintenanceOpsToHarness([
      {
        ...baseOp('op-restore-edges'),
        type: 'restore-node',
        nodeId: DECISION,
        node: { id: DECISION, status: 'in-progress' },
        relations: [{ id: 'rel-9', sourceNodeId: DECISION, targetNodeId: REQ, type: 'depends-on' }],
      },
    ] as unknown as BlueprintOperation[], localCtx)
    expect(withEdges.complete).toBe(false)
    expect(withEdges.untranslatable[0].reason).toContain('snapshot edges missing')
  })

  it('refuses bindings and self parents', () => {
    const result = translateMaintenanceOpsToHarness([
      {
        ...baseOp('op-bind'),
        type: 'update-workspace-binding',
        nodeId: REQ,
        before: { primaryWorkspaceId: null, linkedWorkspaceIds: [] },
        after: { primaryWorkspaceId: 'ws-1', linkedWorkspaceIds: [] },
      },
      { ...baseOp('op-self'), type: 'move-node', nodeId: REQ, beforeParentId: null, afterParentId: REQ },
    ] as unknown as BlueprintOperation[], ctx)

    expect(result.complete).toBe(false)
    expect(result.ops).toHaveLength(0)
    expect(result.untranslatable.map((u) => u.operationId)).toEqual(['op-bind', 'op-self'])
    expect(result.untranslatable[0].reason).toContain('local-only')
  })

  it('maps dependencies onto harness ids and cascades refusals', () => {
    const result = translateMaintenanceOpsToHarness([
      { ...baseOp('op-a'), type: 'archive-node', nodeId: DECISION, beforeStatus: 'in-progress' },
      { ...baseOp('op-b', { dependsOn: ['op-a'] }), type: 'archive-node', nodeId: REQ, beforeStatus: 'in-progress' },
      { ...baseOp('op-c', { dependsOn: ['op-bad'] }), type: 'archive-node', nodeId: TASK, beforeStatus: 'not-started' },
    ] as unknown as BlueprintOperation[], ctx)

    expect(result.complete).toBe(false)
    const byId = new Map(result.ops.map((o) => [o.operationId, o]))
    expect(byId.get('op-b')?.dependsOn).toEqual(['op-a'])
    expect(result.untranslatable.map((u) => u.operationId)).toEqual(['op-c'])
    expect(result.untranslatable[0].reason).toContain('unknown dependency')

    const cycle = translateMaintenanceOpsToHarness([
      { ...baseOp('op-x', { dependsOn: ['op-y'] }), type: 'archive-node', nodeId: DECISION, beforeStatus: 'in-progress' },
      { ...baseOp('op-y', { dependsOn: ['op-x'] }), type: 'archive-node', nodeId: REQ, beforeStatus: 'in-progress' },
    ] as unknown as BlueprintOperation[], ctx)
    expect(cycle.complete).toBe(false)
    expect(cycle.ops).toHaveLength(0)
    expect(cycle.untranslatable.map((u) => u.operationId).sort()).toEqual(['op-x', 'op-y'])
  })
})
