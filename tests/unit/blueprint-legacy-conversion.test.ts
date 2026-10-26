import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, expect, it } from 'vitest'
import { applyHarnessInit, previewHarnessInit, NoteService } from '@janus-agent/harness-node'
import { LegacyBlueprints } from '../../plugins/blueprint/src/main/notes/legacy-blueprints'
import { makeNode } from '../../plugins/blueprint/src/main/janus/blueprint-factory'
import type { Blueprint } from '../../plugins/blueprint/src/shared/janus/types'

const cleanup: string[] = []
afterEach(async () => { for (const root of cleanup.splice(0)) await rm(root, { recursive: true, force: true }) })
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'blueprint-conversion-')); cleanup.push(directory)
  const root = join(directory, 'project'), data = join(directory, 'data')
  await mkdir(root); await mkdir(join(data, 'legacy'), { recursive: true })
  await applyHarnessInit(await previewHarnessInit(root, 'Target project'))
  const node = makeNode({ title: 'Historical work', type: 'task', description: 'Preserve this exact requirement.', status: 'done' })
  const blueprint = { schemaVersion: 4, id: 'old-board', name: 'Old board', source: 'json', description: '', nodeIds: [node.id], nodes: { [node.id]: node },
    rootNodeId: node.id, relations: [], requirementCandidates: [], canvasLayout: {}, collapsedNodeIds: null, contentRevision: 1 } as unknown as Blueprint
  const file = join(data, 'legacy/old-board.json'), raw = JSON.stringify(blueprint)
  await writeFile(file, raw)
  const notes = new NoteService(), converter = new LegacyBlueprints(data, notes)
  return { root, data, file, raw, notes, converter }
}

it('previews without writing, commits the exact preview identities and archives only the plugin copy', async () => {
  const f = await fixture(), before = await f.notes.readSnapshot(f.root)
  expect(await f.converter.list()).toMatchObject([{ id: 'old-board', name: 'Old board', nodes: 1 }])
  const preview = await f.converter.preview(f.root, 'old-board', 1)
  expect(preview.documents.some(document => document.markdown.includes('Preserve this exact requirement.'))).toBe(true)
  expect((await f.notes.readSnapshot(f.root)).entries).toEqual(before.entries)
  expect(await readFile(f.file, 'utf8')).toBe(f.raw)
  const result = await f.converter.apply(f.root, preview.token, 1)
  expect(result.uris).toEqual([...preview.notes.map(note => note.uri), result.reportUri])
  expect(await readFile(result.archivedPath, 'utf8')).toBe(f.raw)
  expect(await f.converter.list()).toEqual([])
  const snapshot = await f.notes.readSnapshot(f.root)
  expect(snapshot.entries.filter(entry => entry.doc?.kind === 'task')).toEqual([])
  expect(snapshot.entries.some(entry => entry.doc?.body.includes('Preserve this exact requirement.'))).toBe(true)
  await expect(f.converter.apply(f.root, preview.token, 1)).rejects.toMatchObject({ code: 'NOT_READY' })
})

it('rejects changed sources, foreign owners, expired pages and path traversal without writing', async () => {
  const f = await fixture(), preview = await f.converter.preview(f.root, 'old-board', 1)
  await expect(f.converter.apply(f.root, preview.token, 2)).rejects.toMatchObject({ code: 'NOT_READY' })
  await writeFile(f.file, f.raw + '\n')
  await expect(f.converter.apply(f.root, preview.token, 1)).rejects.toMatchObject({ code: 'RESOURCE_CHANGED' })
  await writeFile(f.file, f.raw)
  f.converter.release(1)
  await expect(f.converter.apply(f.root, preview.token, 1)).rejects.toMatchObject({ code: 'NOT_READY' })
  await expect(f.converter.preview(f.root, '../old-board', 1)).rejects.toMatchObject({ code: 'INVALID_REQUEST' })
  expect((await f.notes.readSnapshot(f.root)).entries).toHaveLength(1)
})

it('refuses replay after a committed conversion even when an interrupted archive leaves the source available', async () => {
  const f = await fixture(), preview = await f.converter.preview(f.root, 'old-board', 1)
  await f.converter.apply(f.root, preview.token, 1)
  await writeFile(f.file, f.raw)
  const reopened = new LegacyBlueprints(f.data, new NoteService()), again = await reopened.preview(f.root, 'old-board', 3)
  await f.notes.rescan(f.root)
  const before = await f.notes.readSnapshot(f.root)
  await expect(reopened.apply(f.root, again.token, 3)).rejects.toMatchObject({ code: 'RECOVERY_REQUIRED' })
  expect(await readFile(f.file, 'utf8')).toBe(f.raw)
  await f.notes.rescan(f.root)
  const after = await f.notes.readSnapshot(f.root)
  const sources = (snapshot: typeof before) => snapshot.entries.map(({ uri, relPath, sourceHash }) => ({ uri, relPath, sourceHash }))
  expect(sources(after)).toEqual(sources(before))
})
