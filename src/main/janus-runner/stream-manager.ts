import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import type { AgentEngine, AgentEvent, AgentSpawnOptions, StreamSession } from './types'
import { normalizeAgentApprovalMode } from '../../shared/ipc/agent-runtime'
import { resolveCLIPath } from './cli-resolver'
import { createParser } from './parsers'
import { stopProcessTree } from '../shutdown/process-tree'
import { assertApplicationRunning } from '../shutdown/quit-state'

const DEFAULT_TIMEOUT_MS = 120_000
const DEFAULT_MAX_CONCURRENCY = 3
/*-- stderr 缓冲上限：仅保留尾部 256KB，超出丢弃头部，避免异常进程刷屏无界增长 --*/
const MAX_STDERR_CHARS = 256 * 1024

type EventCallback = (event: AgentEvent) => void

interface QueuedTask {
  id: string
  run: () => Promise<void>
  reject: (err: Error) => void
}

export class AgentStreamManager {
  private sessions = new Map<string, StreamSession>()
  private listeners = new Map<string, Set<EventCallback>>()
  private queue: QueuedTask[] = []
  private running = 0
  private maxConcurrency: number
  private stopping = false
  private launching = new Set<string>()
  private cancelled = new Set<string>()
  private stops = new Set<Promise<void>>()
  private stopErrors: unknown[] = []

  constructor(opts?: { maxConcurrency?: number }) {
    this.maxConcurrency = opts?.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY
  }

  async start(options: AgentSpawnOptions): Promise<string> {
    return this.startWithId(randomUUID(), options)
  }

  async startWithId(id: string, options: AgentSpawnOptions): Promise<string> {
    assertApplicationRunning()
    if (this.stopping) throw new Error('Agent streams are stopping')
    // 重复 id 会覆盖旧 session 使其失去 cancel 句柄，直接拒绝
    if (this.sessions.has(id) || this.launching.has(id) || this.queue.some((task) => task.id === id)) {
      throw new Error(`Agent stream already exists: ${id}`)
    }
    return new Promise<string>((resolve, reject) => {
      const run = async () => {
        this.launching.add(id)
        try {
          await this.runTask(id, options)
          resolve(id)
        } catch (err) {
          this.running--
          this.sessions.delete(id)
          this.listeners.delete(id)
          this.drainQueue()
          reject(err)
        } finally {
          this.launching.delete(id)
          this.cancelled.delete(id)
        }
      }

      if (this.running >= this.maxConcurrency) {
        this.queue.push({ id, run, reject })
        return
      }
      this.running++
      void run()
    })
  }

