// Note: .agents/notes/desktop/platform-runtime-boundaries.md
// Node-only mechanism. Electron diagnostics and owned-tree stop are injected.
import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { StringDecoder } from 'node:string_decoder'
import { execa, type Options as ExecaOptions } from 'execa'
import { resolveProcessSpawn } from './spawn-resolution'

export type ProcessStatus = 'exited' | 'spawn-error' | 'timed-out' | 'cancelled' | 'output-limit' | 'exit-unconfirmed'
export interface ProcessOutcome {
  status: ProcessStatus
  exitCode: number | null
  stdout: string
  stderr: string
  truncated: boolean
  error?: Error
}
export interface ProcessOptions {
  cwd?: string
  env?: NodeJS.ProcessEnv
  timeoutMs?: number
  signal?: AbortSignal
  maxOutputBytes?: number
  input?: string
  onStdout?: (chunk: string) => void
  onStderr?: (chunk: string) => void
  onSpawn?: (pid: number) => void
}
export interface ProcessHostPolicy {
  stop: (child: ChildProcess, options: { processGroup: boolean }) => Promise<void>
  platform?: NodeJS.Platform
}

/** Legacy runner policy classification; actual npm/batch execution is resolved centrally. */
export function requiresCommandShell(command: string, platform: NodeJS.Platform = process.platform): boolean {
  return platform === 'win32' && (/\.(bat|cmd)$/i.test(command) || ['npm', 'yarn', 'pnpm', 'bun'].includes(command.toLowerCase()))
}

/** No shell by default; npm shims resolve to Node, other batch files use execa's cmd encoder. */
export function spawnProcess(program: string, args: readonly string[] = [], options: SpawnOptions = {}, platform: NodeJS.Platform = process.platform): ChildProcess {
  const env = options.env ?? process.env
  if (program.includes('\0') || args.some(arg => arg.includes('\0'))) throw new Error('Process arguments contain NUL')
  if (options.shell) throw new Error('Use spawnShellCommand for explicit shell commands')
  const resolved = resolveProcessSpawn(program, args, env, platform, typeof options.cwd === 'string' ? options.cwd : undefined)
  const settings = { ...options, env, shell: false, windowsHide: true }
  if (!resolved.batch) return spawn(resolved.program, resolved.args, settings)
  // cmd cannot faithfully represent a literal newline through an arbitrary batch.
  // Reject rather than turn prompt contents into additional shell commands.
  if ([program, ...args].some(value => /[\r\n]/.test(value))) throw new Error('Multiline arguments require a native executable or a standard npm shim')
  const child = execa(resolved.program, resolved.args, { ...settings, buffer: false, reject: false } as ExecaOptions)
  void child.catch(() => {}) // callers consume ChildProcess events; never leave a rejected thenable
  return child
}

/** Explicit shell policy for commands authored as shell scripts, not structured argv. */
export function spawnShellCommand(command: string, options: SpawnOptions & { shell: string }): ChildProcess {
  return spawn(command, [], { ...options, windowsHide: true })
}

