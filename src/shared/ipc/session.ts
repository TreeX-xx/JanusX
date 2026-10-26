// Note: transcript detail reads plus provider resume commands back the
// windowed session reading — see
// .agents/notes/sessions/records/session-resume-detail.md
export const SESSION_CHANNELS = {
  list: 'session:list',
  get: 'session:get',
  continue: 'session:continue',
  resendHandoff: 'session:resend-handoff',
  event: 'session:event',
  scanExternal: 'session:scan-external',
  getTranscript: 'session:get-transcript',
  saveLayout: 'session:save-layout',
  getLayout: 'session:get-layout',
  clearLayout: 'session:clear-layout',
} as const

export type AgentSessionStatus = 'active' | 'done' | 'failed' | 'interrupted'
export type AgentSessionTurnKind = 'done' | 'failed' | 'interrupted'

export interface SessionTurnRecord {
  id: string
  kind: AgentSessionTurnKind
  checkpointId?: string
  startedAt: string
  endedAt: string
  /** Question snapshot taken at turn end; survives checkpoint prune. */
  prompt?: string
  /** Answer excerpt parsed from the provider transcript tail; capped. */
  excerpt?: string
}

export interface AgentSessionSummary {
  id: string
  workspaceId: string
  engine: string
  cwd: string
  branch?: string
  firstPrompt: string
  turnCount: number
  checkpointCount: number
  status: AgentSessionStatus
  providerSessionId?: string
  transcriptPath?: string
  continuedFrom?: string
  createdAt: string
  updatedAt: string
  archived: boolean
  /** Imported from a provider transcript store; no live JanusX terminal. */
  external?: boolean
}

export interface AgentSessionDetail extends AgentSessionSummary {
  terminalIds: string[]
  turns: SessionTurnRecord[]
  /** Recent provider prose, independent of hook-owned turn identities. */
  transcriptPreview?: TranscriptTurn[]
  transcriptUpdatedAt?: string
  pendingHandoff?: string
  /**
   * Why the handoff is still pending. `unconfirmed` means it was written but no
   * composer was ever observed; `failed` means nothing landed. Both need the
   * user to check the new session, so the card offers a resend.
   */
  pendingHandoffState?: 'unconfirmed' | 'failed'
}

export interface SessionFilter {
  workspaceId?: string
  cwd?: string
  engine?: string
  includeArchived?: boolean
}

/**
 * How a continuation re-enters the work:
 * - `resume` re-enters the provider's own session id in a fresh terminal, so the
 *   conversation continues inside the same provider session.
 * - `continue` resumes Claude, Codex and Opencode history in a new terminal
 *   when the target engine is unchanged and a provider id is recorded. Other
 *   cases open a fresh session with an explicitly described task handoff.
 *
 * Continue in New Session is not a privilege of live rows: an external row's
 * context lives in its own transcript file, so it can hand over too. Callers
 * omit the field to keep the origin-derived default (external -> resume).
 */
export type SessionContinueMode = 'resume' | 'continue'

export interface SessionContinueInput {
  sessionId: string
  engine?: string
  mode?: SessionContinueMode
  /**
   * Workspace the new terminal should show in. External rows carry no
   * workspace of their own, so the caller passes the one it is viewing.
   */
  workspaceId?: string
}

export interface SessionContinueResult {
  sessionId: string
  terminalId: string
}

export interface SessionHandoff {
  title: string
  progress: string
  transcriptPath?: string
  checkpointRef?: string
  cwd: string
  engine: string
}

/** One question-plus-answer pair parsed from a provider transcript file. */
export interface TranscriptTurn {
  prompt?: string
  excerpt?: string
}

/** Bounded full-prose read of a session transcript; excerpt-first fallback when null. */
export interface TranscriptDetail {
  transcriptPath: string
  turns: TranscriptTurn[]
  totalTurns: number
  truncated: boolean
}

/**
 * Provider resume argv tail for external rows (provider-native resume). Null when the
 * engine has no known resume shape, the id is missing, or (pi) the session
 * file path is missing — pi resumes from the file, never from a bare id.
 */
export function buildProviderResumeArgs(
  engine: string,
  providerSessionId?: string,
  transcriptPath?: string,
): string[] | null {
  providerSessionId = providerSessionId?.trim()
  if (!providerSessionId) return null
  if (engine === 'claude') return ['--resume', providerSessionId]
  if (engine === 'codex') return ['resume', providerSessionId]
  if (engine === 'opencode') return ['--session', providerSessionId]
  if (engine === 'pi') return transcriptPath ? ['--session', transcriptPath] : null
  return null
}

/** Display form of the resume invocation; matches the executed argv tail. */
export function buildProviderResumeCommand(
  engine: string,
  providerSessionId?: string,
  transcriptPath?: string,
): string | null {
  const args = buildProviderResumeArgs(engine, providerSessionId, transcriptPath)
  if (!args) return null
  return `${engine} ${args.join(' ')}`
}

/**
 * Native-resume argv for Continue in New Session on internal rows.
 * Claude, Codex and Opencode re-enter their provider session ids: a typed handoff
 * cannot restore conversation history and may be dropped by a slow TUI.
 * Engine switches and rows without
 * a resumable id return null so the caller keeps the focused handoff.
 */
export function buildContinueResumeArgs(
  source: { engine: string; providerSessionId?: string; transcriptPath?: string },
  targetEngine?: string,
): string[] | null {
  if (!isNativeResumeEngine(source.engine)) return null
  if (targetEngine !== undefined && targetEngine !== source.engine) return null
  return buildProviderResumeArgs(source.engine, source.providerSessionId, source.transcriptPath)
}

/** Engines whose internal and external rows share native recovery behavior. */
export function isNativeResumeEngine(engine: string): boolean {
  return engine === 'claude' || engine === 'codex' || engine === 'opencode'
}

/** Archive removes JanusX checkpoints, not the provider's conversation history. */
export function canOfferSessionResume(source: { engine: string; external?: boolean; archived: boolean }): boolean {
  return isNativeResumeEngine(source.engine) || (source.external === true && !source.archived)
}

export interface SessionAPI {
  list(filter?: SessionFilter): Promise<AgentSessionSummary[]>
  get(sessionId: string): Promise<AgentSessionDetail | null>
  continue(input: SessionContinueInput): Promise<SessionContinueResult>
  /** Redeliver a focused handoff that landed nowhere or unconfirmed. */
  resendHandoff(sessionId: string): Promise<{ delivered: boolean; verdict: string }>
  onEvent(callback: (payload: { type: string; sessionId?: string }) => void): () => void
  scanExternal(): Promise<ExternalScanSummary>
  getTranscript(sessionId: string): Promise<TranscriptDetail | null>
  saveLayout(layout: ShellRestoreManifest): Promise<{ success: boolean }>
  getLayout(): Promise<ShellRestoreManifest | null>
  clearLayout(): Promise<{ success: boolean }>
}

export interface ExternalScanSummary {
  remote?: { imported: number; errors: string[] }
  scanned: number
  imported: number
  updated: number
  skipped: number
}

export interface ShellRestoreTerminal {
  id?: string
  cwd: string
  preset: string
  name: string
  /** Launch line the terminal was started with; absent on manifests written before shell profiles. */
  shell?: string
}

export interface ShellRestoreWorkspace {
  workspaceId: string
  terminals: ShellRestoreTerminal[]
}

export interface ShellRestoreManifest {
  version: 1
  savedAt: string
  workspaces: ShellRestoreWorkspace[]
}
