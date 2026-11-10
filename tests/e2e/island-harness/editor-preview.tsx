import React from 'react'
import ReactDOM from 'react-dom/client'
import * as monaco from 'monaco-editor/esm/vs/editor/editor.main'
import { StandaloneFileEditor } from '../../../src/renderer/src/components/StandaloneFileEditor'
import { useEditorStore } from '../../../src/renderer/src/stores/editor'
import { useThemeStore } from '../../../src/renderer/src/stores/theme'
import { applyThemeToDocument } from '../../../src/renderer/src/services/theme'
import { installElectronApiFallback } from '../../../src/renderer/src/lib/electron-api-fallback'
import { initI18n, changeLanguage } from '../../../src/renderer/src/i18n'
import '../../../src/renderer/src/styles/globals.css'
import '../../../src/renderer/src/styles/themes.generated.css'
import '../../../src/renderer/src/styles/theme-hovers.css'
import '../../../src/renderer/src/components/viewers/markdown-preview.css'

const params = new URLSearchParams(location.search)
params.set('editorFile', 'C:/fixture/notes.md')
params.set('workspacePath', 'C:/fixture')
history.replaceState(null, '', `?${params}`)
const markdown = Array.from({ length: 45 }, (_, index) =>
  `# Section ${index}\n\n${'A paragraph with words that wrap across the pane. '.repeat(8)}\n\n` +
  (index % 4 === 0 ? '```ts\nconst value = 42\n```\n\n| A | B |\n| --- | --- |\n| x | y |\n\n' : '') +
  (index % 6 === 0 ? '![Tall image](data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="300" height="400"%3E%3Crect width="300" height="400" fill="orange"/%3E%3C/svg%3E)\n\n' : ''),
).join('')
const files: Record<string, string> = { 'C:/fixture/notes.md': markdown, 'C:/fixture/code.ts': 'export const value = 2\n' }
const harness = {
  baselines: {} as Record<string, string>,
  baselineCalls: 0, saves: [] as string[], links: [] as string[], closed: 0, failSave: false,
  copiedPaths: [] as string[], revealedPaths: [] as string[][], failPathAction: false,
  editors: () => monaco.editor.getEditors(),
  diffEditors: () => monaco.editor.getDiffEditors(),
  state: () => useEditorStore.getState(),
  setTheme: (theme: 'dark' | 'planche') => useThemeStore.getState().applyExternal(theme),
  open: async (name: string, content?: string) => {
    const path = `C:/fixture/${name}`
    if (content !== undefined) files[path] = content
    await useEditorStore.getState().openFile(path, 'C:/fixture')
    useEditorStore.getState().updateViewState(useEditorStore.getState().activeFileId!, { previewMode: 'split' })
  },
}
;(window as any).previewHarness = harness
installElectronApiFallback()
Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
  writeText: async (value: string) => {
    if (harness.failPathAction) throw new Error('Fixture: clipboard unavailable')
    harness.copiedPaths.push(value)
  },
} })
Object.assign(window.electron.fileTree, {
  reveal: async (root: string, path: string) => {
    harness.revealedPaths.push([root, path])
    return harness.failPathAction ? { success: false, error: 'Fixture: reveal failed' } : { success: true }
  },
})
Object.assign(window.electron.theme, { get: async () => params.get('theme') ?? 'dark' })
Object.assign(window.electron.file, {
  openPreviewLink: async (url: string) => { harness.links.push(url) },
  openHtmlPreview: async (request: unknown) => {
    if (!(window as any).previewBridge) throw new Error('Preview bridge unavailable')
    return (window as any).previewBridge('open', request)
  },
  updateHtmlPreview: async (id: string, content: string) => (window as any).previewBridge('update', { id, content }),
  closeHtmlPreview: async (id: string) => { if ((window as any).previewBridge) await (window as any).previewBridge('close', { id }) },
  read: async (path: string) => ({ content: files[path] ?? '' }),
  save: async (path: string, content: string) => {
    if (harness.failSave) return { error: 'Fixture: permission denied' }
    harness.saves.push(path)
    files[path] = content
    return { success: true }
  },
})
Object.assign(window.electron.git, {
  fileBaseline: async (_workspace: string, path: string) => {
    harness.baselineCalls++
    return path.endsWith('missing.ts') ? { available: false } : { available: true, content: harness.baselines[path] ?? (path.endsWith('.md') ? '# Original\n' : 'export const value = 1\n') }
  },
})
Object.assign(window.electron.window, { confirmEditorClose: async () => { harness.closed++ } })
applyThemeToDocument(params.get('theme') ?? 'dark')
await initI18n()
await changeLanguage('zh-CN')
await harness.open('notes.md')
ReactDOM.createRoot(document.getElementById('root')!).render(<StandaloneFileEditor embedded={params.has('embedded')} />)
