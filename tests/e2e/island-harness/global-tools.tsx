import { RightDock } from '../../../src/renderer/src/components/right-tools/RightDock'
import { getAuxiliaryWorkspaceLayout } from '../../../src/renderer/src/lib/auxiliary-layout'
import { useAuxiliaryPanelsStore } from '../../../src/renderer/src/stores/auxiliary-panels'
import { useEditorStore } from '../../../src/renderer/src/stores/editor'
import { FileEditor } from '../../../src/renderer/src/components/FileEditor'
import { useRightToolStore } from '../../../src/renderer/src/stores/right-tools'
import { useAppStore } from '../../../src/renderer/src/stores/app'
import dockStyles from '../../../src/renderer/src/components/right-tools/RightDock.module.css'
import React, { Profiler, useEffect, useLayoutEffect, useState } from 'react'
import ReactDOM from 'react-dom/client'
import { TerminalArea } from '../../../src/renderer/src/components/TerminalArea'
import { TitlebarToolGroup } from '../../../src/renderer/src/components/TitlebarToolGroup'
import { installElectronApiFallback } from '../../../src/renderer/src/lib/electron-api-fallback'
import { useWorkspaceStore } from '../../../src/renderer/src/stores/workspace'
import { useGlobalToolsStore } from '../../../src/renderer/src/stores/global-tools'
import { useDraftCardStore } from '../../../src/renderer/src/stores/draft-card'
import { useBrowserStore } from '../../../src/renderer/src/stores/browser'
import { useThemeStore } from '../../../src/renderer/src/stores/theme'
import { changeLanguage, initI18n } from '../../../src/renderer/src/i18n'
import type { BrowserBounds, BrowserSurfaceState } from '../../../src/shared/ipc/browser'
import '../../../src/renderer/src/styles/globals.css'
import '../../../src/renderer/src/styles/themes.generated.css'
import '../../../src/renderer/src/styles/theme-hovers.css'

installElectronApiFallback()
const language = new URLSearchParams(location.search).get('lang') === 'zh-CN' ? 'zh-CN' : 'en'
Object.assign(window.electron.system, { getLanguage: async () => language, setLanguage: async () => undefined })
useThemeStore.getState().applyExternal(new URLSearchParams(location.search).get('theme') === 'dark' ? 'dark' : 'planche')
const surface: BrowserSurfaceState = {
  surfaceId: 'browser', carrier: 'pane', tabs: [{ tabId: 'page', url: 'https://example.com/',
    title: 'Reference browser', isLoading: false, canGoBack: false, canGoForward: false }],
  activeTabId: 'page', agentControlled: false,
}
const bounds: BrowserBounds[] = []
Object.assign(window.electron.browser, {
  getState: async () => surface,
  setBounds: async (_id: string, value: BrowserBounds) => { bounds.push(value) },
})
useBrowserStore.getState().applySurfaceState(surface)
const workspace = useWorkspaceStore.getState()
const stressUsage = new URLSearchParams(location.search).has('stressUsage')
workspace.setWorkspaces(['A', 'B', 'Empty'].map((id) => ({ id, name: stressUsage && id === 'A' ? '很长的项目名称 — A project with a very long workspace name' : `Project ${id}`, path: `C:/${id}`, clis: [],
  layout: { mode: 'tabs', positions: [] }, createdAt: new Date().toISOString() })))
for (const id of ['A', 'B']) {
  workspace.setActiveWorkspace(id)
  workspace.addTerminal({ id: `${id}-1`, workspaceId: id, cwd: `C:/${id}`, preset: 'shell', name: `${id} one`, status: 'wait' })
  if (id === 'B') {
    workspace.splitPane(useWorkspaceStore.getState().focusedPaneId, 'horizontal')
    workspace.addTerminal({ id: 'B-2', workspaceId: id, cwd: `C:/${id}`, preset: 'shell', name: 'B two', status: 'wait' })
    workspace.resizePane(useWorkspaceStore.getState().paneTree!.id, .35)
  }
}
workspace.setActiveWorkspace('A')
if (stressUsage) {
  workspace.addTerminal({ id: 'A-2', workspaceId: 'A', cwd: 'C:/A', preset: 'shell', name: 'A two', status: 'wait' })
  workspace.setActiveTerminal('A-1')
}
workspace.updateTerminal('A-1', { preset: 'codex', detectedModel: 'a-very-long-model-name-with-a-large-context-window',
  contextTokens: 4000, contextWindowTokens: 200000, telemetryUpdatedAt: Date.now() })
