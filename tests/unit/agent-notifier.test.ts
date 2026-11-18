import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { notifyAgentEvent, notifyAgentAttention } from '../../src/main/notifications/agent-notifier'

type ToastCallbacks = {
  onClick(): void
  onShown(): void
  onError(error: string): void
}

const desktopToastMock = vi.hoisted(() => ({
  show: vi.fn<(payload: unknown, options: ToastCallbacks) => boolean>(() => true),
}))
const nativeMock = vi.hoisted(() => ({
  supported: vi.fn(() => false),
  created: vi.fn<(options: { title: string; body: string; silent: boolean }, notice: import('node:events').EventEmitter) => void>(),
  show: vi.fn(),
}))

vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  return {
    Notification: class Notification extends EventEmitter {
      static isSupported() { return nativeMock.supported() }
      constructor(options: { title: string; body: string; silent: boolean }) {
        super()
        nativeMock.created(options, this)
      }
      show() { nativeMock.show(this) }
    },
  }
})

vi.mock('../../src/main/notifications/desktop-toast-window', () => ({
  desktopToastWindow: desktopToastMock,
}))

function createWindowMock(overrides: Partial<Record<string, ReturnType<typeof vi.fn>>> = {}) {
  return {
    isDestroyed: vi.fn(() => false),
    isMinimized: vi.fn(() => false),
    webContents: {
      isDestroyed: vi.fn(() => false),
      send: vi.fn(),
    },
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
    ...overrides,
  }
}

const enabledSettings = {
  desktopEnabled: true,
  notifyOnSuccess: true,
  notifyOnFailure: true,
  minDurationSeconds: 0,
  includeErrorMessage: false,
  errorMessageMaxLength: 120,
}

const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!
function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { ...originalPlatform, value: platform })
}

beforeEach(() => {
  setPlatform('win32')
  vi.clearAllMocks()
  desktopToastMock.show.mockReturnValue(true)
  nativeMock.supported.mockReturnValue(false)
  nativeMock.show.mockReset()
})

afterEach(() => {
  Object.defineProperty(process, 'platform', originalPlatform)
})

