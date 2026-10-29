import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '.'),
  },
  BrowserWindow: class BrowserWindow {},
}))

vi.mock('../../src/main/notifications/desktop-toast-window', () => ({
  desktopToastWindow: {
    show: vi.fn(() => true),
  },
}))

import { AgentHookCoordinator } from '../../src/main/notifications/agent-hook-coordinator'
import type {
  AgentHookCompletion,
  AgentHookCoordinatorEvent,
  AgentHookPayload,
  RegisteredHookTerminal,
} from '../../src/main/notifications/agent-hook-types'

function createCoordinator(now: () => number) {
  const completions: AgentHookCompletion[] = []
  const attentionPayloads: AgentHookPayload[] = []
  const events: AgentHookCoordinatorEvent[] = []
  const resolvedPayloads: AgentHookPayload[] = []

  const coordinator = new AgentHookCoordinator(() => null, {
    now,
    deliverCompletion: (completion) => {
      completions.push(completion)
      return true
    },
    deliverAttention: (payload) => {
      attentionPayloads.push(payload)
      return true
    },
    onEvent: (event) => events.push(event),
    onResolvedPayload: (payload) => resolvedPayloads.push(payload),
  })

  return { coordinator, completions, attentionPayloads, events, resolvedPayloads }
}

const codexTerminal: RegisteredHookTerminal = {
  terminalId: 'term-1',
  engine: 'codex',
  workspaceId: 'workspace-1',
  cwd: 'C:/repo',
}

function lifecycleTypes(events: AgentHookCoordinatorEvent[]): string[] {
  return events
    .map((event) => event.type)
    .filter((type) => type !== 'received')
}

