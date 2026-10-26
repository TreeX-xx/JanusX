// Trusted native services have OS access. This protocol provides lifecycle and fault isolation, not an OS sandbox.
import { z } from 'zod'
import type { JsonValue } from './api.js'

export const NATIVE_PROTOCOL_VERSION = 1
const name = z.string().min(1).max(128).regex(/^[a-zA-Z][a-zA-Z0-9._-]*$/)
export const nativeValueSchema = z.unknown().superRefine((value, context) => {
  let nodes = 0
  const visit = (item: unknown, depth: number): boolean => {
    if (++nodes > 100_000 || depth > 40) return false
    if (item === null || typeof item === 'boolean' || typeof item === 'string') return true
    if (typeof item === 'number') return Number.isFinite(item)
    if (Array.isArray(item)) return item.every(child => visit(child, depth + 1))
    return typeof item === 'object' && item !== null && Object.getPrototypeOf(item) === Object.prototype
      && Object.entries(item).every(([key, child]) => !['__proto__', 'constructor', 'prototype'].includes(key) && visit(child, depth + 1))
  }
  try {
    if (!visit(value, 0) || new TextEncoder().encode(JSON.stringify(value)).length > 4 * 1024 * 1024) throw new Error()
  } catch { context.addIssue({ code: 'custom', message: 'Invalid or oversized native service value' }) }
}).transform(value => value as JsonValue)
const base = { protocol: z.literal(1), generation: z.string().uuid() }
export const nativePacketSchema = z.discriminatedUnion('type', [
  z.object({ ...base, type: z.literal('request'), id: z.string().uuid(), method: name, value: nativeValueSchema }).strict(),
  z.object({ ...base, type: z.literal('result'), id: z.string().uuid(), value: nativeValueSchema }).strict(),
  z.object({ ...base, type: z.literal('failure'), id: z.string().uuid(), code: z.string().regex(/^[A-Z_]{1,64}$/) }).strict(),
  z.object({ ...base, type: z.literal('cancel'), id: z.string().uuid() }).strict(),
  z.object({ ...base, type: z.literal('event'), name, value: nativeValueSchema }).strict(),
])
export type NativePacket = z.infer<typeof nativePacketSchema>
export interface NativeTransport {
  send(packet: NativePacket): void
  listen(listener: (packet: unknown) => void): () => void
}
export type NativeHandler = (method: string, value: JsonValue, signal: AbortSignal) => Promise<JsonValue>
export class NativeServiceError extends Error {
  constructor(readonly code: string) { super(code) }
}

/** Bounded bidirectional requests, with a fresh generation for each activation. */
export class NativePeer {
  private pending = new Map<string, { finish(value: JsonValue): void; fail(error: Error): void }>()
  private running = new Map<string, AbortController>()
  private used = new Set<string>()
  private listeners = new Set<(name: string, value: JsonValue) => void>()
  private closed = false
  private unlisten: () => void
  private events: number[] = []
  constructor(private transport: NativeTransport, readonly generation: string, private handler: NativeHandler,
    private fault: (code: string) => void = () => {}) {
    this.unlisten = transport.listen(packet => { void this.receive(packet) })
  }
  private send(packet: NativePacket): void {
    if (this.closed) throw new NativeServiceError('SERVICE_STOPPED')
    this.transport.send(nativePacketSchema.parse(packet))
  }
  call(method: string, value: JsonValue, signal?: AbortSignal, timeoutMs = 30_000): Promise<JsonValue> {
    if (this.closed || signal?.aborted) return Promise.reject(new NativeServiceError(this.closed ? 'SERVICE_STOPPED' : 'CANCELLED'))
    if (this.pending.size >= 32) return Promise.reject(new NativeServiceError('RATE_LIMITED'))
    const id = crypto.randomUUID()
    return new Promise((resolve, reject) => {
      const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', cancel); this.pending.delete(id) }
      const finish = (value: JsonValue) => { cleanup(); resolve(value) }
      const fail = (error: Error) => { cleanup(); reject(error) }
      const stop = (code: string) => {
        try { this.send({ protocol: 1, generation: this.generation, type: 'cancel', id }) } catch { /* already stopped */ }
        fail(new NativeServiceError(code))
        if (code === 'TIMEOUT') this.fault(code)
      }
      const timer = setTimeout(() => stop('TIMEOUT'), Math.max(1, Math.min(timeoutMs, 600_000)))
      const cancel = () => stop('CANCELLED')
      this.pending.set(id, { finish, fail })
      signal?.addEventListener('abort', cancel, { once: true })
      try { this.send({ protocol: 1, generation: this.generation, type: 'request', id, method, value }) } catch (cause) { fail(cause as Error) }
    })
  }
  onEvent(listener: (name: string, value: JsonValue) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  emit(name: string, value: JsonValue): void { this.send({ protocol: 1, generation: this.generation, type: 'event', name, value }) }
  private async receive(input: unknown): Promise<void> {
    if (this.closed) return
    const parsed = nativePacketSchema.safeParse(input)
    if (!parsed.success) { this.fault('INVALID_NATIVE_PACKET'); return }
    const packet = parsed.data
    if (packet.generation !== this.generation) return
    if (packet.type === 'result') { this.pending.get(packet.id)?.finish(packet.value); return }
    if (packet.type === 'failure') { this.pending.get(packet.id)?.fail(new NativeServiceError(packet.code)); return }
    if (packet.type === 'cancel') { this.running.get(packet.id)?.abort(); return }
    if (packet.type === 'event') {
      const now = Date.now(); this.events = this.events.filter(time => now - time < 1000)
      if (this.events.length >= 100) { this.fault('RATE_LIMITED'); return }
      this.events.push(now)
      for (const listener of this.listeners) { try { listener(packet.name, packet.value) } catch { this.fault('EVENT_LISTENER_FAILED') } }
      return
    }
    if (this.used.has(packet.id) || this.running.size >= 16) {
      try { this.send({ protocol: 1, generation: this.generation, type: 'failure', id: packet.id, code: 'RATE_LIMITED' }) } catch { /* closed */ }
      return
    }
    this.used.add(packet.id)
    if (this.used.size > 4096) this.used.delete(this.used.values().next().value!)
    const controller = new AbortController()
    this.running.set(packet.id, controller)
    try {
      const value = await this.handler(packet.method, packet.value, controller.signal)
      if (!controller.signal.aborted && !this.closed) this.send({ protocol: 1, generation: this.generation, type: 'result', id: packet.id, value })
    } catch (cause) {
      if (!controller.signal.aborted && !this.closed) {
        const code = cause instanceof NativeServiceError && /^[A-Z_]{1,64}$/.test(cause.code) ? cause.code : 'SERVICE_FAILED'
        try { this.send({ protocol: 1, generation: this.generation, type: 'failure', id: packet.id, code }) } catch { this.fault('SERVICE_FAILED') }
      }
    } finally { this.running.delete(packet.id) }
  }
  close(): void {
    if (this.closed) return
    this.closed = true; this.unlisten()
    for (const request of this.pending.values()) request.fail(new NativeServiceError('SERVICE_STOPPED'))
    for (const controller of this.running.values()) controller.abort()
    this.pending.clear(); this.running.clear(); this.used.clear(); this.listeners.clear()
  }
}
