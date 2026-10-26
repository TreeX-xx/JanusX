import { PluginError, type PluginErrorCode } from './errors.js'
import type { PluginApi, PluginCallOptions, PluginStoredValue } from './api.js'
import type { PluginConfiguration } from './configuration.js'

/** The port contains only this instance's broker. It never carries a host IPC channel. */
export function createPluginClient(port: MessagePort, contextRevision: number): { api: PluginApi; close(): void } {
  let sequence = 0
  let closed = false
  const prefix = crypto.randomUUID()
  const pending = new Map<string, { resolve(value: unknown): void; reject(error: Error): void; cleanup(): void }>()
  const subscriptions = new Map<string, (payload: any) => void>()
  const early = new Map<string, unknown[]>()
  const send = (packet: unknown) => { if (!closed) port.postMessage(packet) }
  const call = <T>(method: string, params: unknown, options?: PluginCallOptions): Promise<T> => new Promise((resolve, reject) => {
    if (closed) { reject(new PluginError('INSTANCE_CLOSED', 'Plugin instance is closed.')); return }
    if (options?.signal?.aborted) { reject(new PluginError('CANCELLED', 'Request was cancelled.')); return }
    if (pending.size >= 16) { reject(new PluginError('RATE_LIMITED', 'Too many pending requests.')); return }
    const requestId = `${prefix}:${++sequence}`
    const cancel = (code: 'TIMEOUT' | 'CANCELLED') => {
      pending.get(requestId)?.cleanup(); pending.delete(requestId)
      send({ protocol: 1, type: 'cancel', requestId })
      reject(new PluginError(code, code))
    }
    const abort = () => cancel('CANCELLED')
    const timer = setTimeout(() => cancel('TIMEOUT'), method === 'native.call' ? 30_000 : method === 'workspace.readText' || method === 'documents.readText' || method === 'context.read' ? 10_000 : 5_000)
    const cleanup = () => { clearTimeout(timer); options?.signal?.removeEventListener('abort', abort) }
    pending.set(requestId, { resolve: value => resolve(value as T), reject, cleanup })
    options?.signal?.addEventListener('abort', abort, { once: true })
    try { send({ protocol: 1, type: 'request', requestId, method, params, contextRevision }) } catch {
      cleanup(); pending.delete(requestId); reject(new PluginError('INVALID_REQUEST', 'Request could not be serialized.'))
    }
  })
  const close = () => {
    if (closed) return
    closed = true
    for (const request of pending.values()) { request.cleanup(); request.reject(new PluginError('INSTANCE_CLOSED', 'Plugin instance is closed.')) }
    pending.clear(); subscriptions.clear(); early.clear(); port.close()
  }
  port.onmessage = event => {
    const packet = event.data
    if (!packet || packet.protocol !== 1) return
    if (packet.type === 'event' && packet.event === 'invalidated') { close(); return }
    if (packet.contextRevision !== undefined && packet.contextRevision !== contextRevision) return
    if (packet.type === 'response') {
      const request = pending.get(packet.requestId)
      if (!request) return
      request.cleanup(); pending.delete(packet.requestId)
      if (packet.ok) request.resolve(packet.result)
      else request.reject(new PluginError(packet.error?.code as PluginErrorCode ?? 'INTERNAL_ERROR', packet.error?.message ?? 'Request failed.'))
    } else if (packet.type === 'event' && typeof packet.subscriptionId === 'string') {
      const listener = subscriptions.get(packet.subscriptionId)
      if (listener) listener(packet.payload)
      else if (early.size < 64) {
        const buffered = early.get(packet.subscriptionId) ?? []
        if (buffered.length < 32) buffered.push(packet.payload)
        early.set(packet.subscriptionId, buffered)
      }
    }
  }
  port.onmessageerror = close
  port.start()
  const subscribe = (id: string, listener: (payload: any) => void, options?: PluginCallOptions) => {
    let disposed = false
    const unsubscribe = () => {
      if (disposed) return
      disposed = true; subscriptions.delete(id); early.delete(id)
      options?.signal?.removeEventListener('abort', unsubscribe)
      send({ protocol: 1, type: 'unsubscribe', subscriptionId: id })
    }
    if (options?.signal?.aborted) { unsubscribe(); return unsubscribe }
    subscriptions.set(id, listener)
    for (const payload of early.get(id) ?? []) listener(payload)
    early.delete(id)
    options?.signal?.addEventListener('abort', unsubscribe, { once: true })
    return unsubscribe
  }
  const api: PluginApi = {
    native: {
      call: (params, options) => call('native.call', params, options),
      watch: async (listener, options) => {
        const result = await call<{ subscriptionId: string }>('native.watch', {}, options)
        return subscribe(result.subscriptionId, listener, options)
      },
    },
    tasks: { start: (params, options) => call('tasks.start', params, options), list: options => call('tasks.list', {}, options), cancel: (params, options) => call('tasks.cancel', params, options) },
    network: { fetch: (params, options) => call('network.fetch', params, options) },
    services: { discover: options => call('services.discover', {}, options), call: (params, options) => call('services.call', params, options) },
    events: {
      publish: (params, options) => call('events.publish', params, options),
      subscribe: async (params, listener, options) => {
        const result = await call<{ subscriptionId: string }>('events.subscribe', params, options)
        return subscribe(result.subscriptionId, listener, options)
      },
    },
    configuration: {
      propose: (params, options) => call('configuration.propose', params, options),
      open: options => call('configuration.open', {}, options),
      get: options => call('configuration.get', {}, options),
      watch: async (listener, options) => {
        const result = await call<{ subscriptionId: string; configuration: PluginConfiguration }>('configuration.watch', {}, options)
        const buffered = early.get(result.subscriptionId)
        if (buffered?.length) result.configuration = buffered[buffered.length - 1] as PluginConfiguration
        early.delete(result.subscriptionId)
        return { configuration: result.configuration, unsubscribe: subscribe(result.subscriptionId, listener, options) }
      },
    },
    documents: { readDraft: options => call('documents.readDraft', {}, options), updateDraft: (params, options) => call('documents.updateDraft', params, options), readText: options => call('documents.readText', {}, options), applyEdit: (params, options) => call('documents.applyEdit', params, options) },
    app: { getInfo: options => call('app.getInfo', {}, options) },
    workspace: { openDocument: (params, options) => call('workspace.openDocument', params, options), proposeTerminal: (params, options) => call('workspace.proposeTerminal', params, options),
      listDirectory: (params, options) => call('workspace.listDirectory', params, options), getContext: options => call('workspace.getContext', {}, options), readText: (params, options) => call('workspace.readText', params, options) },
    views: { open: (params, options) => call('views.open', params, options),
      getFrame: options => call('views.getFrame', {}, options),
      requestFrame: (params, options) => call('views.requestFrame', params, options) },
    island: { update: (params, options) => call('island.update', params, options) },
    ui: { showToast: (params, options) => call('ui.showToast', params, options) },
    storage: {
      get: (params, options) => call('storage.get', params, options), set: (params, options) => call('storage.set', params, options), delete: (params, options) => call('storage.delete', params, options),
      watch: async (params, listener, options) => {
        const result = await call<{ subscriptionId: string; values: Record<string, PluginStoredValue> }>('storage.watch', params, options)
        // A batch may arrive before the subscribe response. Fold it into the
        // returned snapshot so callers cannot overwrite a newer callback with
        // the older initial values immediately after awaiting watch().
        for (const batch of early.get(result.subscriptionId) ?? []) {
          for (const [key, value] of Object.entries(batch as Record<string, PluginStoredValue>)) {
            if (params.keys.includes(key) && value.revision > (result.values[key]?.revision ?? -1)) result.values[key] = value
          }
        }
        early.delete(result.subscriptionId)
        const revisions = new Map(Object.entries(result.values).map(([key, value]) => [key, value.revision]))
        const unsubscribe = subscribe(result.subscriptionId, (values: Record<string, PluginStoredValue>) => {
          const fresh: Record<string, PluginStoredValue> = Object.create(null)
          for (const [key, value] of Object.entries(values)) if (params.keys.includes(key) && value.revision > (revisions.get(key) ?? -1)) {
            revisions.set(key, value.revision); fresh[key] = value
          }
          if (Object.keys(fresh).length) listener(fresh)
        }, options)
        return { values: result.values, unsubscribe }
      },
    },
    context: { providers: options => call('context.providers', {}, options), read: (params, options) => call('context.read', params, options), subscribe: async (listener, options) => {
      const result = await call<{ subscriptionId: string }>('context.subscribe', {}, options)
      return subscribe(result.subscriptionId, listener, options)
    } },
  }
  return { api, close }
}

/** Connect to the native carrier's transferred port (or a parent shell). Standalone previews have no bridge. */
export function connectPlugin(): Promise<PluginApi> {
  return new Promise((resolve, reject) => {
    if (window.parent === window && window.location.protocol !== 'janusx-plugin:') { reject(new PluginError('CONTEXT_UNAVAILABLE', 'This page is not hosted by JanusX.')); return }
    const timer = setTimeout(() => { window.removeEventListener('message', receive); reject(new PluginError('TIMEOUT', 'Plugin handshake timed out.')) }, 10_000)
    const receive = (event: MessageEvent) => {
      if (event.source !== window.parent || event.data?.type !== 'janusx:plugin-port' || event.ports.length !== 1
        || !Number.isSafeInteger(event.data.contextRevision) || event.data.contextRevision < 0) return
      clearTimeout(timer); window.removeEventListener('message', receive)
      const client = createPluginClient(event.ports[0], event.data.contextRevision)
      window.addEventListener('pagehide', client.close, { once: true })
      void client.api.app.getInfo().then(() => resolve(client.api), cause => { client.close(); reject(cause) })
    }
    window.addEventListener('message', receive)
  })
}
