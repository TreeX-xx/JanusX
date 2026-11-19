import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'

const state = vi.hoisted(() => ({ root: '', prefix: '', active: undefined as string | undefined, version: '2.0.0', env: {} as NodeJS.ProcessEnv, fail: false, run: vi.fn() }))
vi.mock('electron', () => ({ app: { getPath: () => state.root } }))
vi.mock('../../../src/main/platform/runtime-context', () => ({ localSystem: () => ({ platform: process.platform, architecture: process.arch, home: state.root }) }))
vi.mock('../../../src/main/external-cli/managed-paths', () => ({ managedCliEnv: () => state.env, setMacNpmPrefix: vi.fn() }))
vi.mock('../../../src/main/platform/process-host', () => ({ runProcess: (...args: unknown[]) => state.run(...args) }))
vi.mock('../../../src/main/platform/cli-launch', () => ({ resolveCliExecutable: (command: string) => command }))
vi.mock('../../../src/main/external-cli/cli-detector', async original => {
  const actual = await original<typeof import('../../../src/main/external-cli/cli-detector')>()
  return { ...actual, CliDetector: class {
    async findCandidate() { return state.active ? { path: state.active, source: 'path' } : undefined }
    async detect(candidate?: { path: string }) { return { installed: true, runnable: true, path: candidate?.path ?? state.active, version: state.version } }
  } }
})
import { createSystemCliInstaller, nativeUpdateCommand, npmOwnsCommand } from '../../../src/main/external-cli/system-install'
import { EXTERNAL_CLI_TOOLS } from '../../../src/main/external-cli/tool-registry'

const modules = (prefix: string) => join(prefix, process.platform === 'win32' ? 'node_modules' : 'lib/node_modules')
async function installFixture(prefix: string): Promise<string> {
  const root = join(modules(prefix), EXTERNAL_CLI_TOOLS.pi.npmPackage!)
  await mkdir(root, { recursive: true })
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: EXTERNAL_CLI_TOOLS.pi.npmPackage, version: state.version }))
  const entry = join(root, 'cli.js')
  await writeFile(entry, '#!/usr/bin/env node\nconsole.log("2.0.0")')
  const command = join(prefix, process.platform === 'win32' ? 'pi.cmd' : 'bin/pi')
  await mkdir(dirname(command), { recursive: true })
  if (process.platform === 'win32') await writeFile(command, '@echo off\r\n"%dp0%node_modules\\@earendil-works\\pi-coding-agent\\cli.js" %*')
  else { await chmod(entry, 0o755); await rm(command, { force: true }); await symlink(entry, command) }
  return command
}
beforeEach(async () => {
  state.root = await mkdtemp(join(tmpdir(), 'janusx-system-install-'))
  state.prefix = join(state.root, 'system-global')
  state.active = undefined; state.version = '2.0.0'; state.fail = false
  const npm = join(state.root, 'node', process.platform === 'win32' ? 'npm.cmd' : 'npm')
  await mkdir(dirname(npm), { recursive: true }); await writeFile(npm, 'fixture')
  state.env = { PATH: dirname(npm) }
  state.run.mockReset().mockImplementation(async (_file: string, args: string[]) => {
    let stdout = ''
    if (args[0] === 'prefix') stdout = state.prefix
    else if (args[0] === 'root') stdout = modules(state.prefix)
    else if (!state.fail) state.active = await installFixture(state.prefix)
    const failed = state.fail && !['prefix', 'root'].includes(args[0])
    return { status: 'exited', exitCode: failed ? 1 : 0, stdout, stderr: failed ? 'permission denied' : '', truncated: false }
  })
})
afterEach(async () => { await rm(state.root, { recursive: true, force: true }) })

