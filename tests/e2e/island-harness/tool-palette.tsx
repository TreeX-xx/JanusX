import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Sidebar } from '../../../src/renderer/src/components/Sidebar'
import { RightDock } from '../../../src/renderer/src/components/right-tools/RightDock'
import { ThemedTooltip } from '../../../src/renderer/src/components/ui/ThemedTooltip'
import { useWorkspaceStore } from '../../../src/renderer/src/stores/workspace'
import { useRightToolStore } from '../../../src/renderer/src/stores/right-tools'
import { useAppStore } from '../../../src/renderer/src/stores/app'
import { getRightDockLayout } from '../../../src/renderer/src/components/right-tools/layout'
import dockStyles from '../../../src/renderer/src/components/right-tools/RightDock.module.css'
import { useGitStore } from '../../../src/renderer/src/stores/git'
import { installElectronApiFallback } from '../../../src/renderer/src/lib/electron-api-fallback'
import { useThemeStore } from '../../../src/renderer/src/stores/theme'
import { extensionRegistry, openExtensionView } from '../../../src/renderer/src/extensions'
import { initI18n, changeLanguage } from '../../../src/renderer/src/i18n'
import '../../../src/renderer/src/styles/globals.css'
import '../../../src/renderer/src/styles/themes.generated.css'

