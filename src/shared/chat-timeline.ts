// Note: ordered display snapshots stay out of model context — see .agents/notes/agent/requirements/chat-work-timeline.md
import type { ChatAgentEvent, ChatToolTraceEntry } from './ipc/llm'
import type { NoteFocusEvent } from './note-chat'
import type { AgentRuntimeEvent } from './ipc/agent-runtime'
import type { ContextDiagnostic } from '@janus-agent/chat-core'

interface BlockBase { id: string; startedAt: number; endedAt?: number }
export interface ChatTextBlock extends BlockBase { kind: 'text' | 'reasoning'; text: string; chars: number; preview?: string; truncated?: boolean }
export type ChatToolDetail =
  | { kind: 'note-focus'; focus: NoteFocusEvent }
  | { kind: 'note-change'; id: string; workspacePath?: string; conversationId?: string }
  | { kind: 'config'; id: string; operation?: 'read' | 'edit' | 'apply'; summary: string; valid: boolean; errors: string[]; warnings: string[]; applied: boolean }
export interface ChatToolBlock extends BlockBase {
  kind: 'tool'
  callId: string
  entry: ChatToolTraceEntry
  details?: ChatToolDetail[]
}
export type ChatTimelineBlock = ChatTextBlock | ChatToolBlock
export interface ChatTimelineSnapshot {
  version: 1
  requestId: string
  blocks: ChatTimelineBlock[]
  contextDiagnostics?: ContextDiagnostic[]
  truncated?: boolean
}
export const MAX_TIMELINE_BLOCKS = 256
export const MAX_TIMELINE_REASONING_CHARS = 4_000
const MAX_TIMELINE_TEXT_CHARS = 200_000
const MAX_TIMELINE_SNAPSHOT_CHARS = 1_000_000

export function emptyChatTimeline(requestId = ''): ChatTimelineSnapshot {
  return { version: 1, requestId, blocks: [] }
}

function closeText(blocks: ChatTimelineBlock[], now: number): ChatTimelineBlock[] {
  return blocks.map(block => block.kind !== 'tool' && block.endedAt === undefined ? { ...block, endedAt: now } : block)
}

function bounded(snapshot: ChatTimelineSnapshot): ChatTimelineSnapshot {
  let blocks = snapshot.blocks
  let chars = blocks.reduce((sum, block) => sum + (block.kind === 'tool' ? 0 : block.text.length), 0)
  while (blocks.length > MAX_TIMELINE_BLOCKS || chars > MAX_TIMELINE_TEXT_CHARS && blocks.length > 1) {
    const first = blocks[0]
    if (first.kind !== 'tool') chars -= first.text.length
    blocks = blocks.slice(1)
  }
  // Tool metadata has its own budget; a large business result must not bypass the text limit.
  if (blocks.some(block => block.kind === 'tool')) {
    const blockSize = (block: ChatTimelineBlock) => block.kind === 'tool' ? JSON.stringify(block).length : block.text.length + (block.preview?.length ?? 0) + 512
    let size = blocks.reduce((sum, block) => sum + blockSize(block), 0)
    while (size > MAX_TIMELINE_SNAPSHOT_CHARS && blocks.length) {
      size -= blockSize(blocks[0])
      blocks = blocks.slice(1)
    }
  }
  let contextDiagnostics = snapshot.contextDiagnostics
  if (contextDiagnostics) {
    contextDiagnostics = contextDiagnostics.slice(-MAX_TIMELINE_BLOCKS)
    while (contextDiagnostics.length && JSON.stringify({ blocks, contextDiagnostics }).length > MAX_TIMELINE_SNAPSHOT_CHARS) contextDiagnostics = contextDiagnostics.slice(1)
  }
  return { ...snapshot, blocks, ...(contextDiagnostics ? { contextDiagnostics } : {}),
    ...(blocks !== snapshot.blocks || contextDiagnostics?.length !== snapshot.contextDiagnostics?.length ? { truncated: true } : {}) }
}

