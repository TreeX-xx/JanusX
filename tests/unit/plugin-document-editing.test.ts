import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, writeFile, readFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { saveEditorText } from '../../src/main/lib/editor-save'
import { invalidateEditorFileCache, useEditorStore } from '../../src/renderer/src/stores/editor'

const hash = (text: string) => createHash('sha256').update(text).digest('hex')
const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); vi.unstubAllGlobals() })
async function disk() {
  const directory = await mkdtemp(join(tmpdir(), 'janusx-draft-'))
  cleanups.push(() => rm(directory, { recursive: true, force: true }))
  const path = join(directory, 'a.txt'); await writeFile(path, 'disk')
  const save = (content: string, version = hash('disk')) => saveEditorText(path, content, version, () => writeFile(path, content))
  return { path, save }
}
describe('host-reviewed document draft saves', () => {
  it('serializes competing editor saves against a baseline and advances the successful version', async () => {
    const f = await disk()
    const [first, second] = await Promise.all([f.save('first'), f.save('second')])
    expect(first).toEqual({ success: true, version: hash('first') })
    expect(second).toMatchObject({ conflict: true })
    expect(await readFile(f.path, 'utf8')).toBe('first')
    expect(await f.save('third', first.version)).toMatchObject({ success: true, version: hash('third') })
  })
  it('rejects externally changed, missing and linked files without invoking the writer', async () => {
    const f = await disk(); const writer = vi.fn(async () => {})
    await writeFile(f.path, 'external')
    expect(await saveEditorText(f.path, 'draft', hash('disk'), writer)).toMatchObject({ conflict: true })
    await rm(f.path)
    expect(await saveEditorText(f.path, 'draft', hash('disk'), writer)).toMatchObject({ conflict: true })
    const target = `${f.path}.target`; await writeFile(target, 'disk'); await symlink(target, f.path)
    expect(await saveEditorText(f.path, 'draft', hash('disk'), writer)).toMatchObject({ conflict: true })
    expect(writer).not.toHaveBeenCalled(); expect(await readFile(target, 'utf8')).toBe('disk')
  })
})

describe('host-owned plugin drafts', () => {
  const root = 'C:/drafts'; const id = 'c:/drafts/a.txt'
  beforeEach(async () => {
    invalidateEditorFileCache()
    useEditorStore.setState({ workspacePath: null, sessions: {}, openFiles: [], activeFileId: null, isVisible: false })
    vi.stubGlobal('window', { electron: { file: {
      read: vi.fn(async () => ({ content: 'disk' })), save: vi.fn(async () => ({ success: true, version: hash('draft') })),
    } } })
    await useEditorStore.getState().openFile('C:/drafts/a.txt', root)
  })
  const state = () => useEditorStore.getState()
  it('rejects stale and competing buffers; transfers accepted draft and baseline across scopes and detach', async () => {
    expect(state().applyPluginDraft(id, 'stale', 'draft', hash('disk'), 'plugin/view')).toBe(false)
    expect(state().applyPluginDraft(id, 'disk', 'draft', hash('disk'), 'plugin/view')).toBe(true)
    expect(state().applyPluginDraft(id, 'disk', 'second', hash('disk'), 'plugin/view')).toBe(false)
    state().switchScope('C:/other'); state().switchScope(root)
    const session = structuredClone(state().exportSession())
    state().releaseScope(root)
    await state().acceptDelivery({ filePath: 'C:/drafts/a.txt', workspacePath: root, session })
    expect(state().openFiles[0]).toMatchObject({ content: 'draft', isDirty: true, saveVersion: hash('disk'), pluginDraftViewer: 'plugin/view' })
    expect(window.electron.file.save).not.toHaveBeenCalled()
    expect(await state().saveFile(id)).toBe(true)
    expect(window.electron.file.save).toHaveBeenCalledWith('C:/drafts/a.txt', 'draft', hash('disk'))
    expect(state().openFiles[0]).toMatchObject({ isDirty: false, saveVersion: hash('draft') })
  })
  it('keeps conflicts visible without hiding the draft behind a load error', async () => {
    state().applyPluginDraft(id, 'disk', 'draft', hash('disk'), 'plugin/view')
    vi.mocked(window.electron.file.save).mockResolvedValueOnce({ conflict: true, error: 'DOCUMENT_CONFLICT' })
    expect(await state().saveFile(id)).toBe(false)
    expect(state().openFiles[0]).toMatchObject({ content: 'draft', isDirty: true, saveConflict: true, externalChanged: true, saveVersion: hash('disk') })
    expect(state().openFiles[0].error).toBeUndefined()
  })
  it('retains edits made during save, advances their baseline and updates a background scope', async () => {
    state().applyPluginDraft(id, 'disk', 'draft', hash('disk'), 'plugin/view')
    let finish!: (value: { success: boolean; version: string }) => void
    vi.mocked(window.electron.file.save).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const saving = state().saveFile(id)
    state().updateContent(id, 'newer draft'); state().switchScope('C:/other')
    finish({ success: true, version: hash('draft') }); expect(await saving).toBe(true)
    state().switchScope(root)
    expect(state().openFiles[0]).toMatchObject({ content: 'newer draft', isDirty: true, saveVersion: hash('draft') })
  })
})
