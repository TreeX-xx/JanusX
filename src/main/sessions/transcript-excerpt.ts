// Note: transcript prose read per engine capability — see
// .agents/notes/sessions/records/session-engine-capabilities.md
import { open, readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { AGENT_ENGINE_CAPABILITIES, resolveSessionStorePath } from '../notifications/agent-engine-capabilities'
import type { AgentHookSource } from '../notifications/agent-hook-types'
import { readTranscriptSnapshot } from './transcript-snapshot'
import { runtimePathKey } from '../../shared/runtime/path-identity'

// Bounded read: backward chunk reads with a hard cap; full history never loads.
const TRANSCRIPT_TAIL_BYTES = 64 * 1024
const EXCERPT_MAX_CHARS = 500
/** Single-doc histories (janus) parse whole with a size cap instead. */
const SINGLE_DOC_MAX_BYTES = 2 * 1024 * 1024
const META_HEAD_BYTES = 2 * 1024 * 1024

export interface ExcerptContext {
  transcriptPath?: string
  sessionId?: string
  threadId?: string
  cwd?: string
  engine: string
  /** Test seam: home directory override for transcript stores. */
  baseDir?: string
}

function truncate(text: string): string {
  return text.length > EXCERPT_MAX_CHARS ? text.slice(0, EXCERPT_MAX_CHARS) : text
}

function normalizePath(value?: string): string | undefined {
  const normalized = value ? runtimePathKey(value) : undefined
  return normalized || undefined
}

async function readTail(path: string, maxBytes: number): Promise<string | undefined> {
  let handle
  try {
    handle = await open(path, 'r')
  } catch {
    return undefined
  }
  try {
    const size = (await handle.stat()).size
    if (size <= 0) return undefined
    const length = Math.min(maxBytes, size)
    const buffer = Buffer.alloc(length)
    const { bytesRead } = await handle.read(buffer, 0, length, size - length)
    if (bytesRead <= 0) return undefined
    return buffer.subarray(0, bytesRead).toString('utf-8')
  } catch {
    return undefined
  } finally {
    await handle.close().catch(() => undefined)
  }
}

function parseJsonLine(line: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(line) as unknown
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/** Last assistant text wins scanning backward; corrupt lines never block. */
function lastAssistantText(
  lines: string[],
  roleOf: (record: Record<string, unknown>) => string | undefined,
  textOf: (record: Record<string, unknown>) => string | undefined,
): string | undefined {
  const start = lines.length > 1 ? 1 : 0
  for (let i = lines.length - 1; i >= start; i -= 1) {
    const line = lines[i].trim()
    if (!line) continue
    const record = parseJsonLine(line)
    if (!record || roleOf(record) !== 'assistant') continue
    const text = textOf(record)
    if (text) return text
  }
  return undefined
}

interface ClaudeContentBlock {
  type?: string
  text?: string
}

function claudeTextOf(record: Record<string, unknown>): string | undefined {
  const message = record.message
  if (!message || typeof message !== 'object') return undefined
  const content = (message as { content?: unknown }).content
  if (typeof content === 'string') return content.trim() || undefined
  if (!Array.isArray(content)) return undefined
  const texts = content
    .filter(
      (block): block is ClaudeContentBlock =>
        !!block && typeof block === 'object' && (block as ClaudeContentBlock).type === 'text',
    )
    .map((block) => (typeof block.text === 'string' ? block.text : ''))
    .join('')
    .trim()
  return texts || undefined
}

function claudeRoleOf(record: Record<string, unknown>): string | undefined {
  return typeof record.type === 'string' ? record.type : undefined
}

async function claudeExcerpt(transcriptPath: string): Promise<string | undefined> {
  const tail = await readTail(transcriptPath, TRANSCRIPT_TAIL_BYTES)
  if (!tail) return undefined
  const text = lastAssistantText(tail.split('\n'), claudeRoleOf, claudeTextOf)
  return text ? truncate(text) : undefined
}

async function codexMetaHead(path: string): Promise<Record<string, unknown> | null> {
  const handle = await open(path, 'r').catch(() => null)
  if (!handle) return null
  try {
    const chunks: Buffer[] = []
    let position = 0
    while (position < META_HEAD_BYTES) {
      const buffer = Buffer.alloc(64 * 1024)
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position)
      if (!bytesRead) break
      const part = buffer.subarray(0, bytesRead)
      const newline = part.indexOf(10)
      chunks.push(newline < 0 ? part : part.subarray(0, newline))
      position += bytesRead
      if (newline >= 0) return parseJsonLine(Buffer.concat(chunks).toString('utf8'))
    }
    return position < META_HEAD_BYTES ? parseJsonLine(Buffer.concat(chunks).toString('utf8')) : null
  } catch {
    return null
  } finally {
    await handle.close().catch(() => undefined)
  }
}

async function* walkJsonlFiles(root: string): AsyncGenerator<string> {
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const full = join(root, entry.name)
    if (entry.isDirectory()) {
      yield* walkJsonlFiles(full)
    } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      yield full
    }
  }
}