function normalizeContextDiagnostic(value: unknown): ContextDiagnostic | undefined {
  if (!value || typeof value !== 'object') return undefined
  const row = value as ContextDiagnostic
  if (!['model-request', 'tool-result'].includes(row.phase) || !Number.isSafeInteger(row.modelRequest) || !Number.isFinite(row.at)) return undefined
  const text = (value: unknown) => typeof value === 'string' ? value.slice(0, 256) : undefined
  const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
  return { phase: row.phase, modelRequest: row.modelRequest, at: row.at, durationMs: number(row.durationMs),
    callId: text(row.callId), toolName: text(row.toolName), workId: text(row.workId), reasonCode: text(row.reasonCode),
    availableTokens: number(row.availableTokens), outputTokens: number(row.outputTokens),
    resources: Array.isArray(row.resources) ? row.resources.slice(0, MAX_TIMELINE_BLOCKS).filter(resource => resource && typeof resource.resourceId === 'string' && typeof resource.version === 'string')
      .map(resource => ({ resourceId: text(resource.resourceId)!, version: text(resource.version)!, offset: number(resource.offset), end: number(resource.end), total: number(resource.total) })) : undefined }
}

export function settleChatTimeline(snapshot: ChatTimelineSnapshot, now: number, cancelled = false): ChatTimelineSnapshot {
  return { ...snapshot, blocks: snapshot.blocks.map(block => {
    if (block.endedAt !== undefined) return block
    if (block.kind !== 'tool') return { ...block, endedAt: now }
    return { ...block, endedAt: now, entry: { ...block.entry, completedAt: now,
      status: ['completed', 'failed', 'cancelled', 'denied'].includes(block.entry.status) ? block.entry.status : cancelled ? 'cancelled' : 'failed' } }
  }) }
}

function updateTool(snapshot: ChatTimelineSnapshot, callId: string, now: number,
  update: (block: ChatToolBlock) => ChatToolBlock): ChatTimelineSnapshot {
  const index = snapshot.blocks.findIndex(block => block.kind === 'tool' && block.callId === callId)
  const blocks = index < 0 ? closeText(snapshot.blocks, now) : [...snapshot.blocks]
  const block: ChatToolBlock = index < 0 ? { kind: 'tool', id: `${snapshot.requestId}:tool:${callId}`, callId,
    startedAt: now, entry: { callId, toolName: 'tool', workspaceId: '', status: 'requested', summary: '', startedAt: now } } : blocks[index] as ChatToolBlock
  if (index < 0) blocks.push(update(block))
  else blocks[index] = update(block)
  return bounded({ ...snapshot, blocks })
}

export function mergeTimelineTrace(snapshot: ChatTimelineSnapshot, entry: ChatToolTraceEntry, now = Date.now()): ChatTimelineSnapshot {
  if (!entry.callId) return snapshot // Historical traces have no reliable call-level identity.
  return updateTool(snapshot, entry.callId, now, block => {
    const { configResult, ...trace } = entry
    return { ...block, endedAt: entry.completedAt ?? block.endedAt, entry: { ...block.entry, ...trace },
      ...(configResult && !block.details?.some(detail => detail.kind === 'config') ? {
        details: [...(block.details ?? []), { kind: 'config' as const, id: `${snapshot.requestId}:${entry.callId}:config`, ...configResult }],
      } : {}) }
  })
}

export function reduceTimelineRuntime(snapshot: ChatTimelineSnapshot, event: AgentRuntimeEvent, now = Date.now()): ChatTimelineSnapshot {
  if (event.type !== 'approval-requested') return snapshot
  const callId = event.request.correlationId
  if (!snapshot.blocks.some(block => block.kind === 'tool' && block.callId === callId && block.endedAt === undefined)) return snapshot
  return updateTool(snapshot, callId, now, block => ({ ...block, entry: { ...block.entry, status: 'approval' } }))
}

