import React from 'react'
import { createRoot } from 'react-dom/client'
import { SessionPanel } from '../../../src/renderer/src/components/SessionPanel'
import { useWorkspaceStore } from '../../../src/renderer/src/stores/workspace'
import { installElectronApiFallback } from '../../../src/renderer/src/lib/electron-api-fallback'
import { initI18n, changeLanguage } from '../../../src/renderer/src/i18n'
import type { AgentSessionDetail, AgentSessionSummary } from '../../../src/shared/ipc/session'
import '../../../src/renderer/src/styles/globals.css'
import '../../../src/renderer/src/styles/themes.generated.css'

installElectronApiFallback()
const sessions: AgentSessionSummary[] = Array.from({ length: 200 }, (_, index) => ({
  id: `session-${index}`, workspaceId: 'sessions', engine: 'codex', cwd: 'C:/sessions',
  firstPrompt: `Session ${index}\n${'A long prompt for layout pressure. '.repeat(80)}`,
  title: index === 1 ? undefined : `Conversation overview ${index}`,
  conversationPreview: `Recent discussion ${index}: implementation and verification`,
  turnCount: 2, checkpointCount: 0, status: 'done',
  createdAt: '2026-10-16T00:00:00Z', updatedAt: '2026-10-16T00:00:00Z', archived: false,
}))
const listeners = new Set<() => void>()
const pending: Array<(success: boolean) => void> = []
let reads = 0
Object.assign(window.electron.session, {
  list: async () => sessions,
  scanExternal: async () => ({}),
  onEvent: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener) },
  get: (id: string) => {
    reads++
    return new Promise<AgentSessionDetail | null>((resolve) => {
      pending.push((success) => resolve(!success ? null : {
        ...sessions.find((session) => session.id === id)!, terminalIds: [],
        turns: [{ id: 'turn', kind: 'done', prompt: 'Latest question', excerpt: 'Latest answer',
          startedAt: '2026-10-16T00:00:00Z', endedAt: '2026-10-16T00:00:01Z' }],
      }))
    })
  },
})
useWorkspaceStore.setState({
  workspaces: [{ id: 'sessions', name: 'Sessions', path: 'C:/sessions', clis: [],
    layout: { mode: 'tabs', positions: [] }, createdAt: '', updatedAt: '' }],
  activeWorkspaceId: 'sessions',
})
Object.assign(window, { sessionFixture: {
  reads: () => reads,
  resolve: (success = true) => { for (const resolve of pending.splice(0)) resolve(success) },
  emit: () => { for (const listener of listeners) listener() },
} })
await initI18n()
await changeLanguage('zh-CN')
createRoot(document.getElementById('root')!).render(
  <div style={{ width: 380, height: '100vh', display: 'flex', flexDirection: 'column' }}><SessionPanel /></div>,
)
