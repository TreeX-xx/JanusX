import { watch, type FSWatcher } from 'node:fs'
import { open, stat } from 'node:fs/promises'
import { basename, dirname } from 'node:path'
import type { AgentEngine } from '../janus-runner/types'

/**
 * Secondary deterministic turn-end source for CLIs whose end-of-turn hooks do
 * not fire on abnormal aborts (API error mid-turn, user interrupt). Watches the
 * session transcript JSONL that the CLI itself maintains for resume fidelity:
 * any turn end that mutates conversation state must be recorded there, so the
 * watcher derives outcomes from records written by the provider.
 */

const READ_CHUNK_BYTES = 256 * 1024
// Transcript lines can embed large tool results; drop and resync at the next
// newline instead of holding an unbounded partial line in memory.
const MAX_REMAINDER_BYTES = 16 * 1024 * 1024
const NEWLINE = 0x0a
const EMPTY = Buffer.alloc(0)

const INTERRUPT_MARKER = '[Request interrupted by user'

export type TurnSentinelKind = 'api-error' | 'interrupted'

export interface TurnSentinelSignal {
  terminalId: string
  engine: AgentEngine
  kind: TurnSentinelKind
  message?: string
}

export interface TurnSentinelDiagnostic {
  stage: string
  terminalId: string
  detail?: string
}

export interface TurnSentinelBeginInput {
  providerTurnId?: string
  terminalId: string
  engine: AgentEngine
  transcriptPath?: string
  sessionId?: string
}

interface AgentTurnSentinelOptions {
  onSignal: (signal: TurnSentinelSignal) => void
  onDiagnostic?: (record: TurnSentinelDiagnostic) => void
}

interface SentinelTurnState {
  terminalId: string
  engine: AgentEngine
  transcriptPath: string
  fileName: string
  sessionId?: string
  // Older hook senders lack the native turn ID. Bind it from the open root
  // turn at the initial EOF, then accept only an end bearing that same ID.
  codex?: { turnId?: string; initialSize: number; explicit: boolean }
  watcher: FSWatcher | null
  offset: number
  remainder: Buffer
  reading: boolean
  pendingRead: boolean
  done: boolean
}

function extractMessageTexts(message: unknown): string[] {
  if (!message || typeof message !== 'object') return []
  const content = (message as Record<string, unknown>).content
  if (typeof content === 'string') return [content]
  if (!Array.isArray(content)) return []

  const texts: string[] = []
  for (const block of content) {
    if (!block || typeof block !== 'object') continue
    const record = block as Record<string, unknown>
    if (typeof record.text === 'string') {
      texts.push(record.text)
      continue
    }
    // tool_result blocks carry string content or nested text blocks.
    if (typeof record.content === 'string') {
      texts.push(record.content)
    } else if (Array.isArray(record.content)) {
      for (const inner of record.content) {
        if (inner && typeof inner === 'object' && typeof (inner as Record<string, unknown>).text === 'string') {
          texts.push((inner as Record<string, unknown>).text as string)
        }
      }
    }
  }
  return texts
}

export interface TranscriptTurnSignal {
  kind: TurnSentinelKind
  message?: string
}

/**
 * Classify one transcript JSONL line as a turn-terminating record.
 *
 * - API error aborts are structural: the CLI stamps `isApiErrorMessage: true`
 *   on the synthetic assistant message. Retry attempts are not written to the
 *   transcript, so every such record is terminal.
 * - User interrupts are `type: "user"` records whose text starts with the
 *   interrupt marker. The type guard matters: assistant output that merely
 *   quotes the marker must not end the turn.
 * - Sidechain (subagent) records never end the main turn.
 */
