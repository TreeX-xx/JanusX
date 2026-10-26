// Note: external provider sessions import by transcript backfill — see
// .agents/notes/sessions/records/external-session-backfill.md
import { readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import {
  AGENT_ENGINE_CAPABILITIES,
  resolveSessionStorePath,
} from '../notifications/agent-engine-capabilities'
import type { AgentHookSource } from '../notifications/agent-hook-types'
import type { ImportExternalSessionInput } from './session-registry'
import { listOpencodeSessions } from './opencode-sessions'
import { readTranscriptSnapshot } from './transcript-snapshot'
import type { TranscriptTurn } from '../../shared/ipc/session'
// One per-engine record classification shared with the detail reader; the
// session pipeline and the knowledge pipeline read the same shapes.
import {
  claudeAssistantText,
  claudeUserText,
  codexAssistantText,
  codexUserText,
  parseJsonLine,
  piAssistantText,
  piUserText,
  textOfContent,
} from './transcript-kernel'

export {
  claudeAssistantText,
  claudeUserText,
  codexAssistantText,
  codexUserText,
  parseJsonLine,
  piAssistantText,
  piUserText,
  textOfContent,
}

export interface ExternalScanOptions {
  env?: NodeJS.ProcessEnv
  home?: string
  maxFilesPerEngine?: number
}

/** Desktop persistence and a remote scan collector share the same parser. */
export interface ExternalSessionSink {
  listSessions(filter: { includeArchived: boolean }): Array<{ engine: string; providerSessionId?: string }>
  beginBatch(): void
  endBatch(): void
  importExternalSession(input: ImportExternalSessionInput): unknown
}

export interface ExternalScanSummary {
  scanned: number
  imported: number
  updated: number
  skipped: number
}

/**
 * Engines with a readable session store, derived from the capability table in
 * table order. File-backed engines share the streaming transcript reader.
 */
const SCAN_ENGINES: AgentHookSource[] = (
  Object.keys(AGENT_ENGINE_CAPABILITIES) as AgentHookSource[]
).filter((source) => AGENT_ENGINE_CAPABILITIES[source].sessionStore !== null)
const MAX_FILES_PER_ENGINE = 200
const EXCERPT_MAX_CHARS = 500

interface FileCandidate {
  path: string
  mtimeMs: number
  size: number
}

interface ParsedTranscript {
  providerSessionId: string
  cwd: string
  firstPrompt: string
  lastExcerpt?: string
  turnCount: number
  preview: TranscriptTurn[]
  createdAt?: string
  updatedAt?: string
}

function truncate(text: string): string {
  return text.length > EXCERPT_MAX_CHARS ? text.slice(0, EXCERPT_MAX_CHARS) : text
}

function codexThreadFromFilename(path: string): string | undefined {
  const base = basename(path)
  const match = base.match(/-([0-9a-f]{8}[0-9a-f-]*)\.jsonl$/i)
  if (match?.[1]) return match[1]
  return base.endsWith('.jsonl') && base.length > 6 ? base.slice(0, -6) : undefined
}

async function* walkJsonl(root: string): AsyncGenerator<string> {
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const full = join(root, entry.name)
    if (entry.isDirectory()) {
      yield* walkJsonl(full)
    } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      yield full
    }
  }
}

async function collectCandidates(root: string, maxFiles: number): Promise<FileCandidate[]> {
  const candidates: FileCandidate[] = []
  for await (const path of walkJsonl(root)) {
    try {
      const info = await stat(path)
      if (!info.isFile() || info.size <= 0) continue
      candidates.push({ path, mtimeMs: info.mtimeMs, size: info.size })
    } catch {
      continue
    }
  }
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs)
  return candidates.slice(0, maxFiles)
}

function decodePiSlugDir(slug: string): string | undefined {
  const trimmed = slug.replace(/^-+|-+$/g, '')
  const drive = trimmed.match(/^([A-Za-z])--(.*)$/)
  if (!drive) return undefined
  const rest = drive[2].replace(/-{2,}/g, '/').replace(/-/g, '/')
  if (!rest) return undefined
  return `${drive[1]}:/${rest}`
}

function piSessionIdFromFilename(path: string): string | undefined {
  const base = basename(path)
  const match = base.match(/_([0-9a-f-]{8,})\.jsonl$/i)
  if (match?.[1]) return match[1]
  return base.endsWith('.jsonl') && base.length > 6 ? base.slice(0, -6) : undefined
}

// Per-registry cache: unchanged polling passes avoid re-reading tool-heavy files.
const parsedFiles = new WeakMap<ExternalSessionSink, Map<string, { mtimeMs: number; size: number; parsed: ParsedTranscript | null }>>()

async function parseFile(candidate: FileCandidate, engine: 'claude' | 'codex' | 'pi'): Promise<ParsedTranscript | null> {
  const snapshot = await readTranscriptSnapshot(candidate.path, engine, 2)
  if (!snapshot) return null
  const providerSessionId = snapshot.providerSessionId ?? (engine === 'codex'
    ? codexThreadFromFilename(candidate.path)
    : engine === 'pi' ? piSessionIdFromFilename(candidate.path) : basename(candidate.path, '.jsonl'))
  const cwd = snapshot.cwd ?? (engine === 'pi' ? decodePiSlugDir(basename(dirname(candidate.path))) : undefined)
  if (!providerSessionId || !cwd || (!snapshot.firstPrompt && !snapshot.lastExcerpt)) return null
  return {
    providerSessionId, cwd, firstPrompt: snapshot.firstPrompt,
    lastExcerpt: snapshot.lastExcerpt ? truncate(snapshot.lastExcerpt) : undefined,
    turnCount: snapshot.totalTurns,
    preview: snapshot.turns.map((turn) => ({
      ...(turn.prompt ? { prompt: truncate(turn.prompt) } : {}),
      ...(turn.excerpt ? { excerpt: truncate(turn.excerpt) } : {}),
    })),
    createdAt: snapshot.createdAt, updatedAt: snapshot.updatedAt,
  }
}

