import { readdir, open, readFile, stat } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import os from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'
import { statSync, type Stats } from 'node:fs'
import type { RuntimeTelemetryRequest, RuntimeTelemetrySnapshot } from '../../shared/ipc/system'
import type { UsageEngine, UsageObservation, UsageSourceCheckpoint } from '../../shared/usage'
import { collectUsageEvents, cumulativeUsage, usageTokens } from './history-usage'
import { sourceVersion } from './source-version'
import { OpenCodeUsageSource } from './opencode-source'
import { resolveOpencodeDbPath } from '../sessions/opencode-store-path'

export type HistoryTelemetrySnapshot = RuntimeTelemetrySnapshot & { usageObservation?: UsageObservation; sourceVersion?: string }
export type HistoryTelemetryRequest = RuntimeTelemetryRequest & { codexHome?: string }
export interface JsonlSourceRead { buffer: Buffer; info: Stats }
type CheckpointLookup = (engine: UsageEngine, namespace: string, sessionId: string) => UsageSourceCheckpoint | undefined

export interface SessionFileRef {
  path: string
  updatedAt: number
  namespace?: string
}

interface JsonRecord {
  [key: string]: unknown
}

const MAX_CODEX_CANDIDATES = 80
const STARTED_AT_TOLERANCE_MS = 1_000
const TELEMETRY_HEAD_BYTES = 16 * 1024
// Only model discovery may use head/tail sampling. Bound usage requires complete records.
const TELEMETRY_TAIL_BYTES = 256 * 1024
const MAX_SESSION_BYTES = 64 * 1024 * 1024

export async function getRuntimeTelemetrySnapshot(
  request: HistoryTelemetryRequest,
  checkpointLookup?: CheckpointLookup,
): Promise<HistoryTelemetrySnapshot | null> {
  const preset = request.preset
  const cwd = normalizePath(request.cwd)
  const startedAt = readStartedAt(request.startedAt)
  const sessionId = readString(request.sessionId)

  if (!preset || preset === 'shell' || !cwd) return null
  // Never infer a session from a shared cwd. Two JanusX terminals can launch
  // the same CLI in the same workspace at once; only an adapter/hook-provided
  // session id is safe to read as terminal-specific telemetry.
  if (preset === 'claude') {
    return sessionId
      ? scanClaudeHistory(cwd, startedAt, sessionId)
      : readClaudeBootstrapTelemetry()
  }
  if (preset === 'codex') {
    const codexHome = request.codexHome?.trim() || process.env.CODEX_HOME?.trim() || join(os.homedir(), '.codex')
    return sessionId
      ? scanCodexHistory(codexHome, cwd, startedAt, sessionId, checkpointLookup)
      : readCodexBootstrapTelemetry(codexHome)
  }
  if (preset === 'opencode') {
    return sessionId
      ? readOpenCodeSessionTelemetry(cwd, sessionId, checkpointLookup)
      : readOpenCodeBootstrapTelemetry(cwd)
  }
  // Note: janus/pi use native history + declared config for numeric telemetry —
  // see .agents/notes/terminal/janus-pi-context-recognition.md
  if (preset === 'janus') {
    return sessionId
      ? scanJanusHistory(cwd, startedAt, sessionId)
      : readJanusBootstrapTelemetry()
  }
  if (preset === 'pi') {
    return sessionId
      ? scanPiHistory(cwd, startedAt, sessionId)
      : readPiBootstrapTelemetry(cwd)
  }
  // Note: dsh supplies only the declared model without an exact session id — see
  // .agents/notes/terminal/dsh-terminal-integration.md (history binding). Session logs are
  // zstd-compressed, so the scan binds id/path/recency without usage numbers.
  if (preset === 'dsh') {
    return sessionId
      ? scanDshHistory(cwd, startedAt, sessionId)
      : readDshBootstrapTelemetry()
  }
  return null
}

async function scanClaudeHistory(cwd: string, startedAt?: number, sessionId?: string): Promise<HistoryTelemetrySnapshot | null> {
  const projectDir = join(os.homedir(), '.claude', 'projects', toClaudeProjectKey(cwd))
  const files = (await listJsonlFiles(projectDir, (name) => name.endsWith('.jsonl')))
    .filter((file) => !sessionId || file.path.toLowerCase().includes(sessionId.toLowerCase()))
    .sort((a, b) => b.updatedAt - a.updatedAt)
  const latestCurrent = files.find((file) => isFileAfterStartedAt(file, startedAt))
  const latestKnownModel = startedAt === undefined ? null : await readClaudeLatestModel(files)

  if (!latestCurrent) {
    return startedAt === undefined ? null : createEmptyCurrentSnapshot(latestKnownModel)
  }

  const current = await parseClaudeSession(latestCurrent, startedAt)
  if (!current && latestKnownModel) return createEmptyCurrentSnapshot(latestKnownModel)
  if (!current) return startedAt === undefined ? null : createEmptyCurrentSnapshot()
  if (sessionId && current.sessionId !== sessionId) return null

  if (!current.detectedModel && latestKnownModel?.detectedModel) {
    current.detectedModel = latestKnownModel.detectedModel
  }

  if (startedAt !== undefined && current.contextTokens === undefined) {
    current.contextTokens = 0
    current.inputTokens = 0
    current.outputTokens = 0
  }

  return current
}

async function scanCodexHistory(codexHome: string, cwd: string, startedAt?: number, sessionId?: string, checkpointLookup?: CheckpointLookup): Promise<HistoryTelemetrySnapshot | null> {
  const root = join(codexHome, 'sessions')
  const files = (await listJsonlFilesRecursive(root, (name) => name.startsWith('rollout-') && name.endsWith('.jsonl')))
    .filter((file) => isFileAfterStartedAt(file, startedAt))
    .filter((file) => !sessionId || file.path.toLowerCase().includes(sessionId.toLowerCase()))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_CODEX_CANDIDATES)

  for (const file of files) {
    const snapshot = await parseCodexSession(file, cwd, codexHome, startedAt, true, checkpointLookup)
    if (!snapshot) continue
    if (sessionId && snapshot.sessionId !== sessionId) continue
    if (snapshotMatchesCwd(snapshot, cwd)) {
      return snapshot
    }
  }

  return null
}

