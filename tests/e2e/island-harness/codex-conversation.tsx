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
import type { ConversationHistoryRequest, ConversationHistoryResult, ConversationHistoryItem } from '../../../src/shared/conversation-history'
import '../../../src/renderer/src/styles/globals.css'
import '../../../src/renderer/src/styles/themes.generated.css'

installElectronApiFallback()
Object.assign(window.electron.system, { getLanguage: async () => 'en' })
const claude = new URLSearchParams(location.search).get('engine') === 'claude'
const extraEngine = new URLSearchParams(location.search).get('engine')
const initialView = new URLSearchParams(location.search).get('initialView') === 'conversation' ? 'conversation' : 'terminal'
const split = new URLSearchParams(location.search).get('split')
let pendingStartup = new URLSearchParams(location.search).has('pendingStartup')
useThemeStore.getState().applyExternal(new URLSearchParams(location.search).get('theme') === 'light' ? 'planche' : new URLSearchParams(location.search).get('theme') ?? 'dark')
useWorkspaceStore.setState({ activeWorkspaceId: 'ws', terminals: [{ id: 'codex', workspaceId: 'ws', name: 'Codex', preset: 'codex', cwd: 'C:/fixture', shell: 'powershell.exe', pid: 42, status: 'wait', conversationEnabled: true, conversationInitialView: initialView }], activeTerminalId: 'codex' })
if (split) useWorkspaceStore.setState(current => ({ terminals: [...current.terminals, { ...current.terminals[0], id: 'codex-second', pid: 43 }] }))
// Keep the foreign pane in its owning snapshot, as splitPaneWithTerminal does.
if (split && new URLSearchParams(location.search).has('crossWorkspace')) useWorkspaceStore.setState(current => ({
  activeWorkspaceId: 'ws-current',
  activeTerminalId: 'codex-second',
  terminals: [{ ...current.terminals[1], workspaceId: 'ws-current' }],
  terminalSnapshots: { ws: { terminals: [current.terminals[0]], activeTerminalId: 'codex', paneTree: null, focusedPaneId: null, focusedTabId: null } },
}))
const state: ConversationSnapshot = { id: 'codex', engine: 'codex', capabilities: CODEX_CONVERSATION_CAPABILITIES, revision: 1, mode: 'terminal', controlEpoch: 0, connection: 'ready', threadId: 'native-thread', turnId: null, submitting: false, items: [], approvals: [], needsTerminal: false, truncated: false,
  serviceTier: null, model: 'fixture-fast', effort: 'medium', modelsLoading: false, settingsUpdating: false, models: [
    { model: 'fixture-fast', speedTiers: ['fast'], displayName: 'Fixture Fast', description: 'A fast local test model', defaultEffort: 'medium', efforts: [
      { effort: 'low', description: 'Quick responses for straightforward work' }, { effort: 'medium', description: 'Balanced reasoning' },
      { effort: 'high', description: 'More detailed reasoning' }, { effort: 'xhigh', description: 'Extra reasoning for complex tasks' },
      { effort: 'max', description: 'Maximum reasoning depth' }, { effort: 'ultra', description: 'Maximum reasoning with automatic task delegation' },
    ] },
    { model: 'fixture-deep', displayName: 'Fixture Deep', description: 'A model for complex test tasks', defaultEffort: 'high', efforts: [{ effort: 'high', description: 'Detailed reasoning' }, { effort: 'xhigh', description: 'Extra reasoning' }] },
  ] }
