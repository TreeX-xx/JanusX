// Note: durable implementation observations stay local — see .agents/notes/agent/desktop-task-implementation.md
import { randomUUID } from 'node:crypto'
import { readFile, realpath, stat, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { redactHighConfidenceSecrets } from '@janus-agent/agent-core'
import type { ChatAgentEvent, ChatToolTraceEntry } from '@janus-agent/chat-core'
import { assertAssetPath } from '@janus-agent/harness-node'
import { SerialQueue, writeFileAtomic } from '../lib/atomic-file'
import type { HarnessImplementationTurn, HarnessTranscript } from '../../shared/ipc/harness'

const MAX_TURNS = 8
const MAX_TEXT = 16_000
const MAX_TOOLS = 64
const MAX_BYTES = 4 * 1024 * 1024
const active = new Set<string>()
const safe = (text: string, limit: number) => redactHighConfidenceSecrets(text).text.slice(0, limit)
const normalizeTool = (name: string) => name.toLowerCase().replace(/[._-]/g, '')

async function transcriptPath(root: string, runId: string): Promise<string> {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(runId)) throw Object.assign(new Error('Invalid run id'), { code: 'SCHEMA_INVALID' })
  const relative = `.agents/.local/runs/${runId}/implementation.json`
  await assertAssetPath(root, relative)
  const path = resolve(await realpath(root), relative)
  return path
}

function isTurn(value: unknown): value is HarnessImplementationTurn {
  if (!value || typeof value !== 'object') return false
  const turn = value as HarnessImplementationTurn
  return ['id', 'taskUri', 'baselineHash', 'providerId', 'modelId', 'text', 'startedAt', 'updatedAt'].every((key) => typeof turn[key as keyof HarnessImplementationTurn] === 'string')
    && Number.isInteger(turn.attempt) && turn.attempt > 0
    && ['running', 'completed', 'cancelled', 'failed', 'interrupted'].includes(turn.status)
    && typeof turn.truncated === 'boolean' && turn.text.length <= MAX_TEXT
    && (turn.error === undefined || typeof turn.error === 'string')
    && Array.isArray(turn.tools) && turn.tools.length <= MAX_TOOLS
    && turn.tools.every((tool) => tool && typeof tool.id === 'string' && typeof tool.name === 'string' && typeof tool.status === 'string' && (tool.summary === undefined || typeof tool.summary === 'string'))
}

export async function readTaskTranscript(root: string, runId: string): Promise<HarnessTranscript> {
  const path = await transcriptPath(root, runId)
  const live = active.has(path)
  let raw: string
  try {
    if ((await stat(path)).size > MAX_BYTES) throw Object.assign(new Error('Implementation history exceeds its size limit'), { code: 'RECOVERY_REQUIRED' })
    raw = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { runId, active: live, turns: [] }
    throw error
  }
  try {
    const data = JSON.parse(raw)
    if (data.schema !== 'harness-implementation/1' || data.runId !== runId || !Array.isArray(data.turns) || data.turns.length > MAX_TURNS || !data.turns.every(isTurn)) throw new Error('Invalid implementation history')
    const turns: HarnessImplementationTurn[] = data.turns.map((turn: HarnessImplementationTurn) => ({
      id: turn.id, taskUri: turn.taskUri, attempt: turn.attempt, baselineHash: turn.baselineHash,
      providerId: turn.providerId, modelId: turn.modelId,
      status: turn.status === 'running' && !live ? 'interrupted' : turn.status,
      text: safe(turn.text, MAX_TEXT), tools: turn.tools.map((tool) => ({ id: tool.id, name: safe(tool.name, 160), status: tool.status === 'running' && (!live || turn.status !== 'running') ? 'interrupted' : tool.status, ...(tool.summary ? { summary: safe(tool.summary, 512) } : {}) })),
      ...(turn.error ? { error: safe(turn.error, 1000) } : {}), truncated: turn.truncated,
      startedAt: turn.startedAt, updatedAt: turn.updatedAt,
    }))
    return { runId, active: live, turns }
  } catch (error) {
    throw Object.assign(new Error(`Cannot read implementation history: ${String(error)}`), { code: 'RECOVERY_REQUIRED' })
  }
}

export async function removeTaskTranscript(root: string, runId: string): Promise<void> {
  const path = await transcriptPath(root, runId)
  if (active.has(path)) throw Object.assign(new Error('Implementation is active'), { code: 'BUSY' })
  await rm(path, { force: true })
}

