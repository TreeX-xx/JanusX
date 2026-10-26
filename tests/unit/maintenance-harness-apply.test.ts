import { LEGACY_HARNESS_PROFILE as SUPPORTED_HARNESS_PROFILE } from '@janus-agent/harness-node';
import { promises as fs } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BlueprintNoteService as HarnessNoteService } from '../../plugins/blueprint/src/main/notes/service'
import {
  applyMaintenanceSelection,
  applyPreparedMaintenanceSelection,
  prepareMaintenanceSelection,
  assertHarnessScope,
  resolveProjectCheckout,
} from '../../plugins/blueprint/src/main/notes/maintenance-apply'
import { translateMaintenanceOpsToHarness } from '../../plugins/blueprint/src/main/notes/maintenance-bridge'
import type { BlueprintOperation } from '../../plugins/blueprint/src/shared/janus/maintenance-types'

const REPO = '8fa19f17-c717-43a8-93a7-810a5e0cbc91'
const REQ = '11111111-1111-4111-8111-111111111111'
const TASK = '22222222-2222-4222-8222-222222222222'

const REQUIREMENT_MD = [
  '---',
  'schema: harness-note/1',
  `id: ${REQ}`,
  'kind: requirement',
  'lifecycle: accepted',
  'created: 2026-09-17',
  '---',
  '',
  '# Requirement one',
  '',
  '## Problem',
  '',
  'The widget fails.',
  '',
  '## Expected behavior',
  '',
  'It works.',
  '',
  '## Scope',
  '',
  'Widget only.',
  '',
  '## Acceptance criteria',
  '',
  '- [ ] AC-1: widget works',
  '',
].join('\n')

const TASK_MD = [
  '---',
  'schema: harness-note/1',
  `id: ${TASK}`,
  'kind: task',
  'lifecycle: draft',
  'created: 2026-09-17',
  '---',
  '',
  '# Task one',
  '',
  '## Scope',
  '',
  'Do the thing.',
  '',
  '## Acceptance criteria',
  '',
  '- [ ] AC-1: thing done',
  '',
  '## Verification',
  '',
  'Run the checks.',
  '',
].join('\n')

async function makeRoot(): Promise<string> {
  const root = await fs.mkdtemp(join(tmpdir(), 'harness-apply-s6-'))
  await fs.mkdir(join(root, '.agents', 'notes'), { recursive: true })
  await fs.writeFile(
    join(root, '.agents', 'harness.json'),
    JSON.stringify({ schemaVersion: 1, repoId: REPO, name: 'Apply', profile: SUPPORTED_HARNESS_PROFILE }),
  )
  await fs.writeFile(join(root, '.agents', 'notes', '2026-09-17-req--11111111.md'), REQUIREMENT_MD)
  await fs.writeFile(join(root, '.agents', 'notes', '2026-09-17-task--22222222.md'), TASK_MD)
  return root
}

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) {
    await fs.rm(root, { recursive: true, force: true })
  }
})

function updateTitleOp(nodeId: string, title: string, operationId = 'm-update-1'): BlueprintOperation {
  return {
    operationId,
    type: 'update-node',
    nodeId,
    before: {},
    after: { title },
    reason: 'retitle',
    evidenceRefs: [],
    dependsOn: [],
    risk: 'low',
  }
}

