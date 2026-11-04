import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn, execFile } from 'node:child_process'
import { CodexConversation } from '../../src/main/terminal/codex-conversation'
import { OpenCodeConversation } from '../../src/main/terminal/opencode-conversation'
import { ClaudeConversation } from '../../src/main/terminal/claude-conversation'
import { PiConversation, DshConversation } from '../../src/main/terminal/extension-conversation'

vi.mock('node:child_process', async importOriginal => ({
  ...await importOriginal<typeof import('node:child_process')>(),
  spawn: vi.fn(() => { throw new Error('fixture backend reached') }),
  execFile: vi.fn(() => { throw new Error('unexpected CLI version probe') }),
}))
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks() })

describe('conversation startup does not gate on installed CLI versions', () => {
  for (const [engine, Controller, verb] of [['codex', CodexConversation, 'app-server'], ['opencode', OpenCodeConversation, 'serve']] as const) {
    it(`${engine} starts the backend without executing --version`, async () => {
      const controller = new Controller(engine, vi.fn())
      try {
        await expect(controller.start({ command: `${engine}.exe`, args: [], cwd: tmpdir(), env: {}, assetsDir: tmpdir() })).rejects.toThrow('fixture backend reached')
        expect(spawn).toHaveBeenCalledWith(`${engine}.exe`, expect.arrayContaining([verb]), expect.any(Object))
        expect(execFile).not.toHaveBeenCalled()
      } finally { await controller.dispose() }
    })
  }
  it.skipIf(process.platform !== 'win32')('Claude reaches its real startup operation without a version probe', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'janusx-version-test-'))
    const controller = new ClaudeConversation('claude', vi.fn())
    const cli = vi.spyOn(controller as any, 'cli').mockRejectedValue(new Error('fixture daemon reached'))
    try {
      await expect(controller.start({ command: 'claude.exe', args: [], cwd: directory, env: {}, assetsDir: directory })).rejects.toThrow('fixture daemon reached')
      expect(cli).toHaveBeenCalled()
      expect(cli.mock.calls.some(([args]) => (args as string[]).includes('--version'))).toBe(false)
    } finally { await controller.dispose(); await rm(directory, { recursive: true, force: true }) }
  })
  for (const [engine, Controller, flag] of [['pi', PiConversation, '--extension'], ['dsh', DshConversation, '--patch']] as const) {
    it(`${engine} prepares its bridge without installed package version manifests`, async () => {
      const directory = await mkdtemp(join(tmpdir(), 'janusx-version-test-'))
      const controller = new Controller(engine, vi.fn())
      try {
        const result = await controller.start({ command: join(directory, `${engine}.cmd`), args: engine === 'dsh' ? ['--profile', 'dsh-tui'] : [], cwd: directory, env: { DSH_HOME: directory }, assetsDir: directory })
        expect(result.args).toContain(flag)
        // Preparing a bridge must not claim that a missing CLI has completed its handshake.
        expect(controller.snapshot().connection).toBe('starting')
      } finally { await controller.dispose(); await rm(directory, { recursive: true, force: true }) }
    })
  }
  it('DSH still requires the integration profile', async () => {
    const controller = new DshConversation('dsh', vi.fn())
    try {
      await expect(controller.start({ command: 'dsh.cmd', args: [], cwd: tmpdir(), env: {}, assetsDir: tmpdir() })).rejects.toThrow('dsh-tui profile')
    } finally { await controller.dispose() }
  })
})
