import { randomUUID } from 'node:crypto'
import { readdir, readFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { SerialQueue, writeFileAtomic } from '../lib/atomic-file'
import { applyMemoOperations, memoSchema, readMemoFile, type Memo, type MemoEdit, type MemoPoint } from '../../shared/memo'

type Change = { id: string; revision: number | null }
export class MemoStore {
  private readonly queue = new SerialQueue()
  private readonly listeners = new Set<(change: Change) => void>()
  constructor(private readonly directory: string) {}
  subscribe(listener: (change: Change) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  private path(id: string): string { return join(this.directory, `${z.string().uuid().parse(id)}.json`) }
  private async read(id: string, migrate = true): Promise<Memo> {
    const raw = JSON.parse(await readFile(this.path(id), 'utf8'))
    let memo = readMemoFile(raw)
    if (memo.id !== id) throw new Error('Memo identity mismatch')
    if (migrate && raw.version !== 3) {
      memo = { ...memo, revision: memo.revision + 1, updatedAt: Date.now() }
      await writeFileAtomic(this.path(id), JSON.stringify(memo, null, 2))
      this.changed({ id, revision: memo.revision })
    }
    return memo
  }
  get(id: string): Promise<Memo> { return this.queue.run(() => this.read(id)) }
  getReadOnly(id: string): Promise<Memo> { return this.queue.run(() => this.read(id, false)) }
  list(): Promise<Memo[]> {
    return this.queue.run(async () => {
      let files: string[]
      try { files = await readdir(this.directory) }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error }
      const memos = await Promise.all(files.filter(file => /^[a-f0-9-]{36}\.json$/i.test(file)).map(file => this.read(file.slice(0, -5))))
      return memos.sort((a, b) => b.updatedAt - a.updatedAt)
    })
  }
  create(title: string, canWrite: () => boolean = () => true): Promise<Memo> {
    return this.queue.run(async () => {
      if (!canWrite()) throw new Error('Memo creation disabled or cancelled')
      const now = Date.now()
      const memo = memoSchema.parse({ version: 3, id: randomUUID(), title, revision: 0, createdAt: now, updatedAt: now, nodes: [] })
      await writeFileAtomic(this.path(memo.id), JSON.stringify(memo, null, 2))
      this.changed({ id: memo.id, revision: memo.revision })
      return memo
    })
  }
  edit(id: string, edit: MemoEdit, source?: MemoPoint['source'], canWrite: () => boolean = () => true): Promise<Memo> {
    return this.queue.run(async () => {
      const current = await this.read(id)
      if (!canWrite()) throw new Error('Memo editing disabled or cancelled')
      const next = applyMemoOperations(current, edit, randomUUID, source)
      await writeFileAtomic(this.path(id), JSON.stringify(next, null, 2))
      this.changed({ id, revision: next.revision })
      return next
    })
  }
  remove(id: string, expectedRevision: number): Promise<void> {
    return this.queue.run(async () => {
      if ((await this.read(id)).revision !== expectedRevision) throw new Error('MEMO_CONFLICT: read the current revision before deleting')
      await unlink(this.path(id))
      this.changed({ id, revision: null })
    })
  }
  private changed(change: Change): void { for (const listener of this.listeners) listener(change) }
}
