import { homedir } from 'node:os'
import type { ConversationModelOption } from '../../../shared/conversation-display'
import type { WorkerBackend } from '../../../shared/superagent'
import { CliDetector } from '../../external-cli/cli-detector'
import { managedCliEnv } from '../../external-cli/managed-paths'
import { CodexManagedTransport } from '../../terminal/codex-managed-transport'
import { resolveCodexServerBinary } from '../../terminal/codex-conversation'
import { resolveClaudeBinary } from '../../terminal/claude-conversation'
import { readClaudeCatalog } from '../../terminal/claude-models'

/** Global defaults use native user configuration, just like Worker launch.
 * No LLM channel lookup, configuration write, thread creation or model turn.
 */
export async function readWorkerModelCatalog(backend: WorkerBackend): Promise<ConversationModelOption[]> {
  const candidate = await new CliDetector(backend).findCandidate()
  if (!candidate) throw new Error(`${backend} is not installed`)
  const env = managedCliEnv(), cwd = homedir()
  if (backend === 'claude') {
    const catalog = await readClaudeCatalog({ binary: resolveClaudeBinary(candidate.path), cwd, env,
      settings: JSON.stringify({ disableAllHooks: true }), signal: new AbortController().signal })
    return catalog.models
  }
  const transport = new CodexManagedTransport(() => {}, () => {})
  try {
    await transport.start({ command: resolveCodexServerBinary(candidate.path), args: [], cwd, env })
    const models = new Map<string, ConversationModelOption>(), cursors = new Set<string>()
    let cursor: string | undefined
    do {
      const result = await transport.call('model/list', { limit: 100, ...(cursor ? { cursor } : {}) })
      if (!Array.isArray(result.data)) throw new Error('Invalid Codex model catalog')
      for (const raw of result.data) {
        if (!raw || raw.hidden || typeof raw.model !== 'string' || !raw.model || raw.model.length > 200) continue
        const efforts: ConversationModelOption['efforts'] = (Array.isArray(raw.supportedReasoningEfforts) ? raw.supportedReasoningEfforts : [])
          .filter((row: { reasoningEffort?: unknown } | null) => row && typeof row.reasoningEffort === 'string')
          .map((row: { reasoningEffort: string; description?: unknown }) => ({ effort: row.reasoningEffort, description: String(row.description ?? '').slice(0, 1000) }))
        models.set(raw.model, { model: raw.model, displayName: String(raw.displayName || raw.model).slice(0, 200),
          description: String(raw.description ?? '').slice(0, 2000), efforts,
          defaultEffort: efforts.some(row => row.effort === raw.defaultReasoningEffort) ? raw.defaultReasoningEffort : efforts[0]?.effort ?? null })
      }
      cursor = typeof result.nextCursor === 'string' && result.nextCursor ? result.nextCursor : undefined
      if (cursor && (cursors.has(cursor) || cursors.size >= 9 || models.size > 500)) throw new Error('Codex model catalog pagination limit reached')
      if (cursor) cursors.add(cursor)
    } while (cursor)
    return [...models.values()]
  } finally {
    await transport.stop()
  }
}

/** Collapse concurrent settings reads; refreshes after completion always reread native config. */
export class WorkerModelCatalog {
  private pending = new Map<WorkerBackend, Promise<ConversationModelOption[]>>()
  constructor(private readonly read = readWorkerModelCatalog) {}
  get(value: unknown): Promise<ConversationModelOption[]> {
    if (value !== 'codex' && value !== 'claude') return Promise.reject(new Error('Unsupported Worker backend'))
    const existing = this.pending.get(value)
    if (existing) return existing
    const request = Promise.resolve().then(() => this.read(value)).finally(() => this.pending.delete(value))
    this.pending.set(value, request)
    return request
  }
}
