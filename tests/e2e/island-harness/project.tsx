import React, { useEffect, useState } from 'react'
import ReactDOM from 'react-dom/client'
import { JanusChatProvider, useJanusChatController, useOptionalJanusChatController, useJanusChatRegistry } from '../../../src/renderer/src/components/janus/JanusChatProvider'
import { JanusChat } from '../../../src/renderer/src/components/janus/JanusChat'
import { ProjectLaunchAssistant } from '../../../src/renderer/src/components/ProjectLaunchAssistant'
import { ProjectType } from '../../../src/shared/ipc/project'
import { HarnessRunPanel } from '../../../src/renderer/src/components/janus/HarnessRunPanel'
import { useWorkspaceStore } from '../../../src/renderer/src/stores/workspace'
import { installElectronApiFallback } from '../../../src/renderer/src/lib/electron-api-fallback'
import { changeLanguage, initI18n } from '../../../src/renderer/src/i18n'
import type { ChatAgentEvent, ChatStreamRequest } from '../../../src/shared/ipc/llm'
import { DEFAULT_APP_THEME } from '../../../src/shared/ipc/theme'
import type { HarnessTaskDraft, HarnessTranscript } from '../../../src/shared/ipc/harness'
import type { CreateAgentSessionInput } from '../../../src/shared/ipc/agent-runtime'
import '../../../src/renderer/src/styles/globals.css'
import '../../../src/renderer/src/styles/themes.generated.css'
import '../../../src/renderer/src/components/janus/janus-island.css'

