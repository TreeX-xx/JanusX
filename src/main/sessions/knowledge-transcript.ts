// Note: capture bounded turn evidence, not UI excerpts or a mutable history mirror — see .agents/notes/knowledge/hook-evidence-extraction.md
import { createHash } from 'node:crypto'
import { open } from 'node:fs/promises'
import { sameRuntimePath } from '../../shared/runtime/path-identity'
import type { MemorySpeaker } from '../../shared/knowledge'
import { isRuntimeNotification } from '../knowledge/personal-memory-content'
import { claudeUserText, claudeAssistantText, codexUserText, codexAssistantText, piUserText, piAssistantText } from './external-session-scanner'

export interface TranscriptEvidence { id: string; speaker: MemorySpeaker; content: string; timestamp?: string }
export interface TranscriptCapture { messages: TranscriptEvidence[]; reason?: string }
const MAX_BYTES = 2 * 1024 * 1024
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' ? value as Record<string, unknown> : {}
const text = (value: unknown): string => typeof value === 'string' ? value : Array.isArray(value)
  ? value.map(block => typeof block === 'string' ? block : typeof object(block).text === 'string' ? object(block).text : '').join('\n') : ''
const digest = (value: string) => createHash('sha256').update(value).digest('hex')

function parse(record: Record<string, unknown>, engine: string, position: number): TranscriptEvidence[] {
  const message = object(record.message), payload = object(record.payload)
  const result: TranscriptEvidence[] = []
  const add = (speaker: MemorySpeaker, content: string, suffix = '') => {
    if (!content.trim()) return
    const time = record.timestamp ?? message.timestamp ?? message.createdAt
    const timestamp = typeof time === 'string' ? time : typeof time === 'number' && Number.isFinite(time) ? new Date(time).toISOString() : undefined
    const nativeId = record.uuid ?? record.id ?? message.id ?? payload.id ?? payload.call_id
    result.push({ id: digest(JSON.stringify([engine, nativeId ?? position, suffix, speaker, content])), speaker, content, timestamp })
  }
  const user = engine === 'claude' ? claudeUserText(record) : engine === 'codex' ? codexUserText(record) : engine === 'pi' ? piUserText(record) : message.role === 'user' ? text(message.content) : ''
  const assistant = engine === 'claude' ? claudeAssistantText(record) : engine === 'codex' ? codexAssistantText(record) : engine === 'pi' ? piAssistantText(record) : message.role === 'assistant' ? text(message.content) : ''
  // Codex duplicates response_item messages in event_msg; use the source records only.
  if (engine !== 'codex' || record.type !== 'event_msg') {
    if (user && !(engine === 'claude' && record.isMeta === true) && !isRuntimeNotification(user)) add('user', user)
    if (assistant) add('assistant', assistant)
  }
  if (engine === 'claude' && Array.isArray(message.content)) {
    message.content.forEach((block, index) => { const part = object(block)
      if (part.type === 'tool_result') add('tool', text(part.content), String(index))
    })
  }
  if (engine === 'codex' && record.type === 'response_item' && ['function_call_output', 'custom_tool_call_output'].includes(String(payload.type))) {
    add('tool', text(payload.output))
  }
  if (engine === 'pi' && message.role === 'toolResult') add('tool', text(message.content))
  if (engine === 'janus' && ['tool', 'toolResult'].includes(String(message.role))) add('tool', text(message.content))
  return result
}

function selectTurn(messages: TranscriptEvidence[], expectedPrompt?: string, endedAt?: string): TranscriptCapture {
  let start = -1
  const normalize = (value: string) => value.trim().replace(/\s+/g, ' ')
  if (endedAt && expectedPrompt && messages.filter(message => message.speaker === 'user'
    && normalize(message.content) === normalize(expectedPrompt) && !message.timestamp).length > 1) {
    return { messages: [], reason: 'transcript-turn-boundary-ambiguous' }
  }
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].speaker === 'user' && (!endedAt || !messages[i].timestamp || Date.parse(messages[i].timestamp!) <= Date.parse(endedAt))
      && (!expectedPrompt || normalize(messages[i].content) === normalize(expectedPrompt))) { start = i; break }
  }
  if (start < 0) return { messages: [], reason: 'transcript-turn-boundary-missing' }
  let end = messages.findIndex((message, index) => index > start && message.speaker === 'user')
  if (end < 0) end = messages.length
  const turn = messages.slice(start, end)
  if (turn.length > 256 || turn.some(message => message.content.length > 200000)) return { messages: [], reason: 'transcript-turn-exceeds-budget' }
  if (!turn.some(message => message.speaker === 'assistant')) return { messages: [], reason: 'transcript-answer-not-ready' }
  return { messages: turn }
}

