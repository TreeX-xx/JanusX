import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { DatabaseSync } from 'node:sqlite'

const testContext = vi.hoisted(() => ({ homeDir: '' }))

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>()
  return {
    ...actual,
    default: { ...actual.default, homedir: () => testContext.homeDir },
  }
})

const { getRuntimeTelemetrySnapshot } = await import('../../src/main/runtime-telemetry/history')

async function writeCodexRollout(sessionId: string, lines: string[]) {
  const sessionDir = join(testContext.homeDir, '.codex', 'sessions', '2026', '07', '30')
  await mkdir(sessionDir, { recursive: true })
  await writeFile(join(sessionDir, `rollout-2026-07-30T10-00-00-${sessionId}.jsonl`), lines.join('\n'))
}

describe('runtime telemetry history', () => {
  beforeEach(async () => {
    vi.stubEnv('CODEX_HOME', '')
    testContext.homeDir = await mkdtemp(join(tmpdir(), 'janusx-telemetry-'))
  })

  afterEach(async () => {
    vi.unstubAllEnvs()
    await rm(testContext.homeDir, { recursive: true, force: true })
  })

  it('separates Claude current context from cumulative session usage', async () => {
    const projectDir = join(testContext.homeDir, '.claude', 'projects', 'C--repo')
    await mkdir(projectDir, { recursive: true })
    await writeFile(join(projectDir, 'session-1.jsonl'), [
      JSON.stringify({
        timestamp: '2026-07-30T10:00:00Z',
        sessionId: 'session-1',
        message: {
          model: 'claude-sonnet-4-6',
          usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 300 },
        },
      }),
      JSON.stringify({
        timestamp: '2026-07-30T10:01:00Z',
        sessionId: 'session-1',
        message: {
          model: 'claude-sonnet-4-6',
          usage: { input_tokens: 150, output_tokens: 30, cache_read_input_tokens: 500 },
        },
      }),
    ].join('\n'))

    const snapshot = await getRuntimeTelemetrySnapshot({
      preset: 'claude',
      cwd: 'C:/repo',
      sessionId: 'session-1',
    })

    expect(snapshot).toMatchObject({
      sessionId: 'session-1',
      contextTokens: 650,
      inputTokens: 250,
      outputTokens: 50,
      cacheReadTokens: 800,
      totalTokens: 1_100,
      source: 'history',
      confidence: 'derived',
    })
  })

  it('combines Codex head metadata with tail usage in a long session', async () => {
    const sessionId = '12345678-1234-1234-1234-123456789abc'
    const filler = `${JSON.stringify({ timestamp: '2026-07-30T10:00:01Z', type: 'event_msg', payload: { type: 'agent_message', message: 'x'.repeat(512) } })}\n`.repeat(600)
    await writeCodexRollout(sessionId, [
      JSON.stringify({
        timestamp: '2026-07-30T10:00:00Z',
        type: 'session_meta',
        payload: { id: sessionId, cwd: 'C:/repo' },
      }),
      filler,
      JSON.stringify({
        timestamp: '2026-07-30T10:02:00Z',
        type: 'turn_context',
        payload: { model: 'gpt-5.5', cwd: 'C:/repo' },
      }),
      JSON.stringify({
        timestamp: '2026-07-30T10:02:01Z',
        type: 'event_msg',
        payload: {
          type: 'token_count',
          info: {
            last_token_usage: { total_tokens: 8_000, input_tokens: 7_000, cached_input_tokens: 3_500 },
            total_token_usage: {
              total_tokens: 12_000,
              input_tokens: 10_000,
              cached_input_tokens: 2_000,
              output_tokens: 2_000,
            },
            model_context_window: 200_000,
          },
        },
      }),
    ])

    const snapshot = await getRuntimeTelemetrySnapshot({
      preset: 'codex',
      cwd: 'C:/repo',
      sessionId,
    })

    expect(snapshot).toMatchObject({
      sessionId,
      detectedModel: 'gpt-5.5',
      contextTokens: 8_000,
      contextWindowTokens: 200_000,
      inputTokens: 8_000,
      outputTokens: 2_000,
      cacheReadTokens: 2_000,
      totalTokens: 12_000,
      source: 'history',
      confidence: 'authoritative',
    })
  })

  it('reads Codex cumulative cache usage regardless of the latest request cache fields', async () => {
    const sessionId = '12345678-1234-1234-1234-123456789abc'
    for (const lastUsage of [{ input_tokens: 100, cached_input_tokens: 0 }, { input_tokens: 100 }]) {
      await writeCodexRollout(sessionId, [
        JSON.stringify({ type: 'session_meta', payload: { id: sessionId, cwd: 'C:/repo' } }),
        JSON.stringify({ type: 'event_msg', payload: { type: 'token_count', info: {
          last_token_usage: lastUsage,
          total_token_usage: { input_tokens: 1000, cached_input_tokens: 800, output_tokens: 200, total_tokens: 1200 },
        } } }),
      ])
      const snapshot = await getRuntimeTelemetrySnapshot({ preset: 'codex', cwd: 'C:/repo', sessionId })
      // 展示口径只用累计分量，最近一次请求的缓存字段形态不再影响任何读数。
      expect(snapshot).toMatchObject({ inputTokens: 200, cacheReadTokens: 800, outputTokens: 200, totalTokens: 1200 })
    }
  })

  it('splits Codex cache writes from inclusive input without changing totals or hit rate', async () => {
    const sessionId = '12345678-1234-1234-1234-123456789abc'
    for (const written of [400, 0, undefined]) {
      await writeCodexRollout(sessionId, [
        JSON.stringify({ type: 'session_meta', payload: { id: sessionId, cwd: 'C:/repo' } }),
        JSON.stringify({ type: 'event_msg', payload: { type: 'token_count', info: {
          last_token_usage: { input_tokens: 100, cached_input_tokens: 60, cache_write_input_tokens: written === undefined ? undefined : 30, total_tokens: 120 },
          total_token_usage: { input_tokens: 1000, cached_input_tokens: 500, cache_write_input_tokens: written, output_tokens: 200, total_tokens: 1200 },
        } } }),
      ])
      const snapshot = await getRuntimeTelemetrySnapshot({ preset: 'codex', cwd: 'C:/repo', sessionId })
      expect(snapshot).toMatchObject({ inputTokens: 500 - (written ?? 0), cacheReadTokens: 500, totalTokens: 1200, contextTokens: 120 })
      expect(snapshot?.cacheWriteTokens).toBe(written)
      expect(snapshot?.usageObservation?.counters?.cacheWriteTokens).toBe(written)
      expect(snapshot?.usageObservation?.issue).toBeUndefined()
    }
  })

  it('reads Claude positive writes and distinguishes missing write fields from explicit zero', async () => {
    const projectDir = join(testContext.homeDir, '.claude', 'projects', 'C--repo')
    await mkdir(projectDir, { recursive: true })
    for (const written of [400, 0, undefined]) {
      await writeFile(join(projectDir, 'session-write.jsonl'), JSON.stringify({
        sessionId: 'session-write', timestamp: '2026-07-30T10:00:00Z',
        message: { id: 'response-write', role: 'assistant', stop_reason: 'end_turn', usage: {
          input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 300, cache_creation_input_tokens: written,
        } },
      }))
      const snapshot = await getRuntimeTelemetrySnapshot({ preset: 'claude', cwd: 'C:/repo', sessionId: 'session-write' })
      expect(snapshot?.cacheWriteTokens).toBe(written)
      expect(snapshot?.totalTokens).toBe(420 + (written ?? 0))
      expect(snapshot?.usageObservation?.events?.[0].cacheWriteTokens).toBe(written)
    }
  })

  it('reads Codex startup capacity and exact compactions only for a bound session', async () => {
    const sessionId = '12345678-1234-1234-1234-123456789abc'
    await writeCodexRollout(sessionId, [
      JSON.stringify({ timestamp: '2026-07-30T10:00:00Z', type: 'session_meta', payload: { id: sessionId, cwd: 'C:/repo' } }),
      JSON.stringify({ timestamp: '2026-07-30T10:00:01Z', type: 'event_msg', payload: { type: 'task_started', model_context_window: 258_400 } }),
      JSON.stringify({ timestamp: '2026-07-30T10:00:02Z', type: 'event_msg', payload: { type: 'context_compacted' } }),
      JSON.stringify({ timestamp: '2026-07-30T10:00:03Z', type: 'event_msg', payload: { type: 'context_compacted' } }),
    ])

    const snapshot = await getRuntimeTelemetrySnapshot({ preset: 'codex', cwd: 'C:/repo', sessionId })

    expect(snapshot).toMatchObject({
      sessionId,
      contextWindowTokens: 258_400,
      compactionCount: 2,
      compactionCountConfidence: 'exact',
    })
  })

  it('does not accept a filename match whose Codex session metadata belongs to another terminal', async () => {
    const requestedSessionId = '12345678-1234-1234-1234-123456789abc'
    const actualSessionId = '12345678-1234-1234-1234-123456789abd'
    await writeCodexRollout(requestedSessionId, [
      JSON.stringify({ timestamp: '2026-07-30T10:00:00Z', type: 'session_meta', payload: { id: actualSessionId, cwd: 'C:/repo' } }),
      JSON.stringify({ timestamp: '2026-07-30T10:00:01Z', type: 'event_msg', payload: { type: 'token_count', info: { last_token_usage: { total_tokens: 50 } } } }),
    ])

    const snapshot = await getRuntimeTelemetrySnapshot({ preset: 'codex', cwd: 'C:/repo', sessionId: requestedSessionId })

    expect(snapshot).toBeNull()
  })

  it('reads declared Codex capacity without claiming an unrelated active session', async () => {
    const codexDir = join(testContext.homeDir, '.codex')
    await mkdir(codexDir, { recursive: true })
    await writeFile(join(codexDir, 'config.toml'), 'model = "gpt-5.6-sol"\nmodel_context_window = 258400\n')

    const snapshot = await getRuntimeTelemetrySnapshot({ preset: 'codex', cwd: 'C:/repo' })

    expect(snapshot).toMatchObject({
      detectedModel: 'gpt-5.6-sol',
      contextWindowTokens: 258_400,
      source: 'configuration',
      confidence: 'declared',
    })
    expect(snapshot?.sessionId).toBeUndefined()
  })

  it('reads Codex configuration, bound usage and ledger namespace from the selected home', async () => {
    const sessionId = 'custom-home-session'
    const codexHome = join(testContext.homeDir, 'custom-codex')
    await mkdir(join(codexHome, 'sessions'), { recursive: true })
    await writeFile(join(codexHome, 'config.toml'), 'model = "gpt-6.1-sol"\nmodel_context_window = 1000000\n')
    await writeFile(join(codexHome, 'sessions', `rollout-${sessionId}.jsonl`), [
      JSON.stringify({ type: 'session_meta', payload: { id: sessionId, cwd: 'C:/repo' } }),
      JSON.stringify({ type: 'turn_context', payload: { model: 'gpt-6.1-sol', cwd: 'C:/repo' } }),
      JSON.stringify({ type: 'event_msg', payload: { type: 'token_count', info: {
        last_token_usage: { total_tokens: 0, input_tokens: 0, cached_input_tokens: 0 },
        total_token_usage: { total_tokens: 120, input_tokens: 100, cached_input_tokens: 50, output_tokens: 20 },
        model_context_window: 828400,
      } } }),
    ].join('\n'))

    for (const explicit of [false, true]) {
      vi.stubEnv('CODEX_HOME', explicit ? join(testContext.homeDir, 'wrong-home') : codexHome)
      const selected = explicit ? { codexHome } : {}
      const bootstrap = await getRuntimeTelemetrySnapshot({ preset: 'codex', cwd: 'C:/repo', ...selected })
      expect(bootstrap).toMatchObject({ detectedModel: 'gpt-6.1-sol', contextWindowTokens: 1000000, source: 'configuration' })
      const snapshot = await getRuntimeTelemetrySnapshot({ preset: 'codex', cwd: 'C:/repo', sessionId, ...selected })
      expect(snapshot).toMatchObject({ sessionId, contextTokens: 0, contextWindowTokens: 828400, totalTokens: 120, usageObservation: { namespace: codexHome } })
    }
  })

  it('reads the declared Claude model before the first conversation', async () => {
    const claudeDir = join(testContext.homeDir, '.claude')
    await mkdir(claudeDir, { recursive: true })
    await writeFile(join(claudeDir, 'settings.json'), JSON.stringify({
      model: 'opus[1m]',
      env: { ANTHROPIC_AUTH_TOKEN: 'must-not-be-returned' },
    }))

    const snapshot = await getRuntimeTelemetrySnapshot({ preset: 'claude', cwd: 'C:/repo' })

    expect(snapshot).toEqual(expect.objectContaining({
      detectedModel: 'opus[1m]',
      contextWindowTokens: 1_000_000,
      source: 'configuration',
      confidence: 'declared',
    }))
    expect(JSON.stringify(snapshot)).not.toContain('must-not-be-returned')
  })

  it('reads a proxy-managed ANTHROPIC_DEFAULT_SONNET_MODEL for the Claude bootstrap', async () => {
    const claudeDir = join(testContext.homeDir, '.claude')
    await mkdir(claudeDir, { recursive: true })
    await writeFile(join(claudeDir, 'settings.json'), JSON.stringify({
      env: {
        ANTHROPIC_AUTH_TOKEN: 'must-not-be-returned',
        ANTHROPIC_BASE_URL: 'http://127.0.0.1:15721',
        ANTHROPIC_DEFAULT_SONNET_MODEL: 'claude-sonnet-5',
      },
    }))

    const snapshot = await getRuntimeTelemetrySnapshot({ preset: 'claude', cwd: 'C:/repo' })

    expect(snapshot).toEqual(expect.objectContaining({
      detectedModel: 'claude-sonnet-5',
      contextWindowTokens: 200_000,
      source: 'configuration',
      confidence: 'declared',
    }))
    expect(JSON.stringify(snapshot)).not.toContain('must-not-be-returned')
  })

  it('reads a uniquely configured OpenCode model before the first conversation', async () => {
    const configDir = join(testContext.homeDir, '.config', 'opencode')
    await mkdir(configDir, { recursive: true })
    await writeFile(join(configDir, 'opencode.json'), JSON.stringify({
      provider: { custom: { models: { 'glm-5.2': { name: 'GLM 5.2' } } } },
    }))

    const snapshot = await getRuntimeTelemetrySnapshot({ preset: 'opencode', cwd: 'C:/repo' })

    expect(snapshot).toEqual(expect.objectContaining({
      detectedModel: 'custom/glm-5.2',
      source: 'configuration',
      confidence: 'declared',
    }))
  })

  it('reads current context and cumulative usage for an exact OpenCode session', async () => {
    const dataDir = join(testContext.homeDir, '.local', 'share', 'opencode')
    await mkdir(dataDir, { recursive: true })
    const database = new DatabaseSync(join(dataDir, 'opencode.db'))
    database.exec(`
      CREATE TABLE session (
        id TEXT PRIMARY KEY, directory TEXT, model TEXT, tokens_input INTEGER, tokens_output INTEGER,
        tokens_cache_read INTEGER, tokens_cache_write INTEGER, time_updated INTEGER
      );
      CREATE TABLE message (session_id TEXT, time_updated INTEGER, data TEXT);
    `)
    database.prepare('INSERT INTO session VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
      'session-1', 'C:/repo', JSON.stringify({ id: 'glm-5.2', providerID: 'custom' }),
      1_200, 300, 400, 50, 2_000,
    )
    database.prepare('INSERT INTO message VALUES (?, ?, ?)').run(
      'session-1', 2_000, JSON.stringify({
        role: 'assistant', modelID: 'glm-5.2',
        tokens: { input: 700, output: 100, cache: { read: 200, write: 25 } },
      }),
    )
    database.close()

    const snapshot = await getRuntimeTelemetrySnapshot({
      preset: 'opencode', cwd: 'C:/repo', sessionId: 'session-1',
    })

    expect(snapshot).toMatchObject({
      sessionId: 'session-1',
      detectedModel: 'glm-5.2',
      contextTokens: 925,
      inputTokens: 1_200,
      outputTokens: 300,
      cacheReadTokens: 400,
      cacheWriteTokens: 50,
      totalTokens: 1_950,
      source: 'history',
      confidence: 'authoritative',
    })
  })

  it('matches an OpenCode session when the provider spells the directory with forward slashes', async () => {
    const dataDir = join(testContext.homeDir, '.local', 'share', 'opencode')
    await mkdir(dataDir, { recursive: true })
    const database = new DatabaseSync(join(dataDir, 'opencode.db'))
    database.exec(`
      CREATE TABLE session (
        id TEXT PRIMARY KEY, directory TEXT, model TEXT, tokens_input INTEGER, tokens_output INTEGER,
        tokens_cache_read INTEGER, tokens_cache_write INTEGER, time_updated INTEGER
      );
      CREATE TABLE message (session_id TEXT, time_updated INTEGER, data TEXT);
    `)
    database.prepare('INSERT INTO session VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
      'session-win', 'C:/repo/sub', JSON.stringify({ id: 'glm-5.2', providerID: 'custom' }),
      100, 20, 30, 5, 2_000,
    )
    database.prepare('INSERT INTO message VALUES (?, ?, ?)').run(
      'session-win', 2_000, JSON.stringify({
        role: 'assistant', modelID: 'glm-5.2',
        tokens: { input: 60, output: 10, cache: { read: 20, write: 5 } },
      }),
    )
    database.close()

    const snapshot = await getRuntimeTelemetrySnapshot({
      preset: 'opencode', cwd: 'C:\\repo\\sub\\', sessionId: 'session-win',
    })

    expect(snapshot).toMatchObject({
      sessionId: 'session-win',
      detectedModel: 'glm-5.2',
      contextTokens: 85,
      source: 'history',
      confidence: 'authoritative',
    })
  })

  it('reads the declared janus model without claiming an unrelated active session', async () => {
    const janusDir = join(testContext.homeDir, '.janus')
    await mkdir(janusDir, { recursive: true })
    await writeFile(join(janusDir, 'config.json'), JSON.stringify({
      version: 1,
      providers: [{ id: 'deepseek', models: ['deepseek-chat'] }],
      defaultProvider: 'deepseek',
      defaultModel: 'deepseek-chat',
    }))

    const snapshot = await getRuntimeTelemetrySnapshot({ preset: 'janus', cwd: 'C:/repo' })

    expect(snapshot).toMatchObject({
      detectedModel: 'deepseek-chat',
      source: 'configuration',
      confidence: 'declared',
    })
    expect(snapshot?.sessionId).toBeUndefined()
  })

  it('binds a janus conversation file only on an exact id match', async () => {
    const janusDir = join(testContext.homeDir, '.janus', 'history')
    await mkdir(janusDir, { recursive: true })
    await writeFile(join(testContext.homeDir, '.janus', 'config.json'), JSON.stringify({
      version: 1,
      providers: [{ id: 'deepseek', models: ['deepseek-chat'] }],
      defaultModel: 'deepseek-chat',
    }))
    await writeFile(join(janusDir, 'conv-1.jsonl'), JSON.stringify({
      id: 'conv-1', title: 'demo', createdAt: 1_000, updatedAt: 2_000,
      messages: [{ role: 'user', content: 'hi' }], toolTraces: [], todos: [],
    }))

    const snapshot = await getRuntimeTelemetrySnapshot({ preset: 'janus', cwd: 'C:/repo', sessionId: 'conv-1' })
    expect(snapshot).toMatchObject({ sessionId: 'conv-1', detectedModel: 'deepseek-chat', source: 'history' })

    const mismatch = await getRuntimeTelemetrySnapshot({ preset: 'janus', cwd: 'C:/repo', sessionId: 'conv-9' })
    expect(mismatch).toBeNull()
  })

  it('merges pi project settings over global settings for the declared model', async () => {
    await mkdir(join(testContext.homeDir, '.pi', 'agent'), { recursive: true })
    await writeFile(join(testContext.homeDir, '.pi', 'agent', 'settings.json'), JSON.stringify({
      defaultProvider: 'anthropic', defaultModel: 'claude-sonnet-4-5',
    }))

    const globalOnly = await getRuntimeTelemetrySnapshot({ preset: 'pi', cwd: 'C:/repo' })
    expect(globalOnly).toMatchObject({
      detectedModel: 'anthropic/claude-sonnet-4-5',
      source: 'configuration',
      confidence: 'declared',
    })

    const projectDir = join(testContext.homeDir, 'proj')
    await mkdir(join(projectDir, '.pi'), { recursive: true })
    await writeFile(join(projectDir, '.pi', 'settings.json'), JSON.stringify({ defaultModel: 'gpt-4o' }))

    const overridden = await getRuntimeTelemetrySnapshot({ preset: 'pi', cwd: projectDir })
    expect(overridden).toMatchObject({ detectedModel: 'anthropic/gpt-4o' })
  })

  it('sums pi usage along the active leaf path and ignores abandoned branches', async () => {
    const sessionRoot = join(testContext.homeDir, '.pi', 'agent', 'sessions', '---C--repo--')
    await mkdir(sessionRoot, { recursive: true })
    const sessionId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    const assistant = (usage: object, model = 'claude-sonnet-4-5') => ({
      role: 'assistant', content: [{ type: 'text', text: 'hi' }],
      api: 'anthropic-messages', provider: 'anthropic', model,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, ...usage },
      stopReason: 'stop', timestamp: 1_000,
    })
    await writeFile(join(sessionRoot, `2026-01-01_${sessionId}.jsonl`), [
      JSON.stringify({ type: 'session', version: 3, id: sessionId, timestamp: '2026-01-01T00:00:00.000Z', cwd: 'C:/repo' }),
      JSON.stringify({ type: 'message', id: 'u1', parentId: null, timestamp: '2026-01-01T00:00:01.000Z', message: { role: 'user', content: 'a', timestamp: 1_000 } }),
      JSON.stringify({ type: 'message', id: 'a1', parentId: 'u1', timestamp: '2026-01-01T00:00:02.000Z', message: assistant({ input: 1_000, output: 200, totalTokens: 1_200 }) }),
      // Abandoned branch: must not count (leaf path goes through u2 instead).
      JSON.stringify({ type: 'message', id: 'u9', parentId: 'a1', timestamp: '2026-01-01T00:00:03.000Z', message: { role: 'user', content: 'abandoned', timestamp: 1_000 } }),
      JSON.stringify({ type: 'message', id: 'a9', parentId: 'u9', timestamp: '2026-01-01T00:00:04.000Z', message: assistant({ input: 99_000, output: 99_000, totalTokens: 198_000 }) }),
      JSON.stringify({ type: 'model_change', id: 'm1', parentId: 'a1', timestamp: '2026-01-01T00:00:05.000Z', provider: 'openai', modelId: 'gpt-4o' }),
      JSON.stringify({ type: 'compaction', id: 'c1', parentId: 'm1', timestamp: '2026-01-01T00:00:06.000Z', summary: 'old work', firstKeptEntryId: 'u2', tokensBefore: 50_000 }),
      JSON.stringify({ type: 'message', id: 'u2', parentId: 'c1', timestamp: '2026-01-01T00:00:07.000Z', message: { role: 'user', content: 'b', timestamp: 1_000 } }),
      JSON.stringify({ type: 'message', id: 'a2', parentId: 'u2', timestamp: '2026-01-01T00:00:08.000Z', message: assistant({ input: 500, output: 100, cacheRead: 60, cacheWrite: 7, totalTokens: 667 }, 'gpt-4o') }),
    ].join('\n'))

    const snapshot = await getRuntimeTelemetrySnapshot({ preset: 'pi', cwd: 'C:/repo', sessionId })

    expect(snapshot).toMatchObject({
      sessionId,
      detectedModel: 'gpt-4o',
      inputTokens: 1_500,
      outputTokens: 300,
      cacheReadTokens: 60,
      cacheWriteTokens: 7,
      totalTokens: 1_867,
      contextTokens: 567,
      compactionCount: 1,
      compactionCountConfidence: 'exact',
      source: 'history',
      confidence: 'estimated',
    })
  })

  it('rejects a pi session whose header belongs to another workspace', async () => {    const sessionRoot = join(testContext.homeDir, '.pi', 'agent', 'sessions', '---C--other--')
    await mkdir(sessionRoot, { recursive: true })
    const sessionId = 'ffffffff-1111-2222-3333-444444444444'
    await writeFile(join(sessionRoot, `2026-01-01_${sessionId}.jsonl`), [
      JSON.stringify({ type: 'session', version: 3, id: sessionId, timestamp: '2026-01-01T00:00:00.000Z', cwd: 'C:/other' }),
      JSON.stringify({ type: 'message', id: 'a1', parentId: null, timestamp: '2026-01-01T00:00:01.000Z', message: { role: 'assistant', content: [], api: 'x', provider: 'x', model: 'm', usage: { input: 10, output: 5, totalTokens: 15 }, stopReason: 'stop', timestamp: 1_000 } }),
    ].join('\n'))

    const snapshot = await getRuntimeTelemetrySnapshot({ preset: 'pi', cwd: 'C:/repo', sessionId })
    expect(snapshot).toBeNull()
  })

  it('reads the declared dsh model from model recents before the composed default', async () => {
    const tuiDir = join(testContext.homeDir, '.dsh-tui')
    await mkdir(tuiDir, { recursive: true })
    await writeFile(join(tuiDir, 'model-recents.json'), JSON.stringify(['deepseek-v4', 'deepseek-flash']))

    const snapshot = await getRuntimeTelemetrySnapshot({ preset: 'dsh', cwd: 'C:/repo' })

    expect(snapshot).toMatchObject({
      detectedModel: 'deepseek-v4',
      contextWindowTokens: 128_000,
      source: 'configuration',
      confidence: 'declared',
    })
    expect(snapshot?.sessionId).toBeUndefined()
  })

  it('falls back to the composed dsh default model without recents', async () => {
    const snapshot = await getRuntimeTelemetrySnapshot({ preset: 'dsh', cwd: 'C:/repo' })

    expect(snapshot).toMatchObject({
      detectedModel: 'deepseek-flash',
      contextWindowTokens: 128_000,
      source: 'configuration',
      confidence: 'declared',
    })
  })

  it('binds a dsh session dir only inside the exact workspace and on id match', async () => {
    const sessionId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    const workspaceDir = join(testContext.homeDir, '.dsh', 'sessions', '--C-repo--')
    await mkdir(join(workspaceDir, sessionId), { recursive: true })
    await writeFile(join(workspaceDir, sessionId, 'session.v4.jsonl.zstd'), 'opaque-bytes')
    const otherDir = join(testContext.homeDir, '.dsh', 'sessions', '--C-other--')
    await mkdir(join(otherDir, sessionId), { recursive: true })

    const snapshot = await getRuntimeTelemetrySnapshot({ preset: 'dsh', cwd: 'C:/repo', sessionId: sessionId.slice(0, 8) })

    expect(snapshot).toMatchObject({
      sessionId,
      source: 'history',
      confidence: 'derived',
    })
    expect(snapshot?.filePath).toContain(sessionId)

    const mismatch = await getRuntimeTelemetrySnapshot({ preset: 'dsh', cwd: 'C:/repo', sessionId: 'zzzzzzzz' })
    expect(mismatch).toBeNull()

    const stale = await getRuntimeTelemetrySnapshot({ preset: 'dsh', cwd: 'C:/repo', sessionId, startedAt: Date.now() + 1_000_000 })
    expect(stale).toBeNull()
  })
})
