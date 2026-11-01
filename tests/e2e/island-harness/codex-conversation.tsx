import React, { useState } from 'react'
import ReactDOM from 'react-dom/client'
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
useThemeStore.getState().applyExternal(new URLSearchParams(location.search).get('theme') === 'light' ? 'planche' : 'dark')
useWorkspaceStore.setState({ activeWorkspaceId: 'ws', terminals: [{ id: 'codex', workspaceId: 'ws', name: 'Codex', preset: 'codex', cwd: 'C:/fixture', shell: 'powershell.exe', pid: 42, status: 'wait', conversationEnabled: true, conversationInitialView: initialView }], activeTerminalId: 'codex' })
const state: ConversationSnapshot = { id: 'codex', engine: 'codex', capabilities: CODEX_CONVERSATION_CAPABILITIES, revision: 1, mode: 'terminal', controlEpoch: 0, connection: 'ready', threadId: 'native-thread', turnId: null, submitting: false, items: [], approvals: [], needsTerminal: false, truncated: false,
  model: 'fixture-fast', effort: 'medium', modelsLoading: false, settingsUpdating: false, models: [
    { model: 'fixture-fast', displayName: 'Fixture Fast', description: 'A fast local test model', defaultEffort: 'medium', efforts: [
      { effort: 'low', description: 'Quick responses for straightforward work' }, { effort: 'medium', description: 'Balanced reasoning' },
      { effort: 'high', description: 'More detailed reasoning' }, { effort: 'xhigh', description: 'Extra reasoning for complex tasks' },
      { effort: 'max', description: 'Maximum reasoning depth' }, { effort: 'ultra', description: 'Maximum reasoning with automatic task delegation' },
    ] },
    { model: 'fixture-deep', displayName: 'Fixture Deep', description: 'A model for complex test tasks', defaultEffort: 'high', efforts: [{ effort: 'high', description: 'Detailed reasoning' }, { effort: 'xhigh', description: 'Extra reasoning' }] },
  ] }
state.mode = initialView
if (claude) {
  state.capabilities = { ...state.capabilities, edit: false }
  state.engine = 'claude'; state.model = 'claude-sonnet-4-6'; state.effort = 'medium'
  state.models = [
    { model: 'claude-sonnet-4-6', displayName: 'Sonnet', description: 'Native Sonnet option', defaultEffort: null, efforts: ['low', 'medium', 'high'].map(effort => ({ effort, description: '' })) },
    { model: 'claude-opus-4-6', displayName: 'Opus', description: 'Native Opus option', defaultEffort: null, efforts: ['low', 'medium', 'high', 'max'].map(effort => ({ effort, description: '' })) },
  ]
}
const listeners = new Set<(s: ConversationSnapshot) => void>()
if (extraEngine === 'opencode' || extraEngine === 'pi' || extraEngine === 'dsh') {
  state.engine = extraEngine
  state.capabilities = { submit: true, cancel: true, settings: extraEngine === 'opencode', edit: extraEngine === 'opencode', approvals: false, liveText: true }
  state.models = []
  if (extraEngine === 'opencode') {
    state.model = 'fixture/fast'; state.effort = 'default'
    state.models = [
      { model: 'fixture/fast', displayName: 'Fast · fixture', description: 'fixture/fast', defaultEffort: 'default', efforts: [{ effort: 'default', description: '' }] },
      { model: 'fixture/deep', displayName: 'Deep · fixture', description: 'fixture/deep', defaultEffort: 'default', efforts: [{ effort: 'default', description: '' }, { effort: 'careful', description: '' }] },
    ]
  }
}
const calls = { create: 0, kill: 0, sends: [] as string[], input: [] as string[], approvals: [] as string[], opens: [] as string[], settings: [] as Array<{ model: string; effort: string | null }> }
let settingsFailure = false
let editAfterRevertFailure = false
let sendGate: Promise<void> | null = null
let settleSend: ((fail: boolean) => void) | null = null
let modeGate: Promise<void> | null = null
let settleMode: ((fail: boolean) => void) | null = null
const publish = () => { state.revision++; for (const listener of listeners) listener(structuredClone(state)) }
Object.assign(window.electron.terminal, {
  create: async () => { calls.create++; return { pid: 42 } }, kill: async () => { calls.kill++; return { success: true } },
  replay: async () => ({ data: 'Native Codex terminal\r\n› ', seq: 1 }),
  input: (_id: string, data: string) => { calls.input.push(data) },
  conversation: async () => pendingStartup ? null : structuredClone(state),
  onConversation: (callback: (s: ConversationSnapshot) => void) => { listeners.add(callback); return () => listeners.delete(callback) },
  conversationCommand: async (_id: string, command: ConversationCommand) => {
    if (command.type === 'mode') {
      if (modeGate) await modeGate
      state.mode = command.mode; state.controlEpoch++
    }
    else if (command.type === 'settings') {
      if (settingsFailure) throw new Error('Fixture settings update failed')
      calls.settings.push({ model: command.model, effort: command.effort }); state.model = command.model; state.effort = command.effort
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
      state.turnId = 'turn'; state.turnStartedAt = Date.now();
      state.items.push({ id: 'user', receivedAt: Date.now(), turnId: 'turn', type: 'userMessage', text: command.text, status: 'completed' }, { id: 'answer', receivedAt: Date.now(), turnId: 'turn', type: 'agentMessage', text: '', status: 'inProgress' })
    } else if (command.type === 'approve') { calls.approvals.push(command.decision); state.approvals = [] }
    else if (command.type === 'interrupt') { state.turnId = null; state.backgroundTasks = 0 }
    publish(); return structuredClone(state)
  },
})
Object.assign(window.electron.window, { openEditor: async ({ filePath }: { filePath: string }) => { calls.opens.push(filePath) } })
Object.assign(window, { codexFixture: {
  calls,
  starting: () => {
    pendingStartup = false
    state.connection = 'starting'; state.model = null; state.effort = null; publish()
  },
  ready: () => {
    state.connection = 'ready'; state.model = 'fixture-fast'; state.effort = 'high'; publish()
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
  delta: (text: string) => { state.items.find(item => item.id === 'answer')!.text += text; publish() },
  finish: () => { state.items.find(item => item.id === 'answer')!.durationMs = Date.now() - state.turnStartedAt!; state.turnStartedAt = undefined; state.turnId = null; state.items.find(item => item.id === 'answer')!.status = 'completed'; publish() },
  fileApproval: () => {
    state.items.push({ id: 'file', turnId: 'turn', type: 'fileChange', text: '', status: 'inProgress', files: [{ path: 'C:/fixture/report.html', diff: '+<h1>Release report</h1>' }] })
    state.approvals = [{ id: 7, itemId: 'file', kind: 'file', description: 'Create report.html' }]; publish()
  },
  fail: () => { state.connection = 'disconnected'; state.error = 'Fixture connection lost'; publish() },
  settingsFail: (value: boolean) => { settingsFailure = value },
  catalogFail: () => { state.modelsError = 'Fixture catalog failed'; publish() },
  nativeSettings: () => { state.model = 'fixture-fast'; state.effort = 'high'; publish() },
  backgroundTask: () => { state.turnId = null; state.backgroundTasks = 1; publish() },
  changeLanguage,
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
