import React, { useReducer, useState } from 'react'
import ReactDOM from 'react-dom/client'
import { AuthType } from '../../../packages/llm-core/src/core/types'
import type { ApprovalRequest } from '../../../src/shared/ipc/agent-runtime'
import type { ChatStreamEvent, ChatStreamRequest } from '../../../src/shared/ipc/llm'
import { DEFAULT_APP_THEME } from '../../../src/shared/ipc/theme'
import { JanusIsland } from '../../../src/renderer/src/components/janus'
import { JanusRunOrbs } from '../../../src/renderer/src/components/janus/JanusRunOrbs'
import { TitlebarRunButton } from '../../../src/renderer/src/components/TitlebarRunButton'
import { Titlebar } from '../../../src/renderer/src/components/Titlebar'
import { useWorktreeStore } from '../../../src/renderer/src/stores/worktree'
import { useThemeStore } from '../../../src/renderer/src/stores/theme'
import { useGlobalRunning } from '../../../src/renderer/src/components/janus/useGlobalRunning'
import { useWorkflowXDetection } from '../../../src/renderer/src/components/janus/useWorkflowXDetection'
import type { WorkflowXSnapshot } from '../../../src/shared/ipc/workflowx'
import { JanusChatProvider, useJanusChatController } from '../../../src/renderer/src/components/janus/JanusChatProvider'
import { changeLanguage, initI18n } from '../../../src/renderer/src/i18n'
import {
  INITIAL_ISLAND_CONTROLLER_STATE,
  reduceIslandController,
} from '../../../src/renderer/src/components/janus/islandController'
import { installElectronApiFallback } from '../../../src/renderer/src/lib/electron-api-fallback'
import { createTerminalPaneContent, getLeafPanes } from '../../../src/renderer/src/lib/workspace-pane'
import { ProjectType, type RunningProjectSummary } from '../../../src/shared/ipc/project'
import { useWorkspaceStore } from '../../../src/renderer/src/stores/workspace'
import '../../../src/renderer/src/styles/globals.css'
import '../../../src/renderer/src/styles/themes.generated.css'
import '../../../src/renderer/src/components/janus/janus-island.css'

installElectronApiFallback()
const SettingsModal = React.lazy(() => import('../../../src/renderer/src/components/AppSettingsModal').then(module => ({ default: module.AppSettingsModal })))
document.documentElement.dataset.theme = DEFAULT_APP_THEME

const streamListeners = {
  delta: new Set<(payload: ChatStreamEvent) => void>(),
  done: new Set<(payload: ChatStreamEvent) => void>(),
  error: new Set<(payload: ChatStreamEvent) => void>(),
}
let providerAbortCount = 0
let providerStreamCount = 0

Object.assign(window.electron.llm, {
  getTerminalProviders: async () => [
    { id: 'fixture-provider', name: 'Fixture Provider', authType: AuthType.NONE },
  ],
  getTerminalDefault: async () => ({
    provider: { id: 'fixture-provider', name: 'Fixture Provider', authType: AuthType.NONE },
    modelId: 'fixture-model',
  }),
  listModels: async () => [],
  startChatStream: (request: ChatStreamRequest) => {
    providerStreamCount += 1
    const prompt = request.messages.at(-1)?.content
    queueMicrotask(() => {
      if (prompt === 'Create error status') {
        streamListeners.error.forEach((listener) => listener({ requestId: request.requestId, error: 'Fixture stream error' }))
      } else {
        streamListeners.delta.forEach((listener) => listener({ requestId: request.requestId, delta: 'Provider pending stream' }))
      }
    })
  },
  abortChat: async () => {
    providerAbortCount += 1
  },
  onDelta: (listener: (payload: ChatStreamEvent) => void) => {
    streamListeners.delta.add(listener)
    return () => streamListeners.delta.delete(listener)
  },
  onDone: (listener: (payload: ChatStreamEvent) => void) => {
    streamListeners.done.add(listener)
    return () => streamListeners.done.delete(listener)
  },
  onError: (listener: (payload: ChatStreamEvent) => void) => {
    streamListeners.error.add(listener)
    return () => streamListeners.error.delete(listener)
  },
})