describe('AgentHookCoordinator', () => {
  it('delivers a completion notification from UserPromptSubmit and Stop hooks', async () => {
    let now = 1_000
    const { coordinator, completions, events } = createCoordinator(() => now)

    coordinator.registerTerminal(codexTerminal)
    coordinator.handleHookPayload({
      source: 'codex',
      event: 'UserPromptSubmit',
      terminalId: 'term-1',
    })
    now = 35_000
    coordinator.handleHookPayload({
      source: 'codex',
      event: 'Stop',
      terminalId: 'term-1',
      message: 'done',
    })
    await Promise.resolve()

    expect(completions).toEqual([
      {
        turnId: 'term-1:1000',
        terminalId: 'term-1',
        engine: 'codex',
        source: 'codex',
        hookEvent: 'Stop',
        startedAt: new Date(1_000).toISOString(),
        endedAt: new Date(35_000).toISOString(),
        kind: 'done',
        failed: false,
        message: 'done',
      },
    ])
    expect(lifecycleTypes(events)).toEqual(['started', 'completed'])
  })

  it('delivers completion even when Stop arrives without a known start hook', async () => {
    let now = 5_000
    const { coordinator, completions } = createCoordinator(() => now)

    coordinator.registerTerminal(codexTerminal)
    coordinator.handleHookPayload({
      source: 'codex',
      event: 'Stop',
      terminalId: 'term-1',
    })
    await Promise.resolve()

    expect(completions[0]).toMatchObject({
      turnId: 'term-1:5000',
      terminalId: 'term-1',
      startedAt: undefined,
      failed: false,
    })
  })

  it('emits normalized payloads after terminal resolution', () => {
    const { coordinator, resolvedPayloads } = createCoordinator(() => 1_000)

    coordinator.registerTerminal(codexTerminal)
    coordinator.handleHookPayload({
      source: 'codex',
      event: 'Stop',
    })

    expect(resolvedPayloads).toEqual([
      expect.objectContaining({
        source: 'codex',
        event: 'Stop',
        terminalId: 'term-1',
        workspaceId: 'workspace-1',
        cwd: 'C:/repo',
      }),
    ])
  })

  it('delivers approval notifications immediately', async () => {
    const { coordinator, attentionPayloads, events } = createCoordinator(() => 1_000)

    coordinator.registerTerminal(codexTerminal)
    coordinator.handleHookPayload({
      source: 'codex',
      event: 'PermissionRequest',
      terminalId: 'term-1',
      message: 'approve command',
    })
    await Promise.resolve()

    expect(attentionPayloads).toHaveLength(1)
    expect(attentionPayloads[0]).toMatchObject({ event: 'PermissionRequest', message: 'approve command' })
    expect(events.at(-1)).toMatchObject({ type: 'approval', delivered: true })
  })

  it('maps opencode session status and idle events to start and completion', async () => {    let now = 10_000
    const { coordinator, completions, events } = createCoordinator(() => now)

    coordinator.registerTerminal({
      terminalId: 'term-opencode',
      engine: 'opencode',
      workspaceId: 'workspace-1',
      cwd: 'C:/repo',
    })
    coordinator.handleHookPayload({
      source: 'opencode',
      event: 'session.status',
      terminalId: 'term-opencode',
      raw: { properties: { sessionID: 'session-1', status: { type: 'busy' } } },
    })
    now = 12_000
    coordinator.handleHookPayload({
      source: 'opencode',
      event: 'session.idle',
      terminalId: 'term-opencode',
    })
    await Promise.resolve()

    expect(completions[0]).toMatchObject({
      turnId: 'term-opencode:10000',
      engine: 'opencode',
      hookEvent: 'session.idle',
      failed: false,
    })
    expect(lifecycleTypes(events)).toEqual(['started', 'completed'])
  })

  it.each(['question.asked', 'question.v2.asked'])('delivers OpenCode %s input requests', async (event) => {
    const { coordinator, attentionPayloads, resolvedPayloads } = createCoordinator(() => 1_000)
    coordinator.registerTerminal({ terminalId: 'term-opencode', engine: 'opencode', cwd: 'C:/repo' })
    coordinator.handleHookPayload({ source: 'opencode', event, terminalId: 'term-opencode' })
    await Promise.resolve()
    expect(attentionPayloads).toHaveLength(1)
    expect(resolvedPayloads[0]).toMatchObject({ source: 'opencode', event })
  })

  it('tracks pi agent_start/agent_settled as a turn', async () => {
    let now = 20_000
    const { coordinator, completions, events } = createCoordinator(() => now)

    coordinator.registerTerminal({
      terminalId: 'term-pi',
      engine: 'pi',
      workspaceId: 'workspace-1',
      cwd: 'C:/repo',
    })
    coordinator.handleHookPayload({ source: 'pi', event: 'UserPromptSubmit', terminalId: 'term-pi' })
    now = 25_000
    coordinator.handleHookPayload({ source: 'pi', event: 'Stop', terminalId: 'term-pi' })
    await Promise.resolve()

    expect(completions[0]).toMatchObject({
      turnId: 'term-pi:20000',
      engine: 'pi',
      hookEvent: 'Stop',
      failed: false,
    })
    expect(lifecycleTypes(events)).toEqual(['started', 'completed'])
  })

  it('routes janus/pi Notification matchers to attention and approval', async () => {
    const { coordinator, attentionPayloads, events } = createCoordinator(() => 1_000)

    coordinator.registerTerminal({
      terminalId: 'term-janus',
      engine: 'janus',
      workspaceId: 'workspace-1',
      cwd: 'C:/repo',
    })
    coordinator.handleHookPayload({
      source: 'janus',
      event: 'Notification',
      terminalId: 'term-janus',
      raw: { hook: 'ask-user', matcher: 'idle_prompt' },
    })
    coordinator.handleHookPayload({
      source: 'janus',
      event: 'PermissionRequest',
      terminalId: 'term-janus',
      message: 'Allow rm?',
    })
    await Promise.resolve()

    expect(attentionPayloads).toHaveLength(2)
    expect(events.filter((event) => event.type === 'attention')).toHaveLength(1)
    expect(events.filter((event) => event.type === 'approval')).toHaveLength(1)
  })

  it('reports ambiguous events that cannot be mapped to one terminal', () => {
    const completions: AgentHookCompletion[] = []
    const events: AgentHookCoordinatorEvent[] = []
    const deliverSpy = vi.fn((completion: AgentHookCompletion) => {
      completions.push(completion)
      return true
    })
    const isolated = new AgentHookCoordinator(() => null, {
      deliverCompletion: deliverSpy,
      onEvent: (event) => events.push(event),
    })

    isolated.registerTerminal({ ...codexTerminal, terminalId: 'a' })
    isolated.registerTerminal({ ...codexTerminal, terminalId: 'b' })
    isolated.handleHookPayload({ source: 'codex', event: 'Stop' })

    expect(deliverSpy).not.toHaveBeenCalled()
    expect(events.at(-1)).toMatchObject({
      type: 'unmatched',
      reason: 'ambiguous-terminal',
      delivered: false,
    })
  })
})

