import { app } from 'electron'
import { markApplicationQuitting } from './quit-state'
import { logShutdown } from './diagnostics'

export type ShutdownStep = () => void | Promise<void>

export interface AppShutdownDeps {
  stopAutomations?: ShutdownStep
  stopPlugins?: ShutdownStep
  stopNoteReview?: ShutdownStep
  stopKnowledge?: ShutdownStep
  abortChatStreams?: ShutdownStep
  cancelAnalyzer?: ShutdownStep
  cancelBlueprintMaintenance?: ShutdownStep
  flushAgentSessions?: ShutdownStep
  flushSuperAgentRecords?: ShutdownStep
  stopHookBridge?: ShutdownStep
  stopCompanion?: ShutdownStep
  killTerminals?: ShutdownStep
  stopRuntimeTelemetry?: ShutdownStep
  killAgents?: ShutdownStep
  stopProjects?: ShutdownStep
  stopOfficeWatches?: ShutdownStep
  disposeOfficeArtifactIndexes?: ShutdownStep
  disposeWatchers?: ShutdownStep
  destroyToast?: ShutdownStep
  closeEditors?: ShutdownStep
  destroyBrowserSurfaces?: ShutdownStep
  disposeTerminalSession?: ShutdownStep
  stopBrowserTerminalHost?: ShutdownStep
  disconnectWorkspaceTransports?: ShutdownStep
  stopMobileHost?: ShutdownStep
  forceProcesses?: ShutdownStep
}

export interface BeginQuitOptions {
  reason?: string
  timeoutMs?: number
}

// Packaged Windows capture, durable receipt and native verification can exceed
// 12 seconds under mixed load. Leave 3 seconds for escalation within this bound.
const DEFAULT_TIMEOUT_MS = 20000
const STEP_TIMEOUT_MS = 4000

/**
 * Single-flight app exit coordinator.
 * Never wipes checkpoint history (no clearAllLoaded).
 */
export class AppShutdown {
  private quitting = false
  private flight: Promise<void> | null = null
  private deps: AppShutdownDeps = {}
  private failed = false
  private finished = false

  get isQuitting(): boolean {
    return this.quitting
  }

  configure(partial: AppShutdownDeps): void {
    Object.assign(this.deps, partial)
  }

  requestQuit(): boolean {
    if (this.quitting) return false
    this.quitting = true
    markApplicationQuitting()
    logShutdown('requested')
    return true
  }

  beginQuit(options: BeginQuitOptions = {}): Promise<void> {
    if (this.flight) return this.flight
    this.requestQuit()
    this.flight = this.execute(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, options.reason)
    return this.flight
  }

  private async execute(timeoutMs: number, reason?: string): Promise<void> {
    logShutdown('begin', { reason, timeoutMs })

    let timedOut = false
    let forceTimer: ReturnType<typeof setTimeout> | undefined
    let escalationTimer: ReturnType<typeof setTimeout> | undefined
    let escalation: Promise<void> | undefined
    const force = () => escalation ??= this.runStep('forceProcesses', this.deps.forceProcesses, 3000)
    if (this.deps.forceProcesses) {
      escalationTimer = setTimeout(() => { void force() }, Math.max(0, timeoutMs - 3000))
      escalationTimer.unref?.()
    }
    const timeout = new Promise<void>((resolve) => {
      forceTimer = setTimeout(() => {
        timedOut = true
        logShutdown('deadline', { timeoutMs })
        resolve()
      }, timeoutMs)
      forceTimer.unref?.()
    })

    try {
      const cleanup = this.runSteps().then(async () => {
        if (this.failed || escalation) await force()
      })
      await Promise.race([cleanup, timeout])
    } catch (error) {
      this.failed = true
      console.error('[AppShutdown] unexpected failure:', error)
    } finally {
      if (forceTimer) clearTimeout(forceTimer)
      if (escalationTimer) clearTimeout(escalationTimer)
      this.finished = true
      try {
        const code = timedOut || this.failed ? 1 : 0
        logShutdown('exit', { code, timedOut, failed: this.failed })
        app.exit(code)
      } catch (error) {
        console.error('[AppShutdown] app.exit failed:', error)
      }
    }
  }

