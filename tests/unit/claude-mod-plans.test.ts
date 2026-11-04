import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { expect, it, vi } from 'vitest'

async function fixture() {
  const source = readFileSync('src/main/terminal/claude-mod.js', 'utf8')
    .replace("import { endpoint, token, terminalId } from './connection.js'", "const endpoint = '', token = '', terminalId = 'fixture'")
    .replace('export function register', 'function register')
  const context: any = {}
  runInNewContext(source, context)
  const hooks = new Map<string, any>()
  context.register((name: string, ...args: any[]) => hooks.set(name, args.at(-1)))
  const events: any[] = []
  let flush!: () => Promise<void>
  const $ = {
    session: { id: async () => 'session', model: async () => 'sonnet' },
    env: { get: async () => undefined },
    clock: { every: (_ms: number, fn: () => Promise<void>) => { flush = fn } },
    tool: { call: vi.fn().mockResolvedValue({ result: { tasks: [{ subject: 'Confirmed task', status: 'pending' }] } }) },
    http: { fetch: async (_url: string, request: { body: string }) => {
      const body = JSON.parse(request.body); events.push(...body.events)
      return { ok: true, text: JSON.stringify({ seq: body.events.at(-1)?.seq ?? 0 }) }
    } },
  }
  const emit = (name: string, event: object, result: object = {}) => hooks.get(name)($, event, async () => result)
  await emit('session.start', {})
  await emit('turn.start', { turnId: 't', text: 'test' })
  return { $, emit, hooks, readAll: async () => { await flush(); return events }, read: async () => { await flush(); return events.filter(event => event.type.startsWith('plan.')) } }
}

it('captures batched prompts before downstream starts the turn and removes rejected inputs', async () => {
  const { $, emit, hooks, readAll } = await fixture()
  await emit('prompt.submit', { text: 'rejected', origin: { kind: 'composer' } }, { drop: 'rejected' })
  await emit('prompt.submit', { text: 'first', origin: { kind: 'composer' } })
  await hooks.get('prompt.submit')($, { text: 'second', origin: { kind: 'composer' } }, async () => {
    await emit('turn.start', { turnId: 'batch', text: 'second' })
    return {}
  })
  expect((await readAll()).find(event => event.type === 'turn.start' && event.data.turnId === 'batch')?.data.inputs).toEqual(['first', 'second'])
  await emit('turn.start', { turnId: 'later', text: 'later' })
  expect((await readAll()).find(event => event.type === 'turn.start' && event.data.turnId === 'later')?.data.inputs).toEqual([])
})

it('forwards step chunks and return values intact, completing only finished root steps', async () => {
  const { $, hooks, readAll } = await fixture()
  const chunks = [{ kind: 'text', index: 0, text: 'Inspecting' }, { kind: 'tool', id: 'read', name: 'Read' }]
  const result = { stopReason: 'tool_use' }
  async function* source() { yield* chunks; return result }
  const stream = hooks.get('turn.step')($, { turnId: 't', index: 0 }, source)
  expect((await stream.next()).value).toBe(chunks[0])
  expect((await readAll()).some(event => event.type === 'step.complete')).toBe(false)
  expect((await stream.next()).value).toBe(chunks[1])
  expect(await stream.next()).toEqual({ done: true, value: result })
  const child = hooks.get('turn.step')($, { turnId: 'child', index: 0, agentId: 'child' }, source)
  for await (const _chunk of child) { /* native stream is still consumed */ }
  const interrupted = hooks.get('turn.step')($, { turnId: 't', index: 1 }, source)
  await interrupted.next(); await interrupted.return()
  async function* abortedSource() { yield chunks[0]; return { stopReason: null } }
  const aborted = hooks.get('turn.step')($, { turnId: 't', index: 2 }, abortedSource)
  await aborted.next(); await aborted.next()
  expect((await readAll()).filter(event => event.type === 'step.complete').map(event => event.data)).toEqual([{ turnId: 't', step: 0 }])
})

