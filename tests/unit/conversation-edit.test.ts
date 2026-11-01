import { describe, expect, it, vi } from 'vitest'
import { CodexConversation } from '../../src/main/terminal/codex-conversation'
import { OpenCodeConversation } from '../../src/main/terminal/opencode-conversation'

for (const engine of ['codex', 'opencode'] as const) describe(`${engine} edit controls`, () => {
  async function setup() {
    const c = engine === 'codex' ? new CodexConversation('test', vi.fn()) : new OpenCodeConversation('test', vi.fn())
    const wire = c as any
    Object.assign(c.state, { connection: 'ready', threadId: 'thread', items: ['keep', 'old', 'later'].flatMap(text => [
      { id: text, turnId: text, type: 'userMessage', text, status: 'completed' },
      { id: `${text}-answer`, turnId: text, type: 'agentMessage', text: `answer ${text}`, status: 'completed' },
    ]), plans: [{ turnId: 'old', version: 1, steps: [], explanation: '', outcome: 'completed' }] })
    const mutations: string[] = []
    wire.call = vi.fn(async (method: string) => { mutations.push(method); return method === 'thread/revert' ? { thread: { id: 'thread' } } : { turn: { id: 'edited' } } })
    wire.api = vi.fn(async (path: string) => { mutations.push(path); return path.includes('/message?') ? { data: [{ id: 'keep' }] } : {} })
    wire.deliver = vi.fn(async () => { mutations.push('prompt') })
    await c.command({ type: 'mode', mode: 'conversation' })
    const command = { type: 'edit' as const, itemId: 'old', text: 'edited', commandId: 'once', controlEpoch: c.state.controlEpoch }
    return { c, wire, command, mutations }
  }

  it('replaces the suffix before sending and deduplicates repeated submissions', async () => {
    const { c, wire, command, mutations } = await setup()
    try {
      await c.command(command); await c.command(command)
      expect(c.state.items.map(i => i.id)).toEqual(['keep', 'keep-answer'])
      expect(mutations).toEqual(engine === 'codex' ? ['thread/revert', 'turn/start'] : [
        '/api/session/thread/revert/stage', '/api/session/thread/revert/commit', '/api/session/thread/message?limit=200&order=desc', 'prompt',
      ])
      if (engine === 'opencode') expect(wire.api).toHaveBeenCalledWith('/api/session/thread/revert/stage', { messageID: 'old', files: false })
      else { expect(wire.call).toHaveBeenCalledWith('thread/revert', { threadId: 'thread', beforeTurnId: 'old' }); expect(c.state.plans).toEqual([]) }
      await expect(c.command({ ...command, text: 'reused identity' })).rejects.toThrow('Command ID reused')
    } finally { await c.dispose() }
  })

  it('rejects stale, active, truncated and non-text edits without changing history', async () => {
    const { c, command, mutations } = await setup()
    try {
      await expect(c.command({ ...command, controlEpoch: -1 })).rejects.toThrow()
      c.state.turnId = 'running'
      await expect(c.command(command)).rejects.toThrow('busy')
      c.state.turnId = null
      c.state.items[2].truncated = true
      await expect(c.command(command)).rejects.toThrow('safely')
      c.state.items[2].truncated = false; c.state.items[2].editable = false
      await expect(c.command(command)).rejects.toThrow('safely')
      expect(mutations).toEqual([])
      expect(c.state.items).toHaveLength(6)
    } finally { await c.dispose() }
  })

  it('locks mode and other submissions during revert; unknown failure never sends or retries', async () => {
    const { c, wire, command, mutations } = await setup()
    let reject!: (error: Error) => void
    const gate = new Promise((_resolve, fail) => { reject = fail })
    if (engine === 'codex') wire.call.mockImplementation(() => gate)
    else wire.api.mockImplementation(() => gate)
    try {
      const pending = c.command(command)
      const failure = expect(pending).rejects.toThrow('unknown outcome')
      await expect(c.command({ type: 'mode', mode: 'terminal' })).rejects.toThrow('delivery')
      await expect(c.command({ type: 'send', text: 'extra', commandId: 'extra', controlEpoch: c.state.controlEpoch })).rejects.toThrow('busy')
      reject(new Error('unknown outcome')); await failure
      expect(c.state.connection).toBe('disconnected')
      expect(c.state.items).toHaveLength(6)
      expect(mutations).toEqual([])
      await expect(c.command(command)).rejects.toThrow()
      expect((engine === 'codex' ? wire.call : wire.api).mock.calls).toHaveLength(1)
    } finally { await c.dispose() }
  })
})
