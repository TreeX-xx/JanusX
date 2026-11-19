// Note: console configuration matching the reference terminal — see .agents/notes/terminal/ime-candidate-drift.md
import { spawnLocalPty, normalizePtyDimension, DEFAULT_COLS, DEFAULT_ROWS, MAX_COLS, MAX_ROWS } from './pty-driver'
import { assertLocalLaunch, localRuntimeContext } from '../platform/runtime-context'
import { stopProcessTree } from '../shutdown/process-tree'
import { assertApplicationRunning } from '../shutdown/quit-state'
import type { TerminalConfig, TerminalInstance } from './types'
import { logTerminalDiagnostic } from './diagnostics'
import { EventEmitter } from 'node:events'

export const terminalOutputEvents = new EventEmitter()

const TERMINAL_OUTPUT_BUFFER_LIMIT = 1_000_000

export class TerminalManager {
  private instances = new Map<string, TerminalInstance>()

  adopt(instance: TerminalInstance): void {
    assertApplicationRunning()
    if (this.instances.has(instance.id)) throw new Error('Terminal is already attached')
    this.instances.set(instance.id, instance)
  }

  detach(id: string): void {
    const instance = this.instances.get(id)
    if (!instance?.remote) return
    instance.remote.detach()
    this.instances.delete(id)
  }

  async endRemote(id: string): Promise<boolean> {
    const instance = this.instances.get(id)
    if (!instance?.remote) return false
    await instance.remote.end()
    this.detach(id)
    return true
  }

  create(config: TerminalConfig, officecliPathDir?: string): TerminalInstance {
    assertApplicationRunning()
    const shell = config.shell || localRuntimeContext().shell
    if (config.launch) assertLocalLaunch(config.launch, localRuntimeContext())
    const file = config.launch?.program || config.program || shell
    const args = config.launch?.args ?? (config.program ? (config.programArgs ?? []) : [])
    if (config.launch) config = { ...config, cwd: config.launch.cwd ?? config.cwd, env: config.launch.env as Record<string, string> }
    const cols = normalizePtyDimension(config.cols, DEFAULT_COLS, 2, MAX_COLS)
    const rows = normalizePtyDimension(config.rows, DEFAULT_ROWS, 1, MAX_ROWS)

    // AC5: if a previous instance with the same id still lives, kill it before
    // spawning the replacement so the old onExit callback cannot target the
    // new pty and the old pty does not leak (Vector A/E).
    const existing = this.instances.get(config.id)
    if (existing) {
      if (existing.remote) throw new Error('A remote terminal cannot be replaced by a local process')
      this.releaseRuntime(existing)
      this.stopPty(existing)
      this.instances.delete(config.id)
    }

    const pty = spawnLocalPty(file, args, { ...config, shell, cols, rows }, officecliPathDir)

    const instance: TerminalInstance = {
      id: config.id,
      pty,
      config: { ...config, shell, cols, rows },
      status: 'running',
      createdAt: Date.now(),
      outputBuffer: '',
      outputSeq: 0,
      lastCols: cols,
      lastRows: rows,
    }

    this.instances.set(config.id, instance)
    return instance
  }

