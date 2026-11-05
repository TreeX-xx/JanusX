import { describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { acceptClaudeWorkspaceTrust, claudeTrustDirectory } from '../../src/main/terminal/claude-trust'
import { ClaudeConversation } from '../../src/main/terminal/claude-conversation'

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'claude-trust-'))
  const cwd = join(root, '工作目录'); await mkdir(cwd)
  const directory = claudeTrustDirectory(cwd)
  const env = { CLAUDE_CONFIG_DIR: root }
  const file = join(root, '.claude.json')
  return { root, cwd, directory, env, file, close: () => rm(root, { recursive: true, force: true }) }
}

describe('Claude native workspace consent storage', () => {
  it('preserves unrelated settings and project fields, including equivalent Windows keys', async () => {
    const f = await fixture()
    try {
      const key = process.platform === 'win32' ? f.directory.replaceAll('/', '\\') : f.directory
      const existing = { token: 'keep', projects: { '/other': { hasTrustDialogAccepted: false }, [key]: { hasTrustDialogAccepted: false, allowedTools: ['Read'] } } }
      await writeFile(f.file, JSON.stringify(existing, null, 2))
      acceptClaudeWorkspaceTrust(f.directory, f.env)
      const config = JSON.parse(await readFile(f.file, 'utf8'))
      expect(config.token).toBe('keep')
      expect(config.projects['/other']).toEqual(existing.projects['/other'])
      expect(config.projects[key]).toEqual({ hasTrustDialogAccepted: true, allowedTools: ['Read'] })
      expect(config.projects[f.directory].hasTrustDialogAccepted).toBe(true)
    } finally { await f.close() }
  })
  it('supports a fresh default home config and refuses malformed data without replacing it', async () => {
    const f = await fixture()
    try {
      acceptClaudeWorkspaceTrust(f.directory, { USERPROFILE: f.root })
      expect(JSON.parse(await readFile(f.file, 'utf8')).projects[f.directory].hasTrustDialogAccepted).toBe(true)
      for (const source of ['{broken', '[]', '{"projects":[]}', JSON.stringify({ projects: { [f.directory]: null } })]) {
        await writeFile(f.file, source)
        expect(() => acceptClaudeWorkspaceTrust(f.directory, f.env)).toThrow()
        expect(await readFile(f.file, 'utf8')).toBe(source)
      }
    } finally { await f.close() }
  })
})

describe.skipIf(process.platform !== 'win32')('Claude conversation startup trust', () => {
  async function launch() {
    const f = await fixture()
    const controller = new ClaudeConversation('trust', vi.fn())
    const wire = controller as any
    const cli = vi.spyOn(wire, 'cli').mockImplementation(async (...values: any[]) => {
      const args = values[0] as string[]
      if (args.includes('--bg')) {
        let trusted = false
        try { trusted = JSON.parse(await readFile(f.file, 'utf8')).projects[f.directory].hasTrustDialogAccepted } catch { /* fresh config */ }
        if (!trusted) throw Object.assign(new Error('native trust required'), { stderr: `Workspace not trusted. Run \`claude\` in ${f.cwd} once and accept the trust prompt, then retry.\n` })
        controller.state.threadId = 'native'; return { stdout: 'backgrounded · abcd1234', stderr: '' }
      }
      return { stdout: JSON.stringify([{ id: 'abcd1234', pid: 123, sessionId: 'native' }]), stderr: '' }
    })
    vi.spyOn(wire, 'loadModels').mockResolvedValue(undefined)
    await controller.command({ type: 'mode', mode: 'conversation' })
    const starting = controller.start({ command: 'C:/fixture/claude.exe', args: [], cwd: f.cwd, env: f.env, assetsDir: join(f.root, 'assets') })
    await vi.waitFor(() => expect(controller.state.startup?.status).toBe('pending'))
    const command = (action: 'trust' | 'cancel' | 'resume', startupId = controller.state.startup!.id, controlEpoch = controller.state.controlEpoch) => controller.command({ type: 'startup', action, startupId, controlEpoch })
    return { ...f, controller, wire, cli, starting, command }
  }
  it('does not write before consent; supports cancel/resume, stale rejection and ready readback', async () => {
    const f = await launch()
    try {
      await expect(readFile(f.file)).rejects.toThrow()
      await f.command('cancel')
      expect(f.controller.state.startup?.status).toBe('cancelled')
      await expect(f.command('trust')).rejects.toThrow('Invalid startup action')
      await expect(f.command('resume', 99)).rejects.toThrow('Startup control changed')
      await f.command('resume')
      await expect(f.command('trust', 1, -1)).rejects.toThrow('Startup control changed')
      await expect(f.controller.command({ type: 'mode', mode: 'terminal' })).rejects.toThrow('Complete startup')
      await f.command('trust')
      expect(await f.starting).toEqual({ command: 'C:/fixture/claude.exe', args: ['attach', 'abcd1234'] })
      expect(f.controller.state.connection).toBe('ready')
      expect(f.controller.state.startup).toBeUndefined()
      expect(f.cli.mock.calls.filter(args => (args[0] as string[]).includes('--bg'))).toHaveLength(2)
    } finally { await f.controller.dispose(); await f.close() }
  })
  it('keeps failed consent retryable and closes a paused startup without hanging', async () => {
    const f = await launch()
    const rejected = expect(f.starting).rejects.toThrow('cancelled')
    try {
      await writeFile(f.file, '{malformed')
      await f.command('trust')
      expect(f.controller.state.startup).toMatchObject({ status: 'pending', error: expect.any(String) })
      await f.command('cancel')
      await f.controller.dispose(); await rejected
      expect(f.controller.state.connection).toBe('closed')
    } finally { await f.controller.dispose(); await f.close() }
  })
  it('requires fresh consent if native readback still refuses trust; rejects duplicate and old controls', async () => {
    const f = await launch()
    const rejected = expect(f.starting).rejects.toThrow('cancelled')
    try {
      f.cli.mockRejectedValue(Object.assign(new Error('still untrusted'), { stderr: `Workspace not trusted. Run \`claude\` in ${f.cwd} once and accept the trust prompt, then retry.` }))
      const first = f.command('trust')
      await expect(f.command('trust')).rejects.toThrow('Startup control changed')
      await first
      await vi.waitFor(() => expect(f.controller.state.startup).toMatchObject({ id: 2, status: 'pending', error: expect.any(String) }))
      await expect(f.command('trust', 1)).rejects.toThrow('Startup control changed')
      expect(f.controller.state.connection).toBe('starting')
      await f.controller.dispose(); await rejected
    } finally { await f.controller.dispose(); await f.close() }
  })
  it.each(['native failed', 'Workspace not trusted. Unexpected output'])('does not retry or write consent on an ambiguous dispatch failure: %s', async stderr => {
    const f = await fixture()
    const controller = new ClaudeConversation('failed', vi.fn())
    const cli = vi.spyOn(controller as any, 'cli').mockRejectedValue(Object.assign(new Error('failed'), { stderr }))
    try {
      await controller.command({ type: 'mode', mode: 'conversation' })
      await expect(controller.start({ command: 'C:/fixture/claude.exe', args: [], cwd: f.cwd, env: f.env, assetsDir: join(f.root, 'assets') })).rejects.toThrow('could not start')
      expect(cli).toHaveBeenCalledTimes(1)
      expect(controller.state.startup).toBeUndefined()
      await expect(readFile(f.file)).rejects.toThrow()
    } finally { await controller.dispose(); await f.close() }
  })
})
