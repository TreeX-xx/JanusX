import { describe, expect, it } from 'vitest'
import { defaultShell, environmentRevision, environmentWithPath } from '../../src/main/platform/environment'
import { commandCandidates, resolveCommand } from '../../src/main/platform/command-resolver'
import { cliKnownBinDirs } from '../../src/main/external-cli/search-paths'
import { assertLocalLaunch } from '../../src/main/platform/runtime-context'

describe('target environment contract', () => {
  it('folds Windows PATH keys and directories without changing values on POSIX', () => {
    expect(environmentWithPath({ Path: 'C:\\BIN;C:\\other', PATH: 'C:\\bin;C:\\中文', SECRET: 'keep' }, 'win32', ['c:\\BIN'])).toEqual({ PATH: 'c:\\BIN;C:\\中文', SECRET: 'keep' })
    expect(environmentWithPath({ Path: '/ignored', PATH: '/A:/a::/A' }, 'darwin')).toEqual({ Path: '/ignored', PATH: '/A:/a' })
  })
  it.each(['darwin', 'linux'] as const)('uses target POSIX paths on a Windows test host (%s)', platform => {
    expect(cliKnownBinDirs({}, platform, '/Users/中文')).toContain('/Users/中文/.local/bin')
    expect(commandCandidates('cli', { platform, env: { PATH: '/opt/bin:/usr/bin' } })).toEqual(['/opt/bin/cli', '/usr/bin/cli'])
    expect(commandCandidates('cli', { platform, env: { Path: '/wrong' } })).toEqual([])
  })
  it('does not execute relative PATH or cwd candidates', () => {
    expect(commandCandidates('cli', { platform: 'linux', env: { PATH: ':.:relative:/bin' } })).toEqual(['/bin/cli'])
    expect(commandCandidates('../cli', { platform: 'linux', env: { PATH: '/bin' } })).toEqual([])
  })
  it('reports denied and non-file candidates separately from a missing command', () => {
    const context = { platform: 'darwin' as const, env: { PATH: '/one:/two' } }
    expect(resolveCommand('cli', context, () => 'permission-denied')).toEqual({ path: null, state: 'permission-denied' })
    expect(resolveCommand('cli', context, () => 'not-file')).toEqual({ path: null, state: 'not-file' })
    expect(resolveCommand('cli', context, file => file.startsWith('/two') ? 'executable' : 'permission-denied')).toEqual({ path: '/two/cli', state: 'executable' })
  })
  it('selects a single shell policy including Finder without SHELL', () => {
    expect(defaultShell('darwin', {})).toBe('/bin/zsh')
    expect(defaultShell('darwin', { SHELL: '/opt/homebrew/bin/fish' })).toBe('/opt/homebrew/bin/fish')
    expect(defaultShell('linux', { SHELL: 'relative' })).toBe('/bin/bash')
    expect(defaultShell('win32', {})).toBe('powershell.exe')
  })
  it('invalidates resolved launches on environment or execution-target changes', () => {
    const env = { PATH: '/bin', TOKEN: 'secret' }
    const revision = environmentRevision('darwin', 'arm64', '/home', env)
    expect(revision).toBe(environmentRevision('darwin', 'arm64', '/home', { TOKEN: 'secret', PATH: '/bin' }))
    expect(revision).not.toContain('secret')
    const identity = { id: 'local', kind: 'local' as const, platform: 'darwin' as const, architecture: 'arm64', home: '/home', revision }
    const launch = { identity, env, program: '/bin/cli', args: [], source: 'fixture' }
    expect(() => assertLocalLaunch(launch, { identity, env, shell: '/bin/zsh' })).not.toThrow()
    const changed = environmentRevision('darwin', 'arm64', '/home', { ...env, PATH: '/new:/bin' })
    expect(() => assertLocalLaunch(launch, { identity: { ...identity, revision: changed }, env, shell: '/bin/zsh' })).toThrow('environment changed')
    expect(() => assertLocalLaunch({ ...launch, identity: { ...identity, kind: 'ssh' } }, { identity, env, shell: '/bin/zsh' })).toThrow('another execution target')
  })
})
