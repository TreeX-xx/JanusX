import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  TERMINAL_EVENT_CHANNELS,
  TERMINAL_INVOKE_CHANNELS,
  TERMINAL_SEND_CHANNELS,
  type TerminalAPI,
} from '../../src/shared/ipc/terminal'

const mocks = vi.hoisted(() => ({
  expose: vi.fn(),
  handle: vi.fn(),
  invoke: vi.fn(),
  onMain: vi.fn(),
  onRenderer: vi.fn(),
  removeListener: vi.fn(),
  send: vi.fn(),
  hookOptions: undefined as any,
  trackTelemetry: vi.fn(),
  bindTelemetry: vi.fn(),
  snapshotTelemetry: vi.fn(),
  officeProbe: vi.fn(() => new Promise(() => {})),
}))

let terminalApi: TerminalAPI

vi.mock('electron', () => ({
  BrowserWindow: class {},
  contextBridge: {
    exposeInMainWorld: (_name: string, api: { terminal: TerminalAPI }) => {
      terminalApi = api.terminal
      mocks.expose(api)
    },
  },
  ipcMain: { handle: mocks.handle, on: mocks.onMain },
  ipcRenderer: {
    invoke: mocks.invoke,
    on: mocks.onRenderer,
    removeListener: mocks.removeListener,
    send: mocks.send,
  },
}))

vi.mock('../../src/main/terminal/manager', () => ({
  terminalManager: { appendOutput: vi.fn(), create: vi.fn(() => ({ pty: { pid: 42, onData: vi.fn(), onExit: vi.fn() } })), getOutputReplay: vi.fn(), kill: vi.fn(), killAll: vi.fn(), resize: vi.fn(), write: vi.fn() },
}))
vi.mock('@janus-agent/agent-core', async (importOriginal) => ({ ...(await importOriginal()), checkpointManager: { initialize: vi.fn(async () => {}) } }))
vi.mock('../../src/main/janus/analyzer', () => ({ analyzer: {} }))
vi.mock('../../src/main/janus-runner/cli-resolver', () => ({ resolveCLIPath: vi.fn(async () => null) }))
vi.mock('../../src/main/janus-runner/subagent-run-registry', () => ({ subAgentRunRegistry: {} }))
vi.mock('../../src/main/terminal/shell-profiles', () => ({ resolveShellProfileLaunch: vi.fn(async () => ({ program: { command: 'powershell.exe', args: [] } })) }))
vi.mock('../../src/main/runtime-telemetry/coordinator', () => ({ terminalContextCoordinator: { startCorpusScan: vi.fn(), trackTerminal: mocks.trackTelemetry, bindSession: mocks.bindTelemetry, getSnapshot: mocks.snapshotTelemetry, runAttributionPass: vi.fn(async () => {}), releaseTerminal: vi.fn(async () => {}) } }))
vi.mock('../../src/main/notifications/agent-hook-bridge', () => ({ AgentHookBridge: class { start = vi.fn(async () => {}); stop = vi.fn(); getEnv = vi.fn(() => ({})) } }))
vi.mock('../../src/main/notifications/agent-hook-config', () => ({ AgentHookConfigManager: class {} }))
vi.mock('../../src/main/notifications/agent-hook-coordinator', () => ({ getRawString: (raw: Record<string, unknown> | undefined, keys: string[]) => keys.map(key => raw?.[key]).find(value => typeof value === 'string'), AgentHookCoordinator: class { constructor(_window: unknown, options: unknown) { mocks.hookOptions = options }; dispose = vi.fn() } }))
vi.mock('../../src/main/notifications/agent-hook-diagnostics', () => ({ AgentHookDiagnostics: class { record = vi.fn() }, summarizeCoordinatorEvent: vi.fn(), summarizeHookPayload: vi.fn() }))
vi.mock('../../src/main/terminal/diagnostics', () => ({ logTerminalDiagnostic: vi.fn() }))
vi.mock('../../src/main/knowledge/agent-turn-recorder', () => ({ agentTurnRecorder: { dispose: vi.fn(), setEventSink: vi.fn(), isCaptureEnabled: vi.fn(async () => false), handleHookPayload: vi.fn() } }))
vi.mock('../../src/main/shutdown/AppShutdown', () => ({ appShutdown: { configure: vi.fn(), isQuitting: false } }))
vi.mock('../../src/main/office/officecli-manager', () => ({ officecliManager: { resolveBinary: mocks.officeProbe, getVerifiedBinary: vi.fn(), resolveAgentPathDir: vi.fn(), refreshAgentPathDir: mocks.officeProbe } }))
vi.mock('../../src/main/office/office-agent-policy', () => ({ buildOfficeAgentSession: vi.fn(() => ({ env: {}, mode: 'managed' })), mergeOfficeAgentEnv: vi.fn(() => ({})) }))

