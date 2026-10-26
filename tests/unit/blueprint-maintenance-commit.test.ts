// Note: .agents/notes/blueprint/maintenance/blueprint-maintenance-approval-gap.md — a graph read cannot change a committed write into a failed apply.
import { afterEach, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SUPPORTED_HARNESS_PROFILE } from '@janus-agent/harness-node'
import { ChatSessionRuntime } from '@janus-agent/chat-core'
import { BlueprintNoteService } from '../../plugins/blueprint/src/main/notes/service'
import { BlueprintMaintenanceService } from '../../plugins/blueprint/src/main/janus/maintenance/service'

const roots: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

it('finishes one confirmed write without a post-commit graph read or repeat submission', async () => {
  const root = await mkdtemp(join(tmpdir(), 'blueprint-direct-commit-')); roots.push(root)
  await mkdir(join(root, '.agents/notes'), { recursive: true })
  const repoId = randomUUID(), noteId = randomUUID(), conversationId = randomUUID()
  await writeFile(join(root, '.agents/harness.json'), JSON.stringify({ schemaVersion: 1, repoId, name: 'Direct commit', profile: SUPPORTED_HARNESS_PROFILE }))
  const notePath = join(root, '.agents/notes/module.md')
  const original = '---\n' + JSON.stringify({ schema: 'harness-note/2', id: noteId, kind: 'module', lifecycle: 'accepted',
    role: 'project', moduleState: 'partial', created: '2026-10-27', updated: '2026-10-27T00:00:00Z' }, null, 2) +
    '\n---\n# Direct commit\n\n## Responsibility\nStore Notes.\n\n## Design\nOriginal design.\n'
  await writeFile(notePath, original)
  const notes = new BlueprintNoteService(), view = await notes.projectView(root)
  const service = new BlueprintMaintenanceService({ notes, workspaces: async () => [{ id: 'project', path: root }], changed() {},
    models: {
      select: async () => ({ providerId: 'fixture', modelId: 'fixture', contextWindow: 262144, maxOutputTokens: 8192 }),
      generate: async ({ schema }) => ({ object: schema.parse({ summary: 'Clarify design', operations: [{ operationId: 'clarify', type: 'update-node',
        nodeId: noteId, reason: 'Approved clarification', evidenceRefs: [], dependsOn: [], risk: 'low', after: { sections: { Design: 'Confirmed design.' } } }] }) }),
    },
    store: { loadBlueprint: async () => null, applyMaintenanceOperations: async () => { throw new Error('Unexpected legacy write') } },
  })
  const task = await service.start({ blueprintId: view.blueprint.id, workspaceId: 'project', workspacePath: root,
    workspaceName: 'Direct commit', conversationId, goal: 'Clarify design', nodeScope: { type: 'blueprint' } })
  const proposal = await service.proposeForConversation({ taskId: task.id, conversationId, providerId: 'fixture', modelId: 'fixture',
    signal: new AbortController().signal, chatSession: new ChatSessionRuntime(), workspaceIds: ['project'], workspaceRoots: { project: root },
    messages: [{ role: 'user', content: 'Clarify the design.' }] })
  const selection = { taskId: task.id, changeSetId: proposal.changeSet!.id, operationIds: ['clarify'] }
  const preview = await service.preview({ ...selection, conversationId, workspaceId: 'project', workspacePath: root })
  expect(await readFile(notePath, 'utf8')).toBe(original)
  let committed = false
  const projectView = notes.projectView.bind(notes), applyBundle = notes.applyBundleChangeSet.bind(notes)
  const projections = vi.spyOn(notes, 'projectView').mockImplementation(path => {
    if (committed) throw new Error('IO_ERROR: graph temporarily unreadable')
    return projectView(path)
  })
  const writes = vi.spyOn(notes, 'applyBundleChangeSet').mockImplementation(async (...args) => {
    const result = await applyBundle(...args)
    committed = true
    return result
  })
  const result = await service.apply({ ...selection, previewId: preview.id })
  expect(result.task).toMatchObject({ status: 'active', changeSet: null, progress: 100 })
  expect(result.appliedOperationIds).toEqual(['clarify'])
  expect(await readFile(notePath, 'utf8')).toContain('Confirmed design.')
  expect(writes).toHaveBeenCalledTimes(1)
  expect(projections.mock.results.every(result => result.type === 'return')).toBe(true)
  const transactions = await readdir(join(root, '.agents/.local/transactions'))
  await expect(service.apply({ ...selection, previewId: preview.id })).rejects.toThrow()
  expect(writes).toHaveBeenCalledTimes(1)
  expect(await readdir(join(root, '.agents/.local/transactions'))).toEqual(transactions)
})
