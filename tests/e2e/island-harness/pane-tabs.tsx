import React from 'react'
import ReactDOM from 'react-dom/client'
import { Terminal as Xterm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { requestTerminalForceFit } from '../../../src/renderer/src/lib/terminal-geometry'
import type { TerminalDataEvent } from '../../../src/shared/ipc/terminal'
import { TerminalArea } from '../../../src/renderer/src/components/TerminalArea'
import { installElectronApiFallback } from '../../../src/renderer/src/lib/electron-api-fallback'
import { createBrowserPaneContent, createTerminalPaneContent, getLeafPanes, type WorkspacePaneNode } from '../../../src/renderer/src/lib/workspace-pane'
import { setTerminalDragData, clearTerminalDragData } from '../../../src/renderer/src/lib/terminal-file-reference'
import { useWorkspaceStore } from '../../../src/renderer/src/stores/workspace'
import { useBrowserStore } from '../../../src/renderer/src/stores/browser'
import { useThemeStore } from '../../../src/renderer/src/stores/theme'
import { changeLanguage, initI18n } from '../../../src/renderer/src/i18n'
import { DEFAULT_APP_THEME } from '../../../src/shared/ipc/theme'
import type { BrowserBounds, BrowserSurfaceState } from '../../../src/shared/ipc/browser'
import '../../../src/renderer/src/styles/globals.css'
import '../../../src/renderer/src/styles/themes.generated.css'

installElectronApiFallback()
Object.assign(window.electron.system, { getLanguage: async () => 'en', setLanguage: async () => undefined })
document.documentElement.dataset.theme = DEFAULT_APP_THEME
const params = new URLSearchParams(location.search)
useThemeStore.getState().applyExternal(params.get('theme') === 'dark' ? 'dark' : DEFAULT_APP_THEME)
const bounds: Record<string, BrowserBounds> = {}
let kills = 0
let creates = 0
const navigationFixture = params.has('navigation')
const performanceFixture = params.has('performance') || navigationFixture
const tabIds = performanceFixture && !navigationFixture ? ['a', 'b', 'c', ...Array.from({ length: 17 }, (_, i) => `extra-${i}`)] : ['a', 'b', 'c']
let fits = 0
let refreshes = 0
let resizes = 0
let replays = 0
let latestXterm: Xterm | null = null
const xterms = new Map<string, Xterm>()
const renderWork: number[] = []
const outputListeners = new Set<(event: TerminalDataEvent) => void>()
const sequences = new Map<string, number>()
const navigationInputs: Array<{ id: string; data: string }> = []
if (navigationFixture) {
  Object.assign(window.electron.terminal, {
    input: (id: string, data: string) => navigationInputs.push({ id, data }),
  })
}
if (performanceFixture) {
  const originalOpen = Xterm.prototype.open
  Xterm.prototype.open = function (...args) { latestXterm = this; return originalOpen.apply(this, args) }
  const originalFit = FitAddon.prototype.fit
  FitAddon.prototype.fit = function () { fits++; return originalFit.call(this) }
  const originalRefresh = Xterm.prototype.refresh
  Xterm.prototype.refresh = function (...args) { refreshes++; return originalRefresh.apply(this, args) }
}
const workspace = { id: 'ws', name: 'Tabs', path: 'C:/tabs', clis: [], layout: { mode: 'tabs' as const, positions: [] }, createdAt: new Date().toISOString() }
const terminals = [...tabIds, 'sidebar'].map((id) => ({
  id, workspaceId: 'ws', cwd: 'C:/tabs', preset: navigationFixture ? 'codex' as const : 'shell' as const, name: `Terminal ${id}`, status: 'wait' as const,
  ...(new URLSearchParams(location.search).has('usage') && id === 'a' ? {
    preset: 'codex' as const, detectedModel: 'gpt-5.5', telemetryStartedAt: Date.now() - 65_000,
    contextTokens: 4_000, contextWindowTokens: 200_000, inputTokens: 10_000, outputTokens: 2_000,
    cacheReadTokens: 8_000, cacheWriteTokens: 500, totalTokens: 20_500,
    telemetryUpdatedAt: Date.now(),
  } : {}),
}))
const surfaces: Record<string, BrowserSurfaceState> = Object.fromEntries(['d', 'e', 'f', 'g', 'h', 'i', 'j'].map((surfaceId) => [surfaceId, {
  surfaceId, carrier: 'pane', tabs: [{ tabId: `page-${surfaceId}`, url: `https://example.com/${surfaceId}`,
    title: `Page ${surfaceId}`, isLoading: false, canGoBack: false, canGoForward: false }],
  activeTabId: `page-${surfaceId}`, agentControlled: false,
}]))
Object.assign(window.electron.browser, {
  getState: async (id: string) => surfaces[id] ?? null,
  setBounds: async (id: string, value: BrowserBounds) => { bounds[id] = value },
  destroySurface: async (id: string) => { delete surfaces[id] },
})
Object.assign(window.electron.terminal, {
  kill: async () => { kills++; return { success: true } },
  create: async () => { creates++; throw new Error('Drag must not create a terminal') },
})
if (performanceFixture) Object.assign(window.electron.terminal, {
  replay: async (id: string) => {
    replays++
    if (latestXterm) xterms.set(id, latestXterm)
    return { data: Array.from({ length: 2000 }, (_, i) => `${id}: history line ${i}\r\n`).join('') + `${id}: READY> `, seq: 1 }
  },
  resize: async () => { resizes++ },
  onData: (listener: (event: TerminalDataEvent) => void) => {
    outputListeners.add(listener)
    return () => outputListeners.delete(listener)
  },
})
Object.values(surfaces).forEach((surface) => useBrowserStore.getState().applySurfaceState(surface))
const overflow = new URLSearchParams(location.search).has('overflow')
const transformed = new URLSearchParams(location.search).has('transformed')
const browserOnly = new URLSearchParams(location.search).has('browser-only')
const left = {
  type: 'leaf' as const, id: 'left', activeTabId: browserOnly ? 'browser:d' : 'terminal:a',
  tabs: browserOnly ? [createBrowserPaneContent('d')] : tabIds.filter(id => !navigationFixture || params.has('single') || id !== 'c').map((id) => createTerminalPaneContent(id, 'ws')),
}
const right = {
  type: 'leaf' as const, id: 'right', activeTabId: navigationFixture ? 'terminal:c' : browserOnly ? 'browser:e' : 'browser:d',
  tabs: navigationFixture ? [createTerminalPaneContent('c', 'ws')] : (browserOnly ? ['e'] : overflow ? ['d', 'e', 'f', 'g', 'h', 'i', 'j'] : ['d', 'e']).map(createBrowserPaneContent),
}
const paneTree: WorkspacePaneNode = params.has('single') ? left : {
  type: 'split', id: 'split', direction: params.has('vertical') ? 'vertical' : 'horizontal', ratio: .5, first: left, second: right,
}
useWorkspaceStore.setState({
  workspaces: [workspace], activeWorkspaceId: 'ws', terminals: browserOnly ? [] : terminals, paneTree,
  focusedPaneId: 'left', focusedTabId: left.activeTabId, activeTerminalId: browserOnly ? null : 'a', terminalSnapshots: {},
})
Object.assign(window, {
  paneFixture: {
    state: () => {
      const state = useWorkspaceStore.getState()
      return {
        panes: getLeafPanes(state.paneTree).map((pane) => ({ id: pane.id, tabs: pane.tabs.map((tab) => tab.id), active: pane.activeTabId })),
        tree: state.paneTree, focusedPane: state.focusedPaneId, focusedTab: state.focusedTabId,
        active: state.tabDragInFlight, terminals: state.terminals.length, bounds, kills, creates,
      }
    },
    switchWorkspace: () => useWorkspaceStore.getState().setActiveWorkspace(null),
    removeSource: () => useWorkspaceStore.getState().closePaneTab('left', 'terminal:a'),
    updateUsage: (patch: object) => useWorkspaceStore.getState().updateTerminal('a', patch),
    changeLanguage,
    navigationInputs: () => [...navigationInputs],
    metrics: () => ({ fits, refreshes, resizes, replays, renderWork: [...renderWork] }),
    buffersReady: () => xterms.size === tabIds.length && [...xterms.values()].every(terminal => {
      const buffer = terminal.buffer.normal
      return buffer.getLine(buffer.length - 1)?.translateToString(true).includes('READY>')
    }),
    resetMetrics: () => { fits = 0; refreshes = 0; resizes = 0; replays = 0; renderWork.length = 0 },
    terminalState: (id: string) => {
      const terminal = xterms.get(id)!
      return { cols: terminal.cols, rows: terminal.rows, viewportY: terminal.buffer.active.viewportY,
        baseY: terminal.buffer.active.baseY, buffer: terminal.buffer.active.type,
        lastLine: terminal.buffer.active.getLine(terminal.buffer.active.baseY + terminal.rows - 1)?.translateToString(true),
        connected: terminal.element?.isConnected }
    },
    output: (id: string, data: string) => {
      const seq = (sequences.get(id) ?? 1) + 1
      sequences.set(id, seq)
      outputListeners.forEach(listener => listener({ id, data, seq }))
    },
    forceFit: requestTerminalForceFit,
    selectWorkspace: (id: string) => useWorkspaceStore.getState().setActiveWorkspace(id),
  },
})
await initI18n()
await changeLanguage('en')
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <div draggable onDragStart={(event) => setTerminalDragData(event.dataTransfer, 'sidebar')} onDragEnd={clearTerminalDragData} data-sidebar-terminal style={{ height: 32 }}>Sidebar terminal</div>
      <main style={{ display: 'flex', flex: 1, minHeight: 0, ...(transformed ? { marginLeft: 180, marginTop: 40, perspective: 1500 } : {}) }}>
        <div style={{ display: 'flex', flex: 1, minWidth: 0, ...(transformed ? { transform: 'rotateX(0deg)', transformStyle: 'preserve-3d' } : {}) }}>
          <React.Profiler id="terminal-area" onRender={(_id, _phase, actualDuration) => { if (performanceFixture) renderWork.push(actualDuration) }}>
            <TerminalArea />
          </React.Profiler>
        </div>
      </main>
    </div>
  </React.StrictMode>,
)