describe('notifyAgentEvent', () => {
  it('skips non-terminal agent events', async () => {
    const delivered = notifyAgentEvent(createWindowMock() as never, { sessionId: 's1', engine: 'codex' }, {
      type: 'text-chunk',
      text: 'working',
    })

    expect(delivered).toBe(false)
    expect(desktopToastMock.show).not.toHaveBeenCalled()
  })

  it('shows a completion notification through desktop toast without renderer fallback', async () => {
    const windowMock = createWindowMock()

    const delivered = notifyAgentEvent(windowMock as never, { sessionId: 's1', engine: 'codex' }, {
      type: 'done',
      exitCode: 0,
    })

    expect(delivered).toBe(true)
    expect(windowMock.webContents.send).not.toHaveBeenCalled()
    expect(desktopToastMock.show).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'completed',
        engine: 'codex',
        title: 'JanusX - Agent completed',
        body: 'codex session completed. Click to return to JanusX.',
      }),
      expect.objectContaining({
        onClick: expect.any(Function),
        onShown: expect.any(Function),
        onError: expect.any(Function),
      }),
    )
  })

  it('returns true when the main renderer is unavailable but desktop toast accepts the payload', async () => {
    const windowMock = createWindowMock({
      webContents: {
        isDestroyed: vi.fn(() => true),
        send: vi.fn(),
      } as never,
    })

    const delivered = notifyAgentEvent(
      windowMock as never,
      { sessionId: 's1', engine: 'codex' },
      { type: 'done', exitCode: 0 },
      enabledSettings,
    )

    expect(delivered).toBe(true)
    expect(windowMock.webContents.send).not.toHaveBeenCalled()
    expect(desktopToastMock.show).toHaveBeenCalledTimes(1)
  })

  it('skips notifications when desktop notifications are disabled', async () => {
    const windowMock = createWindowMock()

    const delivered = notifyAgentEvent(
      windowMock as never,
      { sessionId: 's1', engine: 'codex' },
      {
        type: 'done',
        exitCode: 0,
      },
      {
        ...enabledSettings,
        desktopEnabled: false,
      },
    )

    expect(delivered).toBe(false)
    expect(windowMock.webContents.send).not.toHaveBeenCalled()
    expect(desktopToastMock.show).not.toHaveBeenCalled()
  })

  it('skips short tasks when a runtime threshold is configured', async () => {
    notifyAgentEvent(
      createWindowMock() as never,
      {
        sessionId: 's1',
        engine: 'codex',
        startedAt: new Date(Date.now() - 10_000).toISOString(),
      },
      {
        type: 'done',
        exitCode: 0,
      },
      {
        ...enabledSettings,
        minDurationSeconds: 30,
      },
    )

    expect(desktopToastMock.show).not.toHaveBeenCalled()
  })

  it('shows a failure notification for error events', async () => {
    notifyAgentEvent(createWindowMock() as never, { sessionId: 's1', engine: 'claude' }, {
      type: 'error',
      message: 'failed',
    })

    expect(desktopToastMock.show).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'JanusX - Agent failed',
        body: 'claude session needs attention. Click to return to JanusX.',
      }),
      expect.any(Object),
    )
  })

  it('can include a truncated failure message when configured', async () => {
    notifyAgentEvent(
      createWindowMock() as never,
      { sessionId: 's1', engine: 'claude' },
      {
        type: 'error',
        message: 'x'.repeat(80),
      },
      {
        ...enabledSettings,
        includeErrorMessage: true,
        errorMessageMaxLength: 40,
      },
    )

    expect(desktopToastMock.show).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'JanusX - Agent failed',
        body: `claude session failed: ${'x'.repeat(37)}...`,
      }),
      expect.any(Object),
    )
  })

  it('restores, focuses, and runs click callback when desktop toast is clicked', async () => {
    const windowMock = createWindowMock({ isMinimized: vi.fn(() => true) })
    const onClick = vi.fn()

    notifyAgentEvent(
      windowMock as never,
      { sessionId: 's1', engine: 'opencode' },
      {
        type: 'done',
      },
      enabledSettings,
      { onClick },
    )

    const [, options] = desktopToastMock.show.mock.calls[0]
    options.onClick()

    expect(windowMock.restore).toHaveBeenCalledTimes(1)
    expect(windowMock.show).toHaveBeenCalledTimes(1)
    expect(windowMock.focus).toHaveBeenCalledTimes(1)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('reports desktop toast show and failure callbacks', async () => {
    const onDesktopToastShown = vi.fn()
    const onDesktopToastFailure = vi.fn()

    notifyAgentEvent(
      createWindowMock() as never,
      { sessionId: 's1', engine: 'codex' },
      { type: 'done' },
      enabledSettings,
      { onDesktopToastShown, onDesktopToastFailure },
    )

    const [, options] = desktopToastMock.show.mock.calls[0]
    options.onShown()
    options.onError('load failed')

    expect(onDesktopToastShown).toHaveBeenCalledTimes(1)
    expect(onDesktopToastFailure).toHaveBeenCalledWith('load failed')
    expect(desktopToastMock.show).toHaveBeenCalledTimes(1)
  })

  it('uses the renderer fallback when desktop toast fails before it is shown', async () => {
    const windowMock = createWindowMock()

    notifyAgentEvent(
      windowMock as never,
      { sessionId: 's1', engine: 'codex' },
      { type: 'done' },
      enabledSettings,
    )

    const [, options] = desktopToastMock.show.mock.calls[0]
    options.onError('load failed')

    expect(windowMock.webContents.send).toHaveBeenCalledWith(
      'agent-notification:show',
      expect.objectContaining({
        type: 'completed',
        engine: 'codex',
      }),
    )
  })

  it('delivers one renderer fallback when desktop window creation fails synchronously', () => {
    const windowMock = createWindowMock()
    desktopToastMock.show.mockImplementationOnce((_payload, options) => {
      options.onError('window creation failed')
      return false
    })
    const delivered = notifyAgentEvent(windowMock as never, { sessionId: 's1', engine: 'codex' }, { type: 'done' }, enabledSettings)
    expect(delivered).toBe(true)
    expect(windowMock.webContents.send).toHaveBeenCalledTimes(1)
  })
})

