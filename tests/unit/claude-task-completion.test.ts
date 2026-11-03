import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { expect, it, vi } from 'vitest'
import { ClaudeConversation } from '../../src/main/terminal/claude-conversation'

function fixture() {
  const source = readFileSync('src/main/terminal/claude-mod.js', 'utf8')
    .replace("import { endpoint, token, terminalId } from './connection.js'", "const endpoint = '', token = '', terminalId = 'fixture'")
    .replace('export function register', 'function register')
  const context: any = {}
  runInNewContext(source, context)
  const hooks = new Map<string, any>()
  context.register((name: string, ...args: any[]) => hooks.set(name === 'ui.render' ? `${name}:${args[0].component}` : name, args.at(-1)))
  const history: any[] = []
  const $ = {
    session: { model: async () => 'sonnet', messages: async () => history },
    turn: { abort: vi.fn().mockResolvedValue({}) },
    clock: { sleep: async () => {} },
    tool: { call: vi.fn().mockResolvedValue({ result: {} }) },
  }
  const emit = (name: string, event: object, result: object = {}) => hooks.get(name)($, event, async () => result)
  const read = (expression: string) => runInNewContext(expression, context)
  const background = async (id = 'job', taskId = 'bjcvnfu29') => {
    await emit('turn.start', { turnId: 't', text: 'test' })
    await emit('tool.call', { tool: 'Bash', tool_use_id: id }, { result: { backgroundTaskId: taskId } })
    history.push({ toolUses: [{ tool_use_id: id, result: { backgroundTaskId: taskId } }] })
    await emit('turn.complete', { turnId: 't', reason: 'answer' })
  }
  const stop = async (toolIds = ['job'], taskIds = ['bjcvnfu29']) => {
    await context.execute($, { id: 'stop', type: 'stop', turnId: 't', toolIds, taskIds })
    return read("executions.get('stop')")
  }
  return { $, emit, read, background, stop }
}

const notification = '<task-notification>\n<task-id>bjcvnfu29</task-id>\n<tool-use-id>job</tool-use-id>\n<status>completed</status>\n<summary>Done</summary>\n</task-notification>'

it('ends background work without rendering the native transcript; user text cannot complete it', async () => {
  const { $, emit, read, background, stop } = fixture()
  await background()
  await emit('prompt.submit', { origin: { kind: 'composer' }, text: notification })
  expect(read('activeTools.size')).toBe(1)
  await emit('prompt.submit', { origin: { kind: 'task-notification' }, text: notification, isMeta: true })
  expect(read('activeTools.size')).toBe(0)
  await emit('ui.render:UserMessage', { props: { task: { id: 'bjcvnfu29', status: 'completed', toolUseId: 'job' } } })
  expect(read("events.filter(e => e.type === 'task.complete')")).toHaveLength(1)
  expect(await stop()).toMatchObject({ ok: true, result: { stopped: [], settled: [{ taskId: 'bjcvnfu29', status: 'completed' }] } })
  expect($.tool.call).not.toHaveBeenCalled()
})

it('does not resurrect a task whose notification beats its background tool result', async () => {
  const { emit, read } = fixture()
  await emit('turn.start', { turnId: 't', text: 'test' })
  await emit('prompt.submit', { origin: { kind: 'task-notification' }, text: notification })
  await emit('tool.call', { tool: 'Bash', tool_use_id: 'job' }, { result: { backgroundTaskId: 'bjcvnfu29' } })
  expect(read('activeTools.size')).toBe(0)
})

it.each(['result', 'throw'])('settles an expired native task (%s) instead of keeping thinking active', async mode => {
  const { $, background, stop, read } = fixture()
  await background()
  const error = '<tool_use_error>No task found with ID: bjcvnfu29</tool_use_error>'
  if (mode === 'throw') $.tool.call.mockRejectedValueOnce(new Error(error))
  else $.tool.call.mockResolvedValueOnce({ isError: true, text: error })
  expect(await stop()).toMatchObject({ ok: true, result: { stopped: [], settled: [{ taskId: 'bjcvnfu29', status: 'missing' }] } })
  expect(read('activeTools.size')).toBe(0)
  expect(read("events.filter(e => e.type === 'task.complete')")).toMatchObject([{ data: { taskId: 'bjcvnfu29', status: 'missing' } }])
})

it.each([
  { deny: 'Permission denied' },
  { deny: '<tool_use_error>No task found with ID: bjcvnfu29</tool_use_error>' },
  { isError: true, text: 'Task stop failed' },
  { isError: true, text: '<tool_use_error>No task found with ID: another-task</tool_use_error>' },
])('preserves genuine stop failures and active work: %j', async error => {
  const { $, background, stop, read } = fixture()
  await background(); $.tool.call.mockResolvedValueOnce(error)
  expect(await stop()).toMatchObject({ ok: false })
  expect(read('activeTools.size')).toBe(1)
})

it('replaces a missing task outcome with a later native completion notification', async () => {
  const { $, emit, background, stop, read } = fixture()
  await background()
  $.tool.call.mockRejectedValueOnce(new Error('No task found with ID: bjcvnfu29'))
  await stop()
  await emit('prompt.submit', { origin: { kind: 'task-notification' }, text: notification })
  expect(read("finishedTasks.get('bjcvnfu29')")).toBe('completed')
  expect(read("events.filter(e => e.type === 'task.complete').map(e => e.data.status)")).toEqual(['missing', 'completed'])
})

it('publishes partial stop success even if a second task refuses to stop', async () => {
  const { $, background, stop, read } = fixture()
  await background(); await background('job2', 'task2')
  $.tool.call.mockResolvedValueOnce({ result: {} }).mockResolvedValueOnce({ deny: 'Permission denied' })
  expect(await stop(['job', 'job2'], ['bjcvnfu29', 'task2'])).toMatchObject({ ok: false })
  expect(read('activeTools.size')).toBe(1)
  expect(read("events.filter(e => e.type === 'task.complete')")).toMatchObject([{ data: { taskId: 'bjcvnfu29', status: 'killed' } }])
})

it.each(['completed', 'failed', 'missing'])('controller settles %s tasks without cancelling another turn or overwriting the outcome', async status => {
  const controller = new ClaudeConversation('claude', vi.fn())
  const wire = controller as any
  controller.state.connection = 'ready'; controller.state.threadId = 'session'
  const emit = (type: string, data: object) => wire.receive({ type, data })
  emit('turn.start', { turnId: 't', text: 'test' })
  emit('tool.start', { turnId: 't', toolUseId: 'job', tool: 'Bash' })
  emit('tool.complete', { toolUseId: 'job', taskId: 'bjcvnfu29' })
  emit('turn.complete', { turnId: 't', reason: 'answer' })
  const { controlEpoch } = await controller.command({ type: 'mode', mode: 'conversation' })
  vi.spyOn(wire, 'call').mockImplementation(async () => {
    emit('turn.start', { turnId: 'later', text: 'continue' })
    return { settled: [{ taskId: 'bjcvnfu29', status }], history: [{ tool_use_id: 'job', result: { backgroundTaskId: 'bjcvnfu29' } }] }
  })
  await controller.command({ type: 'interrupt', controlEpoch })
  expect(controller.state.backgroundTasks).toBe(0)
  expect(controller.state.turnId).toBe('later')
  expect(controller.state.submitting).toBe(false)
  expect(controller.state.items.find(item => item.id === 'tool:job')?.status).toBe(status === 'missing' ? 'interrupted' : status)
  emit('tool.complete', { toolUseId: 'job', taskId: 'bjcvnfu29' })
  expect(controller.state.backgroundTasks).toBe(0)
  await controller.dispose()
})
