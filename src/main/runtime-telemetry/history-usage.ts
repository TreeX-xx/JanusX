import type { UsageEngine, UsageEvent, UsageObservation, UsageTokens } from '../../shared/usage'

type RecordValue = Record<string, unknown>
function record(value: unknown): RecordValue | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : undefined
}
function text(value: unknown): string | undefined { return typeof value === 'string' && value.trim() ? value : undefined }
function count(value: unknown): number | undefined { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined }
function time(value: unknown): number | undefined {
  const at = typeof value === 'string' ? Date.parse(value) : typeof value === 'number' ? value : NaN
  return Number.isFinite(at) && at > 0 ? at : undefined
}

/** Preserve field presence: zero cache hits and unknown cache fields are distinct. */
export function usageTokens(input: unknown, output: unknown, read: unknown, write: unknown, total?: unknown): UsageTokens | undefined {
  const inputTokens = count(input)
  const outputTokens = count(output)
  if (inputTokens === undefined || outputTokens === undefined) return undefined
  const cacheReadTokens = count(read)
  const cacheWriteTokens = count(write)
  if ((read !== undefined && cacheReadTokens === undefined) || (write !== undefined && cacheWriteTokens === undefined)) return undefined
  const sum = inputTokens + outputTokens + (cacheReadTokens ?? 0) + (cacheWriteTokens ?? 0)
  if (!Number.isSafeInteger(sum) || (total !== undefined && count(total) !== sum)) return undefined
  return { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, totalTokens: sum }
}

/** One response can appear in multiple content blocks. A row UUID is not a request identity. */
export function collectUsageEvents(engine: 'claude' | 'pi', namespace: string, sessionId: string, values: RecordValue[], collectedAt: number): UsageObservation {
  const events = new Map<string, UsageEvent>()
  const partials = new Map<string, UsageEvent[]>()
  let issue: string | undefined
  for (const value of values) {
    const message = record(value.message)
    if (!message || (message.role !== undefined && message.role !== 'assistant')) continue
    const usage = record(message.usage)
    if (!usage) continue
    if (engine === 'pi' && value.type !== 'message') continue
    const at = time(value.timestamp) ?? time(message.timestamp)
    const responseId = engine === 'claude' ? text(message.id) ?? text(value.requestId) : text(value.id)
    const partial = engine === 'claude' && !text(message.stop_reason)
    if (partial && (!responseId || at === undefined || events.has(responseId))) continue
    if (!responseId) { issue = 'missing-event-identity'; continue }
    const id = engine === 'pi' ? JSON.stringify([responseId, at ?? null]) : responseId
    const tokens = engine === 'claude'
      ? usageTokens(usage.input_tokens, usage.output_tokens, usage.cache_read_input_tokens, usage.cache_creation_input_tokens)
      : usageTokens(usage.input, usage.output, usage.cacheRead, usage.cacheWrite, usage.totalTokens)
    if (!tokens) {
      if (!partial) issue = 'invalid-event'
      continue
    }
    const event: UsageEvent = { ...tokens, id, at, model: text(message.model) }
    if (partial) {
      const blocks = partials.get(id)
      if (blocks) blocks.push(event)
      else partials.set(id, [event])
      continue
    }
    const previous = events.get(id)
    if (engine === 'claude' && previous) {
      if (previous.inputTokens !== event.inputTokens || previous.outputTokens !== event.outputTokens ||
        previous.cacheReadTokens !== event.cacheReadTokens || previous.cacheWriteTokens !== event.cacheWriteTokens) issue = 'event-changed'
      // An identical repeated final block belongs to the original completion date.
      continue
    }
    if (!previous || event.totalTokens >= previous.totalTokens) events.set(id, event)
  }
  for (const [id, blocks] of partials) {
    const final = events.get(id)
    if (!final || final.at === undefined) continue
    const completedAt = final.at
    const evidence = blocks.flatMap(block => block.at !== undefined && block.at <= completedAt && block.outputTokens < final.outputTokens
      && block.inputTokens === final.inputTokens && block.cacheReadTokens === final.cacheReadTokens && block.cacheWriteTokens === final.cacheWriteTokens
      ? [{ at: block.at, outputTokens: block.outputTokens }] : [])
    if (evidence.length) final.partialOutputs = evidence
  }
  return { engine, namespace, sessionId, collectedAt, mode: 'events', events: [...events.values()], issue }
}

export function cumulativeUsage(engine: UsageEngine, namespace: string, sessionId: string, counters: UsageTokens | undefined, model?: string): UsageObservation {
  return { engine, namespace, sessionId, mode: 'cumulative', counters, model, collectedAt: Date.now(), issue: counters ? undefined : 'invalid-counter' }
}