export async function readKnowledgeTurn(path: string, engine: string, sessionId?: string, expectedPrompt?: string, endedAt?: string, workspacePath?: string): Promise<TranscriptCapture> {
  if (!['claude', 'codex', 'pi', 'janus', 'opencode'].includes(engine)) return { messages: [], reason: 'transcript-engine-unsupported' }
  try {
    if (engine === 'opencode') {
      if (!sessionId) return { messages: [], reason: 'transcript-session-missing' }
      const { DatabaseSync } = await import('node:sqlite')
      const db = new DatabaseSync(path, { readOnly: true })
      try {
        if (workspacePath) {
          const session = db.prepare('SELECT directory FROM session WHERE id = ?').get(sessionId)
          if (!session || typeof session.directory !== 'string' || !sameRuntimePath(session.directory, workspacePath)) return { messages: [], reason: 'transcript-workspace-mismatch' }
        }
        const cutoff = endedAt && Number.isFinite(Date.parse(endedAt)) ? Date.parse(endedAt) : Number.MAX_SAFE_INTEGER
        const rows = db.prepare('SELECT id, data, time_created FROM message WHERE session_id = ? AND time_created <= ? ORDER BY time_created DESC LIMIT 257').all(sessionId, cutoff).reverse()
        const messages: TranscriptEvidence[] = []
        for (const row of rows) {
          const role = object(JSON.parse(String(row.data))).role
          const parts = db.prepare('SELECT id, data FROM part WHERE message_id = ? ORDER BY time_created ASC LIMIT 257').all(String(row.id))
          if (parts.length >= 257) return { messages: [], reason: 'transcript-turn-exceeds-budget' }
          const prose: string[] = []
          const toolMessages: TranscriptEvidence[] = []
          for (const part of parts) { const data = object(JSON.parse(String(part.data)))
            const content = data.type === 'text' ? text(data.text) : data.type === 'tool' ? text(object(data.state).output) : ''
            if (content && data.type === 'text') prose.push(content)
            if (content && data.type === 'tool') toolMessages.push({ id: digest(JSON.stringify([row.id, part.id, content])), content, speaker: 'tool' })
          }
          const content = prose.join('\n')
          if (content && !(role === 'user' && isRuntimeNotification(content))) messages.push({ id: digest(JSON.stringify([row.id, content])), content,
            timestamp: new Date(Number(row.time_created)).toISOString(), speaker: role === 'user' ? 'user' : role === 'assistant' ? 'assistant' : 'unknown' })
          messages.push(...toolMessages)
        }
        return selectTurn(messages, expectedPrompt, endedAt)
      } finally { db.close() }
    }
    const file = await open(path, 'r')
    let raw: string, offset: number
    try {
      const size = (await file.stat()).size
      offset = Math.max(0, size - MAX_BYTES)
      if (engine === 'janus' && offset) return { messages: [], reason: 'transcript-turn-exceeds-budget' }
      const bytes = Buffer.alloc(Math.min(size, MAX_BYTES))
      const { bytesRead } = await file.read(bytes, 0, bytes.length, offset)
      raw = bytes.subarray(0, bytesRead).toString('utf8')
      if ((await file.stat()).size !== size) return { messages: [], reason: 'transcript-changing' }
    } finally { await file.close() }
    if (engine === 'janus') {
      const rows = object(JSON.parse(raw)).messages
      if (!Array.isArray(rows)) return { messages: [], reason: 'transcript-format-unsupported' }
      return selectTurn(rows.flatMap((message, index) => parse({ message }, engine, index)), expectedPrompt, endedAt)
    }
    if (offset > 0) { const first = raw.indexOf('\n'); offset += Buffer.byteLength(raw.slice(0, first + 1)); raw = raw.slice(first + 1) }
    const messages: TranscriptEvidence[] = []
    for (const line of raw.split('\n')) {
      if (line.trim()) {
        try { messages.push(...parse(object(JSON.parse(line)), engine, offset)) }
        catch { return { messages: [], reason: 'transcript-incomplete-or-invalid' } }
      }
      offset += Buffer.byteLength(line) + 1
    }
    return selectTurn(messages, expectedPrompt, endedAt)
  } catch { return { messages: [], reason: 'transcript-unavailable' } }
}
