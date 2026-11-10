import { describe, it, expect, vi } from 'vitest'
import { CodexConversation, codexLoopbackEnv } from '../../src/main/terminal/codex-conversation'
import { parseConversationSlashCommand } from '../../src/shared/conversation-display'
import { EventEmitter } from 'node:events'
import WebSocket, { WebSocketServer } from 'ws'

function setup() {
  const publish = vi.fn()
  const controller = new CodexConversation('test', publish)
  // Exercise the protocol boundary with recorded event shapes, without a provider/process.
  const wire = controller as any
  wire.attach({ id: 'main', turns: [] })
  const emit = (method: string, params: object, id?: number) => wire.receive({ method, params: { threadId: 'main', ...params }, ...(id === undefined ? {} : { id }) })
  return { controller, wire, emit, publish }
}

describe('Codex retry and turn failure lifecycle', () => {
  it('updates one retry status and clears it on model recovery without requiring new input', () => {
    const { controller, emit } = setup()
    emit('turn/started', { turn: { id: 'active' } })
    controller.state.error = 'Answer delivery is unconfirmed'
    emit('error', { turnId: 'active', willRetry: true, error: { message: 'Reconnecting... 1/5' } })
    emit('error', { turnId: 'active', willRetry: true, error: { message: 'Reconnecting... 2/5' } })
    expect(controller.state.retry).toEqual({ turnId: 'active', message: 'Reconnecting... 2/5' })
    expect(controller.state.items).toEqual([])
    emit('item/agentMessage/delta', { turnId: 'active', itemId: 'answer', delta: 'Recovered' })
    expect(controller.state.retry).toBeUndefined()
    expect(controller.state.error).toBe('Answer delivery is unconfirmed')
    expect(controller.state.turnId).toBe('active')
  })
  it('does not treat tool output, empty text, replay or other turns as recovery', () => {
    const { controller, emit } = setup()
    emit('turn/started', { turn: { id: 'active' } })
    const item = { type: 'agentMessage', id: 'old', text: 'Previous output' }
    emit('item/completed', { turnId: 'active', item })
    emit('error', { turnId: 'active', willRetry: true, error: { message: 'Reconnecting... 1/5' } })
    emit('item/completed', { turnId: 'active', item })
    emit('item/completed', { turnId: 'active', item: { type: 'commandExecution', id: 'tool', aggregatedOutput: 'done' } })
    emit('item/agentMessage/delta', { turnId: 'other', itemId: 'other', delta: 'Unrelated' })
    emit('item/agentMessage/delta', { turnId: 'active', itemId: 'empty', delta: '' })
    emit('thread/settings/updated', { threadSettings: { model: 'probe' } })
    expect(controller.state.retry).toBeDefined()
    emit('item/reasoning/summaryTextDelta', { turnId: 'active', itemId: 'reasoning', delta: 'Thinking again' })
    expect(controller.state.retry).toBeUndefined()
  })
  it.each(['completed', 'interrupted'])('clears retry when the turn is %s and ignores late retry events', status => {
    const { controller, emit } = setup()
    emit('turn/started', { turn: { id: 'active' } })
    emit('error', { turnId: 'active', willRetry: true, error: { message: 'Reconnecting... 1/5' } })
    emit('turn/completed', { turn: { id: 'active', status } })
    emit('error', { turnId: 'active', willRetry: true, error: { message: 'Late retry' } })
    expect(controller.state.retry).toBeUndefined()
    expect(controller.state.error).toBeUndefined()
    expect(controller.state.items.some(item => item.type === 'turnError')).toBe(false)
  })
  it('keeps one final error in its own turn and does not contaminate the next turn', () => {
    const { controller, emit } = setup()
    emit('turn/started', { turn: { id: 'failed' } })
    emit('error', { turnId: 'failed', willRetry: true, error: { message: 'Reconnecting... 5/5' } })
    emit('error', { turnId: 'failed', willRetry: false, error: { message: 'Connection failed' } })
    emit('turn/completed', { turn: { id: 'failed', status: 'failed', error: { message: 'Retry limit reached' } } })
    expect(controller.state.retry).toBeUndefined()
    expect(controller.state.error).toBeUndefined()
    expect(controller.state.items).toEqual([expect.objectContaining({ type: 'turnError', turnId: 'failed', text: 'Retry limit reached' })])
    emit('turn/started', { turn: { id: 'next' } })
    emit('error', { turnId: 'failed', willRetry: true, error: { message: 'Late retry' } })
    expect(controller.state.retry).toBeUndefined()
    expect(controller.state.items).toHaveLength(1)
    expect(controller.state.turnId).toBe('next')
  })
  it('preserves the last retry reason when a failed completion has no error payload', () => {
    const { controller, emit } = setup()
    emit('turn/started', { turn: { id: 'failed' } })
    emit('error', { turnId: 'failed', willRetry: true, error: { message: 'Rate limit exceeded' } })
    emit('turn/completed', { turn: { id: 'failed', status: 'failed' } })
    expect(controller.state.items[0]).toMatchObject({ type: 'turnError', text: 'Rate limit exceeded' })
    expect(controller.state.retry).toBeUndefined()
  })
  it('separates host disconnection and clears retry on thread switch', () => {
    const { controller, wire, emit } = setup()
    emit('turn/started', { turn: { id: 'active' } })
    emit('error', { turnId: 'active', willRetry: true, error: { message: 'Reconnecting... 1/5' } })
    wire.fail('Local bridge closed')
    expect(controller.state).toMatchObject({ connection: 'disconnected', error: 'Local bridge closed' })
    expect(controller.state.retry).toBeUndefined()
    wire.attach({ id: 'next', turns: [{ id: 'past', status: 'failed', items: [], error: { message: 'Past failure' } }] })
    expect(controller.state.error).toBeUndefined()
    expect(controller.state.items[0]).toMatchObject({ type: 'turnError', turnId: 'past', text: 'Past failure' })
  })
})

