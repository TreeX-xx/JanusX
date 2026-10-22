import { useGlobalToolsStore } from '../../../src/renderer/src/stores/global-tools'
import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { TerminalArea } from '../../../src/renderer/src/components/TerminalArea'
import { TitlebarToolGroup } from '../../../src/renderer/src/components/TitlebarToolGroup'
import { RightDock } from '../../../src/renderer/src/components/right-tools/RightDock'
import { getRightDockLayout } from '../../../src/renderer/src/components/right-tools/layout'
import { extensionRegistry, extensionCommands, openExtensionView, type ExtensionViewProps } from '../../../src/renderer/src/extensions'
import { createWorkspaceToolsExample } from '../../../src/renderer/src/extensions/examples/workspace-tools'
import { useWorkspaceStore } from '../../../src/renderer/src/stores/workspace'
import { useRightToolStore } from '../../../src/renderer/src/stores/right-tools'
import { useAppStore } from '../../../src/renderer/src/stores/app'
import { useThemeStore } from '../../../src/renderer/src/stores/theme'
import { getLeafPanes } from '../../../src/renderer/src/lib/workspace-pane'
import { installElectronApiFallback } from '../../../src/renderer/src/lib/electron-api-fallback'
import { initI18n, changeLanguage } from '../../../src/renderer/src/i18n'
import '../../../src/renderer/src/styles/globals.css'
import '../../../src/renderer/src/styles/themes.generated.css'

installElectronApiFallback()
Object.assign(window.electron.system, { getLanguage: async () => 'en', setLanguage: async () => undefined })
useThemeStore.getState().applyExternal(new URLSearchParams(location.search).get('theme') ?? 'planche')
const workspaces = ['one', 'two'].map((id) => ({ id, name: id, path: `C:/${id}`, clis: [], layout: { mode: 'tabs' as const, positions: [] }, createdAt: '' }))
useWorkspaceStore.setState({ workspaces, activeWorkspaceId: 'one', terminals: [], paneTree: null,
  focusedPaneId: null, focusedTabId: null, terminalSnapshots: {} })
const metrics = { activations: 0, disposals: 0, mounts: 0, unmounts: 0 }
const example = createWorkspaceToolsExample()
const unregister = extensionRegistry.register({
  ...example,
  activate: () => { metrics.activations++; return () => { metrics.disposals++ } },
  views: example.views.map((view) => {
    const View = view.component
    return { ...view, ...(view.id === 'overview' ? { launcher: 'tool-menu' as const } : {}), component: function TrackedView(props: ExtensionViewProps) {
      useEffect(() => { metrics.mounts++; return () => { metrics.unmounts++ } }, [])
      return <View {...props} />
    } }
  }),
})
let brokenViewFails = true
extensionRegistry.register({ id: 'broken.tools', views: [{ id: 'page', title: 'Broken view', location: 'right', scope: 'application',
  component: () => {
    if (brokenViewFails) throw new Error('Intentional extension failure')
    return <div>Recovered view</div>
  },
}] })
openExtensionView('extension:example.tools/overview')
extensionRegistry.register({
  id: 'commands.tools',
  views: [
    { id: 'details', title: 'Command details', location: 'workspace', scope: 'project', component: () => <p data-command-details>Command details ready</p> },
    { id: 'summary', title: 'Command summary', location: 'right', scope: 'project', component: () => <p data-command-summary>Summary ready</p> },
  ],
  commands: [
    { id: 'open-details', title: 'Open command details', action: { type: 'openView', view: 'details' } },
    { id: 'open-summary', title: 'Show summary', action: { type: 'openView', view: 'summary' } },
  ],
  menus: [{ location: 'toolbox', command: 'open-details' }, { location: 'workspace-add', command: 'open-details', when: 'projectOpen' },
    { location: 'toolbox', command: 'open-summary' }],
  keybindings: [{ command: 'open-details', key: 'Ctrl+Alt+Shift+R' }],
})
Object.assign(window, { extensionFixture: {
  recoverBrokenView: () => { brokenViewFails = false },
  disableCommands: () => extensionRegistry.disable('commands.tools'),
  clearProject: () => useWorkspaceStore.getState().setActiveWorkspace(null),
  hideCommandMenu: () => extensionCommands.setMenuPreference('menu:commands.tools/toolbox/open-details', { hidden: true }),
  state: () => ({ ...metrics, tabs: [...getLeafPanes(useWorkspaceStore.getState().paneTree), ...getLeafPanes(useGlobalToolsStore.getState().paneTree)].flatMap((leaf) => leaf.tabs),
    right: useRightToolStore.getState().openToolIds, snapshots: useWorkspaceStore.getState().terminalSnapshots }),
} })
await initI18n()
await changeLanguage('en')

function Workbench() {
  const panelCollapsed = useAppStore((state) => state.panelCollapsed)
  const { panelWidth, panelWidths, activeToolId } = useRightToolStore()
  const [resizing, setResizing] = useState(false)
  const layout = getRightDockLayout({ availableWidth: window.innerWidth, panelWidth, panelWidths,
    activeToolId, panelCollapsed, hasActiveTool: activeToolId !== null })
  return <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
    <nav style={{ display: 'flex', gap: 12, padding: 8, color: 'var(--shell-text)' }}>
      <TitlebarToolGroup />
      <button onClick={() => openExtensionView('extension:example.tools/overview')}>Open overview</button>
      <button onClick={() => useWorkspaceStore.getState().setActiveWorkspace('one')}>Project one</button>
      <button onClick={() => useWorkspaceStore.getState().setActiveWorkspace('two')}>Project two</button>
      <button onClick={() => extensionRegistry.disable('example.tools')}>Disable example</button>
      <button onClick={() => extensionRegistry.enable('example.tools')}>Enable example</button>
      <button onClick={unregister}>Unregister example</button>
      <input aria-label="Shortcut input" />
      <div className="xterm" tabIndex={0} aria-label="Terminal shortcut input" />
    </nav>
    <main style={{ display: 'grid', gridTemplateColumns: `minmax(0, 1fr) ${layout.dockWidth}px`, flex: 1, minHeight: 0 }}>
      <TerminalArea />
      <RightDock effectiveCollapsed={layout.effectiveCollapsed} effectiveMaxWidth={layout.effectiveMaxWidth}
        forcedCollapsed={layout.responsiveAutoCollapsed} onResizingChange={setResizing} />
    </main>
    <output hidden>{String(resizing)}</output>
  </div>
}
createRoot(document.getElementById('root')!).render(<Workbench />)