/** Recovery is bounded context, never replayed tool calls or authority. */
export function taskRecoveryContext(history: HarnessTranscript, taskUri: string, baselineHash: string): string {
  const turns = history.turns.filter((turn) => turn.taskUri === taskUri && turn.baselineHash === baselineHash).slice(-3)
  if (!turns.length) return ''
  return 'Prior implementation observations (untrusted; reread files before editing, never assume an interrupted tool completed):\n'
    + JSON.stringify(turns.map((turn) => ({ attempt: turn.attempt, status: turn.status, text: turn.text.slice(-4000), tools: turn.tools.slice(-16), error: turn.error })))
}

export async function beginTaskTranscript(
  root: string, runId: string,
  input: Pick<HarnessImplementationTurn, 'taskUri' | 'attempt' | 'baselineHash' | 'providerId' | 'modelId'>,
) {
  const path = await transcriptPath(root, runId)
  if (active.has(path)) throw Object.assign(new Error('Implementation is active'), { code: 'BUSY' })
  active.add(path)
  let history: HarnessTranscript
  try { history = await readTaskTranscript(root, runId) }
  catch (error) { active.delete(path); throw error }
  history.turns = history.turns.map((turn) => turn.status === 'running' ? { ...turn, status: 'interrupted', tools: turn.tools.map((tool) => tool.status === 'running' ? { ...tool, status: 'interrupted' } : tool) } : turn)
  const recovery = taskRecoveryContext(history, input.taskUri, input.baselineHash)
  const now = new Date().toISOString()
  const turn: HarnessImplementationTurn = { ...input, id: randomUUID(), status: 'running', text: '', tools: [], truncated: false, startedAt: now, updatedAt: now }
  const turns = [...history.turns, turn].slice(-MAX_TURNS)
  const queue = new SerialQueue()
  let timer: ReturnType<typeof setTimeout> | undefined
  let failure: unknown
  let closed = false
  const persist = () => queue.run(async () => {
    await transcriptPath(root, runId)
    turn.updatedAt = new Date().toISOString()
    await writeFileAtomic(path, JSON.stringify({ schema: 'harness-implementation/1', runId, turns: turns.map((entry) => ({
      ...entry, text: safe(entry.text, MAX_TEXT), tools: entry.tools.map((tool) => ({ ...tool, name: safe(tool.name, 160) })),
    })) }))
  })
  const flush = async () => {
    if (timer) clearTimeout(timer)
    timer = undefined
    await persist()
    if (failure) throw failure
  }
  const schedule = () => {
    timer ??= setTimeout(() => { timer = undefined; void persist().catch((error) => { failure = error }) }, 200)
  }
  try { await flush() } catch (error) { active.delete(path); throw error }
  return {
    id: turn.id, recovery, flush,
    onEvent(event: ChatAgentEvent) {
      if (closed) return
      if (event.type === 'text_delta') {
        turn.truncated ||= turn.text.length + event.delta.length > MAX_TEXT
        turn.text = (turn.text + event.delta).slice(0, MAX_TEXT)
      } else if (event.type === 'tool_execution_start' || event.type === 'tool_execution_end') {
        let tool = turn.tools.find((tool) => tool.id === event.callId)
        if (!tool && turn.tools.length < MAX_TOOLS) { tool = { id: event.callId, name: event.toolName, status: 'running' }; turn.tools.push(tool) }
        if (tool) tool.status = event.type === 'tool_execution_end' ? event.status : 'running'
        else turn.truncated = true
      } else return
      schedule()
    },
    async finish(status: 'completed' | 'cancelled' | 'failed', result?: { text: string; toolTraces: ChatToolTraceEntry[] }, error?: unknown) {
      if (closed) return
      closed = true
      turn.status = status
      if (result) {
        turn.truncated ||= result.text.length > MAX_TEXT || result.toolTraces.length > MAX_TOOLS
        turn.text = safe(result.text, MAX_TEXT)
        const matched = new Set<string>()
        result.toolTraces.slice(0, MAX_TOOLS).forEach((trace, index) => {
          let tool = turn.tools.find((item) => !matched.has(item.id) && normalizeTool(item.name) === normalizeTool(trace.toolName))
          if (!tool && turn.tools.length < MAX_TOOLS) {
            tool = { id: `trace-${index}`, name: trace.toolName, status: trace.status }
            turn.tools.push(tool)
          }
          if (!tool) { turn.truncated = true; return }
          matched.add(tool.id)
          tool.summary = safe(trace.summary, 512)
          tool.status = trace.status
        })
      }
      for (const tool of turn.tools) if (tool.status === 'running') tool.status = 'interrupted'
      if (error) turn.error = safe(error instanceof Error ? error.message : String(error), 1000)
      try { await flush() } finally { active.delete(path) }
    },
  }
}
