import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentHookPayload } from '../../../src/main/notifications/agent-hook-types'
import { taskNotification } from './memory-observation.fixture'

const mocks = vi.hoisted(() => ({
  persona: true,
  capture: vi.fn(),
  getKnowledgeSettings: vi.fn(),
  scheduleImmediate: vi.fn(),
  listAll: vi.fn(),
}))

vi.mock('../../../src/main/knowledge/capture-inbox', () => ({ knowledgeCaptureInbox: {
  submit: async entries => Promise.all(entries.map(entry => mocks.capture(entry.input, entry.context))), drain: vi.fn(),
} }))
vi.mock('../../../src/main/knowledge/transcript-recovery', () => ({ knowledgeTranscriptRecovery: { drain: vi.fn().mockResolvedValue([]), submit: vi.fn() } }))

vi.mock('../../../src/main/knowledge/observation-service', () => ({
  knowledgeObservationService: {
    capture: mocks.capture,
    listAll: mocks.listAll,
    resolveContent: async row => row.content,
  },
}))

vi.mock('../../../src/main/knowledge/processing-queue', () => ({
  knowledgeProcessingQueue: {
    scheduleImmediate: mocks.scheduleImmediate,
  },
}))

vi.mock('../../../src/main/config/service', () => ({
  configService: {
    getKnowledgeSettings: mocks.getKnowledgeSettings,
    getExperimentalFeatures: async () => ({ persona: mocks.persona }),
    getPersonalMemorySettings: async () => ({ inferEngineeringHabits: (await mocks.getKnowledgeSettings()).enabled }),
  },
}))

async function loadRecorder() {
  vi.resetModules()
  return import('../../../src/main/knowledge/agent-turn-recorder')
}

