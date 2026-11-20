import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { zstdCompressSync } from 'node:zlib'
import { resolveHistorySources } from '../../src/main/sessions/history-sources'
import { scanExternalSessions } from '../../src/main/sessions/external-session-scanner'
import { AgentSessionRegistry } from '../../src/main/sessions/session-registry'
import { scanNativeSessionCorpus } from '../../src/main/runtime-telemetry/corpus-scan'
import { UsageLedger } from '../../src/main/runtime-telemetry/usage-ledger'
import { inspectHistorySource, readHistorySourceSettings, saveHistorySources } from '../../src/main/sessions/history-source-service'

const host = vi.hoisted(() => ({ home: '/unused-test-data' }))
vi.mock('electron', () => ({ app: { getPath: () => host.home } }))
vi.mock('node:os', async original => {
  const actual = await original<typeof import('node:os')>()
  return { ...actual, homedir: () => host.home, default: { ...actual, homedir: () => host.home } }
})
vi.mock('../../src/main/workspace/runtime', () => ({ registeredWorkspaces: async () => [] }))
vi.mock('../../src/main/external-cli/managed-paths', () => ({ managedCliEnv: () => ({}) }))
const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })

describe('shared history locations', () => {
  it('recognizes a custom compressed DSH history source as read-only', async () => {
    const root = await mkdtemp(join(tmpdir(), 'janusx-dsh-source-')); roots.push(root); host.home = root
    const path = join(root, 'saved-sessions')
    const dir = join(path, 'work', 'session-a')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'session.v4.jsonl.zstd'), zstdCompressSync(JSON.stringify({ type: 'session', version: 4, id: 'a' }) + '\n'))
    const saved = await saveHistorySources({ disabledAutomatic: ['dsh'], locations: [{ engine: 'dsh', path, enabled: true }] })
    expect(saved.sources.find(source => source.path === path)).toMatchObject({ status: 'ready', resume: 'read-only', automatic: false })
  })
  it('persists a validated Pi source and rejects invalid replacement without losing the previous settings', async () => {
    const root = await mkdtemp(join(tmpdir(), 'janusx-source-settings-')); roots.push(root); host.home = root
    const history = join(root, 'pi-history')
    await mkdir(history)
    await writeFile(join(history, 'session.jsonl'), JSON.stringify({ type: 'session', id: 'pi-id', cwd: root }) + '\n')
    const saved = await saveHistorySources({ disabledAutomatic: ['pi'], locations: [{ engine: 'pi', path: history, enabled: true }] })
    expect(saved.sources.find(source => source.path === history)).toMatchObject({ status: 'ready', automatic: false })
    await expect(saveHistorySources({ disabledAutomatic: [], locations: [{ engine: 'pi', path: join(root, 'missing'), enabled: true }] })).rejects.toThrow('No readable pi history')
    expect(await readHistorySourceSettings()).toEqual(saved.settings)
    await saveHistorySources({ disabledAutomatic: [], locations: [] })
    expect(await readHistorySourceSettings()).toEqual({ disabledAutomatic: [], locations: [] })
  })
  it('resolves Mac overrides and archives with POSIX semantics and retains case', () => {
    const sources = resolveHistorySources({ disabledAutomatic: ['pi'], locations: [{ engine: 'pi', path: '/Users/用户/History', enabled: true }] },
      { platform: 'darwin', home: '/Users/用户', env: { CLAUDE_CONFIG_DIR: '/Custom/Claude', CODEX_HOME: '/Custom/Codex', PI_CODING_AGENT_SESSION_DIR: '/Custom/Pi' } })
    expect(sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ engine: 'claude', path: '/Custom/Claude/projects', namespace: '/Custom/Claude' }),
      expect.objectContaining({ engine: 'codex', path: '/Custom/Codex/archived_sessions' }),
      expect.objectContaining({ engine: 'pi', path: '/Custom/Pi', enabled: false }),
      expect.objectContaining({ engine: 'pi', path: '/Users/用户/History', enabled: true }),
    ]))
  })

  it('deduplicates Windows aliases and allows an explicit source to disable an automatic path', () => {
    const sources = resolveHistorySources({ disabledAutomatic: [], locations: [{ engine: 'claude', path: 'c:\\users\\owner\\.claude\\projects', enabled: false }] },
      { platform: 'win32', home: 'C:\\Users\\Owner', env: {} })
    expect(sources.filter(source => source.engine === 'claude')).toHaveLength(1)
    expect(sources.find(source => source.engine === 'claude')?.enabled).toBe(false)
  })

  it('discovers and accounts the same custom history, excludes disabled stores, and validates before accepting', async () => {
    const root = await mkdtemp(join(tmpdir(), 'janusx-history-sources-')); roots.push(root)
    const custom = join(root, 'custom', 'projects')
    const project = join(custom, 'project')
    await mkdir(project, { recursive: true })
    const history = [
      { type: 'user', sessionId: 'session-custom', cwd: root, timestamp: '2026-11-15T01:00:00Z', message: { role: 'user', content: 'hello' } },
      { type: 'assistant', sessionId: 'session-custom', cwd: root, timestamp: '2026-11-15T01:00:01Z', message: { id: 'response-custom', role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text: 'answer' }], usage: { input_tokens: 12, output_tokens: 3 } } },
    ].map(row => JSON.stringify(row)).join('\n') + '\n'
    await writeFile(join(project, 'session-custom.jsonl'), history)
    const sources = resolveHistorySources({ disabledAutomatic: ['claude', 'codex', 'pi', 'opencode'], locations: [{ engine: 'claude', path: custom, enabled: true }] },
      { platform: process.platform, home: root, env: {} })
    const source = sources.find(item => !item.automatic)!
    expect(await inspectHistorySource(source)).toMatchObject({ status: 'ready', resume: 'native-layout' })
    expect(await inspectHistorySource({ ...source, path: join(root, 'missing') })).toMatchObject({ status: 'missing' })
    const registry = new AgentSessionRegistry(join(root, 'registry'))
    const ledger = new UsageLedger(() => join(root, 'usage.sqlite'))
    try {
      await registry.load()
      await scanExternalSessions(registry, { home: root, env: {}, sources })
      await scanNativeSessionCorpus({ ledger, sources })
      expect(registry.listSessions()).toHaveLength(1)
      expect(ledger.list({ start: Date.parse('2026-11-15'), end: Date.parse('2026-11-16') }).records.reduce((sum, row) => sum + row.totalTokens, 0)).toBe(15)
      const disabled = sources.map(item => ({ ...item, enabled: false }))
      expect(await scanNativeSessionCorpus({ ledger, sources: disabled })).toMatchObject({ scanned: 0 })
      expect(await scanExternalSessions(registry, { home: root, env: {}, sources: disabled })).toMatchObject({ scanned: 0 })
      expect(registry.listSessions()).toHaveLength(1)
    } finally { ledger.close(); await registry.flush() }
  })
})