export async function parseClaudeSession(file: SessionFileRef, startedAt?: number, preRead?: string[]): Promise<HistoryTelemetrySnapshot | null> {
  let version: string | undefined
  const lines = preRead ?? await readJsonlLines(file.path, true, (_buffer, info) => { version = sourceVersion(info) })
  const snapshot: HistoryTelemetrySnapshot = {
    sourceVersion: version,
    filePath: file.path,
    observedAt: file.updatedAt,
    source: 'history',
    confidence: 'derived',
  }
  let totalInput = 0
  let totalOutput = 0
  let totalCacheRead = 0
  let totalCacheWrite = 0
  let hasCacheWrite = false
  let hasUsage = false

  for (const line of lines) {
    const value = parseJsonObject(line)
    if (!value) continue
    if (!isLineAfterStartedAt(value, startedAt)) continue

    const message = asRecord(value.message)
    const usage = asRecord(message?.usage) ?? asRecord(value.usage)
    const model = readString(message?.model) ?? readString(value.model)
    const sessionId = readString(value.sessionId) ?? readString(value.session_id)

    if (model) snapshot.detectedModel = model
    if (sessionId) snapshot.sessionId = sessionId
    if (!usage || (message?.role !== undefined && message.role !== 'assistant') || message?.stop_reason === null) continue

    const inputTokens = readNonNegativeNumber(usage.input_tokens ?? usage.inputTokens)
    const outputTokens = readNonNegativeNumber(usage.output_tokens ?? usage.outputTokens)
    const cacheReadTokens =
      readPositiveNumber(usage.cache_read_input_tokens ?? usage.cache_read_tokens ?? usage.cacheReadTokens) ?? 0
    const reportedCacheCreation = readNonNegativeNumber(usage.cache_creation_input_tokens ?? usage.cache_creation_tokens ?? usage.cacheCreationTokens)
    const cacheCreationTokens = reportedCacheCreation ?? 0
    hasCacheWrite ||= reportedCacheCreation !== undefined
    const contextTokens = (inputTokens ?? 0) + cacheReadTokens + cacheCreationTokens

    totalInput += inputTokens ?? 0
    totalOutput += outputTokens ?? 0
    totalCacheRead += cacheReadTokens
    totalCacheWrite += cacheCreationTokens
    hasUsage = true
    if (inputTokens !== undefined) snapshot.contextTokens = contextTokens
  }

  if (hasUsage) {
    snapshot.inputTokens = totalInput
    snapshot.outputTokens = totalOutput
    snapshot.cacheReadTokens = totalCacheRead
    snapshot.cacheWriteTokens = hasCacheWrite ? totalCacheWrite : undefined
    snapshot.totalTokens = totalInput + totalOutput + totalCacheRead + totalCacheWrite
  }

  if (snapshot.sessionId) {
    const values = lines.map(parseJsonObject).filter((value): value is JsonRecord => value !== null)
    const observation = collectUsageEvents('claude', join(os.homedir(), '.claude'), snapshot.sessionId, values, Date.now())
    snapshot.usageObservation = observation
    // Complete native response identities replace the per-line sum when available.
    if (!observation.issue && observation.events?.length) {
      const totals = observation.events.reduce((sum, event) => ({ inputTokens: sum.inputTokens + event.inputTokens, outputTokens: sum.outputTokens + event.outputTokens, cacheReadTokens: sum.cacheReadTokens + (event.cacheReadTokens ?? 0), cacheWriteTokens: sum.cacheWriteTokens + (event.cacheWriteTokens ?? 0), totalTokens: sum.totalTokens + event.totalTokens }), { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0 })
      Object.assign(snapshot, totals)
      if (!observation.events.some(event => event.cacheWriteTokens !== undefined)) snapshot.cacheWriteTokens = undefined
    }
  }

  return hasTelemetry(snapshot) ? snapshot : null
}

async function readClaudeLatestModel(files: SessionFileRef[]): Promise<RuntimeTelemetrySnapshot | null> {
  for (const file of files) {
    const lines = await readJsonlLines(file.path)

    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const value = parseJsonObject(lines[index])
      if (!value) continue

      const message = asRecord(value.message)
      const model = readString(message?.model) ?? readString(value.model)
      if (!model) continue

      return {
        detectedModel: model,
        sessionId: readString(value.sessionId) ?? readString(value.session_id),
        filePath: file.path,
        observedAt: file.updatedAt,
        source: 'history',
        confidence: 'derived',
      }
    }
  }

  return null
}

function createEmptyCurrentSnapshot(modelSnapshot?: RuntimeTelemetrySnapshot | null): RuntimeTelemetrySnapshot {
  return {
    ...(modelSnapshot ?? {}),
    contextTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    observedAt: Date.now(),
    source: 'history',
    confidence: 'derived',
  }
}

