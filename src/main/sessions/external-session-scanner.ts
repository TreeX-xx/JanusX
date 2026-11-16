// Note: external provider sessions import by transcript backfill — see
// .agents/notes/sessions/records/external-session-backfill.md
// Provider titles and first-prompt separation:
// .agents/notes/sessions/records/session-content-truth-kernel.md
import { readdir, stat } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import {
  AGENT_ENGINE_CAPABILITIES,
} from '../notifications/agent-engine-capabilities'
import type { AgentHookSource } from '../notifications/agent-hook-types'
import type { ImportExternalSessionInput } from './session-registry'
import { listOpencodeSessions } from './opencode-sessions'
import { readTranscriptSnapshot } from './transcript-snapshot'
import type { TranscriptTurn } from '../../shared/ipc/session'
import { providerPathContext, resolveProviderPaths } from '../external-cli/provider-paths'
import { runtimePathKey } from '../../shared/runtime/path-identity'
import { sessionReadFailure, type SessionReadIssue } from './read-issue'
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
  sources?: import('../../shared/history-sources').HistorySource[]
  env?: NodeJS.ProcessEnv
  home?: string
  maxFilesPerEngine?: number
  cwdRoots?: string[]
  additionalStores?: Partial<Record<AgentHookSource, string[]>>
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
  issues: SessionReadIssue[]
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
  title?: string
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

async function* walkJsonl(root: string, issue: (path: string, reason: SessionReadIssue['reason']) => void, budget = { remaining: 20_000 }): AsyncGenerator<string> {
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch (error) {
    issue(root, sessionReadFailure(error))
    return
  }
  for (const entry of entries) {
    if (--budget.remaining < 0) { issue(root, 'scan-limit'); return }
    const full = join(root, entry.name)
    if (entry.isDirectory()) {
      yield* walkJsonl(full, issue, budget)
    } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      yield full
    }
  }
}

async function collectCandidates(root: string, maxFiles: number, issue: (path: string, reason: SessionReadIssue['reason']) => void): Promise<FileCandidate[]> {
  const candidates: FileCandidate[] = []
  for await (const path of walkJsonl(root, issue)) {
    try {
      const info = await stat(path)
      if (!info.isFile() || info.size <= 0) continue
      candidates.push({ path, mtimeMs: info.mtimeMs, size: info.size })
    } catch (error) {
      issue(path, sessionReadFailure(error))
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
const parsedFiles = new WeakMap<ExternalSessionSink, Map<string, { mtimeMs: number; size: number; parsed: ParsedTranscript | null; issues: SessionReadIssue['reason'][] }>>()

/** Read on each scan: Codex can rename a thread without changing its rollout. */
async function codexThreadTitles(store: string): Promise<Map<string, string>> {
  const titles = new Map<string, string>()
  const source = createReadStream(join(dirname(store), 'session_index.jsonl'), { encoding: 'utf8' })
  const lines = createInterface({ input: source, crlfDelay: Infinity })
  try {
    for await (const line of lines) {
      const row = parseJsonLine(line)
      if (typeof row?.id !== 'string' || typeof row.thread_name !== 'string') continue
      const title = row.thread_name.trim()
      if (title) titles.set(row.id, title)
    }
  } catch {
    // Older CLIs have no index; rollout content remains available.
  } finally {
    lines.close()
    source.destroy()
  }
  return titles
}

async function parseFile(candidate: FileCandidate, engine: 'claude' | 'codex' | 'pi', onIssue: (reason: SessionReadIssue['reason']) => void): Promise<ParsedTranscript | null> {
  const snapshot = await readTranscriptSnapshot(candidate.path, engine, 2, onIssue)
  if (!snapshot) return null
  const providerSessionId = snapshot.providerSessionId ?? (engine === 'codex'
    ? codexThreadFromFilename(candidate.path)
    : engine === 'pi' ? piSessionIdFromFilename(candidate.path) : basename(candidate.path, '.jsonl'))
  const cwd = snapshot.cwd ?? (engine === 'pi' ? decodePiSlugDir(basename(dirname(candidate.path))) : undefined)
  if (!providerSessionId || !cwd || (!snapshot.firstPrompt && !snapshot.lastExcerpt)) return null
  return {
    providerSessionId, cwd, firstPrompt: snapshot.firstPrompt, title: snapshot.title,
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
    await stat(dbPath)
    rows = await listOpencodeSessions(dbPath, maxFiles, error => summary.issues.push({ engine: 'opencode', path: dbPath, reason: sessionReadFailure(error) }))
  } catch (error) {
    summary.issues.push({ engine: 'opencode', path: dbPath, reason: sessionReadFailure(error) })
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
      title: row.title,
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
  const summary: ExternalScanSummary = { scanned: 0, imported: 0, updated: 0, skipped: 0, issues: [] }
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
      const stores = new Map<string, string>()
      const issue = (path: string, reason: SessionReadIssue['reason']) => {
        if (summary.issues.length < 200 && !summary.issues.some(item => item.engine === engine && item.path === path && item.reason === reason)) summary.issues.push({ engine, path, reason })
      }
      for (const cwd of options.sources ? [] : [undefined, ...(options.cwdRoots ?? [])]) {
        const effective = resolveProviderPaths(engine, providerPathContext({ env, home, cwd }))
        for (const problem of effective.issues) if (!(problem.reason === 'relative-without-cwd' && !cwd && options.cwdRoots?.length)) issue(problem.path, 'config-error')
        if (effective.store) stores.set(runtimePathKey(effective.store), effective.store)
      }
      if (engine !== 'opencode') for (const store of options.additionalStores?.[engine] ?? []) stores.set(runtimePathKey(store), store)
      if (options.sources) {
        stores.clear()
        for (const source of options.sources) if (source.engine === engine && source.enabled) stores.set(runtimePathKey(source.path), source.path)
      }
      if (!stores.size) continue
      // Opencode persists sessions in sqlite, not transcript files: list the
      // newest rows directly instead of walking for jsonl.
      if (engine === 'opencode') {
        // The active database alone is valid for OpenCode resume; never borrow
        // an old override, or copy a live SQLite main file away from its WAL.
        const start = summary.scanned
        for (const store of stores.values()) {
          const remaining = maxFiles - (summary.scanned - start)
          if (remaining <= 0) break
          await scanOpencodeStore(registry, store, remaining, summary, known)
        }
        continue
      }
      const unique = new Map<string, FileCandidate>()
      for (const store of stores.values()) for (const candidate of await collectCandidates(store, maxFiles, issue)) unique.set(runtimePathKey(candidate.path), candidate)
      const candidates = [...unique.values()].sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, maxFiles)
      const titles = engine === 'codex' ? new Map((await Promise.all([...stores.values()].map(codexThreadTitles))).flatMap(map => [...map])) : undefined
      for (const candidate of candidates) {
        summary.scanned += 1
        visited.add(candidate.path)
        const cached = cache.get(candidate.path)
        const unchanged = cached && cached.mtimeMs === candidate.mtimeMs && cached.size === candidate.size
        const issues: SessionReadIssue['reason'][] = unchanged ? cached.issues : []
        const parsed = unchanged ? cached.parsed : await parseFile(candidate, engine as 'claude' | 'codex' | 'pi', reason => issues.push(reason))
        for (const reason of issues) issue(candidate.path, reason)
        cache.set(candidate.path, { mtimeMs: candidate.mtimeMs, size: candidate.size, parsed, issues })
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
          title: titles?.get(parsed.providerSessionId) ?? parsed.title,
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