describe('AgentTurnRecorder', () => {
  it('keeps the original prompt and correlation when a waiting turn resumes and is interrupted', async () => {
    const { AgentTurnRecorder } = await loadRecorder()
    const recorder = new AgentTurnRecorder()
    recorder.registerTerminal({ terminalId: 'resume', engine: 'codex', workspaceId: 'w', cwd: 'C:/work' })
    mocks.capture.mockResolvedValueOnce({ id: 'original-observation' }).mockResolvedValue({ id: 'later-observation' })
    try {
      const payload = { source: 'codex' as const, event: 'UserPromptSubmit', terminalId: 'resume', sessionId: 's' }
      await recorder.handleHookPayload({ ...payload, message: 'Original question' }, { type: 'turn-start' })
      await recorder.handleHookPayload({ ...payload, message: 'My approval response' }, { type: 'turn-start', resume: true })
      await recorder.handleHookPayload({ ...payload, event: 'Interrupt' }, { type: 'turn-end', kind: 'interrupted' })
      const [first, continuation, end] = mocks.capture.mock.calls
      expect(continuation[0]).toMatchObject({ correlationId: first[0].correlationId, tags: expect.arrayContaining(['turn-input']) })
      expect(end[0]).toMatchObject({ correlationId: first[0].correlationId, tags: expect.arrayContaining(['turn-interrupted']), metadata: { prompt: 'Original question', completionKind: 'interrupted' } })
      expect(end[1].relatedObservationIds).toEqual(['original-observation'])
    } finally { recorder.dispose() }
  })

  it('connects an OpenCode completion to its exact session database recovery', async () => {
    const { agentTurnRecorder } = await loadRecorder()
    const { knowledgeTranscriptRecovery } = await import('../../../src/main/knowledge/transcript-recovery')
    vi.mocked(knowledgeTranscriptRecovery.submit).mockResolvedValue([{ id: 'completed', workspaceId: 'workspace-1' } as any])
    agentTurnRecorder.registerTerminal({ terminalId: 'oc', engine: 'opencode', workspaceId: 'workspace-1', cwd: 'C:/work' })
    await agentTurnRecorder.handleHookPayload({ source: 'opencode', event: 'session.idle', terminalId: 'oc', sessionId: 'exact-session', timestamp: '2026-10-07T00:00:00Z' })
    expect(knowledgeTranscriptRecovery.submit).toHaveBeenCalledWith(expect.objectContaining({
      engine: 'opencode', path: expect.stringMatching(/opencode[\\/]opencode\.db$/),
      end: expect.objectContaining({ input: expect.objectContaining({ workspaceId: 'workspace-1', workspacePath: 'C:/work', sessionId: 'exact-session' }) }),
    }), expect.any(Function))
  })
  beforeEach(() => {
    mocks.persona = true
    mocks.capture.mockReset()
    mocks.capture.mockResolvedValue({ workspaceId: 'workspace-1' })
    mocks.getKnowledgeSettings.mockReset()
    mocks.getKnowledgeSettings.mockResolvedValue({ enabled: true })
    mocks.scheduleImmediate.mockReset()
    mocks.listAll.mockReset().mockResolvedValue([])
  })

  it('ignores injected notifications without replacing the active user turn', async () => {
    const { agentTurnRecorder } = await loadRecorder()
    agentTurnRecorder.registerTerminal({ terminalId: 'terminal', engine: 'claude', workspaceId: 'workspace-1', cwd: 'C:/work' })
    const payload: AgentHookPayload = { source: 'claude', event: 'UserPromptSubmit', terminalId: 'terminal', sessionId: 'session',
      message: 'Fix the cache', timestamp: '2026-10-06T00:00:00Z' }
    await agentTurnRecorder.handleHookPayload(payload)
    for (let index = 0; index < 4; index++) await agentTurnRecorder.handleHookPayload({ ...payload, message: taskNotification(`task-${index}`), timestamp: '2026-10-06T00:00:01Z' })
    await agentTurnRecorder.handleHookPayload({ ...payload, message: 'Runtime context reminder', raw: { isMeta: true } })
    await agentTurnRecorder.handleHookPayload({ ...payload, event: 'Stop', message: undefined, timestamp: '2026-10-06T00:00:05Z' })
    expect(mocks.capture).toHaveBeenCalledTimes(2)
    const [start, end] = mocks.capture.mock.calls.map(call => call[0])
    expect(end.correlationId).toBe(start.correlationId)
    expect(end.metadata).toMatchObject({ prompt: 'Fix the cache', durationMs: 5000 })
    agentTurnRecorder.dispose()
  })

  it('skips legacy notification starts while recovering the real user turn after restart', async () => {
    const { agentTurnRecorder } = await loadRecorder()
    agentTurnRecorder.registerTerminal({ terminalId: 'terminal', engine: 'claude', workspaceId: 'workspace-1', cwd: 'C:/work' })
    mocks.listAll.mockResolvedValue([
      { workspaceId: 'workspace-1', sessionId: 's', agentId: 'claude', tags: ['turn-started'], createdAt: '2026-10-06T00:00:01Z',
        correlationId: 'noise', content: taskNotification(), sourceEvidence: { speaker: 'user' } },
      { workspaceId: 'workspace-1', sessionId: 's', agentId: 'claude', tags: ['turn-started'], createdAt: '2026-10-06T00:00:00Z',
        correlationId: 'real', content: 'Fix the cache', sourceEvidence: { speaker: 'user' } },
    ])
    await agentTurnRecorder.handleHookPayload({ source: 'claude', event: 'Stop', terminalId: 'terminal', sessionId: 's', timestamp: '2026-10-06T00:00:05Z' })
    expect(mocks.capture.mock.calls[0][0]).toMatchObject({ correlationId: 'real', metadata: { prompt: 'Fix the cache', durationMs: 5000 } })
    agentTurnRecorder.dispose()
  })

  it('records hook-driven terminal turn start and completion with duration metadata', async () => {
    const { agentTurnRecorder } = await loadRecorder()
    agentTurnRecorder.registerTerminal({
      terminalId: 'terminal-1',
      engine: 'codex',
      workspaceId: 'workspace-1',
      cwd: 'C:/work/project',
    })

    const startPayload: AgentHookPayload = {
      source: 'codex',
      event: 'UserPromptSubmit',
      terminalId: 'terminal-1',
      workspaceId: 'workspace-1',
      sessionId: 'session-1',
      message: 'Implement knowledge capture',
      timestamp: '2026-07-06T00:00:00.000Z',
    }
    const stopPayload: AgentHookPayload = {
      source: 'codex',
      event: 'Stop',
      terminalId: 'terminal-1',
      workspaceId: 'workspace-1',
      sessionId: 'session-1',
      timestamp: '2026-07-06T00:00:05.000Z',
    }

    agentTurnRecorder.handleHookPayload(startPayload)
    agentTurnRecorder.handleHookPayload(stopPayload)

    await vi.waitFor(() => expect(mocks.capture).toHaveBeenCalledTimes(2))

    expect(mocks.capture).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        workspacePath: 'C:/work/project',
        source: 'agent-stream',
        type: 'conversation-turn',
        content: 'Implement knowledge capture',
        tags: ['terminal-hook', 'turn-started', 'codex'],
        actor: 'user',
      }),
      expect.objectContaining({ speaker: 'user', sourceEventId: expect.any(String), createdAt: '2026-07-06T00:00:00.000Z' }),
    )
    expect(mocks.capture).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        source: 'agent-stream',
        type: 'system-event',
        tags: ['terminal-hook', 'turn-completed', 'codex'],
        actor: 'codex',
        metadata: expect.objectContaining({
          durationMs: 5000,
          prompt: 'Implement knowledge capture',
        }),
      }),
      expect.objectContaining({ speaker: 'unknown', sourceEventId: expect.any(String) }),
    )
  })

  it('schedules immediate processing when a turn completes (Phase 5 §6)', async () => {
    const { agentTurnRecorder } = await loadRecorder()
    agentTurnRecorder.registerTerminal({
      terminalId: 'terminal-1',
      engine: 'codex',
      workspaceId: 'workspace-1',
      cwd: 'C:/work/project',
    })

    agentTurnRecorder.handleHookPayload({
      source: 'codex',
      event: 'UserPromptSubmit',
      terminalId: 'terminal-1',
      workspaceId: 'workspace-1',
      message: 'hello',
    })
    agentTurnRecorder.handleHookPayload({
      source: 'codex',
      event: 'Stop',
      terminalId: 'terminal-1',
      workspaceId: 'workspace-1',
    })

    await vi.waitFor(() => expect(mocks.capture).toHaveBeenCalledTimes(2))
    await vi.waitFor(() => expect(mocks.scheduleImmediate).toHaveBeenCalledTimes(1))
    expect(mocks.scheduleImmediate).toHaveBeenCalledWith('workspace-1')
  })

  it('does not write observations when knowledge capture is disabled', async () => {
    mocks.getKnowledgeSettings.mockResolvedValue({ enabled: false })
    const { agentTurnRecorder } = await loadRecorder()
    agentTurnRecorder.registerTerminal({
      terminalId: 'terminal-1',
      engine: 'codex',
      workspaceId: 'workspace-1',
      cwd: 'C:/work/project',
    })

    agentTurnRecorder.handleHookPayload({
      source: 'codex',
      event: 'UserPromptSubmit',
      terminalId: 'terminal-1',
      workspaceId: 'workspace-1',
      message: 'This should not be captured',
    })

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(mocks.capture).not.toHaveBeenCalled()
  })

  it('does not attribute status-shaped messages to a user or trust a mismatched terminal engine', async () => {
    const { agentTurnRecorder } = await loadRecorder()
    agentTurnRecorder.registerTerminal({ terminalId: 'terminal', engine: 'opencode', workspaceId: 'workspace-1', cwd: 'C:/work' })
    agentTurnRecorder.handleHookPayload({ source: 'opencode', event: 'session.status', terminalId: 'terminal', raw: { status: 'busy' }, message: 'I prefer pnpm' })
    await vi.waitFor(() => expect(mocks.capture).toHaveBeenCalledTimes(1))
    expect(mocks.capture.mock.calls[0][1].speaker).toBe('unknown')
    agentTurnRecorder.handleHookPayload({ source: 'claude', event: 'UserPromptSubmit', terminalId: 'terminal', message: 'I prefer pnpm' })
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(mocks.capture).toHaveBeenCalledTimes(1)
  })

  it('keeps a source event identity across recorder restarts and separates later identical prompts', async () => {
    const { agentTurnRecorder } = await loadRecorder()
    const terminal = { terminalId: 'terminal', engine: 'codex' as const, workspaceId: 'workspace-1', cwd: 'C:/work' }
    const payload: AgentHookPayload = { source: 'codex', event: 'UserPromptSubmit', terminalId: 'terminal', sessionId: 'session', message: 'I prefer pnpm', timestamp: '2026-09-29T00:00:00.000Z' }
    for (const timestamp of [payload.timestamp, payload.timestamp, '2026-09-29T00:01:00.000Z']) {
      agentTurnRecorder.dispose(); agentTurnRecorder.registerTerminal(terminal)
      const count = mocks.capture.mock.calls.length
      agentTurnRecorder.handleHookPayload({ ...payload, timestamp })
      await vi.waitFor(() => expect(mocks.capture).toHaveBeenCalledTimes(count + 1))
    }
    const events = mocks.capture.mock.calls.map(call => call[1].sourceEventId)
    expect(events[0]).toBe(events[1]); expect(events[2]).not.toBe(events[0])
  })

  it('redacts prompts in both the start record and completion metadata while deduplicating retries', async () => {
    const { agentTurnRecorder } = await loadRecorder()
    agentTurnRecorder.registerTerminal({ terminalId: 'terminal', engine: 'codex', workspaceId: 'workspace-1', cwd: 'C:/work' })
    const secret = 'sk-' + 'x'.repeat(48)
    const payload: AgentHookPayload = { source: 'codex', event: 'UserPromptSubmit', terminalId: 'terminal', sessionId: 'session', message: `Use OPENAI_API_KEY=${secret}` }
    agentTurnRecorder.handleHookPayload(payload)
    agentTurnRecorder.handleHookPayload(payload)
    agentTurnRecorder.handleHookPayload({ ...payload, event: 'Stop', message: undefined })
    await vi.waitFor(() => expect(mocks.capture).toHaveBeenCalledTimes(2))
    const [start, end] = mocks.capture.mock.calls.map(call => call[0])
    expect(start.content).not.toContain(secret)
    expect(end.metadata.prompt).toBe(start.content)
  })
})


