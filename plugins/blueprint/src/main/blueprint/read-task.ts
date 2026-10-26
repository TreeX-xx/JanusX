// Note: timed-out reads cannot commit observations — see .agents/notes/blueprint/navigation/note-updates-and-suggestion-navigation.md
export const BLUEPRINT_READ_TIMEOUT_MS = 12_000

export function abortableRead<T>(read: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return read
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
    read.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
    if (signal.aborted) abort()
  })
}

/** One active observation per checkout; a retry never joins an expired task. */
export class BlueprintReadTasks<T> {
  private tasks = new Map<string, { promise: Promise<T>; controller: AbortController }>()
  constructor(private readonly timeoutMs = BLUEPRINT_READ_TIMEOUT_MS) {}
  run(key: string, read: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const previous = this.tasks.get(key)
    if (previous) return previous.promise
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(new Error('BLUEPRINT_SYNC_TIMEOUT')), this.timeoutMs)
    const task = { controller, promise: undefined as unknown as Promise<T> }
    task.promise = abortableRead(Promise.resolve().then(() => read(controller.signal)), controller.signal).finally(() => {
      clearTimeout(timer)
      if (this.tasks.get(key) === task) this.tasks.delete(key)
    })
    this.tasks.set(key, task)
    return task.promise
  }
  close() {
    for (const task of this.tasks.values()) task.controller.abort(new Error('Blueprint reading stopped'))
    this.tasks.clear()
  }
}