export async function parseCodexSession(
  file: SessionFileRef,
  cwd: string | undefined,
  codexHome: string,
  startedAt?: number,
  includeCompactions = false,
  checkpointLookup?: CheckpointLookup,
  preRead?: string[],
  preReadSource?: JsonlSourceRead,
): Promise<HistoryTelemetrySnapshot | null> {
  // Compression is an auditable count, not a best-effort tail sample. A bound
  // session is read completely so older compactions cannot disappear from a
  // long rollout file.
  let source = preReadSource
  const lines = preRead ?? await readJsonlLines(file.path, includeCompactions, (buffer, info) => { source = { buffer, info } })
  const snapshot: HistoryTelemetrySnapshot & { cwd?: string } = {
    sourceVersion: source ? sourceVersion(source.info) : undefined,
    filePath: file.path,
    observedAt: file.updatedAt,
    source: 'history',
    confidence: 'authoritative',
  }

  for (const line of lines) {
    const value = parseJsonObject(line)
    if (!value) continue
    const payload = asRecord(value.payload)
    const rootType = readString(value.type)

    if (rootType === 'session_meta') {
      const sessionId = readString(payload?.id) ?? readString(value.session_id)
      const sessionCwd = readString(payload?.cwd)
      if (sessionId) snapshot.sessionId = sessionId
      if (sessionCwd) snapshot.cwd = normalizePath(sessionCwd)
    }

    if (!isLineAfterStartedAt(value, startedAt)) continue

    const info = asRecord(payload?.info)
    const payloadType = readString(payload?.type)

    if (payloadType === 'context_compacted' && includeCompactions) {
      snapshot.compactionCount = (snapshot.compactionCount ?? 0) + 1
      snapshot.compactionCountConfidence = 'exact'
    }

    if (payloadType === 'task_started') {
      const runtimeWindow = readPositiveNumber(payload?.model_context_window ?? payload?.modelContextWindow)
      if (runtimeWindow !== undefined) snapshot.contextWindowTokens = runtimeWindow
    }

    if (rootType === 'turn_context' || payloadType === 'thread_settings_applied') {
      const model = readString(payload?.model) ?? readString(asRecord(payload?.thread_settings)?.model)
      const turnCwd = readString(payload?.cwd)
      if (model && model !== snapshot.detectedModel) {
        snapshot.detectedModel = model
        snapshot.modelChangedAt = readRecordTimestampMs(value) ?? Date.now()
      }
      if (turnCwd) snapshot.cwd = normalizePath(turnCwd)
    }

    if (payloadType !== 'token_count' || !info) continue
    const lastUsage = asRecord(info.last_token_usage) ?? asRecord(info.lastTokenUsage)
    const totalUsage = asRecord(info.total_token_usage) ?? asRecord(info.totalTokenUsage)

    const contextTokens = readNonNegativeNumber(lastUsage?.total_tokens ?? lastUsage?.totalTokens)
    const contextWindowTokens = readPositiveNumber(info.model_context_window ?? info.modelContextWindow)
    const inputTokens = readNonNegativeNumber(totalUsage?.input_tokens ?? totalUsage?.inputTokens)
    const cachedInputTokens = readNonNegativeNumber(totalUsage?.cached_input_tokens ?? totalUsage?.cachedInputTokens)
    const cacheWriteTokens = readNonNegativeNumber(totalUsage?.cache_write_input_tokens ?? totalUsage?.cacheWriteInputTokens)
    const outputTokens = readNonNegativeNumber(totalUsage?.output_tokens ?? totalUsage?.outputTokens)
    if (contextTokens !== undefined) snapshot.contextTokens = contextTokens
    if (contextWindowTokens !== undefined) snapshot.contextWindowTokens = contextWindowTokens
    if (inputTokens !== undefined) snapshot.inputTokens = inputTokens - (cachedInputTokens ?? 0) - (cacheWriteTokens ?? 0)
    snapshot.cacheReadTokens = cachedInputTokens
    snapshot.cacheWriteTokens = cacheWriteTokens
    if (outputTokens !== undefined) snapshot.outputTokens = outputTokens
    snapshot.totalTokens = readNonNegativeNumber(totalUsage?.total_tokens ?? totalUsage?.totalTokens)
  }

  // A terminal read filters foreign workspaces; the corpus scan passes no cwd
  // and deliberately reads every session.
  if (snapshot.cwd && cwd && !pathsEqual(snapshot.cwd, cwd)) {
    return null
  }
  if (snapshot.sessionId && snapshot.totalTokens !== undefined) {
    const namespace = codexHome
    snapshot.usageObservation = cumulativeUsage('codex', namespace, snapshot.sessionId, usageTokens(snapshot.inputTokens, snapshot.outputTokens, snapshot.cacheReadTokens, snapshot.cacheWriteTokens, snapshot.totalTokens), snapshot.detectedModel)
    if (source) {
      const checkpoint = checkpointLookup?.('codex', namespace, snapshot.sessionId)
      snapshot.usageObservation.sourceIdentity = JSON.stringify([source.info.dev, source.info.ino, source.info.birthtimeMs])
      snapshot.usageObservation.sourceSize = source.buffer.length
      snapshot.usageObservation.sourceHash = createHash('sha256').update(source.buffer).digest('hex')
      if (checkpoint?.sourceSize !== undefined) snapshot.usageObservation.sourcePrefixHash = createHash('sha256').update(source.buffer.subarray(0, checkpoint.sourceSize)).digest('hex')
      snapshot.usageObservation.modelChangedAt = snapshot.modelChangedAt
    }
  }
  return hasTelemetry(snapshot) ? snapshot : null
}

export async function listJsonlFiles(
  dir: string,
  acceptsName: (name: string) => boolean,
): Promise<SessionFileRef[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    const files: SessionFileRef[] = []
    for (const entry of entries) {
      if (!entry.isFile() || !acceptsName(entry.name)) continue
      const path = join(dir, entry.name)
      const info = await stat(path)
      files.push({ path, updatedAt: info.mtimeMs })
    }
    return files
  } catch {
    return []
  }
}

export async function listJsonlFilesRecursive(
  root: string,
  acceptsName: (name: string) => boolean,
): Promise<SessionFileRef[]> {
  try {
    const entries = await readdir(root, { withFileTypes: true })
    const nested = await Promise.all(entries.map(async (entry) => {
      const path = join(root, entry.name)
      if (entry.isDirectory()) return listJsonlFilesRecursive(path, acceptsName)
      if (!entry.isFile() || !acceptsName(entry.name)) return []
      const info = await stat(path)
      return [{ path, updatedAt: info.mtimeMs }]
    }))
    return nested.flat()
  } catch {
    return []
  }
}

async function readJsonlLines(filePath: string, full = false, capture?: (buffer: Buffer, info: Stats) => void): Promise<string[]> {
  const { lines } = await readJsonlLinesWithCursor(filePath, full, capture)
  return lines
}

/**
 * Same reads as `readJsonlLines`, plus `completeBytes`: the offset just past
 * the last newline-terminated line. A half-written tail is excluded, so a
 * caller can persist the offset as a cursor and never skip a line that only
 * became complete after the read.
 */
