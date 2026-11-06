import { describe, expect, it, vi } from 'vitest'
import { CodexConversation } from '../../src/main/terminal/codex-conversation'
import { codexElicitation } from '../../src/main/terminal/codex-elicitation'

function setup() {
  const c = new CodexConversation('managed', () => {}), wire = c as any
  wire.managed = { send: vi.fn(), stop: vi.fn().mockResolvedValue(undefined) }
  wire.attach({ id: 'thread', turns: [] }); c.state.mode = 'conversation'
  const emit = (method: string, params: object, id = 1) => wire.receive({ method, id, params: { threadId: 'thread', ...params } })
  return { c, wire, emit }
}
describe('managed native decisions', () => {
  it('does not offer wider permission or persistent policy grants', async () => {
    const { c, wire, emit } = setup()
    emit('item/commandExecution/requestApproval', { itemId: 'cmd', command: 'write', additionalPermissions: { fileSystem: { write: ['outside'] } } })
    expect(c.state.approvals[0].choices!.map(choice => choice.id)).toEqual(['decline', 'cancel'])
    await expect(c.command({ type: 'approve', requestId: 1, decision: 'accept', controlEpoch: c.state.controlEpoch })).rejects.toThrow()
    expect(wire.managed.send).not.toHaveBeenCalled()
    await c.dispose()
  })
  it('keeps a locally invalid MCP answer editable and accepts an actual form only once', async () => {
    const { c, wire, emit } = setup()
    emit('mcpServer/elicitation/request', { mode: 'form', message: 'Fixture form', requestedSchema: { type: 'object', properties: { count: { type: 'integer', minimum: 1, maximum: 3 } }, required: ['count'] } })
    const question = c.state.questions![0]
    const command = { type: 'answer' as const, requestId: question.id, version: question.version, controlEpoch: c.state.controlEpoch }
    await expect(c.command({ ...command, answer: { answers: [{ id: '$action', selected: ['accept'] }, { id: 'count', selected: [] }] } })).rejects.toThrow('required field')
    expect(c.state.questions![0].status).toBe('pending'); expect(wire.managed.send).not.toHaveBeenCalled()
    const answer = { answers: [{ id: '$action', selected: ['accept'] }, { id: 'count', selected: [], text: '2' }] }
    await c.command({ ...command, answer })
    expect(wire.managed.send).toHaveBeenCalledWith({ id: 1, result: { action: 'accept', content: { count: 2 } } })
    await expect(c.command({ ...command, answer })).rejects.toThrow('already answered')
    emit('serverRequest/resolved', { requestId: 1 })
    expect(c.state.questions).toEqual([])
    await c.dispose()
  })
  it('supports explicit decline/cancel and blocks unsupported schema or request types without a reply', async () => {
    expect(codexElicitation({ mode: 'form', requestedSchema: { type: 'object', properties: { x: { type: 'object' } } } })).toBeNull()
    expect(codexElicitation({ mode: 'form', requestedSchema: { type: 'object', properties: { x: { type: 'string', pattern: '^special$' } } } })).toBeNull()
    const request = codexElicitation({ mode: 'url', message: 'Authorize', url: 'https://example.invalid/auth' })!
    expect(request.result({ cancelled: true, answers: [] })).toEqual({ action: 'cancel', content: null })
    expect(codexElicitation({ mode: 'url', url: 'file:///private' })).toBeNull()
    const { c, wire, emit } = setup()
    emit('future/request', {})
    expect(c.state.needsTerminal).toBe(true); expect(c.state.error).toContain('Stop this worker')
    expect(wire.managed.send).not.toHaveBeenCalled()
    await c.dispose()
  })
})
