import { describe, it, expect, vi } from 'vitest'
import { createServer } from 'node:http'
import { mkdtemp, rm, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ClaudeConversation } from '../../src/main/terminal/claude-conversation'
import { claudeModelOptions } from '../../src/main/terminal/claude-models'
import { conversationOutputGroups } from '../../src/shared/conversation-output'

function setup() {
  const controller = new ClaudeConversation('claude', vi.fn())
  controller.state.threadId = 'session'; controller.state.connection = 'ready'
  const wire = controller as any
  let seq = 0
  const emit = (type: string, data: object) => { const event = { seq: ++seq, type, data }; wire.receive(event); wire.sequence = seq }
  return { controller, wire, emit }
}
describe('Claude conversation control and projection', () => {
  it('keeps denied tools distinct from errors and preserves bounded output metadata', async () => {
    const { controller, emit } = setup()
    emit('tool.start', { turnId: 't', toolUseId: 'denied', tool: 'Read' })
    emit('tool.complete', { toolUseId: 'denied', denied: true, text: 'User denied' })
    expect(controller.state.items.find(item => item.id === 'tool:denied')?.status).toBe('denied')
    emit('tool.start', { turnId: 't', toolUseId: 'large', tool: 'Read' })
    emit('tool.complete', { toolUseId: 'large', truncated: true, text: 'Partial output' })
    expect(controller.state.items.find(item => item.id === 'tool:large')).toMatchObject({ status: 'completed', truncated: true })
    await controller.dispose()
  })
  it('keeps Ultracode separate from effort and confirms native events before updating', async () => {
    const { controller, wire, emit } = setup()
    const { controlEpoch } = await controller.command({ type: 'mode', mode: 'conversation' })
    emit('settings', { model: 'opus', effort: 'medium', override: true })
    await expect(controller.command({ type: 'ultracode', enabled: true, controlEpoch })).rejects.toThrow('unavailable')
    emit('ultracode', { model: 'opus', enabled: false, available: true })
    const call = vi.spyOn(wire, 'call').mockImplementation(async () => {
      expect(controller.state.settingsUpdating).toBe(true)
      expect(controller.state.ultracode?.enabled).toBe(false)
      emit('ultracode', { model: 'opus', enabled: true, available: true })
      return {}
    })
    await controller.command({ type: 'ultracode', enabled: true, controlEpoch })
    expect(call).toHaveBeenCalledWith({ type: 'ultracode', enabled: true })
    expect(controller.state).toMatchObject({ effort: 'medium', settingsOverride: true, ultracode: { enabled: true } })
    call.mockRejectedValueOnce(new Error('Native refused'))
    await expect(controller.command({ type: 'ultracode', enabled: false, controlEpoch })).rejects.toThrow('Native refused')
    expect(controller.state.ultracode?.enabled).toBe(true)
    expect(controller.state.settingsUpdating).toBe(false)
    emit('turn.start', { turnId: 'busy', text: 'work' })
    await expect(controller.command({ type: 'ultracode', enabled: false, controlEpoch })).rejects.toThrow('idle')
    emit('turn.complete', { turnId: 'busy' })
    emit('settings', { model: 'other', effort: 'high', override: true })
    await expect(controller.command({ type: 'ultracode', enabled: true, controlEpoch })).rejects.toThrow('unavailable')
    emit('native.settings', { pending: false })
    expect(controller.state.ultracode).toBeUndefined()
    await controller.dispose()
  })
  it('keeps multi-step prose outside work groups and does not interrupt already completed messages', async () => {
    const { controller, emit } = setup()
    try {
      emit('turn.start', { turnId: 't', text: 'Check files' })
      const text = (step: number, value: string) => emit('chunk', { turnId: 't', step, chunk: { kind: 'text', index: 0, text: value } })
      text(0, 'Inspecting '); text(0, 'files.')
      emit('step.complete', { turnId: 'other', step: 0 })
      expect(controller.state.items.at(-1)?.status).toBe('inProgress')
      emit('step.complete', { turnId: 't', step: 0 })
      emit('tool.start', { turnId: 't', toolUseId: 'read', tool: 'Read', activity: 'Read · src/main.ts' })
      emit('tool.complete', { toolUseId: 'read', text: 'Source content' })
      text(1, 'Found the cause.')
      emit('step.complete', { turnId: 't', step: 1 })
      emit('tool.start', { turnId: 't', toolUseId: 'test', tool: 'Bash', activity: 'Bash · Run tests', command: 'npm test' })
      emit('tool.complete', { toolUseId: 'test', text: 'Passed' })
      text(2, 'Final partial')
      expect(conversationOutputGroups(controller.state.items, 't').map(g => g.process)).toEqual([false, false, true, false, true, false])
      expect(controller.state.items.filter(item => item.type === 'agentMessage').map(item => [item.text, item.status])).toEqual([
        ['Inspecting files.', 'completed'], ['Found the cause.', 'completed'], ['Final partial', 'inProgress'],
      ])
      expect(controller.state.items.find(item => item.id === 'tool:read')?.activity).toBe('Read · src/main.ts')
      emit('turn.complete', { turnId: 't', reason: 'aborted' })
      expect(controller.state.items.filter(item => item.type === 'agentMessage').map(item => item.status)).toEqual(['completed', 'completed', 'interrupted'])
    } finally { await controller.dispose() }
  })
  it('closes stdin for prompt-free control subprocesses instead of waiting for an input timeout', async () => {
    const controller = new ClaudeConversation('control-eof', vi.fn())
    const wire = controller as any
    wire.binary = process.execPath; wire.env = { ...process.env }; wire.cwd = process.cwd()
    try {
      const result = await wire.cli(['-e', "process.stdin.resume(); process.stdin.on('end', () => process.stdout.write('CONTROL_EOF'))"], 4000)
      expect(result.stdout).toBe('CONTROL_EOF')
    } finally { await controller.dispose() }
  })

  it('retains each input in a native batch and accepts live input without waiting for a new turn', async () => {
    const { controller, wire, emit } = setup()
    await controller.command({ type: 'mode', mode: 'conversation' })
    emit('turn.start', { turnId: 'active', text: 'second', inputs: ['first', 'second'] })
    expect(controller.state.items.map(item => item.text)).toEqual(['first', 'second'])
    const reply = vi.spyOn(wire, 'reply').mockResolvedValue({ ok: true })
    const command = { type: 'send' as const, text: 'third', commandId: 'live', controlEpoch: controller.state.controlEpoch }
    await controller.command(command); await controller.command(command)
    expect(reply).toHaveBeenCalledTimes(1)
    expect(reply.mock.calls[0][0]).toMatchObject({ text: 'third', nextTurn: false })
    expect(controller.state.connection).toBe('ready')
    expect(controller.state.turnId).toBe('active')
    await controller.dispose()
  })
  it('projects confirmed task snapshots, preserves unfinished steps and rejects invalid or late updates', async () => {
    const { controller, emit } = setup()
    emit('turn.start', { turnId: 't', text: 'tasks' })
    const plan = [{ step: 'Inspect', status: 'completed' }, { step: 'Test', status: 'inProgress' }]
    emit('plan.updated', { turnId: 't', plan })
    emit('plan.updated', { turnId: 't', plan })
    emit('plan.updated', { turnId: 'other', plan: [] })
    for (const invalid of [[{ step: 'Bad', status: 'deleted' }], [{ step: 'x'.repeat(2001), status: 'pending' }], Array(101).fill(plan[0]), [null]]) {
      emit('plan.updated', { turnId: 't', plan: invalid })
    }
    expect(controller.state.plans).toHaveLength(1)
    emit('plan.unavailable', { turnId: 'other' })
    expect(controller.state.plans?.at(-1)?.stale).toBeUndefined()
    emit('plan.unavailable', { turnId: 't' })
    expect(controller.state.plans?.at(-1)).toMatchObject({ stale: true, steps: plan })
    emit('plan.updated', { turnId: 't', plan })
    expect(controller.state.plans?.at(-1)).toMatchObject({ version: 2, steps: plan })
    expect(controller.state.plans?.at(-1)?.stale).toBeUndefined()
    emit('turn.complete', { turnId: 't', reason: 'aborted' })
    expect(controller.state.plans?.at(-1)).toMatchObject({ outcome: 'interrupted', steps: plan })
    emit('plan.updated', { turnId: 't', plan: [] })
    expect(controller.state.plans).toHaveLength(2)
    emit('turn.start', { turnId: 'next', text: 'continue' })
    emit('plan.unavailable', { turnId: 'next' })
    expect(controller.state.plans?.at(-1)).toMatchObject({ turnId: 'next', version: 1, stale: true, steps: plan })
    emit('plan.updated', { turnId: 'next', plan })
    emit('turn.complete', { turnId: 'next', reason: 'error' })
    expect(controller.state.plans?.at(-1)).toMatchObject({ version: 2, outcome: 'failed', steps: plan })
    await controller.dispose()
  })
  it('bounds task history and keeps an explicit empty version after deletion', async () => {
    const { controller, emit } = setup()
    emit('turn.start', { turnId: 't', text: 'tasks' })
    for (let i = 0; i < 105; i++) emit('plan.updated', { turnId: 't', plan: [{ step: String(i), status: 'pending' }] })
    emit('plan.updated', { turnId: 't', plan: [] })
    emit('turn.complete', { turnId: 't', reason: 'answer' })
    expect(controller.state.plans).toHaveLength(100)
    expect(controller.state.plans?.at(-1)).toMatchObject({ version: 106, steps: [], outcome: 'completed' })
    await controller.dispose()
  })
  it.skipIf(process.platform !== 'win32')('waits for an in-flight native launch before closing and removes its assets', async () => {
    const assetsDir = await mkdtemp(join(tmpdir(), 'claude-launch-close-'))
    const controller = new ClaudeConversation('closing', vi.fn())
    let release!: (value: any) => void
    let dispatched!: () => void
    const dispatching = new Promise<void>(resolve => { dispatched = resolve })
    const cli = vi.spyOn(controller as any, 'cli').mockImplementation(async (...values: any[]) => {
      const args = values[0] as string[]
      if (args[0] === '--version') return { stdout: '2.1.316 (Claude Code)', stderr: '' }
      if (args.includes('--bg')) { dispatched(); return new Promise(resolve => { release = resolve }) }
      return { stdout: '', stderr: '' }
    })
    try {
      const launching = controller.start({ command: 'C:/fixture/claude.exe', args: [], cwd: assetsDir, env: {}, assetsDir })
      const rejected = expect(launching).rejects.toThrow('cancelled')
      await dispatching
      const closing = controller.dispose()
      release({ stdout: 'backgrounded · abcd1234', stderr: '' })
      await closing; await rejected
      expect(cli).toHaveBeenLastCalledWith(['stop', 'abcd1234'], 10000)
      expect(await readdir(assetsDir)).toEqual([])
      expect(controller.state.connection).toBe('closed')
    } finally { await rm(assetsDir, { recursive: true, force: true }) }
  })
  it('reports native stop failure instead of claiming its worker closed', async () => {
    const { controller, wire } = setup()
    wire.short = 'owned'
    vi.spyOn(wire, 'cli').mockRejectedValue(new Error('native unavailable'))
    await expect(controller.dispose()).rejects.toThrow('native unavailable')
    expect(controller.state.connection).toBe('disconnected')
    expect(controller.state.error).toContain('owned could not be stopped')
  })
  it('retries an event batch without duplicating text, rejects other sessions and requires authentication', async () => {
    const { controller, wire } = setup()
    const server = createServer((req, res) => void wire.http(req, res))
    wire.server = server
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const url = `http://127.0.0.1:${(server.address() as any).port}/exchange`
    const body = { terminalId: 'claude', sessionId: 'session', events: [
      { seq: 1, type: 'turn.start', data: { turnId: 't', text: 'hello' } },
      { seq: 2, type: 'chunk', data: { turnId: 't', step: 0, chunk: { kind: 'text', index: 0, text: 'partial' } } },
    ] }
    const post = (value: any, token = wire.token) => fetch(url, { method: 'POST', headers: { 'X-JanusX-Token': token }, body: JSON.stringify(value) })
    try {
      expect((await post(body, 'wrong')).status).toBe(403)
      expect(controller.state.items).toHaveLength(0)
      expect((await post(body)).status).toBe(200)
      expect((await post(body)).status).toBe(200)
      expect(controller.state.items.filter(i => i.type === 'agentMessage').map(i => i.text)).toEqual(['partial'])
      expect((await post({ ...body, sessionId: 'foreign' })).status).toBe(409)
      expect(controller.state.threadId).toBe('session')
      expect(controller.state.connection).toBe('disconnected')
    } finally { await controller.dispose() }
  })
  it('deduplicates sends, preserves failures and rejects stale control or unavailable settings', async () => {
    const { controller, wire, emit } = setup()
    const reply = vi.spyOn(wire, 'reply').mockImplementation(async () => { emit('turn.start', { turnId: 't', text: 'hello' }); return { ok: true } })
    const { controlEpoch } = await controller.command({ type: 'mode', mode: 'conversation' })
    const cmd = { type: 'send' as const, text: 'hello', commandId: 'once', controlEpoch }
    await controller.command(cmd); await controller.command(cmd)
    expect(reply).toHaveBeenCalledTimes(1)
    await expect(controller.command({ ...cmd, text: 'different' })).rejects.toThrow('identity reused')
    await expect(controller.command({ type: 'settings', model: 'haiku', effort: null, controlEpoch })).rejects.toThrow('idle')
    await expect(controller.command({ ...cmd, commandId: 'slash', text: '/model haiku' })).rejects.toThrow('command menu')
    emit('turn.complete', { turnId: 't', reason: 'answer' })
    reply.mockRejectedValueOnce(new Error('Unknown delivery'))
    await expect(controller.command({ ...cmd, commandId: 'unknown' })).rejects.toThrow('Unknown delivery')
    expect(controller.state.connection).toBe('disconnected')
    await expect(controller.command({ ...cmd, commandId: 'unknown' })).rejects.toThrow('not ready')
    expect(reply).toHaveBeenCalledTimes(2)
    expect(controller.acceptsTerminalInput('hidden\r')).toBe(false)
    expect(controller.acceptsTerminalInput('\x1b[1;1R')).toBe(true)
    wire.broken = false; controller.state.connection = 'ready'
    await controller.command({ type: 'mode', mode: 'terminal' })
    await expect(controller.command({ ...cmd, commandId: 'stale' })).rejects.toThrow('Display control changed')
    await controller.dispose()
  })
  it('uses native catalog capabilities and applies settings only after the worker event', async () => {
    const { controller, wire, emit } = setup()
    controller.state.models = claudeModelOptions([
      { resolvedModel: 'opus', displayName: 'Opus', supportsEffort: true, supportedEffortLevels: ['low', 'high', 'max', 'ultra'] },
      { resolvedModel: 'locked', disabled: true },
      { resolvedModel: 'custom', supportsEffort: false },
    ])
    expect(controller.state.models.map(model => [model.model, model.efforts.map(e => e.effort)])).toEqual([['opus', ['low', 'high', 'max']], ['custom', []]])
    const { controlEpoch } = await controller.command({ type: 'mode', mode: 'conversation' })
    const call = vi.spyOn(wire, 'call')
    call.mockImplementation(async () => {
      expect(controller.state.settingsUpdating).toBe(true)
      expect(controller.state.model).toBeNull()
      await expect(controller.command({ type: 'send', text: 'racing', commandId: 'racing', controlEpoch })).rejects.toThrow('busy')
      emit('settings', { model: 'opus', effort: 'max', override: true })
      return {}
    })
    await expect(controller.command({ type: 'settings', model: 'custom', effort: 'max', controlEpoch })).rejects.toThrow('Unsupported')
    await expect(controller.command({ type: 'settings', model: 'locked', effort: null, controlEpoch })).rejects.toThrow('not available')
    await controller.command({ type: 'settings', model: 'opus', effort: 'max', controlEpoch })
    expect(controller.state).toMatchObject({ model: 'opus', effort: 'max', settingsUpdating: false, settingsOverride: true })
    emit('turn.start', { turnId: 't', text: 'next', model: 'native-default' })
    expect(controller.state.model).toBe('opus')
    emit('turn.complete', { turnId: 't' })
    call.mockRejectedValueOnce(new Error('Policy refused'))
    await expect(controller.command({ type: 'settings', model: 'opus', effort: 'low', controlEpoch })).rejects.toThrow('Policy refused')
    expect(controller.state.effort).toBe('max')
    emit('settings', { model: 'native-default', effort: null, override: false })
    expect(controller.state).toMatchObject({ model: 'native-default', effort: null, settingsOverride: false })
    emit('native.settings', { pending: true })
    await expect(controller.command({ type: 'send', text: 'during native dialog', commandId: 'native-pending', controlEpoch })).rejects.toThrow('needs terminal input')
    await expect(controller.command({ type: 'settings', model: 'opus', effort: 'max', controlEpoch })).rejects.toThrow('idle')
    emit('native.settings', { pending: false })
    expect(controller.state.needsTerminal).toBe(false)
    await controller.dispose()
  })
  it('maps only selected native tools to stopping, and never marks an unknown Bash process stopped', async () => {
    const { controller, wire, emit } = setup()
    emit('turn.start', { turnId: 'first', text: 'old' })
    emit('tool.start', { turnId: 'first', toolUseId: 'old', tool: 'Bash', command: 'server' })
    emit('turn.complete', { turnId: 'first', reason: 'answer' })
    emit('turn.start', { turnId: 'second', text: 'new' })
    emit('tool.start', { turnId: 'second', toolUseId: 'current', tool: 'Bash', command: 'sleep' })
    const call = vi.spyOn(wire, 'call').mockImplementation(async () => {
      emit('turn.complete', { turnId: 'second', reason: 'aborted' })
      return { history: [{ tool_use_id: 'current', result: { backgroundTaskId: 'native-task' } }], stopped: ['native-task'] }
    })
    const { controlEpoch } = await controller.command({ type: 'mode', mode: 'conversation' })
    await controller.command({ type: 'interrupt', controlEpoch })
    expect(call).toHaveBeenCalledWith({ type: 'stop', turnId: 'second', toolIds: ['current'], taskIds: [] })
    expect(wire.tools.get('old').active).toBe(true)
    expect(wire.tools.get('current').active).toBe(false)
    call.mockResolvedValueOnce({ history: [{ tool_use_id: 'old', result: { backgroundTaskId: 'old-task' } }], stopped: ['old-task'] })
    await controller.command({ type: 'interrupt', controlEpoch })
    expect(call).toHaveBeenLastCalledWith({ type: 'stop', turnId: 'first', toolIds: ['old'], taskIds: [] })
    emit('turn.start', { turnId: 'unknown', text: 'next' })
    emit('tool.start', { turnId: 'unknown', toolUseId: 'lost', tool: 'Bash', command: 'write' })
    call.mockResolvedValueOnce({ history: [], stopped: [] })
    await expect(controller.command({ type: 'interrupt', controlEpoch })).rejects.toThrow('termination is unknown')
    expect(wire.tools.get('lost').active).toBe(true)
    await controller.dispose()
  })
  it('ends background activity on native task notification without cancelling a later turn', async () => {
    const { controller, emit } = setup()
    emit('turn.start', { turnId: 'first', text: 'background' })
    emit('tool.start', { turnId: 'first', toolUseId: 'job', tool: 'Bash', command: 'build' })
    emit('tool.complete', { toolUseId: 'job', taskId: 'task', text: 'backgrounded' })
    emit('turn.complete', { turnId: 'first', reason: 'answer' })
    emit('turn.start', { turnId: 'second', text: 'continue' })
    expect(controller.state.backgroundTasks).toBe(1)
    emit('task.complete', { taskId: 'task', toolUseId: 'job', status: 'completed' })
    expect(controller.state.backgroundTasks).toBe(0)
    expect(controller.state.turnId).toBe('second')
    expect(controller.state.items.find(item => item.id === 'tool:job')?.status).toBe('completed')
    await controller.dispose()
  })
  it('expires a pending approval when the native tool finishes and stops only its recorded daemon job', async () => {
    const { controller, wire, emit } = setup()
    const response = { writeHead: vi.fn().mockReturnThis(), end: vi.fn(), on: vi.fn() }
    emit('turn.start', { turnId: 't', text: 'file' })
    emit('tool.start', { turnId: 't', toolUseId: 'write', tool: 'Write', path: '/file', text: 'content' })
    await wire.permission({ session_id: 'session', tool_name: 'Write', tool_input: { file_path: '/file' } }, response)
    const approval = controller.state.approvals[0]
    expect(approval).toBeTruthy()
    emit('tool.complete', { toolUseId: 'write', text: 'done' })
    expect(controller.state.approvals).toHaveLength(0)
    expect(response.end).toHaveBeenCalledWith('{}')
    const { controlEpoch } = await controller.command({ type: 'mode', mode: 'conversation' })
    await expect(controller.command({ type: 'approve', requestId: approval.id, decision: 'accept', controlEpoch })).rejects.toThrow('expired')
    wire.short = 'abcd1234'
    const cli = vi.spyOn(wire, 'cli').mockResolvedValue({ stdout: '', stderr: '' })
    await controller.dispose(); await controller.dispose()
    expect(cli).toHaveBeenCalledExactlyOnceWith(['stop', 'abcd1234'], 10000)
  })
})
