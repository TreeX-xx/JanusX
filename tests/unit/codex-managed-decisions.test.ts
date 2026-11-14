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
  it('offers explicit scoped approval without persistent policy grants', async () => {
    const { c, wire, emit } = setup()
    emit('item/commandExecution/requestApproval', { itemId: 'cmd', command: 'write', additionalPermissions: { fileSystem: { write: ['outside'] } } })
    expect(c.state.approvals[0].choices!.map(choice => choice.id)).toEqual(['accept', 'acceptForSession', 'decline', 'cancel'])
    expect(c.state.approvals[0].description).toContain('outside')
    await c.command({ type: 'approve', requestId: 1, decision: 'accept', controlEpoch: c.state.controlEpoch })
    expect(wire.managed.send).toHaveBeenCalledWith({ id: 1, result: { decision: 'accept' } })
    await c.dispose()
  })
  it('grants exactly the requested permission for one turn and uses the permission response envelope', async () => {
    const { c, wire, emit } = setup()
    const permissions = { network: { enabled: true }, fileSystem: { write: ['C:/build-cache'] } }
    emit('item/permissions/requestApproval', { itemId: 'permission', cwd: 'C:/work', permissions, reason: 'Build dependencies' })
    expect(c.state.approvals[0].description).toContain('C:/build-cache')
    expect(c.state.approvals[0].permissionScope).toBe('turn')
    await c.command({ type: 'approve', requestId: 1, decision: 'accept', controlEpoch: c.state.controlEpoch })
    expect(wire.managed.send).toHaveBeenCalledWith({ id: 1, result: { permissions, scope: 'turn' } })
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


it('adapts native legacy patch approval using conversationId and the original response enum', async () => {
  const { c, wire } = setup()
  await wire.receiveManaged({ id: 70, method: 'applyPatchApproval', params: { conversationId: 'thread', callId: 'patch',
    fileChanges: { 'task.txt': { type: 'add', content: 'Task changes' } } } })
  expect(c.state.needsTerminal).toBe(false)
  expect(c.state.approvals[0]).toMatchObject({ id: 70, itemId: 'patch', kind: 'file' })
  await c.command({ type: 'approve', requestId: 70, decision: 'accept', controlEpoch: c.state.controlEpoch })
  expect(wire.managed.send).toHaveBeenCalledWith({ id: 70, result: { decision: 'approved' } })
  await c.dispose()
})

it('projects a native descendant approval into its owning Worker without switching the native thread', async () => {
  const { c, wire } = setup()
  wire.managed.call = vi.fn(async () => ({ thread: { id: 'child', source: { subAgent: { thread_spawn: { parent_thread_id: 'thread' } } } } }))
  await wire.receiveManaged({ id: 71, method: 'item/fileChange/requestApproval', params: { threadId: 'child', turnId: 'child-turn', itemId: 'patch', reason: 'Edit the assigned work' } })
  expect(c.state.threadId).toBe('thread'); expect(c.state.needsTerminal).toBe(false)
  expect(c.state.approvals[0].description).toContain('child')
  await c.command({ type: 'approve', requestId: 71, decision: 'decline', controlEpoch: c.state.controlEpoch })
  expect(wire.managed.send).toHaveBeenCalledWith({ id: 71, result: { decision: 'decline' } })
  await wire.receiveManaged({ method: 'serverRequest/resolved', params: { requestId: 71 } })
  expect(c.state.approvals).toEqual([])
  await c.dispose()
})

it('clears an unsupported native diagnostic only when its request resolves', async () => {
  const { c, wire, emit } = setup()
  emit('future/request', {}, 72)
  emit('serverRequest/resolved', { requestId: 73 })
  expect(c.state.needsTerminal).toBe(true)
  emit('serverRequest/resolved', { requestId: 72 })
  expect(c.state.needsTerminal).toBe(false); expect(c.state.error).toBeUndefined()
  await c.dispose()
})
