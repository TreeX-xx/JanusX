import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { expect, it, vi } from 'vitest'

function fixture() {
  const source = readFileSync('src/main/terminal/native-questions.js', 'utf8').replace(/^import .*\r?\n/gm, '').replace('export function nativeQuestions', 'function nativeQuestions')
  let id = 0
  const context: any = { randomUUID: () => String(++id), setTimeout, clearTimeout }
  runInNewContext(source, context)
  const emit = vi.fn()
  return { router: context.nativeQuestions(emit), emit }
}
const request = { questions: [{ id: 'q', text: 'Confirm?', options: [{ id: 'yes', label: 'Yes' }] }] }

it('holds the native callback only in conversation mode, consumes one answer and rejects a duplicate', async () => {
  const { router, emit } = fixture()
  expect(await router.ask(request)).toEqual({ native: true })
  expect(emit).not.toHaveBeenCalled()
  router.setMode('conversation')
  const pending = router.ask(request)
  const id = emit.mock.calls[0][0].request.id
  const answer = { answers: [{ id: 'q', selected: ['yes'] }] }
  router.answer({ requestId: id, answer })
  expect(await pending).toEqual(answer)
  expect(emit).toHaveBeenLastCalledWith({ type: 'question-resolved', requestId: id })
  expect(() => router.answer({ requestId: id, answer })).toThrow('expired')
})

it('releases unanswered requests to the terminal on a mode switch and cancels aborted or timed out input', async () => {
  const { router, emit } = fixture()
  router.setMode('conversation')
  const pending = router.ask(request)
  router.setMode('terminal')
  expect(await pending).toEqual({ native: true })
  router.setMode('conversation')
  const abort = new AbortController()
  const next = router.ask(request, abort.signal)
  abort.abort()
  expect(await next).toEqual({ cancelled: true, answers: [] })
  expect(await router.ask(request, undefined, 1)).toEqual({ cancelled: true, answers: [] })
  const count = emit.mock.calls.length
  expect(await router.ask(request, abort.signal)).toEqual({ cancelled: true, answers: [] })
  expect(emit).toHaveBeenCalledTimes(count)
})

it('keeps Pi and DSH untimed questions answerable after hours without replaying an expired request', async () => {
  vi.useFakeTimers()
  try {
    const { router, emit } = fixture()
    router.setMode('conversation')
    const pending = router.ask(request)
    const id = emit.mock.calls[0][0].request.id
    await vi.advanceTimersByTimeAsync(8 * 60 * 60 * 1000)
    const answer = { answers: [{ id: 'q', selected: ['yes'] }] }
    router.answer({ requestId: id, answer })
    expect(await pending).toEqual(answer)
    const abandoned = router.ask(request)
    const oldId = emit.mock.calls.at(-1)![0].request.id
    router.setMode('terminal')
    expect(await abandoned).toEqual({ native: true })
    router.setMode('conversation')
    expect(() => router.answer({ requestId: oldId, answer })).toThrow('expired')
  } finally { vi.useRealTimers() }
})
