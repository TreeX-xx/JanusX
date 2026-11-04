import { beforeEach, describe, expect, it, vi } from 'vitest'
const preference = vi.hoisted(() => ({ initialView: 'terminal' as 'terminal' | 'conversation' }))
vi.mock('@/stores/conversation-preferences', () => ({ useConversationPreferences: { getState: () => preference } }))

const { addTerminal, updateTerminal, setLoadState, workspaceTerminals } = vi.hoisted(() => ({
  addTerminal: vi.fn(),
  updateTerminal: vi.fn(),
  setLoadState: vi.fn(),
  workspaceTerminals: [] as Array<Record<string, unknown>>,
}))

vi.mock('@/stores/workspace', () => ({
  useWorkspaceStore: Object.assign(
    vi.fn(),
    {
      getState: () => ({
        addTerminal,
        updateTerminal,
        terminals: workspaceTerminals,
      }),
    },
  ),
}))

vi.mock('@/stores/app', () => ({
  useAppStore: {
    getState: () => ({
      setLoadState,
    }),
  },
}))

vi.mock('@/lib/runtime-telemetry', () => ({
  getEstimatedContextWindow: vi.fn(() => 200_000),
}))

const {
  waitForTerminalGeometry,
  requestTerminalForceFit,
} = vi.hoisted(() => ({
  waitForTerminalGeometry: vi.fn(async () => ({ cols: 120, rows: 40 })),
  requestTerminalForceFit: vi.fn(),
}))

vi.mock('@/lib/terminal-geometry', () => ({
  waitForTerminalGeometry,
  requestTerminalForceFit,
}))