/**
 * Codex rollout replay. Each `token_count` event carries cumulative
 * `total_token_usage`; per-event consumption is the delta against the previous
 * event, which conserves the session total by construction. Verified on disk:
 * summing `last_token_usage` instead diverges from the final cumulative in 86
 * of 300 sampled sessions (repeated emissions and zeroed-breakdown events),
 * while cumulative deltas always telescope to the session total. Identity is
 * the per-file `ordinal` scoped by session, so ordinals never collide across
 * sessions; time is the event timestamp. Codex counts cache writes inside
 * `input_tokens`, so cache reads and reported writes are split out — the same mapping the
 * cumulative path uses, keeping both modes numerically identical.
 *
 * Forked/subagent rollouts copy the parent's events up to
 * `subagent_history_start_ordinal`; those ordinals stay with the parent file,
 * so they are skipped and the baseline is the parent's last cumulative value.
 */
export function collectCodexEvents(namespace: string, sessionId: string, values: RecordValue[], collectedAt: number): UsageObservation {
  const events = new Map<string, UsageEvent>()
  let issue: string | undefined
  let model: string | undefined
  const meta = values.find(value => value.type === 'session_meta')
  const inheritedFrom = count(record(meta?.payload)?.subagent_history_start_ordinal)
  // A root session's cumulative counters start at zero, so the first event's
  // delta is its own consumption. A forked thread inherits the parent's
  // counters, so its baseline is the last inherited event instead.
  let previous: RecordValue = { total_tokens: 0, input_tokens: 0, cached_input_tokens: 0, cache_write_input_tokens: 0, output_tokens: 0 }
  if (inheritedFrom !== undefined) {
    for (const value of values) {
      const ordinal = value.ordinal
      if (value.type !== 'event_msg' || typeof ordinal !== 'number' || ordinal >= inheritedFrom) continue
      const payload = record(value.payload)
      const cumulative = payload?.type === 'token_count' ? record(record(payload.info)?.total_token_usage) : undefined
      if (cumulative) previous = cumulative
    }
  }
  for (const value of values) {
    if (value.type === 'turn_context') {
      model = text(record(value.payload)?.model)
      continue
    }
    if (value.type !== 'event_msg') continue
    const payload = record(value.payload)
    if (!payload || payload.type !== 'token_count') continue
    const ordinal = value.ordinal
    if (typeof ordinal !== 'number' || !Number.isFinite(ordinal)) { issue = 'missing-event-identity'; continue }
    if (inheritedFrom !== undefined && ordinal < inheritedFrom) continue
    const info = record(payload.info)
    const cumulative = record(info?.total_token_usage) ?? record(info?.totalTokenUsage)
    const id = `${sessionId}#${ordinal}`
    if (!cumulative) continue
    const total = count(cumulative.total_tokens)
    const input = count(cumulative.input_tokens)
    const cached = count(cumulative.cached_input_tokens)
    const rawWritten = cumulative.cache_write_input_tokens ?? cumulative.cacheWriteInputTokens
    const written = count(rawWritten)
    const output = count(cumulative.output_tokens)
    if (total === undefined || input === undefined || cached === undefined || output === undefined || (rawWritten !== undefined && written === undefined)) {
      issue = 'invalid-event'
      previous = cumulative
      continue
    }
    const deltaTotal = total - count(previous.total_tokens)!
    const deltaInput = input - count(previous.input_tokens)!
    const deltaCached = cached - count(previous.cached_input_tokens)!
    const deltaOutput = output - count(previous.output_tokens)!
    const previousWritten = count(previous.cache_write_input_tokens ?? previous.cacheWriteInputTokens)
    // If an older counter has no write breakdown, the transition interval stays
    // unsplit; later intervals use the newly established native write baseline.
    const deltaWritten = written === undefined || previousWritten === undefined ? undefined : written - previousWritten
    // A reset (compaction, /new) is not consumption; pause instead of guessing.
    if (deltaTotal < 0 || deltaInput < 0 || deltaCached < 0 || deltaOutput < 0 || (deltaWritten !== undefined && deltaWritten < 0)) {
      issue = 'counter-regressed'
      previous = cumulative
      continue
    }
    const tokens = usageTokens(deltaInput - deltaCached - (deltaWritten ?? 0), deltaOutput, deltaCached, deltaWritten, deltaTotal)
    if (!tokens) { issue = 'invalid-event'; previous = cumulative; continue }
    const event: UsageEvent = { ...tokens, id, at: time(value.timestamp), model }
    const existing = events.get(id)
    if (!existing || event.totalTokens >= existing.totalTokens) events.set(id, event)
    previous = cumulative
  }
  return { engine: 'codex', namespace, sessionId, mode: 'events', events: [...events.values()], collectedAt, issue }
}