const conversationFixture = {
  version: 1,
  activeConversationId: 'thread-streaming',
  conversations: [
    {
      id: 'thread-streaming',
      title: 'Streaming thread',
      createdAt: 1,
      updatedAt: 2,
      messages: [],
      attachedWorkspaceIds: [],
      toolTraces: [],
    },
    {
      id: 'thread-other',
      title: 'Other thread',
      createdAt: 1,
      updatedAt: 1,
      messages: [],
      attachedWorkspaceIds: [],
      toolTraces: [],
    },
  ],
}

Object.assign(window.electron, {
  janusChat: {
    load: async () => conversationFixture,
    save: async () => undefined,
  },
})

const workspaceOne = {
  id: 'workspace-1',
  name: 'Workspace One',
  path: 'C:\\workspace-one',
  clis: [],
  layout: { mode: 'tabs' as const, positions: [] },
  createdAt: '2026-07-26T00:00:00.000Z',
  updatedAt: '2026-07-26T00:00:00.000Z',
}
const workspaceTwo = {
  ...workspaceOne,
  id: 'workspace-2',
  name: 'Workspace Two',
  path: 'C:\\workspace-two',
}
const workspaceThree = {
  ...workspaceOne,
  id: 'workspace-3',
  name: 'Workspace Three',
  path: 'C:\\workspace-three',
}
const workspaceTwoPane = {
  type: 'leaf' as const,
  id: 'pane-terminal-two',
  tabs: [createTerminalPaneContent('terminal-2', 'workspace-2')],
  activeTabId: 'terminal:terminal-2',
}

/*-- Run-Orb fixture (?runOrbs=1)：双工作区运行 + 可变 stop mock，供运行球 E2E --*/
interface RunOrbFixtureState {
  stopCalls: string[]
  startCalls: string[]
  noConfig: boolean
  failStart: boolean
  readDelayMs: number
  running: RunningProjectSummary[]
}

const runOrbFixture: RunOrbFixtureState = {
  stopCalls: [],
  startCalls: [],
  noConfig: false,
  failStart: false,
  readDelayMs: 0,
  running: [
    {
      id: 'C:\\workspace-one::dev::1',
      pid: 111,
      type: ProjectType.Vite,
      name: 'dev',
      port: 5173,
      startTime: new Date(Date.now() - 65000).toISOString(),
      uptime: 65000,
    },
    {
      id: 'C:\\workspace-two::dev::2',
      pid: 222,
      type: ProjectType.Vite,
      name: 'dev',
      startTime: new Date(Date.now() - 5000).toISOString(),
      uptime: 5000,
    },
  ],
}

;(window as unknown as { __runOrbFixture?: RunOrbFixtureState }).__runOrbFixture = runOrbFixture
Object.assign(window, {
  __setRunTarget: (path: string) => useWorktreeStore.setState(state => ({ activePaths: { ...state.activePaths, 'workspace-1': path } })),
  __applyRunTheme: (theme: 'dark' | 'planche') => useThemeStore.getState().applyExternal(theme),
})

if (new URLSearchParams(window.location.search).get('runOrbs') === '1') {
  Object.assign(window.electron.project, {
    list: async () => ({ success: true, data: [...runOrbRunningSnapshot()] }),
    get: async (projectId: string) => {
      const found = runOrbRunningSnapshot().find((project) => project.id === projectId)
      if (!found) return { success: false, error: `Project ${projectId} is not running` }
      return {
        success: true,
        data: {
          pid: found.pid,
          config: { name: 'dev', configurations: [] as never[] },
          startTime: found.startTime,
          port: found.port,
          output: [`${found.name} ready in 300 ms`, `Local: http://localhost/${found.port ?? ''}`],
        },
      }
    },
    stop: async (projectId: string) => {
      runOrbFixture.stopCalls.push(projectId)
      runOrbFixture.running = runOrbFixture.running.filter((project) => project.id !== projectId)
      return { success: true }
    },
    readConfig: async () => {
      if (runOrbFixture.readDelayMs) await new Promise(resolve => setTimeout(resolve, runOrbFixture.readDelayMs))
      return { success: true, data: runOrbFixture.noConfig ? null : { configurations: [{ name: 'dev', type: ProjectType.Vite }] } }
    },
    run: async (path: string, _config: string, options: { identity?: { workspaceId: string; scopePath: string; branch?: string } }) => {
      runOrbFixture.startCalls.push(path)
      if (runOrbFixture.failStart) return { success: false, error: 'fixture start failure' }
      runOrbFixture.running.push({ id: `${path}::dev::${Date.now()}`, pid: 333, type: ProjectType.Vite, name: 'dev', startTime: new Date().toISOString(), uptime: 0, ...options.identity })
      return { success: true, data: [] }
    },
  })
}

