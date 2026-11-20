import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { providerLaunchPaths, resolveProviderPaths, type ProviderPathContext } from '../../src/main/external-cli/provider-paths'
import { scanExternalSessions } from '../../src/main/sessions/external-session-scanner'
import { AgentSessionRegistry } from '../../src/main/sessions/session-registry'
import { withinRuntimePath } from '../../src/shared/runtime/path-identity'
import { canOfferSessionResume } from '../../src/shared/ipc/session'
import { sessionReadFailure } from '../../src/main/sessions/read-issue'
vi.mock('electron', () => ({ app: { getPath: () => '/unused-test-profile' } }))

const directories: string[] = [], registries: AgentSessionRegistry[] = []
afterEach(async () => {
  for (const registry of registries.splice(0)) await registry.flush()
  for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true })
})
async function fixture() { const root = await mkdtemp(join(tmpdir(), 'janusx-provider-')); directories.push(root); return root }
const context: ProviderPathContext = { platform: 'darwin', home: '/Users/用户', cwd: '/Projects/Case', env: {} }

describe('provider effective directory contract', () => {
  it.each(['darwin', 'linux', 'win32'] as const)('uses target-specific defaults on %s', platform => {
    const ctx = { ...context, platform, home: platform === 'win32' ? 'C:\\Users\\test' : '/Users/test' }
    const value = resolveProviderPaths('pi', ctx, () => undefined)
    expect(value.store).toBe(platform === 'win32' ? 'C:\\Users\\test\\.pi\\agent\\sessions' : '/Users/test/.pi/agent/sessions')
    expect(resolveProviderPaths('dsh', ctx).store).toBe(platform === 'win32' ? 'C:\\Users\\test\\.dsh\\sessions' : '/Users/test/.dsh/sessions')
  })
  it('honors Pi argument > environment > project settings > global settings', () => {
    const read = (file: string) => ({ sessionDir: file.startsWith('/Projects/') ? './project-history' : '~/global-history' })
    const project = resolveProviderPaths('pi', context, read)
    expect(project).toMatchObject({ store: '/Projects/Case/project-history', source: 'project-settings' })
    expect(resolveProviderPaths('pi', { ...context, env: { PI_CODING_AGENT_SESSION_DIR: '/env' } }, read)).toMatchObject({ store: '/env', source: 'environment' })
    expect(resolveProviderPaths('pi', { ...context, env: { PI_CODING_AGENT_SESSION_DIR: '/env' }, args: ['--session-dir', '/first', '--session-dir', './last'] }, read)).toMatchObject({ store: '/Projects/Case/last', source: 'argument' })
    expect(resolveProviderPaths('pi', context, file => file.startsWith('/Projects/') ? undefined : { sessionDir: '~/global-history' })).toMatchObject({ store: '/Users/用户/global-history', source: 'global-settings' })
  })
  it('expands custom agent homes and Windows shell paths', () => {
    expect(resolveProviderPaths('pi', { ...context, env: { PI_CODING_AGENT_DIR: '~/custom' } }, () => undefined).store).toBe('/Users/用户/custom/sessions')
    expect(resolveProviderPaths('pi', { ...context, platform: 'win32', env: { PI_CODING_AGENT_SESSION_DIR: '/c/history' } }).store).toBe('C:\\history')
  })
  it('does not reinterpret prompt options after -- and honors no-session', () => {
    expect(resolveProviderPaths('pi', { ...context, args: ['--', '--session-dir', '/prompt'] }, () => undefined).source).toBe('default')
    expect(resolveProviderPaths('pi', { ...context, args: ['--no-session'] }).store).toBeNull()
    expect(resolveProviderPaths('pi', { ...context, args: ['--', '--no-session'] }, () => undefined).store).not.toBeNull()
  })
  it('reports unresolved relative paths and malformed settings without inventing a HOME', () => {
    expect(resolveProviderPaths('pi', { ...context, cwd: undefined, env: { PI_CODING_AGENT_SESSION_DIR: './history' } }).issues[0].reason).toBe('relative-without-cwd')
    expect(resolveProviderPaths('pi', context, () => { throw new SyntaxError('fixture') }).issues).toEqual(expect.arrayContaining([expect.objectContaining({ reason: 'invalid-config' })]))
    expect(sessionReadFailure(Object.assign(new Error('fixture'), { code: 'EACCES' }))).toBe('permission-denied')
  })
  it('shares Claude, Codex and OpenCode overrides and treats memory-only DB as no store', () => {
    const env = { CLAUDE_CONFIG_DIR: '/custom/Claude', CODEX_HOME: '/custom/Codex', XDG_DATA_HOME: '/data', OPENCODE_DB: 'alternate.db' }
    expect(resolveProviderPaths('claude', { ...context, env }).store).toBe('/custom/Claude/projects')
    expect(resolveProviderPaths('codex', { ...context, env }).store).toBe('/custom/Codex/sessions')
    expect(resolveProviderPaths('opencode', { ...context, env }).store).toBe('/data/opencode/alternate.db')
    expect(resolveProviderPaths('opencode', { ...context, env: { OPENCODE_DB: ':memory:' } }).store).toBeNull()
    expect(providerLaunchPaths('claude', { ...context, env: { CLAUDE_CONFIG_DIR: '~/custom' } }).env.CLAUDE_CONFIG_DIR).toBe('/Users/用户/custom')
  })
  it('preserves POSIX roots, case, backslashes and Unicode when filtering project scopes', () => {
    expect(withinRuntimePath('/Repo/child', '/Repo')).toBe(true)
    expect(withinRuntimePath('/repo/child', '/Repo')).toBe(false)
    expect(withinRuntimePath('/RepoExtra', '/Repo')).toBe(false)
    expect(withinRuntimePath('/Repo', '/')).toBe(true)
    expect(withinRuntimePath('c:\\Repo', 'C:/')).toBe(true)
    expect(withinRuntimePath('/repo/a\\b', '/repo/a')).toBe(false)
    expect(withinRuntimePath('/é', '/e\u0301')).toBe(false)
  })
})

