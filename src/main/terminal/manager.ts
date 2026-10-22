// Note: console configuration matching the reference terminal — see .agents/notes/terminal/ime-candidate-drift.md
import { spawn, type IPty } from 'node-pty'
import { spawn as spawnProcess } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { delimiter, dirname, join } from 'node:path'
import type { TerminalConfig, TerminalInstance } from './types'
import { logTerminalDiagnostic } from './diagnostics'
import { EventEmitter } from 'node:events'

export const terminalOutputEvents = new EventEmitter()

const require = createRequire(import.meta.url)
const CONPTY_FILES = ['conpty.dll', 'OpenConsole.exe'] as const
const TERMINAL_OUTPUT_BUFFER_LIMIT = 1_000_000
const DEFAULT_COLS = 120
const DEFAULT_ROWS = 40
const MAX_COLS = 1_000
const MAX_ROWS = 1_000

function normalizePtyDimension(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(maximum, Math.max(minimum, Math.floor(value)))
}

function withPathPrepend(env: Record<string, string>, directory?: string): Record<string, string> {
  if (!directory) return env
  const pathKey = Object.keys(env).find(key => key.toLowerCase() === 'path') ?? 'PATH'
  return {
    ...env,
    [pathKey]: env[pathKey] ? `${directory}${delimiter}${env[pathKey]}` : directory,
  }
}

function findConptySourceDir(packageRoot: string): string | null {
  const prebuildDir = join(packageRoot, 'prebuilds', `${process.platform}-${process.arch}`, 'conpty')
  if (CONPTY_FILES.every(file => existsSync(join(prebuildDir, file)))) {
    return prebuildDir
  }

  const thirdPartyRoot = join(packageRoot, 'third_party', 'conpty')
  if (!existsSync(thirdPartyRoot)) return null

  const archDir = process.arch === 'arm64' ? 'win10-arm64' : 'win10-x64'
  for (const version of readdirSync(thirdPartyRoot)) {
    const candidate = join(thirdPartyRoot, version, archDir)
    if (CONPTY_FILES.every(file => existsSync(join(candidate, file)))) {
      return candidate
    }
  }

  return null
}

function hasBundledConptyFiles(): boolean {
  if (process.platform !== 'win32') return false

  const packageRoot = dirname(require.resolve('node-pty/package.json'))
  const sourceDir = findConptySourceDir(packageRoot)
  if (sourceDir) {
    logTerminalDiagnostic('conpty source ready', { packageRoot, sourceDir })
    return true
  }

  const destDir = join(packageRoot, 'build', 'Release', 'conpty')

  if (CONPTY_FILES.every(file => existsSync(join(destDir, file)))) {
    logTerminalDiagnostic('conpty build release ready', { packageRoot, destDir })
    return true
  }

  logTerminalDiagnostic('conpty files missing', { packageRoot, destDir })
  return false
}

export class TerminalManager {
  private instances = new Map<string, TerminalInstance>()

