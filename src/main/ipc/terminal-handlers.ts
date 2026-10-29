import { ipcMain, BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import { terminalManager } from '../terminal/manager'
import { createRemoteTerminal } from '../terminal/remote-pty'
import { parseRuntimeResource } from '../../shared/workspace-runtime'
import { remoteBackendRequest } from '../workspace/remote-harness'
import { resolveRuntimeResource, runtimeRequest } from '../workspace/runtime'
import { TerminalTurnChangeTracker } from '../terminal/turn-change-tracker'
import { useWorkspaceStorage as acquireWorkspaceStorage } from '@janus-agent/agent-core'
import { requestWorkspaceMaintenance } from '../storage/service'
import type { CheckpointEngine } from '@janus-agent/agent-core'
import { agentSessionRegistry, type AgentSessionRecord } from '../sessions/session-registry'
import { buildContinueHandoff } from '../sessions/continue-handoff'
import { deliverHandoff, type HandoffTransport } from '../sessions/handoff-delivery'
import { prepareSessionRecovery, type SessionRecoveryEnvironment } from '../sessions/session-recovery'
import { isTerminalPreset, resolveTerminalLaunchProgram } from '../../shared/terminalLaunch'
import { resolveCLIPath } from '../janus-runner/cli-resolver'
import { subAgentRunRegistry } from '../janus-runner/subagent-run-registry'
import type { SubAgentRunEngine } from '../../shared/subAgentRun'
import { AgentHookBridge } from '../notifications/agent-hook-bridge'
import { AgentHookConfigManager } from '../notifications/agent-hook-config'
import { assertHookCleanupIdle } from '../notifications/retire-legacy-hooks'
import { AgentHookCoordinator, getRawString } from '../notifications/agent-hook-coordinator'
import { AGENT_ENGINE_CAPABILITIES } from '../notifications/agent-engine-capabilities'
import { AgentTurnSentinel } from '../notifications/agent-turn-sentinel'
import {
  JANUSX_SYNTHETIC_HOOK_EVENTS,
  type AgentHookPayload,
  type AgentHookSource,
} from '../notifications/agent-hook-types'
import {
  AgentHookDiagnostics,
  summarizeCoordinatorEvent,
  summarizeHookPayload,
} from '../notifications/agent-hook-diagnostics'
import { logTerminalDiagnostic } from '../terminal/diagnostics'
import { getDefaultShellCommand, resolveShellProfileLaunch } from '../terminal/shell-profiles'
import { agentTurnRecorder } from '../knowledge/agent-turn-recorder'
import { readAssistantExcerpt } from '../sessions/transcript-excerpt'
import { appShutdown } from '../shutdown/AppShutdown'
import { officecliManager } from '../office/officecli-manager'
import { existsSync } from 'node:fs'
import { extname, resolve } from 'node:path'
import { buildOfficeAgentSession, mergeOfficeAgentEnv } from '../office/office-agent-policy'
import {
  TERMINAL_EVENT_CHANNELS,
  TERMINAL_INVOKE_CHANNELS,
  TERMINAL_SEND_CHANNELS,
  type TerminalCreateRequest,
  type TerminalInputPayload,
  type TerminalResizePayload,
  type TerminalSubmitLinePayload,
  type TerminalWarmupRequest,
} from '../../shared/ipc/terminal'
import { AGENT_CHANNELS } from '../../shared/ipc/janus-runner'
import { buildContinueResumeArgs, buildProviderResumeArgs, isNativeResumeEngine } from '../../shared/ipc/session'
import { companionSessionState } from '../companion/session-state'
import { rollbackTerminalCreation } from '../companion/terminal-creation-rollback'
import { terminalContextCoordinator } from '../runtime-telemetry/coordinator'
import { createTerminalColorQueryResponder } from '../../shared/terminalColorQuery'
import { configService } from '../config/service'
import {
  createTerminalServiceErrorDetector,
  isTerminalInterrupt,
  type TerminalServiceErrorDetector,
} from '../notifications/terminal-turn-signals'

// Track lifecycle state per terminal
interface TerminalState {
  cwd: string
  workspaceId: string
  engine: CheckpointEngine
  // AC6: per-id creation lock. True while a terminal:create for this id is
  // in flight; concurrent create requests with the same id are rejected.
  creationLocked: boolean
  // Retained for lifecycle cleanup compatibility. AI activity status is
  // sourced exclusively from agent hooks, never inferred from PTY output.
  flowStatus: 'wait' | 'running'
  flowTimer: ReturnType<typeof setTimeout> | null
  lastDataAt: number
  // Hook lifecycle is authoritative once observed; ignore prompt echoes.
  hookStatus?: 'running' | 'wait' | 'needs-input' | 'needs-approval' | 'degraded' | 'error'
  // Set when JanusX itself initiated the kill (kill IPC / same-id replace) so
  // pty exit with an open turn reads as a silent user interrupt, not a crash.
  userKillRequested?: boolean
}

const terminalStates = new Map<string, TerminalState>()

let companionTerminalCreator: ((config: TerminalCreateRequest) => Promise<{ pid: number }>) | null = null

/** 直启程序；shell 条目解析失败时用 error 占位，错误在调用方已有 try 内抛出。 */
type ResolvedLaunchProgram = { command: string; args: string[] } | { error: string } | undefined

export type ContinueSessionOptions = {
  engine?: string
  /** Native engines keep the original conversation; otherwise Continue sends a handoff. */
  mode?: 'resume' | 'continue'
  /** Target workspace for the new terminal when the source row carries none (external rows). */
  workspaceId?: string
}

let continueSessionImpl:
  | ((sessionId: string, opts?: ContinueSessionOptions) => Promise<{ sessionId: string; terminalId: string }>)
  | null = null

/** Continue in New Session: fresh terminal plus focused handoff for one task. */
// Note: internal opencode rows resume natively via --session instead �?see .agents/notes/sessions/records/opencode-continue-native-resume.md
export function continueAgentSession(
  sessionId: string,
  opts?: ContinueSessionOptions,
): Promise<{ sessionId: string; terminalId: string }> {
  if (!continueSessionImpl) throw new Error('Terminal session lifecycle is not available')
  return continueSessionImpl(sessionId, opts)
}

// In-flight focused-handoff deliveries keyed by new session id. Killing the
// terminal marks its delivery dead so a late write cannot land in a recycled
// pty, and the handoff stays on the record for manual resend.
const handoffDeliveries = new Map<string, { cancelled: boolean }>()

function clearHandoffDeliveryForTerminal(terminalId: string): void {
  const sessionId = agentSessionRegistry.sessionIdForTerminal(terminalId)
  if (!sessionId) return
  const delivery = handoffDeliveries.get(sessionId)
  if (delivery) {
    delivery.cancelled = true
    handoffDeliveries.delete(sessionId)
  }
}

/**
 * The pty side of handoff delivery. Writes go to the pty directly so a refused
 * write is a real signal instead of the silent best-effort `terminalManager.write`.
 */
function buildHandoffTransport(terminalId: string): HandoffTransport {
  return {
    isAlive: () => Boolean(terminalManager.getInstance(terminalId)),
    write: (data) => {
      const instance = terminalManager.getInstance(terminalId)
      if (!instance) return false
      try {
        instance.pty.write(data)
        return true
      } catch {
        return false
      }
    },
    observeOutput: (handler) => {
      const instance = terminalManager.getInstance(terminalId)
      if (!instance) return () => {}
      // node-pty appends listeners, so this sidecar tap never displaces the
      // primary handler that feeds the renderer.
      const disposable = instance.pty.onData(handler)
      return () => {
        try {
          disposable.dispose()
        } catch {
          // already gone
        }
      }
    },
  }
}

/**
 * Redeliver a focused handoff that landed nowhere or whose delivery could not
 * be confirmed. The card keeps the text until a delivery is confirmed, so this
 * never has to reconstruct what the user was promised.
 */
export async function resendSessionHandoff(
  sessionId: string,
): Promise<{ delivered: boolean; verdict: string }> {
  const record = agentSessionRegistry.getSession(sessionId)
  if (!record) throw new Error(`Session not found: ${sessionId}`)
  const handoff = record.pendingHandoff
  if (!handoff) throw new Error('Session has no pending handoff to resend')
  const terminalId = record.terminalIds.at(-1)
  if (!terminalId) throw new Error('Session has no terminal to deliver into')

  const delivery: { cancelled: boolean } = { cancelled: false }
  handoffDeliveries.set(sessionId, delivery)
  const result = await deliverHandoff({ transport: buildHandoffTransport(terminalId), handoff })
  if (delivery.cancelled) return { delivered: false, verdict: 'failed' }
  handoffDeliveries.delete(sessionId)

  if (result.verdict === 'delivered') {
    agentSessionRegistry.notePrompt(terminalId, handoff)
    recordSubmittedPrompt(terminalId, handoff)
    agentSessionRegistry.setPendingHandoff(sessionId, undefined)
  } else {
    agentSessionRegistry.setPendingHandoff(sessionId, handoff, result.verdict)
    console.error(`[sessions] handoff resend ${result.verdict}${result.reason ? `: ${result.reason}` : ''}`)
  }
  return { delivered: result.verdict === 'delivered', verdict: result.verdict }
}

/**
 * 当前主窗口 getter：由 registerTerminalHandlers 注入。
 * 事件发送方每次调用取最新窗口，窗口重建后不再持有旧引用（audit M1）。
 */
let getHostWindow: () => BrowserWindow | null = () => null

/** 窗口 closed 时的终端侧清理；由 register.ts 在每个新窗口上挂载。 */
let hostWindowClosedHandler: (() => void) | null = null

export function handleTerminalHostWindowClosed(): void {
  hostWindowClosedHandler?.()
}

/*-- P3: pty 输出 IPC 合批。每 chunk 一次 send 在编译输出等场景可达每秒数千次，
     按终端 id 累积 ~16ms 再 flush；replay/exit/kill 前强制 flush 保证顺序一致。 --*/
const TERMINAL_DATA_FLUSH_MS = 16

interface PendingTerminalData {
  data: string
  seq: number
  timer: ReturnType<typeof setTimeout> | null
}

const pendingTerminalData = new Map<string, PendingTerminalData>()

function flushTerminalData(id: string): void {
  const pending = pendingTerminalData.get(id)
  if (!pending) return
  if (pending.timer) clearTimeout(pending.timer)
  pendingTerminalData.delete(id)
  if (pending.data) {
    sendToRenderer(getHostWindow(), TERMINAL_EVENT_CHANNELS.data, { id, data: pending.data, seq: pending.seq })
  }
}

function queueTerminalData(id: string, data: string, seq: number): void {
  const pending = pendingTerminalData.get(id)
  if (pending) {
    pending.data += data
    pending.seq = seq
    return
  }
  const entry: PendingTerminalData = { data, seq, timer: null }
  pendingTerminalData.set(id, entry)
  entry.timer = setTimeout(() => flushTerminalData(id), TERMINAL_DATA_FLUSH_MS)
}

function dropPendingTerminalData(id: string): void {
  const pending = pendingTerminalData.get(id)
  if (!pending) return
  if (pending.timer) clearTimeout(pending.timer)
  pendingTerminalData.delete(id)
}

export function createCompanionTerminal(config: TerminalCreateRequest): Promise<{ pid: number }> {
  if (!companionTerminalCreator) throw new Error('Terminal lifecycle is not available')
  return companionTerminalCreator(config)
}

function sendToRenderer(mainWindow: BrowserWindow | null, channel: string, payload: unknown): void {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return
  try {
    mainWindow.webContents.send(channel, payload)
  } catch (err) {
    // AC2: webContents.send can throw synchronously when the window is torn down
    // between the liveness check and the send (TOCTOU). Swallow so a native
    // pty callback cannot crash the main process.
    console.error(`[terminal] sendToRenderer(${channel}) failed:`, err)
  }
}

function normalizeSubmittedPrompt(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
    .trimEnd()
}

// Note: snapshots retired; .agents/notes/sessions/checkpoints/module.md
function recordSubmittedPrompt(id: string, text: string): void {
  const prompt = normalizeSubmittedPrompt(text)
  if (prompt.trim() && terminalStates.has(id)) agentSessionRegistry.notePrompt(id, prompt)
}

export function submitCompanionTerminalLine(id: string, text: string): void {
  terminalManager.write(id, text + '\r')
  recordSubmittedPrompt(id, text)
}

const terminalStorageReleases = new Map<string, () => void>()
function forgetTerminalState(id: string): void {
  terminalStates.delete(id)
  terminalStorageReleases.get(id)?.()
  terminalStorageReleases.delete(id)
  requestWorkspaceMaintenance()
}

const AGENT_CLI_COMMANDS = ['claude', 'codex', 'opencode', 'janus', 'pi', 'dsh'] as const
type WarmupEngine = (typeof AGENT_CLI_COMMANDS)[number]

function isWarmupEngine(value: string): value is WarmupEngine {
  return (AGENT_CLI_COMMANDS as readonly string[]).includes(value)
}

function resolveOfficecliLaunchAssets(): {
  pathDir: string | undefined
  binaryPath: string | undefined
} {
  // initializeOfficecliProvider runs before the window opens. Missing or broken
  // Office support must not put capability probes on the terminal startup path.
  const binary = officecliManager.getVerifiedBinary()
  return {
    pathDir: officecliManager.resolveAgentPathDir(),
    binaryPath: binary?.path,
  }
}

export function registerTerminalHandlers(getMainWindow: () => BrowserWindow | null): void {
  getHostWindow = getMainWindow
  const hookDiagnostics = new AgentHookDiagnostics()
  const turnChangeTracker = new TerminalTurnChangeTracker(event => {
    sendToRenderer(getMainWindow(), TERMINAL_EVENT_CHANNELS.turnChanges, event)
  })
  const serviceErrorDetectors = new Map<string, TerminalServiceErrorDetector>()
  agentTurnRecorder.setEventSink((event) => {
    hookDiagnostics.record({
      stage: `knowledge-${event.type}`,
      source: event.engine,
      event: event.hookEvent,
      terminalId: event.terminalId,
      workspaceId: event.workspaceId,
      engine: event.engine,
      reason: event.reason,
      detail: event.observationId ?? event.workspacePath,
    })
  })
  // Single ingest point for CLI-origin (bridge) and main-process synthetic
  // (sentinel / pty-exit) hook payloads: identical diagnostics + coordinator path.
  function ingestHookPayload(payload: AgentHookPayload): void {
    hookDiagnostics.record(summarizeHookPayload(payload))
    hookCoordinator.handleHookPayload(payload)
  }

  // Secondary deterministic turn-end source: Claude's Stop hook does not fire
  // when a turn aborts on an API error or user interrupt, which used to leave
  // the sidebar on "running" forever with no notification. The sentinel tails
  // the session transcript (event-driven, no timeouts) and reports those ends.
  const turnSentinel = new AgentTurnSentinel({
    onSignal: (signal) => {
      ingestHookPayload({
        source: signal.engine,
        event:
          signal.kind === 'api-error'
            ? JANUSX_SYNTHETIC_HOOK_EVENTS.apiError
            : JANUSX_SYNTHETIC_HOOK_EVENTS.interrupted,
        terminalId: signal.terminalId,
        message: signal.message,
        timestamp: new Date().toISOString(),
      })
    },
    onDiagnostic: (record) => {
      hookDiagnostics.record({
        stage: `sentinel-${record.stage}`,
        terminalId: record.terminalId,
        detail: record.detail,
      })
    },
  })

  const hookCoordinator = new AgentHookCoordinator(getMainWindow, {
    onEvent: (event) => {
      hookDiagnostics.record(summarizeCoordinatorEvent(event))
      sendToRenderer(getMainWindow(), AGENT_CHANNELS.hookEvent, event)
    },
    onTurnStarted: (turn) => {
      turnChangeTracker.start(turn.terminalId)
      agentSessionRegistry.noteProviderSession(turn.terminalId, turn.sessionId, turn.transcriptPath)
      // Transcript sentinel watches engines with a tail-readable transcript
      // contract; today only claude. Others rely on their own failure hooks
      // (opencode session.error, codex service-error) plus pty-exit.
      if (!AGENT_ENGINE_CAPABILITIES[turn.source].sentinel) return
      turnSentinel.beginTurn({
        terminalId: turn.terminalId,
        engine: turn.engine,
        transcriptPath: turn.transcriptPath,
        sessionId: turn.sessionId,
      })
    },
    onTurnEnded: (terminalId) => {
      turnSentinel.endTurn(terminalId)
    },
    onResolvedPayload: async (payload, terminal, semantic) => {
      const state = terminalStates.get(terminal.terminalId)
      const event = payload.event.toLowerCase()
      const startsTurn = semantic.type === 'turn-start'
      const completesTurn = semantic.type === 'session-close' && semantic.interruptedTurn === true || semantic.type === 'turn-end' && semantic.kind !== 'failed'
      const failsTurn = semantic.type === 'turn-end' && semantic.kind === 'failed'
      const needsApproval = semantic.type === 'waiting-user' && semantic.kind === 'approval'
      const needsInput = semantic.type === 'waiting-user' && semantic.kind === 'input'
      if (payload.sessionId) agentSessionRegistry.noteProviderSession(terminal.terminalId, payload.sessionId,
        getRawString(payload.raw, ['transcript_path', 'transcriptPath']))
      companionSessionState.handleLifecycle(terminal.terminalId, semantic)
      // Keep habit content out of the capture branch entirely while disabled.
      void (async () => {
        if (!await agentTurnRecorder.isCaptureEnabled()) return
        await agentTurnRecorder.handleHookPayload({ ...payload, raw: {
          ...(payload.raw && typeof payload.raw === 'object' ? payload.raw : {}),
          transcriptPath: getRawString(payload.raw, ['transcript_path', 'transcriptPath'])
            ?? agentSessionRegistry.transcriptPathForTerminal(terminal.terminalId),
        } }, semantic)
      })().catch(error => console.warn('[hook] habit capture failed:', error))
      if (state && (startsTurn || completesTurn || failsTurn || needsApproval || needsInput)) {
        if (startsTurn) serviceErrorDetectors.get(terminal.terminalId)?.reset()
        // Turn 级失败（429 限流 / 5xx 过载 / StopFailure / session.error）时 CLI
        // 进程仍活着：上报 'degraded' 保持终端可用且可见，失败通知仍由
        // hookCoordinator.deliverCompletion 独立下发，不受影响。
        // 只有 'orphaned'（turn 未结束时 pty 已死，后续 onExit 会确认）才上报
        // 'error'，与 TerminalStatus“pty 非零退出”的语义对齐，避免误弹遮罩锁死输入。
        // 等待授权 / 等待选项输入各有独立状态，不再坍缩进 'wait'。
        const ptyDead = event === JANUSX_SYNTHETIC_HOOK_EVENTS.orphaned
        if (startsTurn) state.hookStatus = 'running'
        else if (ptyDead) state.hookStatus = 'error'
        else if (needsApproval) state.hookStatus = 'needs-approval'
        else if (needsInput) state.hookStatus = 'needs-input'
        else if (failsTurn) state.hookStatus = 'degraded'
        else state.hookStatus = 'wait'
        sendToRenderer(getMainWindow(), TERMINAL_EVENT_CHANNELS.status, {
          id: terminal.terminalId,
          status: state.hookStatus,
        })
      }
      // Session ledger and Island boundaries are independent of retired snapshots.
      if (state && (completesTurn || failsTurn)) {
        const kind = failsTurn
          ? 'failed'
          : semantic.type === 'session-close' || semantic.type === 'turn-end' && semantic.kind === 'interrupted'
            ? 'interrupted'
            : 'done'
        // A turn end closes an open turn only: SessionEnd after Stop and
        // duplicate ends must not fabricate phantom turns. An end with no
        // open hook turn and no pending submit is ignored.
        const openTurn =
          turnChangeTracker.hasActiveTurn(terminal.terminalId) ||
          agentSessionRegistry.hasPendingTurn(terminal.terminalId)
        // Capture the boundary before transcript reads; duplicate end hooks are ignored.
        void turnChangeTracker.finish(terminal.terminalId, kind, null)
        if (openTurn) {
          // Answer prose resolves per engine capability (hook raw first,
          // session record second). Failures yield undefined and never block.
          const attachExcerpt = agentSessionRegistry.recordTurnEnd(terminal.terminalId, kind)
          const excerpt = await readAssistantExcerpt({
            transcriptPath:
              getRawString(payload.raw, ['transcript_path', 'transcriptPath']) ??
              agentSessionRegistry.transcriptPathForTerminal(terminal.terminalId),
            sessionId:
              payload.sessionId ??
              agentSessionRegistry.providerSessionIdForTerminal(terminal.terminalId),
            threadId: getRawString(payload.raw, ['thread_id', 'threadId']),
            cwd: state.cwd,
            engine: terminal.engine,
          })
          attachExcerpt?.(excerpt)
        }
      }

    },
  })
  const hookBridge = new AgentHookBridge({
    onPayload: (payload) => {
      ingestHookPayload(payload)
    },
  })
  const hookConfigManager = new AgentHookConfigManager()
  /** Per-session gate so second+ Claude/Codex/OpenCode creates skip hook file IO. */
  const hooksInstalledThisSession = new Set<string>()

  async function ensureHooksInstalled(
    engine: Exclude<CheckpointEngine, 'shell' | 'manual'>,
    manager = hookConfigManager,
  ): Promise<void> {
    const key = engine === 'claude' ? manager.getClaudeSettingsPath()
      : engine === 'codex' ? manager.getCodexHooksPath() : engine
    if (hooksInstalledThisSession.has(key)) return
    await manager.ensureInstalled(engine)
    hooksInstalledThisSession.add(key)
  }

  // Fire-and-forget: first create should not wait on listen() or cold where.exe.
  void hookBridge.start().catch((err) => {
    console.error('Agent hook bridge prestart failed:', err)
  })
  // Usage accounting is hook-free: the corpus scan covers closed terminals,
  // offline periods and sessions JanusX never opened.
  terminalContextCoordinator.startCorpusScan()
  for (const command of AGENT_CLI_COMMANDS) {
    void resolveCLIPath(command).catch(() => undefined)
  }

  // Register terminal/hook cleanup into the unified shutdown path.
  // Window close without full quit still needs local cleanup.
  appShutdown.configure({
    stopRuntimeTelemetry: () => terminalContextCoordinator.shutdown(),
    flushAgentSessions: () => agentSessionRegistry.flush(),
    stopHookBridge: () => hookBridge.stop(),
    disposeTerminalSession: () => {
      for (const id of [...pendingTerminalData.keys()]) dropPendingTerminalData(id)
      terminalStates.clear()
      serviceErrorDetectors.clear()
      hooksInstalledThisSession.clear()
      hookCoordinator.dispose()
      turnSentinel.dispose()
      companionSessionState.clear()
      agentTurnRecorder.dispose()
      agentTurnRecorder.setEventSink(undefined)
    },
  })

  // 窗口 closed 清理逻辑；由 register.ts 在每个新窗口的 closed 事件上触发，
  // 窗口重建后仍然生效（旧实现只挂在首个窗口上，audit M1）。
  hostWindowClosedHandler = () => {
    if (appShutdown.isQuitting) return
    // Non-darwin: index mainWindow.closed triggers app.quit -> AppShutdown.
    // AC8: synchronously kill all ptys first so no native pty callback can
    // reach a destroyed webContents during the finalize window. Final state
    // cleanup still runs in AppShutdown.
    if (process.platform !== 'darwin') {
      try {
        void terminalManager.killAll()
      } catch (err) {
        console.error('[terminal] killAll on window close failed:', err)
      }
      return
    }

    // Darwin keeps the app process alive after the last window closes.
    void Promise.resolve().then(() => {
        void terminalManager.killAll()
        terminalStates.clear()
        serviceErrorDetectors.clear()
        hooksInstalledThisSession.clear()
        hookCoordinator.dispose()
        turnSentinel.dispose()
        companionSessionState.clear()
        agentTurnRecorder.dispose()
        agentTurnRecorder.setEventSink(undefined)
        void hookBridge.stop()
      })
  }

  ipcMain.handle(TERMINAL_INVOKE_CHANNELS.warmup, async (_event, payload?: TerminalWarmupRequest) => {
    const requested = Array.isArray(payload?.engines)
      ? payload.engines.filter((engine): engine is WarmupEngine => typeof engine === 'string' && isWarmupEngine(engine))
      : []

    await Promise.all([
      hookBridge.start().catch(() => undefined),
      ...requested.map((engine) => resolveCLIPath(engine).catch(() => null)),
      ...requested.map(async (engine) => {
        try {
          await ensureHooksInstalled(engine)
        } catch {
          // Warmup is best-effort; create path still retries setup.
        }
      }),
    ])

    return { ok: true as const }
  })

  const remoteCreations = new Map<string, Promise<{ pid: number }>>()
  const createRemoteLifecycle = async (config: TerminalCreateRequest): Promise<{ pid: number }> => {
    const resource = parseRuntimeResource(config.cwd)
    if (!resource || resource.workspaceId !== config.workspaceId) throw new Error('Terminal workspace does not match its directory')
    const existing = terminalManager.getInstance(config.id)
    if (existing) {
      if (!existing.remote || existing.config.workspaceId !== config.workspaceId || existing.config.cwd !== config.cwd) throw new Error('Terminal identity is already in use')
      return { pid: existing.pty.pid }
    }
    if (remoteCreations.has(config.id)) throw new Error('Terminal is already connecting')
    const pending = (async () => {
      const remote = await createRemoteTerminal(config, error => {
        sendToRenderer(getMainWindow(), TERMINAL_EVENT_CHANNELS.status, { id: config.id, status: error ? 'degraded' : 'wait' })
        if (error) logTerminalDiagnostic('remote terminal connection', { id: config.id, error })
      })
      const { instance } = remote
      if (appShutdown.isQuitting) { instance.remote!.detach(); throw new Error('Application is closing; the remote terminal remains available') }
      terminalManager.adopt(instance)
      if (config.preset && config.preset !== 'shell') {
        agentSessionRegistry.createSession({ terminalId: config.id, workspaceId: config.workspaceId!,
          engine: config.preset, cwd: config.cwd, shell: instance.config.shell, preset: config.preset })
      }
      instance.pty.onData(data => {
        if (terminalManager.getInstance(config.id) !== instance) return
        const seq = terminalManager.appendOutput(config.id, data)
        if (seq !== null) queueTerminalData(config.id, data, seq)
      })
      instance.pty.onExit(({ exitCode }) => {
        if (terminalManager.getInstance(config.id) !== instance) return
        flushTerminalData(config.id)
        instance.status = 'exited'
        agentSessionRegistry.noteProcessExit(config.id, exitCode)
        sendToRenderer(getMainWindow(), TERMINAL_EVENT_CHANNELS.exit, { id: config.id, exitCode })
      })
      sendToRenderer(getMainWindow(), TERMINAL_EVENT_CHANNELS.created, {
        id: config.id, workspaceId: config.workspaceId!, cwd: config.cwd,
        preset: isTerminalPreset(config.preset) ? config.preset : 'shell', shell: instance.config.shell, pid: instance.pty.pid,
      })
      remote.start()
      return { pid: instance.pty.pid }
    })()
    remoteCreations.set(config.id, pending)
    try { return await pending } finally { remoteCreations.delete(config.id) }
  }

  const createTerminalLifecycle = async (config: TerminalCreateRequest, recoveryEnv?: SessionRecoveryEnvironment) => {
    if (parseRuntimeResource(config.cwd)) return createRemoteLifecycle(config)
    assertHookCleanupIdle()
    const launchStartedAt = performance.now()
    const { id, cwd, shell, preset, command, args, cols, rows, extraArgs, shellProfileId, shellCommand } = config

    const workspaceId = typeof config.workspaceId === 'string' ? config.workspaceId : ''
    const engine: CheckpointEngine =
      isTerminalPreset(preset) && preset !== 'shell' ? preset : 'shell'
    const launchHookManager = hookConfigManager

    // AC6: per-id creation lock. Concurrent terminal:create with the same id
    // (e.g. double-click preset, retry during launch) is rejected so the
    // second caller does not race terminal lifecycle preparation on the same
    // cwd or collide with the first pty spawn (Vector B/F).
    const priorState = terminalStates.get(id)
    if (priorState?.creationLocked) {
      const existingInstance = terminalManager.getInstance(id)
      if (existingInstance) return { pid: existingInstance.pty.pid }
      throw new Error(`Terminal ${id} is already being created`)
    }

    // AC5: replacing an existing terminal with the same id. Tear down the
    // old pty and clear stale flow timer / run registry so the old onExit
    // callback cannot kill the new pty and the old flowTimer cannot push
    // status events into the new terminal (Vector A/D/E).
    if (priorState) {
      // Same-id replace is a user action; the old pty's exit must not read as a crash.
      priorState.userKillRequested = true
      if (priorState.flowTimer) {
        clearTimeout(priorState.flowTimer)
        priorState.flowTimer = null
      }
      // 旧 pty 未 flush 的合批数据不再属于新终端，丢弃
      dropPendingTerminalData(id)
      // Release the terminal's session binding so the replacement mints its
      // own row. createSession is idempotent per terminalId, so leaving the
      // old binding in place would reuse the previous conversation's row.
      agentSessionRegistry.detachTerminal(id)
      if (priorState.engine && priorState.engine !== 'shell') {
        try {
          subAgentRunRegistry.finishRun(
            `terminal:${id}`,
            'cancelled',
            'Replaced by new terminal with same id',
          )
        } catch (err) {
          console.error(`[terminal] finishRun on replace failed for ${id}:`, err)
        }
      }
    }
    try {
      terminalManager.kill(id)
    } catch (err) {
      console.error(`[terminal] kill-on-replace failed for ${id}:`, err)
    }

    // Pre-stub a locked state so concurrent callers see the lock immediately.
    // This is replaced by the full state below once the pty is spawned.
    terminalStates.set(id, {
      cwd,
      workspaceId,
      engine,
      creationLocked: true,
      flowStatus: 'wait',
      flowTimer: null,
      lastDataAt: 0,
      hookStatus: undefined,
    })

    const launchProgram = resolveTerminalLaunchProgram(
      isTerminalPreset(preset) ? preset : { command, args },
    )

    // 普通终端按用户自建 shell 条目直启（默认条目或本次临时选择），CLI 预设仍走上面解析。
    // shell 条目解析失败时返回 error 而不 reject：Promise.all 位于 pre-stub 之后，
    // reject 会漏掉 creationLocked（与 officePromise 的守卫同一理由），错误改在下面
    // 已有 try 内抛出，走完整的 rollback。
    const resolveProgramPromise = (async (): Promise<ResolvedLaunchProgram> => {
      if (engine === 'shell') {
        const shellLaunch = await resolveShellProfileLaunch({
          ...(shellProfileId ? { id: shellProfileId } : {}),
          ...(shellCommand ? { commandLine: shellCommand } : {}),
        })
        if (shellLaunch.error) return { error: shellLaunch.error }
        return shellLaunch.program
      }
      if (!launchProgram) return undefined
      try {
        const resolved = await resolveCLIPath(launchProgram.command)
        // Never pass a non-existent or extensionless Windows path to node-pty.
        // Fall back to the bare command so CreateProcess can still search PATHEXT.
        if (
          resolved &&
          (process.platform !== 'win32' ||
            (existsSync(resolved) && Boolean(extname(resolved))))
        ) {
          return { command: resolved, args: launchProgram.args }
        }
      } catch {
        // Fall back to bare command; PATH-based spawn may still succeed.
      }
      return launchProgram
    })()

    let hookLaunchArgs: string[] = []
    const hookEnvPromise = (async (): Promise<Record<string, string> | undefined> => {
      // shell spawns no agent and needs no hook env.
      if (engine === 'shell') return undefined
      try {
        await hookBridge.start()
        await ensureHooksInstalled(engine, launchHookManager)
        const program = await resolveProgramPromise
        if (engine === 'codex' && program && 'command' in program) await launchHookManager.checkCodexLaunchVersion(program.command)
        const openCodeMajor = engine === 'opencode' && program && 'command' in program
          ? await launchHookManager.getOpenCodeMajor(program.command) : undefined
        hookLaunchArgs = await launchHookManager.getLaunchArgs(engine, openCodeMajor)
        return launchHookManager.buildTerminalEnv(
          {
            terminalId: id,
            workspaceId,
            engine,
            openCodeMajor,
          },
          hookBridge.getEnv(),
        )
      } catch (err) {
        hookLaunchArgs = []
        const message = err instanceof Error ? err.message : String(err)
        console.error('Agent hook setup failed:', err)
        const event = {
          type: 'ignored',
          terminalId: id,
          engine,
          source: engine,
          hookEvent: 'setup',
          reason: message,
          delivered: false,
        } as const
        hookDiagnostics.record(summarizeCoordinatorEvent(event))
        sendToRenderer(getMainWindow(), AGENT_CHANNELS.hookEvent, event)
        return undefined
      }
    })()

    const [resolvedProgram, hookEnvBase] = await Promise.all([
      resolveProgramPromise,
      hookEnvPromise,
    ])

    const launchProgramError = resolvedProgram && 'error' in resolvedProgram ? resolvedProgram.error : undefined
    const launchProgramResolved = resolvedProgram && 'command' in resolvedProgram ? resolvedProgram : undefined

    const programArgs = [...(launchProgramResolved?.args ?? []), ...hookLaunchArgs, ...(extraArgs ?? [])]
    const preparationMs = Math.round(performance.now() - launchStartedAt)

    logTerminalDiagnostic('terminal create requested', {
      id,
      workspaceId,
      cwd,
      shell,
      preset,
      engine,
      program: launchProgramResolved?.command,
      programArgs,
    })

    let instance
    try {
      if (launchProgramError) throw new Error(launchProgramError)
      const baselineStartedAt = performance.now()
      if (engine !== 'shell') await turnChangeTracker.register(id, cwd)
      const baselineMs = Math.round(performance.now() - baselineStartedAt)
      const office = resolveOfficecliLaunchAssets()
      const officeMcpEntry = resolve(__dirname, '..', 'office-mcp.js')
      const officeSession = buildOfficeAgentSession(engine, cwd, office.binaryPath, officeMcpEntry)
      if (officeSession.limitation) {
        logTerminalDiagnostic('Office automation policy-only mode', { engine, limitation: officeSession.limitation })
      }
      const hookEnv = mergeOfficeAgentEnv(hookEnvBase, officeSession)
      terminalStorageReleases.set(id, acquireWorkspaceStorage(cwd))
      assertHookCleanupIdle()
      instance = terminalManager.create({
        id,
        workspaceId,
        cwd,
        shell,
        program: launchProgramResolved?.command,
        programArgs,
        cols: typeof cols === 'number' ? cols : undefined,
        rows: typeof rows === 'number' ? rows : undefined,
        env: {
          ...hookEnv,
          ...(recoveryEnv?.claudeConfigDir ? { CLAUDE_CONFIG_DIR: recoveryEnv.claudeConfigDir } : {}),
          ...(recoveryEnv?.codexHome ? { CODEX_HOME: recoveryEnv.codexHome } : {}),
        },
      }, office.pathDir)
      logTerminalDiagnostic('terminal launch timing', {
        id, engine, preparationMs, baselineMs,
        totalMs: Math.round(performance.now() - launchStartedAt),
      })
      if (engine === 'codex') {
        serviceErrorDetectors.set(id, createTerminalServiceErrorDetector())
      } else {
        serviceErrorDetectors.delete(id)
      }
    } catch (err) {
      logTerminalDiagnostic('terminal create failed', {
        id,
        workspaceId,
        cwd,
        shell,
        preset,
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      })
      // Release the creation lock stub so a later retry is not blocked.
      turnChangeTracker.unregister(id)
      forgetTerminalState(id)
      throw err
    }

    try {
    // Hook/turn/runner registries cover every agent CLI: janus emits from its
    // own binary, pi via the JanusX-owned --extension flag (see below).
    if (engine !== 'shell') {
      hookCoordinator.registerTerminal({
        terminalId: id,
        engine,
        workspaceId,
        cwd,
      })
      companionSessionState.registerTerminal({
        terminalId: id,
        engine,
        workspaceId,
        cwd,
      })
      agentTurnRecorder.registerTerminal({
        terminalId: id,
        engine,
        workspaceId,
        cwd,
      })

      subAgentRunRegistry.upsertRun({
        id: `terminal:${id}`,
        terminalId: id,
        rootRunId: `terminal:${id}`,
        rootTerminalId: id,
        missionId: id,
        workspaceId,
        workspacePath: cwd,
        source: 'terminal',
        engine: engine as SubAgentRunEngine,
        role: 'main',
        status: 'running',
        title: `${engine} terminal`,
        lastEvent: 'Terminal session started',
      })
    }

    terminalStates.set(id, {
      cwd,
      workspaceId,
      engine,
      creationLocked: false,
      flowStatus: 'wait',
      flowTimer: null,
      lastDataAt: 0,
      hookStatus: undefined,
    })

    // Agent terminals own a stable session; shell terminals stay ephemeral.
    if (engine !== 'shell') {
      agentSessionRegistry.createSession({
        terminalId: id,
        workspaceId,
        engine,
        cwd,
        shell,
        preset,
        command,
        args,
      })
    }

    // AC5/AC6: capture the pid of the pty we are about to register callbacks
    // on. If this terminal is later replaced by a new pty with the same id
    // (AC5 cleanup path), the old pty's native onData/onExit callbacks can
    // still fire asynchronously and would otherwise mutate the new terminal's
    // state (Vector A/E). The guard skips stale callbacks whose pty no longer
    // matches the current instance for this id.
    const registeredPid = instance.pty.pid
    const colorQueryResponder = engine === 'codex'
      ? createTerminalColorQueryResponder(() => configService.getCachedTheme())
      : null

    // PTY output: keep a bounded replay buffer so remounted terminals can recover
    // after workspace switches, then forward live data to the renderer.
    let firstOutputReceived = false
    instance.pty.onData((data: string) => {
      // AC3: isolate native pty callback exceptions so a single terminal's
      // failure cannot crash the main process or other terminals.
      try {
        // AC5: skip stale callbacks from a replaced pty.
        const current = terminalManager.getInstance(id)
        if (current && current.pty.pid !== registeredPid) return

        if (!firstOutputReceived && data.length > 0) {
          firstOutputReceived = true
          logTerminalDiagnostic('terminal first output', {
            id, engine, totalMs: Math.round(performance.now() - launchStartedAt),
          })
        }

        const colorQueryResponse = colorQueryResponder?.push(data)
        if (colorQueryResponse) {
          terminalManager.write(id, colorQueryResponse)
        }

        if (hookCoordinator.hasActiveTurn(id)) {
          const serviceError = serviceErrorDetectors.get(id)?.push(data)
          if (serviceError) {
            ingestHookPayload({
              source: 'codex',
              event: JANUSX_SYNTHETIC_HOOK_EVENTS.apiError,
              terminalId: id,
              message: serviceError,
              timestamp: new Date().toISOString(),
            })
          }
        }

        const seq = terminalManager.appendOutput(id, data)
        // kill 后窗口期实例已移除，appendOutput 返回 null：跳过转发，避免 seq undefined 的乱序数据。
        if (seq === null) return
        queueTerminalData(id, data, seq)
        // Hook-free attribution input: pty activity is the correlation signal
        // for binding this terminal to its native session file.
        terminalContextCoordinator.noteTerminalActivity(id, Date.now())

        // PTY output includes user input echo, prompt redraws and ANSI repaint
        // sequences. It is deliberately not used to infer AI activity.
      } catch (err) {
        console.error(`[terminal ${id}] onData error:`, err)
      }
    })

    // Terminal exit releases lifecycle state.
    instance.pty.onExit(({ exitCode }: { exitCode: number }) => {
      // AC3: isolate onExit callback exceptions; a throw here must not crash
      // the main process or leave the terminal in a half-cleaned state.
      try {
        // AC5: if this onExit is from a replaced pty (a new pty with the same
        // id now lives in the manager), skip all cleanup — the new terminal
        // owns the state now. A missing instance means the pty was killed
        // without replacement (user close / shutdown), so cleanup proceeds.
        const current = terminalManager.getInstance(id)
        if (current && current.pty.pid !== registeredPid) return

        // I-3 [P2] AC5: a replacement create is in flight (pre-stub locked).
        // The old pty's onExit was scheduled asynchronously by the AC5
        // kill-old step and can fire during the new create's `await
        // Promise.all` window, after the pre-stub state has been set but
        // before the new pty is spawned (getInstance is undefined in this
        // gap, so the registeredPid guard above does not return). Skip
        // cleanup so the new create's pre-stub state (incl. creationLocked)
        // is not deleted out from under it — otherwise AC6's lock is
        // dropped early and a concurrent same-id create can race
        // terminal lifecycle preparation (Vector B/F). This also subsumes
        // the I-4 double-finishRun noise: the early return skips the
        // stale finishRun call entirely.
        const state0 = terminalStates.get(id)
        if (state0?.creationLocked) return

        // Turn-end reconciliation: a pty death with a turn still open means no
        // completion hook will ever arrive. Route a synthetic end through the
        // hook pipeline before teardown so sidebar status and desktop
        // notification both settle. JanusX-initiated kills and app shutdown
        // are user actions: correct silently instead of raising a failure toast.
        if (state0 && state0.engine !== 'shell' && hookCoordinator.hasActiveTurn(id)) {
          const silent = state0.userKillRequested === true || appShutdown.isQuitting
          ingestHookPayload({
            source: state0.engine as AgentHookSource,
            event: silent
              ? JANUSX_SYNTHETIC_HOOK_EVENTS.interrupted
              : JANUSX_SYNTHETIC_HOOK_EVENTS.orphaned,
            terminalId: id,
            message: silent
              ? undefined
              : `${state0.engine} process exited (code ${exitCode}) while a turn was still running`,
            timestamp: new Date().toISOString(),
          })
        }

        flushTerminalData(id)
        sendToRenderer(getMainWindow(), TERMINAL_EVENT_CHANNELS.exit, { id, exitCode })
        terminalManager.kill(id)

        const state = terminalStates.get(id)
        if (state?.flowTimer) {
          clearTimeout(state.flowTimer)
          state.flowTimer = null
        }
        if (state?.engine && state.engine !== 'shell') {
          subAgentRunRegistry.finishRun(
            `terminal:${id}`,
            exitCode === 0 ? 'done' : 'failed',
            exitCode === 0 ? 'Terminal completed' : `Terminal exited with code ${exitCode}`
          )
        }
        forgetTerminalState(id)
        turnChangeTracker.unregister(id)
        serviceErrorDetectors.delete(id)
        clearHandoffDeliveryForTerminal(id)
        companionSessionState.unregisterTerminal(id)
        hookCoordinator.unregisterTerminal(id)
        agentTurnRecorder.unregisterTerminal(id)
        agentSessionRegistry.detachTerminal(id)
        void terminalContextCoordinator.releaseTerminal(id)
      } catch (err) {
        console.error(`[terminal ${id}] onExit error:`, err)
        // Best-effort cleanup so a partial failure does not leak state.
        try { forgetTerminalState(id) } catch {}
        turnChangeTracker.unregister(id)
        try { serviceErrorDetectors.delete(id) } catch {}
        try { clearHandoffDeliveryForTerminal(id) } catch {}
        try { companionSessionState.unregisterTerminal(id) } catch {}
        try { hookCoordinator.unregisterTerminal(id) } catch {}
        try { agentTurnRecorder.unregisterTerminal(id) } catch {}
        try { agentSessionRegistry.detachTerminal(id) } catch {}
        void terminalContextCoordinator.releaseTerminal(id)
      }
    })


    terminalContextCoordinator.trackTerminal(id, engine, cwd, telemetry => {
      sendToRenderer(getMainWindow(), TERMINAL_EVENT_CHANNELS.telemetry, { id, telemetry })
    }, recoveryEnv?.codexHome)
    // Hook-free attribution: bind this terminal to its native session as soon
    // as its first pty output lands, without waiting for the poll cadence.
    void terminalContextCoordinator.runAttributionPass().catch(() => undefined)
    sendToRenderer(getMainWindow(), TERMINAL_EVENT_CHANNELS.created, {
      id, workspaceId, cwd, preset: engine, shell, pid: instance.pty.pid,
    })
    return { pid: instance.pty.pid }
    } catch (error) {
      rollbackTerminalCreation({
        clearState: () => {
          turnChangeTracker.unregister(id)
          forgetTerminalState(id)
          serviceErrorDetectors.delete(id)
          clearHandoffDeliveryForTerminal(id)
          // Discard, not detach: a create that never came up must not leave a
          // live-looking session card pointing at a terminal that does not exist.
          agentSessionRegistry.discardTerminal(id)
        },
        unregisterCompanion: () => companionSessionState.unregisterTerminal(id),
        unregisterHook: () => hookCoordinator.unregisterTerminal(id),
        unregisterRecorder: () => agentTurnRecorder.unregisterTerminal(id),
        unregisterTelemetry: () => terminalContextCoordinator.unbindTerminal(id),
        removeRun: () => subAgentRunRegistry.removeRun(`terminal:${id}`),
        killPty: () => terminalManager.kill(id),
      })
      throw error
    }
  }
  // Provider-native resume shared by internal and external Claude/Codex/Opencode.
  // See .agents/notes/sessions/records/session-resume-detail.md
  // rows with a resumable id: the recorded engine preset starts in the recorded
  // cwd with the resume argv appended, so hook wiring follows the engine and
  // turns track live from the resume point. A failed spawn archives the new
  // row instead of leaving a ghost card.
  const spawnResumeTerminal = async (
    source: AgentSessionRecord,
    resumeArgs: string[],
    shell: string,
    workspaceIdFallback?: string,
  ): Promise<{ sessionId: string; terminalId: string }> => {
    const prepared = isNativeResumeEngine(source.engine) ? await prepareSessionRecovery(source) : undefined
    const preset = isTerminalPreset(source.engine) ? source.engine : undefined
    // External rows carry no workspace of their own; without a fallback the
    // created terminal lands in an empty workspace snapshot and never shows.
    const workspaceId = source.workspaceId || workspaceIdFallback || ''
    const terminalId = randomUUID()
    const record = agentSessionRegistry.createSession({
      terminalId,
      workspaceId,
      engine: source.engine,
      cwd: source.cwd,
      shell,
      preset,
      branch: source.branch,
      providerSessionId: source.providerSessionId,
      transcriptPath: prepared?.transcriptPath ?? source.transcriptPath,
      continuedFrom: source.id,
      historyFrom: prepared ? source.id : undefined,
    })
    try {
      await createTerminalLifecycle({
        id: terminalId,
        workspaceId: workspaceId || undefined,
        cwd: source.cwd,
        shell,
        preset,
        // 普通终端沿用记录里的启动行：continue 不会把旧终端换成当前默认 shell。
        ...(preset === 'shell' ? { shellCommand: shell } : {}),
        extraArgs: resumeArgs,
      }, prepared?.environment)
    } catch (err) {
      agentSessionRegistry.discardTerminal(terminalId)
      throw err
    }
    return { sessionId: record.id, terminalId }
  }
  companionTerminalCreator = createTerminalLifecycle
  continueSessionImpl = async (sessionId, opts) => {
    const source = agentSessionRegistry.getSession(sessionId)
    if (!source) throw new Error(`Session not found: ${sessionId}`)
    if (parseRuntimeResource(source.cwd)) {
      if (opts?.engine && opts.engine !== source.engine) throw new Error('Remote session resume must use its original provider')
      const resource = (await resolveRuntimeResource(source.cwd))!
      const terminals = await runtimeRequest<Array<{ id: string; exitCode: number | null }>>(resource.runtime, 'terminal.list', { workspaceId: resource.workspaceId })
      const live = terminals.find(terminal => source.terminalIds.includes(terminal.id) && terminal.exitCode === null)
      if (live) {
        await createRemoteLifecycle({ id: live.id, workspaceId: resource.workspaceId, cwd: source.cwd, shell: '/bin/sh', preset: isTerminalPreset(source.engine) ? source.engine : 'shell', attachOnly: true })
        return { sessionId: source.id, terminalId: live.id }
      }
      const resume = await remoteBackendRequest<{ args: string[]; cwd: string; engine: string; command: string }>(source.cwd, 'session.resume', [`${source.engine}:${source.providerSessionId}`])
      const terminalId = randomUUID()
      const preset = isTerminalPreset(source.engine) ? source.engine : undefined
      const record = agentSessionRegistry.createSession({ terminalId, workspaceId: resource.workspaceId,
        cwd: source.cwd, engine: source.engine, preset, shell: '/bin/sh', providerSessionId: source.providerSessionId,
        transcriptPath: source.transcriptPath, continuedFrom: source.id, historyFrom: source.id })
      try {
        await createRemoteLifecycle({ id: terminalId, workspaceId: resource.workspaceId, cwd: source.cwd, shell: '/bin/sh',
          preset, command: resume.command, args: resume.args })
      } catch (error) { agentSessionRegistry.discardTerminal(terminalId); throw error }
      return { sessionId: record.id, terminalId }
    }
    const explicitResume = opts?.mode === 'resume' || (source.external === true && opts?.mode !== 'continue')
    if (explicitResume) {
      if (opts?.engine && opts.engine !== source.engine) throw new Error('Resume cannot change the session engine')
      const resumeArgs = buildProviderResumeArgs(source.engine, source.providerSessionId, source.transcriptPath)
      if (!resumeArgs) {
        throw new Error(`Native resume is unavailable for this ${source.engine} session; its original history identity is missing`)
      }
      return spawnResumeTerminal(source, resumeArgs, source.shell ?? getDefaultShellCommand(), opts?.workspaceId)
    }
    const nativeResumeArgs = buildContinueResumeArgs(source, opts?.engine)
    if (nativeResumeArgs) {
      return spawnResumeTerminal(source, nativeResumeArgs, source.shell ?? getDefaultShellCommand(), opts?.workspaceId)
    }
    const engine = (opts?.engine ?? source.engine) as CheckpointEngine
    // External rows carry no shell capture: their terminals were never ours.
    const shell = source.external === true ? (source.shell ?? getDefaultShellCommand()) : source.shell
    if (!shell) {
      throw new Error('Session predates shell capture; open a terminal manually')
    }
    // Imported rows carry no preset; without the engine fallback the spawn
    // resolves to a bare shell and the new session gets no claude/codex CLI.
    const preset = isTerminalPreset(engine) ? engine : source.preset
    const workspaceId = source.workspaceId || opts?.workspaceId || ''
    const terminalId = randomUUID()
    const record = agentSessionRegistry.createSession({
      terminalId,
      workspaceId,
      engine,
      cwd: source.cwd,
      shell,
      preset,
      command: source.command,
      args: source.args,
      branch: source.branch,
      continuedFrom: source.id,
      // A handoff is a new provider conversation; borrowing the old identity
      // would make transcript reads and scanner dedup target the wrong one.
    })
    try {
      await createTerminalLifecycle({
        id: terminalId,
        workspaceId: workspaceId || undefined,
        cwd: source.cwd,
        shell,
        preset,
        command: source.command,
        args: source.args,
      })
    } catch (err) {
      agentSessionRegistry.discardTerminal(terminalId)
      throw err
    }
    const handoff = buildContinueHandoff(source)
    agentSessionRegistry.setPendingHandoff(record.id, handoff)
    const delivery: { cancelled: boolean } = { cancelled: false }
    handoffDeliveries.set(record.id, delivery)
    // Fire and forget: the panel reads the verdict off the record, and a dead
    // terminal at any point leaves the handoff there for manual resend.
    void deliverHandoff({ transport: buildHandoffTransport(terminalId), handoff })
      .then(({ verdict, reason }) => {
        if (delivery.cancelled) return
        handoffDeliveries.delete(record.id)
        if (verdict === 'delivered') {
          agentSessionRegistry.notePrompt(terminalId, handoff)
          recordSubmittedPrompt(terminalId, handoff)
          agentSessionRegistry.setPendingHandoff(record.id, undefined)
          return
        }
        // Nothing usable landed, or it landed somewhere unseen: keep the
        // handoff and say which happened so the card can offer a resend.
        agentSessionRegistry.setPendingHandoff(record.id, handoff, verdict)
        console.error(`[sessions] handoff ${verdict}${reason ? `: ${reason}` : ''}`)
      })
      .catch((err) => {
        if (delivery.cancelled) return
        handoffDeliveries.delete(record.id)
        agentSessionRegistry.setPendingHandoff(record.id, handoff, 'failed')
        console.error('[sessions] handoff delivery failed:', err)
      })
    return { sessionId: record.id, terminalId }
  }
  ipcMain.handle(TERMINAL_INVOKE_CHANNELS.create, async (_event, config: TerminalCreateRequest) => (
    createTerminalLifecycle(config)
  ))

  // Ctrl+C ends the active turn without exiting the interactive CLI process.
  ipcMain.on(TERMINAL_SEND_CHANNELS.input, (_event, { id, data }: TerminalInputPayload) => {
    const state = terminalStates.get(id)
    if (state && state.engine !== 'shell' && isTerminalInterrupt(data) && hookCoordinator.hasActiveTurn(id)) {
      ingestHookPayload({
        source: state.engine as AgentHookSource,
        event: JANUSX_SYNTHETIC_HOOK_EVENTS.interrupted,
        terminalId: id,
        timestamp: new Date().toISOString(),
      })
    }
    terminalManager.write(id, data)
  })

  // Submit-line handler: renderer sends one complete user input transaction.
  ipcMain.on(TERMINAL_SEND_CHANNELS.submitLine, (_event, { id, text }: TerminalSubmitLinePayload) => {
    recordSubmittedPrompt(id, text)
  })

  ipcMain.on(TERMINAL_SEND_CHANNELS.resize, (_event, { id, cols, rows }: TerminalResizePayload) => {
    terminalManager.resize(id, cols, rows)
  })

  ipcMain.handle(TERMINAL_INVOKE_CHANNELS.replay, async (_event, { id }: { id: string }) => {
    // 先把未 flush 的合批数据发出去再取快照，保证快照 seq 之后到达的事件不含快照内数据
    flushTerminalData(id)
    return terminalManager.getOutputReplay(id) ?? { data: '', seq: 0 }
  })

  ipcMain.handle(TERMINAL_INVOKE_CHANNELS.kill, async (_event, { id }: { id: string }) => {
    if (await terminalManager.endRemote(id)) {
      dropPendingTerminalData(id)
      return { success: true }
    }
    const st = terminalStates.get(id)
    if (st) {
      st.userKillRequested = true
      if (st.flowTimer) {
        clearTimeout(st.flowTimer)
        st.flowTimer = null
      }
    }
    dropPendingTerminalData(id)
    clearHandoffDeliveryForTerminal(id)
    turnChangeTracker.unregister(id)
    terminalManager.kill(id)
    return { success: true }
  })
}
