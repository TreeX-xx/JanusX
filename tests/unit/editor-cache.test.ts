import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  closeEditorFilesUnderPath, getEditorFileId, invalidateEditorFileCache,
  remapEditorPaths, useEditorStore,
} from '../../src/renderer/src/stores/editor'

const workspace = 'C:/workspace'
const editor = () => useEditorStore.getState()
const file = () => editor().openFiles[0]
const path = (id: string) => `${workspace}/${id}.ts`
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(complete => { resolve = complete })
  return { promise, resolve }
}

describe('bounded editor disk snapshot cache', () => {
  beforeEach(() => {
    invalidateEditorFileCache()
    useEditorStore.setState({ openFiles: [], activeFileId: null, isVisible: false })
    vi.stubGlobal('window', { electron: { file: {
      read: vi.fn(async (path: string) => ({ content: `disk:${path}`, mtime: 1 })),
      readBinary: vi.fn(async () => ({ base64: 'image', mimeType: 'image/png', mtime: 1 })),
      save: vi.fn(async () => ({ success: true })),
    } } })
  })
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

  it('keeps a remote read version through close/reopen and sends it on save', async () => {
    const root = 'janusx-workspace://remote/project'
    const remote = root + '/%E4%BD%A0%E5%A5%BD.ts'
    vi.mocked(window.electron.file.read).mockResolvedValue({ content: 'before', version: 'a'.repeat(64) })
    await editor().openFile(remote, root)
    expect(file().name).toBe('你好.ts')
    editor().closeFile(file().id)
    await editor().openFile(remote, root)
    editor().updateContent(file().id, 'after')
    await editor().saveFile(file().id)
    expect(window.electron.file.save).toHaveBeenCalledWith(remote, 'after', 'a'.repeat(64))
  })

  it('reuses a small clean closed file and the newly saved content', async () => {
    await editor().openFile(path('small'), workspace)
    const id = file().id
    editor().closeFile(id)
    await editor().openFile(path('small'), workspace)
    expect(window.electron.file.read).toHaveBeenCalledTimes(1)
    editor().updateContent(id, 'saved edit')
    expect(await editor().saveFile(id)).toBe(true)
    editor().closePanel()
    await editor().openFile(path('small'), workspace)
    expect(file()).toMatchObject({ content: 'saved edit', isDirty: false })
    expect(window.electron.file.read).toHaveBeenCalledTimes(1)
  })

  it('evicts least recently used payloads under the total budget and retains recent files', async () => {
    vi.mocked(window.electron.file.read).mockImplementation(async p => ({ content: p + 'x'.repeat(600_000) }))
    for (let index = 0; index < 20; index++) {
      await editor().openFile(path(String(index)), workspace)
      editor().closeFile(file().id)
    }
    await editor().openFile(path('19'), workspace)
    expect(window.electron.file.read).toHaveBeenCalledTimes(20)
    editor().closeFile(file().id)
    await editor().openFile(path('0'), workspace)
    expect(window.electron.file.read).toHaveBeenCalledTimes(21)
    expect(file().content).toBe(path('0') + 'x'.repeat(600_000))
  })

  it('bounds metadata for many tiny closed files', async () => {
    for (let index = 0; index < 140; index++) {
      await editor().openFile(path(String(index)), workspace)
      editor().closeFile(file().id)
    }
    await editor().openFile(path('139'), workspace)
    expect(window.electron.file.read).toHaveBeenCalledTimes(140)
    await editor().openFile(path('0'), workspace)
    expect(window.electron.file.read).toHaveBeenCalledTimes(141)
  })

  it('refreshes recency on cache hits so a frequently reopened file survives eviction', async () => {
    vi.mocked(window.electron.file.read).mockImplementation(async p => ({ content: p + 'x'.repeat(600_000) }))
    for (let index = 0; index < 20; index++) {
      await editor().openFile(path(String(index)), workspace)
      editor().closePanel()
      await editor().openFile(path('0'), workspace)
      editor().closePanel()
    }
    expect(window.electron.file.read).toHaveBeenCalledTimes(20)
  })

  it.each(['large.ts', 'large.png'])('does not retain oversized closed payloads: %s', async name => {
    vi.mocked(window.electron.file.read).mockResolvedValue({ content: 'x'.repeat(1_100_000) })
    vi.mocked(window.electron.file.readBinary).mockResolvedValue({ base64: 'a'.repeat(1_100_000), mimeType: 'image/png' })
    await editor().openFile(`${workspace}/${name}`, workspace)
    expect((file().content || file().base64)!.length).toBe(1_100_000)
    editor().closeFile(file().id)
    await editor().openFile(`${workspace}/${name}`, workspace)
    expect(name.endsWith('png') ? window.electron.file.readBinary : window.electron.file.read).toHaveBeenCalledTimes(2)
  })

  it('keeps open unsaved content intact under eviction pressure and never caches discarded drafts', async () => {
    await editor().openFile(path('draft'), workspace)
    const id = file().id
    editor().updateContent(id, 'unsaved draft')
    vi.mocked(window.electron.file.read).mockResolvedValue({ content: 'x'.repeat(600_000) })
    for (let index = 0; index < 20; index++) {
      await editor().openFile(path(String(index)), workspace)
      editor().closeFile(getEditorFileId(path(String(index))))
    }
    expect(file()).toMatchObject({ id, content: 'unsaved draft', isDirty: true })
    // UI confirmation owns the user's discard choice; closeFile must not cache it.
    editor().closeFile(id)
    vi.mocked(window.electron.file.read).mockResolvedValue({ content: 'disk version' })
    await editor().openFile(path('draft'), workspace)
    expect(file()).toMatchObject({ content: 'disk version', isDirty: false })
  })

  it('respects workspace invalidation without evicting unrelated workspaces', async () => {
    await editor().openFile(path('a'), workspace)
    editor().closePanel()
    await editor().openFile('D:/other/b.ts', 'D:/other')
    editor().closePanel()
    invalidateEditorFileCache(workspace)
    vi.mocked(window.electron.file.read).mockResolvedValue({ content: 'changed on disk' })
    await editor().openFile('D:/other/b.ts', 'D:/other')
    expect(window.electron.file.read).toHaveBeenCalledTimes(2)
    await editor().openFile(path('a'), workspace)
    expect(window.electron.file.read).toHaveBeenCalledTimes(3)
    expect(editor().openFiles[0].content).toBe('changed on disk')
  })

  it('invalidates deleted and renamed paths, including clean tabs cached by close', async () => {
    await editor().openFile(path('deleted'), workspace)
    closeEditorFilesUnderPath(path('deleted'))
    await editor().openFile(path('deleted'), workspace)
    expect(window.electron.file.read).toHaveBeenCalledTimes(2)
    editor().closePanel()
    remapEditorPaths(path('deleted'), path('renamed'), workspace)
    await editor().openFile(path('renamed'), workspace)
    expect(file().content).toBe(`disk:${path('renamed')}`)
    expect(window.electron.file.read).toHaveBeenCalledTimes(3)
    editor().closePanel()
    await editor().openFile(path('deleted'), workspace)
    expect(window.electron.file.read).toHaveBeenCalledTimes(4)
  })

  it('does not cache an in-flight load after its tab is closed', async () => {
    const read = deferred<{ content: string }>()
    vi.mocked(window.electron.file.read).mockReturnValueOnce(read.promise)
    const opening = editor().openFile(path('loading'), workspace)
    editor().closePanel()
    read.resolve({ content: 'old read' })
    await opening
    expect(editor().openFiles).toHaveLength(0)
    await editor().openFile(path('loading'), workspace)
    expect(window.electron.file.read).toHaveBeenCalledTimes(2)
    expect(file().content).toBe(`disk:${path('loading')}`)
  })

  it('does not let an invalidated request remove or overwrite a newer load', async () => {
    const first = deferred<{ content: string }>()
    const second = deferred<{ content: string }>()
    vi.mocked(window.electron.file.read).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const opening = editor().openFile(path('race'), workspace)
    invalidateEditorFileCache(workspace)
    const reloading = editor().reloadOpenFile(path('race'))
    first.resolve({ content: 'stale' })
    await opening
    expect(file().isLoading).toBe(true)
    const anotherReload = editor().reloadOpenFile(path('race'))
    expect(window.electron.file.read).toHaveBeenCalledTimes(2)
    second.resolve({ content: 'latest' })
    await Promise.all([reloading, anotherReload])
    expect(file()).toMatchObject({ content: 'latest', isLoading: false })
  })

  it('preserves edits made during a reload and keeps the saved disk version after closing during save', async () => {
    await editor().openFile(path('editing'), workspace)
    const id = file().id
    const read = deferred<{ content: string }>()
    vi.mocked(window.electron.file.read).mockReturnValueOnce(read.promise)
    const reloading = editor().reloadOpenFile(path('editing'))
    editor().updateContent(id, 'draft during reload')
    read.resolve({ content: 'external disk' })
    await reloading
    expect(file()).toMatchObject({ content: 'draft during reload', isDirty: true })
    const save = deferred<{ success: boolean }>()
    vi.mocked(window.electron.file.save).mockReturnValueOnce(save.promise)
    const saving = editor().saveFile(id)
    editor().closePanel()
    save.resolve({ success: true })
    expect(await saving).toBe(true)
    await editor().openFile(path('editing'), workspace)
    expect(file()).toMatchObject({ content: 'draft during reload', isDirty: false })
    expect(window.electron.file.read).toHaveBeenCalledTimes(2)
  })

  it('does not repopulate an invalidated cache merely by closing the tab', async () => {
    await editor().openFile(path('external'), workspace)
    invalidateEditorFileCache(workspace)
    editor().closePanel()
    vi.mocked(window.electron.file.read).mockResolvedValue({ content: 'new disk content' })
    await editor().openFile(path('external'), workspace)
    expect(file().content).toBe('new disk content')
    expect(window.electron.file.read).toHaveBeenCalledTimes(2)
  })

  it('does not cache read failures or let an old read failure replace a successful reload', async () => {
    let reject!: (error: Error) => void
    vi.mocked(window.electron.file.read).mockReturnValueOnce(new Promise((_resolve, fail) => { reject = fail }))
    const opening = editor().openFile(path('failure'), workspace)
    invalidateEditorFileCache(workspace)
    await editor().reloadOpenFile(path('failure'))
    reject(new Error('old read failed'))
    await opening
    expect(file()).toMatchObject({ content: `disk:${path('failure')}`, isLoading: false })
    expect(file().error).toBeUndefined()
  })
})
