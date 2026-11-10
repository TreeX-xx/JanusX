import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { JanusIsland } from '../../../src/renderer/src/components/janus/JanusIsland'
import { JanusChatProvider, useJanusChatRegistry } from '../../../src/renderer/src/components/janus/JanusChatProvider'
import type { UseJanusChatReturn } from '../../../src/renderer/src/components/janus/useJanusChat'
import { RightDock } from '../../../src/renderer/src/components/right-tools/RightDock'
import { getRightDockLayout } from '../../../src/renderer/src/components/right-tools/layout'
import { useWorkspaceStore } from '../../../src/renderer/src/stores/workspace'
import { useRightToolStore } from '../../../src/renderer/src/stores/right-tools'
import { useAppStore } from '../../../src/renderer/src/stores/app'
import { useIslandStore } from '../../../src/renderer/src/stores/island'
import { installElectronApiFallback } from '../../../src/renderer/src/lib/electron-api-fallback'
import { initI18n, changeLanguage } from '../../../src/renderer/src/i18n'
import { dailyReviewTemplate, reminderTemplate, type AutomationCard, type AutomationRun, type AutomationDefinition, type AutomationDraft, type AutomationsAPI } from '../../../src/shared/automations'
import type { ChatStreamEvent, ChatStreamRequest } from '../../../src/shared/ipc/llm'
import { AuthType } from '../../../packages/llm-core/src/core/types'
import '../../../src/renderer/src/styles/globals.css'
import '../../../src/renderer/src/styles/themes.generated.css'
import '../../../src/renderer/src/components/janus/janus-island.css'

installElectronApiFallback()
const workspaces = ['JanusX', 'AgentX'].map((name, index) => ({ id: `workspace-${index + 1}`, name, path: `C:/fixture/${name}`, clis: [], layout: { mode: 'tabs' as const, positions: [] }, createdAt: '' }))
useWorkspaceStore.setState({ workspaces, activeWorkspaceId: new URLSearchParams(location.search).has('no-workspace') ? null : workspaces[0].id })
const requests: ChatStreamRequest[] = []
const done = new Set<(event: ChatStreamEvent) => void>()
const drafts = new Set<(draft: AutomationDraft) => void>()
const completed = new Set<(run: AutomationRun) => void>()
const removed = new Set<(id: string) => void>()
const changed = new Set<() => void>()
const cards: AutomationDefinition[] = []
const groups: AutomationCard[] = []
const runs: AutomationRun[] = []
let saveCount = 0
let controller: UseJanusChatReturn
let loaded = false
Object.assign(window.electron.subAgentRun, { list: async () => [] })
Object.assign(window.electron.workflowx, { detect: async () => ({ status: 'unconfigured', sources: [], checkedAt: Date.now() }) })
Object.assign(window.electron.agentRuntime, {
  createSession: async (input: { workspaceId: string; workspaceRoot: string }) => ({ id: `agent-${input.workspaceId}`, status: 'running', workspace: input }),
  cancelSession: async () => undefined,
})
Object.assign(window.electron.llm, {
  getTerminalProviders: async () => [{ id: 'fixture', name: 'Fixture', authType: AuthType.NONE }],
  getTerminalDefault: async () => ({ provider: { id: 'fixture', name: 'Fixture', authType: AuthType.NONE }, modelId: 'fixture-model' }),
  listModels: async () => [],
  startChatStream: (request: ChatStreamRequest) => { requests.push(request) },
  abortChat: async () => undefined,
  onDelta: () => () => {},
  onDone: (callback: (event: ChatStreamEvent) => void) => { done.add(callback); return () => { done.delete(callback) } },
})
window.electron.janusChat = {
  load: async () => ({ version: 1, activeConversationId: 'auto-chat', conversations: [{ id: 'auto-chat', title: 'Existing conversation', createdAt: 1, updatedAt: 1,
    messages: [{ id: 'earlier', role: 'user', content: 'Earlier context', timestamp: 1 }], attachedWorkspaceIds: [], toolTraces: [] }] }),
  save: async () => undefined,
}
const api: AutomationsAPI = {
  listCards: async () => structuredClone(groups),
  saveCard: async (name, id, revision) => {
    const previous = groups.find(card => card.id === id)
    if (id && previous?.revision !== revision) throw new Error('revision_conflict')
    const card = { id: id ?? crypto.randomUUID(), name, revision: (revision ?? 0) + 1, createdAt: new Date().toISOString() }
    groups.splice(0, groups.length, ...groups.filter(item => item.id !== id), card); changed.forEach(fn => fn()); return card
  },
  removeCard: async (id, revision) => {
    if (groups.find(card => card.id === id)?.revision !== revision) throw new Error('revision_conflict')
    for (const task of cards.filter(task => task.cardId === id)) await api.remove(task.id, task.revision)
    groups.splice(0, groups.length, ...groups.filter(item => item.id !== id)); changed.forEach(fn => fn())
  },
  list: async () => structuredClone(cards),
  save: async (input, id, revision) => {
    if (id && cards.find(task => task.id === id)?.revision !== revision) throw new Error('revision_conflict')
    const group = input.cardId ? groups.find(card => card.id === input.cardId) : await api.saveCard(input.name)
    if (!group) throw new Error('Automation card not found')
    group.revision++; saveCount++
    const task = { ...input, cardId: group.id, id: id ?? crypto.randomUUID(), revision: (revision ?? 0) + 1, root: '/fixture', createdAt: '', nextRunAt: null }
    cards.splice(0, cards.length, ...cards.filter(item => item.id !== id), task); changed.forEach(fn => fn()); return task
  },
  preview: async () => ({ root: '/fixture', base: '1'.repeat(40), head: '2'.repeat(40), files: [], noChanges: true }),
  run: async () => { throw new Error('No saved automation in this fixture') },
  history: async id => runs.filter(run => run.definitionId === id).reverse(), cancel: async () => undefined,
  remove: async (id, revision) => {
    if (cards.find(card => card.id === id)?.revision !== revision) throw new Error('revision_conflict')
    cards.splice(0, cards.length, ...cards.filter(card => card.id !== id))
    runs.splice(0, runs.length, ...runs.filter(run => run.definitionId !== id))
    removed.forEach(fn => fn(id)); changed.forEach(fn => fn())
  },
  onRemoved: callback => { removed.add(callback); return () => { removed.delete(callback) } },
  onChanged: callback => { changed.add(callback); return () => { changed.delete(callback) } }, onCompleted: callback => { completed.add(callback); return () => { completed.delete(callback) } }, onFocus: () => () => {},
  onDraft: callback => { drafts.add(callback); return () => { drafts.delete(callback) } },
}
window.electron.automations = api
Object.assign(window, { automationChatFixture: {
  requests,
  notify: (id: string, definitionId = 'phone', message = 'Check your phone', state: AutomationRun['state'] = 'succeeded') => {
    let snapshot = cards.find(card => card.id === definitionId)
    if (!snapshot) {
      snapshot = { ...reminderTemplate(message), name: definitionId === 'phone' ? 'Phone reminder' : definitionId, cardId: definitionId, id: definitionId, revision: 1, root: '', createdAt: new Date().toISOString(), nextRunAt: null }
      groups.push({ id: definitionId, name: snapshot.name, revision: 1, createdAt: snapshot.createdAt })
      cards.push(snapshot)
    }
    const run: AutomationRun = { id, definitionId, snapshot, message, state, trigger: 'scheduled', occurrenceKey: id,
      startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), cursor: { commit: '', epoch: 0, partialCount: 0, attention: false }, tasks: [] }
    runs.push(run); changed.forEach(fn => fn()); completed.forEach(callback => callback(run))
  },
  collapse: () => useIslandStore.getState().dispatch({ type: 'dismiss' }),
  focus: () => useRightToolStore.getState().focusRequest,
  state: () => ({ loaded, resources: controller?.resourceController?.resources.map(resource => resource.workspaceId), conversationId: controller?.conversationId,
    messages: controller?.messages.map(message => message.content), activeTool: useRightToolStore.getState().activeToolId, saveCount }),
  selectWorkspace: (id: string | null) => useWorkspaceStore.setState({ activeWorkspaceId: id }),
  showGit: () => useRightToolStore.getState().openTool('git'),
  queuePreviousRunFocus: () => useRightToolStore.setState({ focusRequest: { toolId: 'automations', itemId: 'previous-card', runId: 'previous-run', sequence: 1 } }),
  send: (text: string) => controller.send(text),
  finish: () => { const request = requests.at(-1)!; done.forEach(callback => callback({ requestId: request.requestId, done: true })) },
  draft: () => drafts.forEach(callback => callback({ input: { ...dailyReviewTemplate('workspace-1'), name: 'Proposed review', providerId: 'fixture', modelId: 'fixture-model' } })),
} })

