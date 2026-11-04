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
  const events: any[] = [], commands: any[] = []
  let flush!: () => Promise<void>, wake!: (value: any) => void
  const $ = {
    session: { id: async () => 's', model: async () => 'sonnet' },
    env: { get: async () => undefined },
    clock: { every: (_ms: number, fn: () => Promise<void>) => { flush = fn } },
    http: { fetch: vi.fn(async (url: string, request: { body: string }) => {
      if (url === '/question-wait') return new Promise(resolve => { wake = resolve })
      const body = JSON.parse(request.body)
      events.push(...body.events)
      return { ok: true, text: JSON.stringify({ seq: body.events.at(-1)?.seq ?? 0, mode: 'conversation', commands: commands.splice(0) }) }
    }) },
  }
  await hooks.get('session.start')($, {}, async () => ({}))
  await hooks.get('turn.start')($, { turnId: 't' }, async () => ({}))
  await flush()
  const signal = new AbortController()
  const next = Object.assign(vi.fn(async (input: any) => ({ result: input.answers, text: 'Native consumed answer' })), { signal: signal.signal })
  const run = () => hooks.get('tool.call')($, { tool: 'AskUserQuestion', tool_use_id: 'tool', questions: [{ question: 'Choose', options: [{ label: 'Yes' }] }] }, next)
  return { $, events, commands, next, run, signal, flush, wake: (ok = true) => wake({ ok, text: '{}' }) }
}

it('renews native API waits and only completes a question after the native tool accepts its answer', async () => {
  const f = await fixture()
  const pending = f.run()
  await f.flush()
  expect(f.events.some(e => e.type === 'question')).toBe(true)
  f.wake(); await Promise.resolve(); await Promise.resolve()
  expect(f.next).not.toHaveBeenCalled()
  f.commands.push({ id: 'answer', type: 'answer', requestId: 'question:tool', answer: { answers: { Choose: 'Yes' } } })
  await f.flush()
  expect(f.events.some(e => e.type === 'question.resolved')).toBe(false)
  expect(f.next).not.toHaveBeenCalled()
  f.wake()
  await pending; await f.flush()
  expect(f.next).toHaveBeenCalledWith(expect.objectContaining({ answers: { Choose: 'Yes' } }))
  expect(f.events.some(e => e.type === 'tool.complete')).toBe(true)
})

it('does not call a settled continuation after cancellation', async () => {
  const f = await fixture()
  const pending = f.run()
  f.signal.abort(); f.wake(false)
  await pending; await f.flush()
  expect(f.next).not.toHaveBeenCalled()
  expect(f.events.some(e => e.type === 'question.resolved')).toBe(true)
})

it('keeps an already consumed answer when its waiting HTTP connection fails', async () => {
  const f = await fixture()
  const pending = f.run()
  f.commands.push({ id: 'answer', type: 'answer', requestId: 'question:tool', answer: { answers: { Choose: 'Yes' } } })
  await f.flush()
  f.wake(false)
  await pending
  expect(f.next).toHaveBeenCalledTimes(1)
  expect(f.next).toHaveBeenCalledWith(expect.objectContaining({ answers: { Choose: 'Yes' } }))
})

it('releases an unanswered question to native input on transport loss or mode switch', async () => {
  for (const modeSwitch of [false, true]) {
    const f = await fixture()
    const pending = f.run()
    if (modeSwitch) {
      f.commands.push({ id: 'mode', type: 'display-mode', mode: 'terminal' })
      await f.flush()
    }
    f.wake(modeSwitch)
    await pending; await f.flush()
    expect(f.next).toHaveBeenCalledWith(expect.not.objectContaining({ answers: expect.anything() }))
    expect(f.events.some(e => e.type === 'question.native')).toBe(true)
  }
})