  private async runSteps(): Promise<void> {
    // Note: .agents/notes/desktop/application-shutdown.md
    // Start every independent stop before waiting. A slow worker/plugin must not
    // consume the entire exit deadline before terminals or Office receive a stop.
    const ordered: Array<[keyof AppShutdownDeps, ShutdownStep | undefined]> = [
      ['destroyToast', this.deps.destroyToast],
      ['closeEditors', this.deps.closeEditors],
      ['abortChatStreams', this.deps.abortChatStreams],
      ['flushSuperAgentRecords', this.deps.flushSuperAgentRecords],
      ['stopAutomations', this.deps.stopAutomations],
      ['stopPlugins', this.deps.stopPlugins],
      ['stopNoteReview', this.deps.stopNoteReview],
      ['stopKnowledge', this.deps.stopKnowledge],
      ['destroyBrowserSurfaces', this.deps.destroyBrowserSurfaces],
      ['cancelAnalyzer', this.deps.cancelAnalyzer],
      ['cancelBlueprintMaintenance', this.deps.cancelBlueprintMaintenance],
      ['stopHookBridge', this.deps.stopHookBridge],
      ['stopCompanion', this.deps.stopCompanion],
      ['killTerminals', this.deps.killTerminals],
      ['stopOfficeWatches', this.deps.stopOfficeWatches],
      ['killAgents', this.deps.killAgents],
      ['stopProjects', this.deps.stopProjects],
      ['stopBrowserTerminalHost', this.deps.stopBrowserTerminalHost],
      ['disconnectWorkspaceTransports', this.deps.disconnectWorkspaceTransports],
      ['stopMobileHost', this.deps.stopMobileHost],
    ]
    const stops = new Map(ordered.map(([name, step]) => [name, this.runStep(name, step)]))
    const sessions = stops.get('killTerminals')!.then(async () => {
      await this.runStep('stopRuntimeTelemetry', this.deps.stopRuntimeTelemetry)
      await this.runStep('flushAgentSessions', this.deps.flushAgentSessions)
      await this.runStep('disposeTerminalSession', this.deps.disposeTerminalSession)
    })
    const indexes = stops.get('stopOfficeWatches')!.then(async () => {
      await this.runStep('disposeOfficeArtifactIndexes', this.deps.disposeOfficeArtifactIndexes)
      await this.runStep('disposeWatchers', this.deps.disposeWatchers)
    })
    await Promise.all([...stops.values(), sessions, indexes])
  }

  private async runStep(name: string, step?: ShutdownStep, timeoutMs?: number): Promise<void> {
    if (!step || this.finished) return
    const started = Date.now()
    const processSteps = ['flushSuperAgentRecords', 'killTerminals', 'killAgents', 'stopProjects']
    logShutdown('step-start', { step: name })

    let stepTimer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        Promise.resolve().then(step),
        new Promise<void>((_, reject) => {
          stepTimer = setTimeout(() => reject(new Error(`step timeout: ${name}`)), timeoutMs ?? (processSteps.includes(name) ? 17_000 : STEP_TIMEOUT_MS))
          stepTimer.unref?.()
        }),
      ])
      logShutdown('step-complete', { step: name, elapsedMs: Date.now() - started })
    } catch (error) {
      this.failed = true
      logShutdown('step-failed', { step: name, elapsedMs: Date.now() - started, errorType: error instanceof Error ? error.name : 'UnknownError' })
      console.error(`[AppShutdown] step "${name}" failed:`, error)
    } finally {
      if (stepTimer) clearTimeout(stepTimer)
    }
  }
}

export const appShutdown = new AppShutdown()