export function reduceChatTimeline(snapshot: ChatTimelineSnapshot, event: ChatAgentEvent, now = Date.now()): ChatTimelineSnapshot {
  if (snapshot.requestId && snapshot.requestId !== event.requestId) return snapshot
  if (!snapshot.requestId) snapshot = { ...snapshot, requestId: event.requestId }
  if (event.type === 'context_diagnostic') {
    const data = normalizeContextDiagnostic(event.data)
    return data ? bounded({ ...snapshot, contextDiagnostics: [...(snapshot.contextDiagnostics ?? []), data] }) : snapshot
  }
  if (event.type === 'text_delta' || event.type === 'reasoning_delta') {
    if (!event.delta) return snapshot
    const kind = event.type === 'text_delta' ? 'text' : 'reasoning'
    let blocks = snapshot.blocks
    const last = blocks.at(-1)
    const current = last?.kind === kind && last.endedAt === undefined ? last as ChatTextBlock : undefined
    const text = (current?.text ?? '') + event.delta
    const limit = kind === 'reasoning' ? MAX_TIMELINE_REASONING_CHARS : MAX_TIMELINE_TEXT_CHARS
    const block: ChatTextBlock = { ...(current ?? { id: `${event.requestId}:${crypto.randomUUID()}`, kind, startedAt: now }),
      text: text.slice(-limit), chars: (current?.chars ?? 0) + event.delta.length,
      ...(kind === 'reasoning' ? { preview: ((current?.preview ?? '') + event.delta).trimStart().slice(0, 512) } : {}),
      ...(text.length > limit || current?.truncated ? { truncated: true } : {}) }
    blocks = current ? [...blocks.slice(0, -1), block] : [...closeText(blocks, now), block]
    return bounded({ ...snapshot, blocks })
  }
  if (event.type === 'model_finish' || event.type === 'model_error' || event.type === 'question_requested') return { ...snapshot, blocks: closeText(snapshot.blocks, now) }
  if (event.type === 'stream_end' || event.type === 'stream_error') return settleChatTimeline(snapshot, now, event.type === 'stream_end' && event.cancelled)
  if (event.type === 'note_change' || event.type === 'note_focus' || event.type === 'config_change') {
    if (!event.callId) return snapshot
    let detail: ChatToolDetail
    if (event.type === 'note_change') detail = { kind: 'note-change', id: event.change.id, workspacePath: event.change.workspacePath, conversationId: event.change.conversationId }
    else if (event.type === 'note_focus') detail = { kind: 'note-focus', focus: event.focus }
    else {
      const secrets = event.change.config.configurations.flatMap(configuration => Object.values(configuration.env ?? {})).filter(Boolean).sort((a, b) => b.length - a.length)
      const redact = (value: string) => secrets.reduce((text, secret) => text.split(secret).join('[REDACTED]'), value).slice(0, 2000)
      detail = { kind: 'config', id: event.change.id, summary: redact(event.change.summary),
        valid: event.change.validation.valid, errors: event.change.validation.errors.slice(0, 20).map(item => redact(`${item.field}: ${item.message}`)),
        warnings: event.change.validation.warnings.slice(0, 20).map(item => redact(`${item.field}: ${item.message}`)), applied: event.change.applied === true }
    }
    return updateTool(snapshot, event.callId, now, block => ({ ...block, details: [...(block.details ?? []).filter(item =>
      (item.kind === 'note-focus' ? item.focus.id : item.id) !== (detail.kind === 'note-focus' ? detail.focus.id : detail.id)), detail].slice(-16) }))
  }
  if (!('callId' in event) || !event.type.startsWith('tool_')) return snapshot
  if (event.type === 'tool_execution_start' || event.type === 'tool_call_ready') snapshot = { ...snapshot, blocks: closeText(snapshot.blocks, now) }
  return updateTool(snapshot, event.callId, now, block => {
    if (block.endedAt !== undefined && event.type !== 'tool_execution_end') return block
    const entry = { ...block.entry }
    if ('toolName' in event && event.toolName) entry.toolName = event.toolName
    if (event.type === 'tool_call_ready') entry.argsDigest = event.argumentKeys.join(', ')
    if (event.type === 'tool_execution_start' || event.type === 'tool_execution_update') entry.status = 'running'
    if (event.type === 'tool_execution_end') return { ...block, endedAt: now, entry: { ...entry, status: event.status, completedAt: now } }
    return { ...block, entry }
  })
}

