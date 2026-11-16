import { posix, win32 } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { CliInstaller } from '../../../src/main/external-cli/installer'
import { EXTERNAL_CLI_TOOLS } from '../../../src/main/external-cli/tool-registry'

const v1 = { ...EXTERNAL_CLI_TOOLS.opencode, npmPackage: 'opencode-ai' }
const v2 = { ...v1, npmPackage: '@opencode/cli' }
const ok = { exitCode: 0, stdout: '', stderr: '' }

function harness(platform: NodeJS.Platform = 'linux', verifyInstall?: () => Promise<{ path: string; version: string }>) {
  const { dirname, resolve } = platform === 'win32' ? win32 : posix
  const npmPath = platform === 'win32' ? 'C:\\npm-test\\npm.cmd' : '/npm-test/npm'
  const run = vi.fn(async (_file: string, _args: readonly string[], _options: unknown) => ok)
  run.mockResolvedValueOnce({ ...ok, stdout: JSON.stringify({ dependencies: { 'opencode-ai': { version: '1.19.3' } } }) })
  const installer = new CliInstaller({
    platform, env: { PATH: dirname(npmPath) }, homeDir: dirname(npmPath),
    isRegularFile: async candidate => resolve(candidate) === npmPath, run, verifyInstall,
  })
  return { installer, run }
}

describe('OpenCode npm package migration', () => {
  it('restores the old package when npm exits zero but target verification fails', async () => {
    const { installer, run } = harness('linux', async () => { throw new Error('wrong installed version') })
    expect(await installer.install(v2, '2.1.4', v1)).toMatchObject({ success: false, error: expect.stringContaining('Previous npm package restored') })
    const commands = run.mock.calls.map(([, args]) => args.join(' '))
    expect(commands.at(-2)).toContain('rm -g @opencode/cli')
    expect(commands.at(-1)).toContain('i -g opencode-ai@1.19.3')
  })
  it.each(['linux', 'win32'] as const)('replaces the conflicting package under one lock on %s', async platform => {
    const { installer, run } = harness(platform)
    expect(await installer.install(v2, '2.1.4', v1)).toMatchObject({ success: true })
    const commands = run.mock.calls.map(([, args]) => args.join(' '))
    expect(commands).toHaveLength(3)
    expect(commands[0]).toContain('ls -g --depth=0 --json opencode-ai')
    expect(commands[1]).toContain('rm -g opencode-ai')
    expect(commands[2]).toContain('i -g @opencode/cli@2.1.4')
    expect(commands.join(' ')).not.toContain('--force')
  })

  it('installs directly when npm ls returns an empty filtered result with exit 1', async () => {
    const { installer, run } = harness()
    run.mockReset().mockResolvedValue(ok).mockResolvedValueOnce({ ...ok, exitCode: 1, stdout: '{"name":"npm"}' })
    expect(await installer.install(v2, '2.1.4', v1)).toMatchObject({ success: true })
    expect(run.mock.calls.map(([, args]) => args[0])).toEqual(['ls', 'i'])
  })

  it.each(['garbage', '{"error":{"code":"EACCES"}}', '{"dependencies":{"opencode-ai":{"version":"file:linked"}}}'])('does not remove anything when inspection is unreliable: %s', async stdout => {
    const { installer, run } = harness()
    run.mockReset().mockResolvedValueOnce({ ...ok, exitCode: 1, stdout })
    expect(await installer.install(v2, '2.1.4', v1)).toMatchObject({ success: false })
    expect(run).toHaveBeenCalledOnce()
    expect(installer.isBusy()).toBe(false)
  })

  it('stops if removing the old package fails', async () => {
    const { installer, run } = harness()
    run.mockResolvedValueOnce({ ...ok, exitCode: 1, stderr: 'locked v1' })
    expect(await installer.install(v2, '2.1.4', v1)).toMatchObject({ success: false, error: 'locked v1' })
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('cleans up a partial v2 install and restores the exact previous npm version on failure', async () => {
    const { installer, run } = harness()
    run.mockResolvedValueOnce(ok).mockResolvedValueOnce({ ...ok, exitCode: 1, stderr: 'v2 download failed' })
    const result = await installer.install(v2, '2.1.4', v1)
    expect(result).toMatchObject({ success: false, error: expect.stringContaining('Previous npm package restored') })
    const commands = run.mock.calls.map(([, args]) => args.join(' '))
    expect(commands[3]).toBe('rm -g @opencode/cli')
    expect(commands[4]).toBe('i -g opencode-ai@1.19.3')
    expect(installer.isBusy()).toBe(false)
  })

  it('reports a failed recovery instead of hiding it', async () => {
    const { installer, run } = harness()
    run.mockResolvedValueOnce(ok)
      .mockResolvedValueOnce({ ...ok, exitCode: 1, stderr: 'v2 failed' })
      .mockResolvedValueOnce(ok)
      .mockResolvedValueOnce({ ...ok, exitCode: 1, stderr: 'v1 restore failed' })
    expect(await installer.install(v2, '2.1.4', v1)).toMatchObject({ success: false, error: expect.stringContaining('v1 restore failed') })
  })

  it('holds the installer lock through inspection and blocks uninstall too', async () => {
    const { installer, run } = harness()
    let release!: (value: typeof ok) => void
    run.mockReset().mockResolvedValue(ok).mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
    const first = installer.install(v2, '2.1.4', v1)
    await vi.waitFor(() => expect(run).toHaveBeenCalledOnce())
    expect(await installer.install(v1)).toMatchObject({ success: false })
    expect(await installer.uninstall(v1)).toMatchObject({ success: false })
    release({ ...ok, stdout: '{"name":"npm"}' })
    expect(await first).toMatchObject({ success: true })
  })

  it('rejects untrusted version text before invoking npm', async () => {
    const { installer, run } = harness()
    await expect(installer.install(v2, '2.1.4; whoami')).rejects.toThrow('Invalid release version')
    expect(run).not.toHaveBeenCalled()
    expect(installer.isBusy()).toBe(false)
  })
})