  private async runTask(id: string, options: AgentSpawnOptions): Promise<void> {
    const cliPath = await resolveCLIPath(options.engine)
    assertApplicationRunning()
    if (this.stopping || this.cancelled.has(id)) throw new Error('Agent stream cancelled before spawn')
    if (!cliPath) {
      throw new Error(`CLI not found for engine: ${options.engine}`)
    }

    const args = this.buildArgs(options.engine, options.prompt, options.cwd, options.model, options.approvalMode)
    const abortController = new AbortController()
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS

    const proc = spawn(cliPath, args, {
      cwd: options.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
      detached: process.platform !== 'win32',
      windowsHide: true,
    })

    const parser = createParser(options.engine)
    const timeout = setTimeout(() => {
      this.emit(id, { type: 'error', message: `Timeout: exceeded ${timeoutMs}ms` })
      abortController.abort('timeout')
      this.killProcessTree(proc)
    }, timeoutMs)

    const session: StreamSession = {
      id, engine: options.engine, process: proc, parser,
      abortController, timeout, startedAt: new Date().toISOString(), status: 'running',
    }
    this.sessions.set(id, session)

    // Line buffering for stdout
    let buffer = ''
    proc.stdout!.on('data', (chunk: Buffer) => {
      if (abortController.signal.aborted) return
      buffer += chunk.toString()
      const lines = buffer.split('\n')
      buffer = lines.pop()!
      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const json = JSON.parse(line)
          for (const event of parser.parseLine(json)) {
            this.emit(id, event)
          }
        } catch { /* skip malformed lines */ }
      }
    })

    // Capture stderr
    let stderrBuffer = ''
    proc.stderr!.on('data', (chunk: Buffer) => {
      stderrBuffer += chunk.toString()
      if (stderrBuffer.length > MAX_STDERR_CHARS) {
        stderrBuffer = stderrBuffer.slice(-MAX_STDERR_CHARS)
      }
    })

    // Process close
    proc.on('close', (exitCode) => {
      clearTimeout(timeout)
      // Flush remaining buffer
      if (buffer.trim()) {
        try {
          const json = JSON.parse(buffer)
          for (const event of parser.parseLine(json)) {
            this.emit(id, event)
          }
        } catch { /* skip */ }
      }

      const status = abortController.signal.aborted
        ? (exitCode === null ? 'cancelled' as const : 'error' as const)
        : (exitCode === 0 ? 'done' as const : 'error' as const)

      session.status = status
      this.emit(id, { type: 'done', exitCode: exitCode ?? undefined })

      this.running--
      this.sessions.delete(id)
      this.listeners.delete(id)
      this.drainQueue()
    })

    proc.on('error', (err) => {
      if ((err as any).code === 'ABORT_ERR') return
      this.emit(id, { type: 'error', message: err.message })
    })
  }

  private buildArgs(engine: AgentEngine, prompt: string, cwd: string, model?: string, approvalMode?: AgentSpawnOptions['approvalMode']): string[] {
    const autoRun = normalizeAgentApprovalMode(approvalMode) === 'auto-run'
    switch (engine) {
      case 'claude':
        return ['-p', prompt, '--output-format', 'stream-json', '--include-partial-messages', '--verbose', '--no-session-persistence', '--permission-mode', autoRun ? 'bypassPermissions' : 'default']
      case 'codex':
        return ['exec', '--json', '--skip-git-repo-check', ...(autoRun ? ['--dangerously-bypass-approvals-and-sandbox'] : []), '--', prompt]
      case 'opencode': {
        const args = ['run', '--format', 'json', '--dir', cwd, ...(autoRun ? ['--dangerously-skip-permissions'] : [])]
        if (model) args.push('--model', model)
        args.push('--', prompt)
        return args
      }
      case 'dsh':
        // Headless profile owns the model and approval policy; the subprocess
        // inherits cwd unattended. `--json` selects the NDJSON run-event
        // protocol parsed by DshParser (verified against dsh 0.2.0-rc.2).
        return ['--profile', 'headless', '--json', prompt]
      default:
        // Headless subprocess runner stays claude/codex/opencode/dsh-only:
        // janus/pi run as interactive terminals with hook extensions, never here.
        throw new Error(`Unsupported headless engine: ${engine}`)
    }
  }

  private emit(id: string, event: AgentEvent): void {
    const listeners = this.listeners.get(id)
    if (listeners) {
      for (const cb of listeners) {
        try { cb(event) } catch { /* listener error */ }
      }
    }
  }

  onEvent(id: string, callback: EventCallback): () => void {
    if (!this.listeners.has(id)) {
      this.listeners.set(id, new Set())
    }
    this.listeners.get(id)!.add(callback)
    return () => {
      this.listeners.get(id)?.delete(callback)
    }
  }

  cancel(id: string): void {
    if (this.launching.has(id)) this.cancelled.add(id)
    // 命中排队任务：移出队列并 reject，否则调用方 await start() 永挂
    const queuedIndex = this.queue.findIndex((task) => task.id === id)
    if (queuedIndex >= 0) {
      const [task] = this.queue.splice(queuedIndex, 1)
      this.listeners.delete(id)
      task.reject(new Error(`Agent stream cancelled before start: ${id}`))
      return
    }
    const session = this.sessions.get(id)
    if (!session || session.status !== 'running') return
    session.abortController.abort('user-cancel')
    if (session.timeout) clearTimeout(session.timeout)
    this.killProcessTree(session.process)
    session.status = 'cancelled'
  }

  cancelAll(): void {
    for (const id of this.launching) this.cancelled.add(id)
    const queued = this.queue
    this.queue = []
    for (const task of queued) {
      this.listeners.delete(task.id)
      task.reject(new Error(`Agent stream cancelled before start: ${task.id}`))
    }
    for (const [id, session] of this.sessions) {
      if (session.status === 'running') this.cancel(id)
    }
  }

  /** Capture descendants before terminating their parent; retain failed stops. */
  private killProcessTree(proc: StreamSession['process']): void {
    const pending = stopProcessTree(proc, { processGroup: true }).catch(error => {
      this.stopErrors.push(error)
      console.error('[AgentStreamManager] process exit unconfirmed', error)
    }).finally(() => this.stops.delete(pending))
    this.stops.add(pending)
  }

  async killAll(): Promise<void> {
    this.stopping = true
    this.cancelAll()
    await Promise.all([...this.stops])
    const errors = this.stopErrors.splice(0)
    if (errors.length) throw new AggregateError(errors, 'Agent process exit unconfirmed')
  }

  getSession(id: string): StreamSession | undefined {
    return this.sessions.get(id)
  }

  listSessions(): StreamSession[] {
    return Array.from(this.sessions.values())
  }

  private drainQueue(): void {
    while (this.queue.length > 0 && this.running < this.maxConcurrency) {
      const next = this.queue.shift()!
      this.running++
      next.run().finally(() => this.drainQueue())
    }
  }
}

export const agentStreamManager = new AgentStreamManager()
