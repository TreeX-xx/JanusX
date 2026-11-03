import { describe, it, expect, vi } from 'vitest'
import { CodexConversation } from '../../src/main/terminal/codex-conversation'
import { ClaudeConversation } from '../../src/main/terminal/claude-conversation'
import { OpenCodeConversation } from '../../src/main/terminal/opencode-conversation'
import { PiConversation } from '../../src/main/terminal/extension-conversation'
import { parseConversationSlashCommand, type ConversationCommand } from '../../src/shared/conversation-display'

const factories = {
  codex: () => new CodexConversation('test', () => {}),
  claude: () => new ClaudeConversation('test', () => {}),
  opencode: () => new OpenCodeConversation('test', () => {}),
  pi: () => new PiConversation('test', () => {}),
}
describe('shared conversation controls', () => {
  for (const [engine, factory] of Object.entries(factories)) {
    it(`${engine}: revokes queued dispatch immediately when disposed`, async () => {
      const c = factory(), wire = c as any
      c.state.connection = 'ready'; c.state.threadId = 'native'
      const dispatch = vi.spyOn(wire, engine === 'codex' ? 'call' : engine === 'claude' ? 'reply' : 'deliver').mockResolvedValue({ ok: true })
      const { controlEpoch } = await c.command({ type: 'mode', mode: 'conversation' })
      const pending = c.command({ type: 'send', text: 'must not dispatch', commandId: 'closing', controlEpoch })
      const rejected = expect(pending).rejects.toThrow(/unavailable/)
      await c.dispose()
      await rejected
      expect(dispatch).not.toHaveBeenCalled()
    })
    it(`${engine}: rejects busy view switches, stale controls, over-budget input and closed control`, async () => {
      const c = factory()
      c.state.connection = 'ready'; c.state.threadId = 'native'
      await c.command({ type: 'mode', mode: 'conversation' })
      const epoch = c.state.controlEpoch
      try {
        c.state.submitting = true
        await expect(c.command({ type: 'mode', mode: 'terminal' })).rejects.toThrow(/Wait/)
        expect(c.state.controlEpoch).toBe(epoch)
        c.state.submitting = false
        await expect(c.command({ type: 'send', text: 'x'.repeat(32001), commandId: 'long', controlEpoch: epoch })).rejects.toThrow(/length/)
        await expect(c.command({ type: 'commands', controlEpoch: epoch - 1 })).rejects.toThrow(/control/)
        await expect(c.command({ type: 'send', text: '/skill:review', commandId: 'raw', controlEpoch: epoch })).rejects.toThrow(/slash/)
      } finally { await c.dispose() }
      await expect(c.command({ type: 'mode', mode: 'conversation' })).rejects.toThrow(/closed/)
    })
  }
})

