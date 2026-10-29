// Note: persist a turn-bound reread before touching external transcripts — see .agents/notes/knowledge/hook-evidence-extraction.md
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { resolveOpencodeDbPath } from '../sessions/opencode-store-path'
import { redactHighConfidenceSecrets } from '@janus-agent/agent-core'
import { z } from 'zod'
import { SerialQueue, writeFileAtomic } from '../lib/atomic-file'
import { readKnowledgeTurn, type TranscriptCapture } from '../sessions/knowledge-transcript'
import { knowledgeRootPath } from './constants'
import { knowledgeCaptureInbox, type CaptureEntry } from './capture-inbox'
import type { Observation } from '../../shared/knowledge'
import { readObservationRevocationBarrier } from './observation-revocation-barrier'

export interface TranscriptJob { end: CaptureEntry; path: string; engine: string; prompt?: string }
interface Pending extends TranscriptJob { id: string; attempts: number; nextAttemptAt: number; error?: string }
const pendingSchema = z.object({ id: z.string(), path: z.string(), engine: z.string(), prompt: z.string().optional(),
  end: z.object({ input: z.object({ workspacePath: z.string(), source: z.literal('agent-stream'), type: z.enum(['system-event', 'conversation-turn']), content: z.string() }).passthrough(), context: z.object({ sourceEventId: z.string(), createdAt: z.string(), speaker: z.enum(['user', 'assistant', 'tool', 'system', 'unknown']) }).passthrough() }),
  attempts: z.number().int().nonnegative(), nextAttemptAt: z.number(), error: z.string().optional(),
})
export class TranscriptRecovery {
  private readonly queue = new SerialQueue()
  constructor(private readonly deps = {
    read: readKnowledgeTurn,
    submit: (entries: CaptureEntry[], enabled?: () => Promise<boolean>) => knowledgeCaptureInbox.submit(entries, enabled),
    now: Date.now,
  }) {}
  private path() { return join(knowledgeRootPath(), 'processing', 'transcript-recovery.json') }
  private async read(): Promise<Pending[]> {
    try { return z.array(pendingSchema).parse(JSON.parse(await readFile(this.path(), 'utf8'))) as Pending[] }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error }
  }
  private write(rows: Pending[]) { return writeFileAtomic(this.path(), JSON.stringify(rows) + '\n') }
  async submit(job: TranscriptJob, enabled: () => Promise<boolean> = async () => true): Promise<Observation[]> {
    if (!await enabled()) return []
    return this.queue.run(async () => {
      if (!await enabled()) return []
      const rows = await this.read()
      const safe = JSON.parse(redactHighConfidenceSecrets(JSON.stringify(job)).text) as TranscriptJob
      const id = createHash('sha256').update(JSON.stringify([safe.end.input.workspaceId, safe.end.context.sourceEventId])).digest('hex')
      if (!await enabled()) return []
      let row = rows.find(item => item.id === id)
      if (!row) { row = { ...safe, id, attempts: 0, nextAttemptAt: 0 }; rows.push(row); await this.write(rows) }
      return this.deliver(rows, row, enabled)
    })
  }
  private entries(row: Pending, result: TranscriptCapture): CaptureEntry[] {
    const { input, context } = row.end
    const entries: CaptureEntry[] = result.messages.filter(message => !(message.speaker === 'user' && row.prompt
      && redactHighConfidenceSecrets(message.content).text === row.prompt)).map((message, index) => ({
      input: { workspaceId: input.workspaceId, workspacePath: input.workspacePath, source: 'agent-stream', type: 'conversation-turn',
        content: message.content, actor: message.speaker, sessionId: input.sessionId, agentId: row.engine, correlationId: input.correlationId,
        tags: ['terminal-transcript', 'turn-evidence', row.engine],
        metadata: { transcriptPath: row.path, recordId: message.id, sourceOrder: index, sourceTimestamp: message.timestamp, completed: true },
      }, context: { speaker: message.speaker, createdAt: context.createdAt, relatedObservationIds: context.relatedObservationIds,
        sourceEventId: createHash('sha256').update(JSON.stringify([row.engine, input.sessionId ?? row.path, message.id])).digest('hex') },
    }))
    entries.push({ input: { ...input, metadata: { ...input.metadata, transcriptPath: row.path, evidenceStatus: result.reason ?? 'complete' } },
      context: { ...context, sourceEventId: `${context.sourceEventId}:${result.reason ? 'transcript-pending' : 'transcript-complete'}` } })
    return entries
  }
  private async deliver(rows: Pending[], row: Pending, enabled: () => Promise<boolean>): Promise<Observation[]> {
    try {
      if (!await enabled()) return []
      if ((await readObservationRevocationBarrier()).blocksObservations(row.end.input.workspaceId ?? '', row.end.context.relatedObservationIds ?? [])) {
        if (!await enabled()) return []
        await this.write(rows.filter(item => item.id !== row.id)); return []
      }
      if (!await enabled()) return []
      const result = await this.deps.read(row.path, row.engine, row.end.input.sessionId, row.prompt, row.end.context.createdAt, row.end.input.workspacePath)
      if (!await enabled()) return []
      if ((await readObservationRevocationBarrier()).blocksObservations(row.end.input.workspaceId ?? '', row.end.context.relatedObservationIds ?? [])) {
        if (!await enabled()) return []
        await this.write(rows.filter(item => item.id !== row.id)); return []
      }
      const observations = await this.deps.submit(this.entries(row, result), enabled)
      if (!await enabled()) return []
      if (!result.reason) { await this.write(rows.filter(item => item.id !== row.id)); return observations }
      row.error = result.reason
      row.end.context.relatedObservationIds = [...new Set([...(row.end.context.relatedObservationIds ?? []), ...observations.map(observation => observation.id)])]
      row.attempts++
      row.nextAttemptAt = this.deps.now() + Math.min(300000, 1000 * 2 ** Math.min(row.attempts, 8))
      await this.write(rows)
      return observations
    } catch (error) {
      if (!await enabled()) return []
      row.attempts++
      row.error = redactHighConfidenceSecrets(error instanceof Error ? error.message : String(error)).text.slice(0, 300)
      row.nextAttemptAt = this.deps.now() + Math.min(300000, 1000 * 2 ** Math.min(row.attempts, 8))
      await this.write(rows)
      throw error
    }
  }
  async drain(enabled: () => Promise<boolean> = async () => true): Promise<Observation[]> {
    if (!await enabled()) return []
    return this.queue.run(async () => {
      const observations: Observation[] = []
      if (!await enabled()) return observations
      for (const row of (await this.read()).filter(item => item.nextAttemptAt <= this.deps.now()).slice(0, 10)) {
        if (!await enabled()) return observations
        try { observations.push(...await this.deliver(await this.read(), row, enabled)) } catch { /* Durable retry and diagnostics retain the error. */ }
      }
      return observations
    })
  }
  async status(workspaceId?: string): Promise<{ pending: number; lastError?: string }> {
    const rows = (await this.read()).filter(row => !workspaceId || row.end.input.workspaceId === workspaceId)
    return { pending: rows.length, lastError: rows.find(row => row.error)?.error }
  }
}
export const knowledgeTranscriptRecovery = new TranscriptRecovery()

