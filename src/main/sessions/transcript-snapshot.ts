// Note: stream provider records instead of cutting JSONL byte windows — see
// .agents/notes/sessions/records/external-session-backfill.md
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import type { TranscriptTurn } from '../../shared/ipc/session'
import { kernelMessagesFromRecords, parseJsonLine, type KernelMessage, type TranscriptKernelEngine } from './transcript-kernel'
import { sessionReadFailure, type SessionReadIssue } from './read-issue'

export const SNAPSHOT_TURN_CAP = 100
export const SNAPSHOT_TEXT_CAP = 200_000
const MAX_RECORD_BYTES = 2 * 1024 * 1024

export interface TranscriptSnapshot {
  providerSessionId?: string
  cwd?: string
  createdAt?: string
  updatedAt: string
  firstPrompt: string
  title?: string
  lastExcerpt?: string
  totalTurns: number
  turns: TranscriptTurn[]
  truncated: boolean
}

/** Retain only bounded conversation prose, never tool output or full history. */
class TurnCollector {
  readonly turns: TranscriptTurn[] = []
  totalTurns = 0
  firstPrompt = ''
  lastExcerpt?: string
  truncated = false
  private current?: TranscriptTurn

  constructor(private readonly keep: number) {}

  private cap(text: string): string {
    if (text.length <= SNAPSHOT_TEXT_CAP) return text
    this.truncated = true
    return `${text.slice(0, SNAPSHOT_TEXT_CAP)}…`
  }

  push(message: KernelMessage): void {
    if (message.role === 'user') {
      this.finish()
      const prompt = this.cap(message.text)
      this.firstPrompt ||= prompt
      this.current = { prompt }
    } else {
      this.current ??= {}
      this.current.excerpt = this.cap(this.current.excerpt ? `${this.current.excerpt}\n${message.text}` : message.text)
      this.lastExcerpt = this.current.excerpt
    }
  }

  finish(): void {
    if (!this.current) return
    this.totalTurns++
    this.turns.push(this.current)
    if (this.turns.length > this.keep) {
      this.turns.shift()
      this.truncated = true
    }
    this.current = undefined
  }
}

function string(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

/**
 * Read a fixed file-size snapshot, yielding between chunks. Records may cross
 * any number of chunks; an oversized row is discarded through its newline.
 * UTF-8 is decoded only after a complete row, including multi-byte boundaries.
 */
export async function readTranscriptSnapshot(
  path: string,
  engine: TranscriptKernelEngine,
  keepTurns = SNAPSHOT_TURN_CAP,
  onIssue?: (reason: SessionReadIssue['reason']) => void,
): Promise<TranscriptSnapshot | null> {
  try {
    const info = await stat(path)
    if (!info.isFile() || info.size === 0) return null
    const source = new TurnCollector(Math.max(1, keepTurns))
    const mirror = new TurnCollector(Math.max(1, keepTurns))
    let hasSource = false
    let dropped = false
    let providerSessionId: string | undefined
    let cwd: string | undefined
    let createdAt: string | undefined
    let title: string | undefined
    let customTitle: string | undefined
    let parsedRecords = 0, knownRecords = 0
    const consume = (line: Buffer) => {
      const record = parseJsonLine(line.toString('utf8'))
      if (!record) return
      parsedRecords++
      if (engine === 'codex' ? ['session_meta', 'turn_context', 'response_item', 'event_msg'].includes(String(record.type))
        : engine === 'pi' ? ['session', 'session_info', 'message'].includes(String(record.type))
          : ['user', 'assistant', 'system', 'custom-title', 'ai-title'].includes(String(record.type))) knownRecords++
      // Provider-authored titles are metadata, never conversation turns.
      if (engine === 'claude') {
        if (record.type === 'custom-title') customTitle = string(record.customTitle) ?? customTitle
        if (record.type === 'ai-title') title = string(record.aiTitle) ?? title
      }
      if (engine === 'pi' && record.type === 'session_info') title = string(record.name) ?? title
      const payload = record.payload && typeof record.payload === 'object'
        ? record.payload as Record<string, unknown> : undefined
      if (engine === 'codex') {
        if (record.type === 'session_meta') {
          providerSessionId ??= string(payload?.id) ?? string(record.session_id)
          cwd ??= string(payload?.cwd)
        }
        if (record.type === 'turn_context') cwd ??= string(payload?.cwd)
      } else {
        providerSessionId ??= string(record.sessionId) ?? string(record.session_id)
          ?? (record.type === 'session' ? string(record.id) : undefined)
        cwd ??= string(record.cwd)
      }
      const stamp = record.timestamp ?? record.created_at ?? record.createdAt
      const ms = typeof stamp === 'number' ? (stamp < 1e12 ? stamp * 1000 : stamp)
        : typeof stamp === 'string' ? Date.parse(stamp) : NaN
      if (Number.isFinite(ms)) {
        const iso = new Date(ms).toISOString()
        if (!createdAt || iso < createdAt) createdAt = iso
      }
      const messages = kernelMessagesFromRecords([record], engine, { hasInputOrder: true })
      if (engine === 'codex' && record.type === 'event_msg') {
        for (const message of messages) mirror.push(message)
      } else {
        if (messages.length) hasSource = true
        for (const message of messages) source.push(message)
      }
    }
    let parts: Buffer[] = []
    let bytes = 0
    let skipping = false
    const stream = createReadStream(path, { highWaterMark: 64 * 1024, end: info.size - 1 })
    for await (const chunk of stream) {
      const buffer = chunk as Buffer
      let offset = 0
      while (offset < buffer.length) {
        const newline = buffer.indexOf(10, offset)
        const end = newline < 0 ? buffer.length : newline
        const part = buffer.subarray(offset, end)
        if (!skipping) {
          bytes += part.length
          if (bytes > MAX_RECORD_BYTES) {
            parts = []
            skipping = true
            dropped = true
          } else parts.push(part)
        }
        if (newline >= 0) {
          if (!skipping) consume(Buffer.concat(parts, bytes))
          parts = []
          bytes = 0
          skipping = false
        }
        offset = end + 1
      }
    }
    if (!skipping && bytes) consume(Buffer.concat(parts, bytes))
    const collector = engine === 'codex' && !hasSource ? mirror : source
    collector.finish()
    if (!parsedRecords) onIssue?.('corrupt')
    else if (!knownRecords) onIssue?.('unsupported-schema')
    return {
      providerSessionId, cwd, createdAt, updatedAt: new Date(info.mtimeMs).toISOString(),
      firstPrompt: collector.firstPrompt, title: customTitle ?? title, lastExcerpt: collector.lastExcerpt,
      totalTurns: collector.totalTurns, turns: collector.turns,
      truncated: dropped || collector.truncated,
    }
  } catch (error) {
    onIssue?.(sessionReadFailure(error))
    return null
  }
}
