import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'

/** The versioned native boundary. Domain validation happens before requests are sent. */
export type CodexRpc = Record<string, any>

export class CodexManagedRpcError extends Error {
  constructor(readonly code: number, message: string, readonly data?: unknown) { super(message) }
}

/** One owned stdio process; no TUI, listening socket, request replay or global configuration writes. */
export class CodexManagedTransport {
  private child?: ChildProcessWithoutNullStreams
  private sequence = 0
  private pending = new Map<string, { resolve(value: CodexRpc): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>()
  private buffer = ''
  private diagnostic = ''
  private closing = false
  private stopped?: Promise<void>
  private unexpectedExit = false

  constructor(private readonly receive: (message: CodexRpc) => void, private readonly fail: (message: string) => void) {}

  async start(options: { command: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv }): Promise<void> {
    if (this.child || this.closing) throw new Error('Codex process already started or closed')
    const child = spawn(options.command, [...options.args, 'app-server'], {
      cwd: options.cwd, env: options.env, windowsHide: true, detached: process.platform !== 'win32', stdio: 'pipe',
    })
    this.child = child
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    const failed = (error: Error) => {
      for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(error) }
      this.pending.clear()
      if (!this.closing) this.fail(error.message)
    }
    child.on('error', failed)
    child.stdin.on('error', failed)
    child.stderr.on('data', bytes => { this.diagnostic = (this.diagnostic + String(bytes)).slice(-4000) })
    child.on('exit', (code, signal) => { this.unexpectedExit = !this.closing; failed(new Error(`Codex exited (${signal ?? code}). ${this.diagnostic}`)) })
    child.stdout.on('data', bytes => {
      this.buffer += bytes.toString('utf8')
      if (Buffer.byteLength(this.buffer) > 32 * 1024 * 1024) { this.buffer = ''; child.stdout.pause(); failed(new Error('Codex protocol message exceeds the supported limit')); return }
      let end: number
      while ((end = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, end); this.buffer = this.buffer.slice(end + 1)
        if (!line.trim()) continue
        try {
          const message = JSON.parse(line) as CodexRpc
          if (message.id !== undefined && !message.method) {
            const request = this.pending.get(String(message.id))
            if (!request) continue
            clearTimeout(request.timer); this.pending.delete(String(message.id))
            if (message.error) request.reject(new CodexManagedRpcError(message.error.code, String(message.error.message ?? 'Codex request failed'), message.error.data))
            else request.resolve(message.result ?? {})
          } else this.receive(message)
        } catch (error) { failed(new Error(`Invalid Codex event: ${String(error)}`)) }
      }
    })
    await this.call('initialize', { clientInfo: { name: 'janus_superagent', version: '1.0.0' }, capabilities: { experimentalApi: true } })
    this.send({ method: 'initialized' })
  }

  send(message: CodexRpc): void {
    if (this.closing || !this.child?.stdin.writable || this.child.exitCode !== null || this.child.signalCode !== null) throw new Error('Codex process is unavailable')
    this.child.stdin.write(JSON.stringify(message) + '\n')
  }

  call(method: string, params: CodexRpc): Promise<CodexRpc> {
    const id = `janus-worker:${++this.sequence}`
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method} timed out; delivery is unknown and will not be replayed.`)) }, 30_000)
      this.pending.set(id, { resolve, reject, timer })
      try { this.send({ id, method, params }) }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error) }
    })
  }

  /** A rejected stop must keep the environment occupied. Never treat kill initiation as confirmation. */
  stop(): Promise<void> {
    if (this.stopped) return this.stopped
    this.closing = true
    for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(new Error('Codex stopped; pending delivery may be unknown')) }
    this.pending.clear()
    this.stopped = (async () => {
      const child = this.child
      if (!child?.pid) return
      if (this.unexpectedExit) throw new Error('Codex exited before its process tree could be confirmed stopped; environment remains occupied')
      if (child.exitCode !== null || child.signalCode !== null) return
      const exited = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Codex process exit could not be confirmed; environment remains occupied')), 8000)
        child.once('exit', () => { clearTimeout(timer); resolve() })
      })
      // Observe rejection immediately while the process-tree termination command runs.
      void exited.catch(() => undefined)
      if (process.platform === 'win32') {
        await new Promise<void>((resolve, reject) => {
          const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
          let diagnostic = ''
          const capture = (chunk: Buffer) => { diagnostic = (diagnostic + chunk.toString()).slice(-3000) }
          killer.stdout.on('data', capture); killer.stderr.on('data', capture)
          killer.once('error', reject)
          killer.once('exit', code => code === 0 || child.exitCode !== null || child.signalCode !== null ? resolve() : reject(new Error(`Codex process tree termination failed (${code}): ${diagnostic.trim()}`)))
        })
      } else {
        try { process.kill(-child.pid, 'SIGKILL') }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error }
      }
      await exited
    })().catch(error => { this.stopped = undefined; throw error })
    return this.stopped
  }
}
