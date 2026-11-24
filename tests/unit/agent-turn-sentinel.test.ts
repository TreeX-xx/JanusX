import { mkdtemp, rm, writeFile, appendFile, mkdir } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  AgentTurnSentinel,
  classifyTranscriptLine,
  type TurnSentinelSignal,
} from '../../src/main/notifications/agent-turn-sentinel'

function jsonl(entry: Record<string, unknown>): string {
  return `${JSON.stringify(entry)}\n`
}

const apiErrorEntry = {
  type: 'assistant',
  isSidechain: false,
  sessionId: 'session-1',
  isApiErrorMessage: true,
  message: {
    role: 'assistant',
    content: [{ type: 'text', text: 'API Error: 429 {"type":"error","error":{"type":"rate_limit_error"}}' }],
  },
}

const interruptEntry = {
  type: 'user',
  isSidechain: false,
  sessionId: 'session-1',
  message: {
    role: 'user',
    content: [{ type: 'text', text: '[Request interrupted by user]' }],
  },
}

const normalAssistantEntry = {
  type: 'assistant',
  isSidechain: false,
  sessionId: 'session-1',
  message: {
    role: 'assistant',
    content: [{ type: 'text', text: 'All good, continuing the task.' }],
  },
}

describe('classifyTranscriptLine', () => {
  it('classifies a terminal API error record', () => {
    const signal = classifyTranscriptLine(JSON.stringify(apiErrorEntry), 'session-1')
    expect(signal).toEqual({
      kind: 'api-error',
      message: 'API Error: 429 {"type":"error","error":{"type":"rate_limit_error"}}',
    })
  })

  it('ignores sidechain records', () => {
    const signal = classifyTranscriptLine(
      JSON.stringify({ ...apiErrorEntry, isSidechain: true }),
      'session-1',
    )
    expect(signal).toBeNull()
  })

  it('ignores records from another session when a session id is pinned', () => {
    expect(classifyTranscriptLine(JSON.stringify(apiErrorEntry), 'other-session')).toBeNull()
    expect(classifyTranscriptLine(JSON.stringify(apiErrorEntry))).not.toBeNull()
  })

  it('classifies a user interrupt record', () => {
    expect(classifyTranscriptLine(JSON.stringify(interruptEntry), 'session-1')).toEqual({
      kind: 'interrupted',
    })
  })

  it('classifies a tool-use interrupt carried in tool_result content', () => {
    const entry = {
      type: 'user',
      sessionId: 'session-1',
      message: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            content: '[Request interrupted by user for tool use]',
          },
        ],
      },
    }
    expect(classifyTranscriptLine(JSON.stringify(entry), 'session-1')).toEqual({ kind: 'interrupted' })
  })

  it('does not treat assistant text quoting the marker as an interrupt', () => {
    const entry = {
      type: 'assistant',
      sessionId: 'session-1',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'The transcript records [Request interrupted by user] entries.' }],
      },
    }
    expect(classifyTranscriptLine(JSON.stringify(entry), 'session-1')).toBeNull()
  })

  it('ignores blank lines, invalid JSON and ordinary records', () => {
    expect(classifyTranscriptLine('')).toBeNull()
    expect(classifyTranscriptLine('not-json')).toBeNull()
    expect(classifyTranscriptLine(JSON.stringify(normalAssistantEntry), 'session-1')).toBeNull()
  })
})

