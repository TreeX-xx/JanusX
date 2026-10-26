// Note: .agents/notes/sessions/workspace-runtime-import.md
import { StringDecoder } from 'node:string_decoder'
import type { TerminalCreateRequest } from '../../shared/ipc/terminal'
import type { RuntimeTerminal, WorkspaceRuntime } from '../../shared/workspace-runtime'
import { resolveTerminalLaunchProgram } from '../../shared/terminalLaunch'
import { resolveRuntimeResource, runtimeRequest } from '../workspace/runtime'
import { detectRemoteCli } from '../workspace/remote-cli'
import type { TerminalInstance } from './types'

type ExternalRuntime = Exclude<WorkspaceRuntime, { kind: 'windows' }>
type Poll = RuntimeTerminal & { data: string; truncated: boolean }

/** Client adapter only; the Linux daemon owns the PTY and its lifetime. */
export class RemotePty {
  readonly pid: number
  private sequence = 0
  private stopped = false
  private timer?: NodeJS.Timeout
  private decoder = new StringDecoder('utf8')
  private dataListeners = new Set<(data: string) => void>()
  private exitListeners = new Set<(event: { exitCode: number }) => void>()
  private inputChain: Promise<void> = Promise.resolve()
  private disconnected = false

  constructor(
    private runtime: ExternalRuntime,
    private terminal: RuntimeTerminal,
    private connectionChanged: (error: string | null) => void,
  ) { this.pid = terminal.pid }

  onData = (listener: (data: string) => void) => {
    this.dataListeners.add(listener)
    return { dispose: () => { this.dataListeners.delete(listener) } }
  }

  onExit = (listener: (event: { exitCode: number }) => void) => {
    this.exitListeners.add(listener)
    return { dispose: () => { this.exitListeners.delete(listener) } }
  }

  private request<T>(method: string, params = {}): Promise<T> {
    return runtimeRequest<T>(this.runtime, method, { id: this.terminal.id, workspaceId: this.terminal.workspaceId, ...params })
  }

  start(): void { void this.poll() }

  private async poll(): Promise<void> {
    if (this.stopped) return
    let delay = 100
    try {
      const result = await this.request<Poll>('terminal.poll', { after: this.sequence })
      if (this.stopped) return
      if (this.disconnected) { this.disconnected = false; this.connectionChanged(null) }
      if (result.truncated) {
        this.decoder = new StringDecoder('utf8')
        this.emit('\r\n[JanusX: older terminal output is no longer retained]\r\n')
      }
      this.sequence = result.sequence
      const text = this.decoder.write(Buffer.from(result.data, 'base64'))
      if (text) this.emit(text)
      if (result.exitCode !== null) {
        const tail = this.decoder.end()
        if (tail) this.emit(tail)
        for (const listener of this.exitListeners) listener({ exitCode: result.exitCode })
        this.detach()
        return
      }
    } catch (error) {
      if (this.stopped) return
      if (!this.disconnected) {
        this.disconnected = true
        this.connectionChanged(String(error))
      }
      delay = 2000
    }
    if (!this.stopped) this.timer = setTimeout(() => { void this.poll() }, delay)
  }

  private emit(text: string): void { for (const listener of this.dataListeners) listener(text) }

  write(data: string): void {
    if (this.stopped || this.disconnected) throw new Error('Remote terminal is disconnected')
    // Preserve input order. A failed write is reported, never retried: the
    // target may already have received it before the transport disappeared.
    this.inputChain = this.inputChain.then(async () => {
      if (this.stopped) return
      await this.request('terminal.write', { data: Buffer.from(data).toString('base64') })
    }).catch(error => { this.connectionChanged(`Terminal input was not confirmed: ${String(error)}`) })
  }

  resize(cols: number, rows: number): void {
    if (this.stopped) return
    void this.request('terminal.resize', { cols, rows }).catch(error => this.connectionChanged(String(error)))
  }

  kill(): void { void this.end().catch(error => this.connectionChanged(String(error))) }

  async end(): Promise<void> {
    await this.request('terminal.end')
    this.detach()
  }

  detach(): void {
    this.stopped = true
    if (this.timer) clearTimeout(this.timer)
    this.dataListeners.clear()
    this.exitListeners.clear()
  }
}

export async function createRemoteTerminal(config: TerminalCreateRequest, connectionChanged: (error: string | null) => void): Promise<{ instance: TerminalInstance; start(): void }> {
  const resource = await resolveRuntimeResource(config.cwd)
  if (!resource || resource.workspaceId !== config.workspaceId) throw new Error('Terminal workspace does not match its directory')
  const stat = await runtimeRequest<{ isDirectory: boolean }>(resource.runtime, 'fs.stat', { root: resource.root, path: resource.relative })
  if (!stat.isDirectory) throw new Error('Terminal directory is unavailable')
  const program = config.command ? { command: config.command, args: config.args ?? [] } : resolveTerminalLaunchProgram(config)
  let argv = program ? [program.command, ...program.args, ...(config.extraArgs ?? [])] : undefined
  if (!config.attachOnly && program && config.preset && config.preset !== 'shell' && program.command === config.preset) {
    const probe = await detectRemoteCli(resource.workspaceId, config.preset)
    if (!probe.installed) throw new Error(`${config.preset} is not installed in the target environment. Install it from a new Agent terminal.`)
    // Re-resolve the user's Linux PATH at spawn time, even when the PTY daemon predates installation.
    argv = ['python3', '-c', "import pathlib,runpy; runpy.run_path(str(pathlib.Path.home()/'.local/share/janusx/runtime-v1/cli.py'),run_name='__main__')", '--launch', config.preset, ...program.args, ...(config.extraArgs ?? [])]
  }
  const terminal = await runtimeRequest<RuntimeTerminal>(resource.runtime, 'terminal.create', {
    id: config.id, workspaceId: resource.workspaceId, cwd: resource.path,
    argv, preset: config.preset ?? 'shell', cols: config.cols ?? 120, rows: config.rows ?? 40,
    attachOnly: config.attachOnly === true,
  })
  const pty = new RemotePty(resource.runtime, terminal, connectionChanged)
  return {
    instance: {
      id: config.id, pty, remote: pty,
      config: { id: config.id, workspaceId: resource.workspaceId, cwd: config.cwd, shell: terminal.argv[0], cols: terminal.cols, rows: terminal.rows },
      status: 'running', createdAt: Date.parse(terminal.createdAt), outputBuffer: '', outputSeq: 0,
      lastCols: terminal.cols, lastRows: terminal.rows,
    },
    start: () => pty.start(),
  }
}
