import { app } from 'electron'

export type ShutdownStep = () => void | Promise<void>

export interface AppShutdownDeps {
  stopPlugins?: ShutdownStep
  stopNoteReview?: ShutdownStep
  stopKnowledge?: ShutdownStep
  abortChatStreams?: ShutdownStep
  cancelAnalyzer?: ShutdownStep
  cancelBlueprintMaintenance?: ShutdownStep
  finalizePendingCheckpoints?: ShutdownStep
  flushAgentSessions?: ShutdownStep
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
}

export interface BeginQuitOptions {
  reason?: string
  timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 15000
const STEP_TIMEOUT_MS = 4000

/**
 * Single-flight app exit coordinator.
 * Never wipes checkpoint history (no clearAllLoaded).
 */
export class AppShutdown {
  private quitting = false
  private flight: Promise<void> | null = null
  private deps: AppShutdownDeps = {}

  get isQuitting(): boolean {
    return this.quitting
  }

  configure(partial: AppShutdownDeps): void {
    Object.assign(this.deps, partial)
  }

  beginQuit(options: BeginQuitOptions = {}): Promise<void> {
    if (this.flight) return this.flight
    this.quitting = true
    this.flight = this.execute(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, options.reason)
    return this.flight
  }

  private async execute(timeoutMs: number, reason?: string): Promise<void> {
    if (reason) {
      console.info(`[AppShutdown] beginQuit reason=${reason} timeoutMs=${timeoutMs}`)
    }

    let timedOut = false
    let forceTimer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<void>((resolve) => {
      forceTimer = setTimeout(() => {
        timedOut = true
        console.error('[AppShutdown] timeout reached, forcing exit')
        resolve()
      }, timeoutMs)
      forceTimer.unref?.()
    })

    try {
      await Promise.race([this.runSteps(), timeout])
    } catch (error) {
      console.error('[AppShutdown] unexpected failure:', error)
    } finally {
      if (forceTimer) clearTimeout(forceTimer)
      try {
        app.exit(timedOut ? 1 : 0)
      } catch (error) {
        console.error('[AppShutdown] app.exit failed:', error)
      }
    }
  }

  private async runSteps(): Promise<void> {
    // Order matters:
    // 1) kill keep-alive windows first (toast/editor)
    // 2) AC9: kill terminals BEFORE finalizing pending checkpoints so no native
    //    pty callback can fire sendToRenderer into a torn-down window during
    //    the finalize window. finalizeCheckpoint only touches workspace files
    //    and does not require a live pty.
    const ordered: Array<[keyof AppShutdownDeps, ShutdownStep | undefined]> = [
      ['stopPlugins', this.deps.stopPlugins],
      ['stopNoteReview', this.deps.stopNoteReview],
      ['stopKnowledge', this.deps.stopKnowledge],
      ['destroyToast', this.deps.destroyToast],
      ['closeEditors', this.deps.closeEditors],
      ['destroyBrowserSurfaces', this.deps.destroyBrowserSurfaces],
      ['abortChatStreams', this.deps.abortChatStreams],
      ['cancelAnalyzer', this.deps.cancelAnalyzer],
      ['cancelBlueprintMaintenance', this.deps.cancelBlueprintMaintenance],
      ['stopHookBridge', this.deps.stopHookBridge],
      ['stopCompanion', this.deps.stopCompanion],
      ['killTerminals', this.deps.killTerminals],
      ['stopRuntimeTelemetry', this.deps.stopRuntimeTelemetry],
      ['finalizePendingCheckpoints', this.deps.finalizePendingCheckpoints],
      ['flushAgentSessions', this.deps.flushAgentSessions],
      ['stopOfficeWatches', this.deps.stopOfficeWatches],
      ['killAgents', this.deps.killAgents],
      ['stopProjects', this.deps.stopProjects],
      ['disposeOfficeArtifactIndexes', this.deps.disposeOfficeArtifactIndexes],
      ['disposeWatchers', this.deps.disposeWatchers],
      ['disposeTerminalSession', this.deps.disposeTerminalSession],
    ]

    for (const [name, step] of ordered) {
      await this.runStep(name, step)
    }
  }

  private async runStep(name: string, step?: ShutdownStep): Promise<void> {
    if (!step) return

    let stepTimer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        Promise.resolve().then(step),
        new Promise<void>((_, reject) => {
          stepTimer = setTimeout(() => reject(new Error(`step timeout: ${name}`)), STEP_TIMEOUT_MS)
          stepTimer.unref?.()
        }),
      ])
    } catch (error) {
      console.error(`[AppShutdown] step "${name}" failed:`, error)
    } finally {
      if (stepTimer) clearTimeout(stepTimer)
    }
  }
}

export const appShutdown = new AppShutdown()
