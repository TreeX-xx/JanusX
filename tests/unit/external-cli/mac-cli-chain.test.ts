import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({ root: '' }))
vi.mock('electron', () => ({ app: { getPath: () => fixture.root } }))
import { mergeLoginEnvironment } from '../../../src/main/external-cli/login-environment'
import { managedCliPaths } from '../../../src/main/external-cli/managed-paths'
import { findCliPackage, requiredCliPackageFile } from '../../../src/main/external-cli/package-location'
import { CliDetector } from '../../../src/main/external-cli/cli-detector'
import { clearCache } from '../../../src/main/janus-runner/cli-resolver'
import { resolveCliExecutable } from '../../../src/main/platform/cli-launch'
import { CliInstaller } from '../../../src/main/external-cli/installer'
import { EXTERNAL_CLI_TOOLS } from '../../../src/main/external-cli/tool-registry'
import { verifyManagedInstall } from '../../../src/main/external-cli/managed-install'

const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
const arch = Object.getOwnPropertyDescriptor(process, 'arch')!
beforeEach(async () => {
  fixture.root = await mkdtemp(join(tmpdir(), 'janusx-mac-cli-中文-'))
  Object.defineProperty(process, 'platform', { value: 'darwin' })
  clearCache()
})
afterEach(async () => {
  Object.defineProperty(process, 'platform', platform)
  Object.defineProperty(process, 'arch', arch)
  vi.unstubAllEnvs()
  await rm(fixture.root, { recursive: true, force: true })
})

