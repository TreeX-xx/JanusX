import { describe, it, expect, vi } from 'vitest'
import { CodexConversation } from '../../src/main/terminal/codex-conversation'
import { ConversationCatalog } from '../../src/main/terminal/conversation-catalog'
import { ConversationSession, conversationState } from '../../src/main/terminal/conversation-session'
import { PiConversation, DshConversation } from '../../src/main/terminal/extension-conversation'

function codex() {
  const c = new CodexConversation('test', () => {})
  const wire = c as any
  wire.attach({ id: 'old', turns: [] })
  const input = vi.fn()
  c.setNativeInput(input)
  return { c, wire, input }
}

describe('Codex new conversation recovery', () => {
  it('hands an unconfirmed new conversation to the terminal without disconnecting or replaying', async () => {
    vi.useFakeTimers()
    const { c, input } = codex()
    try {
      const { controlEpoch } = await c.command({ type: 'mode', mode: 'conversation' })
      const result = c.command({ type: 'new', controlEpoch }).catch(error => error)
      await vi.advanceTimersByTimeAsync(15000)
      expect(await result).toMatchObject({ message: expect.stringContaining('could not be confirmed') })
      expect(c.state).toMatchObject({ connection: 'ready', mode: 'terminal', threadId: 'old', submitting: false })
      expect(input).toHaveBeenCalledTimes(2)
      await expect(c.command({ type: 'new', controlEpoch })).rejects.toThrow(/control/)
      const next = await c.command({ type: 'mode', mode: 'conversation' })
      expect(next.connection).toBe('ready')
    } finally { await c.dispose(); vi.useRealTimers() }
  })
  it('allows early terminal inspection and cancels the scheduled hidden Enter', async () => {
    vi.useFakeTimers()
    const { c, input } = codex()
    try {
      const { controlEpoch } = await c.command({ type: 'mode', mode: 'conversation' })
      const result = c.command({ type: 'new', controlEpoch }).catch(error => error)
      await c.command({ type: 'mode', mode: 'terminal' })
      expect(await result).toMatchObject({ message: expect.stringContaining('native terminal') })
      await vi.advanceTimersByTimeAsync(16000)
      expect(input).toHaveBeenCalledTimes(1)
      expect(c.state).toMatchObject({ mode: 'terminal', connection: 'ready', submitting: false })
    } finally { await c.dispose(); vi.useRealTimers() }
  })
  it('preserves real transport failure and clears catalog identity when a new thread attaches', async () => {
    const { c, wire } = codex()
    try {
      c.state.commands = []; c.state.commandsRevision = 5
      wire.attach({ id: 'next', turns: [] })
      expect(c.state.commands).toBeUndefined()
      expect(c.state.commandsRevision).toBe(6)
      const { controlEpoch } = await c.command({ type: 'mode', mode: 'conversation' })
      const result = c.command({ type: 'new', controlEpoch }).catch(error => error)
      wire.fail('Socket closed')
      await result
      expect(c.state).toMatchObject({ connection: 'disconnected', error: 'Socket closed', submitting: false })
    } finally { await c.dispose() }
  })
})

describe('command catalog lifecycle', () => {
  it.each([PiConversation, DshConversation])('%s keeps a catalog timeout local to the read', async Provider => {
    vi.useFakeTimers()
    const c = new Provider('catalog', () => {})
    c.state.connection = 'ready'; c.state.threadId = 'native'
    try {
      const { controlEpoch } = await c.command({ type: 'mode', mode: 'conversation' })
      const read = c.command({ type: 'commands', controlEpoch })
      await vi.advanceTimersByTimeAsync(10000); await read
      expect(c.state.commandsError).toContain('catalog timed out')
      expect(c.state).toMatchObject({ connection: 'ready', commandsLoading: false })
      expect(c.state.error).toBeUndefined()
    } finally { await c.dispose(); vi.useRealTimers() }
  })
  function setup() {
    const state = conversationState('test', 'codex')
    state.threadId = 'old'; state.connection = 'ready'
    const session = new ConversationSession(state, () => {})
    return { state, session }
  }
  it('ignores old-thread completion and permits the new thread to load independently', async () => {
    const { state, session } = setup()
    let release!: (rows: any[]) => void
    const load = vi.fn().mockImplementationOnce(() => new Promise(resolve => { release = resolve })).mockResolvedValue([])
    const catalog = new ConversationCatalog(session, load)
    const old = catalog.command({ type: 'commands', controlEpoch: 0 })
    await Promise.resolve()
    session.resetThread(); state.threadId = 'new'
    await catalog.command({ type: 'commands', controlEpoch: 1 })
    release([{ id: 'stale', name: 'stale', execution: 'native' }])
    await old
    expect(state.commands).toEqual([])
    expect(state.commandsLoading).toBe(false)
    expect(state.commandsError).toBeUndefined()
    expect(load).toHaveBeenCalledTimes(2)
    session.stop()
  })
  it('bounds a stalled catalog without disconnecting and ignores its late result', async () => {
    vi.useFakeTimers()
    const { state, session } = setup()
    let release!: (rows: any[]) => void
    const catalog = new ConversationCatalog(session, () => new Promise(resolve => { release = resolve }))
    try {
      const read = catalog.command({ type: 'commands', controlEpoch: 0 })
      await vi.advanceTimersByTimeAsync(15000)
      await read
      expect(state.commandsLoading).toBe(false)
      expect(state.commandsError).toContain('timed out')
      expect(state.connection).toBe('ready')
      release([{ id: 'late', name: 'late', execution: 'native' }]); await Promise.resolve()
      expect(state.commands).toBeUndefined()
    } finally { session.stop(); vi.useRealTimers() }
  })
  it('rejects an old catalog entry after thread reset even with the current revision', async () => {
    const { state, session } = setup()
    state.mode = 'conversation'
    const invoke = vi.fn()
    const catalog = new ConversationCatalog(session, async () => [{ id: 'old', name: 'old', label: 'old', description: '', kind: 'skill', source: 'test', execution: 'native', invoke }])
    await catalog.command({ type: 'commands', controlEpoch: 0 })
    session.resetThread(); state.threadId = 'new'
    await expect(catalog.command({ type: 'invoke', entryId: 'old', catalogRevision: state.commandsRevision!, arguments: '', commandId: 'stale', controlEpoch: state.controlEpoch })).rejects.toThrow('catalog changed')
    expect(invoke).not.toHaveBeenCalled()
    session.stop()
  })
})