export async function readJsonlLinesWithCursor(filePath: string, full = false, capture?: (buffer: Buffer, info: Stats) => void): Promise<{ lines: string[]; completeBytes: number; size: number }> {
  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    handle = await open(filePath, 'r')
    const info = await handle.stat()
    const { size } = info
    if (full || size <= TELEMETRY_TAIL_BYTES + TELEMETRY_HEAD_BYTES) {
      if (size > MAX_SESSION_BYTES) return { lines: [], completeBytes: 0, size }
      const fullBuffer = Buffer.alloc(size)
      let consumed = 0
      while (consumed < size) {
        const { bytesRead } = await handle.read(fullBuffer, consumed, size - consumed, consumed)
        if (bytesRead === 0) return { lines: [], completeBytes: 0, size } // Truncation during the read is not a complete usage snapshot.
        consumed += bytesRead
      }
      const raw = fullBuffer.toString('utf-8')
      const lines = raw.split(/\r?\n/)
      let completeBytes = size
      if (!raw.endsWith('\n') && lines.at(-1)?.trim() && !parseJsonObject(lines.at(-1)!)) {
        lines.pop()
        completeBytes = fullBuffer.lastIndexOf(0x0a) + 1
      }
      const complete = lines.filter(line => line.trim())
      if (complete.some(line => !parseJsonObject(line))) return { lines: [], completeBytes: 0, size }
      capture?.(fullBuffer.subarray(0, completeBytes), info)
      return { lines: complete, completeBytes, size }
    }

    const headLength = Math.min(size, TELEMETRY_HEAD_BYTES)
    const headBuffer = Buffer.allocUnsafe(headLength)
    await handle.read(headBuffer, 0, headLength, 0)
    const headLines = headBuffer.toString('utf-8').split(/\r?\n/)
    headLines.pop()

    const start = Math.max(0, size - TELEMETRY_TAIL_BYTES)
    const buffer = Buffer.allocUnsafe(size - start)
    await handle.read(buffer, 0, buffer.length, start)
    const lines = buffer.toString('utf-8').split(/\r?\n/)
    // 从文件中部起读时，首行可能被截断，丢弃它；从头读（start===0）时保留全部
    lines.shift()
    return { lines: [...headLines, ...lines].filter(Boolean), completeBytes: buffer.lastIndexOf(0x0a) + 1 + start, size }
  } catch {
    return { lines: [], completeBytes: 0, size: 0 }
  } finally {
    await handle?.close()
  }
}

export function parseJsonObject(line: string): JsonRecord | null {
  try {
    const value = JSON.parse(line) as unknown
    return asRecord(value) ?? null
  } catch {
    return null
  }
}

function readStartedAt(value: unknown): number | undefined {
  const startedAt = readTimestampMs(value)
  return startedAt && startedAt > 0 ? startedAt : undefined
}

function isFileAfterStartedAt(file: SessionFileRef, startedAt?: number): boolean {
  return startedAt === undefined || file.updatedAt >= startedAt - STARTED_AT_TOLERANCE_MS
}

function isLineAfterStartedAt(value: JsonRecord, startedAt?: number): boolean {
  if (startedAt === undefined) return true
  const timestamp = readRecordTimestampMs(value)
  return timestamp !== undefined && timestamp >= startedAt - STARTED_AT_TOLERANCE_MS
}

function readRecordTimestampMs(value: JsonRecord): number | undefined {
  const message = asRecord(value.message)
  const payload = asRecord(value.payload)
  return (
    readTimestampMs(value.timestamp) ??
    readTimestampMs(value.created_at) ??
    readTimestampMs(value.createdAt) ??
    readTimestampMs(message?.timestamp) ??
    readTimestampMs(payload?.timestamp)
  )
}

function readTimestampMs(value: unknown): number | undefined {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) return undefined
    return value < 1_000_000_000_000 ? Math.round(value * 1000) : Math.round(value)
  }

  const raw = readString(value)
  if (!raw) return undefined
  const parsed = Date.parse(raw)
  if (Number.isFinite(parsed)) return parsed

  const numeric = Number(raw)
  if (!Number.isFinite(numeric) || numeric <= 0) return undefined
  return numeric < 1_000_000_000_000 ? Math.round(numeric * 1000) : Math.round(numeric)
}

export function toClaudeProjectKey(cwd: string): string {
  return cwd.replace(/[\\/]/g, '-').replace(/:/g, '-')
}

function snapshotMatchesCwd(snapshot: RuntimeTelemetrySnapshot & { cwd?: string }, cwd: string): boolean {
  return Boolean(snapshot.cwd && pathsEqual(snapshot.cwd, cwd))
}

function pathsEqual(a: string, b: string): boolean {
  return normalizePath(a).toLowerCase() === normalizePath(b).toLowerCase()
}

// Note: Windows backslash vs provider forward-slash directory spellings must compare equal — see .agents/notes/terminal/claude-opencode-context-telemetry.md
function normalizePath(value?: string): string {
  if (!value) return ''
  return value.replace(/\\/g, '/').replace(/\/+$/g, '')
}

function hasTelemetry(snapshot: RuntimeTelemetrySnapshot): boolean {
  return Boolean(
    snapshot.detectedModel ||
    snapshot.contextTokens !== undefined ||
    snapshot.contextWindowTokens !== undefined ||
    snapshot.compactionCount !== undefined ||
    snapshot.inputTokens !== undefined ||
    snapshot.outputTokens !== undefined
  )
}

/**
 * Before Codex creates a session, config.toml is the only terminal-specific
 * source available. It is deliberately marked declared rather than runtime
 * confirmed; a later task_started/token_count event supersedes it.
 */
async function readCodexBootstrapTelemetry(codexHome: string): Promise<RuntimeTelemetrySnapshot | null> {
  try {
    const config = await readFile(join(codexHome, 'config.toml'), 'utf8')
    const model = config.match(/^\s*model\s*=\s*["']?([^"'\r\n#]+)["']?/m)?.[1]?.trim()
    const window = readPositiveNumber(config.match(/^\s*model_context_window\s*=\s*(\d+)/m)?.[1])
    if (!model && window === undefined) return null
    return {
      detectedModel: model,
      contextWindowTokens: window,
      observedAt: Date.now(),
      source: 'configuration',
      confidence: 'declared',
    }
  } catch {
    return null
  }
}

