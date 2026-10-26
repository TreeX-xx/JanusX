import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NoteReadingService } from '../../plugins/blueprint/src/main/blueprint/note-reading'
import { WorkspaceSuggestionSources } from '../../plugins/blueprint/src/main/blueprint/suggestions/sources'
import { SUPPORTED_HARNESS_PROFILE } from '@janus-agent/harness-core'
import type { ReviewContext, ReviewSourceSnapshot } from '../../plugins/blueprint/src/shared/blueprint-review'

const roots: string[] = []
const context: ReviewContext = { repoId: '11111111-1111-4111-8111-111111111111', workspacePath: 'C:/fixture', branch: 'refs/heads/main' }
const id = '22222222-2222-4222-8222-222222222222'
const hash = (text: string) => text.repeat(64)
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'note-reading-')); roots.push(root)
  const path = join(root, 'reading.json')
  let time = Date.now()
  const snapshot: ReviewSourceSnapshot = { context, complete: true, unavailablePaths: [], evidence: {}, notes: [
    { noteId: id, hash: hash('a'), path: '.agents/notes/module.md', kind: 'module', lifecycle: 'accepted' },
  ] }
  const sources = { capture: async (current: ReviewContext) => structuredClone({ ...snapshot, context: current }), bytes: async () => Buffer.alloc(0) }
  const service = () => new NoteReadingService(path, sources, () => time)
  return { path, snapshot, sources, service, advance: () => { time += 9000 } }
}
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