function runOrbRunningSnapshot() {
  return runOrbFixture.running
}

/** 运行球挂载位：快速轮询（200ms）+ 球簇，仅 ?runOrbs=1 渲染 */
function RunOrbHarnessMount() {
  useGlobalRunning(200)
  return <>
    <div style={{ position: 'fixed', top: 6, right: 160 }}><TitlebarRunButton /></div>
    <JanusRunOrbs />
  </>
}

useWorkspaceStore.setState({
  workspaces: [workspaceOne, workspaceTwo, workspaceThree],
  activeWorkspaceId: 'workspace-1',
  activeTerminalId: 'terminal-1',
  paneTree: {
    type: 'leaf',
    id: 'pane-terminal',
    tabs: [createTerminalPaneContent('terminal-1', 'workspace-1')],
    activeTabId: 'terminal:terminal-1',
  },
  focusedPaneId: 'pane-terminal',
  focusedTabId: 'terminal:terminal-1',
  terminalSnapshots: {
    'workspace-2': {
      terminals: [{
        id: 'terminal-2',
        workspaceId: 'workspace-2',
        name: 'Terminal 2',
        preset: 'shell',
        cwd: workspaceTwo.path,
        shell: 'powershell',
        pid: null,
        status: 'wait',
      }],
      activeTerminalId: 'terminal-2',
      paneTree: workspaceTwoPane,
      focusedPaneId: workspaceTwoPane.id,
      focusedTabId: workspaceTwoPane.activeTabId,
    },
  },
})

const controllerData = {
  messages: [
    { id: 'prompt-one', role: 'user' as const, content: 'First recalled prompt', timestamp: 1 },
    { id: 'shared-message', role: 'assistant' as const, content: 'Shared controller message', timestamp: 2 },
    { id: 'prompt-two', role: 'user' as const, content: 'Latest recalled prompt', timestamp: 3 },
    { id: 'latest-response', role: 'assistant' as const, content: 'Latest controller response', timestamp: 4 },
  ],
  error: null,
  modelOptions: [
    { providerId: 'provider-a', providerName: 'Provider A', modelId: 'model-a1', label: 'Provider A / model-a1', isDefault: true, isProviderDefault: true },
    { providerId: 'provider-a', providerName: 'Provider A', modelId: 'model-a2', label: 'Provider A / model-a2', isDefault: false, isProviderDefault: false },
    { providerId: 'provider-b', providerName: 'Provider B', modelId: 'model-b1', label: 'Provider B / model-b1', isDefault: false, isProviderDefault: true },
  ],
  modelNotice: null,
}

const approvalFixture: ApprovalRequest = {
  id: 'approval-fixture',
  sessionId: 'session-fixture',
  workspaceId: 'workspace-1',
  correlationId: 'call-fixture',
  toolName: 'workspace.edit',
  input: {},
  evidenceConfidence: 'medium',
  actionRisk: 'write',
  approvalPolicy: 'per-action',
  reasonCode: 'ACTION_REQUIRES_APPROVAL',
  preview: {
    summary: 'Edit README.md with 1 exact replacement',
    paths: ['README.md'],
    detail: 'Replacement 1\n- Previous project summary\n+ Updated project summary',
    truncated: false,
  },
  createdAt: '2026-07-31T00:00:00.000Z',
}

