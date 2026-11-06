import { useRightToolStore } from '../../../src/renderer/src/stores/right-tools'
import React, { useState } from 'react'
import ReactDOM from 'react-dom/client'
import { PNG_PIXEL } from '../../helpers/image-fixture'
import { AgentSessionPane } from '../../../src/renderer/src/components/AgentSessionPane'
import { installElectronApiFallback } from '../../../src/renderer/src/lib/electron-api-fallback'
import { useWorkspaceStore } from '../../../src/renderer/src/stores/workspace'
import { useThemeStore } from '../../../src/renderer/src/stores/theme'
import { changeLanguage, initI18n } from '../../../src/renderer/src/i18n'
import { CODEX_CONVERSATION_CAPABILITIES, type ConversationCommand, type ConversationSnapshot } from '../../../src/shared/conversation-display'
import '../../../src/renderer/src/styles/globals.css'
import '../../../src/renderer/src/styles/themes.generated.css'

installElectronApiFallback()
Object.assign(window.electron.system, { getLanguage: async () => 'en' })
const claude = new URLSearchParams(location.search).get('engine') === 'claude'
const extraEngine = new URLSearchParams(location.search).get('engine')
const initialView = new URLSearchParams(location.search).get('initialView') === 'conversation' ? 'conversation' : 'terminal'
let pendingStartup = new URLSearchParams(location.search).has('pendingStartup')
useThemeStore.getState().applyExternal(new URLSearchParams(location.search).get('theme') === 'light' ? 'planche' : new URLSearchParams(location.search).get('theme') ?? 'dark')
useWorkspaceStore.setState({ activeWorkspaceId: 'ws', terminals: [{ id: 'codex', workspaceId: 'ws', name: 'Codex', preset: 'codex', cwd: 'C:/fixture', shell: 'powershell.exe', pid: 42, status: 'wait', conversationEnabled: true, conversationInitialView: initialView }], activeTerminalId: 'codex' })
const state: ConversationSnapshot = { id: 'codex', engine: 'codex', capabilities: CODEX_CONVERSATION_CAPABILITIES, revision: 1, mode: 'terminal', controlEpoch: 0, connection: 'ready', threadId: 'native-thread', turnId: null, submitting: false, items: [], approvals: [], needsTerminal: false, truncated: false,
  serviceTier: null, model: 'fixture-fast', effort: 'medium', modelsLoading: false, settingsUpdating: false, models: [
    { model: 'fixture-fast', fastTier: 'fast', displayName: 'Fixture Fast', description: 'A fast local test model', defaultEffort: 'medium', efforts: [
      { effort: 'low', description: 'Quick responses for straightforward work' }, { effort: 'medium', description: 'Balanced reasoning' },
      { effort: 'high', description: 'More detailed reasoning' }, { effort: 'xhigh', description: 'Extra reasoning for complex tasks' },
      { effort: 'max', description: 'Maximum reasoning depth' }, { effort: 'ultra', description: 'Maximum reasoning with automatic task delegation' },
    ] },
    { model: 'fixture-deep', displayName: 'Fixture Deep', description: 'A model for complex test tasks', defaultEffort: 'high', efforts: [{ effort: 'high', description: 'Detailed reasoning' }, { effort: 'xhigh', description: 'Extra reasoning' }] },
  ] }