describe('system CLI installation', () => {
  it('uses system npm global configuration and verifies that exact package and command', async () => {
    const result = await createSystemCliInstaller().install(EXTERNAL_CLI_TOOLS.pi)
    expect(result).toMatchObject({ success: true, target: { path: state.active, version: '2.0.0' } })
    const install = state.run.mock.calls.find(call => !['prefix', 'root'].includes(call[1][0]))!
    expect(install[1].join(' ')).toContain(state.prefix)
    expect(install[1].join(' ')).not.toContain('cli-runtime')
    expect(install[2].env).not.toHaveProperty('npm_config_prefix')
  })
  it('refuses a different Node/npm prefix before any installation is changed', async () => {
    state.active = await installFixture(join(state.root, 'another-node'))
    const result = await createSystemCliInstaller().install(EXTERNAL_CLI_TOOLS.pi)
    expect(result).toMatchObject({ success: false, error: expect.stringContaining('outside the active npm prefix') })
    expect(state.run.mock.calls.map(call => call[1][0])).toEqual(['prefix', 'root'])
  })
  it('upgrades the existing command in the same system npm prefix', async () => {
    state.active = await installFixture(state.prefix)
    const original = state.active
    state.version = '2.1.0'
    expect(await createSystemCliInstaller().install(EXTERNAL_CLI_TOOLS.pi, '2.1.0')).toMatchObject({ success: true, target: { path: original, version: '2.1.0' } })
    expect(state.run.mock.calls[2][1].join(' ')).toContain('@2.1.0')
  })
  it('does not create a second copy for an unknown existing installation', async () => {
    state.active = join(state.root, 'native', 'pi')
    await mkdir(dirname(state.active)); await writeFile(state.active, 'native')
    expect(await createSystemCliInstaller().install(EXTERNAL_CLI_TOOLS.pi)).toMatchObject({ success: false, error: expect.stringContaining('original package manager') })
    expect(state.run).not.toHaveBeenCalled()
  })
  it('does not download a private runtime when system npm is missing', async () => {
    state.env = {}
    await rm(join(state.root, 'node'), { recursive: true })
    expect(await createSystemCliInstaller().install(EXTERNAL_CLI_TOOLS.pi)).toMatchObject({ success: false, error: expect.stringContaining('npm was not found') })
    expect(state.run).not.toHaveBeenCalled()
  })
  it('does not treat an unrelated executable next to an npm package as npm-owned', async () => {
    await installFixture(state.prefix)
    const native = join(state.prefix, 'pi.exe'); await writeFile(native, 'unrelated executable')
    expect(await npmOwnsCommand(native, modules(state.prefix), EXTERNAL_CLI_TOOLS.pi.npmPackage!)).toBe(false)
  })
  it('surfaces permission failures without switching to a private fallback', async () => {
    state.fail = true
    expect(await createSystemCliInstaller().install(EXTERNAL_CLI_TOOLS.pi)).toMatchObject({ success: false, error: 'permission denied' })
    expect(state.run).toHaveBeenCalledTimes(3)
  })
  it.runIf(process.platform === 'win32')('repairs an owned npm shim even when package metadata is missing', async () => {
    state.active = await installFixture(state.prefix)
    await rm(join(modules(state.prefix), EXTERNAL_CLI_TOOLS.pi.npmPackage!, 'package.json'))
    expect(await createSystemCliInstaller().install(EXTERNAL_CLI_TOOLS.pi)).toMatchObject({ success: true, target: { path: state.active } })
  })
  it.each(['/opt/homebrew', '/usr/local'])('keeps Mac native and Homebrew upgrades at the original installation (%s)', prefix => {
    expect(nativeUpdateCommand('claude', '/Users/u/.local/bin/claude', '/Users/u/.local/share/claude/versions/2', '/Users/u', 'darwin', 'latest')).toEqual({ file: '/Users/u/.local/bin/claude', args: ['update'] })
    expect(nativeUpdateCommand('codex', `${prefix}/bin/codex`, `${prefix}/Caskroom/codex/1/codex`, '/Users/u', 'darwin', 'latest', `${prefix}/bin/brew`)).toEqual({ file: `${prefix}/bin/brew`, args: ['upgrade', 'codex'] })
    expect(() => nativeUpdateCommand('opencode', '/opt/homebrew/bin/opencode', '/opt/homebrew/Cellar/opencode/1/bin/opencode', '/Users/u', 'darwin', '2.0.0', '/opt/homebrew/bin/brew')).toThrow('Homebrew')
  })
})