describe('P3 habit capture admission', () => {
  beforeEach(() => { mocks.capture.mockReset().mockResolvedValue({ id: 'start', workspaceId: 'w' }); mocks.scheduleImmediate.mockReset(); mocks.listAll.mockReset().mockResolvedValue([]) })
  it.each([[false, false], [false, true], [true, false], [true, true]])('persona=%s habits=%s controls dispatch and recovery timer', async (persona, habits) => {
    vi.useFakeTimers()
    const { AgentTurnRecorder } = await loadRecorder()
    mocks.persona = persona
    mocks.getKnowledgeSettings.mockResolvedValue({ enabled: habits })
    const { knowledgeCaptureInbox } = await import('../../../src/main/knowledge/capture-inbox')
    vi.mocked(knowledgeCaptureInbox.drain).mockClear()
    const recorder = new AgentTurnRecorder()
    try {
      recorder.registerTerminal({ terminalId: 't', engine: 'codex', workspaceId: 'w', cwd: 'C:/work' })
      await recorder.refreshPolicy()
      await recorder.handleHookPayload({ source: 'codex', terminalId: 't', event: 'UserPromptSubmit', message: 'real user words' })
      await recorder.settle()
      expect(mocks.capture.mock.calls.length > 0).toBe(persona && habits)
      expect(vi.getTimerCount()).toBe(persona && habits ? 1 : 0)
      if (!persona || !habits) expect(knowledgeCaptureInbox.drain).not.toHaveBeenCalled()
    } finally { recorder.dispose(); vi.useRealTimers() }
  })

  it('drops queued payloads and results when disabled during an admitted capture', async () => {
    const { AgentTurnRecorder } = await loadRecorder()
    mocks.persona = true
    mocks.getKnowledgeSettings.mockResolvedValue({ enabled: true })
    let finish!: (value: unknown) => void
    mocks.capture.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const recorder = new AgentTurnRecorder()
    const events = vi.fn()
    recorder.setEventSink(events)
    recorder.registerTerminal({ terminalId: 't', engine: 'codex', cwd: 'C:/work' })
    const first = recorder.handleHookPayload({ source: 'codex', terminalId: 't', event: 'UserPromptSubmit', message: 'private words' })
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    const second = recorder.handleHookPayload({ source: 'codex', terminalId: 't', event: 'Stop' })
    mocks.getKnowledgeSettings.mockResolvedValue({ enabled: false })
    await recorder.refreshPolicy()
    finish({ id: 'old-result', workspaceId: 'w' })
    await Promise.all([first, second, recorder.settle()])
    expect(mocks.capture).toHaveBeenCalledTimes(1)
    expect(mocks.scheduleImmediate).not.toHaveBeenCalled()
    expect(events).not.toHaveBeenCalled()
    recorder.dispose()
  })
})