/** Exact provider session and original turn time own recovery; never use the latest session. */
export async function recoverObservationTranscript(observation: Observation, enabled: () => Promise<boolean>): Promise<Observation | undefined> {
  const engine = observation.agentId
  const path = typeof observation.metadata?.transcriptPath === 'string' ? observation.metadata.transcriptPath
    : engine === 'opencode' && observation.sessionId ? resolveOpencodeDbPath() : undefined
  if (!engine || !path || !observation.sessionId || !observation.correlationId) return undefined
  const rows = await knowledgeTranscriptRecovery.submit({ path, engine,
    prompt: typeof observation.metadata?.prompt === 'string' ? observation.metadata.prompt : undefined,
    end: { input: { workspaceId: observation.workspaceId, workspacePath: observation.workspacePath, source: 'agent-stream',
      type: 'system-event', content: observation.content, summary: observation.summary, actor: engine,
      sessionId: observation.sessionId, agentId: engine, correlationId: observation.correlationId, tags: observation.tags,
      metadata: observation.metadata },
      context: { sourceEventId: observation.sourceEvidence?.sourceEventId ?? observation.id, createdAt: observation.createdAt,
        speaker: 'unknown', relatedObservationIds: [observation.id] } },
  }, enabled)
  return rows.find(row => row.tags.includes('turn-completed') && row.metadata?.evidenceStatus === 'complete') ?? rows.find(row => row.tags.includes('turn-completed'))
}
