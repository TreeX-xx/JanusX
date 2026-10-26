// Note: .agents/notes/planning/blueprint-official-plugin.md
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { parseNote } from '@janus-agent/harness-core'
import { afterEach, expect, it } from 'vitest'
import { registerHarnessDocumentHandlers, type DocumentHandler } from '../../src/main/harness/document-handlers'
import { harnessNoteService } from '../../src/main/harness/service'
import { HARNESS_COMMAND_CHANNELS as channels } from '../../src/shared/ipc/harness'

const roots: string[] = []
const content = (raw: string) => { const note = parseNote(raw); delete note.meta.updated; return note }
afterEach(async () => {
  harnessNoteService.unwatchAll()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

it('initializes, resolves, reads, moves, shares and undoes Notes without Blueprint', async () => {
  const root = await mkdtemp(join(tmpdir(), 'document-detach-')); roots.push(root)
  const handlers = new Map<string, DocumentHandler>()
  registerHarnessDocumentHandlers((channel, handler) => handlers.set(channel, handler))
  const event = { sender: { id: 4, once: () => undefined } }
  const call = async (channel: string, ...args: unknown[]) => {
    try { return await handlers.get(channel)!(event, root, ...args) }
    catch (error) { if (error && typeof error === 'object') Object.assign(error, { message: `${channel}: ${(error as Error).message}` }); throw error }
  }
  expect((await call(channels.workspaceStatus)).state).toBe('not-found')
  const preview = await call(channels.initPreview, 'Plain Notes')
  await call(channels.initApply, preview.id, false)
  const resolved = await call(channels.resolve)
  expect(resolved).toMatchObject({ ok: true, repoName: 'Plain Notes' })
  expect((await call(channels.workspaceStatus)).projectId).toBe(resolved.repoId)
  const snapshot = await call(channels.noteSnapshot)
  const uri = `note://${resolved.repoId}/${randomUUID()}`
  await harnessNoteService.applyOperations(root, [{ operationId: 'create-fixture', type: 'create', uri, expectedHash: null,
    relativePath: 'document.md', afterMarkdown: `---\n${JSON.stringify({ schema: 'harness-note/2', id: uri.split('/').at(-1),
      kind: 'note', lifecycle: 'draft', created: '2026-10-26', updated: '2026-10-26T00:00:00Z', module: snapshot.entries[0].uri })}\n---\n# Document\n\nShared content.\n` }], 'Create document')
  const original = await call(channels.noteRead, uri)
  await expect(call(channels.projectGraph)).rejects.toThrow('BLUEPRINT_PLUGIN_REQUIRED')
  await expect(call(channels.apply, [{ kind: 'create', title: 'Old canvas' }], 'legacy')).rejects.toThrow('BLUEPRINT_PLUGIN_REQUIRED')
  const moved = await call(channels.apply, [{ kind: 'rename', uri, expectedHash: original.sourceHash, relativePath: 'renamed.md' }], 'Move Note')
  const source = await call(channels.noteRead, uri)
  expect(source.relPath).toBe('.agents/notes/renamed.md')
  expect(content(source.raw)).toEqual(content(original.raw))
  const shared = await call(channels.sharePreview, { ids: [uri.split('/').at(-1)] })
  expect(shared.notes).toBe(1)
  expect((await call(channels.undoPreview, moved.txId)).reversible).toBe(true)
  expect(content(await readFile(join(root, source.relPath), 'utf8'))).toEqual(content(original.raw))
  const archive = await call(channels.apply, [{ kind: 'archive', uri, expectedHash: source.sourceHash, reason: 'Archive fixture' }], 'Archive')
  expect((await call(channels.noteRead, uri)).doc.metadata.lifecycle).toBe('archived')
  await expect(call(channels.apply, [{ kind: 'archive', uri, expectedHash: original.sourceHash, reason: 'stale' }], 'Stale edit')).rejects.toMatchObject({ code: 'HARNESS_CONFLICT' })
  await call(channels.undoApply, archive.txId)
  expect(content((await call(channels.noteRead, uri)).raw)).toEqual(content(original.raw))
})