function Harness() {
  useWorkflowXDetection()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const providerStreamMode = new URLSearchParams(window.location.search).get('providerStream') === '1'
  const runOrbsMode = new URLSearchParams(window.location.search).get('runOrbs') === '1'
  const activeConversation = useJanusChatController()
  const streamingConversation = useJanusChatController('thread-streaming')
  const errorConversation = useJanusChatController('thread-other')
  const [island, dispatch] = useReducer(reduceIslandController, INITIAL_ISLAND_CONTROLLER_STATE)
  const [singleCount, setSingleCount] = useState(0)
  const [doubleCount, setDoubleCount] = useState(0)
  const [callbackVersion, setCallbackVersion] = useState(1)
  const [calledVersion, setCalledVersion] = useState(0)
  const [activeModel, setActiveModel] = useState(controllerData.modelOptions[0])
  const [clearCount, setClearCount] = useState(0)
  const [lastSentPrompt, setLastSentPrompt] = useState('')
  const [lastRewrite, setLastRewrite] = useState({ messageId: '', content: '' })
  const [displayMessages, setDisplayMessages] = useState(controllerData.messages)
  const [stopCount, setStopCount] = useState(0)
  const [isStreaming, setIsStreaming] = useState(true)
  const [approvalPending, setApprovalPending] = useState(
    () => new URLSearchParams(window.location.search).get('approval') === '1',
  )
  const [approvalDecision, setApprovalDecision] = useState('pending')
  const paneTree = useWorkspaceStore((state) => state.paneTree)
  const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId)
  const terminalTabCount = getLeafPanes(paneTree).flatMap((leaf) => leaf.tabs).filter((tab) => tab.type === 'terminal').length

  const manualController = {
    ...controllerData,
    messages: displayMessages,
    activeModel,
    isStreaming,
    pendingContent: isStreaming ? 'Shared pending stream' : '',
  }
  const chatProps = {
    ...manualController,
    modeColor: '#ff7830',
    onSelectModel: (providerId: string, modelId: string) => {
      const next = controllerData.modelOptions.find((option) =>
        option.providerId === providerId && option.modelId === modelId)
      if (next) setActiveModel(next)
    },
    onSend: (text: string) => setLastSentPrompt(text),
    onRewrite: (messageId: string, text: string) => {
      setLastRewrite({ messageId, content: text })
      setDisplayMessages((current) => {
        const messageIndex = current.findIndex((message) => message.id === messageId)
        if (messageIndex < 0) return current
        return [...current.slice(0, messageIndex), { ...current[messageIndex], content: text }]
      })
    },
    onStop: () => setStopCount((count) => count + 1),
    onRetry: () => undefined,
    onClear: () => setClearCount((count) => count + 1),
    onOpenLlmConfig: () => undefined,
  }
  const resourceController = {
    resources: [
      { workspaceId: 'workspace-1', workspaceName: 'Workspace One', workspacePath: workspaceOne.path },
      { workspaceId: 'workspace-2', workspaceName: 'Workspace Two', workspacePath: workspaceTwo.path },
    ],
    availableWorkspaces: [workspaceOne, workspaceTwo, workspaceThree],
    attachWorkspace: () => undefined,
    detachWorkspace: () => undefined,
    activities: [],
    pendingApprovals: approvalPending ? [approvalFixture] : [],
    resolveApproval: (_approvalId: string, approved: boolean) => {
      setApprovalDecision(approved ? 'approved' : 'rejected')
      setApprovalPending(false)
    },
  }
  const controller = providerStreamMode ? {
    messages: activeConversation.messages,
    pendingContent: activeConversation.pendingContent,
    isStreaming: activeConversation.isStreaming,
    error: activeConversation.error,
    modelOptions: activeConversation.modelOptions,
    activeModel: activeConversation.activeModel,
    modelNotice: activeConversation.modelNotice,
  } : manualController
  const providerChatProps = {
    onChatSelectModel: activeConversation.selectModel,
    onChatSend: activeConversation.send,
    onChatRewrite: activeConversation.rewrite,
    onChatStop: activeConversation.stop,
    onChatRetry: activeConversation.retry,
    onChatClear: activeConversation.clear,
  }

  return (
    <main
      data-testid="harness"
      data-stage={island.stage}
      data-single-count={singleCount}
      data-double-count={doubleCount}
      data-called-version={calledVersion}
      data-active-provider={activeModel.providerId}
      data-active-model={activeModel.modelId}
      data-clear-count={clearCount}
      data-last-sent-prompt={lastSentPrompt}
      data-last-rewrite-id={lastRewrite.messageId}
      data-last-rewrite-content={lastRewrite.content}
      data-stop-count={stopCount}
      data-terminal-tab-count={terminalTabCount}
      data-active-workspace={activeWorkspaceId}
      data-pane-ratio={paneTree?.type === 'split' ? paneTree.ratio : 'single'}
      data-pane-tabs={getLeafPanes(paneTree).flatMap((leaf) => leaf.tabs).map((tab) => tab.type).join(',')}
      data-approval-decision={approvalDecision}
      data-provider-abort-count={providerAbortCount}
      data-provider-stream-count={providerStreamCount}
      data-provider-streaming={streamingConversation.isStreaming}
      data-provider-error={errorConversation.error ?? ''}
    >
      <button data-testid="replace-single" onClick={() => setCallbackVersion(2)}>Replace single callback</button>
      <button data-testid="reopen-island" onClick={() => dispatch({ type: 'double-activate' })}>Reopen Island</button>
      <button data-testid="open-general-settings" onClick={() => setSettingsOpen(true)}>Open general settings</button>
      {settingsOpen && <React.Suspense fallback={null}><SettingsModal isOpen onClose={() => setSettingsOpen(false)} /></React.Suspense>}
      <button data-testid="toggle-streaming" onClick={() => setIsStreaming((value) => !value)}>Toggle streaming</button>
      <button data-testid="start-provider-stream" onClick={() => streamingConversation.send('Keep provider stream pending')}>Start provider stream</button>
      <button data-testid="fail-provider-thread" onClick={() => errorConversation.send('Create error status')}>Fail provider thread</button>
      <button data-testid="switch-empty-workspace" onClick={() => useWorkspaceStore.getState().setActiveWorkspace('workspace-3')}>
        Switch empty workspace
      </button>
      <JanusIsland
        stage={island.stage}
        onSingleActivate={() => {
          setSingleCount((count) => count + 1)
          setCalledVersion(callbackVersion)
          dispatch({ type: 'single-activate' })
        }}
        onDoubleActivate={() => {
          setDoubleCount((count) => count + 1)
          dispatch({ type: 'double-activate' })
        }}
        onDismiss={() => dispatch({ type: 'dismiss' })}
        {...controller}
        onChatSelectModel={providerStreamMode ? providerChatProps.onChatSelectModel : chatProps.onSelectModel}
        onChatSend={providerStreamMode ? providerChatProps.onChatSend : chatProps.onSend}
        onChatRewrite={providerStreamMode ? providerChatProps.onChatRewrite : chatProps.onRewrite}
        onChatStop={providerStreamMode ? providerChatProps.onChatStop : chatProps.onStop}
        onChatRetry={providerStreamMode ? providerChatProps.onChatRetry : chatProps.onRetry}
        onChatClear={providerStreamMode ? providerChatProps.onChatClear : chatProps.onClear}
        onOpenLlmConfig={() => undefined}
        resourceController={resourceController}
        knowledgeTrace={null}
        knowledgePeekActive={island.knowledge.presentation !== 'hidden'}
        knowledgePeekEmpty={island.knowledge.presentation === 'empty'}
      />
      {runOrbsMode && <RunOrbHarnessMount />}
    </main>
  )
}

