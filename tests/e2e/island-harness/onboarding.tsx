import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '../../../src/renderer/src/App'
import { StandaloneFileEditor } from '../../../src/renderer/src/components/StandaloneFileEditor'
import { installElectronApiFallback } from '../../../src/renderer/src/lib/electron-api-fallback'
import { initI18n, changeLanguage } from '../../../src/renderer/src/i18n'
import { createShellProfileSeed } from '../../../src/shared/shellProfiles'
import { useWorkspaceStore } from '../../../src/renderer/src/stores/workspace'
import { useWorktreeStore } from '../../../src/renderer/src/stores/worktree'
import { useBrowserOcclusionStore } from '../../../src/renderer/src/stores/browser-occlusion'
import { useOnboardingStore } from '../../../src/renderer/src/stores/onboarding'
import '../../../src/renderer/src/styles/globals.css'
import '../../../src/renderer/src/styles/themes.generated.css'
import '../../../src/renderer/src/components/janus/janus-island.css'

// Real App, terminal layout, file tree, editor and learning components. Only IPC is replaced.
installElectronApiFallback()
const params = new URLSearchParams(location.search)
const workspace = { id: 'intro-project', name: 'Intro project', path: 'C:/intro-project', clis: [], layout: { mode: 'tabs' as const, positions: [] }, createdAt: new Date().toISOString() }
let hasWorkspace = params.has('existing') || localStorage.getItem('fixture:intro-project') === 'true'
const state = { creates: 0, cancel: params.has('cancel'), failTerminal: params.has('failTerminal'), failRead: params.has('failRead') }
const viewed = new Set<(payload: { filePath: string; workspacePath: string }) => void>()
Object.assign(window.electron.system, { getLanguage: async () => params.has('en') ? 'en' : 'zh-CN', setLanguage: async () => {}, getDefaultShell: async () => 'powershell.exe' })
Object.assign(window.electron.theme, { get: async () => params.get('theme') === 'dark' ? 'dark' : 'planche' })
Object.assign(window.electron.experimental, { get: async () => ({ blueprint: false, persona: false, teamCollab: params.has('team') }) })
Object.assign(window.electron.workspace, {
  initialize: async () => ({ workspaces: hasWorkspace ? [workspace] : [], activeWorkspaceId: hasWorkspace ? workspace.id : null, loadState: hasWorkspace ? 'no-terminal' : 'no-workspace' }),
  create: async () => { hasWorkspace = true; localStorage.setItem('fixture:intro-project', 'true'); return workspace },
  update: async () => workspace,
})
Object.assign(window.electron.dialog, { openDirectory: async () => ({ canceled: state.cancel, filePaths: state.cancel ? [] : [workspace.path] }) })
Object.assign(window.electron.shellProfiles, { list: async () => ({ entries: [createShellProfileSeed('win32')], hiddenCliPresets: [] }) })
Object.assign(window.electron.terminal, {
  create: async () => { state.creates++; if (state.failTerminal) throw new Error('Fixture terminal failure'); return { pid: 100 + state.creates } },
})
Object.assign(window.electron.fileTree, { load: async () => [{ name: 'README.md', path: 'README.md', type: 'file' }], children: async () => [] })
Object.assign(window.electron.file, { read: async () => state.failRead ? { error: 'Fixture read failure' } : { content: '# Intro project\n\nA file to read during onboarding.' } })
Object.assign(window.electron.window, {
  onEditorViewed: (callback: typeof viewed extends Set<infer T> ? T : never) => { viewed.add(callback); return () => viewed.delete(callback) },
  reportEditorViewed: (payload: { filePath: string; workspacePath: string }) => window.opener?.postMessage({ type: 'fixture:editor-viewed', payload }, location.origin),
  openEditor: async (payload: { filePath: string; workspacePath: string }) => {
    const query = new URLSearchParams({ editor: '1', editorFile: payload.filePath, workspacePath: payload.workspacePath })
    if (state.failRead) query.set('failRead', '1')
    window.open(`/onboarding.html?${query}`, 'intro-editor')
    return { success: true }
  },
})
window.addEventListener('message', event => {
  if (event.origin === location.origin && event.data?.type === 'fixture:editor-viewed') viewed.forEach(callback => callback(event.data.payload))
})
Object.assign(window, {
  onboardingFixture: {
    state,
    removeProject: () => useWorkspaceStore.getState().setActiveWorkspace(null),
    switchWorktree: () => useWorktreeStore.setState({ activePaths: { [workspace.id]: 'C:/another-worktree' } }),
    progress: () => useOnboardingStore.getState().record,
    occlusion: () => useBrowserOcclusionStore.getState().count,
  },
})
await initI18n()
await changeLanguage(params.has('en') ? 'en' : 'zh-CN')
ReactDOM.createRoot(document.getElementById('root')!).render(params.has('editor') ? <StandaloneFileEditor /> : <App />)
