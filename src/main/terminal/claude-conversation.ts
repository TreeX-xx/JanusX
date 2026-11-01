import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http'
import { createConnection } from 'node:net'
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { delimiter, dirname, extname, join } from 'node:path'
import type { ConversationCommand, ConversationSnapshot, ConversationItem } from '../../shared/conversation-display'
import { parseConversationSlashCommand } from '../../shared/conversation-display'
import modSource from './claude-mod.js?raw'
import { readClaudeModels } from './claude-models'

type Json = Record<string, any> // Native versioned Mods/daemon boundary; normalized before IPC.
const exec = promisify(execFile)
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const MAX_TEXT = 32000
const caps = { submit: true, cancel: true, settings: true, approvals: true, liveText: true }
type LaunchOptions = { command: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv; pathDir?: string; assetsDir: string }

export function resolveClaudeBinary(command: string): string {
  if (process.platform !== 'win32' || extname(command).toLowerCase() === '.exe') return command
  const binary = join(dirname(command), 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe')
  if (!existsSync(binary)) throw new Error('Claude dual mode requires native claude.exe (npm installation supported).')
  return binary
}

export class ClaudeConversation {
  readonly state: ConversationSnapshot
  private server?: Server
  private directory?: string
  private token = randomBytes(32).toString('hex')
  private binary = ''
  private env: NodeJS.ProcessEnv = {}
  private cwd = ''
  private configDir = ''
  private short?: string
  private disposed = false
  private stopping?: Promise<void>
  private startup?: Promise<{ command: string; args: string[] }>
  private sequence = 0
  private lastSeen = 0
  private broken = false
  private heartbeat?: ReturnType<typeof setInterval>
  private publishTimer?: ReturnType<typeof setTimeout>
  private pending = new Map<string, { command: Json; resolve(value: Json): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>()
  private sent = new Map<string, { text: string; result: Promise<void> }>()
  private tools = new Map<string, { turnId: string; name: string; taskId?: string; active: boolean }>()
  private finishedTasks = new Map<string, string>()
  private catalogSettings = ''
  private catalogAbort = new AbortController()
  private loadingModels?: Promise<void>
  private approvals = new Map<string, { response: ServerResponse; toolId: string; timer: ReturnType<typeof setTimeout> }>()
  private lastTurn?: string
  private lastTurnSequence = 0

  constructor(readonly id: string, private readonly publish: (snapshot: ConversationSnapshot) => void,
    private readonly bind: (sessionId: string, transcriptPath?: string) => void = () => {}) {
    this.state = { id, engine: 'claude', capabilities: { ...caps }, revision: 0, mode: 'terminal', controlEpoch: 0,
      connection: 'starting', threadId: null, turnId: null, submitting: false, items: [], approvals: [], needsTerminal: false,
      truncated: false, model: null, effort: null, models: [], modelsLoading: false, settingsUpdating: false }
  }
  snapshot(): ConversationSnapshot { return structuredClone(this.state) }
  private changed(immediate = true): void {
    this.state.revision++
    if (!immediate && this.publishTimer) return
    if (this.publishTimer) clearTimeout(this.publishTimer)
    this.publishTimer = undefined
    if (immediate) this.publish(this.snapshot())
    else this.publishTimer = setTimeout(() => { this.publishTimer = undefined; this.publish(this.snapshot()) }, 32)
  }
  private fail(message: string): void {
    if (this.disposed) return
    this.state.connection = 'disconnected'; this.state.error = message; this.changed()
  }

  async start(options: LaunchOptions): Promise<{ command: string; args: string[] }> {
    if (this.startup || this.disposed) throw new Error('Claude session already started or closed')
    this.startup = this.launch(options)
    try { return await this.startup } catch (error) {
      await this.dispose()
      throw new Error(`Claude conversation could not start. Complete native login and folder trust with conversation mode off, then retry. ${String(error).slice(0, 1500)}`)
    }
  }
  private async launch(options: LaunchOptions): Promise<{ command: string; args: string[] }> {
    if (process.platform !== 'win32') throw new Error('Claude dual mode is currently validated on Windows only.')
    this.binary = resolveClaudeBinary(options.command); this.env = { ...options.env }; this.cwd = options.cwd
    const pathKey = Object.keys(this.env).find(key => key.toLowerCase() === 'path') ?? 'PATH'
    if (options.pathDir) this.env[pathKey] = `${options.pathDir}${delimiter}${this.env[pathKey] ?? ''}`
    this.configDir = this.env.CLAUDE_CONFIG_DIR || join(this.env.USERPROFILE || this.env.HOME || homedir(), '.claude')
    const version = await this.cli(['--version'])
    if (version.stdout.trim() !== '2.1.316 (Claude Code)') throw new Error(`Claude dual mode requires validated 2.1.316; installed: ${version.stdout.trim()}`)
    if (this.disposed) throw new Error('Claude launch cancelled')
    await mkdir(options.assetsDir, { recursive: true })
    this.directory = await mkdtemp(join(options.assetsDir, 'claude-'))
    this.server = createServer((request, response) => { void this.http(request, response) })
    this.server.requestTimeout = 10000
    await new Promise<void>((resolve, reject) => { this.server!.once('error', reject); this.server!.listen(0, '127.0.0.1', resolve) })
    this.server.on('error', error => this.fail(error.message))
    const address = this.server.address()
    if (!address || typeof address === 'string') throw new Error('Claude bridge unavailable')
    const endpoint = `http://127.0.0.1:${address.port}`
    const plugin = join(this.directory, 'plugin')
    await mkdir(join(plugin, '.claude-plugin'), { recursive: true })
    await mkdir(join(plugin, 'hooks'))
    await writeFile(join(plugin, '.claude-plugin/plugin.json'), JSON.stringify({ name: 'janusx-conversation', version: '0.1.0', description: 'JanusX native session display bridge' }))
    await writeFile(join(plugin, 'hooks/hooks.json'), JSON.stringify({ modules: ['./register.js'] }))
    await writeFile(join(plugin, 'hooks/register.js'), modSource)
    await writeFile(join(plugin, 'hooks/connection.js'), `export const endpoint=${JSON.stringify(endpoint)};export const token=${JSON.stringify(this.token)};export const terminalId=${JSON.stringify(this.id)};`, { mode: 0o600 })
    // Preserve the existing launch hooks. Worker-specific env belongs in this
    // additional settings file, never the shared user's settings or daemon env.
    let settings: Json = {}
    const args: string[] = []
    for (let i = 0; i < options.args.length; i++) {
      if (options.args[i] === '--settings') {
        const source = options.args[++i]
        settings = { ...settings, ...JSON.parse(source.startsWith('{') ? source : await readFile(source, 'utf8')) }
      } else args.push(options.args[i])
    }
    const workerEnv = Object.fromEntries(Object.entries(this.env).filter(([key, value]) => value !== undefined &&
      /^(JANUSX_|ANTHROPIC_|CLAUDE_CODE_|DISABLE_AUTOUPDATER$|HTTPS?_PROXY$|ALL_PROXY$|NO_PROXY$|PATH$)/i.test(key)))
    settings.env = { ...(settings.env ?? {}), ...workerEnv }
    settings.hooks = { ...(settings.hooks ?? {}), PermissionRequest: [...(settings.hooks?.PermissionRequest ?? []),
      { hooks: [{ type: 'http', url: `${endpoint}/permission`, headers: { 'X-JanusX-Token': this.token }, timeout: 300 }] }] }
    const settingsPath = join(this.directory, 'settings.json')
    await writeFile(settingsPath, JSON.stringify(settings), { mode: 0o600 })
    // Catalog discovery uses the same settings/provider environment but must
    // not run the user's SessionStart hooks or our conversation observer.
    this.catalogSettings = join(this.directory, 'catalog-settings.json')
    await writeFile(this.catalogSettings, JSON.stringify({ ...settings, disableAllHooks: true }), { mode: 0o600 })
    if (this.disposed) throw new Error('Claude launch cancelled')
    const dispatch = await this.cli([...args, '--settings', settingsPath, '--plugin-dir', plugin, '--bg'], 20000)
    this.short = /backgrounded\s*·\s*([a-f0-9]+)/.exec(dispatch.stdout)?.[1]
    if (!this.short) throw new Error(`Claude did not create a background session. ${dispatch.stderr || dispatch.stdout}`)
    if (this.disposed) throw new Error('Claude launch cancelled')
    // No startup prompt: session.start is sufficient, and creates no model call.
    for (let i = 0; i < 200 && !this.state.threadId && !this.disposed; i++) await pause(100)
    if (this.disposed) throw new Error('Claude launch cancelled')
    if (!this.state.threadId) throw new Error('Claude bridge did not start. Complete native login/trust in a normal Claude terminal, then create a new conversation.')
    const jobs = JSON.parse((await this.cli(['agents', '--json', '--all'])).stdout) as Json[]
    const job = jobs.find(value => value.id === this.short)
    if (!job?.pid || job.sessionId !== this.state.threadId) throw new Error('Claude background identity did not match its bridge')
    if (this.disposed) throw new Error('Claude launch cancelled')
    this.state.connection = 'ready'; this.bind(this.state.threadId); this.changed()
    void this.loadModels()
    this.heartbeat = setInterval(() => {
      if (Date.now() - this.lastSeen > 6000 && this.state.connection === 'ready') this.fail('Claude event bridge disconnected. Commands will not be resent; use the terminal.')
    }, 1000)
    return { command: this.binary, args: ['attach', this.short] }
  }
  private cli(args: string[], timeout = 10000) {
    return exec(this.binary, args, { cwd: this.cwd, env: this.env, windowsHide: true, timeout, maxBuffer: 2 * 1024 * 1024 })
  }
  private loadModels(): Promise<void> {
    if (this.loadingModels) return this.loadingModels
    this.state.modelsLoading = true; this.state.modelsError = undefined; this.changed()
    this.loadingModels = (async () => {
      try {
        const models = await readClaudeModels({ binary: this.binary, cwd: this.cwd, env: this.env, settings: this.catalogSettings, signal: this.catalogAbort.signal })
        if (!this.disposed) this.state.models = models
      } catch (error) { if (!this.disposed) this.state.modelsError = String(error).slice(0, 1000) }
      finally { this.loadingModels = undefined; this.state.modelsLoading = false; if (!this.disposed) this.changed() }
    })()
    return this.loadingModels
  }
  private reply(message: Json): Promise<Json> {
    return (async () => {
      const nonce = (await readFile(join(this.configDir, 'daemon/pipe.key'), 'utf8')).trim()
      const auth = (await readFile(join(this.configDir, 'daemon/control.key'), 'utf8')).trim()
      return new Promise<Json>((resolve, reject) => {
        const socket = createConnection(`\\\\.\\pipe\\cc-daemon-${nonce}-control`)
        let buffer = ''
        const timer = setTimeout(() => { socket.destroy(); reject(new Error('Claude delivery unknown; do not automatically resend.')) }, 8000)
        socket.on('error', error => { clearTimeout(timer); reject(error) })
        socket.on('connect', () => socket.write(`${JSON.stringify({ proto: 1, ...message, auth })}\n`))
        socket.on('data', bytes => {
          buffer += bytes.toString()
          if (buffer.length > 100000) { socket.destroy(); clearTimeout(timer); reject(new Error('Invalid daemon reply')); return }
          const index = buffer.indexOf('\n')
          if (index < 0) return
          clearTimeout(timer); socket.destroy()
          try { resolve(JSON.parse(buffer.slice(0, index))) } catch (error) { reject(error) }
        })
      })
    })()
  }
  private json(response: ServerResponse, value: unknown, code = 200): void {
    if (!response.writableEnded) response.writeHead(code, { 'Content-Type': 'application/json' }).end(JSON.stringify(value))
  }
  private async http(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      const candidate = request.headers['x-janusx-token']
      if (request.method !== 'POST' || request.headers.origin || typeof candidate !== 'string' || Buffer.byteLength(candidate) !== Buffer.byteLength(this.token) ||
        !timingSafeEqual(Buffer.from(candidate), Buffer.from(this.token))) { this.json(response, {}, 403); return }
      let text = ''
      for await (const bytes of request) { text += bytes; if (text.length > 3_000_000) { this.json(response, {}, 413); request.destroy(); return } }
      const body = JSON.parse(text) as Json
      if (this.disposed) { this.json(response, {}, 410); return }
      if (request.url === '/permission') { await this.permission(body, response); return }
      if (request.url !== '/exchange' || body.terminalId !== this.id || typeof body.sessionId !== 'string') { this.json(response, {}, 400); return }
      if (this.state.threadId && body.sessionId !== this.state.threadId) { this.broken = true; this.fail('Claude session changed. Open a new conversation to bind it safely.'); this.json(response, {}, 409); return }
      this.state.threadId = body.sessionId; this.lastSeen = Date.now()
      if (body.overflow) { this.broken = true; this.fail('Claude event buffer overflowed; use the terminal.'); this.json(response, {}, 409); return }
      for (const event of body.events ?? []) {
        if (event.seq <= this.sequence) continue
        if (event.seq !== this.sequence + 1) { this.broken = true; throw new Error('Claude event sequence gap; use the terminal.') }
        this.receive(event); this.sequence = event.seq
      }
      const acked: string[] = []
      for (const ack of body.acks ?? []) {
        const pending = this.pending.get(ack.id)
        if (pending) { clearTimeout(pending.timer); this.pending.delete(ack.id); if (ack.ok) pending.resolve(ack.result ?? {}); else pending.reject(new Error(String(ack.error))) }
        acked.push(ack.id)
      }
      if (this.state.connection === 'disconnected' && !this.broken) { this.state.connection = 'ready'; this.state.error = undefined; this.changed() }
      this.json(response, { seq: this.sequence, acks: acked, commands: [...this.pending.values()].map(value => value.command) })
    } catch (error) { this.fail(String(error)); this.json(response, {}, 400) }
  }

  private item(id: string, turnId: string, type: string): ConversationItem {
    let item = this.state.items.find(value => value.id === id)
    if (!item) {
      item = { id, turnId, type, text: '', status: 'inProgress', receivedAt: Date.now() }; this.state.items.push(item)
      if (this.state.items.length > 500) { this.state.items.shift(); this.state.truncated = true }
    }
    return item
  }
  private receive(event: Json): void {
    const e = event.data ?? {}
    if (event.type === 'session.start') { this.state.model = typeof e.model === 'string' ? e.model : e.model?.model ?? null }
    else if (event.type === 'settings') {
      this.state.model = e.model ?? this.state.model; this.state.effort = e.effort ?? null
      this.state.settingsOverride = Boolean(e.override)
    }
    else if (event.type === 'native.settings') { this.state.needsTerminal = Boolean(e.pending) }
    else if (event.type === 'turn.start') {
      this.state.turnStartedAt = Date.now(); this.state.turnId = e.turnId; this.lastTurn = e.turnId
      this.lastTurnSequence = event.seq
      this.state.needsTerminal = false
      if (e.model && !this.state.settingsOverride) this.state.model = typeof e.model === 'string' ? e.model : e.model.model ?? this.state.model
      if (!e.isMeta && e.text) Object.assign(this.item(`user:${e.turnId}`, e.turnId, 'userMessage'), { text: String(e.text).slice(0, MAX_TEXT), status: 'completed' })
    } else if (event.type === 'plan.updated') {
      if (typeof e.turnId !== 'string' || e.turnId !== this.state.turnId || !Array.isArray(e.plan) || e.plan.length > 100 ||
        !e.plan.every((step: Json) => step && typeof step.step === 'string' && step.step.length <= 2000 && ['pending', 'inProgress', 'completed'].includes(step.status))) return
      const plans = this.state.plans ?? []
      const previous = [...plans].reverse().find(plan => plan.turnId === e.turnId)
      const steps = e.plan.map((step: Json) => ({ step: step.step, status: step.status }))
      if (previous && !previous.stale && JSON.stringify(previous.steps) === JSON.stringify(steps)) return
      this.state.plans = [...plans, { turnId: e.turnId, version: (previous?.version ?? 0) + 1, steps, explanation: '', outcome: 'running' as const }].slice(-100)
    } else if (event.type === 'plan.unavailable') {
      if (typeof e.turnId !== 'string' || e.turnId !== this.state.turnId) return
      const latest = this.state.plans?.at(-1)
      if (latest?.turnId === e.turnId) this.state.plans = this.state.plans!.map(plan => plan === latest ? { ...plan, stale: true } : plan)
      else if (latest) this.state.plans = [...this.state.plans!, { ...latest, turnId: e.turnId, version: 1, stale: true, outcome: 'running' as const }].slice(-100)
    } else if (event.type === 'chunk' && e.chunk?.kind === 'text') {
      const item = this.item(`text:${e.turnId}:${e.step}:${e.chunk.index ?? 0}`, e.turnId, 'agentMessage')
      const text = item.text + String(e.chunk.text ?? '')
      item.text = text.slice(0, MAX_TEXT); item.truncated = text.length > MAX_TEXT
    } else if (event.type === 'tool.start') {
      if (typeof e.toolUseId !== 'string' || typeof e.turnId !== 'string') return
      this.tools.set(e.toolUseId, { turnId: e.turnId, name: e.tool, active: true })
      if (this.tools.size > 1000) for (const [id, tool] of this.tools) {
        if (!tool.active) this.tools.delete(id)
        if (this.tools.size <= 1000) break
      }
      const item = this.item(`tool:${e.toolUseId}`, e.turnId, ['Write', 'Edit'].includes(e.tool) ? 'fileChange' : 'commandExecution')
      item.text = String(e.command ?? e.tool).slice(0, MAX_TEXT)
      if (typeof e.path === 'string') item.files = [{ path: e.path, diff: e.old !== undefined ? `- ${e.old}\n+ ${e.text ?? ''}` : String(e.text ?? '') }]
      if (['AskUserQuestion', 'ExitPlanMode', 'EnterPlanMode'].includes(e.tool)) this.state.needsTerminal = true
    } else if (event.type === 'tool.complete' || event.type === 'tool.error') {
      const tool = this.tools.get(e.toolUseId)
      if (!tool) return
      tool.taskId = e.taskId; tool.active = (Boolean(e.taskId) && !this.finishedTasks.has(e.taskId)) || (event.type === 'tool.error' && tool.name === 'Bash')
      const item = this.state.items.find(value => value.id === `tool:${e.toolUseId}`)
      const finished = this.finishedTasks.get(e.taskId)
      if (item) { item.text = `${item.text}\n${e.text ?? ''}`.slice(0, MAX_TEXT); item.status = tool.active ? 'inProgress' : finished === 'killed' ? 'interrupted' : e.failed || finished === 'failed' || event.type === 'tool.error' ? 'failed' : 'completed' }
      this.expireToolApproval(e.toolUseId)
      if (['AskUserQuestion', 'ExitPlanMode', 'EnterPlanMode'].includes(tool.name)) this.state.needsTerminal = false
    } else if (event.type === 'task.complete') {
      if (typeof e.taskId !== 'string' || !['completed', 'failed', 'killed'].includes(e.status)) return
      this.finishedTasks.set(e.taskId, e.status)
      if (this.finishedTasks.size > 1000) this.finishedTasks.delete(this.finishedTasks.keys().next().value!)
      for (const [id, tool] of this.tools) if (tool.taskId === e.taskId || id === e.toolUseId) {
        tool.active = false
        const item = this.state.items.find(value => value.id === `tool:${id}`)
        if (item) item.status = e.status === 'killed' ? 'interrupted' : e.status
      }
    } else if (event.type === 'turn.complete') {
      const outcome = e.reason === 'aborted' ? 'interrupted' : e.reason === 'error' ? 'failed' : 'completed'
      this.state.plans = this.state.plans?.map(plan => plan.turnId === e.turnId ? { ...plan, outcome } : plan)
      if (this.state.turnId === e.turnId) {
        if (this.state.turnStartedAt !== undefined) {
          const durationMs = Math.max(0, Date.now() - this.state.turnStartedAt)
          for (const item of this.state.items) if (item.turnId === e.turnId && item.type === 'agentMessage') item.durationMs = durationMs
        }
        this.state.turnStartedAt = undefined; this.state.turnId = null; this.state.needsTerminal = false
      }
      for (const item of this.state.items) if (item.turnId === e.turnId && item.type === 'agentMessage') item.status = e.reason === 'aborted' ? 'interrupted' : e.reason === 'error' ? 'failed' : 'completed'
      for (const [id, tool] of this.tools) if (tool.turnId === e.turnId) this.expireToolApproval(id)
      if (e.reason === 'error') this.state.error = 'Claude turn failed. See the native terminal for details.'
    }
    this.state.backgroundTasks = [...this.tools.values()].filter(value => value.active).length
    this.changed(false)
  }
  private async permission(body: Json, response: ServerResponse): Promise<void> {
    if (!this.state.threadId || body.session_id !== this.state.threadId) { this.json(response, {}); return }
    // Wait for the sequenced observer to reach tool.start. Only unique, supported
    // native calls are represented here; all other dialogs remain native.
    let matches: Array<[string, { turnId: string; name: string; active: boolean }]> = []
    for (let i = 0; i < 5; i++) {
      matches = [...this.tools].filter(([id, tool]) => {
        const item = this.state.items.find(value => value.id === `tool:${id}`)
        return tool.active && tool.name === body.tool_name && (tool.name === 'Bash' ? item?.text === body.tool_input?.command : item?.files?.[0]?.path === body.tool_input?.file_path)
      })
      if (matches.length) break
      await pause(100)
    }
    if (!['Bash', 'Write', 'Edit'].includes(body.tool_name) || matches.length !== 1 || this.disposed) {
      if (!this.disposed) { this.state.needsTerminal = true; this.changed() }
      this.json(response, {}); return
    }
    const [toolId] = matches[0]
    const id = randomUUID()
    const timer = setTimeout(() => this.finishApproval(id, {}), 290000)
    this.approvals.set(id, { response, toolId, timer })
    response.on('close', () => this.finishApproval(id, {}))
    this.state.approvals.push({ id, itemId: `tool:${toolId}`, kind: body.tool_name === 'Bash' ? 'command' : 'file',
      description: String(body.tool_input?.command ?? body.tool_input?.file_path ?? body.tool_name).slice(0, 8000) })
    this.changed()
  }
  private finishApproval(id: string, result: Json): void {
    const pending = this.approvals.get(id)
    if (!pending) return
    this.approvals.delete(id); clearTimeout(pending.timer)
    this.state.approvals = this.state.approvals.filter(value => value.id !== id)
    this.json(pending.response, result); this.changed()
  }
  private expireToolApproval(toolId: string): void {
    for (const [id, pending] of this.approvals) if (pending.toolId === toolId) this.finishApproval(id, {})
  }
  private call(command: Json): Promise<Json> {
    const id = randomUUID()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id); this.broken = true
        this.fail('Claude control timed out; completion is unknown. Check the terminal.')
        reject(new Error('Claude control timed out; completion is unknown. Check the terminal.'))
      }, 15000)
      this.pending.set(id, { command: { ...command, id }, resolve, reject, timer })
    })
  }
  async command(command: ConversationCommand): Promise<ConversationSnapshot> {
    if (command.type === 'mode') {
      if (!['terminal', 'conversation'].includes(command.mode)) throw new Error('Invalid display mode')
      if (this.state.mode !== command.mode) { this.state.mode = command.mode; this.state.controlEpoch++; this.changed() }
      return this.snapshot()
    }
    if (this.disposed || this.broken || this.state.connection !== 'ready') throw new Error('Claude conversation is not ready')
    if (this.state.mode !== 'conversation' || command.controlEpoch !== this.state.controlEpoch) throw new Error('Display control changed; action rejected')
    if (command.type === 'models') { await this.loadModels() }
    else if (command.type === 'settings') {
      if (this.state.settingsUpdating || this.state.submitting || this.state.turnId || this.state.approvals.length || this.state.needsTerminal) throw new Error('Wait until Claude is idle before changing settings')
      const model = this.state.models.find(option => option.model === command.model)
      if (!model || this.state.modelsLoading || this.state.modelsError) throw new Error('Claude model is not available; refresh the catalog')
      if (command.effort !== null && !model.efforts.some(option => option.effort === command.effort)) throw new Error('Unsupported Claude effort for this model')
      this.state.settingsUpdating = true; this.changed()
      try { await this.call({ type: 'settings', model: command.model, effort: command.effort }) }
      finally { this.state.settingsUpdating = false; this.changed() }
    } else if (command.type === 'send') {
      if (typeof command.commandId !== 'string' || !command.commandId || command.commandId.length > 128) throw new Error('Invalid command identity')
      const previous = this.sent.get(command.commandId)
      if (previous) { if (previous.text !== command.text) throw new Error('Command identity reused with different text'); await previous.result; return this.snapshot() }
      if (this.sent.size >= 2000) throw new Error('Conversation command limit reached; create a new session')
      if (typeof command.text !== 'string' || !command.text.trim() || command.text.length > MAX_TEXT) throw new Error('Invalid message')
      if (parseConversationSlashCommand(command.text)) throw new Error('Use the command menu or native terminal for slash commands')
      if (this.state.turnId || this.state.submitting || this.state.settingsUpdating || this.state.approvals.length || this.state.needsTerminal) throw new Error('Claude is busy or needs terminal input')
      this.state.submitting = true; this.state.error = undefined; this.changed()
      const result = (async () => {
        const before = this.sequence
        let ack: Json
        try { ack = await this.reply({ op: 'reply', short: this.short, text: command.text, nextTurn: true }) } catch (error) {
          this.broken = true; this.fail('Claude delivery is unknown. Check the terminal; this message will not be resent.')
          throw error
        }
        if (!ack.ok) throw new Error(String(ack.error ?? 'Claude refused submission'))
        // Daemon ack alone is not delivery. Wait for the observed native user turn.
        for (let i = 0; i < 100; i++) {
          if (this.disposed || this.broken) break
          if (this.lastTurnSequence > before && this.state.items.some(item => item.type === 'userMessage' && item.id === `user:${this.lastTurn}` && item.text === command.text)) return
          await pause(100)
        }
        this.broken = true; this.fail('Claude delivery is unknown. Check the terminal; this message will not be resent.')
        throw new Error('Claude delivery unknown; check the terminal before sending again')
      })()
      this.sent.set(command.commandId, { text: command.text, result })
      try { await result } finally { this.state.submitting = false; this.changed() }
    } else if (command.type === 'interrupt') {
      if (this.state.submitting || this.state.settingsUpdating) throw new Error('Claude control is busy')
      const turnId = this.state.turnId ?? [...this.tools.values()].reverse().find(tool => tool.active)?.turnId ?? this.lastTurn
      if (!turnId) return this.snapshot()
      const selected = [...this.tools].filter(([, tool]) => tool.turnId === turnId && tool.active)
      this.state.submitting = true; this.changed()
      for (const [id] of selected) this.expireToolApproval(id)
      try {
        const outcome = await this.call({ type: 'stop', turnId, toolIds: selected.map(([id]) => id), taskIds: selected.flatMap(([, tool]) => tool.taskId ? [tool.taskId] : []) })
        for (const taskId of outcome.stopped ?? []) this.receive({ type: 'task.complete', data: { taskId, status: 'killed' } })
        for (const [id, tool] of selected) {
          const history = outcome.history?.find((value: Json) => value.tool_use_id === id)
          const taskId = tool.taskId ?? history?.result?.backgroundTaskId
          if (taskId && !outcome.stopped?.includes(taskId)) throw new Error('A background task is still running. Use the terminal to stop it.')
          if (!taskId && tool.name === 'Bash' && !history?.result) throw new Error('Bash termination is unknown. Check the terminal.')
          tool.active = false
          const item = this.state.items.find(value => value.id === `tool:${id}`)
          if (item) item.status = 'interrupted'
        }
        this.state.backgroundTasks = [...this.tools.values()].filter(value => value.active).length
      } finally { this.state.submitting = false; this.changed() }
    } else if (command.type === 'approve') {
      const id = String(command.requestId)
      if (!this.approvals.has(id)) throw new Error('Approval expired; check current execution state')
      if (!['accept', 'decline'].includes(command.decision)) throw new Error('Invalid approval decision')
      this.finishApproval(id, { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: command.decision === 'accept' ? { behavior: 'allow' } : { behavior: 'deny', message: 'User declined in JanusX' } } })
    } else throw new Error('Change Claude model and effort in the native terminal')
    return this.snapshot()
  }
  acceptsTerminalInput(data: string): boolean { return (this.state.mode === 'terminal' && !this.state.settingsUpdating) || /^\x1b\[[?\d;]*[Rcn]$/.test(data) }
  dispose(): Promise<void> {
    if (this.stopping) return this.stopping
    this.disposed = true
    this.catalogAbort.abort()
    this.stopping = (async () => {
      // Wait for any native dispatch and asset creation before cleaning up.
      // launch checks disposed after every phase that could create a worker.
      await this.startup?.catch(() => {})
      await this.loadingModels
      if (this.heartbeat) clearInterval(this.heartbeat)
      if (this.publishTimer) clearTimeout(this.publishTimer)
      for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error('Claude session closed')) }
      this.pending.clear()
      for (const id of this.approvals.keys()) this.finishApproval(id, {})
      // The supervisor can host unrelated terminals. Stop only our recorded job;
      // never daemon stop --any, and never remove native user configuration.
      let stopped = !this.short
      try { if (this.short) await this.cli(['stop', this.short], 10000); stopped = true }
      catch (error) { this.state.error = `Claude worker ${this.short} could not be stopped. Use the native terminal to stop it. ${String(error).slice(0, 500)}`; throw error }
      finally {
        this.server?.closeAllConnections(); this.server?.close()
        if (stopped && this.directory) await rm(this.directory, { recursive: true, force: true })
        this.state.connection = stopped ? 'closed' : 'disconnected'; this.state.turnId = null; this.state.approvals = []; this.changed()
      }
    })()
    return this.stopping
  }
}