describe('maintenance harness apply wiring (S6-c slice 2b)', () => {
  it('previews real files without writing and applies the exact prepared bytes and created identity', async () => {
    const svc = new HarnessNoteService()
    const root = await makeRoot()
    roots.push(root)
    const operations: BlueprintOperation[] = [updateTitleOp(REQ, 'Reviewed heading'), {
      operationId: 'new', type: 'create-node', tempNodeId: 'new-note', parentId: REQ,
      after: { title: 'Reviewed idea', type: 'issue', description: 'A reviewed idea.', positioning: '', techSolution: '', notes: '', tags: [] },
      reason: 'Record the idea', evidenceRefs: [], dependsOn: [], risk: 'low',
    }]
    const prepared = await prepareMaintenanceSelection(svc, { root, repoId: REPO, operations, taskId: 'preview', changeSetVersion: 1, reason: 'Review' })
    expect(prepared.files).toHaveLength(2)
    expect(prepared.files[0]).toMatchObject({ path: '.agents/notes/2026-09-17-req--11111111.md', before: REQUIREMENT_MD })
    expect((await fs.readdir(join(root, '.agents/notes')))).toHaveLength(2)
    expect((await svc.readNote(root, REQ)).raw).toBe(REQUIREMENT_MD)
    const result = await applyPreparedMaintenanceSelection(svc, prepared)
    expect(result.createdNodeIds['new-note']).toBe(prepared.bridge.createdNodeIds['new-note'])
    for (const file of prepared.files) expect(await fs.readFile(join(root, file.path), 'utf8')).toBe(file.after)
  })

  it('refuses preview drift or cancellation before applying any selected file', async () => {
    const svc = new HarnessNoteService()
    const root = await makeRoot()
    roots.push(root)
    const prepared = await prepareMaintenanceSelection(svc, {
      root, repoId: REPO, operations: [updateTitleOp(REQ, 'Reviewed'), updateTitleOp(TASK, 'Other', 'other')],
      taskId: 'preview', changeSetVersion: 1, reason: 'Review',
    })
    await expect(applyPreparedMaintenanceSelection(svc, prepared, () => { throw new Error('Cancelled workspace') })).rejects.toThrow('Cancelled workspace')
    expect((await svc.readNote(root, REQ)).raw).toBe(REQUIREMENT_MD)
    const changed = REQUIREMENT_MD.replace('The widget fails.', 'Edited externally.')
    await fs.writeFile(join(root, prepared.files[0].path), changed)
    await expect(applyPreparedMaintenanceSelection(svc, prepared)).rejects.toThrow('HARNESS_CONFLICT')
    expect((await svc.readNote(root, TASK)).raw).toBe(TASK_MD)
    expect(await fs.readFile(join(root, prepared.files[0].path), 'utf8')).toBe(changed)
  })

  it('applies an update plus a create through one transaction with created ids', async () => {
    const svc = new HarnessNoteService()
    const root = await makeRoot()
    roots.push(root)
    const result = await applyMaintenanceSelection(svc, {
      root,
      repoId: REPO,
      operations: [
        updateTitleOp(REQ, 'Requirement one, retitled'),
        {
          operationId: 'm-create-1',
          type: 'create-node',
          tempNodeId: 'tmp-new',
          parentId: REQ,
          after: {
            title: 'Child idea',
            type: 'issue',
            description: 'd',
            positioning: '',
            techSolution: '',
            notes: '',
            tags: [],
          },
          reason: 'capture',
          evidenceRefs: [],
          dependsOn: [],
          risk: 'low',
        },
      ],
      taskId: 'task-1',
      changeSetVersion: 1,
      reason: 'test apply',
    })
    expect(result.appliedMaintenanceIds).toContain('m-update-1')
    expect(result.appliedMaintenanceIds).toContain('m-create-1')
    const createdIds = Object.values(result.createdNodeIds)
    expect(createdIds).toHaveLength(1)
    const bytes = await fs.readFile(join(root, '.agents', 'notes', '2026-09-17-req--11111111.md'), 'utf8')
    expect(bytes).toContain('# Requirement one, retitled')
    const view = await svc.projectView(root)
    expect(view.blueprint.nodes[REQ]?.title).toBe('Requirement one, retitled')
    expect(view.blueprint.nodes[createdIds[0]]?.title).toBe('Child idea')
    expect(view.blueprint.nodes[createdIds[0]]?.parentId).toBe(REQ)
  })

  it('refuses an untranslatable selection with zero bytes written', async () => {
    const svc = new HarnessNoteService()
    const root = await makeRoot()
    roots.push(root)
    const before = await fs.readFile(join(root, '.agents', 'notes', '2026-09-17-req--11111111.md'), 'utf8')
    await expect(
      applyMaintenanceSelection(svc, {
        root,
        repoId: REPO,
        operations: [
          {
            operationId: 'm-bad-1',
            type: 'update-node',
            nodeId: REQ,
            before: {},
            after: { features: [{ id: 'f1', title: 'F', description: '', progress: 0, status: 'planned', requirementNotes: [], createdAt: '', updatedAt: '' }] },
            reason: 'features have no note equivalent',
            evidenceRefs: [],
            dependsOn: [],
            risk: 'low',
          } as BlueprintOperation,
        ],
        taskId: 'task-1',
        changeSetVersion: 1,
        reason: 'test refusal',
      }),
    ).rejects.toThrow('未写入任何内容')
    const after = await fs.readFile(join(root, '.agents', 'notes', '2026-09-17-req--11111111.md'), 'utf8')
    expect(after).toBe(before)
  })

  it('records created relation ids with the final edge type', async () => {
    const svc = new HarnessNoteService()
    const root = await makeRoot()
    roots.push(root)
    const result = await applyMaintenanceSelection(svc, {
      root,
      repoId: REPO,
      operations: [
        {
          operationId: 'm-rel-1',
          type: 'add-relation',
          tempRelationId: 'tmp-rel-1',
          after: { sourceNodeId: TASK, targetNodeId: REQ, relationType: 'depends-on' },
          reason: 'order',
          evidenceRefs: [],
          dependsOn: [],
          risk: 'low',
        },
      ],
      taskId: 'task-1',
      changeSetVersion: 1,
      reason: 'test relation',
    })
    const view = await svc.projectView(root)
    expect(view.blueprint.relations.find((r) => r.id === result.createdRelationIds['tmp-rel-1']))
      .toMatchObject({ sourceNodeId: TASK, targetNodeId: REQ, type: 'depends-on' })
    await applyMaintenanceSelection(svc, {
      root, repoId: REPO, taskId: 'task-undo-relation', changeSetVersion: 1, reason: 'Undo relation',
      operations: [{ operationId: 'remove', type: 'remove-relation', relationId: result.createdRelationIds['tmp-rel-1'],
        reason: 'undo', evidenceRefs: [], dependsOn: [], risk: 'medium' }],
    })
    expect((await svc.projectView(root)).blueprint.relations).toEqual([])
  })

  it('downgrades delete to archive instead of removing the file', async () => {
    const svc = new HarnessNoteService()
    const root = await makeRoot()
    roots.push(root)
    await applyMaintenanceSelection(svc, {
      root,
      repoId: REPO,
      operations: [
        {
          operationId: 'm-del-1',
          type: 'delete-node',
          nodeId: REQ,
          reason: 'drop',
          evidenceRefs: [],
          dependsOn: [],
          risk: 'high',
          impact: { childIds: [], incomingRelationIds: [], outgoingRelationIds: [], title: 'Requirement one' },
        } as BlueprintOperation,
      ],
      taskId: 'task-1',
      changeSetVersion: 1,
      reason: 'test delete downgrade',
    })
    const bytes = await fs.readFile(join(root, '.agents', 'notes', '2026-09-17-req--11111111.md'), 'utf8')
    expect(bytes).toContain('lifecycle: archived')
    const view = await svc.projectView(root)
    expect(view.blueprint.nodes[REQ]?.status).toBe('archived')
  })

  it('resolves checkouts by preferred path, reports unknown ids, and refuses ambiguous scans', async () => {
    const svc = new HarnessNoteService()
    const root = await makeRoot()
    roots.push(root)
    const view = await svc.projectView(root)
    const hit = await resolveProjectCheckout(svc, view.blueprint.id, root)
    expect(hit.repoId).toBe(REPO)
    expect(hit.root).toBe(root)
    await expect(resolveProjectCheckout(svc, 'harness:project:deadbeef', root)).rejects.toThrow('找不到项目 Note 的本机 checkout')
    const twin = await makeRoot()
    roots.push(twin)
    const twinView = await svc.projectView(twin)
    expect(twinView.blueprint.id).not.toBe(view.blueprint.id)
    await expect(resolveProjectCheckout(svc, view.blueprint.id, twin, async () => [root, twin]))
      .rejects.toThrow('checkout')
    // E0-1 ids identify one checkout; equal repository identity is not ambiguity.
    await expect(resolveProjectCheckout(svc, view.blueprint.id, undefined, async () => [root, twin])).resolves.toMatchObject({ root })
    // Still reject a real id collision instead of silently choosing a writer.
    const projectView = vi.spyOn(svc, 'projectView').mockImplementation(async candidate =>
      candidate === twin ? { ...twinView, blueprint: { ...twinView.blueprint, id: view.blueprint.id } } : view,
    )
    await expect(resolveProjectCheckout(svc, view.blueprint.id, undefined, async () => [root, twin])).rejects.toThrow(
      '多个本机 checkout',
    )
    projectView.mockRestore()
  })

  it('keeps the node-scope gate: out-of-scope writes fail before translating', () => {
    expect(() =>
      assertHarnessScope([updateTitleOp('99999999-9999-4999-8999-999999999999', 'Elsewhere')], new Set([REQ])),
    ).toThrow('维护节点范围外禁止写入')
    expect(() => assertHarnessScope([updateTitleOp(REQ, 'Inside')], new Set([REQ]))).not.toThrow()
  })

  it('checks the owner scope of opaque composition relation ids', async () => {
    const svc = new HarnessNoteService()
    const root = await makeRoot()
    roots.push(root)
    await applyMaintenanceSelection(svc, { root, repoId: REPO, taskId: 'scope', changeSetVersion: 1, reason: 'Setup edge', operations: [{
      operationId: 'add', type: 'add-relation', tempRelationId: 'temp-edge', after: { sourceNodeId: TASK, targetNodeId: REQ, relationType: 'depends-on' },
      reason: 'Order', evidenceRefs: [], dependsOn: [], risk: 'medium',
    }] })
    const { blueprint } = await svc.projectView(root)
    const operation: BlueprintOperation = { operationId: 'remove', type: 'remove-relation', relationId: blueprint.relations[0].id,
      reason: 'Remove edge', evidenceRefs: [], dependsOn: [], risk: 'medium' }
    expect(() => assertHarnessScope([operation], new Set([REQ]), blueprint)).toThrow('维护节点范围外禁止写入')
    expect(() => assertHarnessScope([operation], new Set([TASK]), blueprint)).not.toThrow()
  })

  it('lets the transaction reject a source edit after translation without overwriting it', async () => {
    const svc = new HarnessNoteService()
    const root = await makeRoot()
    roots.push(root)
    const hash = (await svc.readNote(root, REQ)).sha256
    const apply = svc.applyBundleChangeSet.bind(svc)
    const changed = REQUIREMENT_MD + '\nConcurrent source edit.\n'
    vi.spyOn(svc, 'applyBundleChangeSet').mockImplementationOnce(async (...args) => {
      await fs.writeFile(join(root, '.agents', 'notes', '2026-09-17-req--11111111.md'), changed)
      return apply(...args)
    })
    await expect(applyMaintenanceSelection(svc, { root, repoId: REPO, taskId: 'race', changeSetVersion: 1, reason: 'Proposed edit',
      sourceHashes: { [REQ]: hash }, operations: [updateTitleOp(REQ, 'Approved title')] })).rejects.toMatchObject({ code: 'HARNESS_CONFLICT' })
    expect((await svc.readNote(root, REQ)).raw).toBe(changed)
  })

  it('exposes created mappings for undo bookkeeping', async () => {
    const svc = new HarnessNoteService()
    const root = await makeRoot()
    roots.push(root)
    const view = await svc.projectView(root)
    expect(view.repoId).toBe(REPO)
    const snapshots = new Map<string, { uri: string; expectedHash: string; markdown: string }>()
    for (const nodeId of view.blueprint.nodeIds) {
      const read = await svc.readNote(root, nodeId)
      snapshots.set(nodeId, { uri: `note://${REPO}/${nodeId}`, expectedHash: read.sha256, markdown: read.raw })
    }
    const bridge = translateMaintenanceOpsToHarness(
      [
        {
          operationId: 'm-create-1',
          type: 'create-node',
          tempNodeId: 'tmp-undo',
          parentId: REQ,
          after: {
            title: 'Undo target',
            type: 'issue',
            description: '',
            positioning: '',
            techSolution: '',
            notes: '',
            tags: [],
          },
          reason: 'capture',
          evidenceRefs: [],
          dependsOn: [],
          risk: 'low',
        },
      ],
      { repoId: REPO, resolveNote: (nodeId: string) => snapshots.get(nodeId) ?? null },
    )
    expect(bridge.complete).toBe(true)
    expect(Object.keys(bridge.createdNodeIds)).toEqual(['tmp-undo'])
  })
})