describe('AgentHookCoordinator synthetic turn ends', () => {
  const claudeTerminal: RegisteredHookTerminal = {
    terminalId: 'term-claude',
    engine: 'claude',
    workspaceId: 'workspace-1',
    cwd: 'C:/repo',
  }

  function startClaudeTurn(coordinator: AgentHookCoordinator): void {
    coordinator.registerTerminal(claudeTerminal)
    coordinator.handleHookPayload({
      source: 'claude',
      event: 'UserPromptSubmit',
      terminalId: 'term-claude',
      sessionId: 'session-1',
      raw: { session_id: 'session-1', transcript_path: 'C:/transcripts/session-1.jsonl' },
    })
  }

  it('completes an active turn as failed on a sentinel api-error event', async () => {
    let now = 1_000
    const { coordinator, completions, events } = createCoordinator(() => now)

    startClaudeTurn(coordinator)
    now = 60_000
    coordinator.handleHookPayload({
      source: 'claude',
      event: 'janusx.turn.api-error',
      terminalId: 'term-claude',
      message: 'API Error: 429 rate_limit_error',
    })
    await Promise.resolve()

    expect(completions).toEqual([
      expect.objectContaining({
        turnId: 'term-claude:1000',
        hookEvent: 'janusx.turn.api-error',
        kind: 'failed',
        failed: true,
        message: 'API Error: 429 rate_limit_error',
      }),
    ])
    expect(lifecycleTypes(events)).toEqual(['started', 'failed'])
  })

  it('drops synthetic end signals when no turn is active (first signal wins)', async () => {
    const { coordinator, completions, events } = createCoordinator(() => 1_000)

    coordinator.registerTerminal(claudeTerminal)
    for (const event of ['janusx.turn.api-error', 'janusx.turn.interrupted', 'janusx.turn.orphaned']) {
      coordinator.handleHookPayload({ source: 'claude', event, terminalId: 'term-claude' })
    }
    await Promise.resolve()

    expect(completions).toHaveLength(0)
    expect(lifecycleTypes(events)).toEqual(['ignored', 'ignored', 'ignored'])
    expect(events.at(-1)).toMatchObject({ reason: 'no-active-turn', delivered: false })
  })

  it('completes an active turn silently as interrupted on a user interrupt', async () => {
    const { coordinator, completions, events } = createCoordinator(() => 1_000)

    startClaudeTurn(coordinator)
    coordinator.handleHookPayload({
      source: 'claude',
      event: 'janusx.turn.interrupted',
      terminalId: 'term-claude',
    })
    await Promise.resolve()

    expect(completions).toEqual([
      expect.objectContaining({ kind: 'interrupted', failed: false }),
    ])
    expect(lifecycleTypes(events)).toEqual(['started', 'interrupted'])
  })

  it('treats SessionEnd as an interrupt only while a turn is active', async () => {
    const { coordinator, completions, events } = createCoordinator(() => 1_000)

    coordinator.registerTerminal(claudeTerminal)
    coordinator.handleHookPayload({ source: 'claude', event: 'SessionEnd', terminalId: 'term-claude' })
    await Promise.resolve()
    expect(completions).toHaveLength(0)
    expect(events.at(-1)).toMatchObject({ type: 'ignored', reason: 'no-active-turn' })

    startClaudeTurn(coordinator)
    coordinator.handleHookPayload({ source: 'claude', event: 'SessionEnd', terminalId: 'term-claude' })
    await Promise.resolve()
    expect(completions).toEqual([
      expect.objectContaining({ hookEvent: 'SessionEnd', kind: 'interrupted' }),
    ])
    expect(lifecycleTypes(events)).toEqual(['ignored', 'started', 'interrupted'])
  })

  it('does not let a late Stop overwrite an authoritative synthetic failure', async () => {
    const { coordinator, completions, events } = createCoordinator(() => 1_000)

    startClaudeTurn(coordinator)
    coordinator.handleHookPayload({
      source: 'claude',
      event: 'janusx.turn.api-error',
      terminalId: 'term-claude',
    })
    coordinator.handleHookPayload({ source: 'claude', event: 'Stop', terminalId: 'term-claude' })
    await Promise.resolve()

    expect(completions.map((completion) => completion.kind)).toEqual(['failed'])
    expect(events).toContainEqual(expect.objectContaining({
      type: 'ignored',
      hookEvent: 'Stop',
      reason: 'turn-already-ended',
      delivered: false,
    }))
  })

  it('accepts normal completion again after the next turn starts', async () => {
    const { coordinator, completions } = createCoordinator(() => 1_000)

    startClaudeTurn(coordinator)
    coordinator.handleHookPayload({
      source: 'claude',
      event: 'janusx.turn.api-error',
      terminalId: 'term-claude',
    })
    coordinator.handleHookPayload({
      source: 'claude',
      event: 'UserPromptSubmit',
      terminalId: 'term-claude',
    })
    coordinator.handleHookPayload({ source: 'claude', event: 'Stop', terminalId: 'term-claude' })
    await Promise.resolve()

    expect(completions.map((completion) => completion.kind)).toEqual(['failed', 'done'])
  })

  it('drops a post-completion Claude idle nudge without touching status or toasts', async () => {
    let now = 1_000
    const { coordinator, completions, attentionPayloads, events, resolvedPayloads } = createCoordinator(() => now)

    startClaudeTurn(coordinator)
    now = 35_000
    coordinator.handleHookPayload({ source: 'claude', event: 'Stop', terminalId: 'term-claude' })
    const resolvedAfterStop = resolvedPayloads.length
    now = 95_000
    coordinator.handleHookPayload({
      source: 'claude',
      event: 'Notification',
      terminalId: 'term-claude',
      matcher: 'idle_prompt',
    })
    await Promise.resolve()

    expect(completions.map((completion) => completion.kind)).toEqual(['done'])
    expect(attentionPayloads).toHaveLength(0)
    expect(resolvedPayloads).toHaveLength(resolvedAfterStop)
    expect(events).toContainEqual(expect.objectContaining({
      type: 'ignored',
      hookEvent: 'Notification',
      reason: 'idle-without-active-turn',
      delivered: false,
    }))
  })

  it('treats a mid-turn Claude idle prompt as attention', async () => {
    const { coordinator, attentionPayloads, events } = createCoordinator(() => 1_000)

    startClaudeTurn(coordinator)
    coordinator.handleHookPayload({
      source: 'claude',
      event: 'Notification',
      terminalId: 'term-claude',
      matcher: 'idle_prompt',
    })
    await Promise.resolve()

    expect(attentionPayloads).toHaveLength(1)
    expect(events.at(-1)).toMatchObject({ type: 'attention', delivered: true })
  })

  it('still raises a Claude permission prompt without a tracked turn', async () => {
    const { coordinator, attentionPayloads, events } = createCoordinator(() => 1_000)

    coordinator.registerTerminal(claudeTerminal)
    coordinator.handleHookPayload({
      source: 'claude',
      event: 'Notification',
      terminalId: 'term-claude',
      matcher: 'permission_prompt',
    })
    await Promise.resolve()

    expect(attentionPayloads).toHaveLength(1)
    // Notification + permission_prompt is an approval wait (terminal shows
    // needs-approval), so the coordinator emits approval, not plain attention.
    expect(events.at(-1)).toMatchObject({ type: 'approval', delivered: true })
  })

  it('keeps legacy matcher-less Claude notifications as attention', async () => {
    const { coordinator, attentionPayloads, events } = createCoordinator(() => 1_000)

    coordinator.registerTerminal(claudeTerminal)
    coordinator.handleHookPayload({ source: 'claude', event: 'Notification', terminalId: 'term-claude' })
    await Promise.resolve()

    expect(attentionPayloads).toHaveLength(1)
    expect(events.at(-1)).toMatchObject({ type: 'attention', delivered: true })
  })

  it('keeps janus ask-user idle visible without a tracked turn', async () => {
    const { coordinator, attentionPayloads, events } = createCoordinator(() => 1_000)

    coordinator.registerTerminal({
      terminalId: 'term-janus',
      engine: 'janus',
      workspaceId: 'workspace-1',
      cwd: 'C:/repo',
    })
    coordinator.handleHookPayload({
      source: 'janus',
      event: 'Notification',
      terminalId: 'term-janus',
      raw: { hook: 'ask-user', matcher: 'idle_prompt' },
    })
    await Promise.resolve()

    expect(attentionPayloads).toHaveLength(1)
    expect(events.at(-1)).toMatchObject({ type: 'attention', delivered: true })
  })

  it('toasts top-level matcher Notifications whose raw lacks the matcher (real hook client shape)', async () => {
    const { coordinator, attentionPayloads, events } = createCoordinator(() => 1_000)

    coordinator.registerTerminal({
      terminalId: 'term-pi',
      engine: 'pi',
      workspaceId: 'workspace-1',
      cwd: 'C:/repo',
    })
    // Real hook clients (posix argv --matcher / Windows -Matcher) forward the
    // matcher as a top-level payload field; raw is the untouched CLI stdin.
    coordinator.handleHookPayload({
      source: 'pi',
      event: 'Notification',
      terminalId: 'term-pi',
      matcher: 'idle_prompt',
      raw: { hook: 'ui_prompt_start', kind: 'select' },
    })
    await Promise.resolve()

    expect(attentionPayloads).toHaveLength(1)
    expect(events.at(-1)).toMatchObject({ type: 'attention', delivered: true })
  })

  it('toasts matcher-less codex Notifications as needs-input instead of dropping them', async () => {
    const { coordinator, attentionPayloads, events } = createCoordinator(() => 1_000)

    coordinator.registerTerminal(codexTerminal)
    coordinator.handleHookPayload({
      source: 'codex',
      event: 'Notification',
      terminalId: 'term-1',
      raw: { hook: 'ask-user' },
    })
    await Promise.resolve()

    expect(attentionPayloads).toHaveLength(1)
    expect(events.at(-1)).toMatchObject({ type: 'attention', delivered: true })
  })

  it('emits approval for top-level permission_prompt so sidebar and toast stay aligned', async () => {
    const { coordinator, attentionPayloads, events } = createCoordinator(() => 1_000)

    coordinator.registerTerminal({
      terminalId: 'term-pi',
      engine: 'pi',
      workspaceId: 'workspace-1',
      cwd: 'C:/repo',
    })
    coordinator.handleHookPayload({
      source: 'pi',
      event: 'Notification',
      terminalId: 'term-pi',
      matcher: 'permission_prompt',
      raw: { hook: 'ui_prompt_start', kind: 'confirm' },
    })
    await Promise.resolve()

    expect(attentionPayloads).toHaveLength(1)
    expect(events.at(-1)).toMatchObject({ type: 'approval', delivered: true })
  })

  it('notifies turn lifecycle callbacks with transcript binding info', () => {
    const started: unknown[] = []
    const ended: string[] = []
    const coordinator = new AgentHookCoordinator(() => null, {
      now: () => 1_000,
      deliverCompletion: () => true,
      deliverAttention: () => true,
      onTurnStarted: (turn) => started.push(turn),
      onTurnEnded: (terminalId) => ended.push(terminalId),
    })

    coordinator.registerTerminal(claudeTerminal)
    coordinator.handleHookPayload({
      source: 'claude',
      event: 'UserPromptSubmit',
      terminalId: 'term-claude',
      sessionId: 'session-1',
      raw: { transcript_path: 'C:/transcripts/session-1.jsonl' },
    })
    expect(started).toEqual([
      {
        terminalId: 'term-claude',
        engine: 'claude',
        source: 'claude',
        sessionId: 'session-1',
        transcriptPath: 'C:/transcripts/session-1.jsonl',
      },
    ])

    coordinator.handleHookPayload({ source: 'claude', event: 'Stop', terminalId: 'term-claude' })
    expect(ended).toEqual(['term-claude'])

    // Unregister with an open turn must also release the sentinel binding.
    coordinator.handleHookPayload({
      source: 'claude',
      event: 'UserPromptSubmit',
      terminalId: 'term-claude',
    })
    coordinator.unregisterTerminal('term-claude')
    expect(ended).toEqual(['term-claude', 'term-claude'])
    expect(coordinator.hasActiveTurn('term-claude')).toBe(false)
  })
})