export function classifyTranscriptLine(line: string, sessionId?: string): TranscriptTurnSignal | null {
  const trimmed = line.trim()
  if (!trimmed) return null

  let entry: unknown
  try {
    entry = JSON.parse(trimmed)
  } catch {
    return null
  }
  if (!entry || typeof entry !== 'object') return null

  const record = entry as Record<string, unknown>
  if (record.isSidechain === true) return null

  const entrySessionId = typeof record.sessionId === 'string' ? record.sessionId : undefined
  if (sessionId && entrySessionId && entrySessionId !== sessionId) return null

  const texts = extractMessageTexts(record.message)
  if (record.isApiErrorMessage === true) {
    return { kind: 'api-error', message: texts.find((text) => text.trim()) }
  }

  if (record.type === 'user' && texts.some((text) => text.trimStart().startsWith(INTERRUPT_MARKER))) {
    return { kind: 'interrupted' }
  }

  return null
}

// Note: .agents/notes/terminal/terminal-hook-launch-isolation.md
function codexTurnSignal(line: string, turn: NonNullable<SentinelTurnState['codex']>, historical: boolean): TranscriptTurnSignal | null {
  if (!/task_started|turn_context|task_complete|turn_aborted/.test(line)) return null
  let record
  try { record = JSON.parse(line) } catch { return null }
  const payload = record?.payload
  const id = payload?.turn_id
  if (typeof id !== 'string' || (payload.root_turn_id && payload.root_turn_id !== id)) return null
  const event = record.type === 'event_msg' ? payload.type : undefined
  if (event === 'task_started' || record.type === 'turn_context') {
    if (!turn.explicit && (historical || !turn.turnId)) turn.turnId = id
    return null
  }
  if (turn.turnId !== id || (event !== 'turn_aborted' && event !== 'task_complete')) return null
  if (historical && !turn.explicit) {
    turn.turnId = undefined
    return null
  }
  if (event === 'turn_aborted' && payload.reason === 'interrupted') return { kind: 'interrupted' }
  if (event === 'task_complete' && payload.error && typeof payload.error.message === 'string') {
    return { kind: 'api-error', message: payload.error.message }
  }
  return null
}

export class AgentTurnSentinel {
  private readonly turns = new Map<string, SentinelTurnState>()
  private readonly onSignal: (signal: TurnSentinelSignal) => void
  private readonly onDiagnostic?: (record: TurnSentinelDiagnostic) => void

  constructor(options: AgentTurnSentinelOptions) {
    this.onSignal = options.onSignal
    this.onDiagnostic = options.onDiagnostic
  }

  beginTurn(input: TurnSentinelBeginInput): void {
    this.endTurn(input.terminalId)

    const transcriptPath = input.transcriptPath?.trim()
    if (!transcriptPath) {
      this.diagnose(input.terminalId, 'skipped', 'no-transcript-path')
      return
    }

    const state: SentinelTurnState = {
      terminalId: input.terminalId,
      engine: input.engine,
      transcriptPath,
      fileName: basename(transcriptPath).toLowerCase(),
      sessionId: input.sessionId,
      codex: input.engine === 'codex' ? { turnId: input.providerTurnId, explicit: !!input.providerTurnId, initialSize: 0 } : undefined,
      watcher: null,
      offset: 0,
      remainder: EMPTY,
      reading: true, // initialize the cursor before servicing queued watcher events
      pendingRead: false,
      done: false,
    }

    try {
      // Watch the directory: covers a transcript that does not exist yet and is
      // the reliable append trigger on Windows. Reads always run to EOF, so a
      // coalesced or missed event is caught up by the next one.
      state.watcher = watch(dirname(transcriptPath), { persistent: false }, (_eventType, fileName) => {
        if (fileName && String(fileName).toLowerCase() !== state.fileName) return
        this.scheduleRead(state)
      })
      state.watcher.on('error', (error) => {
        this.diagnose(state.terminalId, 'watch-error', error instanceof Error ? error.message : String(error))
        if (this.turns.get(state.terminalId) === state) this.endTurn(state.terminalId)
      })
    } catch (error) {
      this.diagnose(input.terminalId, 'unavailable', error instanceof Error ? error.message : String(error))
      return
    }

    this.turns.set(input.terminalId, state)
    if (state.codex) this.diagnose(input.terminalId, 'codex-armed', input.providerTurnId)
    // Claude starts at EOF. Codex may write its turn ID before the submit
    // hook runs, so inspect a bounded tail before following new records.
    void stat(transcriptPath)
      .then((info) => {
        if (state.codex) {
          state.codex.initialSize = info.size
          state.offset = Math.max(0, info.size - READ_CHUNK_BYTES)
        } else state.offset = info.size
      })
      .catch(() => {
        state.offset = 0
      })
      .then(() => {
        state.reading = false
        this.scheduleRead(state)
      })
  }

