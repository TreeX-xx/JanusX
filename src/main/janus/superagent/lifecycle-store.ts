// Note: resident instances, recovery and confirmed stops — see .agents/notes/agent/superagent-lifecycle.md
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { SerialQueue } from '../../lib/atomic-file'
import { identity } from './schema'
import { writeRecordAtomic, type AtomicWriter } from './persistence'

export const WORKER_IDLE_MS = 30 * 60 * 1000
const time = z.number().int().nonnegative().safe()
const entrySchema = z.object({
  workspaceId: identity, workId: z.string().uuid(), executionId: z.string().uuid(), instanceId: identity,
  conversationId: identity, cwd: z.string().min(1),
  phase: z.enum(['starting', 'running', 'waiting', 'idle', 'ready', 'stopping', 'stopped', 'failed', 'interrupted']),
  stopConfirmed: z.boolean(), idleSince: time.optional(), retiredAt: time.optional(),
  diagnostic: z.string().optional(), recovery: z.enum(['resumed', 'rebuilt']).optional(), updatedAt: time,
}).strict().refine(row => row.retiredAt === undefined || (row.stopConfirmed && row.phase === 'ready'), 'Only confirmed ready instances can retire')
const schema = z.object({ version: z.literal(1), entries: z.array(entrySchema) }).strict()
export type SuperAgentLifecycleEntry = z.infer<typeof entrySchema>

/** Durable process ownership is conservative: a missing stop receipt never becomes a free environment. */
export class SuperAgentLifecycleStore {
  readonly path: string
  private queue = new SerialQueue()
  private data?: z.infer<typeof schema>
  constructor(directory: string, private readonly write: AtomicWriter = writeRecordAtomic) { this.path = join(directory, 'lifecycle.json') }
  private async load() {
    if (this.data) return this.data
    let raw: string
    try { raw = await readFile(this.path, 'utf8') }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return this.data = { version: 1 as const, entries: [] }; throw error }
    try {
      const data = schema.parse(JSON.parse(raw))
      if (new Set(data.entries.map(row => row.workId)).size !== data.entries.length) throw new Error('Duplicate lifecycle identity')
      return this.data = data
    } catch (error) { throw new Error('Worker lifecycle records are damaged or unsupported; original file preserved. Execution is blocked.', { cause: error }) }
  }
  snapshot() { return this.queue.run(async () => structuredClone((await this.load()).entries)) }
  private async save(data: z.infer<typeof schema>) {
    const validated = schema.parse(data)
    try { await this.write(this.path, JSON.stringify(validated)) } catch (error) { this.data = undefined; throw error }
    this.data = validated
  }
  begin(value: SuperAgentLifecycleEntry) {
    const row = entrySchema.parse(value)
    return this.queue.run(async () => {
      const data = structuredClone(await this.load()), old = data.entries.find(item => item.workId === row.workId)
      if (old && (!old.stopConfirmed || old.workspaceId !== row.workspaceId)) throw new Error('Previous execution stop is unconfirmed; its environment remains occupied')
      data.entries = data.entries.filter(item => item.workId !== row.workId); data.entries.push(row)
      await this.save(data)
    })
  }
  update(workId: string, executionId: string, change: Partial<Pick<SuperAgentLifecycleEntry, 'phase' | 'stopConfirmed' | 'idleSince' | 'retiredAt' | 'diagnostic' | 'recovery' | 'updatedAt'>>, expectedIdleSince?: number) {
    return this.queue.run(async () => {
      const data = structuredClone(await this.load()), index = data.entries.findIndex(row => row.workId === workId && row.executionId === executionId)
      if (index < 0) return false // A late event cannot overwrite a later execution.
      const before = data.entries[index]
      if (expectedIdleSince !== undefined && (before.phase !== 'ready' || !before.stopConfirmed || before.idleSince !== expectedIdleSince)) return false
      const after = entrySchema.parse({ ...before, ...change, workId, executionId })
      if (JSON.stringify(before) === JSON.stringify(after)) return true
      data.entries[index] = after; await this.save(data); return true
    })
  }
  close() { return this.queue.run(async () => {}) }
}
