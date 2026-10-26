import type { RuntimeTelemetrySnapshot } from './system'

export const TERMINAL_INVOKE_CHANNELS = {
  warmup: 'terminal:warmup',
  create: 'terminal:create',
  replay: 'terminal:replay',
  kill: 'terminal:kill',
} as const

export const TERMINAL_SEND_CHANNELS = {
  input: 'terminal:input',
  resize: 'terminal:resize',
  submitLine: 'terminal:submit-line',
} as const

export const TERMINAL_EVENT_CHANNELS = {
  data: 'terminal:data',
  exit: 'terminal:exit',
  focus: 'terminal:focus',
  created: 'terminal:created',
  status: 'terminal:status',
  telemetry: 'terminal:telemetry',
  turnChanges: 'terminal:turn-changes',
} as const

export type TerminalAgentEngine = 'claude' | 'codex' | 'opencode' | 'janus' | 'pi' | 'dsh'

// Note: six internal states route hooks and sort order; approval and input share one attention visual — see .agents/notes/terminal/terminal-status-display.md
// Sidebar display status of a terminal entry.
// - wait: idle / no active output stream (AI CLI back at prompt, or shell always)
// - running: AI CLI turn open (UserPromptSubmit / session busy until Stop / session idle)
// - needs-input: CLI waits for an option/question answer (mid-turn idle_prompt notification; a Claude post-completion idle nudge with no open turn never leaves wait)
// - needs-approval: CLI waits for a permission grant (PermissionRequest / permission.asked / permission_prompt)
// - degraded: turn failed but pty alive (429/5xx, session.error, StopFailure); retry without recreating
// - error: pty exited non-zero; entry retained in the list
export type TerminalStatus = 'wait' | 'running' | 'needs-input' | 'needs-approval' | 'degraded' | 'error'

export interface TerminalWarmupRequest {
  engines?: Array<TerminalAgentEngine | 'janus' | 'pi' | 'dsh'>
}

export interface TerminalCreateRequest {
  /** Reattach only; never spawn if the remote process no longer exists. */
  attachOnly?: boolean
  id: string
  workspaceId?: string
  cwd: string
  shell: string
  preset?: string
  command?: string
  args?: string[]
  autoCommand?: string
  /**
   * Shell profile id for an ordinary shell terminal: the configured default
   * entry when omitted. Drives a direct PTY spawn of the user's free command.
   */
  shellProfileId?: string
  /** Full launch line captured for cold restore, so a restored shell keeps its own shell. */
  shellCommand?: string
  /**
   * Extra argv appended after the preset launch program. Lets a caller resume
   * a provider session (for example `claude --resume <id>`) while the preset
   * keeps hook wiring on the owning engine.
   */
  extraArgs?: string[]
  cols?: number
  rows?: number
}

export interface TerminalCreateResult {
  pid: number
}

export interface TerminalInputPayload {
  id: string
  data: string
}

export interface TerminalResizePayload {
  id: string
  cols: number
  rows: number
}

export interface TerminalSubmitLinePayload {
  id: string
  text: string
}

export interface TerminalDataEvent {
  id: string
  data: string
  seq?: number
}

export interface TerminalExitEvent {
  id: string
  exitCode: number
}

export interface TerminalFocusEvent {
  id: string
}
export interface TerminalCreatedEvent {
  id: string
  workspaceId: string
  cwd: string
  preset: TerminalAgentEngine | 'shell' | 'janus' | 'pi' | 'dsh'
  shell: string
  pid: number
}

export interface TerminalStatusEvent {
  id: string
  status: TerminalStatus
}

export interface TerminalTelemetryEvent {
  id: string
  telemetry: RuntimeTelemetrySnapshot
}

export type TurnChangeKind = 'done' | 'failed' | 'interrupted'

export interface TurnChangedFile {
  path: string
  status: 'added' | 'deleted' | 'modified' | 'binary' | 'oversized'
  additions: number | null
  deletions: number | null
  size: number
}

/**
 * Turn-end change set for the per-pane island. Files cap at 100 entries;
 * fileCount carries the true total and the session panel holds the record.
 */
export interface TerminalTurnChangesEvent {
  id: string
  turnId?: string
  sequence?: number
  /** False when a boundary could not be captured; never report it as no changes. */
  available?: boolean
  kind: TurnChangeKind
  checkpointId: string | null
  files: TurnChangedFile[]
  fileCount: number
  additions: number
  deletions: number
  endedAt: string
}

export interface TerminalReplayResult {
  data: string
  seq: number
}

export interface TerminalAPI {
  warmup(request?: TerminalWarmupRequest): Promise<{ ok: true }>
  create(request: TerminalCreateRequest): Promise<TerminalCreateResult>
  replay(id: string): Promise<TerminalReplayResult>
  kill(id: string): Promise<{ success: true }>
  input(id: string, data: string): void
  resize(id: string, cols: number, rows: number): void
  submitLine(id: string, text: string): void
  onData(callback: (event: TerminalDataEvent) => void): () => void
  onExit(callback: (event: TerminalExitEvent) => void): () => void
  onFocus(callback: (event: TerminalFocusEvent) => void): () => void
  onCreated(callback: (event: TerminalCreatedEvent) => void): () => void
  onStatus(callback: (event: TerminalStatusEvent) => void): () => void
  onTelemetry(callback: (event: TerminalTelemetryEvent) => void): () => void
  onTurnChanges(callback: (event: TerminalTurnChangesEvent) => void): () => void
}
