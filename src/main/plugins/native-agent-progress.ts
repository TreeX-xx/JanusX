import type { NativeAgentProgress } from '@janusx/plugin-sdk'

/** Bounded, best-effort UI progress. At most one RPC is in flight; slow pages coalesce updates. */
export class NativeAgentProgressStream {
  private text = ''
  private phase: NativeAgentProgress['phase'] = 'thinking'
  private tool?: string
  private sequence = 0
  private dirty = false
  private closed = false
  private timer?: ReturnType<typeof setTimeout>
  private flight?: Promise<void>
  constructor(private runId: string, private secret: string | undefined, private tools: string[],
    private send: (value: NativeAgentProgress) => Promise<unknown>) {}

  push(event: { type: string; delta?: string; call?: { name: string } }) {
    if (this.closed) return
    if (event.type === 'text_delta' && event.delta) {
      this.text = (this.text + event.delta).slice(0, 300_000); this.phase = 'answer'; this.tool = undefined
    } else if (event.type === 'tool_execution_start' && event.call && this.tools.includes(event.call.name)) {
      this.phase = 'tool'; this.tool = event.call.name
    } else if (event.type === 'tool_execution_end') { this.phase = 'thinking'; this.tool = undefined }
    else return
    this.dirty = true
    this.schedule()
  }
  private safeText(final: boolean) {
    if (!this.secret) return this.text
    let value = this.text.split(this.secret).join('[redacted]')
    // A credential split between provider deltas must never escape in a partial snapshot.
    if (!final) for (let size = Math.min(this.secret.length - 1, value.length); size > 0; size--) {
      if (this.secret.startsWith(value.slice(-size))) { value = value.slice(0, -size); break }
    }
    return value.slice(0, 300_000)
  }
  private schedule() {
    if (this.closed || this.timer || this.flight || !this.dirty) return
    this.timer = setTimeout(() => { this.timer = undefined; void this.flush(false) }, 250)
  }
  private async flush(final: boolean) {
    if (this.closed || !this.dirty) return
    this.dirty = false
    const value: NativeAgentProgress = { runId: this.runId, sequence: ++this.sequence, text: this.safeText(final), phase: this.phase,
      ...(this.tool ? { tool: this.tool } : {}) }
    this.flight = Promise.resolve().then(() => this.send(value)).then(() => {}, () => { this.close() })
    await this.flight
    this.flight = undefined
    this.schedule()
  }
  async finish(text: string) {
    clearTimeout(this.timer); this.timer = undefined
    await this.flight
    if (this.closed) return
    this.text = text.slice(0, 300_000); this.phase = 'answer'; this.tool = undefined; this.dirty = true
    await this.flush(true)
    this.close()
  }
  close() { this.closed = true; this.dirty = false; clearTimeout(this.timer); this.timer = undefined }
}
