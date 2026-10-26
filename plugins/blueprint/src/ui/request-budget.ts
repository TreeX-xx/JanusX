import { PluginError, type PluginApi, type PluginCallOptions } from '@janusx/plugin-sdk'

/** Keep automatic reads and draft writes within the host's page budget. Never retry a submitted operation. */
export class RequestBudget {
  private queue: Array<{ start(): void; cancel(): void }> = []
  private active = 0
  private nextStart = 0
  private timer?: ReturnType<typeof setTimeout>

  run<T>(work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) return Promise.reject(signal.reason ?? new PluginError('CANCELLED', 'Cancelled before dispatch.'))
    if (this.queue.length >= 64) return Promise.reject(new PluginError('RATE_LIMITED', 'Blueprint request queue is full.'))
    return new Promise<T>((resolve, reject) => {
      const entry = {
        start: () => {
          signal?.removeEventListener('abort', entry.cancel)
          this.active++
          // At most 17 starts/second and 8 outstanding requests; leave room for
          // transport handshakes under the host's 30/second, 16 pending limits.
          this.nextStart = Date.now() + 60
          void Promise.resolve().then(() => { signal?.throwIfAborted(); return work() }).then(resolve, reject).finally(() => { this.active--; this.pump() })
        },
        cancel: () => {
          this.queue = this.queue.filter(value => value !== entry)
          signal?.removeEventListener('abort', entry.cancel)
          reject(signal?.reason ?? new PluginError('CANCELLED', 'Cancelled before dispatch.'))
          if (!this.queue.length) { clearTimeout(this.timer); this.timer = undefined }
        },
      }
      this.queue.push(entry)
      signal?.addEventListener('abort', entry.cancel, { once: true })
      this.pump()
    })
  }

  private pump() {
    if (!this.queue.length || this.active >= 8 || this.timer) return
    const wait = this.nextStart - Date.now()
    if (wait > 0) {
      this.timer = setTimeout(() => { this.timer = undefined; this.pump() }, wait)
      return
    }
    this.queue.shift()!.start()
    this.pump()
  }
}

/** Only the public SDK methods consumed by this feature are scheduled. */
export function paceBlueprintApi(raw: PluginApi): PluginApi {
  const budget = new RequestBudget()
  const run = <T>(work: () => Promise<T>, options?: PluginCallOptions) => budget.run(work, options?.signal)
  return {
    ...raw,
    app: { ...raw.app, getInfo: options => run(() => raw.app.getInfo(options), options) },
    context: { ...raw.context, subscribe: (listener, options) => run(() => raw.context.subscribe(listener, options), options) },
    native: {
      call: (params, options) => run(() => raw.native.call(params, options), options),
      watch: (listener, options) => run(() => raw.native.watch(listener, options), options),
    },
    storage: { ...raw.storage,
      get: (params, options) => run(() => raw.storage.get(params, options), options),
      set: (params, options) => run(() => raw.storage.set(params, options), options),
    },
    configuration: { ...raw.configuration, open: options => run(() => raw.configuration.open(options), options) },
    workspace: { ...raw.workspace,
      getContext: options => run(() => raw.workspace.getContext(options), options),
      openDocument: (params, options) => run(() => raw.workspace.openDocument(params, options), options),
      proposeTerminal: (params, options) => run(() => raw.workspace.proposeTerminal(params, options), options),
    },
  }
}
