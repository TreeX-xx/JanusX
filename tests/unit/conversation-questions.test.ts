import { describe, expect, it, vi } from 'vitest'
import { ConversationSession, conversationState } from '../../src/main/terminal/conversation-session'
import { validateConversationAnswer, type ConversationQuestionRequest } from '../../src/shared/conversation-questions'
import { CodexConversation } from '../../src/main/terminal/codex-conversation'
import { codexAsyncQuestions, codexAsyncReplies } from '../../src/main/terminal/codex-questions'
import { OpenCodeConversation } from '../../src/main/terminal/opencode-conversation'
import { ClaudeConversation } from '../../src/main/terminal/claude-conversation'

const question = { id: 'q', text: 'Choose', options: [{ id: 'a', label: 'First' }, { id: 'b', label: 'Second' }], allowText: true }
const request: ConversationQuestionRequest = { id: 'request', version: 1, cancelable: true, questions: [question] }
const answer = { answers: [{ id: 'q', selected: ['a'] }] }

describe('Codex asynchronous questions', () => {
  const item = { id: 'async-message', type: 'agentMessage', text: 'Choose a direction', questions: [
    { title: 'Choose', options: ['First', 'Second'] }, { title: 'Notes' },
  ] }
  async function setup() {
    const c = new CodexConversation('test', () => {})
    const wire = c as any
    wire.attach({ id: 's', turns: [] })
    await c.command({ type: 'mode', mode: 'conversation' })
    wire.receive({ method: 'turn/started', params: { threadId: 's', turn: { id: 't' } } })
    const emit = (method = 'item/completed', value = item) => wire.receive({ method, params: { threadId: 's', turnId: 't', item: value } })
    const reply = () => {
      const request = c.state.questions![0]
      return c.command({ type: 'answer', requestId: request.id, version: request.version, controlEpoch: c.state.controlEpoch,
        answer: { answers: [{ id: '0', selected: ['1'] }, { id: '1', selected: [], text: '中文说明' }] } })
    }
    return { c, wire, emit, reply }
  }
  it('validates the native async shape without guessing questions from prose', () => {
    expect(codexAsyncQuestions(item.questions)?.[0]).toMatchObject({ allowText: true, options: [{ id: '0', label: 'First' }, { id: '1', label: 'Second' }] })
    for (const value of [undefined, [], [{ title: 'Choose', options: [{ label: 'Wrong schema' }] }], [{ title: 4 }]]) expect(codexAsyncQuestions(value)).toBeNull()
  })
  it('steers a running turn once, accepts custom text and deduplicates started/completed events', async () => {
    const { c, wire, emit, reply } = await setup()
    try {
      const call = vi.spyOn(wire, 'call').mockResolvedValue({})
      emit('item/started'); const version = c.state.questions![0].version
      emit(); expect(c.state.questions).toHaveLength(1)
      expect(c.state.questions![0]).toMatchObject({ version, blocking: false })
      await reply()
      expect(call).toHaveBeenCalledExactlyOnceWith('turn/steer', { threadId: 's', expectedTurnId: 't', input: [{ type: 'text', text: expect.any(String), text_elements: [] }] })
      expect(codexAsyncReplies((call.mock.calls[0][1] as any).input[0].text)).toEqual([
        { questionItemId: JSON.stringify(['request_user_input_async', item.id, 0]), question: 'Choose', answer: 'Second' },
        { questionItemId: JSON.stringify(['request_user_input_async', item.id, 1]), question: 'Notes', answer: '中文说明' },
      ])
      expect(c.state.questions).toEqual([])
      emit(); expect(c.state.questions).toEqual([])
    } finally { await c.dispose() }
  })
  it('retains unanswered questions after completion and starts a new turn when idle', async () => {
    const { c, wire, emit, reply } = await setup()
    try {
      emit()
      wire.receive({ method: 'turn/completed', params: { threadId: 's', turn: { id: 't', status: 'completed' } } })
      expect(c.state.questions).toHaveLength(1)
      await c.command({ type: 'mode', mode: 'terminal' })
      await c.command({ type: 'mode', mode: 'conversation' })
      const call = vi.spyOn(wire, 'call').mockResolvedValue({ turn: { id: 'next' } })
      await reply()
      expect(call).toHaveBeenCalledWith('turn/start', expect.objectContaining({ threadId: 's' }))
      expect(c.state.turnId).toBe('next')
      expect(c.state.questions).toEqual([])
    } finally { await c.dispose() }
  })
  it('keeps failed delivery unknown and never retries a steer into a new turn', async () => {
    const { c, wire, emit, reply } = await setup()
    try {
      emit()
      const call = vi.spyOn(wire, 'call').mockRejectedValue(new Error('Turn already completed'))
      await expect(reply()).rejects.toThrow('Turn already completed')
      expect(c.state.questions![0].status).toBe('unknown')
      await expect(reply()).rejects.toThrow()
      expect(call).toHaveBeenCalledTimes(1)
    } finally { await c.dispose() }
  })
  it('does not revive historical questions; switching thread expires live requests', async () => {
    const { c, wire, emit } = await setup()
    try {
      wire.attach({ id: 's', turns: [{ id: 'old', status: 'completed', items: [item] }] })
      expect(c.state.questions ?? []).toEqual([])
      emit(); expect(c.state.questions).toHaveLength(1)
      wire.attach({ id: 'other', turns: [] })
      expect(c.state.questions).toEqual([])
    } finally { await c.dispose() }
  })
  it('dismisses locally without sending input and preserves pending questions while busy', async () => {
    const { c, wire, emit, reply } = await setup()
    try {
      emit(); const call = vi.spyOn(wire, 'call')
      c.state.submitting = true
      await expect(reply()).rejects.toThrow('busy')
      expect(c.state.questions![0].status).toBe('pending')
      c.state.submitting = false
      const request = c.state.questions![0]
      await c.command({ type: 'answer', requestId: request.id, version: request.version, controlEpoch: c.state.controlEpoch, answer: { cancelled: true, answers: [] } })
      expect(call).not.toHaveBeenCalled()
      emit(); expect(c.state.questions).toEqual([])
    } finally { await c.dispose() }
  })
  it('consumes native terminal replies by question identity and displays readable answer text', async () => {
    const { c, wire, emit } = await setup()
    try {
      emit(); const version = c.state.questions![0].version
      const text = '<send_user_message_question_reply>\n' + JSON.stringify([{ questionItemId: JSON.stringify(['request_user_input_async', item.id, 0]), question: 'Choose', answer: 'First' }]) + '\n</send_user_message_question_reply>'
      wire.receive({ method: 'item/completed', params: { threadId: 's', turnId: 't', item: { type: 'userMessage', id: 'native-answer', content: [{ type: 'text', text }] } } })
      expect(c.state.questions![0].questions.map(q => q.id)).toEqual(['1'])
      expect(c.state.questions![0].version).toBeGreaterThan(version)
      expect(c.state.items.at(-1)).toMatchObject({ text: '> Choose\n\nFirst', editable: false })
      emit(); expect(c.state.questions![0].questions.map(q => q.id)).toEqual(['1'])
    } finally { await c.dispose() }
  })
})

