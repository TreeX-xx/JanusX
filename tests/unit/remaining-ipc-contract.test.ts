import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { AGENT_CHANNELS, SUBAGENT_RUN_CHANNELS, type AgentAPI, type SubAgentRunAPI } from '../../src/shared/ipc/janus-runner'
import { CHECKPOINT_CHANNELS, type CheckpointAPI } from '../../src/shared/ipc/checkpoint'
import { HOSTED_CHANNELS, type HostedAPI } from '../../src/shared/ipc/hosted'
import { SESSION_CHANNELS, type SessionAPI } from '../../src/shared/ipc/session'
import { WORKTREE_CHANNELS, type WorktreeAPI } from '../../src/shared/ipc/worktree'
import { GIT_CHANNELS, type GitAPI } from '../../src/shared/ipc/git'
import { LLM_CHANNELS, type LlmAPI } from '../../src/shared/ipc/llm'
import { NOTIFICATION_SETTINGS_CHANNELS, type NotificationSettingsAPI } from '../../src/shared/ipc/settings'
import { SYSTEM_CHANNELS, type DesktopToastAPI, type DialogAPI, type SystemAPI, type WindowAPI } from '../../src/shared/ipc/system'

const invoke = vi.fn()
const send = vi.fn()
const on = vi.fn()
const removeListener = vi.fn()
let api: {
  agent: AgentAPI; checkpoint: CheckpointAPI; session: SessionAPI; worktree: WorktreeAPI; hosted: HostedAPI; git: GitAPI; llm: LlmAPI
  notificationSettings: NotificationSettingsAPI; subAgentRun: SubAgentRunAPI
  dialog: DialogAPI; window: WindowAPI; system: SystemAPI; desktopToast: DesktopToastAPI
}

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: (_name: string, exposed: typeof api) => { api = exposed } },
  ipcRenderer: { invoke, send, on, removeListener },
}))

beforeAll(async () => {
  await import('../../src/preload/index')
})

describe('remaining typed IPC contracts', () => {
  beforeEach(() => {
    invoke.mockReset().mockResolvedValue(undefined)
    send.mockReset()
    on.mockReset()
    removeListener.mockReset()
  })

  it('reports viewed editor files and releases the main-window observation subscription', () => {
    const payload = { filePath: 'C:/repo/README.md', workspacePath: 'C:/repo' }
    const callback = vi.fn()
    api.window.reportEditorViewed(payload)
    expect(send).toHaveBeenCalledWith(SYSTEM_CHANNELS.editorViewed, payload)
    const unsubscribe = api.window.onEditorViewed(callback)
    const listener = on.mock.calls[0][1]
    listener({}, payload)
    expect(callback).toHaveBeenCalledWith(payload)
    unsubscribe()
    expect(removeListener).toHaveBeenCalledWith(SYSTEM_CHANNELS.editorViewed, listener)
  })

  it('defines a unique channel surface and exposes no generic bridge', () => {
    const channels = [
      ...Object.values(AGENT_CHANNELS), ...Object.values(SUBAGENT_RUN_CHANNELS),
      ...Object.values(CHECKPOINT_CHANNELS), ...Object.values(SESSION_CHANNELS),
      ...Object.values(WORKTREE_CHANNELS), ...Object.values(HOSTED_CHANNELS), ...Object.values(GIT_CHANNELS),
      ...Object.values(LLM_CHANNELS), ...Object.values(NOTIFICATION_SETTINGS_CHANNELS),
      ...Object.values(SYSTEM_CHANNELS),
    ]
    expect(new Set(channels).size).toBe(channels.length)
    expect(api).not.toHaveProperty('invoke')
    expect(api).not.toHaveProperty('send')
    expect(api).not.toHaveProperty('on')
  })

  it('routes request APIs through shared channel constants', async () => {
    await api.agent.listSessions()
    await api.checkpoint.list({ cwd: 'C:\\repo' })
    await api.session.list({ workspaceId: 'ws-1' })
    await api.worktree.identity('C:\\repo')
    await api.hosted.checks('C:\\repo', 'feat')
    await api.git.status('C:\\repo')
    await api.git.fileBaseline('C:\\repo', 'README.md')
    await api.llm.getTerminalProviders('janus')
    await api.llm.getNativeLoginStatus('claude')
    await api.llm.startNativeLogin('claude')
    await api.llm.stopNativeLogin('claude')
    await api.llm.answerQuestion({ requestId: 'r1', callId: 'c1', answer: { status: 'cancelled' } })
    await api.notificationSettings.get()
    await api.notificationSettings.getFeishuControlStatus()
    await api.subAgentRun.list()
    await api.dialog.openDirectory()
    await api.window.minimize()
    await api.system.getDefaultShell()

    expect(invoke.mock.calls).toEqual([
      [AGENT_CHANNELS.listSessions],
      [CHECKPOINT_CHANNELS.list, { cwd: 'C:\\repo' }],
      [SESSION_CHANNELS.list, { workspaceId: 'ws-1' }],
      [WORKTREE_CHANNELS.identity, { workspacePath: 'C:\\repo' }],
      [HOSTED_CHANNELS.checks, { workspacePath: 'C:\\repo', branch: 'feat' }],
      [GIT_CHANNELS.status, 'C:\\repo'],
      [GIT_CHANNELS.fileBaseline, 'C:\\repo', 'README.md'],
      [LLM_CHANNELS.getTerminalProviders, 'janus'],
      [LLM_CHANNELS.getNativeLoginStatus, 'claude'],
      [LLM_CHANNELS.startNativeLogin, 'claude'],
      [LLM_CHANNELS.stopNativeLogin, 'claude'],
      [LLM_CHANNELS.answerQuestion, { requestId: 'r1', callId: 'c1', answer: { status: 'cancelled' } }],
      [NOTIFICATION_SETTINGS_CHANNELS.get],
      [NOTIFICATION_SETTINGS_CHANNELS.feishuControlStatus],
      [SUBAGENT_RUN_CHANNELS.list],
      [SYSTEM_CHANNELS.openDirectory],
      [SYSTEM_CHANNELS.minimize],
      [SYSTEM_CHANNELS.defaultShell],
    ])
  })

  it('routes one-way and event APIs without exposing Electron events', () => {
    const toastListener = vi.fn()
    api.desktopToast.ready()
    api.desktopToast.painted(7)
    api.desktopToast.action('activate')
    const unsubscribe = api.desktopToast.onShow(toastListener)
    const handler = on.mock.calls.at(-1)?.[1]
    const payload = { title: 'done', body: 'complete' }

    handler({}, payload)
    expect(send.mock.calls).toEqual([
      [SYSTEM_CHANNELS.toastReady],
      [SYSTEM_CHANNELS.toastPainted, 7],
      [SYSTEM_CHANNELS.toastAction, { action: 'activate' }],
    ])
    expect(toastListener).toHaveBeenCalledWith(payload)
    unsubscribe()
    expect(removeListener).toHaveBeenCalledWith(SYSTEM_CHANNELS.toastShow, handler)
  })

  it('clears stale toast frames through the hide channel', () => {
    const hideListener = vi.fn()
    const unsubscribe = api.desktopToast.onHide(hideListener)
    const handler = on.mock.calls.at(-1)?.[1]

    handler({}, undefined)
    expect(hideListener).toHaveBeenCalledWith(undefined)
    unsubscribe()
    expect(removeListener).toHaveBeenCalledWith(SYSTEM_CHANNELS.toastHide, handler)
  })
})
