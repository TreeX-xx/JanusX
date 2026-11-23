import { it, expect, vi } from 'vitest'
import { realpath, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ClaudeConversation } from '../../src/main/terminal/claude-conversation'
import { conversationOutbox, enqueueConversationMessage, observeConversationOutbox } from '../../src/renderer/src/stores/conversation-outbox'
import { claudeConversationFixture } from '../helpers/claude-conversation-fixture'

const binary = process.env.JANUSX_TEST_CLAUDE_BIN
it.skipIf(process.platform !== 'darwin' || !binary)('sends a Mac dialog turn and retains the session across view switches', async () => {
  const fixture = await claudeConversationFixture()
  const cwd = await realpath(fixture.cwd)
  const session = new ClaudeConversation('mac-dialog', () => {})
  try {
    await writeFile(join(fixture.config, '.claude.json'), JSON.stringify({ hasCompletedOnboarding: true,
      customApiKeyResponses: { approved: ['local-fixture-only'], rejected: [] },
      projects: {} }))
    const starting = session.start({ command: binary!, args: ['--model', 'claude-sonnet-4-6', '--tools', ''],
      cwd, env: fixture.env, assetsDir: join(fixture.root, 'assets') })
    void starting.catch(() => {})
    await expect.poll(() => session.state.startup?.kind, { timeout: 15000 }).toBe('trust')
    expect(session.state.mode).toBe('conversation')
    await session.command({ type: 'startup', action: 'trust', startupId: session.state.startup!.id, controlEpoch: session.state.controlEpoch })
    const launch = await starting
    expect(session.state.mode).toBe('terminal')
    await session.command({ type: 'mode', mode: 'conversation' })
    expect(launch.args[0]).toBe('attach')
    const thread = session.state.threadId
    expect(thread).toBeTruthy()
    await session.command({ type: 'send', text: 'CC_STREAM', commandId: 'mac-dialog-turn', controlEpoch: session.state.controlEpoch })
    await expect.poll(() => session.state.items.some(item => item.type === 'agentMessage' && item.text?.includes('final')), { timeout: 20000 }).toBe(true)
    await session.command({ type: 'mode', mode: 'terminal' })
    await session.command({ type: 'mode', mode: 'conversation' })
    expect(session.state.threadId).toBe(thread)
  } finally {
    try { await session.dispose() } finally { await fixture.close() }
  }
}, 70000)

it.skipIf(process.platform !== 'darwin' || !binary)('delivers rapid dialog input and clears a missed completion in the same native Mac Claude session', async () => {
  const fixture = await claudeConversationFixture()
  const cwd = await realpath(fixture.cwd)
  const id = 'mac-dialog-burst'
  const session = new ClaudeConversation(id, observeConversationOutbox)
  const wire = session as unknown as { receive(event: { type: string; seq?: number; data: { turnId?: string } }): void }
  const receive = wire.receive.bind(session)
  let missedTurn: string | undefined
  vi.spyOn(wire, 'receive').mockImplementation(event => {
    if (!missedTurn && event.type === 'turn.complete' && event.seq && session.state.items.some(item => item.type === 'userMessage' &&
      item.turnId === event.data.turnId && item.text === 'CC_BURST_THIRD')) {
      missedTurn = event.data.turnId
      return
    }
    receive(event)
  })
  vi.stubGlobal('window', { electron: { terminal: { conversationCommand: (_id: string, command: Parameters<typeof session.command>[0]) => session.command(command) } } })
  try {
    await writeFile(join(fixture.config, '.claude.json'), JSON.stringify({ hasCompletedOnboarding: true,
      customApiKeyResponses: { approved: ['local-fixture-only'], rejected: [] },
      projects: { [cwd]: { hasTrustDialogAccepted: true } } }))
    await session.command({ type: 'mode', mode: 'conversation' })
    await session.start({ command: binary!, args: ['--model', 'claude-sonnet-4-6', '--tools', ''],
      cwd, env: fixture.env, assetsDir: join(fixture.root, 'assets') })
    const { threadId, controlEpoch } = session.snapshot()
    const messages = ['CC_CANCEL', 'CC_BURST_SECOND', 'CC_BURST_THIRD']
    for (const message of messages) expect(enqueueConversationMessage(session.snapshot(), message)).toBe(true)
    await expect.poll(() => ({
      threadId: session.state.threadId, controlEpoch: session.state.controlEpoch, connection: session.state.connection,
      error: session.state.error, outbox: conversationOutbox(id).map(item => [item.text, item.status, item.error]),
      messages: session.state.items.filter(item => item.type === 'userMessage').map(item => item.text),
    }), { timeout: 25000 }).toEqual({ threadId, controlEpoch, connection: 'ready', error: undefined, outbox: [], messages })
    await expect.poll(() => missedTurn, { timeout: 15000 }).toBeTruthy()
    expect(session.state.turnId).toBe(missedTurn)
    await expect(session.command({ type: 'interrupt', controlEpoch })).resolves.toMatchObject({ threadId, controlEpoch, connection: 'ready', turnId: null })
    await session.command({ type: 'send', text: 'CC_BURST_RECOVERED', commandId: 'after-stale-turn', controlEpoch })
    await expect.poll(() => session.state.items.some(item => item.text === 'First CC_BURST_RECOVERED final'), { timeout: 15000 }).toBe(true)
  } finally {
    try { await session.dispose() } finally { vi.unstubAllGlobals(); await fixture.close() }
  }
}, 50000)
