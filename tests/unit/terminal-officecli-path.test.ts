import { delimiter } from 'path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const spawn = vi.fn(() => ({
  pid: 12345,
  write: vi.fn(),
  resize: vi.fn(),
  kill: vi.fn(),
  onData: vi.fn(),
  onExit: vi.fn(),
}))

vi.mock('node-pty', () => ({ spawn }))

describe('TerminalManager OfficeCLI PATH integration', () => {
  beforeEach(() => spawn.mockClear())

  it('prepends only new PTY environments without mutating the process or existing PTYs', async () => {
    const { TerminalManager } = await import('../../src/main/terminal/manager')
    const manager = new TerminalManager()
    const originalProcessPath = process.env.PATH
    const config = {
      workspaceId: 'workspace',
      cwd: process.cwd(),
      shell: 'powershell.exe',
      env: { PATH: 'C:\\user-bin' },
    }

    manager.create({ ...config, id: 'existing' })
    manager.create({ ...config, id: 'new' }, 'C:\\verified-officecli')
    manager.create({ ...config, id: 'after-invalidated' })

    const firstEnv = spawn.mock.calls[0][2].env as Record<string, string>
    const secondEnv = spawn.mock.calls[1][2].env as Record<string, string>
    const thirdEnv = spawn.mock.calls[2][2].env as Record<string, string>
    expect(firstEnv.PATH).toBe('C:\\user-bin')
    expect(secondEnv.PATH).toBe(`C:\\verified-officecli${delimiter}C:\\user-bin`)
    expect(thirdEnv.PATH).toBe('C:\\user-bin')
    expect(firstEnv.PATH).toBe('C:\\user-bin')
    expect(process.env.PATH).toBe(originalProcessPath)
  })

  it('spawns agent CLI program directly without shell auto-command typing', async () => {
    const { TerminalManager } = await import('../../src/main/terminal/manager')
    const manager = new TerminalManager()

    manager.create({
      id: 'codex-1',
      workspaceId: 'workspace',
      cwd: process.cwd(),
      shell: 'powershell.exe',
      program: 'codex',
      programArgs: [],
      cols: 120,
      rows: 40,
    })

    expect(spawn).toHaveBeenCalledWith(
      'codex',
      [],
      expect.objectContaining({
        cols: 120,
        rows: 40,
      }),
    )
    const instance = manager.getInstance('codex-1')
    expect(instance?.pty.write).not.toHaveBeenCalled()
  })

  it('declares the PTY capabilities in the child without changing inherited process variables', async () => {
    const { TerminalManager } = await import('../../src/main/terminal/manager')
    const manager = new TerminalManager()
    const inherited = process.env.TERM
    manager.create({ id: 'term-env', workspaceId: 'workspace', cwd: process.cwd(), shell: 'powershell.exe',
      env: { TERM: 'dumb', CLAUDE_CODE_NO_FLICKER: '0' } })
    expect(spawn.mock.calls[0][2].env).toMatchObject({ TERM: 'xterm-256color', TERM_PROGRAM: 'JanusX', CLAUDE_CODE_NO_FLICKER: '0' })
    expect(process.env.TERM).toBe(inherited)
  })

  it('rejects invalid geometry, clamps extreme resize, and isolates native resize failures', async () => {
    const { TerminalManager } = await import('../../src/main/terminal/manager')
    const manager = new TerminalManager()
    manager.create({
      id: 'safe-resize', workspaceId: 'workspace', cwd: process.cwd(), shell: 'powershell.exe',
    })
    const resize = manager.getInstance('safe-resize')!.pty.resize as ReturnType<typeof vi.fn>

    manager.resize('safe-resize', Number.NaN, 40)
    expect(resize).not.toHaveBeenCalled()
    manager.resize('safe-resize', 100_000, 100_000)
    expect(resize).toHaveBeenLastCalledWith(1_000, 1_000)
    resize.mockImplementationOnce(() => { throw new Error('native resize failed') })
    expect(() => manager.resize('safe-resize', 120, 40)).not.toThrow()
  })

  it('isolates native PTY write failures', async () => {
    const { TerminalManager } = await import('../../src/main/terminal/manager')
    const manager = new TerminalManager()
    manager.create({
      id: 'safe-write', workspaceId: 'workspace', cwd: process.cwd(), shell: 'powershell.exe',
    })
    const write = manager.getInstance('safe-write')!.pty.write as ReturnType<typeof vi.fn>
    write.mockImplementationOnce(() => { throw new Error('native write failed') })
    expect(() => manager.write('safe-write', 'input')).not.toThrow()
  })
})