export function createProcessHost(policy: ProcessHostPolicy) {
  const platform = policy.platform ?? process.platform
  return {
    spawn(program: string, args: readonly string[] = [], options: SpawnOptions = {}) {
      return spawnProcess(program, args, { detached: platform !== 'win32', ...options }, platform)
    },
    run(program: string, args: readonly string[] = [], options: ProcessOptions = {}): Promise<ProcessOutcome> {
      if (options.signal?.aborted) return Promise.resolve({ status: 'cancelled', exitCode: null, stdout: '', stderr: '', truncated: false })
      return new Promise(resolve => {
        let child: ChildProcess
        try {
          child = spawnProcess(program, args, { cwd: options.cwd, env: options.env, detached: platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] }, platform)
        } catch (error) {
          resolve({ status: 'spawn-error', exitCode: null, stdout: '', stderr: '', truncated: false, error: error instanceof Error ? error : new Error(String(error)) })
          return
        }
        let stdout = '', stderr = '', bytes = 0, truncated = false, done = false, closed = false
        let exitCode: number | null = null, reason: ProcessStatus | undefined, spawnError: Error | undefined
        let stopping: Promise<void> | undefined
        const limit = options.maxOutputBytes ?? 4 * 1024 * 1024
        const outDecoder = new StringDecoder('utf8'), errDecoder = new StringDecoder('utf8')
        let timer: ReturnType<typeof setTimeout> | undefined, closeTimer: ReturnType<typeof setTimeout> | undefined
        const finish = (status: ProcessStatus, error?: Error) => {
          if (done) return
          done = true
          clearTimeout(timer)
          clearTimeout(closeTimer)
          options.signal?.removeEventListener('abort', abort)
          resolve({ status, exitCode, stdout, stderr, truncated, ...(error ? { error } : {}) })
        }
        const stop = (status: ProcessStatus) => {
          if (stopping || done) return
          reason = status
          stopping = Promise.resolve().then(() => policy.stop(child, { processGroup: platform !== 'win32' }))
          void stopping.then(() => {
            if (closed) finish(reason!, spawnError)
            else closeTimer = setTimeout(() => finish('exit-unconfirmed', new Error('Owned process did not close after stop confirmation')), 2000)
          }, error => finish('exit-unconfirmed', error instanceof Error ? error : new Error(String(error))))
        }
        const abort = () => stop('cancelled')
        const consume = (stream: 'stdout' | 'stderr', chunk: Buffer) => {
          if (done) return
          const remaining = Math.max(0, limit - bytes)
          const selected = chunk.subarray(0, remaining)
          bytes += selected.length
          const text = (stream === 'stdout' ? outDecoder : errDecoder).write(selected)
          try {
            if (stream === 'stdout') { stdout += text; options.onStdout?.(text) }
            else { stderr += text; options.onStderr?.(text) }
          } catch (error) { spawnError = error instanceof Error ? error : new Error(String(error)); stop('spawn-error') }
          if (selected.length < chunk.length) { truncated = true; stop('output-limit') }
        }
        child.stdout?.on('data', chunk => consume('stdout', Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
        child.stderr?.on('data', chunk => consume('stderr', Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
        child.once('error', error => { spawnError = error })
        child.once('close', code => {
          closed = true
          exitCode = code
          stdout += outDecoder.end(); stderr += errDecoder.end()
          if (!stopping) finish(spawnError ? 'spawn-error' : 'exited', spawnError)
          else void stopping.then(() => finish(reason!, spawnError), () => {})
        })
        // EPIPE is expected if the command exits before consuming all stdin.
        child.stdin?.on('error', error => { if ((error as NodeJS.ErrnoException).code !== 'EPIPE') { spawnError = error; stop('spawn-error') } })
        child.stdin?.end(options.input)
        if (options.timeoutMs !== undefined) timer = setTimeout(() => stop('timed-out'), options.timeoutMs)
        options.signal?.addEventListener('abort', abort, { once: true })
        if (options.signal?.aborted) abort()
        if (child.pid) {
          try { options.onSpawn?.(child.pid) }
          catch (error) { spawnError = error instanceof Error ? error : new Error(String(error)); stop('spawn-error') }
        }
      })
    },
  }
}

export function requireProcessSuccess(outcome: ProcessOutcome): ProcessOutcome {
  if (outcome.status !== 'exited' || outcome.exitCode !== 0) {
    // No argv or full environment in diagnostics; callers may explicitly display safe output.
    throw Object.assign(new Error(`Process ${outcome.status} (exit ${outcome.exitCode ?? 'unknown'})`), { outcome, code: (outcome.error as NodeJS.ErrnoException | undefined)?.code ?? outcome.exitCode, exitCode: outcome.exitCode, stdout: outcome.stdout, stderr: outcome.stderr, cause: outcome.error })
  }
  return outcome
}