describe('notifyAgentAttention', () => {
  it('shows an attention notification', async () => {
    notifyAgentAttention(
      createWindowMock() as never,
      { sessionId: 's1', engine: 'codex' },
      'approval required',
      enabledSettings,
    )

    expect(desktopToastMock.show).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'attention',
        title: 'JanusX - codex needs attention',
        body: 'approval required',
      }),
      expect.any(Object),
    )
  })
})

describe('macOS agent notifications', () => {
  beforeEach(() => {
    setPlatform('darwin')
    nativeMock.supported.mockReturnValue(true)
  })

  it('delivers a native notification without activating JanusX and restores the terminal only on click', () => {
    const windowMock = createWindowMock({ isMinimized: vi.fn(() => true) })
    const onClick = vi.fn()
    const onDesktopToastShown = vi.fn()
    expect(notifyAgentEvent(windowMock as never, { sessionId: 's1', engine: 'codex' }, { type: 'done' }, enabledSettings, {
      terminalId: 'terminal-1', onClick, onDesktopToastShown,
    })).toBe(true)
    const [options, notice] = nativeMock.created.mock.calls[0]
    expect(options).toMatchObject({ title: 'JanusX - Agent completed', silent: true })
    expect(nativeMock.show).toHaveBeenCalledWith(notice)
    notice.emit('show')
    expect(onDesktopToastShown).toHaveBeenCalledTimes(1)
    expect(desktopToastMock.show).not.toHaveBeenCalled()
    expect(windowMock.webContents.send).not.toHaveBeenCalled()
    expect(windowMock.restore).not.toHaveBeenCalled()
    expect(windowMock.show).not.toHaveBeenCalled()
    expect(windowMock.focus).not.toHaveBeenCalled()
    expect(onClick).not.toHaveBeenCalled()
    notice.emit('click')
    notice.emit('click')
    expect(windowMock.restore).toHaveBeenCalledTimes(1)
    expect(windowMock.show).toHaveBeenCalledTimes(1)
    expect(windowMock.focus).toHaveBeenCalledTimes(1)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('routes failed native delivery to the in-app notice with its terminal and workspace', () => {
    const windowMock = createWindowMock()
    const onDesktopToastFailure = vi.fn()
    const onClick = vi.fn()
    expect(notifyAgentAttention(windowMock as never, { sessionId: 's1', engine: 'codex' }, 'approval required', enabledSettings, {
      terminalId: 'terminal-1', workspaceId: 'workspace-2', onDesktopToastFailure, onClick,
    })).toBe(true)
    const [, notice] = nativeMock.created.mock.calls[0]
    notice.emit('failed', {}, 'notifications are disabled')
    notice.emit('failed', {}, 'duplicate failure')
    expect(onDesktopToastFailure).toHaveBeenCalledExactlyOnceWith('notifications are disabled')
    expect(windowMock.webContents.send).toHaveBeenCalledExactlyOnceWith('agent-notification:show', expect.objectContaining({
      type: 'attention', terminalId: 'terminal-1', workspaceId: 'workspace-2',
    }))
    expect(desktopToastMock.show).not.toHaveBeenCalled()
    expect(windowMock.focus).not.toHaveBeenCalled()
    expect(windowMock.show).not.toHaveBeenCalled()
    expect(onClick).not.toHaveBeenCalled()
  })

  it.each(['unavailable', 'throws'])('delivers one in-app notice when the native API is %s', failure => {
    const windowMock = createWindowMock()
    if (failure === 'unavailable') nativeMock.supported.mockReturnValue(false)
    else nativeMock.show.mockImplementationOnce(() => { throw new Error('native delivery error') })
    expect(notifyAgentEvent(windowMock as never, { sessionId: 's1', engine: 'codex' }, { type: 'error', message: 'error' }, enabledSettings)).toBe(true)
    expect(windowMock.webContents.send).toHaveBeenCalledTimes(1)
    expect(desktopToastMock.show).not.toHaveBeenCalled()
    expect(windowMock.focus).not.toHaveBeenCalled()
    expect(windowMock.show).not.toHaveBeenCalled()
  })
})
