import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import childProcess from 'node:child_process'
import { syncBuiltinESMExports } from 'node:module'
import { CodexConversation } from '../../src/main/terminal/codex-conversation'
import { OpenCodeConversation } from '../../src/main/terminal/opencode-conversation'
import { ClaudeConversation } from '../../src/main/terminal/claude-conversation'
import { PiConversation, DshConversation } from '../../src/main/terminal/extension-conversation'

beforeEach(() => {
  vi.spyOn(childProcess, 'spawn').mockImplementation(() => { throw new Error('fixture backend reached') })
  vi.spyOn(childProcess, 'execFile').mockImplementation(() => { throw new Error('unexpected CLI version probe') })
  // The pinned native ESM engine must share the same subprocess fixture.
  syncBuiltinESMExports()
})

afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); syncBuiltinESMExports() })

async function prepareDsh(directory: string) {
  for (const [name, entry] of [['@deepseek-ai/dsh', 'index.js'], ['@deepseek-ai/dsh-llm', 'lib/index.js'], ['@deepseek-harness-tui/dsh-tui', 'lib/types/commands.js']]) {
    const root = join(directory, 'node_modules', name)
    await mkdir(join(root, entry, '..'), { recursive: true })
    // Package identity is required; version is deliberately absent.
    await writeFile(join(root, 'package.json'), JSON.stringify({ name }))
    await writeFile(join(root, entry), 'export {}')
  }
}

describe('conversation startup does not gate on installed CLI versions', () => {
  for (const [engine, Controller, verb] of [['codex', CodexConversation, 'app-server'], ['opencode', OpenCodeConversation, 'serve']] as const) {
    it(`${engine} starts the backend without executing --version`, async () => {
      const controller = new Controller(engine, vi.fn())
      const directory = await mkdtemp(join(tmpdir(), 'janusx-version-test-'))
      const command = join(directory, `${engine}.exe`)
      try {
        await writeFile(command, 'fixture', { mode: 0o755 })
        await expect(controller.start({ command, args: [], cwd: directory, env: {}, assetsDir: directory })).rejects.toThrow('fixture backend reached')
        expect(childProcess.spawn).toHaveBeenCalledWith(command, expect.arrayContaining([verb]), expect.any(Object))
        expect(childProcess.execFile).not.toHaveBeenCalled()
      } finally { await controller.dispose(); await rm(directory, { recursive: true, force: true }) }
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
        if (engine === 'dsh') await prepareDsh(directory)
        const result = await controller.start({ command: join(directory, `${engine}.cmd`), args: engine === 'dsh' ? ['--profile', 'dsh-tui'] : [], cwd: directory, env: { DSH_HOME: directory }, assetsDir: directory })
        expect(result.args).toContain(flag)
        // Preparing a bridge must not claim that a missing CLI has completed its handshake.
        expect(controller.snapshot().connection).toBe('starting')
      } finally { await controller.dispose(); await rm(directory, { recursive: true, force: true }) }
    })
  }
  it('DSH still requires the integration profile', async () => {
    const controller = new DshConversation('dsh', vi.fn())
    const directory = await mkdtemp(join(tmpdir(), 'janusx-version-test-'))
    try {
      await prepareDsh(directory)
      await expect(controller.start({ command: join(directory, 'dsh.cmd'), args: [], cwd: directory, env: {}, assetsDir: directory })).rejects.toThrow('dsh-tui profile')
    } finally { await controller.dispose(); await rm(directory, { recursive: true, force: true }) }
  })
})