async function readClaudeBootstrapTelemetry(): Promise<RuntimeTelemetrySnapshot | null> {
  const settings = await readJsonConfig(join(os.homedir(), '.claude', 'settings.json'))
  if (!settings) return null
  const env = asRecord(settings.env)
  // Proxy-managed installs carry no top-level model; the ANTHROPIC_DEFAULT_*
  // trio names the same Sonnet/Opus/Haiku capacity the preset fallback assumes.
  const model = readString(settings.model)
    ?? readString(env?.ANTHROPIC_MODEL)
    ?? readString(env?.ANTHROPIC_DEFAULT_SONNET_MODEL)
    ?? readString(env?.ANTHROPIC_DEFAULT_OPUS_MODEL)
    ?? readString(env?.ANTHROPIC_DEFAULT_HAIKU_MODEL)
  if (!model) return null
  return createBootstrapSnapshot(model, inferDeclaredContextWindow(model, 'claude'))
}

async function readOpenCodeBootstrapTelemetry(cwd: string): Promise<RuntimeTelemetrySnapshot | null> {
  const configPaths = [
    join(cwd, 'opencode.json'),
    join(cwd, 'opencode.jsonc'),
    join(os.homedir(), '.config', 'opencode', 'opencode.json'),
    join(os.homedir(), '.config', 'opencode', 'opencode.jsonc'),
  ]

  for (const configPath of configPaths) {
    const config = await readJsonConfig(configPath)
    if (!config) continue
    const declared = readString(config.model)
    const model = declared ?? readOnlyConfiguredOpenCodeModel(config)
    if (model) return createBootstrapSnapshot(model, inferDeclaredContextWindow(model, 'opencode'))
  }
  return null
}

function readOpenCodeSessionTelemetry(cwd: string, sessionId: string, checkpointLookup?: CheckpointLookup): HistoryTelemetrySnapshot | null {
  const databasePath = resolveOpencodeDbPath(os.homedir())
  let source: OpenCodeUsageSource | undefined
  try {
    source = new OpenCodeUsageSource(databasePath)
    const session = source.sessions().find(row => row.id === sessionId)
    if (!session || !pathsEqual(session.directory, cwd)) return null
    const checkpoint = checkpointLookup?.('opencode', databasePath, sessionId)
    const result = source.read(session, Date.now(), checkpoint && checkpoint.mode !== 'events' ? 'cumulative' : 'events', checkpoint)
    const latest = result.latest
    const contextTokens = latest ? latest.inputTokens + (latest.cacheReadTokens ?? 0) + (latest.cacheWriteTokens ?? 0) : undefined
    return {
      ...result.totals, sessionId, filePath: databasePath,
      detectedModel: latest?.model, contextTokens,
      observedAt: latest?.at ?? session.time_updated, source: 'history', confidence: 'authoritative',
      usageObservation: result.observation,
    }
  } catch { /* Older stores without native message identities retain the cumulative adapter below. */ }
  finally { source?.close() }
  let database: DatabaseSync | undefined
  try {
    database = new DatabaseSync(databasePath, { readOnly: true })
    database.exec('BEGIN')
    const session = database.prepare(`
      SELECT directory, model, tokens_input, tokens_output, tokens_cache_read, tokens_cache_write, time_updated
      FROM session WHERE id = ?
    `).get(sessionId) as Record<string, unknown> | undefined
    if (!session || !pathsEqual(readString(session.directory) ?? '', cwd)) return null

    const latestMessage = database.prepare(`
      SELECT data FROM message
      WHERE session_id = ? AND json_extract(data, '$.role') = 'assistant'
      ORDER BY time_updated DESC LIMIT 1
    `).get(sessionId) as { data?: unknown } | undefined
    const message = parseJsonObject(readString(latestMessage?.data) ?? '')
    const sessionModel = parseJsonObject(readString(session.model) ?? '')
    const tokens = asRecord(message?.tokens)
    const cache = asRecord(tokens?.cache)
    const model = readString(message?.modelID) ?? readString(sessionModel?.id)
    const inputTokens = readNonNegativeNumber(session.tokens_input)
    const outputTokens = readNonNegativeNumber(session.tokens_output)
    const cacheReadTokens = readNonNegativeNumber(session.tokens_cache_read)
    const cacheWriteTokens = readNonNegativeNumber(session.tokens_cache_write)
    const currentInput = readNonNegativeNumber(tokens?.input)
    const currentCacheRead = readNonNegativeNumber(cache?.read) ?? 0
    const currentCacheWrite = readNonNegativeNumber(cache?.write) ?? 0

    const observation = cumulativeUsage('opencode', databasePath, sessionId, usageTokens(inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens), model)
    const info = statSync(databasePath)
    observation.sourceIdentity = JSON.stringify([info.dev, info.ino, info.birthtimeMs])
    const checkpoint = checkpointLookup?.('opencode', databasePath, sessionId)
    if (checkpoint) {
      const models = database.prepare("SELECT DISTINCT json_extract(data,'$.modelID') AS model FROM message WHERE session_id=? AND time_updated>? AND json_extract(data,'$.role')='assistant'").all(sessionId, checkpoint.updatedAt) as Array<{ model: string | null }>
      if (models.some(row => !row.model || row.model !== model)) observation.model = undefined
    }

    return {
      detectedModel: model,
      contextTokens: currentInput === undefined ? undefined : currentInput + currentCacheRead + currentCacheWrite,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheWriteTokens,
      totalTokens: sumDefined(inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens),
      sessionId,
      observedAt: readTimestampMs(session.time_updated) ?? Date.now(),
      source: 'history',
      confidence: 'authoritative',
      usageObservation: observation,
    }
  } catch {
    return null
  } finally {
    database?.close()
  }
}

function createBootstrapSnapshot(model: string, contextWindowTokens?: number): RuntimeTelemetrySnapshot {
  return {
    detectedModel: model,
    contextWindowTokens,
    observedAt: Date.now(),
    source: 'configuration',
    confidence: 'declared',
  }
}

