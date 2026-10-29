// Note: persist evidence before asynchronous extraction — see .agents/notes/knowledge/hook-evidence-extraction.md
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { CaptureObservationInput, Observation } from '../../shared/knowledge'
import { SerialQueue, writeFileAtomic } from '../lib/atomic-file'
import { knowledgeRootPath } from './constants'
import { knowledgeObservationService, type ObservationCaptureContext } from './observation-service'
import { redactHighConfidenceSecrets } from '@janus-agent/agent-core'
import { memoryDomainPolicy } from './memory-domain-policy'

export interface CaptureEntry { input: CaptureObservationInput; context: ObservationCaptureContext }
interface PendingCapture { id: string; entries: CaptureEntry[]; attempts: number; nextAttemptAt: number; error?: string }

/** Single local outbox. Acknowledgement follows observation persistence; replay uses source event IDs. */
export class CaptureInbox {
  private readonly queue = new SerialQueue()
  constructor(private readonly capture: (input: CaptureObservationInput, context: ObservationCaptureContext) => Promise<Observation | undefined> =
    (input, context) => knowledgeObservationService.capture(input, context),
    private readonly filter: (entries: CaptureEntry[]) => Promise<CaptureEntry[]> = async entries => entries) {}
  private path() { return join(knowledgeRootPath(), 'processing', 'capture-inbox.json') }
  private async read(): Promise<PendingCapture[]> {
    try {
      const rows: unknown = JSON.parse(await readFile(this.path(), 'utf8'))
      if (!Array.isArray(rows) || rows.some(row => !row || typeof row.id !== 'string' || !Array.isArray(row.entries)
        || row.entries.some((entry: CaptureEntry) => !entry.context?.sourceEventId || !entry.input?.workspacePath)
        || !Number.isInteger(row.attempts) || typeof row.nextAttemptAt !== 'number')) throw new Error('invalid-capture-inbox')
      return rows
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error }
  }
  private write(rows: PendingCapture[]) { return writeFileAtomic(this.path(), JSON.stringify(rows) + '\n') }
  async submit(entries: CaptureEntry[], enabled: () => Promise<boolean> = async () => true): Promise<Observation[]> {
    if (!await enabled()) return []
    entries = await this.filter(entries)
    if (!entries.length || !await enabled()) return []
    if (entries.some(entry => !entry.context.sourceEventId)) throw new Error('capture-requires-event-id')
    // Scrub all nested fields before even the recovery file is written.
    const safe = JSON.parse(redactHighConfidenceSecrets(JSON.stringify(entries)).text) as CaptureEntry[]
    const id = createHash('sha256').update(JSON.stringify(safe.map(entry => [entry.input.workspaceId, entry.context.sourceEventId]))).digest('hex')
    return this.queue.run(async () => {
      if (!await enabled()) return []
      const rows = await this.read()
      if (!await enabled()) return []
      let row = rows.find(item => item.id === id)
      if (!row) { row = { id, entries: safe, attempts: 0, nextAttemptAt: 0 }; rows.push(row); await this.write(rows) }
      return this.deliver(rows, row, enabled)
    })
  }
  private async deliver(rows: PendingCapture[], row: PendingCapture, enabled: () => Promise<boolean>): Promise<Observation[]> {
    try {
      const results: Observation[] = []
      if (!await enabled()) return results
      for (const entry of await this.filter(row.entries)) {
        if (!await enabled()) return results
        const observation = await this.capture(entry.input, entry.context)
        if (!await enabled()) return []
        if (observation) results.push(observation)
      }
      if (!await enabled()) return results
      await this.write(rows.filter(item => item.id !== row.id))
      return results
    } catch (error) {
      if (!await enabled()) return []
      row.attempts++
      row.nextAttemptAt = Date.now() + Math.min(300000, 1000 * 2 ** Math.min(row.attempts, 8))
      row.error = redactHighConfidenceSecrets(error instanceof Error ? error.message : String(error)).text.slice(0, 300)
      await this.write(rows.map(item => item.id === row.id ? row : item))
      throw error
    }
  }
  async drain(enabled: () => Promise<boolean> = async () => true): Promise<void> {
    if (!await enabled()) return
    await this.queue.run(async () => {
      if (!await enabled()) return
      for (const row of (await this.read()).filter(item => item.nextAttemptAt <= Date.now()).slice(0, 20)) {
        if (!await enabled()) return
        try { await this.deliver(await this.read(), row, enabled) } catch { /* Persisted error and retry deadline remain visible. */ }
      }
    })
  }
  async status(workspaceId?: string): Promise<{ batches: number; events: number; lastError?: string }> {
    const rows = (await this.read()).filter(row => !workspaceId || row.entries.some(entry => entry.input.workspaceId === workspaceId))
    return { batches: rows.length, events: rows.reduce((count, row) => count + row.entries.length, 0),
      lastError: [...rows].reverse().find(row => row.error)?.error }
  }
}
export const knowledgeCaptureInbox = new CaptureInbox((input, context) => knowledgeObservationService.capture(input, context), async entries => {
  const policy = await memoryDomainPolicy()
  return entries.filter(entry => entry.context.speaker === 'user'
    && (entry.input.workspaceId === 'user' ? policy.personal : policy.inferEngineeringHabits))
})