describe('P3 accepted lifecycle boundaries', () => {
  it('normalizes approval, input, success and session close through one callback', async () => {
    const { CompanionSessionState } = await import('../../src/main/companion/session-state')
    const state = new CompanionSessionState()
    state.registerTerminal({ ...codexTerminal, workspaceId: 'workspace-1', cwd: 'C:/repo' })
    const accepted: unknown[] = []
    const started = vi.fn(), completed = vi.fn()
    const coordinator = new AgentHookCoordinator(() => null, {
      deliverCompletion: completed, deliverAttention: () => true, onTurnStarted: started,
      onResolvedPayload: (payload, terminal, semantic) => {
        accepted.push(semantic)
        state.handleLifecycle(terminal.terminalId, semantic)
      },
    })
    coordinator.registerTerminal(codexTerminal)
    const send = (event: string, matcher?: string) => coordinator.handleHookPayload({ source: 'codex', event, matcher, terminalId: 'term-1', sessionId: 's' })
    send('SessionStart')
    expect(coordinator.hasActiveTurn('term-1')).toBe(false)
    send('UserPromptSubmit'); send('UserPromptSubmit')
    send('Notification', 'permission_prompt')
    expect(state.hasPendingApproval('term-1')).toBe(true)
    send('UserPromptSubmit') // resumes the existing wait
    expect(started).toHaveBeenCalledTimes(1)
    expect(state.hasPendingApproval('term-1')).toBe(false)
    send('Notification', 'idle_prompt')
    expect(state.hasPendingApproval('term-1')).toBe(false)
    send('Stop'); send('Stop'); send('SessionEnd')
    expect(completed).toHaveBeenCalledTimes(1)
    expect(accepted).toEqual([{ type: 'session-update' }, { type: 'turn-start' },
      { type: 'waiting-user', kind: 'approval' }, { type: 'turn-start', resume: true },
      { type: 'waiting-user', kind: 'input' }, { type: 'turn-end', kind: 'done' }, { type: 'session-close' }])
  })

  it('does not let another session replace an active turn or use a mismatched workspace fallback', () => {
    const accepted = vi.fn(), ended = vi.fn()
    const coordinator = new AgentHookCoordinator(() => null, { onResolvedPayload: accepted, onTurnEnded: ended, deliverCompletion: () => true })
    coordinator.registerTerminal(codexTerminal)
    coordinator.handleHookPayload({ source: 'codex', event: 'UserPromptSubmit', terminalId: 'term-1', sessionId: 'active' })
    coordinator.handleHookPayload({ source: 'codex', event: 'UserPromptSubmit', terminalId: 'term-1', sessionId: 'other' })
    coordinator.handleHookPayload({ source: 'codex', event: 'SessionStart', terminalId: 'term-1', sessionId: 'other' })
    coordinator.handleHookPayload({ source: 'codex', event: 'Stop', workspaceId: 'other-workspace', sessionId: 'active' })
    expect(accepted).toHaveBeenCalledTimes(1)
    expect(coordinator.hasActiveTurn('term-1')).toBe(true)
    coordinator.handleHookPayload({ source: 'codex', event: 'Stop', terminalId: 'term-1', sessionId: 'active' })
    expect(ended).toHaveBeenCalledTimes(1)
  })

  it('rejects stale IDs, engine mismatch and old session ends after a new session starts', () => {
    const { coordinator, resolvedPayloads, completions } = createCoordinator(() => Date.now())
    coordinator.registerTerminal(codexTerminal)
    const send = (payload: Partial<AgentHookPayload>) => coordinator.handleHookPayload({ source: 'codex', event: 'UserPromptSubmit', terminalId: 'term-1', ...payload })
    send({ terminalId: 'dead-id' }); send({ source: 'claude' })
    expect(resolvedPayloads).toHaveLength(0)
    send({ sessionId: 'new', timestamp: '2026-10-29T10:00:01Z' })
    send({ event: 'Stop', sessionId: 'old', timestamp: '2026-10-29T10:00:02Z' })
    send({ event: 'Stop', sessionId: 'new', timestamp: '2026-10-29T10:00:00Z' })
    expect(coordinator.hasActiveTurn('term-1')).toBe(true)
    expect(completions).toHaveLength(0)
    send({ event: 'Interrupt', sessionId: 'new', timestamp: '2026-10-29T10:00:03Z' })
    expect(completions[0].kind).toBe('interrupted')
  })
})