state.mode = initialView
if (claude) {
  state.capabilities = { ...state.capabilities, edit: false, newThread: false, steer: false }
  state.engine = 'claude'; state.model = 'claude-sonnet-4-6'; state.effort = 'medium'
  state.ultracode = { enabled: false, available: true, model: state.model }
  state.models = [
    { model: 'claude-sonnet-4-6', displayName: 'Sonnet', description: 'Native Sonnet option', defaultEffort: null, efforts: ['low', 'medium', 'high'].map(effort => ({ effort, description: '' })) },
    { model: 'claude-opus-4-6', displayName: 'Opus', description: 'Native Opus option', defaultEffort: null, efforts: ['low', 'medium', 'high', 'max'].map(effort => ({ effort, description: '' })) },
  ]
}
const listeners = new Set<(s: ConversationSnapshot) => void>()
if (extraEngine === 'opencode' || extraEngine === 'pi' || extraEngine === 'dsh') {
  state.engine = extraEngine
  state.capabilities = { submit: true, cancel: true, settings: extraEngine === 'opencode', edit: extraEngine === 'opencode', approvals: false, liveText: true, liveInput: extraEngine === 'opencode', steer: extraEngine === 'opencode' }
  state.models = []
  if (extraEngine === 'opencode') {
    state.model = 'fixture/fast'; state.effort = 'default'
    state.models = [
      { model: 'fixture/fast', displayName: 'Fast', provider: { id: 'fixture', name: 'fixture' }, description: 'fixture/fast', defaultEffort: 'default', efforts: [{ effort: 'default', description: '' }] },
      { model: 'fixture/deep', displayName: 'Deep', provider: { id: 'fixture', name: 'fixture' }, description: 'fixture/deep', defaultEffort: 'default', efforts: [{ effort: 'default', description: '' }, { effort: 'careful', description: '' }] },
    ]
  }
}
const calls = { commands: [] as ConversationCommand[], create: 0, kill: 0, sends: [] as string[], input: [] as string[], approvals: [] as string[], opens: [] as string[], settings: [] as Array<{ model: string; effort: string | null }> }
const startupCalls: string[] = []
let settingsFailure = false
let editAfterRevertFailure = false
let sendGate: Promise<void> | null = null
let settleSend: ((fail: boolean) => void) | null = null
let modeGate: Promise<void> | null = null
let settleMode: ((fail: boolean) => void) | null = null
let historyReads = 0
let trackHistoryReads = false
const measuredSnapshot = () => {
  const next = structuredClone(state)
  if (trackHistoryReads) for (const item of next.items) {
    const text = item.text
    Object.defineProperty(item, 'text', { enumerable: true, get: () => { historyReads++; return text } })
  }
  return next
}
const publish = () => { state.revision++; for (const listener of listeners) listener(measuredSnapshot()) }
Object.assign(window.electron.terminal, {
  saveConversationImage: async (_id: string, itemId: string, imageId: string) => { calls.opens.push(`image:${itemId}:${imageId}`); return { canceled: false } },
  create: async () => { calls.create++; return { pid: 42 } }, kill: async () => { calls.kill++; return { success: true } },
  replay: async () => ({ data: 'Native Codex terminal\r\n› ', seq: 1 }),
  input: (_id: string, data: string) => { calls.input.push(data) },
  conversation: async () => pendingStartup ? null : structuredClone(state),
  onConversation: (callback: (s: ConversationSnapshot) => void) => { listeners.add(callback); return () => listeners.delete(callback) },
  conversationCommand: async (_id: string, command: ConversationCommand) => {
    calls.commands.push(structuredClone(command))
    if (command.type === 'mode') {
      if (modeGate) await modeGate
      state.mode = command.mode; state.controlEpoch++
    }
    else if (command.type === 'startup' && state.startup) {
      startupCalls.push(command.action)
      if (command.action === 'cancel') state.startup = { ...state.startup, status: 'cancelled', authUrl: undefined }
      else if (command.action === 'resume') state.startup = { ...state.startup, status: 'pending' }
      else if (command.action === 'login') state.startup = { ...state.startup, status: 'waiting', authUrl: 'https://auth.openai.com/authorize?state=fixture' }
      else {
        state.startup = undefined; state.connection = 'ready'; state.threadId = 'native-thread'; state.model = 'fixture-fast'; state.effort = 'high'
      }
    }
    else if (command.type === 'terminal-command' || command.type === 'invoke' && state.commands?.find(entry => entry.id === command.entryId)?.execution === 'terminal') {
      state.mode = 'terminal'; state.controlEpoch++
    }
    else if (command.type === 'speed') {
      if (settingsFailure) throw new Error('Fixture settings update failed')
      state.serviceTier = command.fast ? 'fast' : null
    }
    else if (command.type === 'ultracode') {
      if (settingsFailure) throw new Error('Fixture settings update failed')
      state.ultracode = { ...state.ultracode!, enabled: command.enabled }
    }
    else if (command.type === 'settings') {
      if (settingsFailure) throw new Error('Fixture settings update failed')
      calls.settings.push({ model: command.model, effort: command.effort }); state.model = command.model; state.effort = command.effort
    } else if (command.type === 'new') {
      state.threadId = `new-${state.revision}`; state.items = []; state.plans = []; state.controlEpoch++
    } else if (command.type === 'models') { state.modelsError = undefined }
    else if (command.type === 'send' || command.type === 'edit') {
      calls.sends.push(command.text)
      if (sendGate) await sendGate
      if (command.type === 'edit') {
        const target = state.items.findIndex(item => item.id === command.itemId)
        if (target < 0) throw new Error('Message no longer exists')
        state.items = state.items.slice(0, target); state.plans = []
        if (editAfterRevertFailure) { state.connection = 'disconnected'; publish(); throw new Error('Edit delivery could not be confirmed') }
      }
      state.turnId = `turn-${calls.sends.length}`; state.turnStartedAt = Date.now();
      state.items.push({ id: `user-${calls.sends.length}`, receivedAt: Date.now(), turnId: state.turnId, type: 'userMessage', text: command.text, status: 'completed' }, { id: `answer-${calls.sends.length}`, receivedAt: Date.now(), turnId: state.turnId, type: 'agentMessage', text: '', status: 'inProgress' })
    } else if (command.type === 'approve') { calls.approvals.push(command.decision); state.approvals = [] }
    else if (command.type === 'answer') {
      const request = state.questions?.find(row => row.id === command.requestId && row.version === command.version)
      if (!request) throw new Error('Question expired')
      request.status = 'submitting'; publish()
      if (sendGate) await sendGate
      state.questions = state.questions?.filter(row => row !== request)
    }
    else if (command.type === 'interrupt') { state.turnId = null; state.backgroundTasks = 0 }
    publish(); return structuredClone(state)
  },
})
Object.assign(window.electron.window, { openEditor: async ({ filePath }: { filePath: string }) => { calls.opens.push(filePath) } })
Object.assign(window.electron.fileTree, { children: async (_root: string, directory: string) => directory === 'src/' ? [{ name: 'app.ts', path: 'src/app.ts', type: 'file' }] : [{ name: 'src', path: 'src', type: 'directory' }] })
Object.assign(window.electron.file, { importConversationAttachment: async (name: string) => ({ id: crypto.randomUUID(), name, path: 'C:/attachments/' + name, kind: name.endsWith('.png') ? 'image' : 'file' }), openPreviewLink: async (url: string) => { calls.opens.push(url) } })
Object.assign(window, { codexFixture: {
  providerModels: () => {
    state.models = [
      ['opencode-go', 'OpenCode Go', 'shared', 'Shared model'],
      ['opencode', 'OpenCode Zen', 'shared', 'Shared model'],
      ['team', 'Team gateway', 'shared', 'Shared model'],
      ['opencode-go', 'OpenCode Go', 'fast', 'Fast model'],
      ['team', 'Team gateway', 'local/special', 'Local model'],
      ['edge', 'Company gateway with a very long provider name', 'local', 'Long custom model display name for small panes'],
    ].map(([id, name, model, displayName]) => ({ model: `${id}/${model}`, provider: { id, name }, displayName, description: `${id}/${model}`,
      defaultEffort: 'default', efforts: [{ effort: 'default', description: '' }, ...(id === 'team' ? [{ effort: 'careful', description: '' }] : [])] }))
    state.model = 'opencode-go/shared'; state.effort = 'default'; publish()
  },
  questions: (kind = 'mixed') => {
    state.questions = [{ id: 'question', version: state.revision, cancelable: true, status: 'pending', questions: kind === 'text' ? [
      { id: 'text', text: 'Type something', options: [], allowText: true },
    ] : [
      { id: 'confirm', header: 'Confirmation', text: 'Proceed?', options: [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }] },
      { id: 'checks', header: 'Checks', text: 'Select checks', multiple: true, allowText: true, options: [{ id: 'unit', label: 'Unit tests', description: 'Run local tests' }, { id: 'browser', label: 'Browser tests', description: 'Verify the interaction' }] },
      { id: 'text', text: 'Type something', options: [], allowText: true },
    ] }]; publish()
  },
  expireQuestions: () => { state.questions = []; publish() },
  approvalChoices: () => {
    state.approvals = [{ id: 'approval', itemId: 'tool', kind: 'command', description: 'npm test', choices: [
      { id: 'accept', label: 'Allow once' }, { id: 'acceptForSession', label: 'Allow for this session' },
      { id: 'decline', label: 'Decline' }, { id: 'cancel', label: 'Decline and stop' },
      { id: 'policy', label: 'Always allow commands matching: npm test --workspace=long-fixture-workspace' },
    ] }]; publish()
  },
  historyReads: () => historyReads,
  longHistory: () => {
    state.items = Array.from({ length: 100 }, (_, index) => [
      { id: 'long-user-' + index, turnId: 'long-' + index, type: 'userMessage', text: 'Review change ' + index, status: 'completed' },
      { id: 'long-tool-' + index, turnId: 'long-' + index, type: 'commandExecution', text: 'Read source and run checks\n' + 'Tool output\n'.repeat(40), status: 'completed' },
      { id: 'long-file-' + index, turnId: 'long-' + index, type: 'fileChange', text: 'Updated source', status: 'completed', files: [{ path: 'src/file-' + index + '.ts', diff: '@@ -1,20 +1,20 @@\n' + '-before\n+after\n'.repeat(20) }] },
      { id: 'long-answer-' + index, turnId: 'long-' + index, type: 'agentMessage', text: '## Result ' + index + '\n\n' + 'Verified the change. '.repeat(30), status: 'completed', phase: 'final_answer' as const },
    ]).flat()
    state.turnId = null; state.approvals = []; trackHistoryReads = true; publish()
  },
  generatedImage: (missing = false) => {
    Object.assign(window.electron.file, { readBinary: async () => missing ? { error: 'Missing file' } : { base64: PNG_PIXEL, mimeType: 'image/png', size: 68 } })
    state.turnId = null
    state.items = [
      { id: 'image-user', turnId: 'image-turn', type: 'userMessage', text: 'Draw a sample', status: 'completed' },
      { id: 'image-item', turnId: 'image-turn', type: 'imageGeneration', text: 'Sample image', status: 'completed', images: [{ id: 'image-file', path: missing ? 'C:/fixture/missing.png' : 'C:/fixture/generated.png', mimeType: 'image/png', status: 'ready' }] },
      { id: 'image-answer', turnId: 'image-turn', type: 'agentMessage', text: 'Image ready', status: 'completed' },
    ]; publish()
  },
  reviewProject: (path: string) => useWorkspaceStore.setState({ workspaces: [{ id: 'ws', name: 'Fixture', path, clis: [], layout: { mode: 'tabs', positions: [] }, createdAt: '', updatedAt: '' }] }),
  reviewTool: () => useRightToolStore.getState().activeToolId,
  calls,
  catalog: () => {
    state.capabilities = { ...state.capabilities, commands: true }
    state.commands = [{ id: 'native-review', name: state.engine === 'pi' ? 'skill:review' : state.engine === 'opencode' ? 'team/review' : 'review',
      label: 'Review', description: 'Inspect the selected work', kind: 'skill', source: state.engine, execution: state.engine === 'claude' ? 'terminal' : 'native' }]
    state.commandsRevision = 1; publish()
  },
  startupCalls,
  setup: (kind: 'login' | 'trust' | 'hooks') => {
    pendingStartup = false; state.connection = 'starting'; state.threadId = null
    state.startup = { id: 1, kind, status: 'pending', ...(kind === 'trust' ? { directory: 'C:/fixture/project' } : {}),
      ...(kind === 'hooks' ? { hooks: [{ key: 'fixture', event: 'SessionStart', source: 'C:/fixture/hooks.json', command: 'fixture-hook --session-start' }] } : {}) }; publish()
  },
  starting: () => {
    pendingStartup = false
    state.connection = 'starting'; state.threadId = null; state.model = null; state.effort = null; publish()
  },
  ready: () => {
    state.startup = undefined
    state.connection = 'ready'; state.threadId = 'native-thread'; state.model = 'fixture-fast'; state.effort = 'high'; publish()
  },
  readOnly: () => { state.capabilities = { ...state.capabilities, submit: false }; publish() },
  editFailure: () => { editAfterRevertFailure = true },
  editPreview: () => {
    state.items = ['Earlier question', 'Original question', 'Later question'].flatMap((text, index) => [
      { id: `user-${index}`, turnId: `turn-${index}`, type: 'userMessage', text, status: 'completed' },
      { id: `answer-${index}`, turnId: `turn-${index}`, type: 'agentMessage', text: `Answer to ${text}`, status: 'completed' },
    ]); state.turnId = null; publish()
  },
  holdSend: () => {
    sendGate = new Promise<void>((resolve, reject) => {
      settleSend = fail => { sendGate = null; settleSend = null; if (fail) reject(new Error('Fixture send failed')); else resolve() }
    })
  },
  releaseSend: (fail = false) => settleSend?.(fail),
  plan: (complete = false) => {
    state.plans = [...(state.plans ?? []), { turnId: state.turnId!, version: (state.plans?.at(-1)?.version ?? 0) + 1,
      explanation: 'Implement conversation improvements', outcome: 'running' as const,
      steps: [{ step: 'Inspect protocol', status: 'completed' as const }, { step: 'Build interface', status: complete ? 'completed' as const : 'inProgress' as const }, { step: 'Run checks', status: complete ? 'completed' as const : 'pending' as const }] }]
    publish()
  },
  endPlan: (outcome: 'completed' | 'interrupted' | 'failed') => {
    state.plans = state.plans?.map(plan => ({ ...plan, outcome })); state.turnId = null; publish()
  },
  stalePlan: () => { const plan = state.plans?.at(-1); if (plan) plan.stale = true; publish() },
  holdMode: () => {
    modeGate = new Promise<void>((resolve, reject) => {
      settleMode = fail => { modeGate = null; settleMode = null; if (fail) reject(new Error('Fixture mode switch failed')); else resolve() }
    })
  },
  releaseMode: (fail = false) => settleMode?.(fail),
  delta: (text: string) => { state.items.filter(item => item.type === 'agentMessage').at(-1)!.text += text; publish() },
  finish: () => { const answer = state.items.filter(item => item.type === 'agentMessage').at(-1)!; answer.durationMs = Date.now() - state.turnStartedAt!; state.turnStartedAt = undefined; state.turnId = null; answer.status = 'completed'; publish() },
  fileApproval: () => {
    state.items.push({ id: 'file', turnId: 'turn', type: 'fileChange', text: '', status: 'inProgress', files: [{ path: 'C:/fixture/report.html', diff: '+<h1>Release report</h1>' }] })
    state.approvals = [{ id: 7, itemId: 'file', kind: 'file', description: 'Create report.html' }]; publish()
  },
  fail: () => { state.connection = 'disconnected'; state.error = 'Fixture connection lost'; publish() },
  settingsFail: (value: boolean) => { settingsFailure = value },
  ultracode: (value?: ConversationSnapshot['ultracode']) => { state.ultracode = value; publish() },
  catalogFail: () => { state.modelsError = 'Fixture catalog failed'; publish() },
  nativeSettings: () => { state.model = 'fixture-fast'; state.effort = 'high'; publish() },
  backgroundTask: () => { state.turnId = null; state.backgroundTasks = 1; publish() },
  changeLanguage,
  workApproval: () => {
    state.approvals = [{ id: 42, itemId: 'work-read', kind: 'command', description: 'Allow workspace inspection' }]; publish()
  },
  progressSnapshot: (snapshot: Pick<ConversationSnapshot, 'items' | 'turnId' | 'turnStartedAt'>) => {
    state.items = structuredClone(snapshot.items); state.turnId = snapshot.turnId; state.turnStartedAt = snapshot.turnStartedAt
    state.approvals = []; state.plans = []; state.connection = 'ready'; publish()
  },
  workPreview: (stage: 'start' | 'update' | 'idle' | 'finish') => {
    if (stage === 'start') state.turnStartedAt = Date.now()
    state.items = [
      { id: 'work-user', turnId: 'work', type: 'userMessage', text: 'Check the workspace', status: 'completed' },
      { id: 'work-prose', turnId: 'work', type: 'agentMessage', phase: 'commentary', text: 'I will inspect the workspace.', status: 'completed' },
      { id: 'work-read', turnId: 'work', type: 'commandExecution', text: 'read workspace\nRaw command output', status: stage === 'start' ? 'inProgress' : 'failed' },
      ...(stage === 'start' ? [] : [{ id: 'work-check', turnId: 'work', type: 'commandExecution', text: 'check workspace', status: stage === 'finish' || stage === 'idle' ? 'completed' : 'inProgress' }]),
      ...(stage === 'finish' ? [{ id: 'work-answer', turnId: 'work', type: 'agentMessage', text: 'The check finished with a read error.', status: 'completed' }] : []),
    ]
    state.turnId = stage === 'finish' ? null : 'work'
    state.approvals = []; state.plans = []; state.connection = 'ready'; publish()
  },
  designPreview: () => {
    state.items = [
      { id: 'preview-user', turnId: 'preview', type: 'userMessage', text: '检查 OpenCode 的模型切换，让对话和终端使用同一份设置。', status: 'completed' },
      { id: 'preview-read', turnId: 'preview', type: 'commandExecution', text: '读取会话设置与模型目录\nGET /api/model · GET /api/session/{id}', status: 'completed' },
      { id: 'preview-file', turnId: 'preview', type: 'fileChange', text: '更新模型与强度同步逻辑', status: 'completed', files: [{ path: 'src/main/terminal/opencode-conversation.ts', diff: '+ this.updateSettings(session.data.model)' }] },
      { id: 'preview-check', turnId: 'preview', type: 'commandExecution', text: '验证原生 CLI 与对话切换\n6 tests passed', status: 'completed' },
      { id: 'preview-answer', turnId: 'preview', type: 'agentMessage', text: '## 模型设置，始终保持同步\n\n已接入 OpenCode 的原生会话设置。你可以在对话框选择模型和思考强度，切回终端后继续使用同一份选择。\n\n### 本次调整\n\n- **模型目录**：按当前工作区读取，保留供应商和模型身份。\n- **思考强度**：使用模型提供的选项，也可以恢复默认。\n- **双向同步**：修改后读取确认，避免旧消息覆盖新设置。\n\n已通过原生 CLI 与界面回归。现在可以继续当前任务。', status: 'completed', durationMs: 12400, receivedAt: Date.now() },
    ]; state.turnId = null; state.approvals = []; state.plans = []; state.connection = 'ready'; publish()
  },
} })
function Harness() {
  const [visible, setVisible] = useState(true)
  const [generation, setGeneration] = useState(0)
  return <><div style={{ height: 34, display: 'flex', gap: 20 }}><button onClick={() => setVisible(value => !value)}>Other workspace</button><button onClick={() => setGeneration(value => value + 1)}>Remount</button></div>
    <div style={{ height: 'calc(100vh - 34px)', visibility: visible ? 'visible' : 'hidden' }}>
      <AgentSessionPane key={generation} terminalId="codex" visible={visible} focused={visible} workspaceVisible={visible} />
    </div></>
}
await initI18n(); await changeLanguage('en')
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><Harness /></React.StrictMode>)
