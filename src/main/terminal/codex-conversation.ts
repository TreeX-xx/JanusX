import { toolActivity } from '../../shared/work-output'
import { createHash } from 'node:crypto'
import { ConversationCatalog, type NativeCatalogEntry } from './conversation-catalog'
import { ConversationSession, conversationState } from './conversation-session'
import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { existsSync } from 'node:fs'
import { delimiter, dirname, extname, join } from 'node:path'
import WebSocket, { WebSocketServer } from 'ws'
import { CodexStartup } from './codex-startup'
import type { ConversationCommand, ConversationItem, ConversationSnapshot, ConversationModelOption } from '../../shared/conversation-display'
import { CODEX_CONVERSATION_CAPABILITIES } from '../../shared/conversation-display'
import { codexApprovalChoices, codexQuestions } from './codex-questions'
import { hasBlockingQuestions } from '../../shared/conversation-questions'

type Json = Record<string, any> // Codex's versioned JSON-RPC boundary; normalized before IPC.
class CodexRequestError extends Error {
  constructor(readonly method: string, readonly code: number | undefined, message: string) { super(message) }
}
// Session speed state and icon contract: .agents/notes/workbench/terminal-dialog-dual-mode.md
const MAX_ITEMS = 500
const MAX_TEXT = 32_000
// Native startup plugin/list catalogs can exceed 25 MiB. Match ws's default
// transport ceiling; display limits must not truncate native protocol messages.
const MAX_PAYLOAD = 100 * 1024 * 1024

/** Codex's native remote transport honors proxy variables, including for localhost. */
export function codexLoopbackEnv(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const bypass = [...new Set([
    ...Object.entries(source).filter(([key]) => key.toLowerCase() === 'no_proxy').flatMap(([, value]) => (value ?? '').split(',')),
    '127.0.0.1', 'localhost', '::1',
  ].map(value => value.trim()).filter(Boolean))].join(',')
  return { ...source, NO_PROXY: bypass, no_proxy: bypass }
}

/** npm's Windows shim cannot be spawned with shell:false. Never interpolate Hook TOML in a shell. */
export function resolveCodexServerBinary(command: string): string {
  if (process.platform !== 'win32' || extname(command).toLowerCase() === '.exe') return command
  const arch = process.arch === 'arm64' ? 'aarch64' : 'x86_64'
  const platform = process.arch === 'arm64' ? 'arm64' : 'x64'
  const packageRoot = join(dirname(command), 'node_modules', '@openai', 'codex')
  const candidates = [
    join(packageRoot, 'node_modules', '@openai', `codex-win32-${platform}`, 'vendor', `${arch}-pc-windows-msvc`, 'bin', 'codex.exe'),
    join(packageRoot, 'vendor', `${arch}-pc-windows-msvc`, 'bin', 'codex.exe'),
  ]
  const binary = candidates.find(existsSync)
  if (!binary) throw new Error('Codex dual mode requires a native codex.exe (npm installation supported).')
  return binary
}

