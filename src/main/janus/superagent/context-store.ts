import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { SerialQueue } from '../../lib/atomic-file'
import { identity } from './schema'
import { writeRecordAtomic, type AtomicWriter } from './persistence'

const claim = z.object({ text: z.string().trim().min(1).max(20_000), sourceInputIds: z.array(z.string().uuid()).min(1) }).strict()
export const contextUpdateSchema = z.object({
  workId: z.string().uuid(), expectedWorkRevision: z.number().int().positive().safe(),
  expectedContextRevision: z.number().int().nonnegative().safe(),
  goal: claim, constraints: z.array(claim), coveredInputIds: z.array(z.string().uuid()).min(1),
  aliases: z.array(z.string().trim().min(1).max(160)).default([]),
  files: z.array(z.string().min(1).max(4096).refine(value => !/^(?:[a-z]:|[/\\])|(?:^|[/\\])\.\.(?:[/\\]|$)|[\x00-\x1f]/i.test(value), 'Use a relative code reference, not file access authority')).default([]),
}).strict()
const entrySchema = contextUpdateSchema.omit({ expectedWorkRevision: true, expectedContextRevision: true }).extend({
  workspaceId: identity, revision: z.number().int().positive().safe(), updatedAt: z.number().int().nonnegative().safe(),
}).strict()
const schema = z.object({ version: z.literal(1), entries: z.array(entrySchema) }).strict()
export type SuperAgentContextEntry = z.infer<typeof entrySchema>
export type SuperAgentContextUpdate = z.infer<typeof contextUpdateSchema>

/** Rebuildable Janus interpretations. Original requirements/reports stay in the immutable resource store. */
export class SuperAgentContextStore {
  private queue = new SerialQueue()
  private data?: z.infer<typeof schema>
  readonly path: string
  constructor(directory: string, private readonly write: AtomicWriter = writeRecordAtomic) { this.path = join(directory, 'context.json') }
  private async load() {
    if (this.data) return this.data
    let raw: string
    try { raw = await readFile(this.path, 'utf8') }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return this.data = { version: 1 as const, entries: [] }; throw error }
    try {
      const data = schema.parse(JSON.parse(raw))
      if (new Set(data.entries.map(row => row.workId)).size !== data.entries.length) throw new Error('Duplicate work context')
      return this.data = data
    } catch (error) { throw new Error('Work context is damaged or unsupported; original file preserved. Reconstruct from original input references.', { cause: error }) }
  }
  snapshot() { return this.queue.run(async () => structuredClone((await this.load()).entries)) }
  put(workspaceId: string, value: SuperAgentContextUpdate) {
    const input = contextUpdateSchema.parse(value)
    return this.queue.run(async () => {
      const draft = structuredClone(await this.load()), old = draft.entries.find(row => row.workId === input.workId)
      if ((old?.revision ?? 0) !== input.expectedContextRevision || (old && old.workspaceId !== workspaceId)) throw new Error('Work context changed; read its current card before updating')
      const { expectedContextRevision, expectedWorkRevision: _expected, ...body } = input
      const entry = entrySchema.parse({ ...body, workspaceId, revision: expectedContextRevision + 1, updatedAt: Date.now() })
      draft.entries = draft.entries.filter(row => row.workId !== input.workId); draft.entries.push(entry)
      try { await this.write(this.path, JSON.stringify(draft)) } catch (error) { this.data = undefined; throw error }
      this.data = draft
      return structuredClone(entry)
    })
  }
  close() { return this.queue.run(async () => {}) }
}
