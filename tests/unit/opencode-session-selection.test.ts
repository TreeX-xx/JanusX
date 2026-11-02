import { expect, it, vi } from 'vitest'
import { OpenCodeConversation } from '../../src/main/terminal/opencode-conversation'

function fixture() {
  const bind = vi.fn()
  const c = new OpenCodeConversation('test', vi.fn(), bind)
  const wire = c as any
  wire.directory = process.cwd()
  wire.receive({ type: 'session', sessionId: 'old' })
  wire.nativeSelectionRevision = 1
  wire.api = vi.fn(async () => ({ data: { id: 'new', location: { directory: process.cwd() }, model: { providerID: 'fixture', id: 'model' } } }))
  return { c, wire, bind }
}

it('rebinds confirmed selection, clears the old transcript and invalidates old control', async () => {
  const { c, wire, bind } = fixture()
  try {
    wire.receive({ type: 'start', turnId: 'old-turn' })
    wire.receive({ type: 'item', item: { id: 'old-message', turnId: 'old-turn', type: 'userMessage', text: 'old', status: 'completed' } })
    const epoch = c.state.controlEpoch
    await wire.confirmNativeSelection('new', 1)
    expect(c.state).toMatchObject({ connection: 'ready', threadId: 'new', turnId: null, items: [], model: 'fixture/model', controlEpoch: epoch + 1 })
    expect(bind).toHaveBeenLastCalledWith('new', undefined)
    await c.command({ type: 'mode', mode: 'conversation' })
    await expect(c.command({ type: 'send', commandId: 'stale', text: 'stale', controlEpoch: epoch })).rejects.toThrow('Stale')
  } finally { await c.dispose() }
})

it('same-session selection preserves history and does not rebind', async () => {
  const { c, wire, bind } = fixture()
  try {
    wire.api.mockResolvedValue({ data: { id: 'old' } })
    c.state.items.push({ id: 'keep', turnId: 'turn', type: 'userMessage', text: 'keep', status: 'completed' })
    await wire.confirmNativeSelection('old', 1)
    expect(c.state.items).toHaveLength(1)
    expect(bind).toHaveBeenCalledTimes(1)
  } finally { await c.dispose() }
})

it('an uncertain selection is recoverable and blocks dialog control until confirmed', async () => {
  const { c, wire } = fixture()
  try {
    wire.pauseNativeSelection('try selection again')
    expect(c.state).toMatchObject({ connection: 'ready', needsTerminal: true })
    await expect(c.command({ type: 'mode', mode: 'conversation' })).rejects.toThrow('selecting a session')
    await wire.confirmNativeSelection('new', ++wire.nativeSelectionRevision)
    expect(c.state).toMatchObject({ threadId: 'new', error: undefined, needsTerminal: false })
    await expect(c.command({ type: 'mode', mode: 'conversation' })).resolves.toMatchObject({ connection: 'ready' })
  } finally { await c.dispose() }
})

it('ignores stale readback and rejects identity/workspace mismatches', async () => {
  const { c, wire } = fixture()
  try {
    wire.nativeSelectionRevision = 2
    await wire.confirmNativeSelection('new', 1)
    expect(c.state).toMatchObject({ threadId: 'old', needsTerminal: true })
    wire.api.mockResolvedValue({ data: { id: 'wrong' } })
    await expect(wire.confirmNativeSelection('new', ++wire.nativeSelectionRevision)).rejects.toThrow('did not match')
    wire.api.mockResolvedValue({ data: { id: 'new', location: { directory: process.cwd() + '/other' } } })
    await expect(wire.confirmNativeSelection('new', ++wire.nativeSelectionRevision)).rejects.toThrow('different workspace')
    expect(c.state.threadId).toBe('old')
  } finally { await c.dispose() }
})

it('does not revive a selection after its response was lost', async () => {
  const { c, wire } = fixture()
  try {
    let release!: (value: unknown) => void
    wire.api.mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
    const confirming = wire.confirmNativeSelection('new', 1)
    wire.pauseNativeSelection('response lost')
    release({ data: { id: 'new' } })
    await confirming
    expect(c.state).toMatchObject({ connection: 'ready', threadId: 'old', needsTerminal: true })
    await wire.confirmNativeSelection('new', ++wire.nativeSelectionRevision)
    expect(c.state).toMatchObject({ threadId: 'new', needsTerminal: false })
  } finally { await c.dispose() }
})

it.each(['messages', 'failure'])('discards a stale poll %s after the native session changes', async outcome => {
  const { c, wire } = fixture()
  let release!: () => void
  wire.api.mockImplementation((path: string) => {
    if (path.includes('/old/message')) return new Promise((resolve, reject) => {
      release = () => outcome === 'failure' ? reject(new Error('old session unavailable')) : resolve({ data: [
        { id: 'stale', type: 'user', text: 'old history', time: { created: 1 } },
      ] })
    })
    if (path === '/api/session/new' || path === '/api/session/old') return Promise.resolve({ data: { id: path.split('/').at(-1) } })
    return Promise.resolve({ data: [] })
  })
  try {
    wire.polling = wire.poll()
    await expect.poll(() => typeof release).toBe('function')
    await wire.confirmNativeSelection('new', 1)
    release()
    await expect.poll(() => wire.api.mock.calls.some(([path]: [string]) => path.includes('/new/form'))).toBe(true)
    expect(c.state).toMatchObject({ connection: 'ready', threadId: 'new', items: [], needsTerminal: false })
  } finally { release?.(); await c.dispose() }
})