describe('native question lifetime', () => {
  it('allows hours of human idle time, but keeps a sent answer until native confirmation', async () => {
    vi.useFakeTimers()
    const session = new ConversationSession(conversationState('test', 'codex'), () => {})
    try {
      const reply = vi.fn()
      session.questions.ask(request, reply, 'event')
      await vi.advanceTimersByTimeAsync(8 * 60 * 60 * 1000)
      expect(session.state.questions![0].status).toBe('pending')
      await session.questions.answer('request', 1, answer)
      expect(session.state.questions![0].status).toBe('submitting')
      await expect(session.questions.answer('request', 1, answer)).rejects.toThrow('already answered')
      session.questions.resolve('request')
      await vi.advanceTimersByTimeAsync(15000)
      expect(session.state.questions).toEqual([])
      expect(session.state.error).toBeUndefined()
      expect(reply).toHaveBeenCalledTimes(1)
    } finally { session.stop(); vi.useRealTimers() }
  })

  it('retains uncertain submissions on missing confirmation or disconnect without replaying', async () => {
    vi.useFakeTimers()
    const session = new ConversationSession(conversationState('test', 'codex'), () => {})
    try {
      const reply = vi.fn()
      session.questions.ask(request, reply, 'event')
      await session.questions.answer('request', 1, answer)
      await vi.advanceTimersByTimeAsync(15000)
      expect(session.state.questions![0].status).toBe('unknown')
      expect(session.state.needsTerminal).toBe(true)
      session.questions.ask(request, reply, 'event')
      await expect(session.questions.answer('request', 1, answer)).rejects.toThrow('already answered')
      session.questions.resolve('request')
      session.questions.ask(request, reply, 'event')
      await session.questions.answer('request', 2, answer)
      session.questions.disconnected('Socket closed')
      expect(session.state.questions![0].status).toBe('unknown')
      session.questions.resolve('request') // Late authoritative confirmation is still accepted.
      expect(session.state.questions).toEqual([])
      expect(session.state.error).toBeUndefined()
      expect(reply).toHaveBeenCalledTimes(2)
    } finally { session.stop(); vi.useRealTimers() }
  })

  it('validates complete batches, explicit choices, custom input and limits', () => {
    for (const value of [answer, { answers: [{ id: 'q', selected: [], text: '中文 text' }] }, { cancelled: true, answers: [] }]) expect(() => validateConversationAnswer(request, value)).not.toThrow()
    for (const value of [
      { answers: [] }, { answers: [{ id: 'other', selected: ['a'] }] }, { answers: [{ id: 'q', selected: ['unknown'] }] },
      { answers: [{ id: 'q', selected: ['a', 'a'] }] }, { answers: [{ id: 'q', selected: ['a', 'b'] }] },
      { answers: [{ id: 'q', selected: ['a'], text: 'both' }] }, { answers: [{ id: 'q', selected: [], text: '  ' }] },
    ]) expect(() => validateConversationAnswer(request, value)).toThrow()
    const multi = { ...request, questions: [{ ...question, multiple: true }] }
    expect(() => validateConversationAnswer(multi, { answers: [{ id: 'q', selected: ['a', 'b'], text: 'custom' }] })).not.toThrow()
    const numeric = { ...request, questions: [{ ...question, options: [], inputType: 'integer' as const, minimum: 1, maximum: 4 }] }
    for (const text of ['NaN', 'Infinity', '0', '5', '1.5']) expect(() => validateConversationAnswer(numeric, { answers: [{ id: 'q', selected: [], text }] })).toThrow()
  })

  it('rejects stale/duplicate replies and blocks chat and mode switches during delivery', async () => {
    const state = conversationState('test', 'pi')
    Object.assign(state, { mode: 'conversation', connection: 'ready', threadId: 's' })
    const session = new ConversationSession(state, () => {})
    let finish!: () => void
    const reply = vi.fn(() => new Promise<void>(resolve => { finish = resolve }))
    session.questions.ask(request, reply)
    await expect(session.submit({ type: 'send', commandId: 'chat', text: 'not an answer', controlEpoch: 0 }, async () => {})).rejects.toThrow()
    await expect(session.questions.answer('request', 99, answer)).rejects.toThrow('expired')
    const pending = session.questions.answer('request', state.questions![0].version, answer)
    await expect(session.questions.answer('request', state.questions![0].version, answer)).rejects.toThrow('already answered')
    expect(() => session.mode({ type: 'mode', mode: 'terminal' }, false)).toThrow()
    finish(); await pending
    expect(reply).toHaveBeenCalledTimes(1)
    expect(state.questions).toEqual([])
    session.stop()
  })

  it('never retries an uncertain answer and does not remove a newer native request', async () => {
    const session = new ConversationSession(conversationState('test', 'pi'), () => {})
    const fail = vi.fn(async () => { throw new Error('lost ack') })
    session.questions.ask(request, fail)
    await expect(session.questions.answer('request', 1, answer)).rejects.toThrow('lost ack')
    expect(session.state.questions![0].status).toBe('unknown')
    session.questions.ask(request, fail)
    await expect(session.questions.answer('request', 1, answer)).rejects.toThrow('already answered')
    expect(fail).toHaveBeenCalledTimes(1)
    session.questions.resolve('request')
    let finish!: () => void
    session.questions.ask(request, () => new Promise<void>(resolve => { finish = resolve }))
    const pending = session.questions.answer('request', 2, answer)
    session.questions.ask({ ...request, questions: [{ ...question, text: 'New question' }] }, async () => {})
    finish(); await pending
    expect(session.state.questions![0]).toMatchObject({ version: 3, status: 'pending' })
    session.stop()
  })
})