describe('effective settings through real scan and persisted records', () => {
  it('launches and discovers the same Pi custom directory, then retains it for a later scan', async () => {
    const root = await fixture(), cwd = join(root, 'project'), home = join(root, 'home')
    await mkdir(join(cwd, '.pi'), { recursive: true })
    await writeFile(join(cwd, '.pi', 'settings.json'), JSON.stringify({ sessionDir: 'History' }))
    const launch = providerLaunchPaths('pi', { platform: process.platform, cwd, home, env: {}, args: ['--', 'prompt'] })
    const store = join(cwd, 'History')
    expect(launch.paths.store).toBe(store)
    expect(launch.args).toEqual(['--session-dir', store, '--', 'prompt'])
    await mkdir(store)
    const transcript = join(store, 'fixture_session.jsonl')
    const raw = [{ type: 'session', id: 'pi-id', cwd }, { type: 'message', message: { role: 'user', content: 'question' } }, { type: 'message', message: { role: 'assistant', content: [{ type: 'text', text: 'answer' }] } }].map(item => JSON.stringify(item)).join('\n')
    await writeFile(transcript, raw)
    const registry = new AgentSessionRegistry(join(root, 'profile')); registries.push(registry)
    const result = await scanExternalSessions(registry, { home, env: {}, cwdRoots: [cwd] })
    expect(result.imported).toBe(1)
    expect(registry.listSessions()[0]).toMatchObject({ providerSessionId: 'pi-id', transcriptPath: transcript })
    await writeFile(join(cwd, '.pi', 'settings.json'), '{}')
    const second = await scanExternalSessions(registry, { home, env: {}, additionalStores: { pi: [store] } })
    expect(second.updated).toBe(1)
    expect(await readFile(transcript, 'utf8')).toBe(raw)
  })
  it('keeps same-ID histories with distinct POSIX paths and exposes the conflict', async () => {
    const registry = new AgentSessionRegistry(await fixture()); registries.push(registry)
    const input = { engine: 'claude', providerSessionId: 'same-id', firstPrompt: 'question', turnCount: 1 }
    const first = registry.importExternalSession({ ...input, cwd: '/Projects/Case', transcriptPath: '/history/Case/same-id.jsonl' })
    const second = registry.importExternalSession({ ...input, cwd: '/Projects/case', transcriptPath: '/history/case/same-id.jsonl' })
    expect(first.id).not.toBe(second.id)
    expect(registry.listSessions({ cwd: '/Projects/Case' }).map(item => item.id)).toEqual([first.id])
    expect(registry.listSessions({ cwd: '/Projects/case' }).map(item => item.id)).toEqual([second.id])
    expect(registry.listSessions().every(item => item.identityConflict)).toBe(true)
    expect(canOfferSessionResume(first)).toBe(false)
    expect(registry.importExternalSession({ ...input, cwd: first.cwd, transcriptPath: first.transcriptPath! }).id).toBe(first.id)
  })
  it('distinguishes absent stores, corrupt JSONL and unsupported records, also on cached scans', async () => {
    const root = await fixture(), store = join(root, 'claude', 'projects')
    await mkdir(store, { recursive: true })
    await writeFile(join(store, 'bad.jsonl'), '{not json}\n')
    await writeFile(join(store, 'unknown.jsonl'), '{"new-provider-format":true}\n')
    const registry = new AgentSessionRegistry(join(root, 'profile')); registries.push(registry)
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await scanExternalSessions(registry, { env: { CLAUDE_CONFIG_DIR: join(root, 'claude') }, home: root })
      expect(result.issues.map(item => item.reason)).toEqual(expect.arrayContaining(['missing', 'corrupt', 'unsupported-schema']))
    }
  })
})
