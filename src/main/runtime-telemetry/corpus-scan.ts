// Note: usage accounting is hook-free and covers never-opened history — see .agents/notes/terminal/usage-telemetry-hook-decoupling.md
import { stat } from 'node:fs/promises'
import os from 'node:os'
import { setImmediate as yieldToEventLoop } from 'node:timers/promises'
import {
  listJsonlFilesRecursive,
  parseClaudeSession,
  parseCodexSession,
  parsePiSession,
  parseJsonObject,
  readJsonlLinesWithCursor,
  readString,
  type SessionFileRef,
  type JsonlSourceRead,
} from './history'
import { collectCodexEvents } from './history-usage'
import { isCodexAccountingRecord, readProjectedJsonl } from './projected-jsonl'
import { OpenCodeUsageSource } from './opencode-source'
import { resolveHistorySources } from '../sessions/history-sources'
import { providerPathContext } from '../external-cli/provider-paths'
import type { HistorySource } from '../../shared/history-sources'
import type { UsageLedger } from './usage-ledger'
import type { UsageEngine, UsageObservation, UsageSourceCheckpoint } from '../../shared/usage'

type CheckpointLookup = (engine: UsageEngine, namespace: string, sessionId: string) => UsageSourceCheckpoint | undefined

export interface CorpusScanSummary {
  errors?: string[]
  /** Files examined, including cursor hits. */
  scanned: number
  /** Observations handed to the ledger (idempotent on re-scan). */
  recorded: number
  /** Unchanged since the stored cursor: never re-recorded. Claude/Codex skip
   *  the read entirely; Pi must read its header before it can learn the id. */
  skipped: number
  /** Unreadable, oversized or rejected sources. */
  unavailable: number
}

/** Claude transcript basename is the session id: `<uuid>.jsonl`. */
function claudeSessionIdFromPath(path: string): string | undefined {
  const base = path.split(/[\\/]/).pop() ?? ''
  return base.toLowerCase().endsWith('.jsonl') ? base.slice(0, -'.jsonl'.length) : undefined
}

/** Codex rollout basename carries the thread uuid: `rollout-<date>-<uuid>.jsonl`. */
function codexSessionIdFromPath(path: string): string | undefined {
  const base = path.split(/[\\/]/).pop() ?? ''
  return /^rollout-.*-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i.exec(base)?.[1]
}

/**
 * Reads every native session store and feeds the usage ledger. Sessions the
 * ledger has never seen are imported in event mode with their real event
 * times (full history replay); sessions already carrying a cumulative
 * baseline keep that mode, and the ledger's mode lock makes the two paths
 * idempotent rather than double-counting. Terminal bindings are not involved:
 * this is the only accounting path that also covers closed terminals, offline
 * periods and sessions JanusX never opened.
 *
 * OpenCode messages are read from SQLite and imported under their native ids.
 */