describe('Codex conversation ownership and event projection', () => {
  it.each(['item/agentMessage/delta', 'item/reasoning/summaryTextDelta', 'item/started', 'item/completed', 'turn/completed'])('clears a retry warning when the same turn recovers through %s', method => {
    const { controller, emit } = setup()
    emit('turn/started', { turn: { id: 't' } })
    emit('error', { turnId: 't', willRetry: true, error: { message: 'Reconnecting... 2/5' } })
    expect(controller.state.retry?.message).toBe('Reconnecting... 2/5')
    emit('thread/settings/updated', { threadSettings: {} })
    emit('item/agentMessage/delta', { threadId: 'child', turnId: 't', itemId: 'm', delta: 'child' })
    emit('item/agentMessage/delta', { turnId: 'old', itemId: 'm', delta: 'old' })
    expect(controller.state.retry?.message).toBe('Reconnecting... 2/5')
    emit(method, { turnId: 't', itemId: 'm', delta: 'resumed', item: { id: 'm', type: 'agentMessage', text: 'resumed' }, turn: { id: 't', status: 'completed' } })
    expect(controller.state.error).toBeUndefined()
    controller.dispose()
  })

  it('preserves terminal failures after a retry and subsequent activity', () => {
    const { controller, emit } = setup()
    emit('turn/started', { turn: { id: 't' } })
    emit('error', { turnId: 't', willRetry: true, error: { message: 'Reconnecting... 2/5' } })
    emit('error', { turnId: 't', willRetry: false, error: { message: 'Retry exhausted' } })
    emit('item/agentMessage/delta', { turnId: 't', itemId: 'm', delta: 'late' })
    expect(controller.state.items.find(item => item.type === 'turnError')?.text).toBe('Retry exhausted')
    emit('turn/completed', { turn: { id: 't', status: 'failed', error: { message: 'Turn failed' } } })
    expect(controller.state.items.find(item => item.type === 'turnError')?.text).toBe('Turn failed')
    controller.dispose()
  })

  it('selects identity only from owned native start/resume responses, ignoring other thread notifications', async () => {
    const server = new WebSocketServer({ host: '127.0.0.1', port: 0 })
    await new Promise<void>(resolve => server.once('listening', resolve))
    const bind = vi.fn()
    const controller = new CodexConversation('identity', () => {}, bind)
    const downstream = Object.assign(new EventEmitter(), { readyState: WebSocket.OPEN, send: vi.fn(), close: vi.fn() })
    server.on('connection', socket => socket.on('message', bytes => {
      const request = JSON.parse(bytes.toString())
      if (request.method === 'thread/start' || request.method === 'thread/resume') {
        socket.send(JSON.stringify({ method: 'thread/started', params: { thread: { id: 'background' } } }))
        socket.send(JSON.stringify({ id: request.id, result: { thread: { id: request.method === 'thread/start' ? 'created' : 'resumed', turns: [] } } }))
      } else socket.send(JSON.stringify({ id: request.id, result: {} }))
    }))
    try {
      const wire = controller as any
      wire.endpoint = `ws://127.0.0.1:${(server.address() as { port: number }).port}`
      wire.connect(downstream)
      downstream.emit('message', Buffer.from(JSON.stringify({ id: 1, method: 'thread/start', params: { cwd: 'C:/repo' } })))
      await vi.waitFor(() => expect(bind).toHaveBeenLastCalledWith('created', undefined))
      downstream.emit('message', Buffer.from(JSON.stringify({ id: 2, method: 'thread/resume', params: { threadId: 'resumed' } })))
      await vi.waitFor(() => expect(bind).toHaveBeenLastCalledWith('resumed', undefined))
      expect(bind).toHaveBeenCalledTimes(2)
    } finally {
      await controller.dispose()
      for (const client of server.clients) client.terminate()
      await new Promise<void>(resolve => server.close(() => resolve()))
    }
  })
  it('starts new sessions at standard speed while preserving resumes and explicit toggles', async () => {
    const server = new WebSocketServer({ host: '127.0.0.1', port: 0 })
    await new Promise<void>(resolve => server.once('listening', resolve))
    const { controller, wire } = setup()
    const downstream = Object.assign(new EventEmitter(), { send: vi.fn(), close: vi.fn(), readyState: WebSocket.OPEN })
    const received: any[] = []
    server.on('connection', socket => socket.on('message', data => received.push(JSON.parse(data.toString()))))
    wire.endpoint = `ws://127.0.0.1:${(server.address() as { port: number }).port}`
    try {
      wire.connect(downstream)
      const messages = [
        { id: 1, method: 'thread/start', params: { serviceTier: 'fast', cwd: 'C:/repo' } },
        { id: 2, method: 'thread/resume', params: { threadId: 'saved', serviceTier: 'fast' } },
        { id: 3, method: 'thread/settings/update', params: { threadId: 'main', serviceTier: 'fast' } },
      ]
      for (const message of messages) downstream.emit('message', Buffer.from(JSON.stringify(message)))
      await vi.waitFor(() => expect(received).toHaveLength(3))
      expect(received[0].params).toEqual({ serviceTier: 'default', cwd: 'C:/repo' })
      expect(received.slice(1)).toEqual(messages.slice(1))
    } finally {
      await controller.dispose()
      for (const client of server.clients) client.terminate()
      await new Promise<void>(resolve => server.close(() => resolve()))
    }
  })
  it('toggles native speed without changing model or effort and only projects confirmed settings', async () => {
    const { controller, wire, emit } = setup()
    const { controlEpoch } = await controller.command({ type: 'mode', mode: 'conversation' })
    const call = vi.spyOn(wire, 'call').mockResolvedValue({ data: [{ model: 'probe', serviceTiers: [{ id: 'fast' }], supportedReasoningEfforts: [] }] })
    await controller.command({ type: 'models', controlEpoch })
    expect(controller.state.models[0].fastTier).toBe('fast')
    await expect(controller.command({ type: 'speed', fast: true, controlEpoch })).rejects.toThrow('unavailable')
    emit('thread/settings/updated', { threadSettings: { model: 'probe', effort: 'high', serviceTier: null } })
    call.mockImplementation(async () => {
      expect(controller.state.settingsUpdating).toBe(true)
      expect(controller.state.serviceTier).toBeNull()
      emit('thread/settings/updated', { threadSettings: { serviceTier: 'fast' } })
      return {}
    })
    await controller.command({ type: 'speed', fast: true, controlEpoch })
    expect(call).toHaveBeenLastCalledWith('thread/settings/update', { threadId: 'main', serviceTier: 'fast' })
    expect(controller.state).toMatchObject({ model: 'probe', effort: 'high', serviceTier: 'fast', settingsUpdating: false })
    call.mockRejectedValue(new Error('Unavailable for account'))
    await expect(controller.command({ type: 'speed', fast: false, controlEpoch })).rejects.toThrow('Unavailable')
    expect(controller.state.serviceTier).toBe('fast')
    call.mockResolvedValue({})
    await controller.command({ type: 'speed', fast: false, controlEpoch })
    expect(call).toHaveBeenLastCalledWith('thread/settings/update', { threadId: 'main', serviceTier: null })
    expect(controller.state.serviceTier).toBe('fast')
    emit('thread/settings/updated', { threadId: 'child', threadSettings: { serviceTier: null } })
    expect(controller.state.serviceTier).toBe('fast')
    emit('thread/settings/updated', { threadSettings: { serviceTier: null, model: 'unsupported' } })
    await expect(controller.command({ type: 'speed', fast: true, controlEpoch })).rejects.toThrow('not supported')
    wire.attach({ id: 'next', turns: [] })
    expect(controller.state.serviceTier).toBeUndefined()
    await controller.dispose()
  })
  it('steers the active turn once, pins its identity and never retries a failed steer as a new turn', async () => {
    const { controller, wire, emit } = setup()
    const { controlEpoch } = await controller.command({ type: 'mode', mode: 'conversation' })
    emit('turn/started', { turn: { id: 'active' } })
    const call = vi.spyOn(wire, 'call').mockResolvedValue({ turnId: 'active' })
    const command = { type: 'send' as const, text: 'Change direction', commandId: 'live', controlEpoch }
    await controller.command(command); await controller.command(command)
    expect(call).toHaveBeenCalledExactlyOnceWith('turn/steer', { threadId: 'main', expectedTurnId: 'active', input: [{ type: 'text', text: 'Change direction', text_elements: [] }] })
    call.mockRejectedValue(new Error('Turn already completed'))
    await expect(controller.command({ ...command, commandId: 'race' })).rejects.toThrow('Turn already completed')
    expect(call.mock.calls.every(([method]) => method === 'turn/steer')).toBe(true)
    await controller.dispose()
  })
  it('preserves explicit assistant phase across completion events', () => {
    const { controller, emit } = setup()
    emit('item/started', { turnId: 'turn', item: { id: 'message', type: 'agentMessage', phase: 'commentary', text: 'Checking' } })
    emit('item/completed', { turnId: 'turn', item: { id: 'message', type: 'agentMessage', text: 'Checked' } })
    expect(controller.state.items[0]).toMatchObject({ phase: 'commentary', text: 'Checked', status: 'completed' })
  })
  it('runs /new through the native client with a single-use start gate and waits for confirmed selection', async () => {
    const { controller, wire } = setup()
    const input = vi.fn()
    controller.setNativeInput(input)
    const { controlEpoch } = await controller.command({ type: 'mode', mode: 'conversation' })
    const pending = controller.command({ type: 'new', controlEpoch })
    expect(controller.state.submitting).toBe(true)
    expect(input).toHaveBeenCalledWith('\x15\x0b/new')
    expect(controller.acceptsTerminalInput('accidental\r')).toBe(false)
    expect(wire.acceptsNativeCommand({ method: 'thread/start', params: {} })).toBe(true)
    expect(wire.acceptsNativeCommand({ method: 'thread/start', params: {} })).toBe(false)
    await expect(controller.command({ type: 'new', controlEpoch })).rejects.toThrow('idle')
    await vi.waitFor(() => expect(input).toHaveBeenCalledWith('\r'))
    expect(controller.state.threadId).toBe('main')
    wire.attach({ id: 'new-thread', turns: [] }); wire.newThread.resolve()
    await pending
    expect(controller.snapshot()).toMatchObject({ threadId: 'new-thread', items: [], submitting: false, mode: 'conversation' })
    await expect(controller.command({ type: 'new', controlEpoch })).rejects.toThrow('control changed')
    await controller.dispose()
  })
  it('forwards a large native plugin catalog intact and keeps the conversation connected', async () => {
    const server = new WebSocketServer({ host: '127.0.0.1', port: 0 })
    await new Promise<void>(resolve => server.once('listening', resolve))
    const { controller, wire } = setup()
    const downstream = Object.assign(new EventEmitter(), { send: vi.fn(), close: vi.fn(), readyState: WebSocket.OPEN })
    wire.endpoint = `ws://127.0.0.1:${(server.address() as { port: number }).port}`
    // Real startup catalogs exceed 25 MiB; these are transport data, not conversation items.
    const catalog = JSON.stringify({ id: 'native-plugin-list', result: { marketplaces: [{
      name: 'large-marketplace', plugins: Array.from({ length: 10_689 }, (_, id) => ({ id: String(id), description: 'x'.repeat(2500) })),
    }] } })
    expect(Buffer.byteLength(catalog)).toBeGreaterThan(25 * 1024 * 1024)
    server.on('connection', socket => {
      socket.send(catalog)
      socket.send(JSON.stringify({ method: 'turn/started', params: { threadId: 'main', turn: { id: 'after-catalog' } } }))
    })
    try {
      wire.connect(downstream)
      await vi.waitFor(() => expect(controller.state.turnId).toBe('after-catalog'), { timeout: 5000 })
      expect(downstream.send.mock.calls[0]?.[0] === catalog).toBe(true)
      expect(downstream.close).not.toHaveBeenCalled()
      expect(controller.state.connection).toBe('ready')
      expect(controller.state.items).toEqual([])
      expect(controller.state.error).toBeUndefined()
    } finally {
      await controller.dispose()
      for (const client of server.clients) client.terminate()
      await new Promise<void>(resolve => server.close(() => resolve()))
    }
  })
  it('preserves the transport error when the socket subsequently closes', async () => {
    const server = new WebSocketServer({ host: '127.0.0.1', port: 0 })
    await new Promise<void>(resolve => server.once('listening', resolve))
    const { controller, wire } = setup()
    const downstream = Object.assign(new EventEmitter(), { send: vi.fn(), close: vi.fn(), readyState: WebSocket.OPEN })
    wire.endpoint = `ws://127.0.0.1:${(server.address() as { port: number }).port}`
    try {
      wire.connect(downstream)
      await vi.waitFor(() => expect(wire.socket.readyState).toBe(WebSocket.OPEN))
      wire.socket.emit('error', new Error('Specific transport failure'))
      wire.socket.close()
      await vi.waitFor(() => expect(downstream.close).toHaveBeenCalled())
      expect(controller.state).toMatchObject({ connection: 'disconnected', error: 'Specific transport failure' })
    } finally {
      await controller.dispose()
      await new Promise<void>(resolve => server.close(() => resolve()))
    }
  })
  it('bypasses loopback on both native processes while preserving user proxies and exclusions', () => {
    const source = { HTTP_PROXY: 'http://proxy.invalid:8080', HTTPS_PROXY: 'http://proxy.invalid:8080', ALL_PROXY: 'socks5://proxy.invalid:1080', NO_PROXY: 'internal.example, 127.0.0.1', no_proxy: 'another.internal,localhost', OTHER: 'keep' }
    const env = codexLoopbackEnv(source)
    expect(env).toMatchObject({ HTTP_PROXY: source.HTTP_PROXY, HTTPS_PROXY: source.HTTPS_PROXY, ALL_PROXY: source.ALL_PROXY, OTHER: 'keep' })
    expect(env.NO_PROXY).toBe('internal.example,127.0.0.1,another.internal,localhost,::1')
    expect(env.no_proxy).toBe(env.NO_PROXY)
    expect(source.NO_PROXY).toBe('internal.example, 127.0.0.1')
    expect(codexLoopbackEnv({}).NO_PROXY).toBe('127.0.0.1,localhost,::1')
  })
  it('projects native plans with immutable revisions, ignores foreign/invalid events and never completes unfinished steps', async () => {
    const { controller, emit, wire } = setup()
    emit('turn/started', { turn: { id: 't1' } })
    const first = [{ step: 'Read', status: 'completed' }, { step: 'Build', status: 'inProgress' }]
    emit('turn/plan/updated', { turnId: 't1', plan: first })
    emit('turn/plan/updated', { turnId: 't1', plan: first })
    emit('turn/plan/updated', { threadId: 'child', turnId: 't1', plan: [] })
    emit('turn/plan/updated', { turnId: 't1', plan: [{ step: 'Bad', status: 'invented' }] })
    expect(controller.snapshot().plans).toHaveLength(1)
    emit('turn/plan/updated', { turnId: 't1', explanation: 'New scope', plan: [{ step: 'Test', status: 'pending' }] })
    expect(controller.snapshot().plans?.map(plan => plan.version)).toEqual([1, 2])
    expect(controller.snapshot().plans?.[0].steps).toEqual(first)
    emit('turn/completed', { turn: { id: 't1', status: 'completed' } })
    expect(controller.snapshot().plans?.at(-1)).toMatchObject({ outcome: 'completed', steps: [{ status: 'pending' }] })
    emit('turn/plan/updated', { turnId: 't1', plan: [] })
    expect(controller.snapshot().plans).toHaveLength(2)
    emit('turn/started', { turn: { id: 't2' } })
    emit('turn/plan/updated', { turnId: 't2', plan: [{ step: 'Next', status: 'inProgress' }] })
    emit('turn/completed', { turn: { id: 't2', status: 'interrupted' } })
    expect(controller.snapshot().plans?.at(-1)).toMatchObject({ outcome: 'interrupted', steps: [{ status: 'inProgress' }] })
    wire.fail('Disconnected')
    expect(controller.snapshot().plans).toHaveLength(3)
    wire.attach({ id: 'other', turns: [] })
    expect(controller.snapshot().plans).toEqual([])
    await controller.dispose()
  })
  it('loads paged model capabilities, updates only from authoritative settings, and retains selection on failure', async () => {
    const { controller, wire, emit } = setup()
    wire.attach({ id: 'main', turns: [] }, { model: 'custom', reasoningEffort: 'medium' })
    const call = vi.spyOn(wire, 'call').mockResolvedValueOnce({ data: [{ model: 'fast', displayName: 'Fast', defaultReasoningEffort: 'medium', supportedReasoningEfforts: [{ reasoningEffort: 'medium' }, { reasoningEffort: 'high' }] }], nextCursor: 'next' })
      .mockResolvedValueOnce({ data: [{ model: 'deep', hidden: false, defaultReasoningEffort: 'high', supportedReasoningEfforts: [{ reasoningEffort: 'high' }] }, { model: 'hidden', hidden: true }], nextCursor: null })
    const { controlEpoch } = await controller.command({ type: 'mode', mode: 'conversation' })
    await controller.command({ type: 'models', controlEpoch })
    expect(controller.snapshot().models.map(model => model.model)).toEqual(['fast', 'deep'])
    expect(call).toHaveBeenNthCalledWith(2, 'model/list', { limit: 100, cursor: 'next' })
    await expect(controller.command({ type: 'settings', model: 'deep', effort: 'low', controlEpoch })).rejects.toThrow('Unsupported')
    await expect(controller.command({ type: 'settings', model: 'invented', effort: null, controlEpoch })).rejects.toThrow('catalog')
    call.mockImplementationOnce(async () => {
      expect(controller.snapshot().model).toBe('custom')
      expect(controller.snapshot().settingsUpdating).toBe(true)
      await expect(controller.command({ type: 'send', text: 'race', commandId: 'r', controlEpoch })).rejects.toThrow('busy')
      emit('thread/settings/updated', { threadSettings: { model: 'deep', effort: 'high' } })
      return {}
    })
    await controller.command({ type: 'settings', model: 'deep', effort: 'high', controlEpoch })
    expect(call).toHaveBeenLastCalledWith('thread/settings/update', { threadId: 'main', model: 'deep', effort: 'high' })
    expect(controller.snapshot()).toMatchObject({ model: 'deep', effort: 'high', settingsUpdating: false })
    call.mockRejectedValueOnce(new Error('Rejected'))
    await expect(controller.command({ type: 'settings', model: 'fast', effort: 'medium', controlEpoch })).rejects.toThrow('Rejected')
    expect(controller.snapshot()).toMatchObject({ model: 'deep', effort: 'high', settingsUpdating: false })
    emit('thread/settings/updated', { threadId: 'child', threadSettings: { model: 'wrong', effort: 'low' } })
    expect(controller.snapshot().model).toBe('deep')
    await controller.command({ type: 'mode', mode: 'terminal' })
    await expect(controller.command({ type: 'settings', model: 'fast', effort: 'medium', controlEpoch })).rejects.toThrow('Display control')
    emit('thread/settings/updated', { threadSettings: { model: 'fast', effort: null } })
    expect(controller.snapshot()).toMatchObject({ model: 'fast', effort: null })
    await controller.dispose()
  })

  it('keeps a catalog error recoverable without disconnecting or losing the current model', async () => {
    const { controller, wire } = setup()
    const call = vi.spyOn(wire, 'call').mockRejectedValueOnce(new Error('Catalog unavailable'))
    const { controlEpoch } = await controller.command({ type: 'mode', mode: 'conversation' })
    await controller.command({ type: 'models', controlEpoch })
    expect(controller.snapshot()).toMatchObject({ connection: 'ready', modelsLoading: false, modelsError: expect.stringContaining('Catalog unavailable') })
    call.mockResolvedValueOnce({ data: [], nextCursor: null })
    await controller.command({ type: 'models', controlEpoch })
    expect(controller.snapshot().modelsError).toBeUndefined()
    await controller.dispose()
  })

  it('never sends slash commands as prompts, but preserves absolute paths and ordinary text', async () => {
    const { controller, wire } = setup()
    const call = vi.spyOn(wire, 'call').mockResolvedValue({})
    const { controlEpoch } = await controller.command({ type: 'mode', mode: 'conversation' })
    for (const text of ['/', '/model', '/model fast', '/effort high', '/unknown']) {
      await expect(controller.command({ type: 'send', text, commandId: text, controlEpoch })).rejects.toThrow('command menu')
    }
    expect(call).not.toHaveBeenCalled()
    expect(parseConversationSlashCommand('/model fast')).toEqual({ name: 'model', query: 'fast' })
    expect(parseConversationSlashCommand('/tmp/report.md')).toBeNull()
    await controller.command({ type: 'send', text: '/tmp/report.md', commandId: 'path', controlEpoch })
    expect(call).toHaveBeenCalledTimes(1)
    await controller.dispose()
  })
  it('does not block native initialization when conversation view is selected before the thread exists', async () => {
    const controller = new CodexConversation('starting', () => {})
    await controller.command({ type: 'mode', mode: 'conversation' })
    expect((controller as any).acceptsNativeCommand({ method: 'thread/start', params: {} })).toBe(true)
    expect(controller.acceptsTerminalInput('1\r')).toBe(false)
    expect(controller.acceptsTerminalInput('\x1b[1;1R')).toBe(true)
    ;(controller as any).attach({ id: 'authorized', turns: [] })
    expect(controller.acceptsTerminalInput('1\r')).toBe(false)
    await controller.dispose()
  })
  it('ignores title/subagent announcements and unrelated deltas; uses turn/item identity', () => {
    const { controller, emit } = setup()
    emit('thread/started', { thread: { id: 'title', ephemeral: true, threadSource: 'thread_title' } })
    emit('thread/started', { thread: { id: 'child', ephemeral: false } })
    emit('item/agentMessage/delta', { threadId: 'child', turnId: 't', itemId: 'm', delta: 'unrelated' })
    emit('item/agentMessage/delta', { turnId: 't1', itemId: 'm', delta: 'first' })
    emit('item/completed', { turnId: 't1', item: { id: 'm', type: 'agentMessage', text: 'first complete' } })
    emit('item/agentMessage/delta', { turnId: 't2', itemId: 'm', delta: 'second' })
    expect(controller.snapshot().threadId).toBe('main')
    expect(controller.snapshot().items.map(item => item.text)).toEqual(['first complete', 'second'])
    const copy = controller.snapshot(); copy.items[0].text = 'mutation'
    expect(controller.snapshot().items[0].text).toBe('first complete')
    controller.dispose()
  })

  it('accepts once, rejects stale control epochs, and does not retry unknown delivery', async () => {
    const { controller, wire } = setup()
    const call = vi.spyOn(wire, 'call').mockRejectedValue(new Error('Delivery unknown'))
    const first = await controller.command({ type: 'mode', mode: 'conversation' })
    const send = { type: 'send' as const, text: 'one', commandId: 'stable', controlEpoch: first.controlEpoch }
    await expect(controller.command(send)).rejects.toThrow('Delivery unknown')
    await expect(controller.command(send)).rejects.toThrow('Delivery unknown')
    expect(call).toHaveBeenCalledTimes(1)
    await controller.command({ type: 'mode', mode: 'terminal' })
    await controller.command({ type: 'mode', mode: 'conversation' })
    await expect(controller.command({ ...send, commandId: 'late' })).rejects.toThrow('Display control changed')
    expect(controller.acceptsTerminalInput('hidden Enter\r')).toBe(false)
    expect(controller.acceptsTerminalInput('\x1b[1;1R')).toBe(true)
    expect(wire.acceptsNativeCommand({ method: 'turn/start', params: { threadId: 'main' } })).toBe(false)
    expect(wire.acceptsNativeCommand({ method: 'turn/start', params: { threadId: 'title' } })).toBe(true)
    expect(wire.acceptsNativeCommand({ method: 'thread/start', params: { ephemeral: true } })).toBe(true)
    controller.dispose()
  })

  it('tracks approval resolution from either view and prevents a second response', async () => {
    const { controller, wire, emit } = setup()
    const send = vi.spyOn(wire, 'send').mockImplementation(() => {})
    const state = await controller.command({ type: 'mode', mode: 'conversation' })
    emit('item/fileChange/requestApproval', { turnId: 't', itemId: 'patch' }, 17)
    emit('item/fileChange/requestApproval', { turnId: 't', itemId: 'patch' }, 17)
    expect(controller.snapshot().approvals).toHaveLength(1)
    expect(wire.acceptsNativeCommand({ id: 17, result: { decision: 'accept' } })).toBe(false)
    const approval = { type: 'approve' as const, requestId: 17, decision: 'accept' as const, controlEpoch: state.controlEpoch }
    await controller.command(approval)
    await expect(controller.command(approval)).rejects.toThrow('no longer pending')
    expect(send).toHaveBeenCalledWith({ id: 17, result: { decision: 'accept' } })
    emit('item/commandExecution/requestApproval', { turnId: 't', itemId: 'cmd', command: 'test' }, 18)
    emit('serverRequest/resolved', { requestId: 18 })
    expect(controller.snapshot().approvals).toHaveLength(0)
    emit('item/tool/requestUserInput', { turnId: 't', itemId: 'question' }, 19)
    expect(controller.snapshot().needsTerminal).toBe(true)
    emit('serverRequest/resolved', { requestId: 19 })
    expect(controller.snapshot().needsTerminal).toBe(false)
    controller.dispose()
  })

  it('bounds displayed text and history while preserving authoritative file paths and diffs', () => {
    const { controller, emit } = setup()
    emit('item/completed', { turnId: 't', item: { id: 'f', type: 'fileChange', changes: [{ path: 'C:/repo/a.html', diff: '+hello' }], status: 'completed' } })
    expect(controller.snapshot().items[0].files).toEqual([{ path: 'C:/repo/a.html', diff: '+hello' }])
    emit('item/agentMessage/delta', { turnId: 't', itemId: 'long', delta: 'a'.repeat(40000) })
    expect(controller.snapshot().items[1]).toMatchObject({ text: 'a'.repeat(32000), truncated: true })
    for (let i = 0; i < 501; i++) emit('item/completed', { turnId: 't', item: { id: `item${i}`, type: 'agentMessage', text: 'ok' } })
    expect(controller.snapshot().items).toHaveLength(500)
    expect(controller.snapshot().truncated).toBe(true)
    controller.dispose()
  })
  it('sends image references through native localImage input and rejects stale delivery intents', async () => {
    const { controller, wire } = setup()
    const state = await controller.command({ type: 'mode', mode: 'conversation' })
    const call = vi.spyOn(wire, 'call').mockResolvedValue({ turn: { id: 'image-turn' } })
    await controller.command({ type: 'send', text: 'Inspect screenshot', commandId: 'image', controlEpoch: state.controlEpoch, delivery: 'queue', imagePaths: ['C:/attachments/screen.png'] })
    expect(call).toHaveBeenCalledWith('turn/start', { threadId: 'main', input: [{ type: 'text', text: 'Inspect screenshot', text_elements: [] }, { type: 'localImage', path: 'C:/attachments/screen.png' }] })
    await expect(controller.command({ type: 'send', text: 'Next task', commandId: 'queue', controlEpoch: state.controlEpoch, delivery: 'queue' })).rejects.toThrow('new turn')
    await expect(controller.command({ type: 'send', text: 'Correction', commandId: 'steer', controlEpoch: state.controlEpoch, delivery: 'steer', expectedTurnId: 'old-turn' })).rejects.toThrow('target turn')
    expect(call).toHaveBeenCalledTimes(1)
    await controller.dispose()
  })

})
