import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { SerialQueue } from '../../lib/atomic-file'
import type { SuperAgentEnvironmentChange, SuperAgentEnvironmentSnapshot } from '../../../shared/superagent-environment'
import { writeRecordAtomic, type AtomicWriter } from './persistence'
import { parseEnvironmentDocument, type EnvironmentDocument } from './environment-schema'

/** Separate versioned ledger: Git operations and bindings commit together; P1 format stays intact. */
export class SuperAgentEnvironmentStore {
  readonly path: string
  private readonly queue = new SerialQueue()
  private readonly listeners = new Set<(event: SuperAgentEnvironmentChange) => void>()
  private data?: EnvironmentDocument

  constructor(directory: string, private readonly write: AtomicWriter = writeRecordAtomic) {
    this.path = join(directory, 'environments.json')
  }

  private async load(): Promise<EnvironmentDocument> {
    if (this.data) return this.data
    let raw: string
    try { raw = await readFile(this.path, 'utf8') } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return this.data = { version: 1, revision: 0, environments: [], operations: [] }
      throw error
    }
    try { this.data = parseEnvironmentDocument(JSON.parse(raw)) } catch (error) {
      throw new Error(`SuperAgent environment records are damaged or unsupported; original preserved: ${this.path}`, { cause: error })
    }
    for (const operation of this.data.operations) {
      if (operation.status === 'executing') {
        operation.status = 'unknown'
        operation.message = 'Application ended before the Git result was recorded. Inspect the repository before proposing another operation.'
      }
    }
    return this.data
  }

  read(): Promise<EnvironmentDocument> {
    return this.queue.run(async () => structuredClone(await this.load()))
  }

  update<T>(workspaceId: string, change: (draft: EnvironmentDocument) => T): Promise<T> {
    return this.queue.run(async () => {
      const draft = structuredClone(await this.load())
      const result = change(draft)
      draft.revision += 1
      const validated = parseEnvironmentDocument(draft)
      try { await this.write(this.path, JSON.stringify(validated)) } catch (error) { this.data = undefined; throw error }
      this.data = validated
      for (const listener of this.listeners) {
        try { listener({ workspaceId, revision: draft.revision }) } catch (error) { console.error('[superagent] environment notification failed', error) }
      }
      return structuredClone(result)
    })
  }

  async snapshot(workspaceId: string): Promise<SuperAgentEnvironmentSnapshot> {
    const data = await this.read()
    return { workspaceId, revision: data.revision, environments: data.environments.filter(row => row.workspaceId === workspaceId),
      operations: data.operations.filter(row => row.workspaceId === workspaceId) }
  }

  subscribe(listener: (event: SuperAgentEnvironmentChange) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  drain(): Promise<void> { return this.queue.run(async () => { this.listeners.clear() }) }
}
