import React from 'react'
import ReactDOM from 'react-dom/client'
import { Sidebar } from '../../../src/renderer/src/components/Sidebar'
import { installElectronApiFallback } from '../../../src/renderer/src/lib/electron-api-fallback'
import { initI18n, changeLanguage } from '../../../src/renderer/src/i18n'
import { useWorkspaceStore } from '../../../src/renderer/src/stores/workspace'
import { useWorktreeStore } from '../../../src/renderer/src/stores/worktree'
import { useAppStore } from '../../../src/renderer/src/stores/app'
import { useThemeStore } from '../../../src/renderer/src/stores/theme'
import { useExperimentalStore } from '../../../src/renderer/src/stores/experimental'
import { createTerminalPaneContent } from '../../../src/renderer/src/lib/workspace-pane'
import type { Terminal } from '../../../src/renderer/src/types'
import type { WorktreeInfo } from '../../../src/shared/ipc/worktree'
import '../../../src/renderer/src/styles/globals.css'
import '../../../src/renderer/src/styles/themes.generated.css'

// 展示数据为隔离 fixture；所有列表、菜单、键盘与选择行为运行真实 Sidebar/store。
installElectronApiFallback()
const params = new URLSearchParams(location.search)
useThemeStore.getState().applyExternal(params.get('theme') ?? 'planche')
useExperimentalStore.setState({ teamCollab: false, loaded: true })
Object.assign(window.electron.system, { getLanguage: async () => 'zh-CN', setLanguage: async () => undefined })
const workspaceNames = params.has('many') ? Array.from({ length: 24 }, (_, index) => ['JanusX', 'Janus Web', 'Janus Agent'][index] ?? `Project ${index}`) : ['JanusX', 'Agent runtime', 'Documentation']
const workspaces = workspaceNames.map((name, index) => ({
  id: `ws-${index}`, name, path: `C:/projects/${name}`, clis: [],
  layout: { mode: 'tabs' as const, positions: [] }, createdAt: '2026-10-15T00:00:00Z',
  ...(params.has('grouped') && index < 2 ? { sidebarGroup: { id: 'development', name: 'Development' } } : {}),
}))
const root = workspaces[0].path
const worktrees: WorktreeInfo[] = [
  { id: 'main', workspaceId: 'ws-0', path: root, branch: 'main', isMain: true, detached: false, external: false },
  { id: 'feature', workspaceId: 'ws-0', path: root + '-sidebar', branch: 'feature/sidebar-design', startFrom: 'origin/main', isMain: false, detached: false, external: false },
]
const terminals: Terminal[] = [
  { id: 'review', workspaceId: 'ws-0', cwd: root, name: 'Review workspace design', preset: 'codex', status: 'needs-input' },
  { id: 'shell', workspaceId: 'ws-0', cwd: root, name: 'PowerShell', preset: 'shell', status: 'wait' },
  { id: 'feature-cli', workspaceId: 'ws-0', cwd: root + '-sidebar', name: 'Refine sidebar navigation', preset: 'claude', status: 'running' },
]
const background: Terminal = { id: 'background', workspaceId: 'ws-1', cwd: workspaces[1].path, name: 'Runtime validation', preset: 'codex', status: 'error' }
let droppedTerminal = ''
Object.assign(window.electron.worktree, {
  list: async (id: string) => id === 'ws-0' ? worktrees : [],
  identity: async () => null,
  unwatch: async () => undefined,
})
Object.assign(window.electron.workspace, { update: async () => undefined })
Object.assign(window.electron.fileTree, { load: async () => [] })
useWorktreeStore.setState({ worktreesByWorkspace: { 'ws-0': worktrees }, activePaths: { 'ws-0': root } })
useWorkspaceStore.setState({
  workspaces, activeWorkspaceId: 'ws-0', terminals, activeTerminalId: 'review',
  paneTree: { type: 'split', id: 'split', direction: 'horizontal', ratio: .5,
    first: { type: 'leaf', id: 'left', activeTabId: 'terminal:review', tabs: [createTerminalPaneContent('review', 'ws-0'), createTerminalPaneContent('shell', 'ws-0')] },
    second: { type: 'leaf', id: 'right', activeTabId: 'terminal:feature-cli', tabs: [createTerminalPaneContent('feature-cli', 'ws-0')] },
  },
  focusedPaneId: 'left', focusedTabId: 'terminal:review',
  terminalSnapshots: { 'ws-1': { terminals: [background], activeTerminalId: 'background', paneTree: null, focusedPaneId: null, focusedTabId: null } },
})
useWorkspaceStore.getState().setWorkspaces(workspaces)
Object.assign(window, { sidebarFixture: { state: () => {
  const state = useWorkspaceStore.getState()
  return { workspace: state.activeWorkspaceId, terminal: state.activeTerminalId, pane: state.focusedPaneId, tab: state.focusedTabId, terminals: state.terminals.length, scope: useWorktreeStore.getState().activePaths[state.activeWorkspaceId ?? ''], droppedTerminal, sidebarCollapsed: useAppStore.getState().sidebarCollapsed }
}, removeWorkspace: (id: string) => useWorkspaceStore.getState().removeWorkspace(id) } })
await initI18n()
await changeLanguage(params.has('en') ? 'en' : 'zh-CN')
function Preview() {
  const active = useWorkspaceStore(s => s.activeTerminalId)
  return <main style={{ display: 'flex', height: '100vh', background: 'var(--shell-canvas)', color: 'var(--shell-text)' }}>
    <style>{'.workspace-sidebar { width: 252px; } .workspace-sidebar[data-collapsed="true"] { width: 52px; }'}</style>
    <Sidebar />
    <div data-terminal-drop-target onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); droppedTerminal = event.dataTransfer.getData('application/x-janusx-terminal-id') }} style={{ padding: 32, flex: 1 }}><p style={{ fontSize: 12, color: 'var(--shell-muted)' }}>Sidebar preview · Fixture data</p><p data-selected-terminal>{active}</p></div>
  </main>
}
ReactDOM.createRoot(document.getElementById('root')!).render(<Preview />)
