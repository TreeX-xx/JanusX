import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { SerialQueue } from '../../lib/atomic-file'
import { writeRecordAtomic, type AtomicWriter } from './persistence'
import { identity } from './schema'

export const capacitySchema = z.number().int().positive().safe()
const entrySchema = z.object({
  workspaceId: identity, workId: z.string().uuid(), inputId: z.string().uuid(), conversationId: identity,
  order: z.number().int().nonnegative().safe(), expectedRevision: z.number().int().positive().safe(),
  status: z.enum(['awaiting-approval', 'queued', 'starting', 'running', 'waiting', 'idle', 'ready', 'stopping', 'stopped', 'failed', 'interrupted', 'closed']),
  operationId: z.string().uuid().optional(), executionId: z.string().uuid().optional(), diagnostic: z.string().optional(),
  updatedAt: z.number().int().nonnegative().safe(),
}).strict()
const actionSchema = z.object({
  id: identity, workspaceId: identity, inputId: z.string().uuid(), fingerprint: z.string(),
  kind: z.enum(['new', 'continue', 'stop', 'close', 'reopen', 'stop-all', 'git-merge', 'git-remove']),
  status: z.enum(['applying', 'applied', 'unknown']), workId: z.string().uuid().optional(), error: z.string().optional(),
  inputSequence: z.number().int().positive().safe().optional(), scope: z.enum(['workspace', 'all-workspaces']).optional(),
  targets: z.array(z.object({ workspaceId: identity, workId: z.string().uuid() }).strict()).optional(),
  operationId: z.string().uuid().optional(),
}).strict()
const schema = z.object({ version: z.literal(1), revision: z.number().int().nonnegative().safe(),
  maxConcurrentWorkers: capacitySchema, entries: z.array(entrySchema), actions: z.array(actionSchema),
}).strict()
export type SchedulingDocument = z.infer<typeof schema>

/** One durable ledger for capacity, arrangements and idempotent semantic decisions. No startup replay. */
export class SuperAgentSchedulingStore {
  private data?: SchedulingDocument
  private queue = new SerialQueue()
  constructor(directory: string, private readonly write: AtomicWriter = writeRecordAtomic) { this.path = join(directory, 'scheduling.json') }
  readonly path: string

  private async load(): Promise<SchedulingDocument> {
    if (this.data) return this.data
    let raw: string
    try { raw = await readFile(this.path, 'utf8') }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      return this.data = { version: 1, revision: 0, maxConcurrentWorkers: 2, entries: [], actions: [] }
    }
    try {
      const data = schema.parse(JSON.parse(raw))
      if (new Set(data.entries.map(row => row.workId)).size !== data.entries.length || new Set(data.actions.map(row => row.id)).size !== data.actions.length) throw new Error('Duplicate scheduling identity')
      for (const entry of data.entries) if (['queued', 'awaiting-approval', 'starting', 'running', 'waiting', 'idle', 'stopping'].includes(entry.status)) {
        entry.status = 'interrupted'; entry.diagnostic = 'Restored records only. A new explicit input is required to execute.'
      }
      for (const action of data.actions) if (action.status === 'applying') action.status = 'unknown'
      return this.data = data
    } catch (error) { throw new Error(`SuperAgent scheduling records are damaged or unsupported; original file preserved: ${this.path}`, { cause: error }) }
  }
  snapshot(): Promise<SchedulingDocument> { return this.queue.run(async () => structuredClone(await this.load())) }
  change<T>(update: (draft: SchedulingDocument) => T): Promise<T> {
    return this.queue.run(async () => {
      const draft = structuredClone(await this.load()), result = update(draft)
      draft.revision++
      const validated = schema.parse(draft)
      try { await this.write(this.path, JSON.stringify(validated)) }
      catch (error) { this.data = undefined; throw error }
      this.data = validated
      return structuredClone(result)
    })
  }
}
