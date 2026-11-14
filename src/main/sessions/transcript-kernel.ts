// Note: transcript-driven session content truth — one per-engine record
// classification shared by scanner, detail reader and excerpt path — see
// .agents/notes/sessions/requirements/session-content-truth.md
// Codex instruction header variants and cached-title repair:
// .agents/notes/sessions/records/session-content-truth-kernel.md
import { isRuntimeNotification } from '../knowledge/personal-memory-content'

export type TranscriptKernelEngine = 'claude' | 'codex' | 'pi' | 'janus'

export interface KernelMessage {
  role: 'user' | 'assistant'
  text: string
  timestamp?: string
}

export interface KernelTurn {
  prompt?: string
  excerpt?: string
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

export function parseJsonLine(line: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(line) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/**
 * Text-only content extraction: plain strings and text-class blocks join with
 * newlines. Tool calls, tool results and thinking blocks carry no display
 * prose and never enter the session pipeline.
 */
export function textOfContent(content: unknown): string | undefined {
  if (typeof content === 'string') return content.trim() || undefined
  if (!Array.isArray(content)) return undefined
  const texts: string[] = []
  for (const block of content) {
    const record = asRecord(block)
    if (!record) {
      if (typeof block === 'string' && block.trim()) texts.push(block.trim())
      continue
    }
    const type = readString(record.type)?.toLowerCase()
    if (type && !['text', 'input_text', 'output_text'].includes(type)) continue
    const text = readString(record.text)
    if (text) texts.push(text)
  }
  const joined = texts.join('\n').trim()
  return joined || undefined
}

/** Claude meta, sidechain and compaction records never represent main-conversation turns. */
function isClaudeNoise(record: Record<string, unknown>): boolean {
  return record.isMeta === true || record.isSidechain === true || record.isCompactSummary === true
}

export function claudeUserText(record: Record<string, unknown>): string | undefined {
  if (readString(record.type)?.toLowerCase() !== 'user') return undefined
  if (isClaudeNoise(record)) return undefined
  const message = asRecord(record.message)
  if (!message || readString(message.role)?.toLowerCase() !== 'user') return undefined
  const text = textOfContent(message.content)
  return text && !isRuntimeNotification(text) ? text : undefined
}

export function claudeAssistantText(record: Record<string, unknown>): string | undefined {
  if (readString(record.type)?.toLowerCase() !== 'assistant') return undefined
  if (isClaudeNoise(record)) return undefined
  const message = asRecord(record.message)
  if (!message || readString(message.role)?.toLowerCase() !== 'assistant') return undefined
  return textOfContent(message.content)
}

/**
 * Codex writes each message twice: a `response_item` source record and an
 * `event_msg` mirror. Source records win; the mirror is accepted only for
 * files that never contain a `response_item` (older shapes).
 */
function codexMirror(record: Record<string, unknown>): boolean {
  return readString(record.type)?.toLowerCase() === 'event_msg'
}

export function codexUserText(record: Record<string, unknown>, allowMirror = false): string | undefined {
  if (codexMirror(record) && !allowMirror) return undefined
  const payload = asRecord(record.payload)
  const rootType = readString(record.type)?.toLowerCase()
  if (payload) {
    const role = readString(payload.role)?.toLowerCase()
    if (rootType === 'response_item' && role === 'user') {
      const text = textOfContent(payload.content)
      if (text) return text
    }
    const payloadType = readString(payload.type)?.toLowerCase()
    if (payloadType === 'user_message') {
      return readString(payload.message) ?? readString(payload.text) ?? textOfContent(payload.content)
    }
  }
  const message = asRecord(record.message)
  if (message && readString(message.role)?.toLowerCase() === 'user') {
    return textOfContent(message.content)
  }
  return undefined
}

export function codexAssistantText(record: Record<string, unknown>, allowMirror = false): string | undefined {
  if (codexMirror(record) && !allowMirror) return undefined
  const payload = asRecord(record.payload)
  if (payload) {
    const role = readString(payload.role)?.toLowerCase()
    if (readString(record.type)?.toLowerCase() === 'response_item' && role === 'assistant') {
      return textOfContent(payload.content)
    }
    const payloadType = readString(payload.type)?.toLowerCase()
    if (payloadType === 'agent_message') {
      return readString(payload.message) ?? readString(payload.text) ?? textOfContent(payload.content)
    }
  }
  return undefined
}

function piMessageText(record: Record<string, unknown>, role: string): string | undefined {
  if (readString(record.type)?.toLowerCase() !== 'message') return undefined
  const message = asRecord(record.message)
  if (!message || readString(message.role)?.toLowerCase() !== role) return undefined
  return textOfContent(message.content)
}

export function piUserText(record: Record<string, unknown>): string | undefined {
  const text = piMessageText(record, 'user')
  return text && !isRuntimeNotification(text) ? text : undefined
}

export function piAssistantText(record: Record<string, unknown>): string | undefined {
  return piMessageText(record, 'assistant')
}

/**
 * Codex marks real user input with record metadata (`user_input_order`,
 * `retained_source`, …). The AGENTS.md instructions blob arrives as a user
 * record with empty or missing metadata. Any non-empty metadata marks a real
 * record (including large re-registered inputs); empty metadata plus a marked
 * file means environment context. Legacy records carry no metadata at all and
 * fall back to the content heuristics below.
 */
function isCodexInputRecord(record: Record<string, unknown>): boolean {
  const meta = asRecord(record.metadata)
  if (!meta) return true
  return Object.keys(meta).length > 0
}

const CODEX_INJECTION_TEXT =
  /^(?:# AGENTS\.md instructions(?:[ \t]+for[ \t]+[^\r\n]+)?[ \t]*(?:\r?\n|$)|<ENVIRONMENT_CONTEXT>|<user_instructions>|<INSTRUCTIONS>)/i

/** Environment-context text a CLI injected as a user message; never a question. */
export function isEnvironmentInjectionText(text: string): boolean {
  return CODEX_INJECTION_TEXT.test(text.trim())
}

function isCodexInjectionText(text: string): boolean {
  return isEnvironmentInjectionText(text)
}

function janusMessage(record: Record<string, unknown>, role: string): string | undefined {
  const message = asRecord(record.message) ?? record
  const messageRole = readString(message.role)?.toLowerCase()
  if (messageRole !== role) return undefined
  return textOfContent(message.content)
}

/**
 * Wrapper noise around real questions: command wrappers, interrupt markers
 * and system-reminder blocks hide the user's actual input in first-prompt
 * position and card titles.
 */
export function cleanPromptText(text: string): string {
  let out = text
  out = out.replace(/<command-name>[\s\S]*?<\/command-name>/g, '')
  out = out.replace(/<command-message>[\s\S]*?<\/command-message>/g, '')
  out = out.replace(/<command-args>[\s\S]*?<\/command-args>/g, '')
  out = out.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
  out = out.replace(/\[Request interrupted by user\]/g, '')
  return out.trim()
}

/**
 * Main-conversation message stream of one transcript. Codex mirrors collapse
 * into their source records; a mirror-only file keeps its mirrors. User text
 * is cleaned of wrapper noise; an all-wrapper question drops out entirely.
 */
export function extractKernelMessages(lines: string[], engine: TranscriptKernelEngine): KernelMessage[] {
  const records: Record<string, unknown>[] = []
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const record = parseJsonLine(trimmed)
    if (record) records.push(record)
  }
  return kernelMessagesFromRecords(records, engine)
}

export function kernelMessagesFromRecords(
  records: Record<string, unknown>[],
  engine: TranscriptKernelEngine,
  options: { hasInputOrder?: boolean } = {},
): KernelMessage[] {
  const hasSource = engine === 'codex' && records.some((r) => readString(r.type)?.toLowerCase() === 'response_item')
  const hasInputOrder = options.hasInputOrder ??
    (engine === 'codex' && records.some((r) => typeof asRecord(r.metadata)?.user_input_order === 'number'))
  const messages: KernelMessage[] = []
  for (const record of records) {
    let user =
      engine === 'claude'
        ? claudeUserText(record)
        : engine === 'codex'
          ? codexUserText(record, !hasSource)
          : engine === 'pi'
            ? piUserText(record)
            : janusMessage(record, 'user')
    // Codex writes AGENTS.md instructions and other environment context as
    // user records; only marked input is a real question.
    if (engine === 'codex' && user) {
      if (isCodexInjectionText(user) || (hasInputOrder && !isCodexInputRecord(record))) user = undefined
    }
    const assistant =
      engine === 'claude'
        ? claudeAssistantText(record)
        : engine === 'codex'
          ? codexAssistantText(record, !hasSource)
          : engine === 'pi'
            ? piAssistantText(record)
            : janusMessage(record, 'assistant')
    const timestamp = messageTimestamp(record)
    if (user) {
      const cleaned = cleanPromptText(user)
      if (cleaned) messages.push({ role: 'user', text: cleaned, ...(timestamp ? { timestamp } : {}) })
    }
    if (assistant) messages.push({ role: 'assistant', text: assistant, ...(timestamp ? { timestamp } : {}) })
  }
  return messages
}

function messageTimestamp(record: Record<string, unknown>): string | undefined {
  const message = asRecord(record.message)
  const payload = asRecord(record.payload)
  const raw =
    record.timestamp ?? record.created_at ?? record.createdAt ?? message?.timestamp ?? payload?.timestamp
  if (typeof raw === 'string' && raw.trim()) return raw
  return undefined
}

/**
 * One user question is one turn. Consecutive assistant records (agentic
 * multi-step answers) merge into the open turn's answer; an answer without a
 * question (window cut) is its own turn.
 */
export function pairTurns(messages: KernelMessage[]): KernelTurn[] {
  const turns: KernelTurn[] = []
  let current: KernelTurn | undefined
  for (const message of messages) {
    if (message.role === 'user') {
      if (current) turns.push(current)
      current = { prompt: message.text }
      continue
    }
    if (!current) {
      current = { excerpt: message.text }
      continue
    }
    current.excerpt = current.excerpt ? `${current.excerpt}\n${message.text}` : message.text
  }
  if (current) turns.push(current)
  return turns
}

/** First real user question after wrapper filtering. */
export function firstCleanPrompt(messages: KernelMessage[]): string | undefined {
  for (const message of messages) {
    if (message.role !== 'user') continue
    const cleaned = cleanPromptText(message.text)
    if (cleaned) return cleaned
  }
  return undefined
}

/**
 * Turn pairs of one bounded read. A windowed read (headLines below the line
 * count) pairs inside each window segment and concatenates, so a question
 * from the head never fabricates a pair with an answer from the tail.
 */
export function segmentTurns(lines: string[], headLines: number, engine: TranscriptKernelEngine): KernelTurn[] {
  const segments =
    headLines < lines.length ? [lines.slice(0, headLines), lines.slice(headLines)] : [lines]
  const turns: KernelTurn[] = []
  for (const segment of segments) {
    turns.push(...pairTurns(extractKernelMessages(segment, engine)))
  }
  return turns
}