export class CodexConversation {
  readonly state: ConversationSnapshot
  private session: ConversationSession
  private catalog: ConversationCatalog
  private cwd = ''
  private child?: ChildProcess
  private socket?: WebSocket
  private proxy?: WebSocketServer
  private nativeClient?: WebSocket
  private disposed = false
  private stopping?: Promise<void>
  private requestId = 0
  private pending = new Map<string, { method: string; resolve(value: Json): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>()
  private nativeThreadRequests = new Set<string | number>()
  private otherRequests = new Set<string | number>()
  private approvalDecisions = new Map<string | number, Map<string, unknown>>()
  private lastCompletedTurnId?: string
  private endpoint = ''
  private loadingModels?: Promise<void>
  private nativeInput?: (text: string) => void
  private newThread?: { allowStart: boolean; resolve(): void; reject(error: Error): void }
  private startup = new CodexStartup((method, params) => this.call(method, params), startup => { this.state.startup = startup; this.changed() })

  setNativeInput(write: (text: string) => void): void { this.nativeInput = write; this.session.setNativeInput(write) }

  constructor(readonly id: string, publish: (state: ConversationSnapshot) => void,
    private readonly bind: (threadId: string, transcriptPath?: string) => void = () => {}) {
    this.state = conversationState(id, 'codex', CODEX_CONVERSATION_CAPABILITIES)
    this.session = new ConversationSession(this.state, publish)
    this.state.capabilities = { ...this.state.capabilities, commands: true, questions: true }
    this.catalog = new ConversationCatalog(this.session, () => this.loadCommands())
  }

  snapshot(): ConversationSnapshot { return this.session.snapshot() }
  private changed(immediate = true): void { this.session.changed(immediate) }

  async start(options: { command: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv; pathDir?: string; assetsDir?: string }): Promise<{ command: string; args: string[]; env: NodeJS.ProcessEnv }> {
    this.cwd = options.cwd
    this.session.configureImages(options.assetsDir ? join(options.assetsDir, 'images') : '', options.cwd)
    const command = resolveCodexServerBinary(options.command)
    const env = codexLoopbackEnv(options.env)
    const pathKey = Object.keys(env).find(key => key.toLowerCase() === 'path') ?? 'PATH'
    if (options.pathDir) env[pathKey] = `${options.pathDir}${delimiter}${env[pathKey] ?? ''}`
    if (this.disposed) throw new Error('Codex launch cancelled')
    const reservation = createServer()
    await new Promise<void>((resolve, reject) => { reservation.once('error', reject); reservation.listen(0, '127.0.0.1', resolve) })
    const address = reservation.address()
    if (!address || typeof address === 'string') throw new Error('Could not reserve Codex listener')
    this.endpoint = `ws://127.0.0.1:${address.port}`
    await new Promise<void>(resolve => reservation.close(() => resolve()))
    if (this.disposed) throw new Error('Codex launch cancelled')
    this.child = spawn(command, [...options.args.filter(arg => arg !== '--no-daemon'), '-c', 'tools.update_plan.enabled=true', 'app-server', '--listen', this.endpoint],
      { cwd: options.cwd, env, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] })
    let diagnostic = ''
    this.child.stderr?.on('data', bytes => { diagnostic = (diagnostic + String(bytes)).slice(-4000) })
    this.child.on('error', error => this.fail(error.message))
    this.child.on('exit', () => { if (!this.disposed) this.fail(`Codex backend exited. ${diagnostic}`) })
    const deadline = Date.now() + 10000
    while (!this.disposed && Date.now() < deadline) {
      if (this.child.exitCode !== null) throw new Error(`Codex backend failed to start. ${diagnostic}`)
      // An explicit agent prevents the host's global HTTP proxy hook from
      // intercepting our process-local channel. Native TUI routing uses NO_PROXY.
      const probe = new WebSocket(this.endpoint, { handshakeTimeout: 1000, agent: false })
      const ready = await new Promise<boolean>(resolve => { probe.once('open', () => resolve(true)); probe.once('error', () => resolve(false)) })
      probe.terminate()
      if (ready && !this.disposed) {
        this.proxy = new WebSocketServer({ host: '127.0.0.1', port: 0, maxPayload: MAX_PAYLOAD,
          verifyClient: (info: { origin: string }) => !info.origin })
        await new Promise<void>((resolve, reject) => { this.proxy!.once('listening', resolve); this.proxy!.once('error', reject) })
        this.proxy.on('error', error => this.fail(error.message))
        this.proxy.on('connection', downstream => {
          if (this.nativeClient || this.disposed) { downstream.close(); return }
          this.nativeClient = downstream
          this.connect(downstream)
        })
        const proxyAddress = this.proxy.address()
        if (!proxyAddress || typeof proxyAddress === 'string') throw new Error('Codex bridge is unavailable')
        if (this.disposed) { this.proxy.close(); throw new Error('Codex launch cancelled') }
        return { command, args: ['-c', 'tools.update_plan.enabled=true', '--cd', options.cwd, '--remote', `ws://127.0.0.1:${proxyAddress.port}`],
          env: { NO_PROXY: env.NO_PROXY, no_proxy: env.no_proxy } }
      }
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    throw new Error('Codex backend did not become ready')
  }

  private connect(downstream: WebSocket): void {
    const socket = new WebSocket(this.endpoint, { handshakeTimeout: 1500, maxPayload: MAX_PAYLOAD, agent: false })
    this.socket = socket
    const queue: string[] = []
    downstream.on('message', bytes => {
      let text = bytes.toString()
      try {
        const message = JSON.parse(text) as Json
        if (this.state.mode === 'conversation' && !this.state.threadId) this.startup.observeRequest(message)
        if (!this.acceptsNativeCommand(message)) {
          if (message.method && message.id !== undefined) downstream.send(JSON.stringify({ id: message.id, error: { code: -32600, message: 'JanusX conversation view owns input' } }))
          return
        }
        if ((message.method === 'thread/start' && !message.params?.ephemeral && message.params?.threadSource !== 'thread_title') || message.method === 'thread/resume') {
          // New sessions start at standard speed even when native config defaults to fast.
          // Resumes retain the saved session choice; later settings updates pass through.
          if (message.method === 'thread/start') {
            message.params = { ...message.params, serviceTier: 'default' }
            text = JSON.stringify(message)
          }
          this.nativeThreadRequests.add(message.id)
        }
      } catch { downstream.close(); return }
      if (socket.readyState === WebSocket.OPEN) socket.send(text)
      else if (queue.length < 100) queue.push(text)
      else downstream.close()
    })
    downstream.on('error', error => this.fail(error.message))
    downstream.on('close', () => socket.terminate())
    socket.on('open', () => { for (const text of queue) socket.send(text); queue.length = 0 })
    socket.on('message', bytes => {
      try {
        const message = JSON.parse(bytes.toString()) as Json
        if (typeof message.id === 'string' && message.id.startsWith('janusx:') && !message.method) {
          const pending = this.pending.get(message.id)
          if (!pending) return
          clearTimeout(pending.timer); this.pending.delete(message.id)
          if (message.error) pending.reject(new CodexRequestError(pending.method, message.error.code, message.error.message ?? 'Codex request failed'))
          else pending.resolve(message.result ?? {})
        } else {
          if (!this.state.threadId && this.startup.intercept(message, reply => {
            if (downstream.readyState === WebSocket.OPEN) downstream.send(JSON.stringify(reply))
          })) return
          void this.startup.receive(message)
          if (!message.method && this.nativeThreadRequests.delete(message.id) && message.result?.thread) {
            const oldThreadId = this.state.threadId
            this.attach(message.result.thread, message.result)
            if (this.newThread && oldThreadId !== this.state.threadId) this.newThread.resolve()
            void this.loadModels()
          }
          if (downstream.readyState === WebSocket.OPEN) downstream.send(bytes.toString())
          // The native connection is the authoritative subscription, including empty threads.
          // Control responses are intercepted above; native responses pass through unchanged.
          this.receive(message)
        }
      } catch (error) { this.fail(String(error)) }
    })
    socket.on('error', error => this.fail(error.message))
    socket.on('close', () => {
      for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error('Codex connection closed; delivery may be unknown. Do not automatically resend.')) }
      this.pending.clear()
      downstream.close()
      if (!this.disposed) this.fail(this.state.error ?? 'Codex local connection lost. No request will be resent. Check the native terminal for details.')
    })
  }

  private send(message: Json): void {
    if (this.disposed || this.socket?.readyState !== WebSocket.OPEN) throw new Error('Codex connection is unavailable')
    this.socket.send(JSON.stringify(message))
  }
  private call(method: string, params: Json): Promise<Json> {
    const id = `janusx:${++this.requestId}`
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method} timed out; delivery may be unknown. Do not automatically resend.`)) }, 15000)
      this.pending.set(id, { method, resolve, reject, timer })
      try { this.send({ id, method, params }) } catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error) }
    })
  }
  private fail(error: string): void {
    if (this.disposed) return
    this.session.questions.disconnected(error)
    this.newThread?.reject(new Error(error))
    this.startup.dispose(); this.state.startup = undefined
    this.state.connection = 'disconnected'; this.state.error = error.slice(0, 4000); this.changed()
  }

  private attach(thread: Json, settings: Json = {}): void {
    if (this.state.threadId !== thread.id) this.state.capabilities = { ...this.state.capabilities, edit: true }
    if (this.state.threadId && this.state.threadId !== thread.id) {
      this.state.items = []; this.state.approvals = []; this.state.turnId = null; this.state.turnStartedAt = undefined
      this.state.plans = []
      this.state.needsTerminal = false; this.state.truncated = false; this.state.controlEpoch++
      this.otherRequests.clear()
      this.session.questions.clear(); this.approvalDecisions.clear()
    }
    this.state.threadId = thread.id
    this.state.serviceTier = undefined
    this.updateSettings(settings)
    this.bind(thread.id, thread.path ?? undefined)
    for (const turn of thread.turns ?? []) {
      for (const item of turn.items ?? []) this.item(item, turn.id, turn.status !== 'inProgress')
      if (turn.status === 'inProgress') this.state.turnId = turn.id
    }
    this.state.connection = 'ready'; this.changed()
  }

  private updateSettings(settings: Json): void {
    if (typeof settings.serviceTier === 'string' || settings.serviceTier === null) this.state.serviceTier = settings.serviceTier
    if (typeof settings.model === 'string') this.state.model = settings.model
    const effort = Object.hasOwn(settings, 'effort') ? settings.effort : settings.reasoningEffort
    if (typeof effort === 'string' || effort === null) this.state.effort = effort
  }

  private loadModels(): Promise<void> {
    if (this.loadingModels) return this.loadingModels
    this.state.modelsLoading = true; this.state.modelsError = undefined; this.changed()
    this.loadingModels = (async () => {
      try {
        const models = new Map<string, ConversationModelOption>()
        const cursors = new Set<string>()
        let cursor: string | undefined
        do {
          const result = await this.call('model/list', { limit: 100, ...(cursor ? { cursor } : {}) })
          if (!Array.isArray(result.data)) throw new Error('Invalid Codex model catalog')
          for (const raw of result.data) {
            if (raw.hidden || typeof raw.model !== 'string' || !raw.model) continue
            const efforts = (Array.isArray(raw.supportedReasoningEfforts) ? raw.supportedReasoningEfforts : [])
              .filter((option: Json) => typeof option.reasoningEffort === 'string')
              .map((option: Json) => ({ effort: option.reasoningEffort as string, description: String(option.description ?? '').slice(0, 1000) }))
            const tiers = Array.isArray(raw.serviceTiers) ? raw.serviceTiers.map((tier: Json) => tier.id) : raw.additionalSpeedTiers ?? []
            const fastTier = Array.isArray(tiers) ? tiers.find((tier: unknown) => tier === 'fast' || tier === 'priority') : undefined
            models.set(raw.model, { model: raw.model, fastTier, displayName: String(raw.displayName || raw.model), description: String(raw.description ?? '').slice(0, 2000),
              defaultEffort: efforts.some((option: { effort: string }) => option.effort === raw.defaultReasoningEffort) ? raw.defaultReasoningEffort : efforts[0]?.effort ?? null, efforts })
          }
          cursor = typeof result.nextCursor === 'string' && result.nextCursor ? result.nextCursor : undefined
          if (cursor && (cursors.has(cursor) || cursors.size >= 9 || models.size > 500)) throw new Error('Codex model catalog pagination limit reached')
          if (cursor) cursors.add(cursor)
        } while (cursor)
        if (!this.disposed) this.state.models = [...models.values()]
      } catch (error) {
        if (!this.disposed) this.state.modelsError = String(error).slice(0, 2000)
      } finally {
        this.loadingModels = undefined; this.state.modelsLoading = false
        if (!this.disposed) this.changed()
      }
    })()
    return this.loadingModels
  }

  private item(raw: Json, turnId: string, done: boolean): void {
    if (typeof raw.id !== 'string' || typeof raw.type !== 'string') return
    const key = `${turnId}:${raw.id}`
    const previous = this.state.items.find(item => item.id === key)
    const text = raw.type === 'userMessage' ? (raw.content ?? []).filter((part: Json) => part.type === 'text').map((part: Json) => part.text).join('\n')
      : raw.type === 'agentMessage' ? raw.text ?? previous?.text ?? ''
        : raw.type === 'commandExecution' ? `${raw.command ?? ''}\n${raw.aggregatedOutput ?? ''}` : raw.text ?? raw.summary ?? ''
    const normalized: ConversationItem = { id: key, turnId, type: raw.type, receivedAt: previous?.receivedAt ?? Date.now(), durationMs: previous?.durationMs,
      phase: raw.phase === 'commentary' || raw.phase === 'final_answer' ? raw.phase : previous?.phase,
      editable: raw.type === 'userMessage' ? raw.content?.every((part: Json) => part.type === 'text') : undefined,
      text: typeof text === 'string' ? text.slice(0, MAX_TEXT) : '', status: raw.status ?? (done ? 'completed' : 'inProgress'),
      truncated: typeof text === 'string' && text.length > MAX_TEXT }
    if (raw.type === 'imageGeneration') {
      normalized.text = String(raw.revisedPrompt ?? '').slice(0, MAX_TEXT)
      normalized.status = raw.failure || raw.status === 'failed' ? 'failed' : raw.status === 'interrupted' ? 'interrupted' : done ? 'completed' : 'inProgress'
      normalized.images = previous?.images
      if (raw.failure) normalized.text = JSON.stringify(raw.failure).slice(0, MAX_TEXT)
    }
    if (raw.type === 'fileChange') {
      let remaining = MAX_TEXT
      normalized.files = (raw.changes ?? []).slice(0, 100).flatMap((file: Json) => {
        const filePath = String(file.path)
        if (filePath.length > remaining) { normalized.truncated = true; return [] }
        remaining -= filePath.length
        const diff = String(file.diff ?? '')
        const preview = diff.slice(0, remaining)
        remaining -= preview.length
        normalized.truncated ||= preview.length !== diff.length
        return [{ path: filePath, diff: preview }]
      })
      normalized.truncated ||= (raw.changes?.length ?? 0) > 100
    }
    if (raw.type === 'commandExecution') normalized.activity = toolActivity('', { command: raw.command }) || previous?.activity
    else if (raw.type === 'fileChange') normalized.activity = toolActivity('Edit', { path: normalized.files?.map(file => file.path).join(', ') })
    else if (raw.type === 'mcpToolCall' || raw.type === 'dynamicToolCall') normalized.activity = toolActivity(String(raw.tool ?? raw.type), raw.arguments && typeof raw.arguments === 'object' ? raw.arguments : {})
    if (previous) Object.assign(previous, normalized)
    else this.state.items.push(normalized)
    this.trimHistory()
    if (raw.type === 'imageGeneration' && done && normalized.status === 'completed') this.session.attachImages(key, [{ path: raw.savedPath ?? undefined, data: raw.result || undefined }])
    else if (done) this.session.discoverImages(key)
  }

  private trimHistory(): void {
    const size = (item: ConversationItem) => item.text.length + (item.files ?? []).reduce((sum, file) => sum + file.path.length + file.diff.length, 0)
    let chars = this.state.items.reduce((sum, item) => sum + size(item), 0)
    while (this.state.items.length > 1 && (this.state.items.length > MAX_ITEMS || chars > 1_000_000)) {
      chars -= size(this.state.items.shift()!); this.state.truncated = true
    }
  }

  private receive(message: Json): void {
    const { method, params: p = {} } = message
    // Only a native thread/start or thread/resume response selects the visible conversation.
    // Global announcements can describe title generation or subagents and never select it.
    if (method === 'serverRequest/resolved') {
      this.state.approvals = this.state.approvals.filter(approval => approval.id !== p.requestId)
      this.approvalDecisions.delete(p.requestId); this.session.questions.resolve(p.requestId)
      this.otherRequests.delete(p.requestId); this.state.needsTerminal = this.otherRequests.size > 0
      this.changed(); return
    }
    if (!this.state.threadId || p.threadId !== this.state.threadId) return
    if (method === 'thread/settings/updated') this.updateSettings(p.threadSettings ?? {})
    else if (method === 'turn/plan/updated') {
      // Only the active turn may publish a new revision; never revive an old plan.
      if (typeof p.turnId !== 'string' || p.turnId !== this.state.turnId || !Array.isArray(p.plan) || p.plan.length > 100
        || !p.plan.every((step: Json) => step && typeof step.step === 'string' && step.step.length <= 2000 && ['pending', 'inProgress', 'completed'].includes(step.status))) return
      const plans = this.state.plans ?? []
      const previous = [...plans].reverse().find(plan => plan.turnId === p.turnId)
      const steps = p.plan.map((step: Json) => ({ step: step.step, status: step.status }))
      const explanation = typeof p.explanation === 'string' ? p.explanation.slice(0, 4000) : ''
      if (previous && JSON.stringify(previous.steps) === JSON.stringify(steps) && previous.explanation === explanation) return
      this.state.plans = [...plans, { turnId: p.turnId, version: (previous?.version ?? 0) + 1, steps, explanation, outcome: 'running' as const }].slice(-100)
    }
    else if (method === 'turn/started') { this.state.turnStartedAt = Date.now(); this.state.turnId = p.turn.id; this.state.error = undefined }
    else if (method === 'turn/completed') {
      const outcome = ['completed', 'interrupted', 'failed'].includes(p.turn.status) ? p.turn.status : 'failed'
      this.state.plans = this.state.plans?.map(plan => plan.turnId === p.turn.id ? { ...plan, outcome } : plan)
      if (this.state.turnId === p.turn.id && this.state.turnStartedAt !== undefined) {
        const durationMs = Math.max(0, Date.now() - this.state.turnStartedAt)
        for (const item of this.state.items) if (item.turnId === p.turn.id && item.type === 'agentMessage') item.durationMs = durationMs
        this.state.turnStartedAt = undefined
      }
      this.lastCompletedTurnId = p.turn.id
      if (this.state.turnId === p.turn.id) this.state.turnId = null
      for (const item of this.state.items) if (item.turnId === p.turn.id && item.status === 'inProgress') item.status = p.turn.status
      this.state.approvals = []; this.otherRequests.clear(); this.state.needsTerminal = false
      this.approvalDecisions.clear()
      for (const request of this.state.questions ?? []) if (request.turnId === p.turn.id && request.blocking !== false) this.session.questions.resolve(request.id)
      if (p.turn.error) this.state.error = String(p.turn.error.message ?? 'Turn failed')
    } else if (method === 'item/started' || method === 'item/completed') this.item(p.item, p.turnId, method === 'item/completed')
    else if (method === 'item/agentMessage/delta') {
      const key = `${p.turnId}:${p.itemId}`
      let item = this.state.items.find(item => item.id === key)
      if (!item) { this.item({ id: p.itemId, type: 'agentMessage', text: '' }, p.turnId, false); item = this.state.items.find(item => item.id === key)! }
      const next = item.text + String(p.delta ?? '')
      item.text = next.slice(0, MAX_TEXT); item.truncated ||= next.length > MAX_TEXT
      this.trimHistory()
      this.changed(false); return
    } else if (method === 'item/commandExecution/requestApproval' || method === 'item/fileChange/requestApproval') {
      if (!this.state.approvals.some(approval => approval.id === message.id)) {
        const file = method.includes('fileChange')
        const { choices, decisions } = codexApprovalChoices(p, file)
        this.approvalDecisions.set(message.id, decisions)
        this.state.approvals.push({ id: message.id, itemId: p.itemId, kind: file ? 'file' : 'command', description: [p.command, p.reason].filter(Boolean).join('\n').slice(0, MAX_TEXT), choices })
      }
    } else if (method === 'item/tool/requestUserInput' && message.id !== undefined) {
      const questions = codexQuestions(p.questions)
      if (!questions) { this.otherRequests.add(message.id); this.state.needsTerminal = true }
      else this.session.questions.ask({ id: message.id, itemId: p.itemId, turnId: p.turnId, questions, blocking: p.isBlocking !== false, cancelable: true }, answer => {
        this.send({ id: message.id, result: { answers: Object.fromEntries(questions.map(question => {
          const row = answer.answers.find(row => row.id === question.id)
          return [question.id, { answers: !row || answer.cancelled ? [] : [...row.selected.map(id => question.options.find(option => option.id === id)!.label), ...(row.text?.trim() ? [`user_note: ${row.text}`] : [])] }]
        })) } })
      }, 'event')
    } else if (message.id !== undefined && method) { this.otherRequests.add(message.id); this.state.needsTerminal = true }
    else if (method === 'error') this.state.error = String(p.error?.message ?? 'Codex error')
    else return
    this.changed()
  }

  private async loadCommands(): Promise<NativeCatalogEntry[]> {
    const result = await this.call('skills/list', { cwds: [this.cwd], forceReload: true })
    if (!Array.isArray(result.data)) throw new Error('Invalid Codex skill catalog')
    const skills = result.data.flatMap((group: Json) => group.skills ?? [])
    return skills.filter((row: Json) => row.enabled !== false && typeof row.name === 'string' && typeof row.path === 'string').map((row: Json) => ({
      id: 'skill:' + createHash('sha256').update(row.path).digest('hex'), name: row.name, label: row.interface?.displayName || row.name,
      description: String(row.interface?.shortDescription || row.description || '').slice(0, 2000), kind: 'skill' as const,
      source: String(row.scope ?? 'codex'), execution: 'native' as const,
      invoke: async (args: string) => {
        const result = await this.call('turn/start', { threadId: this.state.threadId, input: [
          { type: 'text', text: '$' + row.name + (args ? ' ' + args : ''), text_elements: [] },
          { type: 'skill', name: row.name, path: row.path },
        ] })
        if (result.turn?.id && this.lastCompletedTurnId !== result.turn.id) this.state.turnId = result.turn.id
      },
    }))
  }

  async command(command: ConversationCommand): Promise<ConversationSnapshot> {
    if (command.type === 'mode' && this.socket && this.state.connection === 'starting' && command.mode !== this.state.mode) throw new Error('Complete startup before switching views')
    if (command.type === 'mode') return this.session.mode(command, this.disposed)
    if (command.type === 'startup') {
      if (this.disposed || this.state.connection !== 'starting' || this.state.mode !== 'conversation' || command.controlEpoch !== this.state.controlEpoch) throw new Error('Startup control changed; action rejected')
      await this.startup.command(command)
      return this.snapshot()
    }
    this.session.guard(command, this.disposed)
    if (command.type === 'terminal-command') { await this.session.terminalCommand(command); return this.snapshot() }
    if (command.type === 'answer') { await this.session.questions.answer(command.requestId, command.version, command.answer); return this.snapshot() }
    if (command.type === 'commands' || command.type === 'invoke') { await this.catalog.command(command); return this.snapshot() }
    if (command.type === 'new') {
      if (!this.nativeInput) throw new Error('Native Codex input is unavailable')
      if (this.state.turnId || this.state.submitting || this.state.settingsUpdating || this.state.approvals.length || hasBlockingQuestions(this.state) || this.state.needsTerminal) throw new Error('Wait until Codex is idle before starting a new conversation')
      this.state.submitting = true; this.state.error = undefined; this.changed()
      let timeout: ReturnType<typeof setTimeout> | undefined
      let enter: ReturnType<typeof setTimeout> | undefined
      try {
        await new Promise<void>((resolve, reject) => {
          this.newThread = { allowStart: true, resolve, reject }
          timeout = setTimeout(() => reject(new Error('Codex new conversation could not be confirmed. Check the terminal before retrying.')), 15000)
          // Let the native client own selection and subscription, just as its /new does.
          // Clear both sides of the native cursor before invoking the fixed command.
          this.nativeInput!('\x15\x0b/new')
          enter = setTimeout(() => { try { this.nativeInput!('\r') } catch (error) { reject(error as Error) } }, 150)
        })
      } catch (error) { this.fail(String(error)); throw error }
      finally {
        clearTimeout(timeout); clearTimeout(enter); this.newThread = undefined
        this.state.submitting = false; this.changed()
      }
    } else if (command.type === 'models') {
      await this.loadModels()
    } else if (command.type === 'speed') {
      if (this.state.settingsUpdating || this.state.submitting) throw new Error('Codex settings update is busy')
      if (typeof command.fast !== 'boolean' || this.state.serviceTier === undefined) throw new Error('Codex speed state is unavailable')
      const fastTier = this.state.models.find(model => model.model === this.state.model)?.fastTier
      if (command.fast && !fastTier) throw new Error('Fast mode is not supported by the current model catalog')
      this.state.settingsUpdating = true; this.changed()
      try {
        await this.call('thread/settings/update', { threadId: this.state.threadId, serviceTier: command.fast ? fastTier : null })
      } finally { this.state.settingsUpdating = false; this.changed() }
    } else if (command.type === 'settings') {
      if (this.state.settingsUpdating || this.state.submitting) throw new Error('Codex settings update is busy')
      const model = this.state.models.find(option => option.model === command.model)
      if (!model) throw new Error('Model is not in the current Codex catalog')
      if (command.effort === null ? model.efforts.length > 0 : !model.efforts.some(option => option.effort === command.effort)) throw new Error('Unsupported reasoning effort for this model')
      this.state.settingsUpdating = true; this.changed()
      try {
        // The server broadcasts thread/settings/updated to the native TUI as well.
        // Use that authoritative event for the displayed selection; no config-file write.
        await this.call('thread/settings/update', { threadId: this.state.threadId, model: command.model, effort: command.effort })
      } finally { this.state.settingsUpdating = false; this.changed() }
    } else if (command.type === 'send' || command.type === 'edit') {
      await this.session.submit(command, async () => {
        const target = command.type === 'edit' ? this.state.items.find(item => item.id === command.itemId) : undefined
        if (command.type === 'edit' && (!this.state.capabilities.edit || !target || target.type !== 'userMessage' || target.truncated || target.editable === false
          || this.state.items.filter(item => item.turnId === target.turnId && item.type === 'userMessage').length !== 1)) throw new Error('This message cannot be edited safely')
        let historyReadFailed = false
        try {
          if (target) {
            // Version 0.166 exposes revert, not the removed rollback API. Native
            // clients receive thread/reverted and reload the same thread.
            let result: Json
            try { result = await this.call('thread/revert', { threadId: this.state.threadId, beforeTurnId: target.turnId }) }
            catch (error) {
              // Codex 0.166 rejects this history read before reverting anything.
              // Other RPC errors, timeouts and failures after revert stay uncertain.
              // Recovery contract: .agents/notes/workbench/terminal-dialog-dual-mode.md
              if (error instanceof CodexRequestError && error.method === 'thread/revert' && error.code === -32603 &&
                error.message.startsWith('failed to list thread history: thread-store internal error: failed to open thread history database:')) {
                historyReadFailed = true
                this.state.capabilities = { ...this.state.capabilities, edit: false }; this.changed()
                throw new Error(`Codex could not read thread history. Your edited message was not sent and the original history was kept. You can send it as a new message or cancel editing to continue. ${error.message}`)
              }
              throw error
            }
            if (result.thread?.id !== this.state.threadId) throw new Error('Invalid Codex edit response')
            const index = this.state.items.findIndex(item => item.turnId === target.turnId)
            this.state.items = this.state.items.slice(0, index)
            const retained = new Set(this.state.items.map(item => item.turnId))
            this.state.plans = this.state.plans?.filter(plan => retained.has(plan.turnId))
            this.changed()
          }
          const imagePaths = command.type === 'send' ? command.imagePaths ?? [] : []
          if (!Array.isArray(imagePaths) || imagePaths.length > 8 || imagePaths.some(path => typeof path !== 'string' || path.length > 4096 || !/^(?:[a-z]:[\\/]|[\\/])/i.test(path))) throw new Error('Invalid image references')
          const input = [{ type: 'text', text: command.text, text_elements: [] }, ...imagePaths.map(path => ({ type: 'localImage', path }))]
          if (this.state.turnId) {
            // Pin the destination: a completion race must not silently start or steer another turn.
            await this.call('turn/steer', { threadId: this.state.threadId, expectedTurnId: this.state.turnId, input })
          } else {
            const result = await this.call('turn/start', { threadId: this.state.threadId, input })
            if (result.turn?.id && this.lastCompletedTurnId !== result.turn.id) this.state.turnId = result.turn.id
          }
        } catch (error) {
          if (target && !historyReadFailed) this.fail(`Codex edit delivery could not be confirmed. Check the terminal before retrying. ${String(error)}`)
          throw error
        }
      })
    } else if (command.type === 'interrupt') {
      if (this.state.turnId) await this.call('turn/interrupt', { threadId: this.state.threadId, turnId: this.state.turnId })
    } else if (command.type === 'approve') {
      const approval = this.state.approvals.find(item => item.id === command.requestId)
      if (!approval) throw new Error('Approval is no longer pending')
      const decisions = this.approvalDecisions.get(approval.id)
      if (!decisions?.has(command.decision)) throw new Error('Invalid approval decision')
      this.send({ id: approval.id, result: { decision: decisions.get(command.decision) } })
      this.approvalDecisions.delete(approval.id)
      this.state.approvals = this.state.approvals.filter(item => item !== approval); this.changed()
    } else throw new Error('Unknown conversation command')
    return this.snapshot()
  }

  acceptsTerminalInput(data: string): boolean {
    // Hidden xterm still answers terminal device queries; it must not submit user input.
    return this.state.mode === 'terminal'
      || /^\x1b\[[?\d;]*[Rcn]$/.test(data)
  }

  private acceptsNativeCommand(message: Json): boolean {
    if (this.newThread?.allowStart && message.method === 'thread/start' && !message.params?.ephemeral && message.params?.threadSource !== 'thread_title') {
      this.newThread.allowStart = false
      return true
    }
    if (this.state.settingsUpdating && message.method === 'turn/start' && message.params?.threadId === this.state.threadId) return false
    if (this.state.mode === 'terminal') return true
    if (['turn/start', 'turn/steer', 'turn/interrupt', 'thread/revert', 'thread/settings/update', 'turn/settings/update'].includes(message.method) && message.params?.threadId === this.state.threadId) return false
    if (this.state.threadId && (message.method === 'thread/resume' || (message.method === 'thread/start' && !message.params?.ephemeral))) return false
    if (!message.method && (this.state.approvals.some(approval => approval.id === message.id) || this.state.questions?.some(request => request.id === message.id) || this.otherRequests.has(message.id))) return false
    return true // Native subscriptions, device responses and title generation keep working.
  }

  dispose(): Promise<void> {
    if (this.disposed) return this.stopping ?? Promise.resolve()
    this.disposed = true; this.session.stop()
    this.startup.dispose(); this.state.startup = undefined
    this.newThread?.reject(new Error('Codex session ended'))
    this.socket?.terminate()
    this.nativeClient?.terminate()
    this.proxy?.close()
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error('Codex session ended')) }
    this.pending.clear()
    if (this.child?.pid && this.child.exitCode === null) {
      if (process.platform === 'win32') {
        const pid = this.child.pid
        this.stopping = new Promise(resolve => {
          const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
          killer.on('error', () => { this.child?.kill(); resolve() })
          killer.on('exit', () => resolve())
        })
      } else {
        this.child.kill()
        this.stopping = new Promise(resolve => {
          const timer = setTimeout(resolve, 2000)
          this.child!.once('exit', () => { clearTimeout(timer); resolve() })
        })
      }
    }
    this.state.connection = 'closed'; this.state.turnId = null; this.state.approvals = []; this.changed()
    return this.stopping ?? Promise.resolve()
  }
}