  private spawnPty(
    file: string,
    args: string[],
    config: TerminalConfig,
    officecliPathDir?: string,
  ): IPty {
    const useBundledConptyDll = hasBundledConptyFiles()
    const cols = normalizePtyDimension(config.cols, DEFAULT_COLS, 2, MAX_COLS)
    const rows = normalizePtyDimension(config.rows, DEFAULT_ROWS, 1, MAX_ROWS)

    const baseOptions = {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: config.cwd,
      env: withPathPrepend({
        ...(process.env as Record<string, string>),
        ...(config.env ?? {}),
        TERM: 'xterm-256color',
        TERM_PROGRAM: 'JanusX',
      }, officecliPathDir),
      /*-- 显式启用 ConPTY（build≥18309 默认开，显式更稳妥），Windows 有效，非 Windows 忽略 --*/
      useConpty: true,
    }

    try {
      const pty = spawn(file, args, {
        ...baseOptions,
        useConptyDll: useBundledConptyDll,
      })
      logTerminalDiagnostic('pty spawned', {
        id: config.id,
        cwd: config.cwd,
        file,
        args,
        cols,
        rows,
        useConptyDll: useBundledConptyDll,
        pid: pty.pid,
      })
      return pty
    } catch (err) {
      logTerminalDiagnostic('pty spawn failed', {
        id: config.id,
        cwd: config.cwd,
        file,
        args,
        useConptyDll: useBundledConptyDll,
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      })
      if (!useBundledConptyDll) throw err

      try {
        const fallbackPty = spawn(file, args, {
          ...baseOptions,
          useConptyDll: false,
        })
        logTerminalDiagnostic('pty spawned with system conpty fallback', {
          id: config.id,
          cwd: config.cwd,
          file,
          args,
          pid: fallbackPty.pid,
        })
        return fallbackPty
      } catch (fallbackErr) {
        logTerminalDiagnostic('pty system conpty fallback failed', {
          id: config.id,
          cwd: config.cwd,
          file,
          args,
          error: fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr),
          stack: fallbackErr instanceof Error ? fallbackErr.stack : undefined,
        })
        throw fallbackErr
      }
    }
  }

  create(config: TerminalConfig, officecliPathDir?: string): TerminalInstance {
    const shell = config.shell || (process.platform === 'win32' ? 'powershell.exe' : 'bash')
    const file = config.program || shell
    const args = config.program ? (config.programArgs ?? []) : []
    const cols = normalizePtyDimension(config.cols, DEFAULT_COLS, 2, MAX_COLS)
    const rows = normalizePtyDimension(config.rows, DEFAULT_ROWS, 1, MAX_ROWS)

    // AC5: if a previous instance with the same id still lives, kill it before
    // spawning the replacement so the old onExit callback cannot target the
    // new pty and the old pty does not leak (Vector A/E).
    const existing = this.instances.get(config.id)
    if (existing) {
      try {
        existing.pty.kill()
      } catch {
        // old pty may already be dead; ignore
      }
      this.killProcessTree(existing.pty.pid)
      this.instances.delete(config.id)
    }

    const pty = this.spawnPty(file, args, { ...config, shell, cols, rows }, officecliPathDir)

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
      const pid = instance.pty.pid
      try {
        instance.pty.kill()
      } catch {
        // 进程可能已退出
      }
      this.killProcessTree(pid)
      instance.status = 'exited'
      this.instances.delete(id)
    }
  }

  /** 在途的 taskkill 兜底进程；killAll 等待它们全部退出（audit C7）。 */
  private pendingKillers = new Set<Promise<void>>()

  /**
   * Windows 进程树兜底：pty.kill() 不保证回收子进程，taskkill /T 强制清理。
   * 返回 Promise 以便 shutdown 路径等待 killer 完成，保证「先杀终端再 finalize
   * checkpoint」的顺序真正成立（audit C7）。失败静默。
   */
  private killProcessTree(pid: number | undefined): Promise<void> {
    if (process.platform !== 'win32' || typeof pid !== 'number') return Promise.resolve()
    const done = new Promise<void>((resolve) => {
      try {
        const killer = spawnProcess('taskkill', ['/PID', String(pid), '/T', '/F'], {
          windowsHide: true,
          stdio: 'ignore',
        })
        killer.on('error', () => {
          // 兜底失败不得中断 kill 流程
          resolve()
        })
        killer.on('exit', () => resolve())
      } catch {
        // 兜底失败静默
        resolve()
      }
    })
    this.pendingKillers.add(done)
    void done.finally(() => this.pendingKillers.delete(done))
    return done
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

  /** 同步发起全部 kill；返回的 Promise 在所有 taskkill 兜底进程退出后 resolve。 */
  killAll(): Promise<void> {
    for (const [id] of this.instances) {
      this.kill(id)
    }
    return Promise.all([...this.pendingKillers]).then(() => undefined)
  }

  getInstance(id: string): TerminalInstance | undefined {
    return this.instances.get(id)
  }

  listInstances(): TerminalInstance[] {
    return Array.from(this.instances.values())
  }
}

export const terminalManager = new TerminalManager()
