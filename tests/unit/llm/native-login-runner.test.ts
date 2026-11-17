import { afterEach, describe, expect, it, vi } from 'vitest'
import { startNativeLogin, stopNativeLogin } from '../../../src/main/llm/native-login'
import { terminalManager } from '../../../src/main/terminal/manager'

vi.mock('../../../src/main/terminal/manager', () => ({
  terminalManager: {
    create: vi.fn(() => ({ pty: { write: vi.fn(), onData: vi.fn(), onExit: vi.fn() } })),
    kill: vi.fn(),
  },
}))
vi.mock('../../../src/main/janus-runner/cli-resolver', () => ({
  resolveCLIPath: vi.fn(async (command: string) => `/cli/${command}`),
}))

afterEach(() => {
  stopNativeLogin('claude')
  stopNativeLogin('codex')
  stopNativeLogin('opencode')
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.clearAllMocks()
})

describe('background native login renderer', () => {
  it('uses classic Claude rendering only in the hidden child, even when the parent forces fullscreen', async () => {
    vi.useFakeTimers()
    vi.stubEnv('CLAUDE_CODE_NO_FLICKER', '1')
    expect(await startNativeLogin('claude')).toEqual({ success: true })
    const config = vi.mocked(terminalManager.create).mock.calls.at(-1)?.[0]
    expect(config?.id).toBe('native-login-claude')
    expect(config?.program).toBe('/cli/claude')
    expect(config?.launch?.env.PATH).toEqual(expect.any(String))
    expect(config?.launch?.env.CLAUDE_CODE_NO_FLICKER).toBe('0')
    expect(process.env.CLAUDE_CODE_NO_FLICKER).toBe('1')
    // Classic mode retains the existing slash-command login flow.
    await vi.advanceTimersByTimeAsync(2500)
    expect(vi.mocked(terminalManager.create).mock.results[0].value.pty.write).toHaveBeenCalledWith('/login\r')
  })

  it.each(['codex', 'opencode'] as const)('keeps %s login free of Claude renderer overrides', async consumer => {
    vi.useFakeTimers()
    expect(await startNativeLogin(consumer)).toEqual({ success: true })
    const config = vi.mocked(terminalManager.create).mock.calls.at(-1)?.[0]
    expect(config?.launch?.env.PATH).toEqual(expect.any(String))
    expect(config?.launch?.env.CLAUDE_CODE_NO_FLICKER).toBeUndefined()
  })

  it('recognizes the classic ConPTY login menu across output chunks and confirms only once', async () => {
    vi.useFakeTimers()
    await startNativeLogin('claude')
    const pty = vi.mocked(terminalManager.create).mock.results[0].value.pty
    const onData = pty.onData.mock.calls[0][0] as (data: string) => void
    await vi.advanceTimersByTimeAsync(2500)
    // Captured Claude 2.1.302 ConPTY shape: cursor movement replaces spaces,
    // and differential repaint can omit the final letter of "Select".
    onData('Selec\x1b[1C login\x1b[1Cmethod:\x1b[K\x1b[19;3H>\x1b[1C1.\x1b[1CClaude\x1b[1Caccount')
    await vi.advanceTimersByTimeAsync(400)
    expect(pty.write).toHaveBeenCalledTimes(1)
    onData('\x1b[1Cwith\x1b[1Csubscription')
    await vi.advanceTimersByTimeAsync(400)
    expect(pty.write).toHaveBeenLastCalledWith('\r')
    onData('\x1b[20;5H2. Anthropic Console account')
    await vi.advanceTimersByTimeAsync(400)
    expect(pty.write).toHaveBeenCalledTimes(2)
  })
})
