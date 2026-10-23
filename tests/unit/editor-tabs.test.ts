import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  invalidateEditorFileCache,
  useEditorStore,
} from '../../src/renderer/src/stores/editor'

describe('file editor tabs', () => {
  beforeEach(() => {
    invalidateEditorFileCache()
    useEditorStore.setState({
      workspacePath: null,
      sessions: {},
      openFiles: [],
      activeFileId: null,
      isVisible: false,
      isEmbedded: false,
      embeddedWidth: 560,
      navigationTarget: null,
    })
    vi.stubGlobal('window', {
      electron: {
        file: {
          read: vi.fn(async (filePath: string) => ({ content: `content:${filePath}` })),
        },
      },
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('opens multiple files as tabs and reuses an existing tab', async () => {
    const editor = useEditorStore.getState()

    await editor.openFile('C:\\workspace\\src\\first.ts', 'C:\\workspace')
    await editor.openFile('C:\\workspace\\src\\second.ts', 'C:\\workspace')

    expect(useEditorStore.getState()).toMatchObject({
      activeFileId: 'c:/workspace/src/second.ts',
      isVisible: true,
    })
    expect(useEditorStore.getState().openFiles.map((file) => file.name)).toEqual([
      'first.ts',
      'second.ts',
    ])

    await editor.openFile('C:\\workspace\\src\\first.ts', 'C:\\workspace')

    expect(useEditorStore.getState().openFiles).toHaveLength(2)
    expect(useEditorStore.getState().activeFileId).toBe('c:/workspace/src/first.ts')
  })

  it('treats Windows path casing and separators as the same tab', async () => {
    const editor = useEditorStore.getState()

    await editor.openFile('C:\\Workspace\\src\\first.ts', 'C:\\Workspace')
    await editor.openFile('c:/workspace/src/first.ts', 'c:/workspace')

    expect(useEditorStore.getState().openFiles).toHaveLength(1)
    expect(useEditorStore.getState().activeFileId).toBe('c:/workspace/src/first.ts')
    expect(window.electron.file.read).toHaveBeenCalledTimes(1)
  })

  it('clears all tabs when the preview window is closed', async () => {
    const editor = useEditorStore.getState()
    await editor.openFile('C:\\workspace\\src\\first.ts', 'C:\\workspace')
    await editor.openFile('C:\\workspace\\src\\second.ts', 'C:\\workspace')

    useEditorStore.getState().closePanel()

    expect(useEditorStore.getState()).toMatchObject({
      openFiles: [],
      activeFileId: null,
      isVisible: false,
      isEmbedded: true,
    })
  })

  it('preserves the embedded editor width while toggling its workspace placement', () => {
    const editor = useEditorStore.getState()

    editor.setEmbeddedWidth(640)
    editor.setEmbedded(true)

    expect(useEditorStore.getState()).toMatchObject({
      isEmbedded: true,
      embeddedWidth: 640,
    })
  })

  it('keeps changes dirty when save IPC returns an error or rejects', async () => {
    const editor = useEditorStore.getState()
    await editor.openFile('C:/workspace/test.ts', 'C:/workspace')
    const id = useEditorStore.getState().activeFileId!
    editor.updateContent(id, 'unsaved')
    vi.spyOn(console, 'error').mockImplementation(() => {})
    window.electron.file.save = vi.fn().mockResolvedValue({ error: 'Permission denied' })
    expect(await editor.saveFile(id)).toBe(false)
    expect(useEditorStore.getState().openFiles[0].isDirty).toBe(true)
    window.electron.file.save = vi.fn().mockRejectedValue(new Error('Disk full'))
    expect(await editor.saveFile(id)).toBe(false)
    expect(useEditorStore.getState().openFiles[0].content).toBe('unsaved')
  })

  it('does not clear edits made while an earlier version is being saved', async () => {
    const editor = useEditorStore.getState()
    await editor.openFile('C:/workspace/test.ts', 'C:/workspace')
    const id = useEditorStore.getState().activeFileId!
    editor.updateContent(id, 'first edit')
    let complete!: (result: { success: boolean }) => void
    window.electron.file.save = vi.fn(() => new Promise(resolve => { complete = resolve }))
    const saving = editor.saveFile(id)
    editor.updateContent(id, 'second edit')
    complete({ success: true })
    expect(await saving).toBe(true)
    expect(useEditorStore.getState().openFiles[0]).toMatchObject({ content: 'second edit', isDirty: true })
    window.electron.file.save = vi.fn().mockResolvedValue({ success: true })
    expect(await editor.saveFile(id)).toBe(true)
    expect(useEditorStore.getState().openFiles[0].isDirty).toBe(false)
  })

  it('opens a definition target in a reused tab and exposes its selection once', async () => {
    const editor = useEditorStore.getState()
    const selection = { startLineNumber: 4, startColumn: 3, endLineNumber: 4, endColumn: 9 }

    await editor.openFile('C:\\workspace\\src\\target.ts', 'C:\\workspace')
    await editor.openFileAt('c:/workspace/src/target.ts', 'C:\\workspace', selection)

    const target = useEditorStore.getState().navigationTarget
    expect(useEditorStore.getState().openFiles).toHaveLength(1)
    expect(target).toMatchObject({ fileId: 'c:/workspace/src/target.ts', selection })

    useEditorStore.getState().consumeNavigationTarget(target!.requestId)
    expect(useEditorStore.getState().navigationTarget).toBeNull()
  })

  it('keeps the preview embed action and the resizable workspace column wired', () => {
    const editorSource = readFileSync(
      new URL('../../src/renderer/src/components/FileEditor.tsx', import.meta.url),
      'utf8',
    )
    const appSource = readFileSync(
      new URL('../../src/renderer/src/App.tsx', import.meta.url),
      'utf8',
    )
    const explorerSource = readFileSync(
      new URL('../../src/renderer/src/components/FileExplorerTool.tsx', import.meta.url),
      'utf8',
    )
    const standaloneEditorSource = readFileSync(
      new URL('../../src/renderer/src/components/StandaloneFileEditor.tsx', import.meta.url),
      'utf8',
    )

    expect(editorSource).toContain('<FileWindow embedded')
    expect(standaloneEditorSource).toContain('void moveSession()')
    expect(appSource).toContain('aria-label="Embedded file editor"')
    expect(appSource).toContain('aria-label="Resize embedded editor"')
    expect(explorerSource).toContain('window.electron.window.openEditor({')
    expect(explorerSource).not.toContain('useEditorStore.getState().openFile')
    expect(standaloneEditorSource).toContain('window.electron.window.editorReady()')
    expect(standaloneEditorSource).toContain('window.electron.window.onEditorRefresh(async (payload) =>')
    expect(standaloneEditorSource).toContain('acceptDelivery(payload)')

    const monacoViewerSource = readFileSync(
      new URL('../../src/renderer/src/components/viewers/MonacoViewer.tsx', import.meta.url),
      'utf8',
    )
    expect(monacoViewerSource).toContain('editorRef.current.saveViewState()')
    expect(monacoViewerSource).toContain('editor.restoreViewState(viewState)')
    expect(monacoViewerSource).toContain('window.requestAnimationFrame')
    expect(monacoViewerSource).toContain('editor.onDidScrollChange(saveViewState)')
    expect(monacoViewerSource).toContain('editor.onDidChangeCursorPosition(saveViewState)')
    expect(monacoViewerSource).toContain('editor.getModel()?.setValue(content)')
    expect(monacoViewerSource).not.toContain('keepCurrentModel')
    expect(monacoViewerSource).not.toContain('keepCurrentModifiedModel')
    const markdownViewerSource = readFileSync(
      new URL('../../src/renderer/src/components/viewers/MarkdownViewer.tsx', import.meta.url),
      'utf8',
    )
    const globalStyles = readFileSync(
      new URL('../../src/renderer/src/styles/globals.css', import.meta.url),
      'utf8',
    )
    expect(markdownViewerSource).toContain('<PreviewScrollArea>')
    expect(globalStyles).toContain('.preview-scrollbar-thumb')
    expect(globalStyles).toContain('.preview-scroll-area.is-expanded .preview-scrollbar-thumb')
    const previewScrollSource = readFileSync(
      new URL('../../src/renderer/src/components/viewers/PreviewScrollArea.tsx', import.meta.url),
      'utf8',
    )
    expect(previewScrollSource).toContain('preview-scrollbar-thumb')
    expect(previewScrollSource).toContain('setPointerCapture')
    expect(monacoViewerSource).toContain('modelPath')
  })
})