/**
 * Janus CLI persists one JSON document per conversation in
 * `~/.janus/history/<conversationId>.jsonl` (messages + tool traces, no token
 * usage). The declared model lives in `~/.janus/config.json`; secrets stay in
 * flags/env/auth files that are never read here.
 */
async function readJanusBootstrapTelemetry(): Promise<RuntimeTelemetrySnapshot | null> {
  const model = readJanusCatalogModel(await readJsonConfig(join(os.homedir(), '.janus', 'config.json')))
  if (!model) return null
  return createBootstrapSnapshot(model, inferDeclaredContextWindow(model, 'janus'))
}

async function scanJanusHistory(cwd: string, startedAt?: number, sessionId?: string): Promise<RuntimeTelemetrySnapshot | null> {
  void cwd
  if (!sessionId) return readJanusBootstrapTelemetry()
  const filePath = join(os.homedir(), '.janus', 'history', `${sessionId}.jsonl`)
  let raw: string
  try {
    raw = await readFile(filePath, 'utf8')
  } catch {
    return null
  }
  const record = parseJsonObject(raw.trim().split(/\r?\n/, 1)[0] ?? '')
  if (!record || readString(record.id) !== sessionId) return null
  const updatedAt = readTimestampMs(record.updatedAt)
  if (startedAt !== undefined && updatedAt !== undefined && updatedAt < startedAt - STARTED_AT_TOLERANCE_MS) return null
  const model = readJanusCatalogModel(await readJsonConfig(join(os.homedir(), '.janus', 'config.json')))
  if (!model) return null
  return {
    detectedModel: model,
    filePath,
    sessionId,
    observedAt: updatedAt ?? Date.now(),
    source: 'history',
    confidence: 'derived',
  }
}

function readJanusCatalogModel(config: JsonRecord | undefined): string | undefined {
  if (!config) return undefined
  const providers = Array.isArray(config.providers) ? config.providers : []
  const enabled = providers
    .map((entry) => asRecord(entry))
    .filter((entry): entry is JsonRecord => !!entry && !!readString(entry.id) && entry.enabled !== false)
  if (enabled.length === 0) return undefined
  const defaultProvider = readString(config.defaultProvider)
  const active = (defaultProvider ? enabled.find((entry) => entry.id === defaultProvider) : undefined)
    ?? enabled[0]
  if (!active) return undefined
  const defaultModel = readString(config.defaultModel)
  if (defaultModel && (!defaultProvider || active.id === defaultProvider)) return defaultModel
  const models = Array.isArray(active.models)
    ? active.models.filter((model): model is string => typeof model === 'string' && !!model.trim())
    : []
  return readString(active.modelId) ?? models[0] ?? readString(active.defaultModelId)
}

/**
 * Pi CLI stores JSONL sessions under `~/.pi/agent/sessions/` (or a configured
 * `sessionDir`), one `message` entry per turn with per-turn `usage`
 * `{input, output, cacheRead, cacheWrite, totalTokens}`. Entries form a tree
 * via `id`/`parentId`; only the active leaf path counts toward context, so
 * abandoned branches never inflate the numbers.
 */
async function readPiBootstrapTelemetry(cwd: string): Promise<RuntimeTelemetrySnapshot | null> {
  const model = await readPiDeclaredModel(cwd)
  if (!model) return null
  return createBootstrapSnapshot(model, inferDeclaredContextWindow(model, 'pi'))
}

async function readPiDeclaredModel(cwd: string): Promise<string | undefined> {
  const global = await readJsonConfig(join(os.homedir(), '.pi', 'agent', 'settings.json'))
  const project = await readJsonConfig(join(cwd, '.pi', 'settings.json'))
  const provider = readString(project?.defaultProvider) ?? readString(global?.defaultProvider)
  const model = readString(project?.defaultModel) ?? readString(global?.defaultModel)
  if (!model) return undefined
  if (provider && !model.includes('/')) return `${provider}/${model}`
  return model
}

function resolvePiSessionRoots(cwd: string, globalSettings: JsonRecord | undefined, projectSettings: JsonRecord | undefined): string[] {
  const configured = readString(projectSettings?.sessionDir) ?? readString(globalSettings?.sessionDir)
  if (configured) {
    const expanded = configured.startsWith('~/') || configured === '~'
      ? join(os.homedir(), configured.slice(configured === '~' ? 1 : 2))
      : configured
    return [isAbsolute(expanded) || /^[A-Za-z]:[\\/]/.test(expanded) ? expanded : join(cwd, expanded)]
  }
  return [join(os.homedir(), '.pi', 'agent', 'sessions')]
}

async function scanPiHistory(cwd: string, startedAt?: number, sessionId?: string): Promise<HistoryTelemetrySnapshot | null> {
  if (!sessionId) return readPiBootstrapTelemetry(cwd)
  const globalSettings = await readJsonConfig(join(os.homedir(), '.pi', 'agent', 'settings.json'))
  const projectSettings = await readJsonConfig(join(cwd, '.pi', 'settings.json'))
  const roots = resolvePiSessionRoots(cwd, globalSettings, projectSettings)
  const candidates: SessionFileRef[] = []
  for (const root of roots) {
    candidates.push(...(await listJsonlFilesRecursive(root, (name) => name.endsWith('.jsonl'))).map(file => ({ ...file, namespace: root })))
  }
  const matching = candidates
    .filter((file) => file.path.toLowerCase().includes(sessionId.toLowerCase()))
    .filter((file) => isFileAfterStartedAt(file, startedAt))
    .sort((a, b) => b.updatedAt - a.updatedAt)
  for (const file of matching) {
    const snapshot = await parsePiSession(file, cwd, startedAt, sessionId)
    if (snapshot) return snapshot
  }
  return null
}

