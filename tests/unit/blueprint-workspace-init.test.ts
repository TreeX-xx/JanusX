import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyHarnessInit, previewHarnessInit, hasNoteMutationIntent, acquireLock, releaseLock } from '@janus-agent/harness-node'
import { parseNote } from '@janus-agent/harness-core'
import { BlueprintNoteService as HarnessNoteService } from '../../plugins/blueprint/src/main/notes/service'
import { WorkspaceBlueprintService } from '../../plugins/blueprint/src/main/notes/workspace-blueprint'
import { WorkspaceSuggestionSources } from '../../plugins/blueprint/src/main/blueprint/suggestions/sources'
import zh from '../../src/renderer/src/i18n/locales/zh-CN/blueprint.json'
import en from '../../src/renderer/src/i18n/locales/en/blueprint.json'

let root: string
let notes: HarnessNoteService
let service: WorkspaceBlueprintService
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'blueprint-init-'))
  notes = new HarnessNoteService()
  service = new WorkspaceBlueprintService(notes)
})
afterEach(async () => { notes.unwatchAll(); await rm(root, { recursive: true, force: true }) })

describe('workspace blueprint initialization', () => {
  it('shares the cold index across startup warmup, status, projection and review sources', async () => {
    await applyHarnessInit(await previewHarnessInit(root, 'Concurrent'))
    const sources = new WorkspaceSuggestionSources(notes)
    const context = await sources.context(root)
    const scans = vi.spyOn(notes, 'rescan')
    const [warm, status, projection, review] = await Promise.all([notes.warmup(root), service.status(root), notes.projectView(root), sources.capture(context, [])])
    expect(status.state).toBe('ok')
    expect(projection.blueprint.nodeIds).toHaveLength(1)
    expect(scans).toHaveBeenCalledTimes(1)
    expect(warm.rev).toBe(projection.rev)
    expect(review.complete).toBe(true)
    expect(review.notes.map(note => note.noteId)).toEqual(projection.blueprint.nodeIds)
    const again = await notes.warmup(root)
    expect(again.rev).toBe(warm.rev)
    expect(scans).toHaveBeenCalledTimes(1)
  })

  it('preserves a busy lock diagnostic and retries successfully after release', async () => {
    await applyHarnessInit(await previewHarnessInit(root, 'Busy'))
    const lock = await acquireLock(root)
    try {
      const result = await service.status(root)
      expect(result).toMatchObject({ state: 'error', diagnostics: [{ code: 'BUSY', message: 'notes busy: lock held' }] })
    } finally { await releaseLock(root, lock) }
    expect((await service.status(root)).state).toBe('ok')
  })

  it('loads the current workspace even when a bound foreign checkout is busy', async () => {
    await applyHarnessInit(await previewHarnessInit(root, 'Main'))
    const dependency = join(root, 'dependency')
    await mkdir(dependency)
    await applyHarnessInit(await previewHarnessInit(dependency, 'Dependency'))
    const identity = JSON.parse(await readFile(join(dependency, '.agents/harness.json'), 'utf8'))
    vi.spyOn(notes, 'getBindings').mockResolvedValue([{ repoId: identity.repoId, checkoutId: 'dependency', path: dependency, selected: true }])
    const lock = await acquireLock(dependency)
    try { expect((await notes.projectView(root)).blueprint.composition?.checkouts).toEqual([]) }
    finally { await releaseLock(dependency, lock) }
    const view = await notes.projectView(root)
    expect(view.blueprint.composition?.checkouts).toEqual([])
    expect(view.blueprint.nodeIds).toHaveLength(1)
  })
  it('previews without writing, applies a draft and projects it, then undoes the exact files', async () => {
    expect((await service.status(root)).state).toBe('not-found')
    const preview = await service.preview(root, '示例项目', 1)
    expect(await readdir(root)).toEqual([])
    expect(preview.files).toHaveLength(2)
    expect(parseNote(preview.files[1].content).meta).toMatchObject({ kind: 'module', lifecycle: 'draft', moduleState: 'planned', role: 'project' })
    await service.apply(root, preview.id, 1, false)
    expect((await service.status(root)).state).toBe('ok')
    const graph = await notes.projectView(root)
    expect(graph.blueprint.nodeIds).toHaveLength(1)
    expect(Object.values(graph.blueprint.nodes)[0].title).toBe('示例项目')
    await service.apply(root, preview.id, 1, false)
    await service.undo(root, preview.id, 1)
    expect((await service.status(root)).state).toBe('not-found')
  })

  it('keeps existing identities byte-for-byte and distinguishes an initialized empty project', async () => {
    const plan = await previewHarnessInit(root, 'Existing')
    await applyHarnessInit(plan)
    const identity = await readFile(join(root, '.agents/harness.json'), 'utf8')
    await rm(join(root, plan.files[1].path))
    expect((await service.status(root)).state).toBe('empty')
    await expect(service.preview(root, 'Replacement', 1)).rejects.toThrow('not available')
    expect(await readFile(join(root, '.agents/harness.json'), 'utf8')).toBe(identity)
  })

  it('exposes invalid-only diagnostics and blocks initialization', async () => {
    const plan = await previewHarnessInit(root, 'Invalid')
    await applyHarnessInit(plan)
    await writeFile(join(root, plan.files[1].path), '---\nschema: harness-note/1\n---\n# Broken', 'utf8')
    const status = await service.status(root)
    expect(status.state).toBe('invalid')
    expect(status.diagnostics.length).toBeGreaterThan(0)
    await expect(service.preview(root, 'Invalid', 1)).rejects.toThrow('not available')
  })

  it('requires explicit confirmation for foreign files and preserves their bytes', async () => {
    await mkdir(join(root, '.agents'), { recursive: true })
    await writeFile(join(root, '.agents/custom.txt'), 'keep me', 'utf8')
    expect((await service.status(root)).state).toBe('foreign')
    const preview = await service.preview(root, 'Foreign', 1)
    await expect(service.apply(root, preview.id, 1, false)).rejects.toThrow('Confirm')
    await service.apply(root, preview.id, 1, true)
    expect(await readFile(join(root, '.agents/custom.txt'), 'utf8')).toBe('keep me')
    await service.undo(root, preview.id, 1)
    expect((await service.status(root)).state).toBe('foreign')
  })

  it('binds previews to their window and checkout', async () => {
    const preview = await service.preview(root, 'Owned', 1)
    await expect(service.apply(root, preview.id, 2, false)).rejects.toThrow('expired')
    await expect(service.apply(join(root, 'other'), preview.id, 1, false)).rejects.toThrow('expired')
    expect(await readdir(root)).toEqual([])
  })

  it('rejects a second preview after another initializer wins', async () => {
    const first = await service.preview(root, 'First', 1)
    const second = await service.preview(root, 'Second', 1)
    await service.apply(root, first.id, 1, false)
    await expect(service.apply(root, second.id, 1, false)).rejects.toThrow('changed')
    expect(JSON.parse(await readFile(join(root, '.agents/harness.json'), 'utf8')).name).toBe('First')
  })

  it('refuses undo when generated files have changed', async () => {
    const preview = await service.preview(root, 'Edited', 1)
    await service.apply(root, preview.id, 1, false)
    await writeFile(join(root, preview.files[1].path), preview.files[1].content + '\nUser edit\n')
    await expect(service.undo(root, preview.id, 1)).rejects.toThrow('CONFLICT')
    expect(await readFile(join(root, preview.files[1].path), 'utf8')).toContain('User edit')
  })

  it('shows missing directories as read failures, not initialization opportunities', async () => {
    const status = await service.status(join(root, 'missing'))
    expect(status.state).toBe('error')
    expect(status.diagnostics[0].message).toContain('ENOENT')
  })

  it('keeps an applied initialization undoable if refreshing the index fails', async () => {
    const preview = await service.preview(root, 'Refresh failure', 1)
    const rescan = vi.spyOn(notes, 'rescan').mockRejectedValueOnce(new Error('Index unavailable'))
    await expect(service.apply(root, preview.id, 1, false)).resolves.toEqual({ refreshError: 'Index unavailable' })
    rescan.mockRestore()
    await service.undo(root, preview.id, 1)
    expect((await service.status(root)).state).toBe('not-found')
  })

  it('refuses undo after additional Notes are created', async () => {
    const preview = await service.preview(root, 'More Notes', 1)
    await service.apply(root, preview.id, 1, false)
    await writeFile(join(root, '.agents/notes/additional.md'), '# Preserve this work')
    await expect(service.undo(root, preview.id, 1)).rejects.toThrow('additional Notes')
    expect(await readFile(join(root, '.agents/notes/additional.md'), 'utf8')).toBe('# Preserve this work')
  })

  it('starts generation as a read-only proposal in both supported languages', () => {
    expect(hasNoteMutationIntent(zh.workspace.draftPrompt)).toBe(false)
    expect(hasNoteMutationIntent(en.workspace.draftPrompt)).toBe(false)
  })
})