if (new URLSearchParams(location.search).has('ultrafast')) {
  state.models[1].speedTiers = ['priority', 'ultrafast']
  state.models.push({ model: 'fixture-standard', displayName: 'Fixture Standard', description: '', defaultEffort: null, efforts: [] })
}
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
let editHistoryFailure = false
let sendGate: Promise<void> | null = null
let settleSend: ((fail: boolean) => void) | null = null
let modeGate: Promise<void> | null = null
let settleMode: ((fail: boolean) => void) | null = null
let catalogGate: Promise<void> | null = null
let releaseCatalog: (() => void) | null = null
let newGate: Promise<void> | null = null
let rejectNew: (() => void) | null = null
let historyReads = 0
let trackHistoryReads = false
const archiveRequests: ConversationHistoryRequest[] = []
let archiveFailure = false
let archiveGate: Promise<void> | undefined, releaseArchive: (() => void) | undefined
const archiveBody = 'Complete native original\n' + 'Long historical paragraph.\n'.repeat(4000) + 'END OF NATIVE ORIGINAL'
const archiveItems: ConversationHistoryItem[] = Array.from({ length: 1000 }, (_, index) => ({
  id: `archive-${index}:item-${index}`, turnId: `archive-${index}`, type: index % 2 ? 'agentMessage' : 'userMessage',
  text: `Archived message ${index}\n\n` + 'Historical context. '.repeat(30), textLength: 630, status: 'completed', editable: false,
}))
async function archiveRead(_id: string, request: ConversationHistoryRequest): Promise<ConversationHistoryResult> {
  archiveRequests.push(structuredClone(request))
  if (archiveGate) await archiveGate
  if (archiveFailure) throw new Error('Fixture history unavailable')
  if (request.type === 'text') {
    const offset = request.offset, end = Math.min(archiveBody.length, offset + 16000)
    return { type: 'text', threadId: request.threadId, itemId: request.itemId, text: archiveBody.slice(offset, end), offset, total: archiveBody.length,
      version: 'fixture-version', previousOffset: offset ? Math.max(0, offset - 16000) : null, nextOffset: end < archiveBody.length ? end : null }
  }
  const start = request.cursor ? Number(request.cursor) : Math.floor(Math.max(0, archiveItems.findIndex(item => item.id === request.beforeItemId)) / 40) * 40
  return { type: 'page', threadId: request.threadId, items: structuredClone(archiveItems.slice(start, start + 40)),
    olderCursor: start ? String(Math.max(0, start - 40)) : null, newerCursor: start + 40 < archiveItems.length ? String(start + 40) : null }
}
const measuredSnapshot = () => {
  const next = structuredClone(state)
  if (trackHistoryReads) for (const item of next.items) {
    const text = item.text
    Object.defineProperty(item, 'text', { enumerable: true, get: () => { historyReads++; return text } })
  }
  return next
}
const publish = () => { state.revision++; for (const listener of listeners) {
  listener(measuredSnapshot())
  if (split) listener({ ...measuredSnapshot(), id: 'codex-second', threadId: 'secondary-thread' })
} }
Object.assign(window.electron.terminal, {
  saveConversationImage: async (_id: string, itemId: string, imageId: string) => { calls.opens.push(`image:${itemId}:${imageId}`); return { canceled: false } },
  create: async () => { calls.create++; return { pid: 42 } }, kill: async () => { calls.kill++; return { success: true } },
  replay: async () => ({ data: 'Native Codex terminal\r\n› ', seq: 1 }),
  input: (_id: string, data: string) => { calls.input.push(data) },
  conversation: async (id: string) => pendingStartup ? null : { ...structuredClone(state), id, threadId: id === 'codex-second' ? 'secondary-thread' : state.threadId },
  onConversation: (callback: (s: ConversationSnapshot) => void) => { listeners.add(callback); return () => listeners.delete(callback) },
  conversationCommand: async (_id: string, command: ConversationCommand) => {
    calls.commands.push(structuredClone(command))
    if (command.type === 'mode') {
      if (command.mode === 'terminal' && state.submitting && rejectNew) rejectNew()
      if (modeGate) await modeGate
      state.mode = command.mode; state.controlEpoch++
    }
    else if (command.type === 'commands') {
      state.commandsLoading = true; publish()
      if (catalogGate) await catalogGate
      state.commands = state.commands ?? []; state.commandsLoading = false; publish()
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
      state.serviceTier = command.serviceTier ?? 'default'
    }
    else if (command.type === 'ultracode') {
      if (settingsFailure) throw new Error('Fixture settings update failed')
      state.ultracode = { ...state.ultracode!, enabled: command.enabled }
    }
    else if (command.type === 'settings') {
      if (settingsFailure) throw new Error('Fixture settings update failed')
      calls.settings.push({ model: command.model, effort: command.effort }); state.model = command.model; state.effort = command.effort
    } else if (command.type === 'new') {
      if (newGate) {
        state.submitting = true; publish()
        try { await newGate }
        catch (error) { state.mode = 'terminal'; state.controlEpoch++; state.error = String(error); throw error }
        finally { state.submitting = false; publish() }
      }
      state.threadId = `new-${state.revision}`; state.items = []; state.plans = []; state.controlEpoch++
    } else if (command.type === 'models') { state.modelsError = undefined }
    else if (command.type === 'send' || command.type === 'edit') {
      calls.sends.push(command.text)
      if (sendGate) await sendGate
      if (command.type === 'edit') {
        if (editHistoryFailure) {
          state.capabilities = { ...state.capabilities, edit: false }; publish()
          throw new Error('Codex could not read thread history. Your edited message was not sent and the original history was kept.')
        }
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
  pagedTurnAttachments: () => {
    const oldRows: ConversationHistoryItem[] = [
      { id: 'older:prompt', turnId: 'older', type: 'userMessage', text: 'Archived request', textLength: 16, status: 'completed' },
      { id: 'older:edit', turnId: 'older', type: 'fileChange', text: '', textLength: 0, status: 'completed',
        files: [{ path: 'src/archived.ts', diff: '@@ -1 +1 @@\n-old\n+archived' }] },
      { id: 'older:answer', turnId: 'older', type: 'agentMessage', text: 'Archived answer', textLength: 15, status: 'completed' },
    ]
    const latest: ConversationHistoryItem = { id: 'recent:answer', turnId: 'recent', type: 'agentMessage', text: 'Newest answer', textLength: 13, status: 'completed' }
    window.electron.terminal.conversationHistory = async (_id, request) => ({
      type: 'page', threadId: request.threadId, items: [...oldRows, latest], olderCursor: null, newerCursor: null,
      plans: [{ turnId: 'older', version: 1, outcome: 'completed', explanation: '',
        steps: [{ step: 'Inspect earlier work', status: 'completed' }] }],
    })
    state.items = [latest]; state.truncated = true; state.turnId = null; state.plans = []; publish()
  },
  pagedHistory: () => {
    window.electron.terminal.conversationHistory = archiveRead
    state.items = structuredClone(archiveItems.slice(-100)); state.truncated = true; state.turnId = null; state.approvals = []; state.plans = []
    state.items[state.items.length - 1] = { ...state.items.at(-1)!, text: 'Complete native original preview', truncated: true }
    publish()
  },
  archiveRequests,
  archiveFailure: (value: boolean) => { archiveFailure = value },
  holdArchive: () => { archiveGate = new Promise(resolve => { releaseArchive = resolve }) },
  releaseArchive: () => { releaseArchive?.(); archiveGate = undefined },
  changeThread: () => { state.threadId = 'replacement-thread'; state.items = []; state.truncated = false; state.controlEpoch++; publish() },
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
    if (kind === 'async') state.turnId = 'async-turn'
    state.questions = [{ id: 'question', version: state.revision, cancelable: true, blocking: kind !== 'async', status: 'pending', questions: kind === 'async' ? [
      { id: 'choice', text: 'Choose async', allowText: true, options: [{ id: '0', label: 'First' }, { id: '1', label: 'Second' }] },
    ] : kind === 'text' ? [
      { id: 'text', text: 'Type something', options: [], allowText: true },
    ] : [
      { id: 'confirm', header: 'Confirmation', text: 'Proceed?', options: [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }] },
      { id: 'checks', header: 'Checks', text: 'Select checks', multiple: true, allowText: true, options: [{ id: 'unit', label: 'Unit tests', description: 'Run local tests' }, { id: 'browser', label: 'Browser tests', description: 'Verify the interaction' }] },
      { id: 'text', text: 'Type something', options: [], allowText: true },
    ] }]; publish()
  },
  asyncQuestions: () => {
    state.turnId = 'active-turn'
    state.turnStartedAt = Date.now()
    state.items = [{ id: 'active-turn:ask', turnId: 'active-turn', type: 'agentMessage', text: 'Which direction?\n- First\n- Second', status: 'completed' }]
    state.questions = [{ id: 'async:active-turn:ask', version: state.revision, blocking: false, cancelable: false, status: 'pending', questions: [
      { id: '0', text: 'Which direction?', allowText: true, options: [{ id: '0', label: 'First' }, { id: '1', label: 'Second' }] },
      { id: '1', text: 'Notes', allowText: true, options: [] },
    ] }]; publish()
  },
  expireQuestions: () => { state.questions = []; publish() },
  finishAsyncTurn: () => { state.turnId = null; publish() },
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
  holdCatalog: () => {
    state.capabilities = { ...state.capabilities, commands: true }; state.commands = undefined
    catalogGate = new Promise(resolve => { releaseCatalog = resolve }); publish()
  },
  releaseCatalog: () => { releaseCatalog?.(); catalogGate = null },
  holdNew: () => {
    newGate = new Promise((_, reject) => { rejectNew = () => reject(new Error('Codex new conversation could not be confirmed. Check the terminal before retrying.')) })
  },
  failNew: () => { rejectNew?.(); newGate = null; rejectNew = null },
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
  editHistoryFailure: () => { editHistoryFailure = true },
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
  turnReceipts: (path: string) => {
    const turnId = state.turnId
    if (!turnId) return
    state.items.push(
      { id: `${turnId}:plan-1`, turnId, type: 'plan', text: 'Superseded plan draft', status: 'completed' },
      { id: `${turnId}:plan-2`, turnId, type: 'plan', text: `Plan document for ${path}`, status: 'completed' },
      { id: `${turnId}:file`, turnId, type: 'fileChange', text: '', status: 'completed', files: [{ path, diff: '@@ -1 +1 @@\n-old\n+new' }] },
    )
    publish()
  },
  revisePlan: (steps = ['Inspect protocol', 'Build interface', 'Run checks', 'Review result']) => {
    const previous = state.plans?.filter(plan => plan.turnId === state.turnId).at(-1)
    if (!previous) return
    state.plans = [...state.plans!, { ...previous, version: previous.version + 1,
      steps: steps.map(step => previous.steps.find(row => row.step === step) ?? { step, status: 'pending' as const }) }]
    publish()
  },
  endPlan: (outcome: 'completed' | 'interrupted' | 'failed') => {
    state.plans = state.plans?.map(plan => plan.turnId === state.turnId ? { ...plan, outcome } : plan); state.turnId = null; publish()
  },
  stalePlan: () => { const plan = state.plans?.at(-1); if (plan) plan.stale = true; publish() },
  holdMode: () => {
    modeGate = new Promise<void>((resolve, reject) => {
      settleMode = fail => { modeGate = null; settleMode = null; if (fail) reject(new Error('Fixture mode switch failed')); else resolve() }
    })
  },
  releaseMode: (fail = false) => settleMode?.(fail),
  delta: (text: string) => { state.items.filter(item => item.type === 'agentMessage').at(-1)!.text += text; publish() },
  finish: () => {
    const answer = state.items.filter(item => item.type === 'agentMessage').at(-1)!
    state.turnDurations = { ...state.turnDurations, [answer.turnId]: Date.now() - state.turnStartedAt! }
    state.turnStartedAt = undefined; state.turnId = null; answer.status = 'completed'; publish()
  },
  fileApproval: () => {
    state.items.push({ id: 'file', turnId: 'turn', type: 'fileChange', text: '', status: 'inProgress', files: [{ path: 'C:/fixture/report.html', diff: '+<h1>Release report</h1>' }] })
    state.approvals = [{ id: 7, itemId: 'file', kind: 'file', description: 'Create report.html' }]; publish()
  },
  fail: () => { state.connection = 'disconnected'; state.error = 'Fixture connection lost'; publish() },
  retryStatus: (stage = 'retry', message = 'Reconnecting... 1/5\nThe connection to the model was interrupted.') => {
    state.error = undefined
    state.connection = 'ready'
    state.turnId = stage === 'retry' ? 'retry-turn' : null
    state.items = [{ id: 'retry-user', turnId: 'retry-turn', type: 'userMessage', text: 'Review the current changes', status: 'completed' }]
    state.retry = stage === 'retry' ? { turnId: 'retry-turn', message } : undefined
    if (stage === 'recovered') state.items.push({ id: 'retry-answer', turnId: 'retry-turn', type: 'agentMessage', text: 'Connection recovered. Review complete.', status: 'completed' })
    if (stage === 'failed') state.items.push({ id: 'retry-failure', turnId: 'retry-turn', type: 'turnError', text: message, status: 'failed' })
    publish()
  },
  settingsFail: (value: boolean) => { settingsFailure = value },
  revokeUltrafast: () => {
    const model = state.models.find(option => option.model === 'fixture-deep')
    if (model) model.speedTiers = ['priority']
    publish()
  },
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
  workTruncated: (kind: 'history' | 'output' | 'unknown') => {
    state.truncated = kind === 'history'
    state.items = [{ id: 'bounded', turnId: 'bounded', type: 'commandExecution', text: 'npm test\nPassed',
      status: kind === 'unknown' ? 'unrecognized' : 'completed', truncated: kind === 'output' }]
    state.turnId = null; publish()
  },
  workPreview: (stage: 'start' | 'update' | 'idle' | 'finish') => {
    if (stage === 'start') {
      state.turnStartedAt = Date.now()
      state.turnDurations = undefined
    }
    if (stage === 'finish' && state.turnStartedAt !== undefined) {
      state.turnDurations = { work: Date.now() - state.turnStartedAt }
      state.turnStartedAt = undefined
    }
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
    <div style={{ height: 'calc(100vh - 34px)', visibility: visible ? 'visible' : 'hidden', ...(split ? { display: 'flex', flexDirection: split === 'stacked' ? 'column' as const : 'row' as const } : {}) }}>
      <div data-fixture-pane="first" style={{ flex: 1, minWidth: 0, minHeight: 0, height: split ? undefined : '100%' }}><AgentSessionPane key={generation} terminalId="codex" visible={visible} focused={visible} workspaceVisible={visible} /></div>
      {split && <div data-fixture-pane="second" style={{ flex: 1, minWidth: 0, minHeight: 0 }}><AgentSessionPane terminalId="codex-second" visible={visible} focused={false} workspaceVisible={visible} /></div>}
    </div></>
}
await initI18n(); await changeLanguage('en')
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><Harness /></React.StrictMode>)
