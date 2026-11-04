import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { classifyFile } from '../../src/renderer/src/lib/file-classification'
import { invalidateEditorFileCache, useEditorStore } from '../../src/renderer/src/stores/editor'

beforeEach(() => {
  invalidateEditorFileCache()
  useEditorStore.setState({ openFiles: [], activeFileId: null })
  vi.stubGlobal('window', { electron: { file: {
    stat: vi.fn(async () => ({ size: 100 })),
    readBinary: vi.fn(async () => ({ base64: 'JVBERg==', size: 100 })),
    save: vi.fn(), read: vi.fn(),
  } } })
})
afterEach(() => vi.unstubAllGlobals())
it('opens PDF bytes and rejects text saves even through a shortcut', async () => {
  expect(classifyFile('report.PDF').viewerType).toBe('pdf')
  await useEditorStore.getState().openFile('C:/report.PDF')
  const file = useEditorStore.getState().openFiles[0]
  expect(file).toMatchObject({ viewType: 'pdf', base64: 'JVBERg==', isLoading: false })
  expect(await useEditorStore.getState().saveFile(file.id)).toBe(false)
  expect(window.electron.file.save).not.toHaveBeenCalled()
  expect(window.electron.file.read).not.toHaveBeenCalled()
})
it('rejects an oversized PDF before transferring binary content', async () => {
  vi.mocked(window.electron.file.stat).mockResolvedValue({ size: 17 * 1024 * 1024 })
  await useEditorStore.getState().openFile('C:/large.pdf')
  expect(useEditorStore.getState().openFiles[0].error).toContain('16 MiB')
  expect(window.electron.file.readBinary).not.toHaveBeenCalled()
})
