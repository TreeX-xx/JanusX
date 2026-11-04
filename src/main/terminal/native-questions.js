// Exclusive ownership: a mode switch releases the request to the native UI.
// Never race a remote answer against an undismissable terminal dialog.
import { randomUUID } from 'node:crypto'
import { setTimeout, clearTimeout } from 'node:timers'

export function nativeQuestions(emit) {
  let mode = 'terminal'
  const pending = new Map()
  function cancel(native = false) {
    for (const entry of pending.values()) entry.finish(native ? { native: true } : { cancelled: true, answers: [] })
  }
  return {
    setMode(value) {
      mode = value
      if (mode === 'terminal') cancel(true)
    },
    cancel,
    answer(command) {
      const entry = pending.get(command.requestId)
      if (!entry) throw new Error('Question expired; check the current request')
      entry.finish(command.answer)
    },
    ask(request, signal, timeout) {
      if (signal?.aborted) return Promise.resolve({ cancelled: true, answers: [] })
      if (mode !== 'conversation') return Promise.resolve({ native: true })
      const id = randomUUID()
      return new Promise(resolve => {
        let timer
        const abort = () => finish({ cancelled: true, answers: [] })
        const finish = value => {
          if (!pending.delete(id)) return
          clearTimeout(timer)
          signal?.removeEventListener('abort', abort)
          emit({ type: 'question-resolved', requestId: id })
          resolve(value)
        }
        pending.set(id, { finish })
        signal?.addEventListener('abort', abort, { once: true })
        if (Number.isFinite(timeout) && timeout > 0) timer = setTimeout(abort, timeout)
        emit({ type: 'question', request: { ...request, id, cancelable: true } })
      })
    },
  }
}
