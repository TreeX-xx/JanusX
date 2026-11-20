// Note: .agents/notes/terminal/requirements/dsh-telemetry-completion.md
import { open } from 'node:fs/promises'
import { basename, dirname } from 'node:path'
import { setImmediate as yieldToEventLoop } from 'node:timers/promises'
import { promisify } from 'node:util'
import { constants, zstdDecompress } from 'node:zlib'
import type { UsageEvent, UsageObservation } from '../../shared/usage'
import { usageTokens } from './history-usage'
import { sourceVersion } from './source-version'

const MAX_BYTES = 64 * 1024 * 1024
const HEADER_BYTES = 64 * 1024
const decompress = promisify(zstdDecompress)
const logName = /^session(?:\.v(\d+))?\.jsonl(?:\.zstd)?$/

export function isDshLog(name: string): boolean { return logName.test(name) }

/** DSH keeps the previous format beside its replacement. Read one per session. */
export function latestDshLogs<T extends { path: string; updatedAt: number }>(files: T[]): T[] {
  const latest = new Map<string, { version: number; file: T }>()
  for (const file of files) {
    const match = logName.exec(basename(file.path))
    if (!match) continue
    const dir = dirname(file.path)
    const version = Number(match[1] ?? 0)
    const previous = latest.get(dir)
    if (!previous || version > previous.version || (version === previous.version && file.updatedAt > previous.file.updatedAt)) {
      latest.set(dir, { version, file })
    }
  }
  return [...latest.values()].map(entry => entry.file)
}

async function readLog(path: string, headerOnly: boolean, signal?: AbortSignal) {
  const file = await open(path, 'r')
  try {
    const info = await file.stat()
    const limit = headerOnly ? HEADER_BYTES : MAX_BYTES
    if (!headerOnly && info.size > limit) throw new Error('DSH session exceeds the read limit')
    const bytes = Buffer.allocUnsafe(Math.min(limit, info.size))
    let read = 0
    while (read < bytes.length) {
      signal?.throwIfAborted()
      const { bytesRead } = await file.read(bytes, read, bytes.length - read, read)
      if (!bytesRead) throw new Error('DSH session truncated during read')
      read += bytesRead
    }
    const version = sourceVersion(info)
    if (!path.endsWith('.zstd')) return { bytes, version, complete: read === info.size }
    const frames: Buffer[] = []
    let decoded = 0
    let offset = 0
    while (offset < bytes.length) {
      signal?.throwIfAborted()
      try {
        // DSH appends independent frames. Node decodes one and reports the
        // compressed bytes it consumed when info=true (not typed by @types/node).
        const frame = await decompress(bytes.subarray(offset), {
          info: true, maxOutputLength: limit - decoded, params: { [constants.ZSTD_d_windowLogMax]: 26 },
        }) as unknown as { buffer: Buffer; engine: { bytesWritten: number } }
        if (!frame.engine.bytesWritten) throw new Error('Empty DSH frame')
        offset += frame.engine.bytesWritten
        decoded += frame.buffer.length
        frames.push(frame.buffer)
        if (headerOnly && frame.buffer.includes(10)) break
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'Z_BUF_ERROR') break
        throw error
      }
    }
    return { bytes: Buffer.concat(frames, decoded), version, complete: offset === info.size }
  } finally { await file.close() }
}

interface DshRow {
  type?: string; id?: string; version?: number; isSeeded?: boolean; seedLength?: number
  seq?: number; time?: number
  data?: {
    inherited?: boolean
    usage?: { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number; totalTokens?: number }
    message?: { source?: { model?: string; replayState?: { response?: { responseModel?: string; model?: string } } } }
  }
}

export async function readDshUsage(path: string, namespace: string, collectedAt: number, headerOnly = false, signal?: AbortSignal): Promise<UsageObservation | undefined> {
  const log = await readLog(path, headerOnly, signal)
  let observation: UsageObservation | undefined
  let seeded = false
  let seedLength = 0
  let lines = 0
  const events: UsageEvent[] = []
  for (let start = 0; start < log.bytes.length;) {
    if (++lines % 512 === 0) { await yieldToEventLoop(); signal?.throwIfAborted() }
    const newline = log.bytes.indexOf(10, start)
    const line = log.bytes.toString('utf8', start, newline < 0 ? log.bytes.length : newline).trim()
    start = newline < 0 ? log.bytes.length : newline + 1
    if (!line) continue
    let row: DshRow
    try { row = JSON.parse(line) } catch {
      if (newline < 0) { log.complete = false; break }
      throw new Error('Invalid DSH session JSONL')
    }
    if (!observation) {
      if (row?.type !== 'session' || typeof row.id !== 'string' || !row.id.trim()) throw new Error('Invalid DSH session header')
      observation = { engine: 'dsh', namespace, sessionId: row.id, collectedAt, mode: 'events', events }
      if (headerOnly) return observation
      seeded = (row.version ?? 0) >= 2 && row.isSeeded === true
      seedLength = (row.version ?? 0) < 2 ? row.seedLength ?? 0 : 0
      if (!Number.isSafeInteger(seedLength) || seedLength < 0) throw new Error('Invalid DSH seed length')
      continue
    }
    if (row?.type === 'session/end-seed' && seeded && typeof row.data?.inherited === 'boolean') {
      // inherited=false means that the preamble belongs to this session.
      if (row.data?.inherited === true) { events.length = 0; observation.issue = undefined }
      seeded = false
      continue
    }
    const usage = row?.data?.usage
    if (row?.type !== 'assistant/message' || !usage) continue
    if (!Number.isSafeInteger(row.seq) || row.seq! < 0) { observation.issue = 'missing-event-identity'; continue }
    if (row.seq! < seedLength) continue
    const tokens = usageTokens(usage.inputTokens, usage.outputTokens, usage.cacheReadTokens, usage.cacheWriteTokens, usage.totalTokens)
    if (!tokens || !Number.isSafeInteger(row.time) || row.time! <= 0) { observation.issue = 'invalid-event'; continue }
    const source = row.data?.message?.source
    const model = source?.replayState?.response?.responseModel || source?.replayState?.response?.model || source?.model
    events.push({ ...tokens, id: JSON.stringify([observation.sessionId, row.seq]), at: row.time, model: typeof model === 'string' ? model : undefined })
  }
  if (seeded) { events.length = 0; if (observation) observation.issue = 'incomplete-seed' }
  if (observation && log.complete) observation.sourceIdentity = log.version
  return observation
}
