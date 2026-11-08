import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { appendFile, mkdir, mkdtemp, rm, utimes, writeFile } from 'fs/promises'
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

const { findCorrelatedSession } = await import('../../src/main/runtime-telemetry/session-attribution')

const CWD = 'C:/repo'
const STARTED_AT = Date.parse('2026-10-14T06:00:00Z')
/** pty activity and file writes both land inside this window. */
const ACTIVITY_AT = Date.parse('2026-10-14T06:05:00Z')

async function touch(path: string, at: number) {
  await utimes(path, new Date(at), new Date(at))
}

async function writeClaudeSession(name: string, sessionId: string, at: number) {
  const dir = join(testContext.homeDir, '.claude', 'projects', 'C--repo')
  await mkdir(dir, { recursive: true })
  const file = join(dir, name)
  await writeFile(file, [
    JSON.stringify({ timestamp: '2026-10-14T06:04:00Z', sessionId, message: { id: 'r1', role: 'assistant', stop_reason: 'end_turn', model: 'claude-sonnet-4-6', usage: { input_tokens: 10, output_tokens: 2, cache_read_input_tokens: 0 } } }),
  ].join('\n'))
  await touch(file, at)
  return file
}

async function writeCodexSession(sessionId: string, cwd: string, at: number, options: { archived?: boolean } = {}) {
  const dir = join(testContext.homeDir, '.codex', options.archived ? 'archived_sessions' : 'sessions', '2026', '10', '14')
  await mkdir(dir, { recursive: true })
  const file = join(dir, `rollout-2026-10-14T06-00-00-${sessionId}.jsonl`)
  await writeFile(file, [
    JSON.stringify({ timestamp: '2026-10-14T06:00:00Z', ordinal: 0, type: 'session_meta', payload: { id: sessionId, cwd } }),
    JSON.stringify({ timestamp: new Date(at).toISOString(), ordinal: 1, type: 'turn_context', payload: { model: 'gpt-6-astra', cwd } }),
  ].join('\n'))
  await touch(file, at)
  return file
}

async function writePiSession(sessionId: string, cwd: string, at: string) {
  const dir = join(testContext.homeDir, '.pi', 'agent', 'sessions')
  await mkdir(dir, { recursive: true })
  const file = join(dir, `${sessionId}.jsonl`)
  await writeFile(file, JSON.stringify({ type: 'session', id: sessionId, cwd, timestamp: '2026-10-14T06:00:00Z' }))
  await touch(file, Date.parse(at))
  return file
}