describe('local Note reading', () => {
  it('discovers external edits and archived ideas through the production source reader without a watcher', async () => {
    const root = await mkdtemp(join(tmpdir(), 'note-reading-')); roots.push(root)
    await mkdir(join(root, '.agents/notes'), { recursive: true })
    await writeFile(join(root, '.agents/harness.json'), JSON.stringify({ schemaVersion: 1, repoId: context.repoId, profile: SUPPORTED_HARNESS_PROFILE }))
    const note = (body: string) => '---\n' + JSON.stringify({ schema: 'harness-note/2', id, kind: 'module', role: 'project', lifecycle: 'accepted', moduleState: 'partial', created: '2026-10-10', updated: '2026-10-10T00:00:00Z' }) + '\n---\n# Module\n\n' + body
    const file = join(root, '.agents/notes/module.md'), state = join(root, 'reading.json')
    await writeFile(file, note('Initial'))
    const sources = new WorkspaceSuggestionSources(), actual = await sources.context(root)
    try {
      expect((await new NoteReadingService(state, sources).read(actual)).entries[0].unread).toBe(false)
      await writeFile(file, note('Edited while Janus was closed'))
      const reopened = new NoteReadingService(state, sources)
      expect((await reopened.read(actual)).entries[0].unread).toBe(true)
      const ideaId = '33333333-3333-4333-8333-333333333333'
      await writeFile(join(root, '.agents/notes/idea.md'), '---\n' + JSON.stringify({ schema: 'harness-note/2', id: ideaId, kind: 'idea', lifecycle: 'archived', disposition: { reason: 'Exploration complete' }, module: `note://${context.repoId}/${id}`, created: '2026-10-10', updated: '2026-10-10T00:00:00Z' }) + '\n---\n# Archived idea\n\n## Intent\n\nOriginal idea')
      const updates = await reopened.read(actual)
      expect(updates).toMatchObject({ ready: true, complete: true })
      expect(updates.entries.find(entry => entry.noteId === ideaId)).toMatchObject({ unread: true, change: 'added' })
      await expect(reopened.mark({ ...actual, branch: 'refs/heads/other' }, updates.entries)).rejects.toThrow('changed')
    } finally { sources.notes.unwatchAll() }
  })
  it('silently establishes a baseline, discovers offline updates after restart and counts one version per Note', async () => {
    const f = await fixture(), first = f.service()
    expect((await first.read(context)).entries[0].unread).toBe(false)
    f.snapshot.notes[0].hash = hash('b')
    f.snapshot.notes[0].hash = hash('c')
    const reopened = f.service(), changed = await reopened.read(context)
    expect(changed.entries).toHaveLength(1)
    expect(changed.entries[0]).toMatchObject({ hash: hash('c'), unread: true, change: 'modified' })
    await reopened.mark(context, [changed.entries[0]])
    expect((await f.service().read(context)).entries[0].unread).toBe(false)
    f.snapshot.notes[0].hash = hash('d')
    expect((await reopened.read(context)).entries[0].unread).toBe(true)
  })
  it('preserves changes arriving after a bulk click and undoes only that acknowledgement', async () => {
    const f = await fixture(), service = f.service()
    await service.read(context); f.snapshot.notes[0].hash = hash('b')
    const clicked = (await service.read(context)).entries
    f.snapshot.notes[0].hash = hash('c')
    const result = await service.mark(context, clicked, true)
    expect(result.updates.entries[0].unread).toBe(true)
    await service.revert(result.undoToken!)
    expect((await service.read(context)).entries[0].unread).toBe(true)
    f.snapshot.notes[0].hash = hash('a')
    expect((await service.read(context)).entries[0].unread).toBe(false)
  })
  it('does not undo a later deliberate read, even of the same version', async () => {
    const f = await fixture(), service = f.service()
    await service.read(context); f.snapshot.notes[0].hash = hash('b')
    const clicked = (await service.read(context)).entries
    const result = await service.mark(context, clicked, true)
    await service.mark(context, clicked)
    await service.revert(result.undoToken!)
    expect((await service.read(context)).entries[0].unread).toBe(false)
    await service.mark(context, [{ ...clicked[0], hash: hash('a') }])
    expect((await service.read(context)).entries[0].unread).toBe(false)
  })
  it('requires an initial baseline but acknowledges readable selected versions in an incomplete corpus', async () => {
    const f = await fixture(), service = f.service()
    f.snapshot.complete = false
    expect(await service.read(context)).toMatchObject({ ready: false, complete: false, entries: [] })
    await expect(service.mark(context, f.snapshot.notes, true)).rejects.toThrow('incomplete')
    f.snapshot.complete = true
    expect((await service.read(context)).entries[0].unread).toBe(false)
    f.snapshot.notes[0].hash = hash('b')
    const versions = (await service.read(context)).entries
    f.snapshot.complete = false
    const result = await service.mark(context, versions, true)
    expect(result.updates).toMatchObject({ complete: false, entries: [{ unread: false }] })
    await service.revert(result.undoToken!)
    expect((await service.read(context)).entries[0].unread).toBe(true)
    f.snapshot.notes = []
    const saved = await readFile(f.path, 'utf8')
    await expect(service.mark(context, versions, true)).rejects.toThrow('selected Notes')
    expect(await readFile(f.path, 'utf8')).toBe(saved)
    expect((await service.read(context)).entries[0]).toMatchObject({ unread: true, available: false })
  })

  it('does not partially acknowledge a batch if one selected identity is unavailable', async () => {
    const f = await fixture(), service = f.service()
    f.snapshot.notes.push({ ...f.snapshot.notes[0], noteId: '33333333-3333-4333-8333-333333333333', path: '.agents/notes/other.md' })
    await service.read(context)
    for (const note of f.snapshot.notes) note.hash = hash('b')
    const versions = (await service.read(context)).entries
    f.snapshot.notes.pop(); f.snapshot.complete = false
    const saved = await readFile(f.path, 'utf8')
    await expect(service.mark(context, versions, true)).rejects.toThrow('selected Notes')
    expect(await readFile(f.path, 'utf8')).toBe(saved)
    expect((await service.readSaved(context)).entries.every(entry => entry.unread)).toBe(true)
  })
  it('tracks every Note kind and retains identity across moves', async () => {
    const f = await fixture(), service = f.service()
    await service.read(context)
    f.snapshot.notes[0].path = '.agents/notes/moved.md'
    const moved = await service.read(context)
    expect(moved.entries[0]).toMatchObject({ unread: true, change: 'moved' })
    f.snapshot.notes.push({ ...f.snapshot.notes[0], noteId: '33333333-3333-4333-8333-333333333333', kind: 'task', lifecycle: 'archived' })
    expect((await service.read(context)).entries[1]).toMatchObject({ unread: true, change: 'added' })
    f.snapshot.notes = []
    expect((await service.read(context)).entries).toEqual([])
  })
  it('keeps branch and checkout baselines isolated', async () => {
    const f = await fixture(), service = f.service()
    await service.read(context); f.snapshot.notes[0].hash = hash('b')
    const branch = { ...context, branch: 'refs/heads/feature' }
    expect((await service.read(branch)).entries[0].unread).toBe(false)
    expect((await service.read({ ...context, workspacePath: 'C:/second' })).entries[0].unread).toBe(false)
    expect((await service.read(context)).entries[0].unread).toBe(true)
  })
  it('expires undo and never masks corrupt persistence as an empty baseline', async () => {
    const f = await fixture(), service = f.service()
    const baseline = await service.read(context)
    const result = await service.mark(context, baseline.entries, true)
    f.advance()
    await expect(service.revert(result.undoToken!)).rejects.toThrow('expired')
    const saved = JSON.parse(await readFile(f.path, 'utf8'))
    expect(saved.contexts).toBeTruthy()
    await writeFile(f.path, '{broken')
    await expect(f.service().read(context)).rejects.toThrow()
    expect(await readFile(f.path, 'utf8')).toBe('{broken')
  })
})


it('observes a host-verified write without scanning or losing unrelated rows, and rejects an older observation', async () => {
  const f = await fixture(), service = f.service()
  f.snapshot.notes.push({ ...f.snapshot.notes[0], noteId: '33333333-3333-4333-8333-333333333333', path: '.agents/notes/other.md' })
  const initial = await service.read(context)
  const capture = vi.spyOn(f.sources, 'capture')
  const epoch = service.observationEpoch, old = structuredClone(f.snapshot)
  const version = { noteId: id, hash: hash('b'), path: '.agents/notes/module.md' }
  const changed = await service.observeVersion(context, version)
  expect(changed.entries[0]).toMatchObject({ hash: hash('b'), unread: true })
  expect(changed.revision).toBeGreaterThan(initial.revision)
  expect(changed.entries[1]).toEqual(initial.entries[1])
  expect(capture).not.toHaveBeenCalled()
  expect(f.snapshot.notes[0].hash).toBe(hash('a'))
  const afterOld = await service.read(context, old, undefined, epoch)
  expect(afterOld.entries[0]).toMatchObject({ hash: hash('b'), unread: true })
  expect(afterOld.revision).toBe(changed.revision)
  const foreign = { ...context, branch: 'other' }
  expect(await service.observeVersion(foreign, version)).toMatchObject({ ready: false, entries: [] })
})
