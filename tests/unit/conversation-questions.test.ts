import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { ConversationSession, conversationState } from '../../src/main/terminal/conversation-session'
import { validateConversationAnswer, type ConversationQuestionRequest } from '../../src/shared/conversation-questions'
import { codexFixture } from './codex-conversation.fixture'
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
  async function questionFixture(startTurn = true) {
    const { controller, emit, wire } = codexFixture('s')
    await controller.command({ type: 'mode', mode: 'conversation' })
    if (startTurn) emit('turn/started', { turn: { id: 't' } })
    const emitQuestion = (method = 'item/completed') => emit(method, { turnId: 't', item })
    const reply = (request = controller.state.questions![0]) => controller.command({
      type: 'answer', requestId: request.id, version: request.version, controlEpoch: controller.state.controlEpoch,
      answer: { answers: [{ id: '0', selected: ['1'] }, { id: '1', selected: [], text: '中文说明' }] },
    })
    return { controller, emit, wire, emitQuestion, reply }
  }
  it('validates the native async shape without guessing questions from prose', () => {
    expect(codexAsyncQuestions(item.questions)?.[0]).toMatchObject({ allowText: true, options: [{ id: '0', label: 'First' }, { id: '1', label: 'Second' }] })
    for (const value of [undefined, [], [{ title: 'Choose', options: [{ label: 'Wrong schema' }] }], [{ title: 4 }]]) expect(codexAsyncQuestions(value)).toBeNull()
  })
  const expectedReplies = [
    { questionItemId: JSON.stringify(['request_user_input_async', item.id, 0]), question: 'Choose', answer: 'Second' },
    { questionItemId: JSON.stringify(['request_user_input_async', item.id, 1]), question: 'Notes', answer: '中文说明' },
  ]
  const input = [{
    type: 'text',
    text: `<send_user_message_question_reply>\n${JSON.stringify(expectedReplies)}\n</send_user_message_question_reply>`,
    text_elements: [],
  }]
  it.each([
    ['turn/steer', { threadId: 's', expectedTurnId: 't', input }, 't'],
    ['turn/start', expect.objectContaining({ threadId: 's', input }), 'next'],
  ] as const)('delivers one async answer through %s and ignores replay', async (method, params, turnAfterReply) => {
    const { controller, wire, emit, emitQuestion, reply } = await questionFixture()
    const call = vi.spyOn(wire, 'call').mockResolvedValue({ turn: { id: 'next' } })
    emitQuestion('item/started')
    const version = controller.state.questions![0].version
    emitQuestion()
    expect(controller.state.questions).toHaveLength(1)
    const pending = controller.state.questions![0]
    expect(pending).toMatchObject({ version, blocking: false, cancelable: true })
    expect(pending.questions[0]).toMatchObject({ allowText: true, options: [{ id: '0', label: 'First' }, { id: '1', label: 'Second' }] })
    if (method === 'turn/start') {
      emit('turn/completed', { turn: { id: 't', status: 'completed' } })
      expect(controller.state.questions).toHaveLength(1)
      await controller.command({ type: 'mode', mode: 'terminal' })
      await controller.command({ type: 'mode', mode: 'conversation' })
    }
    await reply()
    expect(call).toHaveBeenCalledExactlyOnceWith(method, params)
    expect(controller.state.turnId).toBe(turnAfterReply)
    const sent = (call.mock.calls[0][1] as { input: typeof input }).input
    expect(codexAsyncReplies(sent[0].text)).toEqual(expectedReplies)
    expect(controller.state.questions).toEqual([])
    emit('item/completed', { turnId: 'reply', item: { id: 'reply', type: 'userMessage', content: sent } })
    expect(controller.state.items.at(-1)).toMatchObject({ text: '> Choose\n\nSecond\n\n> Notes\n\n中文说明', editable: false })
    emitQuestion()
    expect(controller.state.questions).toEqual([])
    await expect(reply(pending)).rejects.toThrow('expired')
  })
  it.each([
    { error: 'Turn already completed', startTurn: true },
    { error: 'connection lost', startTurn: false },
  ])('keeps failed delivery unknown without resending after $error', async ({ error, startTurn }) => {
    const { controller, wire, emit, emitQuestion, reply } = await questionFixture(startTurn)
    emit('item/completed', { threadId: 'other', turnId: 't', item })
    emit('item/completed', { turnId: 't', item: { ...item, questions: [{ title: 'Bad', options: [1] }] } })
    expect(controller.state.questions ?? []).toEqual([])
    emitQuestion()
    const call = vi.spyOn(wire, 'call').mockRejectedValue(new Error(error))
    await expect(reply()).rejects.toThrow(error)
    expect(controller.state.questions![0].status).toBe('unknown')
    emitQuestion()
    expect(controller.state.questions![0].status).toBe('unknown')
    await expect(reply()).rejects.toThrow()
    expect(call).toHaveBeenCalledTimes(1)
    wire.attach({ id: 'other', turns: [{ id: 't', status: 'completed', items: [item] }] })
    expect(controller.state.questions).toEqual([])
  })
  it('does not revive historical questions; switching thread expires live requests', async () => {
    const { controller, wire, emitQuestion } = await questionFixture()
    wire.attach({ id: 's', turns: [{ id: 'old', status: 'completed', items: [item] }] })
    expect(controller.state.questions ?? []).toEqual([])
    emitQuestion()
    expect(controller.state.questions).toHaveLength(1)
    wire.attach({ id: 'other', turns: [] })
    expect(controller.state.questions).toEqual([])
  })
  it('dismisses locally without sending input and preserves pending questions while busy', async () => {
    const { controller, wire, emitQuestion, reply } = await questionFixture()
    emitQuestion()
    const call = vi.spyOn(wire, 'call')
    controller.state.submitting = true
    await expect(reply()).rejects.toThrow('busy')
    expect(controller.state.questions![0].status).toBe('pending')
    controller.state.submitting = false
    const request = controller.state.questions![0]
    await controller.command({ type: 'answer', requestId: request.id, version: request.version, controlEpoch: controller.state.controlEpoch, answer: { cancelled: true, answers: [] } })
    expect(call).not.toHaveBeenCalled()
    emitQuestion()
    expect(controller.state.questions).toEqual([])
  })
  it('consumes native terminal replies by question identity and displays readable answer text', async () => {
    const { controller, emit, emitQuestion } = await questionFixture()
    emitQuestion()
    const version = controller.state.questions![0].version
    const text = '<send_user_message_question_reply>\n' + JSON.stringify([{ questionItemId: JSON.stringify(['request_user_input_async', item.id, 0]), question: 'Choose', answer: 'First' }]) + '\n</send_user_message_question_reply>'
    emit('item/completed', { turnId: 't', item: { type: 'userMessage', id: 'native-answer', content: [{ type: 'text', text }] } })
    expect(controller.state.questions![0].questions.map(q => q.id)).toEqual(['1'])
    expect(controller.state.questions![0].version).toBeGreaterThan(version)
    expect(controller.state.items.at(-1)).toMatchObject({ text: '> Choose\n\nFirst', editable: false })
    emitQuestion()
    expect(controller.state.questions![0].questions.map(q => q.id)).toEqual(['1'])
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
    onTestFinished(() => c.dispose())
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
  })
  it('returns Codex request IDs and native answer labels; native resolution invalidates stale replies', async () => {
    const { controller: c, wire, emit } = codexFixture('s')
    const send = vi.spyOn(wire, 'send').mockImplementation(() => {})
    await c.command({ type: 'mode', mode: 'conversation' })
    emit('item/tool/requestUserInput', { turnId: 't', itemId: 'tool', isBlocking: true,
      questions: [{ id: 'q', question: 'Choose', header: 'Choice', isOther: true, options: [{ label: 'Native label', description: 'Detail' }] }] }, 52)
    const q = c.state.questions![0]
    expect(c.state.needsTerminal).toBe(false)
    await c.command({ type: 'answer', requestId: 52, version: q.version, controlEpoch: c.state.controlEpoch, answer: { answers: [{ id: 'q', selected: [], text: 'custom 原文' }] } })
    expect(send).toHaveBeenLastCalledWith({ id: 52, result: { answers: { q: { answers: ['user_note: custom 原文'] } } } })
    expect(c.state.questions![0].status).toBe('submitting')
    emit('serverRequest/resolved', { requestId: 52 })
    expect(c.state.questions).toEqual([])
    emit('item/tool/requestUserInput', { questions: [{ id: 'q', question: 'Secret', isSecret: true }] }, 'late')
    expect(c.state.questions![0].questions[0]).toMatchObject({ allowText: true, secret: true })
    emit('serverRequest/resolved', { requestId: 'late' })
    await expect(c.command({ type: 'answer', requestId: 'late', version: 2, controlEpoch: c.state.controlEpoch, answer })).rejects.toThrow('expired')
    emit('item/commandExecution/requestApproval', { itemId: 'command', proposedExecpolicyAmendment: ['npm', 'test'] }, 54)
    await expect(c.command({ type: 'approve', requestId: 54, decision: 'invented', controlEpoch: c.state.controlEpoch })).rejects.toThrow()
    await c.command({ type: 'approve', requestId: 54, decision: 'execpolicy', controlEpoch: c.state.controlEpoch })
    expect(send).toHaveBeenLastCalledWith({ id: 54, result: { decision: { acceptWithExecpolicyAmendment: { execpolicy_amendment: ['npm', 'test'] } } } })
  })

  it('maps OpenCode permission choices and typed form values to their specific endpoints', async () => {
    const c = new OpenCodeConversation('test', () => {})
    onTestFinished(() => c.dispose())
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
  })
})