installElectronApiFallback()
document.documentElement.dataset.theme = DEFAULT_APP_THEME
const workbench = new URLSearchParams(location.search).has('workbench')
Object.assign(window.electron.system, { getLanguage: async () => 'en', setLanguage: async () => undefined })
const repoId = '8fa19f17-c717-43a8-93a7-810a5e0cbc91'
const id = '44444444-4444-4333-8333-444444444444'
const uri = `note://${repoId}/${id}`
const workspace = { id: 'ws', path: 'C:/fixture', name: 'Project', clis: [], layout: { mode: 'tabs', positions: [] } }
const secondWorkspace = { ...workspace, id: 'ws-b', path: 'C:/fixture-b', name: 'Checkout B' }
const workspaces = new URLSearchParams(location.search).has('switch-workspace') ? [workspace, secondWorkspace] : [workspace]
useWorkspaceStore.setState({ workspaces: workspaces as never, activeWorkspaceId: 'ws' })
const PANEL_REF = { ownerRepoId: repoId, viewId: 'shared-chat-fixture' }
const events = new Set<(event: ChatAgentEvent) => void>()
const runtimeEvents = new Set<(event: any) => void>()
const fixture = {
  catalogMatch: false, catalogUpdateMatches: false, catalogUpdates: 0,
  savedProvider: new URLSearchParams(location.search).has('model-limits-manual')
    ? { terminal: 'janus', settings: { id: 'p', name: 'Fixture', extra: { chatModelLimits: { 'model-a': { contextWindow: 1000000, maxOutputTokens: 12000 } } } } } as any
    : null as any,
  noteChanges: [] as import('../../../src/shared/note-chat').NoteChatChange[],
  undoConflict: false,
  runtimeSessions: [] as CreateAgentSessionInput[],
  streams: [] as ChatStreamRequest[], aborts: 0, steers: 0, answers: 0, approvals: 0, adoptions: 0,
  prepares: 0, starts: 0, executes: 0, runAborts: 0, pauses: 0, resumes: 0, rebaselines: 0, takeovers: 0, threadCloses: 0, reviews: 0, finishes: 0, repairs: 0, undoPreviews: 0, undoApplies: 0,
  gateExecute: false, gateResolve: null as null | (() => void),
  lastExecute: null as null | { runId: string; providerId?: string; modelId?: string; manualEvidence?: Array<{ stepId: string; observer: string; observation: string }> },
  transcript: { runId: 'run-1', active: false, turns: [] } as HarnessTranscript,
  runs: [] as Array<{ runId: string; taskUri: string; mode: string; state: string; attempt: number; executor: string; closeout: string; receipts: number; updatedAt: string; local: boolean; repairBudget: { maxAuto: number; usedAuto: number } }>,
}
;(window as any).projectFixture = fixture
const emit = (event: ChatAgentEvent) => events.forEach((listener) => listener(event))
const emitRuntime = (event: unknown) => runtimeEvents.forEach((listener) => listener(event))
Object.assign(window.electron.workspace, { list: async () => workspaces })
Object.assign(window.electron, { janusChat: {
  load: async () => JSON.parse(localStorage.getItem('project-conversations') ?? 'null'),
  save: async (snapshot: unknown) => localStorage.setItem('project-conversations', JSON.stringify(snapshot)),
} })
Object.assign(window.electron.agentRuntime, {
  createSession: async (input: CreateAgentSessionInput) => {
    fixture.runtimeSessions.push(structuredClone(input))
    return { id: input.workspaceId === 'ws' ? 'session' : 'session-b', status: 'running', workspace: { workspaceId: input.workspaceId, workspaceRoot: input.workspaceRoot } }
  },
  cancelSession: async () => true,
  setApprovalMode: async () => true,
  onEvent: (listener: (event: unknown) => void) => { runtimeEvents.add(listener); return () => runtimeEvents.delete(listener) },
  resolveApproval: async () => {
    fixture.approvals++
    emitRuntime({ type: 'tool-started', sessionId: 'session', workspaceId: 'ws', toolName: 'workspace.edit', correlationId: 'call', input: {}, timestamp: Date.now() })
    return true
  },
})
Object.assign(window.electron.llm, {
  getTerminalProviders: async () => [fixture.savedProvider?.settings ?? { id: 'p', name: 'Fixture', extra: { unrelated: 'preserved' } }],
  getChatModelBudget: async (_provider: string, model: string) => {
    if (fixture.catalogMatch) return { contextWindow: 1048576, maxOutputTokens: 65536, source: 'registry', resolved: true }
    const manual = fixture.savedProvider?.settings?.extra?.chatModelLimits?.[model]
    return manual ? { ...manual, source: 'configured', resolved: true }
      : { contextWindow: 16384, maxOutputTokens: 4096, source: 'estimated', resolved: false }
  },
  refreshModelCatalog: async () => { fixture.catalogUpdates++; fixture.catalogMatch = fixture.catalogUpdateMatches; return { success: true } },
  saveTerminalProvider: async (terminal: string, settings: unknown) => { fixture.savedProvider = { terminal, settings }; return { success: true } },
  getTerminalDefault: async () => ({ provider: { id: 'p', name: 'Fixture' }, modelId: 'model-a' }),
  listModels: async () => [{ id: 'model-a', name: 'Model A' }, { id: 'model-b', name: 'Model B' }],
  onAgentEvent: (listener: (event: ChatAgentEvent) => void) => { events.add(listener); return () => events.delete(listener) },
  startChatStream: (request: ChatStreamRequest) => {
    fixture.streams.push(request)
    queueMicrotask(() => {
      if (new URLSearchParams(location.search).has('manual-stream')) return
      emit({ type: 'text_delta', requestId: request.requestId, delta: 'Project reply in progress' })
    })
  },
  abortChat: async () => { fixture.aborts++ },
  steerChat: async () => { fixture.steers++; return { accepted: true } },
  answerQuestion: async ({ requestId, callId }: { requestId: string; callId: string }) => { fixture.answers++; emit({ type: 'question_resolved', requestId, callId, status: 'answered' }); return { accepted: true } },
})
let draft: HarnessTaskDraft = { uri, hash: 'a'.repeat(64), lifecycle: 'draft', repoId, hasExecution: false, contract: { scope: 'Implement the value.', criteria: [{ id: 'AC-1', text: 'TBD' }], work: { scope: [{ repoId, paths: [] }], acceptanceRefs: [], verification: [] } } }
Object.assign(window.electron.harness, {
  noteChatChanges: async () => structuredClone(fixture.noteChanges),
  taskRead: async () => draft,
  taskAdopt: async (_cwd: string, _uri: string, _hash: string, contract: HarnessTaskDraft['contract']) => {
    fixture.adoptions++
    contract.work.verification.push({ id: 'V-manual', kind: 'manual', required: true, repoId, cwd: '.', description: 'Eyeball the value.' })
    draft = { ...draft, hash: 'b'.repeat(64), lifecycle: 'accepted', contract }
    return draft
  },
  runList: async () => fixture.runs,
  runTranscript: async () => structuredClone(fixture.transcript),
  runPrepare: async (_cwd: string, input: { taskUri: string; mode: string; closeout: string; executor?: string }) => {
    fixture.prepares++
    fixture.runs.push({ runId: 'run-1', taskUri: input.taskUri, mode: input.mode, state: 'queued', attempt: 0, executor: input.executor ?? 'internal', closeout: input.closeout, receipts: 0, updatedAt: '', local: true, repairBudget: { maxAuto: 1, usedAuto: 0 } })
    return { runId: 'run-1', taskUri: input.taskUri, state: 'queued', attempt: 0 }
  },
  runStart: async (_cwd: string, runId: string) => {
    fixture.starts++
    const run = fixture.runs.find((item) => item.runId === runId)!
    run.state = 'verifying'
    run.attempt += 1
    return { attempt: run.attempt }
  },
  runStatus: async (_cwd: string, runId: string) => fixture.runs.find((item) => item.runId === runId),
  runCancel: async (_cwd: string, runId: string) => {
    fixture.runs.find((item) => item.runId === runId)!.state = 'cancelled'
    return { state: 'cancelled' }
  },
  runCloseout: async () => ({ satisfied: true, detail: 'run-1 committed' }),
  runHandoff: async () => ({ path: 'C:/fixture/handoff.md' }),
  runExecute: async (_cwd: string, input: NonNullable<typeof fixture.lastExecute>) => {
    fixture.executes++
    fixture.lastExecute = input
    fixture.transcript = { runId: input.runId, active: true, turns: [{
      id: 'turn-1', taskUri: uri, attempt: 1, baselineHash: 'baseline', providerId: 'p', modelId: 'model-a',
      status: 'running', text: 'Reading the accepted task and updating src/value.txt.',
      tools: [{ id: 'edit-1', name: 'workspace.edit', status: 'running' }], truncated: false, startedAt: '', updatedAt: '',
    }] }
    if (fixture.gateExecute) await new Promise<void>((resolve) => { fixture.gateResolve = resolve })
    const run = fixture.runs.find((item) => item.runId === input.runId)!
    run.state = 'done'
    run.receipts = 1
    fixture.transcript.active = false
    fixture.transcript.turns[0].status = 'completed'
    fixture.transcript.turns[0].tools[0].status = 'completed'
    return { receiptId: 'receipt-1', completed: true, checks: [{ id: 'V-1', kind: 'command', status: 'passed', summary: 'exit 0' }] }
  },
  runPause: async (_cwd: string, runId: string) => {
    fixture.pauses++
    fixture.runs.find((item) => item.runId === runId)!.state = 'paused'
    return { state: 'paused' }
  },
  runResume: async (_cwd: string, runId: string) => {
    fixture.resumes++
    fixture.runs.find((item) => item.runId === runId)!.state = 'running'
    return { state: 'running' }
  },
  runRebaseline: async (_cwd: string, runId: string) => {
    fixture.rebaselines++
    fixture.runs.find((item) => item.runId === runId)!.state = 'queued'
    return { state: 'queued' }
  },
  runAbort: async () => {
    fixture.runAborts++
    return { state: 'running' }
  },
  runHandoffRead: async (_cwd: string, runId: string) => {
    const run = fixture.runs.find((item) => item.runId === runId)!
    return { path: 'C:/fixture/handoff.md', markdown: `# Harness run handoff\n\ntask: ${run.taskUri}\nmode: ${run.mode}\ncontract: fixed-baseline\n` }
  },
  runTakeover: async (_cwd: string, runId: string, newOwner: string) => {
    fixture.takeovers++
    const run = fixture.runs.find((item) => item.runId === runId)!
    run.state = 'running'
    return { state: run.state, owner: newOwner }
  },
  runReview: async (_cwd: string, input: { runId: string; reviewer: string }) => {
    fixture.reviews++
    const run = fixture.runs.find((item) => item.runId === input.runId)!
    run.receipts = 1
    return { receiptId: 'r-ind', verdict: 'needs-fix' }
  },
  runFinish: async (_cwd: string, runId: string) => {
    fixture.finishes++
    const run = fixture.runs.find((item) => item.runId === runId)!
    run.state = 'done'
    return { receiptId: 'r-ind', completed: true }
  },
  runRepair: async (_cwd: string, input: { runId: string }) => {
    fixture.repairs++
    const run = fixture.runs.find((item) => item.runId === input.runId)!
    run.state = 'running'
    run.attempt += 1
    run.repairBudget.usedAuto += 1
    return { attempt: run.attempt, state: run.state }
  },
  undoPreview: async () => {
    fixture.undoPreviews++
    if (fixture.undoConflict) return { reversible: false, files: [] }
    return { txId: 'tx-1', changeSetId: 'cs-1', revision: 1, files: [{ operationId: 'op-1', relPath: '.agents/notes/a.md', status: 'reversible', beforeHash: 'b', afterHash: 'a' }], reversible: true }
  },
  undoApply: async () => {
    fixture.undoApplies++
    fixture.noteChanges.forEach(change => { change.reverted = true })
    return { txId: 'tx-2', reverted: ['.agents/notes/a.md'] }
  },
  runThreads: async () => fixture.runs.map((run) => {
    const detail = (fixture as { threadDetails?: Record<string, { model: { providerId: string; modelId: string }; history: Array<{ attempt: number; manifestHash: string; checks: never[]; reviewVerdict: string; receiptId: string; at: string }> }> }).threadDetails?.[run.runId]
    return { runId: run.runId, taskUri: run.taskUri, mode: run.mode, state: run.state, attempt: run.attempt, receipts: run.receipts, updatedAt: '', hasThread: Boolean(detail), attempts: detail ? 1 : 0, lastVerdict: detail?.history[0]?.reviewVerdict, hasModel: Boolean(detail?.model) }
  }),
  runThread: async (_cwd: string, runId: string) => {
    const holder = fixture as unknown as { threadDetails: Record<string, { model: { providerId: string; modelId: string }; history: Array<{ attempt: number; manifestHash: string; checks: never[]; reviewVerdict: string; receiptId: string; at: string }> }> }
    holder.threadDetails ??= {}
    holder.threadDetails[runId] ??= { model: { providerId: 'p', modelId: 'm' }, history: [{ attempt: 1, manifestHash: 'h', checks: [], reviewVerdict: 'approved', receiptId: 'receipt-1', at: '' }] }
    const run = fixture.runs.find((item) => item.runId === runId)!
    const detail = holder.threadDetails[runId]!
    return { runId, taskUri: run.taskUri, mode: run.mode, state: run.state, attempt: run.attempt, receipts: run.receipts, updatedAt: '', hasThread: true, attempts: 1, lastVerdict: 'approved', hasModel: true, model: detail.model, history: detail.history }
  },
  runThreadClose: async (_cwd: string, runId: string) => {
    fixture.threadCloses++
    const holder = fixture as unknown as { threadDetails?: Record<string, unknown> }
    if (holder.threadDetails) delete holder.threadDetails[runId]
    fixture.transcript.turns = []
    return { closed: true }
  },
})