/**
 * Rollout files end with the thread id (`rollout-<ts>-<threadId>.jsonl`);
 * without one, the freshest rollout whose session_meta cwd matches wins.
 */
async function resolveCodexRollout(
  storePath: string,
  threadId?: string,
  cwd?: string,
): Promise<string | undefined> {
  const wantedThread = threadId?.trim().toLowerCase()
  const wantedCwd = normalizePath(cwd)
  let fallback: { path: string; mtimeMs: number } | null = null
  for await (const path of walkJsonlFiles(storePath)) {
    if (wantedThread && basename(path).toLowerCase().endsWith(`-${wantedThread}.jsonl`)) {
      return path
    }
    if (!wantedThread && wantedCwd) {
      const meta = await codexMetaHead(path)
      const metaCwd =
        meta && meta.type === 'session_meta'
          ? normalizePath(
              ((meta.payload as { cwd?: unknown } | undefined)?.cwd as string | undefined) ??
                undefined,
            )
          : undefined
      if (metaCwd === wantedCwd) {
        try {
          const mtimeMs = (await stat(path)).mtimeMs
          if (!fallback || mtimeMs > fallback.mtimeMs) fallback = { path, mtimeMs }
        } catch {
          // Raced deletion between walk and stat.
        }
      }
    }
  }
  return fallback?.path
}

async function codexExcerpt(
  context: ExcerptContext,
): Promise<string | undefined> {
  const store = resolveSessionStorePath('codex', context.baseDir ? {} : process.env, context.baseDir ?? homedir())!
  const path = context.transcriptPath?.trim()
    || await resolveCodexRollout(store, context.threadId ?? context.sessionId, context.cwd)
  if (!path) return undefined
  const text = (await readTranscriptSnapshot(path, 'codex', 1))?.lastExcerpt
  return text ? truncate(text) : undefined
}

interface JanusMessagePart {
  type?: string
  text?: string
}

function janusTextOf(message: unknown): string | undefined {
  if (!message || typeof message !== 'object') return undefined
  const record = message as { role?: unknown; content?: unknown }
  if (record.role !== 'assistant') return undefined
  if (typeof record.content === 'string') return record.content.trim() || undefined
  if (!Array.isArray(record.content)) return undefined
  const texts = record.content
    .filter(
      (part): part is JanusMessagePart =>
        !!part && typeof part === 'object' && (part as JanusMessagePart).type === 'text',
    )
    .map((part) => (typeof part.text === 'string' ? part.text : ''))
    .join('')
    .trim()
  return texts || undefined
}

async function janusExcerpt(baseDir: string, sessionId: string): Promise<string | undefined> {
  const path = join(baseDir, '.janus', 'history', `${sessionId}.jsonl`)
  let raw: string
  try {
    const handle = await open(path, 'r')
    try {
      const size = (await handle.stat()).size
      if (size <= 0 || size > SINGLE_DOC_MAX_BYTES) return undefined
      const buffer = Buffer.alloc(size)
      const { bytesRead } = await handle.read(buffer, 0, size, 0)
      raw = buffer.subarray(0, bytesRead).toString('utf-8')
    } finally {
      await handle.close().catch(() => undefined)
    }
  } catch {
    return undefined
  }
  const parsed = parseJsonLine(raw)
  const messages = parsed?.messages
  if (!Array.isArray(messages)) return undefined
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const text = janusTextOf(messages[i])
    if (text) return truncate(text)
  }
  return undefined
}

/**
 * Best-effort answer excerpt for a finished turn. Dispatches on the engine
 * capability table and never throws: every failure yields undefined so a
 * missing or unreadable transcript cannot block turn recording. Turn-end
 * excerpts cover file transcripts only; opencode sqlite serves list and
 * detail reads through sessions/opencode-sessions while its turns stay
 * status-only here, and pi has no store at all.
 */
export async function readAssistantExcerpt(context: ExcerptContext): Promise<string | undefined> {
  try {
    const capability =
      AGENT_ENGINE_CAPABILITIES[context.engine as AgentHookSource] ?? null
    if (!capability || capability.transcript === null) return undefined
    const baseDir = context.baseDir ?? homedir()
    if (capability.transcript === 'claude-jsonl') {
      const path = context.transcriptPath?.trim()
      if (!path) return undefined
      return claudeExcerpt(path)
    }
    if (capability.transcript === 'codex-rollout') {
      return codexExcerpt(context)
    }
    const sessionId = context.sessionId?.trim()
    if (!sessionId) return undefined
    return janusExcerpt(baseDir, sessionId)
  } catch {
    return undefined
  }
}
