import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { isExternalWorkspaceRuntime, normalizeWorkspaceRuntime, storedWorkspaceRuntime } from '../../src/shared/workspace-runtime'
import { runtimeIdentityFromProbe } from '../../src/shared/runtime/contracts'
import { runtimePathKey, sameRuntimePath } from '../../src/shared/runtime/path-identity'

// Note: .agents/notes/desktop/platform-runtime-boundaries.md
const state = vi.hoisted(() => ({ root: '' }))
vi.mock('electron', () => ({ app: { getPath: () => state.root } }))
import { projectWorkspace, readWorkspaceRecord, resolveRuntimeResource } from '../../src/main/workspace/runtime'
afterEach(async () => { if (state.root) { await rm(state.root, { recursive: true, force: true }); state.root = '' } })

describe('execution target identity', () => {
  it.each([undefined, null, { kind: 'windows' }, { kind: 'local' }])('reads local compatibility input %j without coupling it to an OS', runtime => {
    expect(normalizeWorkspaceRuntime(runtime)).toEqual({ kind: 'local' })
    expect(isExternalWorkspaceRuntime(runtime)).toBe(false)
    expect(JSON.parse(JSON.stringify({ id: 'stable', runtime: storedWorkspaceRuntime(runtime) }))).toEqual({ id: 'stable' })
  })

  it.each([{ kind: 'wsl', distro: 'Ubuntu', root: '/project' }, { kind: 'ssh', host: 'linux', root: '/project' }])('preserves external target %j and its resource identity', runtime => {
    expect(isExternalWorkspaceRuntime(runtime)).toBe(true)
    expect(normalizeWorkspaceRuntime(runtime)).toBe(runtime)
    expect(storedWorkspaceRuntime(runtime)).toBe(runtime)
    expect(projectWorkspace({ id: 'same', path: '/project', runtime } as any).path).toBe('janusx-workspace://same/project')
  })

  it('refuses unknown connection kinds rather than silently treating them as local', () => {
    expect(() => isExternalWorkspaceRuntime({ kind: 'future' })).toThrow('Unknown workspace')
    expect(() => normalizeWorkspaceRuntime('local')).toThrow('Invalid workspace')
    expect(() => storedWorkspaceRuntime({})).toThrow('Unknown workspace')
  })

  it('normalizes actual old records in memory, keeps bytes unchanged and rejects remote access to them', async () => {
    state.root = await mkdtemp(join(tmpdir(), 'janusx-runtime-identity-'))
    const dir = join(state.root, 'janusx/workspaces')
    await mkdir(dir, { recursive: true })
    const original = JSON.stringify({ id: 'stable', path: '/Users/Me/Project', runtime: { kind: 'windows' } })
    const path = join(dir, 'stable.json')
    await writeFile(path, original)
    const record = await readWorkspaceRecord('stable')
    expect(record).toMatchObject({ id: 'stable', path: '/Users/Me/Project', runtime: { kind: 'local' } })
    expect(projectWorkspace(record)).toEqual(record)
    expect(await readFile(path, 'utf8')).toBe(original)
    await expect(resolveRuntimeResource('janusx-workspace://stable/project')).rejects.toThrow('unavailable')
  })

  it('keeps failed or unknown target probes unknown rather than using the desktop platform', () => {
    const target = { id: 'workspace:ssh', kind: 'ssh' as const, revision: 'connection-2' }
    expect(runtimeIdentityFromProbe(target, null)).toEqual({ ...target, platform: null, architecture: null, home: null })
    expect(runtimeIdentityFromProbe(target, { platform: 'unexpected', architecture: '', home: '' }).platform).toBeNull()
    expect(runtimeIdentityFromProbe(target, { platform: 'linux', architecture: 'aarch64', home: '/home/me' })).toMatchObject({ ...target, platform: 'linux', architecture: 'aarch64', home: '/home/me' })
  })
})

describe('target path identity, independent of the test host OS', () => {
  it('folds Windows drive paths and preserves drive-relative versus absolute roots', () => {
    expect(sameRuntimePath('C:\\Project\\', 'c:/project')).toBe(true)
    expect(runtimePathKey('C:/')).toBe('c:/')
    expect(runtimePathKey('C:', 'windows')).toBe('c:')
    expect(sameRuntimePath('\\\\Server\\Share\\File', '//server/share/file', 'windows')).toBe(true)
  })

  it('preserves POSIX case, backslashes, Unicode spelling and root identity', () => {
    expect(sameRuntimePath('/Users/me/Project', '/Users/me/project')).toBe(false)
    expect(sameRuntimePath('/data/a\\b', '/data/a/b')).toBe(false)
    expect(sameRuntimePath('/data/caf\u00e9', '/data/cafe\u0301')).toBe(false)
    expect(runtimePathKey('/')).toBe('/')
    expect(runtimePathKey('/Users/中文 项目/')).toBe('/Users/中文 项目')
  })

  it('unifies WSL aliases while preserving the Linux tail and resource owner', () => {
    const left = '\\\\wsl.localhost\\Ubuntu\\home\\Me\\Project'
    expect(sameRuntimePath(left, '//wsl$/ubuntu/home/Me/Project')).toBe(true)
    expect(sameRuntimePath(left, '//wsl$/ubuntu/home/Me/project')).toBe(false)
    expect(runtimePathKey(runtimePathKey(left))).toBe(runtimePathKey(left))
    expect(sameRuntimePath('janusx-workspace://one/home/Me', 'janusx-workspace://two/home/Me')).toBe(false)
    expect(sameRuntimePath('janusx-workspace://one/home/Me', 'janusx-workspace://one/home/me')).toBe(false)
  })
})