/** Rebuild only display fields; never deserialize live business payloads or executable actions. */
export function normalizeChatTimeline(value: unknown): ChatTimelineSnapshot | undefined {
  if (!value || typeof value !== 'object') return undefined
  const source = value as ChatTimelineSnapshot
  if (source.version !== 1 || typeof source.requestId !== 'string' || !Array.isArray(source.blocks)) return undefined
  const str = (value: unknown, length = 2000) => typeof value === 'string' ? value.slice(0, length) : ''
  const time = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
  const blocks: ChatTimelineBlock[] = []
  const ids = new Set<string>()
  for (const block of source.blocks.slice(-MAX_TIMELINE_BLOCKS)) {
    if (!block || typeof block !== 'object' || typeof block.id !== 'string' || !block.id || ids.has(block.id)) continue
    const base = { id: str(block.id, 512), startedAt: time(block.startedAt), endedAt: time(block.endedAt ?? block.startedAt) }
    if ((block.kind === 'text' || block.kind === 'reasoning') && typeof block.text === 'string') {
      const limit = block.kind === 'reasoning' ? MAX_TIMELINE_REASONING_CHARS : MAX_TIMELINE_TEXT_CHARS
      blocks.push({ ...base, kind: block.kind, text: block.text.slice(-limit), chars: Math.max(time(block.chars), block.text.length),
        ...(block.kind === 'reasoning' ? { preview: str(block.preview ?? block.text, 512) } : {}), truncated: !!block.truncated || block.text.length > limit })
    } else if (block.kind === 'tool' && typeof block.callId === 'string' && block.entry) {
      const entry = block.entry
      const status = ['completed', 'failed', 'cancelled', 'denied'].includes(entry.status) ? entry.status : 'cancelled'
      const details: ChatToolDetail[] = []
      for (const detail of Array.isArray(block.details) ? block.details.slice(-16) : []) {
        if (detail?.kind === 'note-change' && typeof detail.id === 'string') details.push({ kind: 'note-change', id: str(detail.id, 128),
          workspacePath: str(detail.workspacePath, 4096), conversationId: str(detail.conversationId, 128) })
        if (detail?.kind === 'config' && typeof detail.id === 'string') details.push({ kind: 'config', id: str(detail.id, 128), summary: str(detail.summary),
          operation: detail.operation === 'read' || detail.operation === 'apply' ? detail.operation : 'edit',
          valid: detail.valid === true, applied: detail.applied === true,
          errors: Array.isArray(detail.errors) ? detail.errors.slice(0, 20).map(item => str(item)) : [],
          warnings: Array.isArray(detail.warnings) ? detail.warnings.slice(0, 20).map(item => str(item)) : [] })
        if (detail?.kind === 'note-focus' && detail.focus && Array.isArray(detail.focus.notes)) {
          const focus = detail.focus
          details.push({ kind: 'note-focus', focus: { id: str(focus.id, 128), conversationId: str(focus.conversationId, 128),
            workspacePath: str(focus.workspacePath, 4096), turnId: str(focus.turnId, 128), mode: 'access', focus: 'none', reason: str(focus.reason),
            notes: focus.notes.slice(0, 64).filter(note => note && typeof note.uri === 'string').map(note => ({
              uri: str(note.uri, 512), title: str(note.title), role: ['target', 'dependency'].includes(note.role) ? note.role : 'reference', reason: str(note.reason) })) } })
        }
      }
      blocks.push({ ...base, kind: 'tool', callId: str(block.callId, 256), details, entry: {
        callId: str(block.callId, 256), toolName: str(entry.toolName, 128), workspaceId: str(entry.workspaceId, 128), status,
        summary: str(entry.summary), argsDigest: str(entry.argsDigest), resultDigest: str(entry.resultDigest), errorDetail: str(entry.errorDetail),
        startedAt: time(entry.startedAt ?? base.startedAt), completedAt: time(entry.completedAt ?? base.endedAt),
      } })
    }
    ids.add(block.id)
  }
  const contextDiagnostics = Array.isArray(source.contextDiagnostics) ? source.contextDiagnostics.slice(-MAX_TIMELINE_BLOCKS)
    .map(normalizeContextDiagnostic).filter((row): row is ContextDiagnostic => !!row) : undefined
  return bounded({ version: 1, requestId: str(source.requestId, 256), blocks, contextDiagnostics, truncated: !!source.truncated || source.blocks.length > MAX_TIMELINE_BLOCKS })
}