describe('provider question protocols', () => {
  it('binds the Claude permission callback to the exact human answer, ignoring JSON key order', async () => {
    const c = new ClaudeConversation('test', () => {})
    Object.assign(c.state, { connection: 'ready', threadId: 's' })
    const wire = c as any
    const call = vi.spyOn(wire, 'call').mockResolvedValue({})
    await c.command({ type: 'mode', mode: 'conversation' })
    const questions = [{ header: 'Confirm', question: 'Proceed?', options: [{ label: 'Yes', description: 'Proceed' }, { label: 'No', description: 'Stop' }], multiSelect: false }]
    wire.receive({ type: 'tool.start', data: { toolUseId: 'tool', turnId: 't', tool: 'AskUserQuestion' } })
    wire.receive({ type: 'question', data: { id: 'question:tool', toolUseId: 'tool', turnId: 't', questions } })
    await c.command({ type: 'answer', requestId: 'question:tool', version: 1, controlEpoch: c.state.controlEpoch, answer: { answers: [{ id: '0', selected: ['1'] }] } })
    expect(call).toHaveBeenLastCalledWith({ type: 'answer', requestId: 'question:tool', answer: { answers: { 'Proceed?': 'No' } } })
    expect(c.state.questions![0].status).toBe('submitting')
    const input = { questions: [{ question: 'Proceed?', header: 'Confirm', multiSelect: false, options: questions[0].options }], answers: { 'Proceed?': 'No' } }
    const json = vi.spyOn(wire, 'json').mockImplementation(() => {})
    await wire.permission({ session_id: 's', tool_name: 'AskUserQuestion', tool_input: input }, {})
    expect(json).toHaveBeenLastCalledWith({}, { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow', updatedInput: input } } })
    expect(wire.questionReplies.size).toBe(0)
    wire.questionReplies.set('tool', { questions, answers: { 'Proceed?': 'No' } })
    await wire.permission({ session_id: 's', tool_name: 'AskUserQuestion', tool_input: { ...input, answers: { 'Proceed?': 'Yes' } } }, {})
    expect(json).toHaveBeenLastCalledWith({}, {})
    expect(wire.questionReplies.size).toBe(1)
    wire.receive({ type: 'tool.error', data: { toolUseId: 'tool', text: 'Native rejected the answer' } })
    expect(c.state.questions![0].status).toBe('unknown')
    expect(c.state.needsTerminal).toBe(true)
    await c.dispose()
  })
  it('returns Codex request IDs and native answer labels; native resolution invalidates stale replies', async () => {
    const c = new CodexConversation('test', () => {})
    const wire = c as any
    wire.attach({ id: 's', turns: [] })
    const send = vi.spyOn(wire, 'send').mockImplementation(() => {})
    await c.command({ type: 'mode', mode: 'conversation' })
    wire.receive({ id: 52, method: 'item/tool/requestUserInput', params: { threadId: 's', turnId: 't', itemId: 'tool', isBlocking: true,
      questions: [{ id: 'q', question: 'Choose', header: 'Choice', isOther: true, options: [{ label: 'Native label', description: 'Detail' }] }] } })
    const q = c.state.questions![0]
    expect(c.state.needsTerminal).toBe(false)
    await c.command({ type: 'answer', requestId: 52, version: q.version, controlEpoch: c.state.controlEpoch, answer: { answers: [{ id: 'q', selected: [], text: 'custom 原文' }] } })
    expect(send).toHaveBeenLastCalledWith({ id: 52, result: { answers: { q: { answers: ['user_note: custom 原文'] } } } })
    expect(c.state.questions![0].status).toBe('submitting')
    wire.receive({ method: 'serverRequest/resolved', params: { threadId: 's', requestId: 52 } })
    expect(c.state.questions).toEqual([])
    wire.receive({ id: 'late', method: 'item/tool/requestUserInput', params: { threadId: 's', questions: [{ id: 'q', question: 'Secret', isSecret: true }] } })
    expect(c.state.questions![0].questions[0]).toMatchObject({ allowText: true, secret: true })
    wire.receive({ method: 'serverRequest/resolved', params: { threadId: 's', requestId: 'late' } })
    await expect(c.command({ type: 'answer', requestId: 'late', version: 2, controlEpoch: c.state.controlEpoch, answer })).rejects.toThrow('expired')
    wire.receive({ id: 54, method: 'item/commandExecution/requestApproval', params: { threadId: 's', itemId: 'command', proposedExecpolicyAmendment: ['npm', 'test'] } })
    await expect(c.command({ type: 'approve', requestId: 54, decision: 'invented', controlEpoch: c.state.controlEpoch })).rejects.toThrow()
    await c.command({ type: 'approve', requestId: 54, decision: 'execpolicy', controlEpoch: c.state.controlEpoch })
    expect(send).toHaveBeenLastCalledWith({ id: 54, result: { decision: { acceptWithExecpolicyAmendment: { execpolicy_amendment: ['npm', 'test'] } } } })
    await c.dispose()
  })

  it('maps OpenCode permission choices and typed form values to their specific endpoints', async () => {
    const c = new OpenCodeConversation('test', () => {})
    Object.assign(c.state, { connection: 'ready', threadId: 's' })
    const wire = c as any
    const api = vi.spyOn(wire, 'api').mockResolvedValue({ data: {} })
    await c.command({ type: 'mode', mode: 'conversation' })
    wire.syncInteractions([{ id: 'p', sessionID: 's', action: 'shell', resources: ['npm test'], save: ['npm *'] }], [{ id: 'f', sessionID: 's', title: 'Details', fields: [
      { key: 'features', type: 'multiselect', required: true, custom: true, options: [{ value: 'x', label: 'Feature X' }, { value: 'y', label: 'Feature Y' }] },
      { key: 'count', type: 'integer', required: true, minimum: 1, maximum: 3 }, { key: 'yes', type: 'boolean', required: true },
    ] }])
    const [permission, form] = c.state.questions!
    expect(permission.questions[0].options.map(o => o.id)).toEqual(['once', 'always', 'reject'])
    await c.command({ type: 'answer', requestId: permission.id, version: permission.version, controlEpoch: c.state.controlEpoch, answer: { answers: [{ id: 'decision', selected: ['reject'] }] } })
    expect(api).toHaveBeenLastCalledWith('/api/session/s/permission/p/reply', { decision: 'reject' })
    await c.command({ type: 'answer', requestId: form.id, version: form.version, controlEpoch: c.state.controlEpoch, answer: { answers: [
      { id: 'features', selected: ['x', 'y'], text: 'custom' }, { id: 'count', selected: [], text: '2' }, { id: 'yes', selected: ['false'] },
    ] } })
    expect(api).toHaveBeenLastCalledWith('/api/session/s/form/f/reply', { answer: { features: ['x', 'y', 'custom'], count: 2, yes: false } })
    wire.syncInteractions([], [{ id: 'unsupported', sessionID: 's', fields: [{ key: 'f', type: 'external', url: 'https://example.com' }] }])
    expect(c.state.needsTerminal).toBe(true)
    expect(c.state.questions).toEqual([])
    await c.dispose()
  })
})
