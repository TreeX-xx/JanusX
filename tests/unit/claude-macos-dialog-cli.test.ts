import { it, expect } from 'vitest'
import { realpath, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ClaudeConversation } from '../../src/main/terminal/claude-conversation'
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
