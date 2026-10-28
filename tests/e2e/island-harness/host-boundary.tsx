// Note: host entry migration — see .agents/notes/planning/blueprint-official-plugin.md
import React from 'react'
import { createRoot } from 'react-dom/client'
import { Titlebar } from '../../../src/renderer/src/components/Titlebar'
import { JanusChatProvider } from '../../../src/renderer/src/components/janus/JanusChatProvider'
import { NoteTimelineDetails } from '../../../src/renderer/src/components/note/NoteTimelineDetails'
import type { ChatToolBlock } from '../../../src/shared/chat-timeline'
import { useWorkspaceBootstrap } from '../../../src/renderer/src/features/workspace/useWorkspaceBootstrap'
import { useAppStore } from '../../../src/renderer/src/stores/app'
import { useNoteChatStore } from '../../../src/renderer/src/stores/note-chat'
import { useEditorStore } from '../../../src/renderer/src/stores/editor'
import { installElectronApiFallback } from '../../../src/renderer/src/lib/electron-api-fallback'
import { initI18n, changeLanguage } from '../../../src/renderer/src/i18n'
import { useThemeStore } from '../../../src/renderer/src/stores/theme'
import '../../../src/renderer/src/styles/globals.css'
import '../../../src/renderer/src/styles/themes.generated.css'
import '../../../src/renderer/src/components/janus/janus-island.css'

installElectronApiFallback()
useThemeStore.getState().applyExternal('planche')
const workspace = { id: 'one', name: 'Project One', path: 'C:/one', clis: [], layout: { mode: 'tabs' as const, positions: [] }, createdAt: '' }
const calls = { legacy: 0, warmups: [] as string[] }
for (const method of ['listBlueprints', 'listBlueprintSummaries', 'loadBlueprint', 'maintenanceList']) {
  Object.assign(window.electron.janus, { [method]: async () => { calls.legacy++; throw new Error('Retired Blueprint called') } })
}
Object.assign(window.electron.workspace, { initialize: async () => ({ workspaces: [workspace], activeWorkspaceId: workspace.id }) })
Object.assign(window.electron.harness, {
  projectGraph: async () => { calls.legacy++; throw new Error('Retired Blueprint projection called') },
  warmup: async (path: string) => { calls.warmups.push(path); return { rev: 1, ms: 1 } },
  noteRead: async () => {
    if (fixtures.sourceFailure) throw new Error('Source unavailable')
    return { relPath: '.agents/notes/topic.md' }
  },
})
Object.assign(window.electron.system, { getLanguage: async () => 'en', setLanguage: async () => undefined })
Object.assign(window.electron.subAgentRun, { list: async () => [] })
const fixtures = {
  calls,
  sourceFailure: false,
  setTheme: (theme: 'planche' | 'dark') => useThemeStore.getState().applyExternal(theme),
  openedFiles: () => useEditorStore.getState().openFiles.map(file => file.absolutePath),
  noteChanged: () => useNoteChatStore.getState().receive({ id: 'fixture-change', conversationId: 'chat', workspacePath: workspace.path, files: [] } as never),
  restoreLegacyLayout: () => useAppStore.getState().setActiveWorkbench('blueprint'),
}
Object.assign(window, { hostFixture: fixtures })
await initI18n()
await changeLanguage('en')
const noteBlock: ChatToolBlock = {
  id: 'read', kind: 'tool', startedAt: 1, callId: 'read',
  entry: { toolName: 'note.read', workspaceId: workspace.id, status: 'completed', summary: 'Read source' },
  details: [{ kind: 'note-focus', focus: { id: 'focus', conversationId: 'chat', workspacePath: workspace.path, mode: 'access', focus: 'none', reason: 'Read source',
    notes: [{ uri: 'note://test/topic', title: 'Source Note', role: 'reference', reason: 'Task evidence' }] } }],
}

function Harness() {
  useWorkspaceBootstrap()
  return <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
    <Titlebar />
    {new URLSearchParams(location.search).has('timeline') && <NoteTimelineDetails block={noteBlock} />}
    <div style={{ flex: 1 }}>Workspace remains available</div>
  </div>
}
createRoot(document.getElementById('root')!).render(<JanusChatProvider><Harness /></JanusChatProvider>)