Object.assign(fixture, { emitAgentEvent: emit,
  switchWorkspace: (id: string) => useWorkspaceStore.getState().setActiveWorkspace(id),
  finishStream: () => emit({ type: 'stream_end', requestId: fixture.streams.at(-1)!.requestId, cancelled: false }),
  failStream: () => emit({ type: 'stream_error', requestId: fixture.streams.at(-1)!.requestId, error: 'Fixture provider unavailable' }),
  snapshot: () => ({ graph: { nodeIds: ['target'], nodes: { target: { sourceUri: uri, title: 'Task' } } } }),
})

// Generic second host tests shared chat behavior; it does not represent the downloaded Blueprint UI.
function ProjectPanel({ visible = true }: { visible?: boolean }) {
  const registry = useJanusChatRegistry()
  const [expanded, setExpanded] = useState(true)
  const current = useWorkspaceStore(state => state.workspaces.find(item => item.id === state.activeWorkspaceId))
  const [conversation, setConversation] = useState<string>()
  useEffect(() => {
    if (!registry.persistenceReady || !current) return
    setConversation(registry.bindPanelProject({ domain: 'project', intent: 'discuss', scope: 'view', repoIds: [repoId],
      viewRef: PANEL_REF, noteRefs: [{ uri }] }, [current.id], current.name))
  }, [registry, current])
  const chat = conversation ? registry.getController(conversation) : null
  return <>
    <button className="fixture-project-toggle" onClick={() => setExpanded(value => !value)}>Toggle project discussion</button>
    <section className="fixture-project-chat" hidden={!visible || !expanded} style={{ display: visible && expanded ? "flex" : "none", flexDirection: "column", height: 620, minHeight: 0 }}>
    {chat && <>
      <button className="fixture-project-clear" onClick={chat.clear}>Clear discussion</button>
      <JanusChat visible={visible && expanded} docked compactNavigation minimalComposer focused modeColor="#ff7830" messages={chat.messages}
        pendingContent={chat.pendingContent} isStreaming={chat.isStreaming} error={chat.error} modelOptions={chat.modelOptions}
        activeModel={chat.activeModel} resourceController={chat.resourceController} conversationController={chat}
        onSelectModel={chat.selectModel} onSend={chat.send} onRewrite={chat.rewrite} onStop={chat.stop} onRetry={chat.retry} onClear={chat.clear} />
    </>}
  </section></>
}

