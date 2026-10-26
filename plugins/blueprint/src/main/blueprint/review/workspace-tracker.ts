/** Coalesce registration bursts and prevent a late context read reopening a closed root. */
export class ReviewWorkspaceTracker<Context> {
  private readonly pending = new Map<string, object>()
  private stopped = false
  constructor(private readonly context: (root: string) => Promise<Context>,
    private readonly activate: (context: Context) => Promise<unknown>,
    private readonly deactivate: (root: string) => void) {}

  track(root: string, active: boolean): void {
    if (!active) {
      this.pending.delete(root)
      this.deactivate(root)
      return
    }
    if (this.stopped || this.pending.has(root)) return
    const token = {}
    this.pending.set(root, token)
    void this.context(root).then(context => {
      if (this.pending.get(root) === token) return this.activate(context)
      return undefined
    }).catch(() => { /* No readable Note repository; the next root load retries. */ })
      .finally(() => { if (this.pending.get(root) === token) this.pending.delete(root) })
  }

  stop(): void { this.stopped = true; this.pending.clear() }
}
