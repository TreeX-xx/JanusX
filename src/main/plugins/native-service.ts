// Note: .agents/notes/planning/blueprint-official-plugin.md — supervised trusted services, not an OS sandbox.
import { randomUUID } from 'node:crypto'
import { NativePeer, NativeServiceError, type JsonValue, type NativeHandler, type NativeTransport } from '@janusx/plugin-sdk'

export interface NativeProcess extends NativeTransport {
  exited(listener: () => void): () => void
  terminate(): void
}
export interface NativeServiceOptions {
  spawn(generation: string): NativeProcess
  host: NativeHandler
  stopped(code: string): void
}

/** One activation owns one process and all pending calls. Shutdown cannot kill shared host sessions. */
export class NativePluginService {
  private process?: NativeProcess
  private peer?: NativePeer
  private unlistenExit?: () => void
  private startup?: Promise<void>
  private stopReason?: string
  private shutdownFlight?: Promise<void>
  constructor(private options: NativeServiceOptions) {}
  start(context: JsonValue): Promise<void> {
    if (this.stopReason) return Promise.reject(new NativeServiceError('SERVICE_STOPPED'))
    return this.startup ??= (async () => {
      try {
        const generation = randomUUID()
        const child = this.options.spawn(generation)
        this.process = child
        this.peer = new NativePeer(child, generation, this.options.host, code => this.stop(code))
        this.unlistenExit = child.exited(() => this.stop('SERVICE_EXITED'))
        await this.peer.call('lifecycle.start', context, undefined, 15_000)
      }
      catch (cause) { this.stop('SERVICE_START_FAILED'); throw cause }
    })()
  }
  async call(method: string, value: JsonValue, signal?: AbortSignal): Promise<JsonValue> {
    if (!this.startup || this.stopReason || this.shutdownFlight) throw new NativeServiceError('SERVICE_STOPPED')
    await this.startup
    if (this.stopReason || !this.peer) throw new NativeServiceError('SERVICE_STOPPED')
    return this.peer.call(method, value, signal)
  }
  onEvent(listener: (name: string, value: JsonValue) => void): () => void {
    if (!this.peer) throw new NativeServiceError('SERVICE_STOPPED')
    return this.peer.onEvent(listener)
  }
  shutdown(): Promise<void> {
    return this.shutdownFlight ??= (async () => {
      if (this.stopReason) return
      try { await this.peer?.call('lifecycle.stop', null, undefined, 3000) }
      finally { this.stop('SERVICE_STOPPED') }
    })()
  }
  stop(code = 'SERVICE_STOPPED'): void {
    if (this.stopReason) return
    this.stopReason = code
    this.peer?.close(); this.unlistenExit?.(); this.process?.terminate()
    this.peer = undefined; this.process = undefined; this.unlistenExit = undefined
    this.options.stopped(code)
  }
}