describe('AgentTurnSentinel', () => {
  let dir: string
  let transcriptPath: string
  let signals: TurnSentinelSignal[]
  let sentinel: AgentTurnSentinel

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'janusx-sentinel-'))
    transcriptPath = join(dir, 'session-1.jsonl')
    signals = []
    sentinel = new AgentTurnSentinel({
      onSignal: (signal) => signals.push(signal),
    })
  })

  afterEach(async () => {
    sentinel.dispose()
    await rm(dir, { recursive: true, force: true })
  })

  it('signals an API error appended during the turn and ignores pre-turn content', async () => {
    // Pre-existing abort from an earlier turn must not fire for this turn.
    await writeFile(transcriptPath, jsonl(apiErrorEntry), 'utf8')

    sentinel.beginTurn({
      terminalId: 'term-1',
      engine: 'claude',
      transcriptPath,
      sessionId: 'session-1',
    })

    await appendFile(transcriptPath, jsonl(normalAssistantEntry), 'utf8')
    await appendFile(transcriptPath, jsonl(apiErrorEntry), 'utf8')

    await vi.waitFor(() => expect(signals).toHaveLength(1), { timeout: 5_000 })
    expect(signals[0]).toMatchObject({
      terminalId: 'term-1',
      engine: 'claude',
      kind: 'api-error',
    })
    expect(signals[0].message).toContain('API Error: 429')
  })

  it('stops after the first signal and re-arms for the next turn', async () => {
    await writeFile(transcriptPath, '', 'utf8')
    sentinel.beginTurn({
      terminalId: 'term-1',
      engine: 'claude',
      transcriptPath,
      sessionId: 'session-1',
    })

    await appendFile(transcriptPath, jsonl(interruptEntry), 'utf8')
    await vi.waitFor(() => expect(signals).toHaveLength(1), { timeout: 5_000 })
    expect(signals[0].kind).toBe('interrupted')

    // Ended turn: further aborts in the same file are another turn's business.
    await appendFile(transcriptPath, jsonl(apiErrorEntry), 'utf8')

    sentinel.beginTurn({
      terminalId: 'term-1',
      engine: 'claude',
      transcriptPath,
      sessionId: 'session-1',
    })
    await appendFile(transcriptPath, jsonl(apiErrorEntry), 'utf8')
    await vi.waitFor(() => expect(signals).toHaveLength(2), { timeout: 5_000 })
    expect(signals[1].kind).toBe('api-error')
  })

  it('detects a transcript created after the turn starts', async () => {
    sentinel.beginTurn({
      terminalId: 'term-1',
      engine: 'claude',
      transcriptPath,
      sessionId: 'session-1',
    })

    await writeFile(transcriptPath, jsonl(apiErrorEntry), 'utf8')
    await vi.waitFor(() => expect(signals).toHaveLength(1), { timeout: 5_000 })
    expect(signals[0].kind).toBe('api-error')
  })

  it('handles records split across watch events', async () => {
    await writeFile(transcriptPath, '', 'utf8')
    sentinel.beginTurn({
      terminalId: 'term-1',
      engine: 'claude',
      transcriptPath,
      sessionId: 'session-1',
    })

    const line = jsonl(apiErrorEntry)
    const splitAt = Math.floor(line.length / 2)
    await appendFile(transcriptPath, line.slice(0, splitAt), 'utf8')
    await appendFile(transcriptPath, line.slice(splitAt), 'utf8')

    await vi.waitFor(() => expect(signals).toHaveLength(1), { timeout: 5_000 })
    expect(signals[0].kind).toBe('api-error')
  })

  it('binds Codex aborts and service failures to the open root turn across restarts', async () => {
    const row = (type: string, id: string, extra = {}) => jsonl({
      type: 'event_msg', payload: { type, root_turn_id: id, turn_id: id, ...extra },
    })
    const arm = () => sentinel.beginTurn({ terminalId: 'term-1', engine: 'codex', transcriptPath })
    const failed = (id: string) => row('task_complete', id, { error: { message: '503 Service Unavailable' } })
    await writeFile(transcriptPath, row('task_started', 'old') + failed('old') + row('task_started', 'first'))
    arm()
    await appendFile(transcriptPath, failed('old') + row('turn_aborted', 'first', { reason: 'interrupted' }))
    await vi.waitFor(() => expect(signals.map(s => s.kind)).toEqual(['interrupted']))
    for (const id of ['second', 'third']) {
      await appendFile(transcriptPath, row('task_started', id))
      arm()
      await appendFile(transcriptPath, row('stream_error', id, { message: 'retrying' }) +
        row('task_complete', 'child', { root_turn_id: id, error: { message: 'child failed' } }) +
        jsonl({ type: 'response_item', payload: { text: 'Request failed with status code 503' } }) +
        failed(id))
      await vi.waitFor(() => expect(signals.at(-1)?.kind).toBe('api-error'))
    }
    await vi.waitFor(() => expect(signals.map(s => s.kind)).toEqual(['interrupted', 'api-error', 'api-error']))
  })

  it('accepts an already flushed Codex failure only for the explicitly bound hook turn', async () => {
    await writeFile(transcriptPath, ['old', 'current'].map(turn_id => jsonl({ type: 'event_msg',
      payload: { type: 'task_complete', turn_id, error: { message: turn_id } } })).join(''))
    sentinel.beginTurn({ terminalId: 'term-1', engine: 'codex', transcriptPath, providerTurnId: 'current' })
    await vi.waitFor(() => expect(signals.map(s => s.message)).toEqual(['current']))
  })

  it('reports a diagnostic instead of arming when no transcript path is known', async () => {
    const diagnostics: Array<{ stage: string }> = []
    const bare = new AgentTurnSentinel({
      onSignal: (signal) => signals.push(signal),
      onDiagnostic: (record) => diagnostics.push(record),
    })
    bare.beginTurn({ terminalId: 'term-1', engine: 'claude' })
    expect(diagnostics).toEqual([
      { terminalId: 'term-1', stage: 'skipped', detail: 'no-transcript-path' },
    ])
    bare.dispose()
  })

  it('reports a diagnostic when the transcript directory does not exist', async () => {
    const diagnostics: Array<{ stage: string }> = []
    const bare = new AgentTurnSentinel({
      onSignal: (signal) => signals.push(signal),
      onDiagnostic: (record) => diagnostics.push(record),
    })
    const missing = join(dir, 'missing-subdir')
    bare.beginTurn({
      terminalId: 'term-1',
      engine: 'claude',
      transcriptPath: join(missing, 'session.jsonl'),
    })
    // Watching a non-existent directory must degrade, not throw.
    expect(diagnostics.some((record) => record.stage === 'unavailable' || record.stage === 'watch-error')).toBe(true)
    bare.dispose()
    await mkdir(missing, { recursive: true }).catch(() => {})
  })
})
