import { describe, expect, it } from 'vitest'
import { CodexConversation } from '../../src/main/terminal/codex-conversation'

function setup() {
  const controller = new CodexConversation('retry', () => {})
  const wire = controller as any
  wire.attach({ id: 'main', turns: [] })
  const emit = (method: string, params: object) => wire.receive({ method, params: { threadId: 'main', ...params } })
  emit('turn/started', { turn: { id: 'active' } })
  const retry = () => emit('error', { turnId: 'active', willRetry: true, error: { message: 'Temporary network failure' } })
  retry()
  return { controller, wire, emit, retry }
}

describe('Codex transient error recovery', () => {
  it.each(['item/agentMessage/delta', 'item/reasoning/textDelta', 'item/reasoning/summaryTextDelta', 'item/started', 'item/completed', 'turn/completed'])(
    'clears the warning on current-turn recovery through %s', async method => {
      const { controller, emit } = setup()
      try {
        emit(method, { turnId: 'active', itemId: 'answer', delta: 'Recovered', item: { id: 'answer', type: 'agentMessage', text: 'Recovered' }, turn: { id: 'active', status: 'completed' } })
        expect(controller.state.error).toBeUndefined()
      } finally { await controller.dispose() }
    })

  it('keeps the warning during tool activity, empty output and replayed model items', async () => {
    const { controller, emit, retry } = setup()
    try {
      emit('item/started', { turnId: 'active', item: { id: 'answer', type: 'agentMessage', text: 'Before failure' } })
      retry()
      const events = [
        ['thread/settings/updated', { threadSettings: {} }],
        ['item/agentMessage/delta', { threadId: 'child', turnId: 'active', itemId: 'answer', delta: 'Other thread' }],
        ['item/agentMessage/delta', { turnId: 'old', itemId: 'answer', delta: 'Old output' }],
        ['item/agentMessage/delta', { turnId: 'active', itemId: 'answer', delta: '' }],
        ['item/commandExecution/outputDelta', { turnId: 'active', itemId: 'tool', delta: 'Tool output' }],
        ['item/started', { turnId: 'active', item: { id: 'tool', type: 'commandExecution', command: 'git status' } }],
        ['item/completed', { turnId: 'active', item: { id: 'answer', type: 'agentMessage', text: 'Before failure' } }],
      ] as const
      for (const [method, params] of events) {
        emit(method, params)
        expect(controller.state.retry?.message, method).toBe('Temporary network failure')
      }
    } finally { await controller.dispose() }
  })

  it.each([true, false])('preserves a failed completion (explicit error: %s)', async explicit => {
    const { controller, emit } = setup()
    try {
      emit('turn/completed', { turn: { id: 'active', status: 'failed', ...(explicit ? { error: { message: 'Retry exhausted' } } : {}) } })
      expect(controller.state.items.find(item => item.type === 'turnError')?.text).toBe(explicit ? 'Retry exhausted' : 'Temporary network failure')
      emit('item/agentMessage/delta', { turnId: 'active', itemId: 'answer', delta: 'Late output' })
      expect(controller.state.items.find(item => item.type === 'turnError')?.text).toBe(explicit ? 'Retry exhausted' : 'Temporary network failure')
    } finally { await controller.dispose() }
  })

  it('does not clear a terminal error when output resumes or a successful completion arrives', async () => {
    const { controller, emit } = setup()
    try {
      emit('error', { turnId: 'active', willRetry: false, error: { message: 'Permanent failure' } })
      emit('item/agentMessage/delta', { turnId: 'active', itemId: 'answer', delta: 'Late output' })
      emit('turn/completed', { turn: { id: 'active', status: 'completed' } })
      expect(controller.state.items.find(item => item.type === 'turnError')?.text).toBe('Permanent failure')
    } finally { await controller.dispose() }
  })

  it('ignores old-turn errors and failed completions after a new turn starts', async () => {
    const { controller, emit } = setup()
    try {
      emit('turn/started', { turn: { id: 'next' } })
      emit('error', { turnId: 'active', willRetry: true, error: { message: 'Late failure' } })
      emit('turn/completed', { turn: { id: 'active', status: 'failed', error: { message: 'Late completion' } } })
      expect(controller.state.error).toBeUndefined()
      expect(controller.state.turnId).toBe('next')
    } finally { await controller.dispose() }
  })

  it('clears a retry warning when switching to another native thread', async () => {
    const { controller, wire } = setup()
    try {
      wire.attach({ id: 'new-thread', turns: [] })
      expect(controller.state.error).toBeUndefined()
    } finally { await controller.dispose() }
  })
})