function App() {
  const chat = useJanusChatController()
  const projectChat = useOptionalJanusChatController(PANEL_REF)
  const [open, setOpen] = useState(true)
  const [taskOpen, setTaskOpen] = useState(true)
  const [homeId, setHomeId] = useState<string | null>(null)
  return <main>
    <button onClick={() => setOpen((value) => !value)}>Toggle project panel</button>
    <button onClick={() => setTaskOpen((value) => !value)}>Toggle task</button>
    <button onClick={() => chat.selectModel('p', 'model-b')}>Choose model B</button>
    <button onClick={() => { setHomeId((current) => current ?? chat.conversationId); chat.createConversation() }}>New personal chat</button>
    <button onClick={() => homeId && chat.selectConversation(homeId)}>Return to main chat</button>
    <button onClick={() => {
      const request = fixture.streams.at(-1)!
      emit({ type: 'question_requested', requestId: request.requestId, callId: 'q1', allowCustom: true, questions: [{ header: 'Scope', question: 'Which scope?', multiple: false, options: [{ label: 'Selected', description: 'Current task' }, { label: 'All', description: 'Whole project' }] }] })
    }}>Ask question</button>
    <button onClick={() => emitRuntime({ type: 'approval-requested', request: {
      id: 'approval', sessionId: 'session', workspaceId: 'ws', toolName: 'workspace.edit',
      input: {}, correlationId: 'call', evidenceConfidence: 'medium', actionRisk: 'write',
      approvalPolicy: 'per-action', reasonCode: 'ACTION_REQUIRES_APPROVAL', createdAt: new Date().toISOString(),
    } })}>Ask approval</button>
    <output data-testid="controller" data-id={chat.conversationId} data-model={chat.activeModel?.modelId} data-streaming={chat.isStreaming} data-questions={chat.pendingQuestions.length} />
    <output data-testid="project-controller" data-id={projectChat?.conversationId} data-streaming={projectChat?.isStreaming} />
    <div className="fixture-layout">
      <section data-testid="main-chat"><JanusChat visible docked compactNavigation focused={!open} modeColor="#318b78" messages={chat.messages} pendingContent={chat.pendingContent} isStreaming={chat.isStreaming} error={chat.error} modelOptions={chat.modelOptions} activeModel={chat.activeModel} resourceController={chat.resourceController} conversationController={chat} onSelectModel={chat.selectModel} onSend={chat.send} onRewrite={chat.rewrite} onStop={chat.stop} onRetry={chat.retry} onClear={chat.clear} /></section>
      {open ? <section data-testid="project-panel"><ProjectPanel /></section> : null}
      {taskOpen ? <section data-testid="task"><HarnessRunPanel cwd={workspace.path} taskUri={uri} /></section> : null}
    </div>
  </main>
}
function LaunchFixture() {
  const [config, setConfig] = useState({ version: '0.1.0', projectType: ProjectType.Custom, projectName: 'Fixture',
    configurations: [{ name: 'dev', type: ProjectType.Custom, request: 'launch' as const, program: 'start.exe' }] })
  const analysis = { workspaceId: workspace.id, projectPath: '', relativePath: '',
    detection: { type: ProjectType.Custom, confidence: 1, evidence: [], candidates: [] }, candidateConfig: config,
    validation: { valid: true, errors: [], warnings: [] }, files: [], excerpts: [] }
  return <div data-testid="launch-chat" style={{ height: 600, width: 420, display: 'flex' }}>
    <ProjectLaunchAssistant analysis={analysis} config={config} projectPath="" workspaceResources={[{
      workspaceId: workspace.id, workspaceName: workspace.name, workspacePath: workspace.path, agentSessionId: 'session',
    }]} busy={false} runningProjects={[]} onAnalyze={async () => analysis} onConfig={next => {
      ;(fixture as any).configChanges = ((fixture as any).configChanges ?? 0) + 1
      setConfig(next as typeof config)
    }} />
  </div>
}
async function boot() {
  await initI18n(); await changeLanguage('en')
  ReactDOM.createRoot(document.getElementById('root')!).render(<JanusChatProvider>{new URLSearchParams(location.search).has('launch-assistant') ? <LaunchFixture /> : workbench ? <ProjectPanel /> : <App />}</JanusChatProvider>)
}
void boot()