workspace.openMarkdownInWorkspace()
const draft = useDraftCardStore.getState().addDraft('A')
useDraftCardStore.getState().updateDraft('A', draft, { content: 'Document from project A', title: 'Project A notes' })
useGlobalToolsStore.getState().attachBrowser('browser')
const renderWork: number[] = []
Object.assign(window.electron.file, {
  read: async () => ({ content: '# File preview\n\nKeep this draft and its selected mode.' }),
  save: async () => ({ success: true }),
})
function MeasuredTerminalArea() {
  return <Profiler id="terminal-area" onRender={(_id, _phase, duration) => { renderWork.push(duration) }}><TerminalArea /></Profiler>
}
Object.assign(window, { toolsFixture: {
  resizeTools: (ratio: number) => useGlobalToolsStore.getState().setProjectRatio(ratio),
  resetRenderWork: () => { renderWork.length = 0 },
  renderWork: () => renderWork,
  state: () => ({ project: useWorkspaceStore.getState().paneTree, tools: useGlobalToolsStore.getState().paneTree,
    ratio: useGlobalToolsStore.getState().projectRatio, scope: useGlobalToolsStore.getState().markdownScopeId,
    bounds, collapsed: useGlobalToolsStore.getState().collapsed }),
  clearBounds: () => { bounds.length = 0 },
  switch: (id: string | null) => workspace.setActiveWorkspace(id),
  selectTerminal: (id: string) => workspace.setActiveTerminal(id),
  openEditor: () => useEditorStore.getState().openFile('C:/A/preview.md', 'C:/A'),
  editorState: () => {
    const editor = useEditorStore.getState()
    return { files: editor.openFiles, activeFileId: editor.activeFileId, visible: editor.isVisible, width: editor.embeddedWidth }
  },
} })
const withDock = new URLSearchParams(location.search).has('dock')
useRightToolStore.setState({ openToolIds: ['files'], activeToolId: 'files', panelWidth: 360, panelWidths: { files: 360 } })
useAppStore.setState({ panelCollapsed: true })
function WorkspaceWithDock() {
  const [width, setWidth] = useState(window.innerWidth)
  const [resizing, setResizing] = useState(false)
  const panelCollapsed = useAppStore(s => s.panelCollapsed)
  const { panelWidth, panelWidths, activeToolId } = useRightToolStore()
  const projectTree = useWorkspaceStore(s => s.paneTree)
  const projectId = useWorkspaceStore(s => s.activeWorkspaceId)
  const { paneTree: toolsTree, collapsed } = useGlobalToolsStore()
  const { priority, editorCompact } = useAuxiliaryPanelsStore()
  const { openFiles, isVisible, embeddedWidth, isEmbedded } = useEditorStore()
  useEffect(() => {
    const resize = () => setWidth(window.innerWidth)
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])
  const { rightDockLayout: layout, editorWidth, editorVisible } = getAuxiliaryWorkspaceLayout({
    availableWidth: width, panelCollapsed, panelWidth, panelWidths, activeToolId, hasActiveTool: !!activeToolId,
    hasProject: projectId !== null || projectTree !== null, projectTree,
    toolsRequested: toolsTree !== null && !collapsed, editorRequested: isEmbedded && isVisible,
    editorWidth: embeddedWidth, editorWasCompact: editorCompact, priority,
  })
  useLayoutEffect(() => {
    useAuxiliaryPanelsStore.setState({ editorCompact: isEmbedded && isVisible && !editorVisible })
  }, [isEmbedded, isVisible, editorVisible])
  return <div data-testid="combined-workspace" className={dockStyles.workbenchGrid} data-resizing={resizing}
    style={{ display: 'grid', flex: 1, minHeight: 0, gridTemplateColumns: `minmax(320px, 1fr) ${editorWidth}px ${layout.dockWidth}px` }}>
    <div style={{ minWidth: 0, minHeight: 0 }}><TerminalArea auxiliaryControls /></div>
    <section aria-label="Embedded file editor" aria-hidden={!editorVisible} {...(!editorVisible ? { inert: '' } : {})}
      style={{ minWidth: 0, overflow: 'hidden' }}>
      {isEmbedded && openFiles.length > 0 && <FileEditor active={editorVisible} />}
    </section>
    <RightDock effectiveCollapsed={layout.effectiveCollapsed} effectiveMaxWidth={layout.effectiveMaxWidth}
      forcedCollapsed={layout.responsiveAutoCollapsed} onResizingChange={setResizing} />
  </div>
}
await initI18n()
await changeLanguage(language)
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--shell-canvas)', color: 'var(--shell-text)' }}>
      <nav style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 24, padding: 12 }}>
        {['A', 'B', 'Empty'].map((id) => <button key={id} onClick={() => workspace.setActiveWorkspace(id)}>Project {id}</button>)}
        <button onClick={() => workspace.setActiveWorkspace(null)}>No project</button>
        <TitlebarToolGroup />
        {withDock && <button onClick={() => useAppStore.getState().togglePanel()}>Toggle right workspace</button>}
      </nav>
      {withDock ? <WorkspaceWithDock /> : <div style={{ flex: 1, minHeight: 0 }}><MeasuredTerminalArea /></div>}
    </div>
  </React.StrictMode>,
)