export async function parsePiSession(
  file: SessionFileRef,
  cwd: string | undefined,
  startedAt?: number,
  sessionId?: string,
  preRead?: string[],
): Promise<HistoryTelemetrySnapshot | null> {
  const lines = preRead ?? await readJsonlLines(file.path, true)
  if (lines.length === 0) return null
  const header = parseJsonObject(lines[0])
  if (!header || readString(header.type) !== 'session') return null
  const headerId = readString(header.id)
  const headerCwd = readString(header.cwd)
  if (sessionId && headerId !== sessionId) return null
  // Corpus scans pass no cwd: every workspace's session is in scope.
  if (headerCwd && cwd && !pathsEqual(headerCwd, cwd)) return null
  if (!isLineAfterStartedAt(header, startedAt)) return null

  const entries: Array<{ id: string | undefined; parentId: string | null; timestamp: number | undefined; record: JsonRecord }> = []
  const byId = new Map<string, { id: string | undefined; parentId: string | null; timestamp: number | undefined; record: JsonRecord }>()
  for (const line of lines.slice(1)) {
    const record = parseJsonObject(line)
    if (!record) continue
    if (!isLineAfterStartedAt(record, startedAt)) continue
    const id = readString(record.id)
    const rawParentId: unknown = record.parentId
    const entry = { id, parentId: typeof rawParentId === 'string' ? rawParentId : null, timestamp: readRecordTimestampMs(record), record }
    entries.push(entry)
    if (id && !byId.has(id)) byId.set(id, entry)
  }
  // Active leaf = last appended entry; walk parent links to the root so only
  // the live branch contributes usage, model, and compaction counts.
  const leaf = entries[entries.length - 1]
  if (!leaf) {
    return headerId ? { sessionId: headerId, filePath: file.path, observedAt: file.updatedAt, source: 'history', confidence: 'authoritative' } : null
  }
  const activePath: Array<{ id: string | undefined; parentId: string | null; timestamp: number | undefined; record: JsonRecord }> = []
  const seen = new Set<string>()
  let current: { id: string | undefined; parentId: string | null; timestamp: number | undefined; record: JsonRecord } | undefined = leaf
  while (current && current.id && !seen.has(current.id)) {
    seen.add(current.id)
    activePath.unshift(current)
    const parentKey: string | null = current.parentId
    current = parentKey ? byId.get(parentKey) : undefined
  }
  if (activePath.length === 0) activePath.push(leaf)

  let detectedModel: string | undefined
  let modelChangedAt: number | undefined
  let compactionCount = 0
  let inputTokens = 0
  let outputTokens = 0
  let cacheReadTokens = 0
  let cacheWriteTokens = 0
  let totalTokens = 0
  let latestContext: number | undefined
  let hasUsage = false
  for (const entry of activePath) {
    const { record } = entry
    const type = readString(record.type)
    if (type === 'model_change') {
      const provider = readString(record.provider)
      const modelId = readString(record.modelId)
      const combined = modelId && provider && !modelId.includes('/') ? `${provider}/${modelId}` : modelId
      if (combined) {
        detectedModel = combined
        modelChangedAt = entry.timestamp ?? modelChangedAt
      }
      continue
    }
    if (type === 'compaction') {
      compactionCount += 1
      continue
    }
    if (type !== 'message') continue
    const message = asRecord(record.message)
    if (!message) continue
    if (message.role !== 'assistant') continue
    const model = readString(message.model) ?? readString(message.responseModel)
    if (model) {
      if (model !== detectedModel) modelChangedAt = entry.timestamp ?? modelChangedAt
      detectedModel = model
    }
    const usage = asRecord(message.usage)
    if (!usage) continue
    const input = readNonNegativeNumber(usage.input)
    const output = readNonNegativeNumber(usage.output)
    const cacheRead = readNonNegativeNumber(usage.cacheRead) ?? 0
    const cacheWrite = readNonNegativeNumber(usage.cacheWrite) ?? 0
    const total = readNonNegativeNumber(usage.totalTokens)
    if (input === undefined && output === undefined && total === undefined) continue
    hasUsage = true
    inputTokens += input ?? 0
    latestContext = input === undefined ? undefined : input + cacheRead + cacheWrite
    outputTokens += output ?? 0
    cacheReadTokens += cacheRead
    cacheWriteTokens += cacheWrite
    totalTokens += total ?? (input ?? 0) + (output ?? 0) + cacheRead + cacheWrite
  }

  const snapshot: HistoryTelemetrySnapshot = {
    filePath: file.path,
    observedAt: file.updatedAt,
    source: 'history',
    confidence: 'authoritative',
    usageObservation: collectUsageEvents('pi', file.namespace ?? join(os.homedir(), '.pi', 'agent', 'sessions'), headerId ?? sessionId ?? '', entries.map(entry => entry.record), Date.now()),
  }
  if (headerId) snapshot.sessionId = headerId
  if (detectedModel) snapshot.detectedModel = detectedModel
  if (modelChangedAt !== undefined) snapshot.modelChangedAt = modelChangedAt
  if (compactionCount > 0) {
    snapshot.compactionCount = compactionCount
    snapshot.compactionCountConfidence = 'exact'
  }
  if (hasUsage) {
    snapshot.inputTokens = inputTokens
    snapshot.outputTokens = outputTokens
    snapshot.cacheReadTokens = cacheReadTokens
    snapshot.cacheWriteTokens = cacheWriteTokens
    snapshot.totalTokens = totalTokens
    // Estimate the latest request input; repeated inputs along the path are consumption, not context.
    snapshot.contextTokens = latestContext
    snapshot.confidence = 'estimated'
  }
  return hasTelemetry(snapshot) ? snapshot : null
}

export async function readJsonConfig(filePath: string): Promise<JsonRecord | undefined> {
  try {
    const raw = await readFile(filePath, 'utf8')
    return parseJsonObject(stripJsonComments(raw)) ?? undefined
  } catch {
    return undefined
  }
}