beforeAll(async () => {
  await import('../../src/preload/index')
  const { registerTerminalHandlers } = await import('../../src/main/ipc/terminal-handlers')
  registerTerminalHandlers(() => null)
})

describe('Terminal IPC contract', () => {
  it('holds workspace usage from terminal spawn until exit, even when exit cleanup partly fails', async () => {
    const { workspaceStorageInUse } = await import('@janus-agent/agent-core')
    const { terminalManager } = await import('../../src/main/terminal/manager')
    const create = mocks.handle.mock.calls.find(([channel]) => channel === TERMINAL_INVOKE_CHANNELS.create)![1]
    const cwd = 'C:/janus-terminal-storage-fixture'
    await create({}, { id: 'usage-guard', cwd, shell: 'powershell.exe', preset: 'shell' })
    expect(workspaceStorageInUse(cwd)).toBe(true)
    const instance = vi.mocked(terminalManager.create).mock.results.at(-1)!.value
    const exit = instance.pty.onExit.mock.calls[0][0]
    const { agentSessionRegistry } = await import('../../src/main/sessions/session-registry')
    const detach = vi.spyOn(agentSessionRegistry, 'detachTerminal').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    try { await exit({ exitCode: 0 }) } finally { error.mockRestore(); detach.mockRestore() }
    expect(workspaceStorageInUse(cwd)).toBe(false)
  })
  it('starts repeated shells without invoking a blocked OfficeCLI probe', async () => {
    const create = mocks.handle.mock.calls.find(([channel]) => channel === TERMINAL_INVOKE_CHANNELS.create)![1]
    const warmup = mocks.handle.mock.calls.find(([channel]) => channel === TERMINAL_INVOKE_CHANNELS.warmup)![1]
    await warmup({}, { engines: [] })
    for (const id of ['shell-start-1', 'shell-start-2']) {
      await expect(create({}, { id, cwd: process.cwd(), shell: 'powershell.exe', preset: 'shell' })).resolves.toEqual({ pid: 42 })
    }
    expect(mocks.officeProbe).not.toHaveBeenCalled()
  }, 2000)

  it('dispatches session/start/wait/end events without any telemetry binding, read or delayed refresh', async () => {
    const create = mocks.handle.mock.calls.find(([channel]) => channel === TERMINAL_INVOKE_CHANNELS.create)![1]
    await create({}, { id: 'hook-boundary', cwd: process.cwd(), shell: 'powershell.exe', preset: 'shell' })
    const { normalizeHookLifecycle } = await import('../../src/main/notifications/agent-hook-lifecycle')
    const { agentTurnRecorder } = await import('../../src/main/knowledge/agent-turn-recorder')
    mocks.trackTelemetry.mockClear(); mocks.bindTelemetry.mockClear(); mocks.snapshotTelemetry.mockClear()
    const timeout = vi.spyOn(globalThis, 'setTimeout')
    try {
      for (const event of ['SessionStart', 'UserPromptSubmit', 'PermissionRequest', 'Stop', 'Stop', 'SessionEnd']) {
        const payload = { source: 'codex' as const, terminalId: 'hook-boundary', sessionId: 'hook-session', event }
        await mocks.hookOptions.onResolvedPayload(payload, { terminalId: 'hook-boundary', engine: 'codex' }, normalizeHookLifecycle(payload))
      }
      expect(mocks.trackTelemetry).not.toHaveBeenCalled()
      expect(mocks.bindTelemetry).not.toHaveBeenCalled()
      expect(mocks.snapshotTelemetry).not.toHaveBeenCalled()
      expect(timeout).not.toHaveBeenCalled()
      expect(agentTurnRecorder.handleHookPayload).not.toHaveBeenCalled()
    } finally { timeout.mockRestore() }
  })

  beforeEach(() => {
    mocks.invoke.mockReset()
    mocks.onRenderer.mockReset()
    mocks.removeListener.mockReset()
    mocks.send.mockReset()
  })

  it('defines unique channels and registers every main command', () => {
    const invokeChannels = Object.values(TERMINAL_INVOKE_CHANNELS)
    const sendChannels = Object.values(TERMINAL_SEND_CHANNELS)

    expect(new Set([...invokeChannels, ...sendChannels, ...Object.values(TERMINAL_EVENT_CHANNELS)]).size)
      .toBe(invokeChannels.length + sendChannels.length + Object.keys(TERMINAL_EVENT_CHANNELS).length)
    expect(mocks.handle.mock.calls.map(([channel]) => channel)).toEqual(expect.arrayContaining(invokeChannels))
    expect(mocks.onMain.mock.calls.map(([channel]) => channel)).toEqual(expect.arrayContaining(sendChannels))
  })

  it('routes typed commands with compatible payloads', async () => {
    const create = { id: 'terminal-1', workspaceId: 'workspace-1', cwd: 'C:\\repo', shell: 'pwsh.exe', preset: 'codex' }
    mocks.invoke.mockResolvedValue({ pid: 42 })

    await terminalApi.create(create)
    await terminalApi.replay(create.id)
    await terminalApi.kill(create.id)
    terminalApi.input(create.id, 'hello')
    terminalApi.resize(create.id, 120, 40)
    terminalApi.submitLine(create.id, 'prompt')

    expect(mocks.invoke).toHaveBeenNthCalledWith(1, TERMINAL_INVOKE_CHANNELS.create, create)
    expect(mocks.invoke).toHaveBeenNthCalledWith(2, TERMINAL_INVOKE_CHANNELS.replay, { id: create.id })
    expect(mocks.invoke).toHaveBeenNthCalledWith(3, TERMINAL_INVOKE_CHANNELS.kill, { id: create.id })
    expect(mocks.send).toHaveBeenCalledWith(TERMINAL_SEND_CHANNELS.input, { id: create.id, data: 'hello' })
    expect(mocks.send).toHaveBeenCalledWith(TERMINAL_SEND_CHANNELS.resize, { id: create.id, cols: 120, rows: 40 })
    expect(mocks.send).toHaveBeenCalledWith(TERMINAL_SEND_CHANNELS.submitLine, { id: create.id, text: 'prompt' })
  })

  it('forwards event payloads and removes the exact listener', () => {
    const callback = vi.fn()
    const unsubscribe = terminalApi.onData(callback)
    const handler = mocks.onRenderer.mock.calls.at(-1)?.[1]
    const payload = { id: 'terminal-1', data: 'output', seq: 3 }

    handler({}, payload)
    expect(callback).toHaveBeenCalledWith(payload)
    unsubscribe()
    expect(mocks.removeListener).toHaveBeenCalledWith(TERMINAL_EVENT_CHANNELS.data, handler)
  })

  it('forwards structured telemetry events', () => {
    const callback = vi.fn()
    const unsubscribe = terminalApi.onTelemetry(callback)
    const handler = mocks.onRenderer.mock.calls.at(-1)?.[1]
    const payload = {
      id: 'terminal-1',
      telemetry: { contextTokens: 8_000, source: 'history', observedAt: 1_000 },
    }

    handler({}, payload)
    expect(callback).toHaveBeenCalledWith(payload)
    unsubscribe()
    expect(mocks.removeListener).toHaveBeenCalledWith(TERMINAL_EVENT_CHANNELS.telemetry, handler)
  })

  it('forwards turn-change events', () => {
    const callback = vi.fn()
    const unsubscribe = terminalApi.onTurnChanges(callback)
    const handler = mocks.onRenderer.mock.calls.at(-1)?.[1]
    const payload = {
      id: 'terminal-1',
      kind: 'done',
      checkpointId: 'cp-1',
      files: [{ path: 'a.ts', status: 'modified', additions: 2, deletions: 1, size: 40 }],
      fileCount: 1,
      additions: 2,
      deletions: 1,
      endedAt: '2026-09-21T00:00:00.000Z',
    }

    handler({}, payload)
    expect(callback).toHaveBeenCalledWith(payload)
    unsubscribe()
    expect(mocks.removeListener).toHaveBeenCalledWith(TERMINAL_EVENT_CHANNELS.turnChanges, handler)
  })

  it('does not expose a generic bridge', () => {
    expect(mocks.expose.mock.calls[0]?.[0]).not.toHaveProperty('invoke')
  })
})
