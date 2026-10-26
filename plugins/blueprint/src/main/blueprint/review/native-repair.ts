import { z } from 'zod'
import { NativeServiceError } from '@janusx/plugin-sdk'
import type { NoteRepairService } from './note-repair'
import { json, REVIEW_TOOLS, reviewEvidenceTool, type BlueprintNativeModels } from './native-models'
import { ReviewEvidenceSession, collectReviewEvidence } from './evidence'
import type { WorkspaceSuggestionSources } from '../suggestions/sources'
import type { NoteRepairUpdate } from '../../../shared/note-repair'

export const nativeRepairRequest = z.object({ id: z.string().uuid(), conversationId: z.string().min(1).max(256),
  providerId: z.string().min(1).max(256), modelId: z.string().min(1).max(256),
  messages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(300_000) }).strict()).min(1).max(50),
}).strict()
const response = z.object({ message: z.string().max(300_000),
  edit: z.object({ markdown: z.string().min(1).max(1_000_000), expectedHash: z.string().regex(/^[a-f0-9]{64}$/), reason: z.string().min(1).max(1000) }).strict().nullable(),
  blocker: z.string().min(1).max(2000).optional(),
}).strict()

/** A user-selected repair commits through the existing single-Note transaction.
 * Agent callbacks only read; generated edits cannot invoke writes during a turn. */
export async function runNativeRepair(service: NoteRepairService, models: BlueprintNativeModels, sources: WorkspaceSuggestionSources,
  request: z.infer<typeof nativeRepairRequest>, root: string, signal: AbortSignal, changed: (update: NoteRepairUpdate) => void) {
  const plan = await service.claim(request.id, request.conversationId, [root])
  let text = '', attempts = 0
  const messages = [...request.messages], traces: Array<{ toolName: string; status: string }> = []
  try {
    signal.throwIfAborted()
    // Malformed targets can still be repaired with the dedicated raw source reader.
    const evidence = plan.kind === 'suggestions'
      ? new ReviewEvidenceSession(sources, await collectReviewEvidence(sources, plan.context, plan.noteId)) : undefined
    for (; attempts < 3; attempts++) {
      signal.throwIfAborted()
      changed({ id: plan.id, phase: 'reading' })
      const result = await models.run({ root, providerId: request.providerId, modelId: request.modelId, system: service.prompt(plan.id, true), messages,
        tools: [{ name: 'note.repair_read', actionRisk: 'read', description: 'Read the one selected Note, including malformed source. Follow every nextOffset to read all source before proposing changes.',
          inputSchema: { type: 'object', properties: { offset: { type: 'integer', minimum: 0 }, maxChars: { type: 'integer', minimum: 500, maximum: 12000 } }, additionalProperties: false } },
        ...(evidence ? REVIEW_TOOLS : [])],
      }, async (name, args) => {
        signal.throwIfAborted()
        const output = name === 'note.repair_read' ? json(await service.read(plan.id, args))
          : evidence ? await reviewEvidenceTool(evidence, name, args) : (() => { throw new NativeServiceError('UNKNOWN_METHOD') })()
        traces.push({ toolName: name, status: 'completed' })
        return output
      }, signal)
      text = result.text
      let submitted = false
      try {
        const reply = response.parse(JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')))
        if (reply.edit && reply.blocker) throw new Error('Return an edit or a blocker, not both')
        if (plan.intent === 'discuss' && (reply.edit || reply.blocker)) throw new Error('Discussion cannot authorize a write or repair blocker')
        if (reply.blocker) service.block(plan.id, { reason: reply.blocker })
        if (reply.edit) {
          signal.throwIfAborted(); changed({ id: plan.id, phase: 'editing' })
          submitted = true
          const written = await service.write(plan.id, reply.edit, signal)
          traces.push({ toolName: 'note.repair_write', status: 'completed' })
          if (written.status === 'applied') changed({ id: plan.id, phase: 'editing', changed: true, afterHash: written.expectedHash, changes: written.changes })
        }
        text = reply.message
        service.recordExecution(plan.id, attempts + 1, text, traces)
        const continuation = await service.continuation(plan.id)
        if (!continuation) break
        messages.push({ role: 'assistant', content: result.text }, { role: 'user', content: continuation.replaceAll('note.repair_write', 'the final JSON edit') })
      } catch (cause) {
        signal.throwIfAborted(); service.recordWriteFailure(plan.id, cause)
        // A transaction can commit before a receipt/response failure. Never
        // replay a write automatically after crossing that boundary.
        if (submitted || attempts === 2) throw cause
        messages.push({ role: 'assistant', content: result.text }, { role: 'user', content: 'The proposed response was not applied. Correct this validation error using the source: ' + (cause instanceof Error ? cause.message : 'Invalid response') })
      }
    }
    if (plan.intent === 'repair') changed({ id: plan.id, phase: 'reviewing' })
    const update = await service.finish(plan.id, signal); changed(update)
    return { text, update }
  } catch (cause) {
    service.recordExecution(plan.id, attempts + 1, text, traces)
    const update = await service.fail(plan.id, cause, signal.aborted); changed(update)
    if (signal.aborted) throw cause
    return { text, update }
  }
}
