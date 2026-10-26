import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { applyHarnessInit, previewHarnessInit } from '@janus-agent/harness-node'
import { HarnessNoteService } from '../../src/main/harness/service'
import { BlueprintNoteProjection } from '../../plugins/blueprint/src/main/notes/projection'

// Note: .agents/notes/planning/blueprint-official-plugin.md - desktop projections share the owning Note index and transaction.
let root: string
let notes: HarnessNoteService
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'shared-note-service-'))
  await applyHarnessInit(await previewHarnessInit(root, 'Shared notes'))
  notes = new HarnessNoteService()
})
afterEach(async () => {
  notes.unwatchAll()
  await rm(root, { recursive: true, force: true })
})

it('shares one cold index with an optional projection and keeps later warmups on the same revision', async () => {
  const scans = vi.spyOn(notes, 'rescan')
  const projection = new BlueprintNoteProjection(notes)
  const [warm, snapshot, view] = await Promise.all([notes.warmup(root), notes.readSnapshot(root), projection.projectView(root)])
  expect(scans).toHaveBeenCalledTimes(1)
  expect(warm.rev).toBe(view.rev)
  expect(view.blueprint.nodeIds).toEqual(snapshot.entries.filter(entry => entry.doc).map(entry => entry.doc!.id))
  expect((await notes.warmup(root)).rev).toBe(warm.rev)
  expect(scans).toHaveBeenCalledTimes(1)
  expect('projectView' in notes).toBe(false)
})

it('observes external edits and uses the shared transaction conflict check before projecting new bytes', async () => {
  const projection = new BlueprintNoteProjection(notes)
  const snapshot = await notes.readSnapshot(root)
  const entry = snapshot.entries.find(entry => entry.doc)!
  const original = await notes.readNote(root, entry.uri!)
  const before = await notes.getRev(root)
  const file = join(root, entry.relPath)
  const external = original.raw + '\nExternal update.\n'
  await writeFile(file, external, 'utf8')
  const changed = await notes.readSnapshot(root)
  expect(await notes.getRev(root)).toBe(before + 1)
  expect(changed.entries.find(item => item.uri === entry.uri)?.sourceHash).not.toBe(original.sha256)
  await expect(notes.applyOperations(root, [{ operationId: 'stale', type: 'replace', uri: entry.uri!,
    expectedHash: original.sha256, afterMarkdown: original.raw }], 'stale edit')).rejects.toMatchObject({ code: 'HARNESS_CONFLICT' })
  expect(await readFile(file, 'utf8')).toBe(external)
  const current = await notes.readNote(root, entry.uri!)
  await notes.applyOperations(root, [{ operationId: 'current', type: 'replace', uri: entry.uri!,
    expectedHash: current.sha256, afterMarkdown: external + '\nReviewed update.\n' }], 'reviewed edit')
  const view = await projection.projectView(root)
  expect(view.rev).toBe(await notes.getRev(root))
  expect(view.blueprint.nodes[entry.doc!.id].sourceHash).toBe((await notes.readNote(root, entry.uri!)).sha256)
})

it('releases a failed shared cold read so the next request can retry', async () => {
  const failure = new Error('temporary read failure')
  const scans = vi.spyOn(notes, 'rescan').mockRejectedValueOnce(failure)
  const failed = await Promise.allSettled([notes.readSnapshot(root), notes.readIndex(root)])
  expect(failed).toEqual([{ status: 'rejected', reason: failure }, { status: 'rejected', reason: failure }])
  expect(scans).toHaveBeenCalledTimes(1)
  expect((await notes.readSnapshot(root)).entries.some(entry => entry.doc)).toBe(true)
  expect(scans).toHaveBeenCalledTimes(2)
})
