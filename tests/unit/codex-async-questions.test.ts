import { describe, it, expect, vi } from 'vitest'
import { CodexConversation } from '../../src/main/terminal/codex-conversation'

describe('Codex asynchronous message questions', () => {
  const raw = { id: 'ask', type: 'agentMessage', text: 'Choose a direction', questions: [
    { title: 'Which direction?', options: ['First', 'Second'] }, { title: 'Notes' },
  ] }
  function setup() {
    const c = new CodexConversation('async-test', () => {})
    const wire = c as any
    wire.attach({ id: 'thread', turns: [] })
    const call = vi.spyOn(wire, 'call').mockResolvedValue({ turn: { id: 'next' } })
    const emit = (method: string, params: object) => wire.receive({ method, params: { threadId: 'thread', ...params } })
    const ask = () => emit('item/completed', { turnId: 'turn', item: raw })
    return { c, wire, call, emit, ask }
  }
  it.each([true, false])('answers with ordinary native input (active=%s), once, without reviving on replay', async active => {
    const { c, call, emit, ask } = setup()
    await c.command({ type: 'mode', mode: 'conversation' })
    emit('turn/started', { turn: { id: 'turn' } })
    ask()
    expect(c.state.questions).toHaveLength(1)
    const q = c.state.questions![0]
    expect(q).toMatchObject({ blocking: false, cancelable: false })
    expect(q.questions[0]).toMatchObject({ allowText: true, options: [{ id: '0', label: 'First' }, { id: '1', label: 'Second' }] })
    if (!active) emit('turn/completed', { turn: { id: 'turn', status: 'completed' } })
    expect(c.state.questions).toHaveLength(1)
    const command = { type: 'answer' as const, requestId: q.id, version: q.version, controlEpoch: c.state.controlEpoch,
      answer: { answers: [{ id: '0', selected: ['1'] }, { id: '1', selected: [], text: '中文回答' }] } }
    await c.command(command)
    expect(call).toHaveBeenCalledExactlyOnceWith(active ? 'turn/steer' : 'turn/start', expect.objectContaining({
      threadId: 'thread', ...(active ? { expectedTurnId: 'turn' } : {}),
      input: [{ type: 'text', text: `<send_user_message_question_reply>${JSON.stringify([
        { questionItemId: JSON.stringify(['request_user_input_async', 'ask', 0]), question: 'Which direction?', answer: 'Second' },
        { questionItemId: JSON.stringify(['request_user_input_async', 'ask', 1]), question: 'Notes', answer: '中文回答' },
      ])}</send_user_message_question_reply>`, text_elements: [] }],
    }))
    expect(c.state.questions).toEqual([])
    const input = (call.mock.calls[0][1] as any).input
    emit('item/completed', { turnId: 'reply', item: { id: 'reply', type: 'userMessage', content: input } })
    expect(c.state.items.at(-1)).toMatchObject({ text: '> Which direction?\n\nSecond\n\n> Notes\n\n中文回答', editable: false })
    ask()
    expect(c.state.questions).toEqual([])
    await expect(c.command(command)).rejects.toThrow('expired')
    await c.dispose()
  })
  it('keeps uncertain delivery locked, ignores foreign/malformed messages and does not revive historical questions', async () => {
    const { c, wire, call, emit, ask } = setup()
    await c.command({ type: 'mode', mode: 'conversation' })
    emit('item/completed', { threadId: 'other', turnId: 'turn', item: raw })
    emit('item/completed', { turnId: 'turn', item: { ...raw, questions: [{ title: 'Bad', options: [1] }] } })
    expect(c.state.questions ?? []).toEqual([])
    ask()
    const q = c.state.questions![0]
    call.mockRejectedValueOnce(new Error('connection lost'))
    await expect(c.command({ type: 'answer', requestId: q.id, version: q.version, controlEpoch: c.state.controlEpoch,
      answer: { answers: [{ id: '0', selected: ['0'] }, { id: '1', selected: [], text: 'x' }] } })).rejects.toThrow('connection lost')
    expect(c.state.questions![0].status).toBe('unknown')
    ask()
    expect(c.state.questions![0].status).toBe('unknown')
    wire.attach({ id: 'new-thread', turns: [{ id: 'turn', status: 'completed', items: [raw] }] })
    expect(c.state.questions).toEqual([])
    await c.dispose()
  })
})