installElectronApiFallback()
Object.assign(window.electron.system, { getLanguage: async () => 'zh-CN', setLanguage: async () => undefined })
const sessionListeners = new Set<unknown>()
const sessionFilters: unknown[] = []
let sessionScans = 0
const stagedPaths: string[][] = []
let terminalKills = 0
const killTerminal = window.electron.terminal.kill
window.electron.terminal.kill = async (...args) => { terminalKills++; return killTerminal(...args) }
const theme = new URLSearchParams(location.search).get('theme') ?? 'planche'
const previewWidth = Number(new URLSearchParams(location.search).get('panel')) || null
useThemeStore.getState().applyExternal(theme)
Object.assign(window.electron.worktree, { list: async () => [] })
Object.assign(window.electron.git, {
  status: async () => ({ branch: { name: 'main', upstream: 'origin/main', ahead: 1, behind: 0 }, clean: false, changes: [
    { path: 'src/renderer/RightDock.tsx', status: 'M', staged: false, additions: 12, deletions: 8 },
    { path: 'src/renderer/SessionPanel.tsx', status: 'M', staged: true, additions: 24, deletions: 15 },
  ] }),
  log: async () => [{ hash: 'palette-commit', shortHash: 'abc1234', message: 'Tooltip preview commit', author: 'JanusX', date: new Date().toISOString() }],
  commitChanges: async () => [{ path: 'tooltip-preview.txt', status: 'M', additions: 2, deletions: 1 }],
  stage: async (cwd: string, paths: string[]) => { stagedPaths.push(paths); return window.electron.git.status(cwd) },
})
Object.assign(window.electron.session, {
  scanExternal: async () => { sessionScans++; return { scanned: 0, imported: 0, updated: 0, skipped: 0 } },
  onEvent: (listener: unknown) => { sessionListeners.add(listener); return () => { sessionListeners.delete(listener) } },
  list: async (filter: unknown) => { sessionFilters.push(filter); return [{
  id: 'session-palette', workspaceId: 'palette', engine: 'codex', cwd: 'C:/palette',
  firstPrompt: '优化文件管理和工作区菜单的视觉层级', turnCount: 3, checkpointCount: 0,
  status: 'completed', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), archived: false,
}, {
  id: 'session-review', workspaceId: 'palette', engine: 'claude', cwd: 'C:/palette',
  firstPrompt: '检查终端管理的交互细节，统一按钮、输入框和默认 Shell 的状态反馈', turnCount: 8, checkpointCount: 0,
  status: 'active', createdAt: new Date().toISOString(), updatedAt: new Date(Date.now() - 300000).toISOString(), archived: false,
}, {
  id: 'session-worktree', workspaceId: 'palette', engine: 'codex', cwd: 'C:/palette',
  firstPrompt: '修复工作树切换后的文件列表刷新', turnCount: 5, checkpointCount: 0,
  status: 'completed', createdAt: new Date().toISOString(), updatedAt: new Date(Date.now() - 7200000).toISOString(), archived: false,
}] }, get: async (id: string) => ({ id, engine: 'codex', cwd: 'C:/palette', firstPrompt: '优化文件管理和工作区菜单的视觉层级', turns: [], status: 'completed', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }) })
useWorkspaceStore.setState({
  workspaces: [{ id: 'palette', name: 'JanusX', path: 'C:/palette', clis: [], layout: { mode: 'tabs', positions: [] }, createdAt: '', updatedAt: '' }],
  activeWorkspaceId: 'palette', terminals: [],
  fileTree: [{ name: 'README.md', path: 'README.md', type: 'file' }, { name: 'src', path: 'src', type: 'directory', children: [] }],
  fileTreeLoadState: 'idle',
})
await useGitStore.getState().fetchStatus('C:/palette')
useRightToolStore.setState({ openToolIds: ['files', 'sessions', 'git'], activeToolId: 'files', ...(previewWidth ? { panelWidths: { sessions: previewWidth, git: previewWidth } } : {}) })
useAppStore.setState({ panelCollapsed: false })
const toolActivations: Array<string | null> = []
useRightToolStore.subscribe((state, previous) => {
  if (state.activeToolId !== previous.activeToolId) toolActivations.push(state.activeToolId)
})
Object.assign(window, { builtinExtensionFixture: {
  largeGit: () => useGitStore.setState({ status: { branch: { name: 'main', ahead: 0, behind: 0 }, clean: false,
    changes: Array.from({ length: 500 }, (_, index) => ({ path: `src/large/file-${index}.tsx`, status: 'M', staged: false, additions: null, deletions: null })) } }),
  refreshGit: (changed: boolean) => {
    const status = useGitStore.getState().status!
    useGitStore.setState({ status: { ...status, changes: status.changes.map((file, index) => ({ ...file,
      ...(changed && index === 499 ? { status: 'A' as const } : {}) })) } })
  },
  close: (id: string) => useRightToolStore.getState().closeTool(id),
  collapse: () => useAppStore.getState().setPanelCollapsed(true),
  disable: (id: string) => extensionRegistry.disable(`janusx.${id}`),
  enable: (id: string) => extensionRegistry.enable(`janusx.${id}`),
  open: (id: string) => openExtensionView(`extension:janusx.${id}/panel`),
  selectProject: (id: string) => useWorkspaceStore.setState({ activeWorkspaceId: id,
    workspaces: ['palette', 'other'].map((projectId) => ({ id: projectId, name: projectId, path: `C:/${projectId}`,
      clis: [], layout: { mode: 'tabs', positions: [] }, createdAt: '' })),
  }),
  state: () => ({ listeners: sessionListeners.size, sessionFilters, sessionScans, terminalKills, stagedPaths,
    active: useRightToolStore.getState().activeToolId, toolActivations,
    open: useRightToolStore.getState().openToolIds, widths: useRightToolStore.getState().panelWidths }),
} })
await initI18n()
await changeLanguage('zh-CN')
function ToolPalette() {
  const { panelWidth, panelWidths, activeToolId } = useRightToolStore()
  const panelCollapsed = useAppStore((state) => state.panelCollapsed)
  const [resizing, setResizing] = useState(false)
  const layout = getRightDockLayout({
    availableWidth: window.innerWidth - 220,
    panelWidth, panelWidths, activeToolId, panelCollapsed,
    hasActiveTool: activeToolId !== null,
  })
  return (
  <main className={dockStyles.workbenchGrid} data-resizing={resizing} style={{ display: 'grid', gridTemplateColumns: `220px minmax(0, 1fr) ${layout.dockWidth}px`, height: '100vh', background: 'var(--shell-canvas)' }}>
    <Sidebar />
    <section style={{ padding: 32, color: 'var(--shell-text)', position: 'relative' }}>
      <h1 style={{ fontSize: 20 }}>JanusX</h1><p style={{ marginTop: 12 }}>中央内容保留暖纸色，工具与菜单使用更浅的中性色。</p>
      <button id="preview-underlay" style={{ position: 'absolute', right: 0, top: 80, bottom: 0, width: 288 }} onClick={(event) => { event.currentTarget.textContent = 'Underlay clicked' }}>Preview underlay</button>
      <div style={{ position: 'fixed', left: 0, bottom: 0 }}>
        <ThemedTooltip label={'Long edge tooltip '.repeat(30)} placement="bottom"><button id="edge-tooltip">Edge tooltip</button></ThemedTooltip>
      </div>
    </section>
    <RightDock effectiveCollapsed={layout.effectiveCollapsed} effectiveMaxWidth={layout.effectiveMaxWidth} forcedCollapsed={layout.responsiveAutoCollapsed} onResizingChange={setResizing} />
  </main>
  )
}
createRoot(document.getElementById('root')!).render(<ToolPalette />)