it('captures bounded native activity descriptions without copying child prompts or output', async () => {
  const { emit, readAll } = await fixture()
  await emit('tool.call', { tool: 'Read', tool_use_id: 'read', file_path: 'src/main.ts' }, { text: 'Large file result' })
  await emit('tool.call', { tool: 'Agent', tool_use_id: 'agent', description: 'Inspect\nfrontend', prompt: 'Do not project child instructions' })
  await emit('tool.call', { tool: 'Bash', tool_use_id: 'long', command: 'x'.repeat(400) })
  const starts = (await readAll()).filter(event => event.type === 'tool.start')
  expect(starts.map(event => event.data.activity)).toEqual(['Read · src/main.ts', 'Agent · Inspect frontend', ('Bash · ' + 'x'.repeat(400)).slice(0, 240)])
  expect(JSON.stringify(starts)).not.toContain('Do not project child instructions')
})

it('reads native tasks only after successful root mutations and preserves last confirmed state on read failure', async () => {
  const { $, emit, read } = await fixture()
  await emit('tool.call', { tool: 'TaskUpdate', tool_use_id: 'failed' }, { result: { success: false } })
  await emit('tool.call', { tool: 'TaskCreate', tool_use_id: 'denied' }, { deny: 'Denied', result: { task: { id: '1' } } })
  await emit('tool.call', { tool: 'TaskCreate', tool_use_id: 'child', agentId: 'child' }, { result: { task: { id: '1' } } })
  expect($.tool.call).not.toHaveBeenCalled()
  expect(await read()).toEqual([])
  await emit('tool.call', { tool: 'TaskCreate', tool_use_id: 'create', subject: 'Unconfirmed input' }, { result: { task: { id: '1' } } })
  expect((await read()).at(-1)).toMatchObject({ type: 'plan.updated', data: { turnId: 't', plan: [{ step: 'Confirmed task', status: 'pending' }] } })
  $.tool.call.mockRejectedValueOnce(new Error('Unavailable'))
  await emit('tool.call', { tool: 'TaskUpdate', tool_use_id: 'update' }, { result: { success: true } })
  expect((await read()).at(-1)).toMatchObject({ type: 'plan.unavailable', data: { turnId: 't' } })
  $.tool.call.mockResolvedValueOnce({ result: { tasks: [] } })
  await emit('tool.call', { tool: 'TaskUpdate', tool_use_id: 'delete' }, { result: { success: true } })
  expect((await read()).at(-1)?.data.plan).toEqual([])
  await emit('turn.complete', { turnId: 't', reason: 'answer' })
  await emit('turn.start', { turnId: 'next', text: 'continue' })
  expect((await read()).at(-1)?.data.turnId).toBe('next')
})

it('uses TodoWrite saved output, carries unfinished todos and clears them without parsing prose', async () => {
  const { $, emit, read } = await fixture()
  const event = { tool: 'TodoWrite', tool_use_id: 'todo', todos: [{ content: 'Unconfirmed', status: 'completed' }] }
  await emit('tool.call', event, { isError: true })
  expect(await read()).toEqual([])
  await emit('tool.call', event, { result: { newTodos: [{ content: 'Saved', status: 'in_progress' }] } })
  await emit('turn.complete', { turnId: 't', reason: 'aborted' })
  await emit('turn.start', { turnId: 'next', text: 'continue' })
  expect((await read()).at(-1)).toMatchObject({ data: { turnId: 'next', plan: [{ step: 'Saved', status: 'inProgress' }] } })
  await emit('tool.call', event, { result: { newTodos: [{ content: 'Malformed', status: 'unknown' }] } })
  expect((await read()).at(-1)?.type).toBe('plan.unavailable')
  await emit('tool.call', event, { result: { newTodos: [] } })
  expect((await read()).at(-1)?.data.plan).toEqual([])
  expect($.tool.call).not.toHaveBeenCalled()
})
