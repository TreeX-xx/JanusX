import { randomUUID } from 'node:crypto'
import { estimateContextTokens } from '@janus-agent/chat-core'
import type { SuperAgentResourceContent } from '../../../shared/superagent'
import { hashText } from './persistence'

export const INLINE_CONTEXT_TOKENS = 8000
export const RECENT_CONTEXT_TURNS = 4
export const INITIAL_WORK_CANDIDATES = 5
// Only the host-created MCP readers use this transport ceiling. No call/cumulative reading quota.
export const WORKER_CONTEXT_OUTPUT_TOKENS = 16_384
export const mcpOutputBytes = (value: unknown) => Buffer.byteLength(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(value) }] }), 'utf8')

export function fitText(text: string, tokens: number): string {
  if (estimateContextTokens(text) <= tokens) return text
  let low = 0, high = text.length
  while (low < high) { const mid = Math.ceil((low + high) / 2); if (estimateContextTokens(text.slice(0, mid)) <= tokens) low = mid; else high = mid - 1 }
  // Never split a surrogate pair at the page boundary.
  if (low && /[\uD800-\uDBFF]/.test(text[low - 1])) low--
  return text.slice(0, low)
}
export function resourcePage(body: SuperAgentResourceContent, offset = 0, tokens = Infinity, maxBytes = Infinity) {
  const { resource } = body, total = body.text.length
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > total || (offset > 0 && /[\uDC00-\uDFFF]/.test(body.text[offset] ?? ''))) throw new Error('Invalid resource offset; follow the returned continuation')
  let text = fitText(body.text.slice(offset, offset + 48_000), tokens)
  if (text && /[\uD800-\uDBFF]/.test(text.at(-1)!)) text = text.slice(0, -1)
  const render = (text: string) => {
    const end = offset + text.length
    return { status: text.length || !total ? 'available' as const : 'context-pressure' as const, resource, resourceId: resource.id, version: resource.sha256,
    offset, end, total, rangeUnit: 'UTF-16 code units' as const, text, truncated: offset > 0 || end < total,
    nextOffset: end < total ? end : null,
    continuation: end < total ? { resourceId: resource.id, version: resource.sha256, offset: end } : null }
  }
  if (mcpOutputBytes(render(text)) > maxBytes) {
    let low = 0, high = text.length
    while (low < high) { const mid = Math.ceil((low + high) / 2); if (mcpOutputBytes(render(text.slice(0, mid))) <= maxBytes) low = mid; else high = mid - 1 }
    if (low && /[\uD800-\uDBFF]/.test(text[low - 1])) low--
    text = text.slice(0, low)
  }
  return render(text)
}
export type ResourcePage = ReturnType<typeof resourcePage>

/** Exposure evidence, never a claim of understanding. A same-batch read+route cannot bypass it. */
export class ContextReadEvidence {
  private issued = new Map<string, ResourcePage>()
  private direct = new Map<string, ResourcePage>()
  private visible = new Map<string, Array<[number, number]>>()
  private lastRead?: string
  private cards = new Map<string, { hash: string; workId: string; workRevision: number; intentRevision: number; incomplete: boolean }>()
  private visibleCards = new Map<string, { workRevision: number; intentRevision: number; incomplete: boolean }>()
  card(workId: string) { return this.visibleCards.get(workId) }
  directInput(page: ResourcePage) { if (!page.truncated && page.status === 'available') this.direct.set(page.text, page) }
  offer<T>(value: T): T {
    if (!value || typeof value !== 'object') return value
    if (Array.isArray(value)) return value.map(item => this.offer(item)) as T
    const record = value as Record<string, unknown>
    if (record.status === 'available' && typeof record.text === 'string' && typeof record.version === 'string' && typeof record.total === 'number') {
      const page = value as unknown as ResourcePage, readReceipt = randomUUID()
      this.issued.set(readReceipt, page)
      return { ...record, readReceipt } as T
    }
    const result = Object.fromEntries(Object.entries(record).map(([key, item]) => [key, this.offer(item)]))
    if (typeof record.workId === 'string' && record.work && record.intent) {
      const work = record.work as { revision: number }, intent = record.intent as { revision: number; goal: { truncated: boolean; sourcesPage: { truncated: boolean } }; constraints: Array<{ truncated: boolean; sourcesPage: { truncated: boolean } }>; constraintsPage: { truncated: boolean } }
      const receipt = randomUUID()
      this.cards.set(receipt, { hash: hashText(JSON.stringify(result)), workId: record.workId, workRevision: work.revision, intentRevision: intent.revision,
        incomplete: intent.goal.truncated || intent.goal.sourcesPage.truncated || intent.constraintsPage.truncated || intent.constraints.some(row => row.truncated || row.sourcesPage.truncated) })
      result.cardReceipt = receipt
    }
    return result as T
  }
  observe(messages: unknown) {
    const visit = (value: unknown, depth: number) => {
      if (depth > 20) return
      if (typeof value === 'string') {
        const direct = this.direct.get(value)
        if (direct) { this.visible.set(`${direct.resourceId}:${direct.version}`, [[0, direct.total]]); this.direct.delete(value) }
        try { visit(JSON.parse(value), depth + 1) }
        catch { for (const line of value.split('\n')) if (line.startsWith('SuperAgent Inline: ')) { try { visit(JSON.parse(line.slice(19)), depth + 1) } catch { /* prose, not a receipt */ } } }
        return
      }
      if (!value || typeof value !== 'object') return
      const record = value as Record<string, unknown>, receipt = record.readReceipt
      if (typeof record.cardReceipt === 'string') {
        const card = this.cards.get(record.cardReceipt), { cardReceipt: _receipt, ...body } = record
        if (card && hashText(JSON.stringify(body)) === card.hash) {
          this.visibleCards.set(card.workId, card); this.cards.delete(record.cardReceipt)
        }
      }
      if (typeof receipt === 'string') {
        const page = this.issued.get(receipt)
        if (page && record.text === page.text && record.resourceId === page.resourceId && record.version === page.version && record.offset === page.offset && record.end === page.end) {
          const key = `${page.resourceId}:${page.version}`, ranges = this.visible.get(key) ?? []
          ranges.push([page.offset, page.end]); ranges.sort((a, b) => a[0] - b[0]); this.visible.set(key, ranges)
          this.issued.delete(receipt)
        }
      }
      for (const item of Object.values(value)) visit(item, depth + 1)
    }
    visit(messages, 0)
  }
  unread(page: ResourcePage) {
    let end = 0
    for (const range of this.visible.get(`${page.resourceId}:${page.version}`) ?? []) { if (range[0] > end) break; end = Math.max(end, range[1]) }
    return end < page.total ? { resourceId: page.resourceId, version: page.version, offset: end } : undefined
  }
  repeated(page: ResourcePage, reread = false) {
    const key = `${page.resourceId}:${page.version}:${page.offset}:${page.end}`
    const repeated = key === this.lastRead; this.lastRead = key
    return repeated && !reread ? { status: 'no-progress' as const, resourceId: page.resourceId, version: page.version,
      offset: page.offset, end: page.end, total: page.total, nextOffset: page.nextOffset, continuation: page.continuation,
      text: '', noProgress: true, guidance: 'Repeated range omitted. Follow continuation, use reread=true after compaction, search another reference, or explain the missing background. Do not loop.', nextUnread: this.unread(page) ?? null } : undefined
  }
}