export async function scanNativeSessionCorpus(options: {
  ledger: UsageLedger
  sources?: HistorySource[]
  checkpointLookup?: CheckpointLookup
  now?: number
  signal?: AbortSignal
}): Promise<CorpusScanSummary> {
  const { ledger, checkpointLookup, signal, now = Date.now() } = options
  signal?.throwIfAborted()
  const sources = (options.sources ?? resolveHistorySources(undefined, providerPathContext({ home: os.homedir() }))).filter(source => source.enabled)
  const summary: CorpusScanSummary = { scanned: 0, recorded: 0, skipped: 0, unavailable: 0 }

  const record = (observation: UsageObservation | undefined, sourceSize?: number) => {
    signal?.throwIfAborted()
    if (!observation) {
      summary.unavailable += 1
      return
    }
    if (sourceSize !== undefined) observation.sourceSize = sourceSize
    try {
      ledger.record(observation)
      summary.recorded += 1
    } catch (error) {
      summary.unavailable += 1
      if ((summary.errors?.length ?? 0) < 20) (summary.errors ??= []).push(error instanceof Error ? error.message : String(error))
      console.error('Corpus scan:', error instanceof Error ? error.message : String(error))
    }
  }

  for (const { path: opencodePath } of sources.filter(source => source.engine === 'opencode')) {
    if (!await stat(opencodePath).catch(() => null)) continue
    let source: OpenCodeUsageSource | undefined
    try {
      source = new OpenCodeUsageSource(opencodePath)
      for (const session of source.sessions()) {
        await yieldToEventLoop()
        signal?.throwIfAborted()
        summary.scanned += 1
        try {
          const mode = ledger.sessionState('opencode', opencodePath, session.id)?.mode
          const checkpoint = ledger.sourceCheckpoint('opencode', opencodePath, session.id)
          record(source.read(session, now, mode, checkpoint).observation)
        } catch (error) {
          signal?.throwIfAborted()
          summary.unavailable += 1
          console.error('OpenCode usage:', error instanceof Error ? error.message : String(error))
        }
      }
    } catch (error) {
      signal?.throwIfAborted()
      summary.unavailable += 1
      console.error('OpenCode usage:', error instanceof Error ? error.message : String(error))
    } finally { source?.close() }
  }

  // Claude: one JSONL per session under cwd-keyed project directories.
  for (const { path: dir, namespace: claudeNamespace } of sources.filter(source => source.engine === 'claude')) {
    for (const file of await listJsonlFilesRecursive(dir, name => name.endsWith('.jsonl'))) {
      await yieldToEventLoop()
      signal?.throwIfAborted()
      summary.scanned += 1
      const sessionId = claudeSessionIdFromPath(file.path)
      const cursor = sessionId ? ledger.sessionState('claude', claudeNamespace, sessionId)?.sourceSize : undefined
      const info = await stat(file.path).catch(() => null)
      if (!info) {
        summary.unavailable += 1
        continue
      }
      if (cursor !== undefined && cursor === info.size) {
        summary.skipped += 1
        continue
      }
      const read = await readJsonlLinesWithCursor(file.path, true)
      if (read.lines.length === 0) {
        summary.unavailable += 1
        continue
      }
      const snapshot = await parseClaudeSession({ ...file, namespace: claudeNamespace }, undefined, read.lines)
      record(snapshot?.usageObservation, read.completeBytes)
    }
  }

  // Codex: rollout files under date-partitioned sessions plus archived_sessions.
  for (const { path: root, namespace: codexHome } of sources.filter(source => source.engine === 'codex')) {
    for (const file of await listJsonlFilesRecursive(root, name => name.startsWith('rollout-') && name.endsWith('.jsonl'))) {
      await yieldToEventLoop()
      signal?.throwIfAborted()
      summary.scanned += 1
      const pathId = codexSessionIdFromPath(file.path)
      const info = await stat(file.path).catch(() => null)
      if (!info) {
        summary.unavailable += 1
        continue
      }
      const locked = pathId ? ledger.sessionState('codex', codexHome, pathId) : undefined
      if (locked?.sourceSize !== undefined && locked.sourceSize === info.size) {
        summary.skipped += 1
        continue
      }
      // Event accounting needs metadata, model transitions and token counters,
      // not retained assistant/tool bodies. Legacy cumulative baselines keep
      // the full source/hash path below, including prefix-rewrite detection.
      if (pathId && locked?.mode !== 'cumulative') {
        const projected = await readProjectedJsonl(file.path, isCodexAccountingRecord, signal)
        const meta = projected.values.find(value => value.type === 'session_meta')
        const sessionId = readString((meta?.payload as Record<string, unknown> | undefined)?.id) ?? pathId
        // Preserve the legacy fallback when a nonstandard file names a different session.
        const mode = locked?.mode ?? ledger.sessionState('codex', codexHome, sessionId)?.mode
        // With no selected rows, retain legacy empty/corrupt-source semantics.
        if (projected.values.length > 0 && mode !== 'cumulative') {
          record(collectCodexEvents(codexHome, sessionId, projected.values, now), projected.completeBytes)
          continue
        }
      }
      let source: JsonlSourceRead | undefined
      const read = await readJsonlLinesWithCursor(file.path, true, (buffer, info) => { source = { buffer, info } })
      if (read.lines.length === 0) {
        summary.unavailable += 1
        continue
      }
      const values = read.lines.map(parseJsonObject).filter((value): value is Record<string, unknown> => value !== null)
      const meta = values.find(value => value.type === 'session_meta')
      const sessionId = readString((meta?.payload as Record<string, unknown> | undefined)?.id) ?? pathId
      if (!sessionId) {
        summary.unavailable += 1
        continue
      }
      // The filename carries the thread uuid; when it does not, fall back to
      // the id inside the file so an existing baseline is still honoured.
      const mode = locked?.mode ?? ledger.sessionState('codex', codexHome, sessionId)?.mode
      if (mode === 'cumulative') {
        const lookup = checkpointLookup ?? ((engine, namespace, id) => ledger.sourceCheckpoint(engine, namespace, id))
        const snapshot = await parseCodexSession(file, undefined, codexHome, undefined, true, lookup, read.lines, source)
        record(snapshot?.usageObservation, read.completeBytes)
      } else {
        record(collectCodexEvents(codexHome, sessionId, values, now), read.completeBytes)
      }
    }
  }

  // Pi: message tree under the global session dir; namespace is the root the
  // file was found under, matching the bound-terminal path.
  for (const { path: root } of sources.filter(source => source.engine === 'pi')) {
    for (const file of await listJsonlFilesRecursive(root, name => name.endsWith('.jsonl'))) {
      await yieldToEventLoop()
      signal?.throwIfAborted()
      summary.scanned += 1
      const info = await stat(file.path).catch(() => null)
      if (!info) {
        summary.unavailable += 1
        continue
      }
      const read = await readJsonlLinesWithCursor(file.path, true)
      if (read.lines.length === 0) {
        summary.unavailable += 1
        continue
      }
      const ref: SessionFileRef = { ...file, namespace: root }
      const snapshot = await parsePiSession(ref, undefined, undefined, undefined, read.lines)
      // Pi session ids live in the file header, so the cursor can only be
      // checked after parsing; the ledger dedups identities either way.
      const cursor = snapshot?.sessionId ? ledger.sessionState('pi', root, snapshot.sessionId)?.sourceSize : undefined
      if (cursor !== undefined && cursor === info.size) {
        summary.skipped += 1
        continue
      }
      record(snapshot?.usageObservation, read.completeBytes)
    }
  }

  return summary
}