describe('Mac CLI environment and launch contract (simulated platform)', () => {
  it('reads NUL environment after shell noise while retaining explicit app overrides', () => {
    const current = { PATH: '/usr/bin:/bin', HOME: '/Users/中文', CODEX_HOME: '/custom/codex' }
    const result = mergeLoginEnvironment(current, 'welcome\nignored=x\0JANUSX_LOGIN_ENV_START\0PATH=/Users/中文/.nvm/node/bin:/opt/homebrew/bin\0HOME=/wrong\0CODEX_HOME=/other\0PI_CODING_AGENT_DIR=/custom/pi\0MULTILINE=a\nb\0PWD=/tmp\0')
    expect(result).toMatchObject({ HOME: current.HOME, CODEX_HOME: current.CODEX_HOME, PI_CODING_AGENT_DIR: '/custom/pi', MULTILINE: 'a\nb' })
    expect(result.PATH).toBe('/Users/中文/.nvm/node/bin:/opt/homebrew/bin:/usr/bin:/bin')
    expect(result.PWD).toBeUndefined()
    expect(current.PATH).toBe('/usr/bin:/bin')
    expect(() => mergeLoginEnvironment(current, 'broken shell')).toThrow()
    expect(() => mergeLoginEnvironment(current, '\0JANUSX_LOGIN_ENV_START\0HOME=/tmp\0')).toThrow('no PATH')
  })

  it.each(['arm64', 'x64'])('detects and resolves the same managed %s copy, and notices external installs after a miss', async architecture => {
    Object.defineProperty(process, 'arch', { value: architecture })
    const paths = managedCliPaths()
    expect(paths.prefix).toContain(`tools-darwin-${architecture}`)
    const unique = `janusx-fixture-${architecture}`
    // Explicit POSIX target paths, independent of this test runner's filesystem.
    // The source VM probe covers the same chain with mapped filesystem fixtures.
    const bin = `/Users/Mac/cli-runtime/tools-darwin-${architecture}/bin`
    const binary = `${bin}/pi`, files = new Set<string>()
    const env = { PATH: bin }
    const context = { identity: { id: 'local', kind: 'local' as const, platform: 'darwin' as const, architecture, home: '/Users/Mac', revision: 'fixture' }, env, shell: '/bin/zsh' }
    const inspect = (file: string) => files.has(file) ? 'executable' as const : 'missing' as const
    expect(resolveCliExecutable(unique, context, inspect)).toBeNull()
    files.add(binary); files.add(`${bin}/${unique}`)
    const run = vi.fn(async () => ({ exitCode: 0, stdout: 'pi 1.2.3', stderr: '' }))
    const detector = new CliDetector('pi', { platform: 'darwin', env, homeDir: '/Users/Mac',
      isRegularFile: async path => files.has(path), run })
    expect(await detector.detect()).toMatchObject({ runnable: true, version: '1.2.3', path: binary })
    expect(resolveCliExecutable('pi', context, inspect)).toBe(binary)
    expect(resolveCliExecutable(unique, context, inspect)).toBe(`${bin}/${unique}`)
    expect(run).toHaveBeenCalledWith(binary, ['--version'])
  })

  it('locates POSIX global packages and hoisted DSH dependencies without putting lib under bin', async () => {
    const prefix = join(fixture.root, 'global')
    const command = join(prefix, 'bin', 'dsh')
    const dsh = join(prefix, 'lib/node_modules/@deepseek-ai/dsh')
    const llm = join(prefix, 'lib/node_modules/@deepseek-ai/dsh-llm')
    await mkdir(join(prefix, 'bin'), { recursive: true })
    await writeFile(command, 'shim')
    for (const [directory, name] of [[dsh, '@deepseek-ai/dsh'], [llm, '@deepseek-ai/dsh-llm']]) {
      await mkdir(directory, { recursive: true })
      await writeFile(join(directory, 'package.json'), JSON.stringify({ name }))
    }
    await mkdir(join(llm, 'lib'))
    await writeFile(join(llm, 'lib/index.js'), 'export {}')
    expect(findCliPackage(command, '@deepseek-ai/dsh')).toBe(dsh)
    expect(requiredCliPackageFile(join(dsh, 'package.json'), '@deepseek-ai/dsh-llm', 'lib/index.js')).toBe(join(llm, 'lib/index.js'))
    await expect(async () => requiredCliPackageFile(command, 'missing', 'index.js')).rejects.toThrow('Required CLI component')
  })

  it('holds the install lock through verification and fails when exit zero produced no usable target', async () => {
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const verifyInstall = vi.fn(async () => { await gate; throw new Error('target missing') })
    const installer = new CliInstaller({ platform: 'darwin', env: {}, homeDir: fixture.root,
      isRegularFile: async () => false, prepareNpm: async () => ({ path: '/private/node/bin/npm', pathDirs: ['/private/node/bin'] }),
      installPrefix: () => '/private/tools-darwin-arm64', run: async () => ({ exitCode: 0, stdout: '', stderr: '' }), verifyInstall })
    const first = installer.install(EXTERNAL_CLI_TOOLS.pi)
    await vi.waitFor(() => expect(verifyInstall).toHaveBeenCalled())
    expect((await installer.install(EXTERNAL_CLI_TOOLS.pi)).success).toBe(false)
    release()
    expect(await first).toMatchObject({ success: false, error: 'target missing' })
    expect(installer.isBusy()).toBe(false)
    expect(installer.buildCommand('/private/npm', EXTERNAL_CLI_TOOLS.dsh).args).toEqual(expect.arrayContaining(['@deepseek-harness-tui/dsh-tui', 'pnpm@10', '--prefix', '/private/tools-darwin-arm64']))
  })

  it('verifies the package identity, exact version and command in the private POSIX prefix', async () => {
    const paths = managedCliPaths()
    const root = join(paths.prefix, 'lib/node_modules/@earendil-works/pi-coding-agent')
    await mkdir(root, { recursive: true })
    await mkdir(paths.toolsBin, { recursive: true })
    await writeFile(join(paths.toolsBin, 'pi'), 'fixture')
    const metadata = join(root, 'package.json')
    await writeFile(metadata, JSON.stringify({ name: '@earendil-works/pi-coding-agent', version: '1.2.3' }))
    await expect(verifyManagedInstall(EXTERNAL_CLI_TOOLS.pi, 'latest', paths)).resolves.toEqual({ path: join(paths.toolsBin, 'pi'), version: '1.2.3' })
    await expect(verifyManagedInstall(EXTERNAL_CLI_TOOLS.pi, '1.2.4', paths)).rejects.toThrow('Could not verify')
    await writeFile(metadata, JSON.stringify({ name: 'wrong-package', version: '1.2.3' }))
    await expect(verifyManagedInstall(EXTERNAL_CLI_TOOLS.pi, 'latest', paths)).rejects.toThrow('Could not verify')
    await writeFile(metadata, JSON.stringify({ name: '@earendil-works/pi-coding-agent', version: '1.2.3' }))
    await rm(join(paths.toolsBin, 'pi'))
    await expect(verifyManagedInstall(EXTERNAL_CLI_TOOLS.pi, 'latest', paths)).rejects.toThrow()
  })
})
