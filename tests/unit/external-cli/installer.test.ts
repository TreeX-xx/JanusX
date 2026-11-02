import { dirname, join, resolve } from 'path'
import { mkdtemp, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { describe, expect, it, vi } from 'vitest'
import { CliInstaller } from '../../../src/main/external-cli/installer'
import { EXTERNAL_CLI_TOOLS } from '../../../src/main/external-cli/tool-registry'

function createHarness(options: {
  npmPath?: string
  platform?: NodeJS.Platform
  exitCode?: number
  stderr?: string
} = {}) {
  const run = vi.fn(async () => ({ exitCode: options.exitCode ?? 0, stdout: '', stderr: options.stderr ?? '' }))
  const installer = new CliInstaller({
    platform: options.platform ?? 'win32',
    env: { PATH: options.npmPath ? dirname(options.npmPath) : '', APPDATA: 'C:\\Users\\test\\AppData\\Roaming' },
    homeDir: 'C:\\Users\\test',
    isRegularFile: async candidate => resolve(candidate) === resolve(options.npmPath ?? ''),
    run,
  })
  return { installer, run }
}

describe('CliInstaller', () => {
  it('prepares missing npm under the install lock and explicitly pins the private prefix', async () => {
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const run = vi.fn(async () => ({ exitCode: 0, stdout: '', stderr: '' }))
    const prepareNpm = vi.fn(async () => { await gate; return { path: 'C:\\private\\npm.cmd', pathDirs: ['C:\\private'] } })
    const installer = new CliInstaller({ platform: 'win32', env: {}, homeDir: 'C:\\fixture',
      isRegularFile: async () => false, run, prepareNpm, installPrefix: () => "C:\\user's data\\tools" })
    const first = installer.install(EXTERNAL_CLI_TOOLS.claude)
    await expect(installer.install(EXTERNAL_CLI_TOOLS.codex)).resolves.toMatchObject({ success: false, error: 'Another install is already running.' })
    release()
    await expect(first).resolves.toMatchObject({ success: true })
    expect(prepareNpm).toHaveBeenCalledWith(undefined)
    expect(run.mock.calls[0][1].join(' ')).toContain("--prefix 'C:\\user''s data\\tools'")
    expect(installer.buildUninstallCommand('C:\\private\\npm.cmd', EXTERNAL_CLI_TOOLS.claude).args.join(' ')).toContain('--prefix')
  })

  it('refuses to run when npm cannot be located and hands out the manual command', async () => {
    const { installer, run } = createHarness()

    await expect(installer.install(EXTERNAL_CLI_TOOLS.claude)).resolves.toEqual({
      success: false,
      command: 'npm i -g @anthropic-ai/claude-code@latest',
      error: expect.stringContaining('npm was not found'),
    })
    expect(run).not.toHaveBeenCalled()
  })

  it('runs npm through PowerShell on Windows and reports success', async () => {
    const npmPath = 'C:\\Users\\test\\AppData\\Roaming\\npm\\npm.cmd'
    const { installer, run } = createHarness({ npmPath })

    await expect(installer.install(EXTERNAL_CLI_TOOLS.claude)).resolves.toEqual({
      success: true,
      command: `& "${npmPath}" i -g @anthropic-ai/claude-code@latest`,
    })
    expect(run.mock.calls[0][0]).toBe('powershell.exe')
  })

  it('surfaces only the tail of a failed install', async () => {
    const npmPath = 'C:\\Users\\test\\AppData\\Roaming\\npm\\npm.cmd'
    const { installer } = createHarness({ npmPath, exitCode: 1, stderr: 'line1\nline2\nnpm ERR! boom' })

    const result = await installer.install(EXTERNAL_CLI_TOOLS.claude)
    expect(result.success).toBe(false)
    expect(result.error).toContain('npm ERR! boom')
  })

  it('blocks a second install while one is running', async () => {
    const npmPath = 'C:\\Users\\test\\AppData\\Roaming\\npm\\npm.cmd'
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const run = vi.fn(async () => {
      await gate
      return { exitCode: 0, stdout: '', stderr: '' }
    })
    const installer = new CliInstaller({
      platform: 'win32',
      env: { PATH: dirname(npmPath) },
      homeDir: 'C:\\Users\\test',
      isRegularFile: async candidate => resolve(candidate) === resolve(npmPath),
      run,
    })

    const first = installer.install(EXTERNAL_CLI_TOOLS.claude)
    await expect(installer.install(EXTERNAL_CLI_TOOLS.claude)).resolves.toMatchObject({ success: false })
    release()
    await expect(first).resolves.toMatchObject({ success: true })
  })

  it('builds then links the janus sibling source in its own directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'janusx-janus-src-'))
    const packageDir = join(root, 'packages', 'cli')
    const { mkdir } = await import('fs/promises')
    await mkdir(packageDir, { recursive: true })
    await writeFile(join(packageDir, 'package.json'), JSON.stringify({ name: '@janus-agent/cli', version: '0.2.0' }), 'utf8')
    const calls: Array<{ file: string; args: readonly string[]; cwd?: string }> = []
    const installer = new CliInstaller({
      platform: 'linux',
      env: { PATH: '' },
      homeDir: root,
      isRegularFile: async () => true,
      run: async (file, args, options) => {
        calls.push({ file, args, cwd: options.cwd })
        return { exitCode: 0, stdout: '', stderr: '' }
      },
      resolveSiblingRoot: () => root,
    })

    const result = await installer.install(EXTERNAL_CLI_TOOLS.janus)
    expect(result.success).toBe(true)
    expect(result.command).toContain('npm run build')
    expect(result.command).toContain('npm link')
    expect(calls.map(call => call.args)).toEqual([['run', 'build'], ['link']])
    expect(calls.every(call => call.cwd === packageDir)).toBe(true)
  })

  it('falls back to npm install when the janus source is absent', async () => {
    const npmPath = '/usr/bin/npm'
    const run = vi.fn(async () => ({ exitCode: 0, stdout: '', stderr: '' }))
    const installer = new CliInstaller({
      platform: 'linux',
      env: { PATH: '/usr/bin' },
      homeDir: '/nonexistent',
      isRegularFile: async candidate => resolve(candidate) === resolve(npmPath),
      run,
      resolveSiblingRoot: () => undefined,
    })

    const result = await installer.install(EXTERNAL_CLI_TOOLS.janus)
    expect(result).toMatchObject({ success: true })
    expect(result.command).toContain('i -g @janus-agent/cli@latest')
    expect(run).toHaveBeenCalledOnce()
  })

  it('stops before link when the janus build fails', async () => {    const root = await mkdtemp(join(tmpdir(), 'janusx-janus-fail-'))
    const packageDir = join(root, 'packages', 'cli')
    const { mkdir } = await import('fs/promises')
    await mkdir(packageDir, { recursive: true })
    await writeFile(join(packageDir, 'package.json'), JSON.stringify({ name: '@janus-agent/cli', version: '0.2.0' }), 'utf8')
    let runs = 0
    const installer = new CliInstaller({
      platform: 'linux',
      env: { PATH: '' },
      homeDir: root,
      isRegularFile: async () => true,
      run: async () => {
        runs += 1
        return runs === 1
          ? { exitCode: 1, stdout: '', stderr: 'tsc error TS0000' }
          : { exitCode: 0, stdout: '', stderr: '' }
      },
      resolveSiblingRoot: () => root,
    })

    const result = await installer.install(EXTERNAL_CLI_TOOLS.janus)
    expect(result.success).toBe(false)
    expect(result.error).toContain('tsc error TS0000')
    expect(runs).toBe(1)
  })

  it('removes the npm package on uninstall through the same silent shell', async () => {
    const npmPath = 'C:\\Users\\test\\AppData\\Roaming\\npm\\npm.cmd'
    const { installer, run } = createHarness({ npmPath })

    await expect(installer.uninstall(EXTERNAL_CLI_TOOLS.codex)).resolves.toEqual({
      success: true,
      command: `& "${npmPath}" rm -g @openai/codex`,
    })
    expect(run.mock.calls[0][0]).toBe('powershell.exe')
    expect(run.mock.calls[0][1].join(' ')).toContain('rm -g @openai/codex')
  })

  it('reports uninstall failures and refuses non-npm tools', async () => {
    const npmPath = 'C:\\Users\\test\\AppData\\Roaming\\npm\\npm.cmd'
    const { installer } = createHarness({ npmPath, exitCode: 1, stderr: 'npm ERR! not found' })

    const failed = await installer.uninstall(EXTERNAL_CLI_TOOLS.codex)
    expect(failed.success).toBe(false)
    expect(failed.error).toContain('npm ERR! not found')
  })

  it('uninstalls janus through npm like every other tool', async () => {
    const npmPath = 'C:\\Users\\test\\AppData\\Roaming\\npm\\npm.cmd'
    const { installer, run } = createHarness({ npmPath })

    await expect(installer.uninstall(EXTERNAL_CLI_TOOLS.janus)).resolves.toEqual({
      success: true,
      command: `& "${npmPath}" rm -g @janus-agent/cli`,
    })
    expect(run.mock.calls[0][1].join(' ')).toContain('rm -g @janus-agent/cli')
  })
})

