import { describe, expect, it, vi } from 'vitest'
import { bindConversationOutbox, enqueueConversationMessage, conversationOutbox, observeConversationOutbox, removeOutgoingMessage } from '../../src/renderer/src/stores/conversation-outbox'
import { CODEX_CONVERSATION_CAPABILITIES, type ConversationSnapshot } from '../../src/shared/conversation-display'

function setup() {
  const state: ConversationSnapshot = { id: crypto.randomUUID(), engine: 'codex', capabilities: CODEX_CONVERSATION_CAPABILITIES,
    revision: 1, mode: 'conversation', controlEpoch: 1, connection: 'ready', threadId: 'thread', turnId: null,
    submitting: false, items: [], approvals: [], needsTerminal: false, truncated: false, model: null, effort: null, models: [], modelsLoading: false, settingsUpdating: false }
  const send = vi.fn()
  vi.stubGlobal('window', { electron: { terminal: { conversationCommand: send } } })
  return { state, send, publish: () => { state.revision++; observeConversationOutbox(structuredClone(state)) } }
}

describe('conversation outbox', () => {
  it.each(['approvals', 'questions', 'needsTerminal', 'settingsUpdating'] as const)('does not bypass %s for live input', (gate) => {
    const { state, send } = setup()
    state.turnId = 'active'
    if (gate === 'approvals') state.approvals = [{ id: 1, itemId: 'tool', kind: 'command', description: 'Approve' }]
    else if (gate === 'questions') state.questions = [{ id: 'q', version: 1, questions: [{ id: 'q', text: 'Answer first', options: [], allowText: true }] }]
    else state[gate] = true
    enqueueConversationMessage(state, 'wait for control')
    expect(send).not.toHaveBeenCalled()
    expect(conversationOutbox(state.id)[0].status).toBe('queued')
  })
  it('serializes IPC but dispatches during the active turn and deduplicates identical prompts by fresh native identity', async () => {
    const { state, send, publish } = setup()
    let resolve!: (value: ConversationSnapshot) => void
    send.mockImplementation(() => new Promise<ConversationSnapshot>(r => { resolve = r }))
    enqueueConversationMessage(state, 'same')
    enqueueConversationMessage(state, 'same')
    expect(conversationOutbox(state.id).map(item => item.status)).toEqual(['sending', 'queued'])
    expect(send).toHaveBeenCalledTimes(1)
    state.turnId = 'turn-1'
    state.items.push({ id: 'native-1', turnId: 'turn-1', type: 'userMessage', text: 'same', status: 'completed' })
    publish(); resolve(structuredClone(state))
    await vi.waitFor(() => expect(conversationOutbox(state.id)).toHaveLength(1))
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2))
    expect(conversationOutbox(state.id)[0].status).toBe('sending')
    state.turnId = 'turn-2'; state.items.push({ id: 'native-2', turnId: 'turn-2', type: 'userMessage', text: 'same', status: 'completed' })
    publish(); resolve(structuredClone(state))
    await vi.waitFor(() => expect(conversationOutbox(state.id)).toEqual([]))
  })

  it('retains failed text, stops following messages and never retries uncertain delivery', async () => {
    const { state, send, publish } = setup()
    send.mockRejectedValue(new Error('delivery unknown'))
    enqueueConversationMessage(state, 'first')
    enqueueConversationMessage(state, 'second')
    await vi.waitFor(() => expect(conversationOutbox(state.id).map(item => item.status)).toEqual(['failed', 'failed']))
    publish(); publish()
    expect(send).toHaveBeenCalledTimes(1)
    expect(conversationOutbox(state.id).map(item => item.text)).toEqual(['first', 'second'])
  })

  it('does not send queued text into a different thread or control epoch, and permits recovering queued text', () => {
    const { state, send, publish } = setup()
    state.turnId = 'busy'
    state.capabilities = { ...state.capabilities, liveInput: false }
    enqueueConversationMessage(state, 'keep')
    const first = conversationOutbox(state.id)[0]
    removeOutgoingMessage(state.id, first.id)
    expect(conversationOutbox(state.id)).toEqual([])
    enqueueConversationMessage(state, 'old thread')
    state.turnId = null; state.threadId = 'new'; state.controlEpoch++; publish()
    expect(send).not.toHaveBeenCalled()
    expect(conversationOutbox(state.id)[0]).toMatchObject({ status: 'failed', text: 'old thread' })
  })

  it('keeps an accepted bubble until native echo arrives, then replaces it without resending', async () => {
    const { state, send, publish } = setup()
    state.items = [{ id: 'old', turnId: 'old', text: 'same', type: 'userMessage', status: 'completed' }]
    send.mockResolvedValue(structuredClone(state))
    enqueueConversationMessage(state, 'same')
    await vi.waitFor(() => expect(conversationOutbox(state.id)[0].status).toBe('accepted'))
    enqueueConversationMessage(state, 'later')
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2))
    state.turnId = 'new'
    state.items.push({ id: 'new', turnId: 'new', text: 'same', type: 'userMessage', status: 'completed' }); publish()
    expect(conversationOutbox(state.id).map(item => item.text)).toEqual(['later'])
    expect(send).toHaveBeenCalledTimes(2)
  })

  it('ignores an old process response after the runtime restarts', async () => {
    const { state, send } = setup()
    let resolve!: (snapshot: ConversationSnapshot) => void
    send.mockImplementation(() => new Promise<ConversationSnapshot>(r => { resolve = r }))
    bindConversationOutbox(state.id, 10)
    enqueueConversationMessage(state, 'old runtime')
    bindConversationOutbox(state.id, 20)
    const restarted = { ...state, revision: 0, threadId: 'restarted' }
    observeConversationOutbox(restarted)
    resolve({ ...state, revision: 100 })
    await Promise.resolve(); await Promise.resolve()
    expect(conversationOutbox(state.id)[0]).toMatchObject({ text: 'old runtime', status: 'failed' })
    removeOutgoingMessage(state.id, conversationOutbox(state.id)[0].id)
    enqueueConversationMessage(restarted, 'new runtime')
    expect(send).toHaveBeenCalledTimes(2)
    resolve({ ...restarted, turnId: 'new-turn' })
  })
  it('holds explicit queue entries until idle, and retains references on failed delivery', async () => {
    const { state, send, publish } = setup()
    state.turnId = 'active'
    const references = [{ id: 'image', name: 'screen.png', path: 'C:/screen.png', kind: 'image' as const }]
    enqueueConversationMessage(state, 'Prompt and context', 'queue', ['C:/screen.png'], references, 'Prompt')
    expect(send).not.toHaveBeenCalled()
    state.turnId = null; send.mockRejectedValue(new Error('unknown delivery')); publish()
    await vi.waitFor(() => expect(conversationOutbox(state.id)[0].status).toBe('failed'))
    expect(conversationOutbox(state.id)[0]).toMatchObject({ references, draftText: 'Prompt', imagePaths: ['C:/screen.png'] })
    publish(); expect(send).toHaveBeenCalledTimes(1)
  })
  it('fails waiting steering when the bound turn finishes before dispatch', () => {
    const { state, send, publish } = setup()
    state.turnId = 'active'; state.settingsUpdating = true
    enqueueConversationMessage(state, 'Correct this turn', 'steer')
    state.turnId = null; state.settingsUpdating = false; publish()
    expect(send).not.toHaveBeenCalled()
    expect(conversationOutbox(state.id)[0].status).toBe('failed')
  })

})