function Harness() {
  const registry = useJanusChatRegistry()
  controller = registry.getController()
  loaded = registry.persistenceReady
  const stage = useIslandStore(state => state.stage)
  const { panelWidth, panelWidths, activeToolId } = useRightToolStore()
  const panelCollapsed = useAppStore(state => state.panelCollapsed)
  const [width, setWidth] = useState(innerWidth)
  useEffect(() => { const resize = () => setWidth(innerWidth); window.addEventListener('resize', resize); return () => window.removeEventListener('resize', resize) }, [])
  const layout = getRightDockLayout({ availableWidth: width, panelWidth, panelWidths, activeToolId, panelCollapsed, hasActiveTool: activeToolId !== null })
  return <>
    <div className="titlebar-drag" style={{ height: 38 }} />
    <main style={{ display: 'grid', gridTemplateColumns: `minmax(0, 1fr) ${layout.dockWidth}px`, height: 'calc(100vh - 38px)' }}>
      <div><button data-testid="open-island" onClick={() => useIslandStore.getState().dispatch({ type: 'double-activate' })}>Open chat</button></div>
      <RightDock effectiveCollapsed={layout.effectiveCollapsed} effectiveMaxWidth={layout.effectiveMaxWidth} forcedCollapsed={layout.responsiveAutoCollapsed} onResizingChange={() => {}} />
    </main>
    <div className="janus-island-cluster" style={{ zIndex: 2000 }}>
      <JanusIsland stage={stage} onSingleActivate={() => useIslandStore.getState().dispatch({ type: 'single-activate' })}
        onDoubleActivate={() => useIslandStore.getState().dispatch({ type: 'double-activate' })} onDismiss={() => useIslandStore.getState().dispatch({ type: 'dismiss' })}
        messages={controller.messages} pendingContent={controller.pendingContent} isStreaming={controller.isStreaming} error={controller.error}
        modelOptions={controller.modelOptions} activeModel={controller.activeModel} modelNotice={controller.modelNotice}
        onChatSelectModel={controller.selectModel} onChatSend={controller.send} onChatRewrite={controller.rewrite} onChatStop={controller.stop} onChatRetry={controller.retry} onChatClear={controller.clear}
        conversationController={controller} resourceController={controller.resourceController} toolTraces={controller.toolTraces} />
    </div>
  </>
}
document.documentElement.dataset.theme = 'dark'
await initI18n()
await changeLanguage(new URLSearchParams(location.search).get('lang') === 'zh-CN' ? 'zh-CN' : 'en')
createRoot(document.getElementById('root')!).render(<React.StrictMode><JanusChatProvider><Harness /></JanusChatProvider></React.StrictMode>)