/**
 * Opencode sqlite backfill over the session table, newest rows first. One bad
 * row never fails the scan; an unreadable database skips the engine silently
 * like a missing transcript store.
 */
async function scanOpencodeStore(
  registry: ExternalSessionSink,
  dbPath: string,
  maxFiles: number,
  summary: ExternalScanSummary,
  known: Set<string>,
): Promise<void> {
  let rows: Awaited<ReturnType<typeof listOpencodeSessions>>
  try {
    rows = await listOpencodeSessions(dbPath, maxFiles)
  } catch {
    return
  }
  for (const row of rows) {
    summary.scanned += 1
    const input: ImportExternalSessionInput = {
      engine: 'opencode',
      cwd: row.cwd,
      providerSessionId: row.providerSessionId,
      transcriptPath: dbPath,
      firstPrompt: row.firstPrompt,
      ...(row.lastExcerpt ? { lastExcerpt: row.lastExcerpt } : {}),
      turnCount: row.turnCount,
      ...(row.createdAt ? { createdAt: row.createdAt } : {}),
      ...(row.updatedAt ? { updatedAt: row.updatedAt } : {}),
    }
    const key = `opencode::${row.providerSessionId}`
    const isKnown = known.has(key)
    try {
      registry.importExternalSession(input)
      known.add(key)
      if (isKnown) summary.updated += 1
      else summary.imported += 1
    } catch (err) {
      console.error('[sessions] external import failed:', row.providerSessionId, err)
      summary.skipped += 1
    }
  }
}
/**
 * Pull-mode backfill over provider transcript stores. Every file tolerates
 * unknown shapes and corrupt lines; a single bad file never fails the scan.
 * Repeat scans deduplicate on engine plus provider session id inside the
 * registry, so boot passes and panel-open passes converge without duplicates.
 */
export async function scanExternalSessions(
  registry: ExternalSessionSink,
  options: ExternalScanOptions = {},
): Promise<ExternalScanSummary> {
  const env = options.env ?? process.env
  const home = options.home ?? homedir()
  const maxFiles = options.maxFilesPerEngine ?? MAX_FILES_PER_ENGINE
  const summary: ExternalScanSummary = { scanned: 0, imported: 0, updated: 0, skipped: 0 }
  const known = new Set(
    registry.listSessions({ includeArchived: true }).map((session) => `${session.engine}::${session.providerSessionId ?? ''}`),
  )

  // One bulk pass emits one session:event: per-row notifies would refetch
  // and reorder the card list hundreds of times per scan.
  const cache = parsedFiles.get(registry) ?? new Map()
  parsedFiles.set(registry, cache)
  const visited = new Set<string>()
  registry.beginBatch()
  try {
    for (const engine of SCAN_ENGINES) {
      const store = resolveSessionStorePath(engine as AgentHookSource, env, home)
      if (!store) continue
      // Opencode persists sessions in sqlite, not transcript files: list the
      // newest rows directly instead of walking for jsonl.
      if (engine === 'opencode') {
        await scanOpencodeStore(registry, store, maxFiles, summary, known)
        continue
      }
      const candidates = await collectCandidates(store, maxFiles)
      for (const candidate of candidates) {
        summary.scanned += 1
        visited.add(candidate.path)
        const cached = cache.get(candidate.path)
        const parsed = cached && cached.mtimeMs === candidate.mtimeMs && cached.size === candidate.size
          ? cached.parsed
          : await parseFile(candidate, engine as 'claude' | 'codex' | 'pi')
        cache.set(candidate.path, { mtimeMs: candidate.mtimeMs, size: candidate.size, parsed })
        if (!parsed) {
          summary.skipped += 1
          continue
        }
        const input: ImportExternalSessionInput = {
          engine,
          cwd: parsed.cwd,
          providerSessionId: parsed.providerSessionId,
          transcriptPath: candidate.path,
          firstPrompt: parsed.firstPrompt,
          ...(parsed.lastExcerpt ? { lastExcerpt: parsed.lastExcerpt } : {}),
          turnCount: parsed.turnCount,
          preview: parsed.preview,
          ...(parsed.createdAt ? { createdAt: parsed.createdAt } : {}),
          ...(parsed.updatedAt ? { updatedAt: parsed.updatedAt } : {}),
        }
        const key = `${engine}::${parsed.providerSessionId}`
        const isKnown = known.has(key)
        try {
          registry.importExternalSession(input)
          known.add(key)
          if (isKnown) summary.updated += 1
          else summary.imported += 1
        } catch (err) {
          console.error('[sessions] external import failed:', candidate.path, err)
          summary.skipped += 1
        }
      }
    }
    return summary
  } finally {
    for (const path of cache.keys()) if (!visited.has(path)) cache.delete(path)
    registry.endBatch()
  }
}