  write(id: string, data: string): void {
    const instance = this.instances.get(id)
    if (instance && typeof data === 'string' && data.length > 0) {
      try {
        instance.pty.write(data)
      } catch (error) {
        logTerminalDiagnostic('pty write failed', {
          id,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
  }

  resize(id: string, cols: number, rows: number): void {
    const instance = this.instances.get(id)
    if (!instance) return

    if (!Number.isFinite(cols) || !Number.isFinite(rows)) {
      logTerminalDiagnostic('pty resize rejected', { id, cols, rows })
      return
    }

    const nextCols = normalizePtyDimension(cols, DEFAULT_COLS, 2, MAX_COLS)
    const nextRows = normalizePtyDimension(rows, DEFAULT_ROWS, 1, MAX_ROWS)
    if (instance.lastCols === nextCols && instance.lastRows === nextRows) {
      return
    }

    try {
      instance.pty.resize(nextCols, nextRows)
      instance.lastCols = nextCols
      instance.lastRows = nextRows
    } catch (error) {
      logTerminalDiagnostic('pty resize failed', {
        id,
        cols: nextCols,
        rows: nextRows,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  appendOutput(id: string, data: string): number | null {
    const instance = this.instances.get(id)
    if (!instance) return null

    instance.outputSeq += 1
    instance.outputBuffer += data
    if (instance.outputBuffer.length > TERMINAL_OUTPUT_BUFFER_LIMIT) {
      instance.outputBuffer = instance.outputBuffer.slice(-TERMINAL_OUTPUT_BUFFER_LIMIT)
    }
    terminalOutputEvents.emit('data', id, data, instance.outputSeq)
    return instance.outputSeq
  }

  getOutputReplay(id: string): { data: string; seq: number } | null {
    const instance = this.instances.get(id)
    if (!instance) return null
    return {
      data: instance.outputBuffer,
      seq: instance.outputSeq,
    }
  }

  kill(id: string): void {
    const instance = this.instances.get(id)
    if (instance) {
      if (instance.remote) {
        void this.endRemote(id).catch(error => logTerminalDiagnostic('remote terminal end failed', { id, error: String(error) }))
        return
      }
      this.releaseRuntime(instance)
      this.stopPty(instance)
      instance.status = 'exited'
      this.instances.delete(id)
    }
  }

  /** All owned runtime and PTY stops are awaited by shutdown. */
  private pendingKillers = new Set<Promise<void>>()
  private cleanupErrors: unknown[] = []

  private trackStop(operation: Promise<void>): void {
    const pending = operation.catch(error => {
      this.cleanupErrors.push(error)
      logTerminalDiagnostic('owned process cleanup failed', { error: String(error) })
    })
    this.pendingKillers.add(pending)
    void pending.finally(() => this.pendingKillers.delete(pending))
  }

  private releaseRuntime(instance: TerminalInstance): void {
    const dispose = instance.disposeRuntime
    instance.disposeRuntime = undefined
    if (dispose) this.trackStop(Promise.resolve().then(dispose))
  }

  /**
   * 先确认自有进程树停止，再释放 PTY，避免父进程先消失而丢失子进程。
   * 返回 Promise 以便 shutdown 路径等待 killer 完成，保证「先杀终端再 finalize
   * checkpoint」的顺序真正成立（audit C7）。失败静默。
   */
  private stopPty(instance: TerminalInstance): void {
    const done = stopProcessTree(instance.pty, { processGroup: true }).finally(() => {
      // Dispose the native console only after capturing/terminating its tree.
      try { instance.pty.kill() } catch { /* Console may already be closed. */ }
    })
    this.trackStop(done)
  }

  killByWorkspace(workspaceId: string): void {
    if (!workspaceId) return
    const targets = Array.from(this.instances.values())
      .filter(instance => instance.config.workspaceId === workspaceId)
      .map(instance => instance.id)
    for (const id of targets) {
      this.kill(id)
    }
  }

  /** 同步发起全部停止；等待原生运行时和自有进程树的退出确认。 */
  killAll(): Promise<void> {
    for (const [id] of this.instances) {
      if (this.instances.get(id)?.remote) this.detach(id)
      else this.kill(id)
    }
    return Promise.all([...this.pendingKillers]).then(() => {
      const errors = this.cleanupErrors.splice(0)
      if (errors.length) throw new AggregateError(errors, 'Terminal cleanup has unconfirmed outcomes')
    })
  }

  getInstance(id: string): TerminalInstance | undefined {
    return this.instances.get(id)
  }

  listInstances(): TerminalInstance[] {
    return Array.from(this.instances.values())
  }
}

export const terminalManager = new TerminalManager()