describe('session attribution', () => {
  it('excludes already owned Codex sessions before resolving same-directory ambiguity', async () => {
    await writeCodexSession('first', CWD, ACTIVITY_AT)
    await writeCodexSession('second', CWD, ACTIVITY_AT)
    const query = { engine: 'codex' as const, cwd: CWD, terminalStartedAt: STARTED_AT, lastActivityAt: ACTIVITY_AT }
    expect(await findCorrelatedSession(query)).toBeUndefined()
    expect(await findCorrelatedSession({ ...query, excludedSessionIds: new Set(['first']) })).toMatchObject({ sessionId: 'second' })
  })

  it('retries preserved-mtime growth and ignores incomplete trailing events', async () => {
    const stale = STARTED_AT - 60_000
    const file = await writeCodexSession('growing', CWD, stale)
    const query = { engine: 'codex' as const, cwd: CWD, terminalStartedAt: STARTED_AT, lastActivityAt: ACTIVITY_AT }
    expect(await findCorrelatedSession(query)).toBeUndefined()
    await appendFile(file, '\n' + JSON.stringify({ type: 'event_msg', timestamp: new Date(ACTIVITY_AT).toISOString(), payload: { type: 'token_count' } }) + '\n{"type":')
    await touch(file, stale)
    expect(await findCorrelatedSession(query)).toMatchObject({ sessionId: 'growing', activatedAt: ACTIVITY_AT })
  })

  it('does not confuse freshly copied old logs or child-agent logs with an active terminal', async () => {
    const file = await writeCodexSession('copied', CWD, STARTED_AT - 60_000)
    await touch(file, ACTIVITY_AT)
    const child = await writeCodexSession('child', CWD, ACTIVITY_AT)
    await writeFile(child, JSON.stringify({ type: 'session_meta', timestamp: new Date(ACTIVITY_AT).toISOString(), payload: { id: 'child', cwd: CWD, source: { subagent: { parent_thread_id: 'parent' } } } }))
    const query = { engine: 'codex' as const, cwd: CWD, terminalStartedAt: STARTED_AT, lastActivityAt: ACTIVITY_AT }
    expect(await findCorrelatedSession(query)).toBeUndefined()
  })

  it('reads large Codex identity headers and complete tail records without reading message bodies in full', async () => {
    const file = await writeCodexSession('large', CWD, ACTIVITY_AT)
    await writeFile(file, [
      JSON.stringify({ type: 'session_meta', timestamp: new Date(STARTED_AT).toISOString(), payload: { id: 'large', cwd: CWD, base_instructions: 'x'.repeat(100_000) } }),
      JSON.stringify({ type: 'response_item', payload: { text: 'x'.repeat(400_000) } }),
      JSON.stringify({ type: 'event_msg', timestamp: new Date(ACTIVITY_AT).toISOString(), payload: { type: 'token_count' } }),
    ].join('\n'))
    await touch(file, STARTED_AT)
    expect(await findCorrelatedSession({ engine: 'codex', cwd: CWD, terminalStartedAt: STARTED_AT, lastActivityAt: ACTIVITY_AT })).toMatchObject({ sessionId: 'large' })
  })
  it('correlates OpenCode by workspace and session activity, rejecting concurrent ambiguity', async () => {
    const root = join(testContext.homeDir, '.local', 'share', 'opencode')
    await mkdir(root, { recursive: true })
    const path = join(root, 'opencode.db')
    const db = new DatabaseSync(path)
    db.exec('CREATE TABLE session(id TEXT PRIMARY KEY,directory TEXT,time_updated INTEGER)')
    const insert = db.prepare('INSERT INTO session VALUES (?,?,?)')
    insert.run('oc', CWD.replace(/\\/g, '/'), ACTIVITY_AT)
    insert.run('foreign', 'C:/foreign', ACTIVITY_AT)
    const query = { engine: 'opencode' as const, cwd: CWD, terminalStartedAt: STARTED_AT, lastActivityAt: ACTIVITY_AT }
    expect(await findCorrelatedSession(query)).toMatchObject({ sessionId: 'oc', filePath: path, namespace: path })
    insert.run('race', CWD, ACTIVITY_AT)
    expect(await findCorrelatedSession(query)).toBeUndefined()
    db.close()
  })
  beforeEach(async () => {
    vi.stubEnv('CODEX_HOME', '')
    testContext.homeDir = await mkdtemp(join(tmpdir(), 'janusx-attribution-'))
  })

  afterEach(async () => {
    vi.unstubAllEnvs()
    await rm(testContext.homeDir, { recursive: true, force: true })
  })

  it('binds a claude session whose write lands inside the terminal activity window', async () => {
    const file = await writeClaudeSession('claude-1.jsonl', 'claude-session-1', ACTIVITY_AT)
    const found = await findCorrelatedSession({ engine: 'claude', cwd: CWD, terminalStartedAt: STARTED_AT, lastActivityAt: ACTIVITY_AT })
    expect(found).toMatchObject({ sessionId: 'claude-session-1', filePath: file, namespace: join(testContext.homeDir, '.claude') })
  })

  it('ignores claude sessions from another workspace and stale or future writes', async () => {
    const otherDir = join(testContext.homeDir, '.claude', 'projects', 'C--other')
    await mkdir(otherDir, { recursive: true })
    await writeFile(join(otherDir, 'claude-x.jsonl'), JSON.stringify({ sessionId: 'claude-x' }))
    await touch(join(otherDir, 'claude-x.jsonl'), ACTIVITY_AT)
    await writeClaudeSession('claude-stale.jsonl', 'claude-stale', Date.parse('2026-10-14T06:04:00Z'))
    expect(await findCorrelatedSession({ engine: 'claude', cwd: CWD, terminalStartedAt: STARTED_AT, lastActivityAt: ACTIVITY_AT })).toBeUndefined()

    // A write before the terminal existed cannot belong to it.
    await writeClaudeSession('claude-1.jsonl', 'claude-session-1', STARTED_AT - 60_000)
    expect(await findCorrelatedSession({ engine: 'claude', cwd: CWD, terminalStartedAt: STARTED_AT, lastActivityAt: ACTIVITY_AT })).toBeUndefined()
  })

  it('leaves the terminal unbound when two sessions correlate', async () => {
    await writeClaudeSession('claude-a.jsonl', 'claude-a', ACTIVITY_AT)
    await writeClaudeSession('claude-b.jsonl', 'claude-b', ACTIVITY_AT)
    expect(await findCorrelatedSession({ engine: 'claude', cwd: CWD, terminalStartedAt: STARTED_AT, lastActivityAt: ACTIVITY_AT })).toBeUndefined()
  })

  it('matches codex sessions by session_meta cwd and covers archived rollouts', async () => {
    const file = await writeCodexSession('01a11111-1111-4111-8111-111111111111', CWD, ACTIVITY_AT)
    const found = await findCorrelatedSession({ engine: 'codex', cwd: CWD, terminalStartedAt: STARTED_AT, lastActivityAt: ACTIVITY_AT })
    expect(found).toMatchObject({ sessionId: '01a11111-1111-4111-8111-111111111111', filePath: file, namespace: join(testContext.homeDir, '.codex') })

    // A rollout recorded for another workspace never binds this terminal.
    await writeCodexSession('01a22222-2222-4222-8222-222222222222', 'C:/elsewhere', ACTIVITY_AT)
    expect(await findCorrelatedSession({ engine: 'codex', cwd: 'C:/elsewhere', terminalStartedAt: STARTED_AT, lastActivityAt: ACTIVITY_AT }))
      .toMatchObject({ sessionId: '01a22222-2222-4222-8222-222222222222' })

    const archived = await writeCodexSession('01a33333-3333-4333-8333-333333333333', CWD, ACTIVITY_AT, { archived: true })
    const archivedFound = await findCorrelatedSession({ engine: 'codex', cwd: CWD, terminalStartedAt: STARTED_AT, lastActivityAt: ACTIVITY_AT })
    // Two candidates now correlate (active + archived), so attribution stands down.
    expect(archivedFound).toBeUndefined()
    expect(archived).toContain('archived_sessions')
  })

  it('matches pi sessions by header cwd and skips engines without session files', async () => {
    await writePiSession('pi-1', CWD, new Date(ACTIVITY_AT).toISOString())
    expect(await findCorrelatedSession({ engine: 'pi', cwd: CWD, terminalStartedAt: STARTED_AT, lastActivityAt: ACTIVITY_AT }))
      .toMatchObject({ sessionId: 'pi-1', namespace: join(testContext.homeDir, '.pi', 'agent', 'sessions') })

    await writePiSession('pi-2', 'C:/elsewhere', new Date(ACTIVITY_AT).toISOString())
    expect(await findCorrelatedSession({ engine: 'pi', cwd: CWD, terminalStartedAt: STARTED_AT, lastActivityAt: ACTIVITY_AT }))
      .toMatchObject({ sessionId: 'pi-1' })

    expect(await findCorrelatedSession({ engine: 'opencode', cwd: CWD, terminalStartedAt: STARTED_AT, lastActivityAt: ACTIVITY_AT })).toBeUndefined()
    expect(await findCorrelatedSession({ engine: 'janus', cwd: CWD, terminalStartedAt: STARTED_AT, lastActivityAt: ACTIVITY_AT })).toBeUndefined()
  })

  it('accepts windows with backslash drive spellings and tolerates no pty activity', async () => {
    await writeCodexSession('01a44444-4444-4444-8444-444444444444', 'C:\\repo', ACTIVITY_AT)
    expect(await findCorrelatedSession({ engine: 'codex', cwd: 'c:/repo/', terminalStartedAt: STARTED_AT, lastActivityAt: ACTIVITY_AT }))
      .toMatchObject({ sessionId: '01a44444-4444-4444-8444-444444444444' })
  })
})
