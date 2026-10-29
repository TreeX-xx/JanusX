// Note: engine differences live here as data, never in branches (config-table
// pattern) — see
// .agents/notes/sessions/records/session-engine-capabilities.md
// Note: external transcript backfill reads provider session stores — see
// .agents/notes/sessions/records/external-session-transcript-backfill.md
import { homedir } from 'node:os'
import { join } from 'node:path'
import { resolveOpencodeDbPath } from '../sessions/opencode-store-path'
import type { AgentHookSource } from './agent-hook-types'

export type TranscriptKind = 'claude-jsonl' | 'codex-rollout' | 'janus-history' | null

/** Provider on-disk store of session transcripts (external backfill source). */
export type SessionStoreKind = 'claude-projects' | 'codex-sessions' | 'opencode-sqlite' | 'pi-sessions' | null

export type EngineEventPhase = 'start' | 'complete' | 'fail' | 'approval' | 'attention'

export interface EngineEventRule {
  event: string
  /** When set, the hook raw payload must carry one of these statuses. */
  rawStatus?: readonly string[]
}

export interface AgentEngineCapability {
  start: readonly EngineEventRule[]
  complete: readonly EngineEventRule[]
  fail: readonly EngineEventRule[]
  /**
   * Approval/attention names before matcher nuance. The coordinator layers
   * the shared Notification matcher contract on top; the recorder matches
   * bare Notification exactly as before.
   */
  approval: readonly string[]
  attention: readonly string[]
  /** Transcript source for answer excerpts; null means status-only turns. */
  transcript: TranscriptKind
  /** Transcript sentinel watches this engine for mid-turn aborts. */
  sentinel: boolean
  /** On-disk session store for external backfill; null means none/no driver. */
  sessionStore: SessionStoreKind
}

const NATIVE_TURNS = {
  start: [{ event: 'UserPromptSubmit' }],
  complete: [{ event: 'Stop' }],
  fail: [{ event: 'StopFailure' }, { event: 'PostToolUseFailure' }],
} as const

const NATIVE_ATTENTION = {
  approval: ['PermissionRequest'],
  attention: ['PermissionRequest', 'Notification'],
} as const

export const AGENT_ENGINE_CAPABILITIES: Record<AgentHookSource, AgentEngineCapability> = {
  claude: {
    ...NATIVE_TURNS,
    ...NATIVE_ATTENTION,
    transcript: 'claude-jsonl',
    sentinel: true,
    sessionStore: 'claude-projects',
  },
  codex: {
    ...NATIVE_TURNS,
    ...NATIVE_ATTENTION,
    transcript: 'codex-rollout',
    sentinel: false,
    sessionStore: 'codex-sessions',
  },
  janus: {
    ...NATIVE_TURNS,
    ...NATIVE_ATTENTION,
    transcript: 'janus-history',
    sentinel: false,
    // Janus history is local to this app, not an external provider store.
    sessionStore: null,
  },
  pi: {
    ...NATIVE_TURNS,
    ...NATIVE_ATTENTION,
    // Pi sessions read from the on-disk session files; turn-end excerpts
    // stay status-only and resume runs from the session file path.
    transcript: null,
    sentinel: false,
    sessionStore: 'pi-sessions',
  },
  opencode: {
    start: [{ event: 'session.status', rawStatus: ['busy', 'running'] }, { event: 'session.execution.started' }],
    complete: [{ event: 'session.idle' }, { event: 'session.execution.succeeded' }],
    fail: [{ event: 'session.error' }, { event: 'session.execution.failed' }],
    approval: ['permission.asked'],
    attention: ['permission.asked', 'question.asked', 'question.v2.asked'],
    // Sessions persist in sqlite with a list/detail driver in
    // sessions/opencode-sessions; turn-end excerpts stay status-only.
    transcript: null,
    sentinel: false,
    sessionStore: 'opencode-sqlite',
  },
  dsh: {
    ...NATIVE_TURNS,
    ...NATIVE_ATTENTION,
    transcript: null,
    sentinel: false,
    sessionStore: null,
  },
}

/**
 * Absolute path of the provider session store for an engine, or null when the
 * engine has no readable external store. Env/home are injectable test seams so
 * unit tests never touch the real user profile.
 */
export function resolveSessionStorePath(
  source: AgentHookSource,
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): string | null {
  const kind = AGENT_ENGINE_CAPABILITIES[source].sessionStore
  if (kind === 'claude-projects') {
    const configDir = env.CLAUDE_CONFIG_DIR?.trim()
    return join(configDir && configDir.length > 0 ? configDir : join(home, '.claude'), 'projects')
  }
  if (kind === 'codex-sessions') {
    const codeHome = env.CODEX_HOME?.trim()
    return join(codeHome && codeHome.length > 0 ? codeHome : join(home, '.codex'), 'sessions')
  }
  if (kind === 'opencode-sqlite') {
    return resolveOpencodeDbPath(home, env)
  }
  if (kind === 'pi-sessions') {
    return join(home, '.pi', 'agent', 'sessions')
  }
  return null
}

/** Raw status candidates for status-shaped events (opencode plugin contract). */
export function extractHookRawStatus(raw: unknown): string | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const record = raw as Record<string, unknown>
  const properties = record.properties
  const candidates = [
    record.status,
    record.state,
    properties && typeof properties === 'object'
      ? (properties as Record<string, unknown>).status
      : undefined,
  ]
  // OpenCode SDK statuses are tagged objects, including properties.status.
  for (const value of candidates) {
    if (typeof value === 'string') return value
    if (value && typeof value === 'object' && 'type' in value && typeof value.type === 'string') {
      return value.type
    }
  }
  return undefined
}

/** opencode posts canonical names; every other source trims. */
export function normalizeHookEventName(source: AgentHookSource, event: string): string {
  if (source === 'opencode') return event
  return event.trim()
}

export function matchesEngineEvents(
  source: AgentHookSource,
  phase: EngineEventPhase,
  event: string,
  raw?: unknown,
): boolean {
  const rules =
    phase === 'start'
      ? AGENT_ENGINE_CAPABILITIES[source].start
      : phase === 'complete'
        ? AGENT_ENGINE_CAPABILITIES[source].complete
        : phase === 'fail'
          ? AGENT_ENGINE_CAPABILITIES[source].fail
          : null
  if (rules) {
    const status = extractHookRawStatus(raw)
    return rules.some(
      (rule) =>
        rule.event === event && (!rule.rawStatus || (status !== undefined && rule.rawStatus.includes(status))),
    )
  }
  const names =
    phase === 'approval'
      ? AGENT_ENGINE_CAPABILITIES[source].approval
      : AGENT_ENGINE_CAPABILITIES[source].attention
  return names.includes(event)
}