describe('terminal-launch', () => {
  beforeEach(() => {
    preference.initialView = 'terminal'
    vi.resetModules()
    addTerminal.mockReset()
    updateTerminal.mockReset()
    setLoadState.mockReset()
    waitForTerminalGeometry.mockReset()
    waitForTerminalGeometry.mockResolvedValue({ cols: 120, rows: 40 })
    requestTerminalForceFit.mockReset()
    workspaceTerminals.length = 0

    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        electron: {
          platform: 'win32',
          system: { getDefaultShell: vi.fn() },
          terminal: {
            warmup: vi.fn(),
            create: vi.fn(),
          },
        },
      },
    })

    vi.stubGlobal(
      'requestAnimationFrame',
      (cb: FrameRequestCallback) => {
        cb(0)
        return 0
      },
    )
  })

  it('gives every supported new local session both surfaces without an opt-in', async () => {
    vi.mocked(window.electron.system.getDefaultShell).mockResolvedValue('powershell.exe')
    vi.mocked(window.electron.terminal.create).mockResolvedValue({ pid: 123 })
    const { launchTerminalPreset } = await import('../../src/renderer/src/lib/terminal-launch')
    for (const preset of ['codex', 'claude', 'opencode', 'pi', 'dsh'] as const) {
      await launchTerminalPreset({ preset, workspaceId: 'ws', workspacePath: 'C:/repo' })
      expect(window.electron.terminal.create).toHaveBeenLastCalledWith(expect.objectContaining({ preset, conversationEnabled: true, initialView: 'terminal' }))
    }
    await launchTerminalPreset({ preset: 'janus', workspaceId: 'ws', workspacePath: 'C:/repo' })
    expect(vi.mocked(window.electron.terminal.create).mock.calls.at(-1)?.[0].conversationEnabled).toBeUndefined()
    await launchTerminalPreset({ preset: 'codex', workspaceId: 'ws', workspacePath: 'C:/repo', attachOnly: true })
    expect(vi.mocked(window.electron.terminal.create).mock.calls.at(-1)?.[0].conversationEnabled).toBeUndefined()
  })

  it('opens the preferred view, prefills its draft without hidden PTY input, and retains the choice on retry', async () => {
    preference.initialView = 'conversation'
    vi.mocked(window.electron.system.getDefaultShell).mockResolvedValue('powershell.exe')
    vi.mocked(window.electron.terminal.create).mockResolvedValue({ pid: 123 })
    const input = vi.fn()
    Object.assign(window.electron.terminal, { input })
    const { launchTerminalPreset, retryTerminalCreate } = await import('../../src/renderer/src/lib/terminal-launch')
    const result = await launchTerminalPreset({ preset: 'codex', workspaceId: 'ws', workspacePath: 'C:/repo', initialInput: 'Review this before sending' })
    expect(result).toMatchObject({ ok: true, prefilled: true })
    expect(addTerminal.mock.calls[0][0]).toMatchObject({ conversationEnabled: true, conversationInitialView: 'conversation', conversationDraft: 'Review this before sending' })
    expect(window.electron.terminal.create).toHaveBeenCalledWith(expect.objectContaining({ conversationEnabled: true, initialView: 'conversation' }))
    expect(input).not.toHaveBeenCalled()
    workspaceTerminals.push(addTerminal.mock.calls[0][0])
    preference.initialView = 'terminal'
    await retryTerminalCreate(result!.terminalId)
    expect(window.electron.terminal.create).toHaveBeenLastCalledWith(expect.objectContaining({ initialView: 'conversation' }))
  })

  it('caches default shell after ensureDefaultShell', async () => {
    const getDefaultShell = window.electron.system.getDefaultShell as ReturnType<typeof vi.fn>
    getDefaultShell.mockResolvedValueOnce('pwsh.exe')

    const {
      __resetDefaultShellCacheForTests,
      ensureDefaultShell,
      getCachedDefaultShell,
    } = await import('../../src/renderer/src/lib/terminal-launch')

    __resetDefaultShellCacheForTests()
    expect(getCachedDefaultShell()).toBeNull()

    await expect(ensureDefaultShell()).resolves.toBe('pwsh.exe')
    expect(getCachedDefaultShell()).toBe('pwsh.exe')
    expect(getDefaultShell).toHaveBeenCalledWith()

    await expect(ensureDefaultShell()).resolves.toBe('pwsh.exe')
    expect(getDefaultShell).toHaveBeenCalledTimes(1)
  })

  it('warms terminal create path via terminal:warmup', async () => {
    const warmup = window.electron.terminal.warmup as ReturnType<typeof vi.fn>
    warmup.mockResolvedValue({ ok: true })

    const { warmTerminalCreatePath } = await import('../../src/renderer/src/lib/terminal-launch')
    warmTerminalCreatePath(['claude'])
    await Promise.resolve()

    expect(warmup).toHaveBeenCalledWith({ engines: ['claude'] })
  })

  it('does not install external hooks during generic warmup', async () => {
    const warmup = window.electron.terminal.warmup as ReturnType<typeof vi.fn>
    warmup.mockResolvedValue({ ok: true })

    const { warmTerminalCreatePath } = await import('../../src/renderer/src/lib/terminal-launch')
    warmTerminalCreatePath()
    await Promise.resolve()

    expect(warmup).toHaveBeenCalledWith({ engines: [] })
  })

  it('launches optimistically with wait status before create resolves', async () => {
    const getDefaultShell = window.electron.system.getDefaultShell as ReturnType<typeof vi.fn>
    const create = window.electron.terminal.create as ReturnType<typeof vi.fn>
    let resolveCreate: ((value: { pid: number }) => void) | null = null
    getDefaultShell.mockResolvedValue('powershell.exe')
    create.mockImplementation(() => new Promise((resolve) => {
      resolveCreate = resolve
    }))

    const {
      __resetDefaultShellCacheForTests,
      launchTerminalPreset,
      terminalBootLabel,
    } = await import('../../src/renderer/src/lib/terminal-launch')

    __resetDefaultShellCacheForTests()

    const launchPromise = launchTerminalPreset({
      preset: 'claude',
      workspaceId: 'ws-1',
      workspacePath: 'C:/repo',
    })

    await vi.waitFor(() => {
      expect(addTerminal).toHaveBeenCalled()
    })

    const terminal = addTerminal.mock.calls[0][0]
    expect(terminal.status).toBe('wait')
    expect(terminal.preset).toBe('claude')
    expect(terminal.shell).toBe('powershell.exe')
    expect(terminal.contextWindowTokens).toBeUndefined()
    expect(setLoadState).toHaveBeenCalledWith('terminal-active')
    expect(terminalBootLabel('claude')).toBe('Starting Claude Code…')

    await vi.waitFor(() => {
      expect(resolveCreate).toBeTruthy()
    })

    expect(waitForTerminalGeometry).toHaveBeenCalledWith(terminal.id)
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        id: terminal.id,
        preset: 'claude',
        command: 'claude',
        args: [],
        cols: 120,
        rows: 40,
      }),
    )

    resolveCreate!({ pid: 4242 })

    await expect(launchPromise).resolves.toEqual({
      ok: true,
      terminalId: terminal.id,
      pid: 4242,
      prefilled: false,
    })

    expect(updateTerminal).toHaveBeenCalledWith(
      terminal.id,
      expect.objectContaining({ pid: 4242, status: 'wait' }),
    )
    expect(requestTerminalForceFit).toHaveBeenCalledWith(terminal.id)
  })

  it('keeps terminal on create failure with recoverable error state', async () => {
    const getDefaultShell = window.electron.system.getDefaultShell as ReturnType<typeof vi.fn>
    const create = window.electron.terminal.create as ReturnType<typeof vi.fn>
    getDefaultShell.mockResolvedValue('powershell.exe')
    create.mockRejectedValue(new Error('spawn failed'))

    const {
      __resetDefaultShellCacheForTests,
      launchTerminalPreset,
    } = await import('../../src/renderer/src/lib/terminal-launch')

    __resetDefaultShellCacheForTests()

    const result = await launchTerminalPreset({
      preset: 'shell',
      workspaceId: 'ws-1',
      workspacePath: 'C:/repo',
      name: 'shell',
    })

    expect(result?.ok).toBe(false)
    expect(addTerminal).toHaveBeenCalled()
    const terminalId = addTerminal.mock.calls[0][0].id
    expect(updateTerminal).toHaveBeenCalledWith(
      terminalId,
      expect.objectContaining({
        status: 'error',
        errorMessage: 'spawn failed',
      }),
    )
  })

  it('retries with measured geometry before requesting the post-create fit burst', async () => {
    const getDefaultShell = window.electron.system.getDefaultShell as ReturnType<typeof vi.fn>
    const create = window.electron.terminal.create as ReturnType<typeof vi.fn>
    getDefaultShell.mockResolvedValue('powershell.exe')
    create.mockResolvedValue({ pid: 5252 })
    workspaceTerminals.push({
      id: 'retry-terminal',
      workspaceId: 'ws-1',
      cwd: 'C:/repo',
      shell: 'powershell.exe',
      autoCommand: 'opencode',
      preset: 'opencode',
      status: 'error',
    })

    const {
      __resetDefaultShellCacheForTests,
      retryTerminalCreate,
    } = await import('../../src/renderer/src/lib/terminal-launch')

    __resetDefaultShellCacheForTests()
    await expect(retryTerminalCreate('retry-terminal')).resolves.toBe(true)

    expect(waitForTerminalGeometry).toHaveBeenCalledWith('retry-terminal')
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      id: 'retry-terminal',
      cols: 120,
      rows: 40,
    }))
    expect(requestTerminalForceFit).toHaveBeenCalledWith('retry-terminal')
    expect(create.mock.invocationCallOrder[0]).toBeLessThan(
      requestTerminalForceFit.mock.invocationCallOrder[0],
    )
  })

  it('prefills initial input after created without submitting', async () => {
    const getDefaultShell = window.electron.system.getDefaultShell as ReturnType<typeof vi.fn>
    const create = window.electron.terminal.create as ReturnType<typeof vi.fn>
    getDefaultShell.mockResolvedValue('powershell.exe')
    create.mockResolvedValue({ pid: 7777 })
    const input = vi.fn()
    let createdCb: ((event: { id: string }) => void) | null = null
    Object.assign(window.electron.terminal, {
      input,
      onCreated: vi.fn((cb: (event: { id: string }) => void) => {
        createdCb = cb
        return () => {
          createdCb = null
        }
      }),
    })

    const {
      __resetDefaultShellCacheForTests,
      launchTerminalPreset,
    } = await import('../../src/renderer/src/lib/terminal-launch')

    __resetDefaultShellCacheForTests()
    const launchPromise = launchTerminalPreset({
      preset: 'codex',
      workspaceId: 'ws-1',
      workspacePath: 'C:/repo',
      initialInput: '# Title\nGoal: G.',
    })

    await vi.waitFor(() => {
      expect(addTerminal).toHaveBeenCalled()
    })
    const terminalId = addTerminal.mock.calls[0][0].id as string
    createdCb?.({ id: terminalId })

    await expect(launchPromise).resolves.toEqual({
      ok: true,
      terminalId,
      pid: 7777,
      prefilled: true,
    })
    expect(input).toHaveBeenCalledWith(terminalId, '# Title\nGoal: G.')
  })
})
