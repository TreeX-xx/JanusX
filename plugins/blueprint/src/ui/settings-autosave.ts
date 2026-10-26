// Note: settings apply without a save action — .agents/notes/blueprint/maintenance/note-content-review.md
import { blueprintReviewSettingsSchema, type BlueprintReviewSettings, type BlueprintSettingsSnapshot } from '../shared/blueprint-review-settings'

export type SettingsSaveState = { phase: 'pending' | 'saving' | 'saved' | 'invalid' | 'failed'; snapshot?: BlueprintSettingsSnapshot; error?: string }

/** Coalesce typing, serialize writes and stop on conflict; failed submissions are never replayed. */
export class SettingsAutosave {
  private pending?: BlueprintReviewSettings
  private timer?: ReturnType<typeof setTimeout>
  private running = false
  private stopped = false
  private disposed = false
  constructor(public base: BlueprintSettingsSnapshot,
    private persist: (value: BlueprintReviewSettings, revision: string) => Promise<BlueprintSettingsSnapshot>,
    private changed: (state: SettingsSaveState) => void) {}
  get saving() { return this.running }

  change(value: BlueprintReviewSettings, delay = 350) {
    clearTimeout(this.timer)
    this.pending = structuredClone(value)
    if (this.stopped || this.disposed) return
    if (!blueprintReviewSettingsSchema.safeParse(value).success) {
      this.changed({ phase: 'invalid' }); return
    }
    this.changed({ phase: 'pending' })
    this.timer = setTimeout(() => { this.timer = undefined; void this.flush() }, delay)
  }
  pause() { this.stopped = true; clearTimeout(this.timer) }
  reset(base: BlueprintSettingsSnapshot) {
    this.base = base; this.pending = undefined; this.stopped = false; clearTimeout(this.timer)
  }
  dispose() { this.disposed = true; clearTimeout(this.timer) }
  private async flush() {
    if (this.running || this.stopped || this.disposed || !this.pending) return
    const parsed = blueprintReviewSettingsSchema.safeParse(this.pending)
    if (!parsed.success) { this.changed({ phase: 'invalid' }); return }
    const value = parsed.data
    this.pending = undefined
    this.running = true
    this.changed({ phase: 'saving' })
    try {
      this.base = await this.persist(value, this.base.revision)
      if (!this.disposed) this.changed({ phase: 'saved', snapshot: this.base })
    } catch (cause) {
      this.stopped = true
      if (!this.disposed) this.changed({ phase: 'failed', error: String(cause) })
    } finally {
      this.running = false
      if (!this.timer && this.pending) void this.flush()
    }
  }
}