async function boot() {
  const workflowxMode = new URLSearchParams(location.search).get('workflowx')
  if (workflowxMode) {
    const fixture = {
      calls: [] as (string | null)[],
      opened: 0,
      status: workflowxMode === 'global' ? 'detected' : workflowxMode as WorkflowXSnapshot['status'],
      fail: false,
      sourceScope: 'global' as 'global' | 'workspace',
      setWorkspace: (id: string | null) => useWorkspaceStore.setState({ activeWorkspaceId: id, activeTerminalId: null, terminals: [] }),
    }
    Object.assign(window, { workflowxFixture: fixture })
    if (workflowxMode === 'global') useWorkspaceStore.setState({ workspaces: [], activeWorkspaceId: null, activeTerminalId: null, terminals: [] })
    window.electron.workflowx = {
      detect: async workspaceId => {
        fixture.calls.push(workspaceId)
        if (fixture.fail) throw new Error("Error invoking remote method 'workflowx:detect': [object Object]")
        return { workspaceId, checkedAt: Date.now(), status: fixture.status, sources: fixture.status === 'detected'
          ? [{ format: 'codex', scope: fixture.sourceScope, path: fixture.sourceScope === 'global' ? 'C:/Users/Developer/.codex/skills/orchestrateX/SKILL.md' : `C:/Projects/${workspaceId}/.codex/skills/orchestrateX/SKILL.md`, status: 'detected', reason: 'skill' }] : [] }
      },
      openRepository: async () => { fixture.opened++; return true },
    }
  }
  // Specs assert English copy; pin the language so host locale cannot flip it.
  await initI18n()
  await changeLanguage('en')
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <JanusChatProvider>
      {new URLSearchParams(location.search).has('titlebar') ? <Titlebar /> : <Harness />}
    </JanusChatProvider>,
  )
}

void boot()
