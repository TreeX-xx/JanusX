import type { JsonValue, PluginApi } from '@janusx/plugin-sdk'

/** Keep a view's draft across closing/reopening, without overwriting another page's edits. */
export class Draft {
  private revision = 0
  private queue: Promise<unknown> = Promise.resolve()
  constructor(private storage: PluginApi['storage'], private key: string) {}
  async read() {
    await this.queue.catch(() => {})
    const stored = await this.storage.get({ key: this.key })
    this.revision = stored.revision; this.queue = Promise.resolve()
    return stored.value
  }
  write(value: JsonValue) {
    this.queue = this.queue.then(async () => {
      const result = await this.storage.set({ key: this.key, value, expectedRevision: this.revision })
      this.revision = result.revision
    })
    return this.queue
  }
}