describe('provider command intents and acceptance receipts', () => {
  it.each(['codex', 'opencode', 'pi'] as const)('%s dispatches native identities, deduplicates and confirms acceptance without a text echo', async engine => {
    const c = factories[engine]()
    const wire = c as any
    c.state.connection = 'ready'; c.state.threadId = 'native'
    const call = engine === 'codex' ? vi.spyOn(wire, 'call').mockImplementation(async (method: string) => method === 'skills/list'
      ? { data: [{ skills: [{ name: 'review', path: '/trusted/SKILL.md', enabled: true, description: 'Inspect' }] }] } : {})
      : engine === 'opencode' ? vi.spyOn(wire, 'api').mockImplementation(async (path: string) => path.startsWith('/api/command?')
        ? { data: [{ name: 'team/review', description: 'Inspect' }] } : path.startsWith('/api/skill?') ? { data: [{ id: 'native-id', name: 'Friendly skill' }] } : {})
        : vi.spyOn(wire, 'request').mockImplementation(async (command: any) => command.type === 'catalog'
          ? [{ name: 'skill:review', source: 'skill', sourceInfo: { scope: 'project' } }] : undefined)
    try {
      const { controlEpoch } = await c.command({ type: 'mode', mode: 'conversation' })
      await c.command({ type: 'commands', controlEpoch })
      const entry = c.state.commands![0]
      expect(entry.execution).toBe('native')
      expect(entry).not.toHaveProperty('invoke')
      const invoke: ConversationCommand = { type: 'invoke', entryId: entry.id, catalogRevision: c.state.commandsRevision!, arguments: 'ARG', commandId: 'one', controlEpoch }
      await c.command(invoke); await c.command(invoke)
      expect(c.state.commandReceipts).toEqual([{ id: 'one', status: 'accepted' }])
      expect(c.state.items).toEqual([])
      if (engine === 'codex') expect(call).toHaveBeenCalledWith('turn/start', { threadId: 'native', input: [
        { type: 'text', text: '$review ARG', text_elements: [] }, { type: 'skill', name: 'review', path: '/trusted/SKILL.md' },
      ] })
      else if (engine === 'opencode') {
        expect(call).toHaveBeenCalledWith('/api/session/native/command', { name: 'team/review', text: 'ARG' })
        await c.command({ ...invoke, entryId: c.state.commands![1].id, commandId: 'skill' })
        expect(call).toHaveBeenCalledWith('/api/session/native/prompt', { text: 'ARG', skills: [{ id: 'native-id' }] })
      } else expect(call).toHaveBeenCalledWith(expect.objectContaining({ type: 'invoke', name: 'skill:review', source: 'skill', arguments: 'ARG', sessionId: 'native' }))
      await expect(c.command({ ...invoke, arguments: 'different' })).rejects.toThrow(/reused/)
      await c.command({ type: 'commands', controlEpoch })
      await expect(c.command({ ...invoke, commandId: 'stale' })).rejects.toThrow(/catalog changed/)
      const failing = { ...invoke, commandId: 'unknown', catalogRevision: c.state.commandsRevision! }
      call.mockRejectedValue(new Error('transport timeout'))
      await expect(c.command(failing)).rejects.toThrow(/timeout/)
      const count = call.mock.calls.length
      await expect(c.command(failing)).rejects.toThrow(/timeout/)
      expect(call.mock.calls).toHaveLength(count)
      expect(c.state.commandReceipts?.at(-1)).toEqual({ id: 'unknown', status: 'unknown' })
    } finally { await c.dispose() }
  })
  it('Claude exposes SDK commands as terminal-only and never routes a skill through daemon reply', async () => {
    const c = factories.claude(), wire = c as any
    c.state.connection = 'ready'; c.state.threadId = 'native'
    wire.nativeCommands = [{ id: 'command:review', name: 'review', label: 'review', description: 'Inspect', kind: 'command', source: 'claude', execution: 'terminal' }]
    vi.spyOn(wire, 'loadModels').mockResolvedValue(undefined)
    const reply = vi.spyOn(wire, 'reply')
    try {
      const { controlEpoch } = await c.command({ type: 'mode', mode: 'conversation' })
      await c.command({ type: 'commands', controlEpoch })
      await expect(c.command({ type: 'invoke', entryId: 'command:review', catalogRevision: c.state.commandsRevision!, arguments: '', commandId: 'blocked', controlEpoch })).rejects.toThrow(/terminal/)
      expect(reply).not.toHaveBeenCalled()
    } finally { await c.dispose() }
  })
  it('recognizes namespaced and known nested commands while retaining absolute paths', () => {
    expect(parseConversationSlashCommand('/skill:review ARG')).toEqual({ name: 'skill:review', query: 'ARG' })
    expect(parseConversationSlashCommand('/tmp/file')).toBeNull()
    expect(parseConversationSlashCommand('/team/rev', [{ name: 'team/review' } as any])).toEqual({ name: 'team/rev', query: '' })
    expect(parseConversationSlashCommand('/team/', [{ name: 'team/review' } as any])).toEqual({ name: 'team/', query: '' })
  })
})