function stripJsonComments(value: string): string {
  return value.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

function readOnlyConfiguredOpenCodeModel(config: JsonRecord): string | undefined {
  const provider = asRecord(config.provider)
  if (!provider) return undefined
  const models: string[] = []
  for (const [providerId, rawProvider] of Object.entries(provider)) {
    const configuredModels = asRecord(asRecord(rawProvider)?.models)
    if (!configuredModels) continue
    for (const modelId of Object.keys(configuredModels)) models.push(`${providerId}/${modelId}`)
  }
  return models.length === 1 ? models[0] : undefined
}

function inferDeclaredContextWindow(model: string, preset: 'claude' | 'opencode' | 'janus' | 'pi' | 'dsh'): number | undefined {
  const normalized = model.toLowerCase()
  if (/\[1m\]|\b1m\b/.test(normalized)) return 1_000_000
  if (preset === 'claude') return 200_000
  return undefined
}

/**
 * DSH (0.2.0 line, dsh-TUI) layout, verified on disk 2026-09-30:
 * - `~/.dsh/sessions/<workspace-key>/<uuid>/session.v4.jsonl.zstd` — the log
 *   itself is zstd-compressed (no decoder in this repo), so the scan only
 *   binds id/path/recency, never usage numbers.
 * - `~/.dsh-tui/model-recents.json` — the user's switched models (first entry
 *   wins); absent until the first `/model` switch.
 * - Composed profile default is `deepseek-flash` (`agent-default-model` row;
 *   verify with `dsh --dump-config --profile dsh-tui`).
 */
function toDshWorkspaceKey(cwd: string): string {
  const body = normalizePath(cwd).replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '')
  return `--${body}--`
}

/**
 * DSH workspace keys preserve the original drive/case spelling
 * (`--C-Users-…--`); Windows checkouts may differ in case, so fall back to a
 * case-insensitive directory match before giving up.
 */
async function resolveDshWorkspaceDir(cwd: string): Promise<string | null> {
  const sessionsRoot = join(os.homedir(), '.dsh', 'sessions')
  const exact = join(sessionsRoot, toDshWorkspaceKey(cwd))
  try {
    const info = await stat(exact)
    if (info.isDirectory()) return exact
  } catch {
    // Fall through to the case-insensitive scan below.
  }
  try {
    const entries = await readdir(sessionsRoot, { withFileTypes: true })
    const want = toDshWorkspaceKey(cwd).toLowerCase()
    const hit = entries.find((entry) => entry.isDirectory() && entry.name.toLowerCase() === want)
    return hit ? join(sessionsRoot, hit.name) : null
  } catch {
    return null
  }
}

async function readDshDeclaredModel(): Promise<string | undefined> {
  // model-recents.json may be a top-level array (readJsonConfig only accepts
  // objects), so parse the raw file and accept array-first or known object keys.
  let raw: unknown
  try {
    raw = JSON.parse(await readFile(join(os.homedir(), '.dsh-tui', 'model-recents.json'), 'utf8')) as unknown
  } catch {
    raw = undefined
  }
  if (Array.isArray(raw)) {
    const first = raw.map(readString).find((model): model is string => !!model)
    if (first) return first
  }
  const record = asRecord(raw) ?? await readJsonConfig(join(os.homedir(), '.dsh-tui', 'model-recents.json'))
  const fromObject = readString(record?.models) ?? readString(record?.recent) ?? readString(record?.current) ?? readString(record?.model)
  if (fromObject) return fromObject
  const nested = Array.isArray(record?.models)
    ? (record?.models as unknown[]).map(readString).find((model): model is string => !!model)
    : undefined
  return nested ?? 'deepseek-flash'
}

async function readDshBootstrapTelemetry(): Promise<RuntimeTelemetrySnapshot | null> {
  const model = await readDshDeclaredModel()
  if (!model) return null
  const window = model.toLowerCase().includes('deepseek') ? 128_000 : undefined
  return createBootstrapSnapshot(model, window)
}

async function scanDshHistory(cwd: string, startedAt?: number, sessionId?: string): Promise<RuntimeTelemetrySnapshot | null> {
  if (!sessionId) return readDshBootstrapTelemetry()
  const workspaceDir = await resolveDshWorkspaceDir(cwd)
  if (!workspaceDir) return null
  let entries
  try {
    entries = await readdir(workspaceDir, { withFileTypes: true })
  } catch {
    return null
  }
  const needle = sessionId.toLowerCase()
  const candidates: SessionFileRef[] = []
  const exact: SessionFileRef[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const name = entry.name.toLowerCase()
    if (name !== needle && !name.includes(needle)) continue
    const dirPath = join(workspaceDir, entry.name)
    try {
      const info = await stat(dirPath)
      const ref = { path: dirPath, updatedAt: info.mtimeMs }
      if (!isFileAfterStartedAt(ref, startedAt)) continue
      // Exact UUID wins over prefix/substring: a short prefix can collide
      // across sessions, the newest mtime alone is not terminal-specific.
      if (name === needle) exact.push(ref)
      else candidates.push(ref)
    } catch {
      continue
    }
  }
  const pool = exact.length > 0 ? exact : candidates
  pool.sort((a, b) => b.updatedAt - a.updatedAt)
  const match = pool[0]
  if (!match) return null
  const sessionUuid = match.path.split(/[\\/]/).pop() ?? sessionId
  let filePath = match.path
  try {
    const inner = await readdir(match.path)
    const log = inner.find((name) => name.endsWith('.jsonl.zstd') || name.endsWith('.jsonl'))
    if (log) filePath = join(match.path, log)
  } catch {
    // Keep the session dir: still a stable, terminal-specific pointer.
  }
  const snapshot: RuntimeTelemetrySnapshot = {
    sessionId: sessionUuid,
    filePath,
    observedAt: match.updatedAt,
    source: 'history',
    confidence: 'derived',
  }
  if (startedAt !== undefined) {
    snapshot.contextTokens = 0
    snapshot.inputTokens = 0
    snapshot.outputTokens = 0
  }
  return snapshot
}

function readNonNegativeNumber(value: unknown): number | undefined {

  const numeric = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  if (!Number.isFinite(numeric) || numeric < 0) return undefined
  return Math.round(numeric)
}

function sumDefined(...values: Array<number | undefined>): number | undefined {
  return values.some((value) => value !== undefined)
    ? values.reduce<number>((total, value) => total + (value ?? 0), 0)
    : undefined
}

function readPositiveNumber(value: unknown): number | undefined {
  const numeric = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  if (!Number.isFinite(numeric) || numeric <= 0) return undefined
  return Math.round(numeric)
}

export function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function asRecord(value: unknown): JsonRecord | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : undefined
}