  endTurn(terminalId: string): void {
    const state = this.turns.get(terminalId)
    if (!state) return
    this.turns.delete(terminalId)
    state.done = true
    state.remainder = EMPTY
    try {
      state.watcher?.close()
    } catch {
      // fs.FSWatcher.close never matters past teardown
    }
    state.watcher = null
  }

  dispose(): void {
    for (const terminalId of [...this.turns.keys()]) {
      this.endTurn(terminalId)
    }
  }

  private scheduleRead(state: SentinelTurnState): void {
    if (state.done) return
    if (state.reading) {
      state.pendingRead = true
      return
    }
    state.reading = true
    void (async () => {
      try {
        do {
          state.pendingRead = false
          await this.readNewBytes(state)
        } while (state.pendingRead && !state.done)
      } catch (error) {
        this.diagnose(state.terminalId, 'read-error', error instanceof Error ? error.message : String(error))
      } finally {
        state.reading = false
      }
    })()
  }

  private async readNewBytes(state: SentinelTurnState): Promise<void> {
    let handle
    try {
      handle = await open(state.transcriptPath, 'r')
    } catch {
      // Not created yet; the directory watcher fires again on creation.
      return
    }

    try {
      const size = (await handle.stat()).size
      if (state.done) return
      if (size < state.offset && state.codex) {
        this.endTurn(state.terminalId)
        return
      }
      if (size < state.offset) {
        // Truncated or rotated: restart from the top of the new content.
        state.offset = 0
        state.remainder = EMPTY
      }
      while (!state.done && state.offset < size) {
        const length = Math.min(READ_CHUNK_BYTES, size - state.offset)
        const { bytesRead, buffer } = await handle.read(Buffer.alloc(length), 0, length, state.offset)
        if (bytesRead <= 0) break
        state.offset += bytesRead
        this.ingest(state, buffer.subarray(0, bytesRead))
      }
    } finally {
      await handle.close().catch(() => {})
    }
  }

  private ingest(state: SentinelTurnState, chunk: Buffer): void {
    let data = state.remainder.length > 0 ? Buffer.concat([state.remainder, chunk]) : chunk
    state.remainder = EMPTY

    while (!state.done) {
      const newlineIndex = data.indexOf(NEWLINE)
      if (newlineIndex < 0) break
      const line = data.subarray(0, newlineIndex).toString('utf8')
      data = data.subarray(newlineIndex + 1)

      const lineEnd = state.offset - data.length
      const signal = state.codex
        ? codexTurnSignal(line, state.codex, lineEnd <= state.codex.initialSize)
        : classifyTranscriptLine(line, state.sessionId)
      if (!signal) continue

      const { terminalId, engine } = state
      this.endTurn(terminalId)
      if (state.codex) this.diagnose(terminalId, 'codex-' + signal.kind, state.codex.turnId)
      this.onSignal({ terminalId, engine, kind: signal.kind, message: signal.message })
      return
    }

    if (state.done) return
    if (data.length > MAX_REMAINDER_BYTES) {
      this.diagnose(state.terminalId, 'remainder-dropped', `partial line exceeded ${MAX_REMAINDER_BYTES} bytes`)
      state.remainder = EMPTY
      return
    }
    // Copy so the retained remainder does not pin the full concat buffer.
    state.remainder = data.length > 0 ? Buffer.from(data) : EMPTY
  }

  private diagnose(terminalId: string, stage: string, detail?: string): void {
    this.onDiagnostic?.({ terminalId, stage, detail })
  }
}
