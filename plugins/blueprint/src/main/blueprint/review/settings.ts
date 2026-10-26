// Note: immediate settings persistence — see .agents/notes/blueprint/maintenance/note-content-review.md
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { blueprintReviewSettingsSchema, DEFAULT_BLUEPRINT_REVIEW_SETTINGS, type BlueprintReviewSettings } from '../../../shared/blueprint-review-settings'
import { NativeServiceError, SerialQueue, writeFileAtomic } from '@janusx/plugin-sdk/native'

const revision = (settings: BlueprintReviewSettings) => createHash('sha256').update(JSON.stringify(settings)).digest('hex')

export class ReviewSettingsStore {
  private readonly queue = new SerialQueue()
  constructor(readonly path: string) {}
  async read(): Promise<BlueprintReviewSettings> {
    try { return blueprintReviewSettingsSchema.parse(JSON.parse(await readFile(this.path, 'utf8'))) } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return structuredClone(DEFAULT_BLUEPRINT_REVIEW_SETTINGS)
      throw error
    }
  }
  async snapshot() { const value = await this.read(); return { value, revision: revision(value) } }
  update(input: unknown, expectedRevision?: string): Promise<BlueprintReviewSettings> {
    const settings = blueprintReviewSettingsSchema.parse(input)
    return this.queue.run(async () => {
      if (expectedRevision !== undefined && revision(await this.read()) !== expectedRevision) throw new NativeServiceError('RESOURCE_CHANGED')
      await writeFileAtomic(this.path, JSON.stringify(settings, null, 2) + '\n')
      return settings
    })
  }
}
