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
  private readonly lifetime = new AbortController()
  private cleanup?: () => Promise<void>
  private draining?: Promise<void>
  ownCleanup(close: () => Promise<void>) {
    if (this.cleanup || !this.active) throw new NativeServiceError('INVALID_STATE')
    this.cleanup = close
  }
  private retire() {
    this.lifetime.abort()
    if (this.cleanup) {
      const close = this.cleanup
      this.cleanup = undefined
      this.draining = close()
      // Crashes have no caller at this point. shutdown observes the same outcome.
      void this.draining.catch(() => {})
    }
  }
  private ready = false
  get active() { return this.ready && !this.lifetime.signal.aborted }
  get signal() { return this.lifetime.signal }
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
        this.ready = true
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
      this.retire()
      try {
        if (!this.stopReason) await this.peer?.call('lifecycle.stop', null, undefined, 3000)
      } finally {
        this.stop('SERVICE_STOPPED')
        await this.draining
      }
    })()
  }
  stop(code = 'SERVICE_STOPPED'): void {
    if (this.stopReason) return
    this.stopReason = code
    this.retire()
    this.peer?.close(); this.unlistenExit?.(); this.process?.terminate()
    this.peer = undefined; this.process = undefined; this.unlistenExit = undefined
    this.options.stopped(code)
  }
}
