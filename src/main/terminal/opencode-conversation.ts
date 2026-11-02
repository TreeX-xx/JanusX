import { spawn, execFile, type ChildProcess } from 'node:child_process'
import { promisify } from 'node:util'
import { randomBytes } from 'node:crypto'
import { dirname, extname, join, delimiter, resolve } from 'node:path'
import { createServer, request as httpRequest, type Server } from 'node:http'
import type { Socket } from 'node:net'
import { parse as parseJsonc, type ParseError } from 'jsonc-parser'
import { NativeConversation, type NativeLaunch } from './native-conversation'
import type { ConversationCommand, ConversationItem, ConversationSnapshot } from '../../shared/conversation-display'

type Json = Record<string, any> // Native API boundary; validate actual responses rather than CLI versions.
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

// Note: .agents/notes/workbench/terminal-dialog-dual-mode.md
// JanusX owns the outer tabs. Restoring shared native tabs mixes other panes'
// sessions into this one; override only the launched TUI, never its saved state.
export function openCodeTerminalConfig(content?: string): string {
  const errors: ParseError[] = []
  const config = content ? parseJsonc(content, errors, { allowTrailingComma: true }) : {}
  const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
  if (errors.length || !object(config) || (config.tabs !== undefined && !object(config.tabs))) {
    throw new Error('Invalid OPENCODE_CLI_CONFIG_CONTENT; expected a CLI configuration object')
  }
  return JSON.stringify({ ...config, tabs: { ...config.tabs as Record<string, unknown> | undefined, enabled: false, mode: 'off' } })
}

export class OpenCodeConversation extends NativeConversation {
  private child?: ChildProcess
  private endpoint = ''
  private password = randomBytes(32).toString('hex')
  private abort = new AbortController()
  private polling?: Promise<void>
  private proxy?: Server
  private sockets = new Set<Socket>()
  private rendered = new Map<string, string>()
  private lastUser = ''
  private startup?: Promise<{ command: string; args: string[]; env: Record<string, string> }>
  private stopping?: Promise<void>
  private directory = ''
  private loadingModels?: Promise<void>
  private modelRefs = new Map<string, { id: string; providerID: string }>()
  private defaultModel?: Json
  private settingsRevision = 0
  private historyRevision = 0
  private editingHistory = false
  private nativeSelectionRevision = 0
  private nativeSelectionsPending = 0
  private nativeSelectionUncertain = false
  constructor(id: string, publish: (snapshot: ConversationSnapshot) => void, bind?: (id: string) => void) {
    super(id, 'opencode', publish, bind)
    this.state.capabilities.settings = true
    this.state.capabilities.edit = true
  }
  start(options: NativeLaunch): Promise<{ command: string; args: string[]; env: Record<string, string> }> {
    if (this.startup || this.disposed) throw new Error('OpenCode session already started')
    this.startup = this.launch(options)
    return this.startup
  }
  private async launch(options: NativeLaunch): Promise<{ command: string; args: string[]; env: Record<string, string> }> {
    const terminalConfig = openCodeTerminalConfig(options.env.OPENCODE_CLI_CONFIG_CONTENT)
    this.directory = options.cwd
    const binary = process.platform === 'win32' && extname(options.command) !== '.exe'
      ? join(dirname(options.command), 'node_modules/@opencode/cli/bin/opencode.exe') : options.command
    const env: NodeJS.ProcessEnv = { ...options.env, OPENCODE_SERVER_PASSWORD: this.password }
    const pathKey = Object.keys(env).find(k => k.toLowerCase() === 'path') ?? 'PATH'
    if (options.pathDir) env[pathKey] = `${options.pathDir}${delimiter}${env[pathKey] ?? ''}`
    if (this.disposed) throw new Error('OpenCode launch cancelled')
    this.child = spawn(binary, ['serve', '--hostname', '127.0.0.1', '--port', '0'], { cwd: options.cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let log = ''
    const record = (bytes: Buffer) => { log = (log + bytes).slice(-4000); this.endpoint ||= /http:\/\/127\.0\.0\.1:\d+/.exec(log)?.[0] ?? '' }
    this.child.stdout?.on('data', record); this.child.stderr?.on('data', record)
    this.child.on('error', error => this.fail(error.message))
    this.child.on('exit', () => this.fail('OpenCode server exited; create a new terminal.'))
    for (let i = 0; i < 200 && !this.endpoint && this.child.exitCode === null && !this.disposed; i++) await delay(50)
    if (!this.endpoint || this.disposed) throw new Error(`OpenCode server did not start: ${log}`)
    const info = await this.api('/api/session', { location: { directory: options.cwd } })
    if (typeof info?.data?.id !== 'string') throw new Error('OpenCode returned an invalid session')
    this.receive({ type: 'session', sessionId: info.data.id })
    this.updateSettings(info.data.model)
    void this.loadModels()
    // Note: .agents/notes/workbench/terminal-dialog-dual-mode.md
    // History reads may be previews. Only successful create/view operations
    // establish selection; read back identity before handing control to dialog.
    this.proxy = createServer((request, response) => {
      if (request.headers.origin || request.headers.authorization !== `Basic ${Buffer.from(`opencode:${this.password}`).toString('base64')}`) { response.writeHead(403).end(); return }
      const pathname = new URL(request.url ?? '/', this.endpoint).pathname
      const createsSession = request.method === 'POST' && pathname === '/api/session'
      const viewedSession = request.method === 'POST' ? /^\/api\/session\/([^/]+)\/view$/.exec(pathname)?.[1] : undefined
      const selectsSession = createsSession || Boolean(viewedSession && (viewedSession !== encodeURIComponent(this.state.threadId ?? '')
        || this.nativeSelectionUncertain || this.nativeSelectionsPending))
      if (selectsSession && (this.state.mode === 'conversation' || this.state.settingsUpdating || this.state.submitting)) {
        response.writeHead(409).end('JanusX conversation view owns input'); return
      }
      if (['POST', 'DELETE'].includes(request.method ?? '') && /^\/api\/session\/[^/]+\/(model|prompt|revert)(?:\/|\?|$)/.test(request.url ?? '')
        && (this.state.mode === 'conversation' || this.state.settingsUpdating || this.state.submitting)) {
        response.writeHead(409).end('JanusX conversation view owns input'); return
      }
      const revision = selectsSession ? ++this.nativeSelectionRevision : 0
      if (selectsSession) this.nativeSelectionsPending++
      let finished = false
      const finish = () => { if (selectsSession && !finished) { finished = true; this.nativeSelectionsPending-- } }
      const uncertain = () => { if (selectsSession && !finished && revision === this.nativeSelectionRevision) this.pauseNativeSelection('OpenCode session selection could not be confirmed. Select the session again in the terminal.'); finish() }
      const upstream = httpRequest(this.endpoint + request.url, { method: request.method, headers: { ...request.headers,
        ...(selectsSession ? { 'accept-encoding': 'identity' } : {}), host: new URL(this.endpoint).host } }, reply => {
        if (!selectsSession || (reply.statusCode ?? 502) < 200 || (reply.statusCode ?? 502) >= 300) {
          finish(); response.writeHead(reply.statusCode ?? 502, reply.headers); reply.pipe(response); return
        }
        const chunks: Buffer[] = []
        let bytes = 0
        reply.on('data', (chunk: Buffer) => {
          bytes += chunk.length
          if (bytes > 1024 * 1024) { uncertain(); reply.destroy(); response.writeHead(502).end('Session response too large'); return }
          chunks.push(chunk)
        })
        reply.on('error', () => { uncertain(); if (!response.headersSent) response.writeHead(502); response.end() })
        reply.on('end', () => {
          void (async () => {
            const body = Buffer.concat(chunks)
            try {
              const selected: unknown = viewedSession ? decodeURIComponent(viewedSession) : JSON.parse(body.toString('utf8'))?.data?.id
              if (typeof selected !== 'string' || !selected) throw new Error('Invalid OpenCode session identity')
              await this.confirmNativeSelection(selected, revision)
            } catch { uncertain() }
            finally { finish() }
            if (!response.destroyed) { response.writeHead(reply.statusCode ?? 200, reply.headers); response.end(body) }
          })()
        })
      })
      if (selectsSession) upstream.setTimeout(5000, () => upstream.destroy(new Error('OpenCode session selection timed out')))
      upstream.on('error', () => { uncertain(); if (!response.headersSent) response.writeHead(502); response.end() })
      response.on('close', () => { uncertain(); upstream.destroy() }); request.pipe(upstream)
    })
    this.proxy.on('connection', socket => { this.sockets.add(socket); socket.on('close', () => this.sockets.delete(socket)) })
    this.proxy.on('upgrade', (request, socket, head) => {
      if (request.headers.origin || request.headers.authorization !== `Basic ${Buffer.from(`opencode:${this.password}`).toString('base64')}`) { socket.destroy(); return }
      const upstream = httpRequest(this.endpoint + request.url, { headers: { ...request.headers, host: new URL(this.endpoint).host } })
      upstream.on('upgrade', (reply, peer, bytes) => {
        socket.write(`HTTP/1.1 101 Switching Protocols\r\n${Object.entries(reply.headers).map(([k, v]) => `${k}: ${v}`).join('\r\n')}\r\n\r\n`)
        if (bytes.length) socket.write(bytes)
        if (head.length) peer.write(head)
        peer.pipe(socket); socket.pipe(peer)
        socket.on('close', () => peer.destroy()); peer.on('error', () => socket.destroy()); socket.on('error', () => peer.destroy())
      })
      upstream.on('error', () => socket.destroy()); upstream.on('response', () => socket.destroy()); upstream.end()
    })
    await new Promise<void>((resolve, reject) => { this.proxy!.once('error', reject); this.proxy!.listen(0, '127.0.0.1', resolve) })
    this.proxy.on('error', error => this.fail(error.message))
    const proxyAddress = this.proxy.address() as { port: number }
    this.polling = this.poll()
    return { command: binary, args: ['--server', `http://127.0.0.1:${proxyAddress.port}`, '--session', info.data.id, options.cwd],
      env: { OPENCODE_SERVER_PASSWORD: this.password, OPENCODE_CLI_CONFIG_CONTENT: terminalConfig } }
  }
  private async api(path: string, body?: unknown): Promise<Json> {
    const response = await fetch(this.endpoint + path, { method: body === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Basic ${Buffer.from(`opencode:${this.password}`).toString('base64')}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(5000)]) })
    if (!response.ok) throw new Error(`OpenCode ${response.status}: ${(await response.text()).slice(0, 1000)}`)
    return response.status === 204 ? {} : await response.json() as Json
  }
  private updateSettings(model?: Json): void {
    if (this.disposed) return
    const ref = model ?? this.defaultModel
    const key = typeof ref?.providerID === 'string' && typeof ref.id === 'string' ? `${ref.providerID}/${ref.id}` : null
    const effort = key ? ref?.variant ?? 'default' : null
    if (key === this.state.model && effort === this.state.effort) return
    this.state.model = key; this.state.effort = effort; this.changed()
  }
  private pauseNativeSelection(error: string): void {
    if (this.disposed) return
    this.nativeSelectionRevision++ // Invalidate any readback still completing after a lost response.
    this.nativeSelectionUncertain = true
    this.state.needsTerminal = true; this.state.error = error; this.changed()
  }
  private async confirmNativeSelection(id: string, revision: number): Promise<void> {
    const info = await this.api(`/api/session/${encodeURIComponent(id)}`)
    if (this.disposed) return
    if (revision !== this.nativeSelectionRevision) {
      this.pauseNativeSelection('OpenCode session selections overlapped. Select the session again in the terminal.')
      return
    }
    if (info.data?.id !== id) throw new Error('OpenCode session readback did not match')
    const directory = info.data?.location?.directory
    if (typeof directory === 'string') {
      const normalize = (path: string) => process.platform === 'win32' ? resolve(path).toLowerCase() : resolve(path)
      if (normalize(directory) !== normalize(this.directory)) throw new Error('OpenCode selected a different workspace')
    }
    this.nativeSelectionUncertain = false
    this.historyRevision++; this.settingsRevision++
    if (id !== this.state.threadId) {
      this.rendered.clear(); this.lastUser = ''
      this.state.threadId = null; this.state.turnId = null; this.state.turnStartedAt = undefined
      this.state.items = []; this.state.approvals = []; this.state.truncated = false
      this.state.model = null; this.state.effort = null
      this.state.controlEpoch++
      this.receive({ type: 'session', sessionId: id })
    }
    this.state.error = undefined; this.state.needsTerminal = false
    this.updateSettings(info.data.model); this.changed()
  }
  private loadModels(): Promise<void> {
    if (this.loadingModels) return this.loadingModels
    this.state.modelsLoading = true; this.state.modelsError = undefined; this.changed()
    this.loadingModels = (async () => {
      try {
        const query = `?location[directory]=${encodeURIComponent(this.directory)}`
        const [catalog, providers, fallback] = await Promise.all([
          this.api(`/api/model${query}`), this.api(`/api/provider${query}`), this.api(`/api/model/default${query}`),
        ])
        if (!Array.isArray(catalog.data) || !Array.isArray(providers.data)) throw new Error('Invalid OpenCode model catalog')
        const available = new Set(providers.data.filter((p: Json) => p.activation !== 'disabled').map((p: Json) => p.id))
        const refs = new Map<string, { id: string; providerID: string }>()
        const models: ConversationSnapshot['models'] = []
        for (const raw of catalog.data) {
          if (!raw.enabled || !available.has(raw.providerID) || typeof raw.id !== 'string' || typeof raw.providerID !== 'string') continue
          const model = `${raw.providerID}/${raw.id}`
          if (refs.has(model)) continue
          refs.set(model, { id: raw.id, providerID: raw.providerID })
          const variants = [...new Set<string>((Array.isArray(raw.variants) ? raw.variants : [])
            .map((v: Json) => v.id).filter((id: unknown): id is string => typeof id === 'string' && !!id && id !== 'default'))]
          models.push({ model, displayName: `${raw.name || raw.id} · ${raw.providerID}`, description: model,
            defaultEffort: 'default', efforts: [{ effort: 'default', description: '' }, ...variants.map(effort => ({ effort, description: '' }))] })
        }
        if (this.disposed) return
        this.modelRefs = refs; this.state.models = models; this.defaultModel = fallback.data ?? undefined
        // Only the session's selection is authoritative; historical assistant models are not settings.
        const revision = this.settingsRevision
        const session = await this.api(`/api/session/${encodeURIComponent(this.state.threadId!)}`)
        if (!this.state.settingsUpdating && revision === this.settingsRevision) this.updateSettings(session.data?.model)
      } catch (error) {
        if (!this.disposed) this.state.modelsError = String(error).slice(0, 1000)
      } finally {
        this.loadingModels = undefined
        if (!this.disposed) { this.state.modelsLoading = false; this.changed() }
      }
    })()
    return this.loadingModels
  }
  override async command(command: ConversationCommand): Promise<ConversationSnapshot> {
    if (!(command.type === 'mode' && command.mode === 'terminal') && (this.nativeSelectionsPending || this.nativeSelectionUncertain)) {
      throw new Error('OpenCode is selecting a session. Finish selecting it in the terminal before using the conversation view.')
    }
    if (this.state.settingsUpdating) throw new Error('Wait for OpenCode settings to finish updating')
    if (command.type !== 'models' && command.type !== 'settings') return super.command(command)
    if (this.disposed || this.state.connection !== 'ready' || !this.state.threadId) throw new Error('OpenCode session unavailable')
    if (this.state.mode !== 'conversation' || command.controlEpoch !== this.state.controlEpoch) throw new Error('Stale conversation control')
    if (command.type === 'models') { await this.loadModels(); return this.snapshot() }
    if (this.state.submitting || this.state.turnId || this.state.needsTerminal) throw new Error('Wait until OpenCode is idle before changing settings')
    const option = this.state.models.find(model => model.model === command.model)
    const ref = this.modelRefs.get(command.model)
    const effort = command.effort ?? 'default'
    if (this.state.modelsLoading || this.state.modelsError || !option || !ref || !option.efforts.some(v => v.effort === effort)) throw new Error('Unsupported OpenCode model or variant')
    this.state.settingsUpdating = true; this.settingsRevision++; this.changed()
    const path = `/api/session/${encodeURIComponent(this.state.threadId)}`
    try {
      await this.api(`${path}/model`, { model: { ...ref, ...(effort === 'default' ? {} : { variant: effort }) } })
      const session = await this.api(path)
      if (session.data?.id !== this.state.threadId || !session.data.model) throw new Error('OpenCode settings could not be confirmed')
      this.updateSettings(session.data.model)
      if (this.state.model !== command.model || this.state.effort !== effort) throw new Error('OpenCode returned different settings')
    } catch (error) {
      // A timeout may follow an applied update. Read back once; never retry the mutation.
      try {
        const session = await this.api(path)
        if (session.data?.id !== this.state.threadId) throw new Error('Invalid OpenCode session readback')
        this.updateSettings(session.data.model)
      }
      catch { this.fail('OpenCode settings outcome is unknown. Check the native terminal before continuing.') }
      throw error
    } finally {
      this.settingsRevision++; this.state.settingsUpdating = false
      if (!this.disposed) this.changed()
    }
    return this.snapshot()
  }
  override acceptsTerminalInput(data: string): boolean {
    return (!this.state.settingsUpdating && super.acceptsTerminalInput(data)) || /^\x1b\[[?\d;]*[Rcn]$/.test(data)
  }
  private async poll(): Promise<void> {
    try {
      while (!this.disposed && this.state.connection === 'ready') {
        if (this.editingHistory || this.nativeSelectionsPending || this.nativeSelectionUncertain) { await delay(50); continue }
        const historyRevision = this.historyRevision
        try {
          const session = encodeURIComponent(this.state.threadId!)
          const revision = this.settingsRevision
          const info = await this.api(`/api/session/${session}`)
          if (historyRevision !== this.historyRevision || this.nativeSelectionsPending || this.nativeSelectionUncertain) continue
          if (!this.state.settingsUpdating && revision === this.settingsRevision) this.updateSettings(info.data?.model)
          const page = await this.api(`/api/session/${session}/message?limit=200&order=desc`)
          if (this.editingHistory || historyRevision !== this.historyRevision || this.nativeSelectionsPending || this.nativeSelectionUncertain) continue
          let turn = '', idle = false
          const messages: Json[] = [...page.data].reverse()
          const visible = new Set(messages.map(msg => msg.id))
          for (const id of this.rendered.keys()) if (!visible.has(id)) this.rendered.delete(id)
          if (messages.length === 200) this.state.truncated = true
          for (const msg of messages) {
            if (msg.type === 'user') { turn = msg.id; this.lastUser = msg.id; idle = false }
            if (msg.type === 'idle') idle = true
            const signature = JSON.stringify(msg)
            if (this.rendered.get(msg.id) === signature) continue
            this.rendered.set(msg.id, signature)
            if (msg.type === 'user') {
              this.receive({ type: 'start', turnId: turn })
              this.receive({ type: 'item', item: { id: msg.id, turnId: turn, type: 'userMessage', text: msg.text, status: 'completed', receivedAt: msg.time.created, editable: ![msg.files, msg.agents, msg.skills].some(parts => parts?.length) } })
            } else if (msg.type === 'assistant') {
              for (const [index, part] of (msg.content ?? []).entries()) {
                const isTool = part.type === 'tool'
                const text = isTool ? `${part.name}\n${JSON.stringify(part.state.input ?? {})}\n${(part.state.content ?? []).filter((c: Json) => c.type === 'text').map((c: Json) => c.text).join('\n')}` : part.text ?? ''
                this.receive({ type: 'item', item: { id: `${msg.id}:${index}`, turnId: turn, type: isTool ? 'commandExecution' : part.type === 'reasoning' ? 'reasoning' : 'agentMessage', text,
                  status: isTool ? part.state.status === 'completed' ? 'completed' : part.state.status === 'error' ? 'failed' : 'inProgress' : msg.error ? 'failed' : msg.time.completed ? 'completed' : 'inProgress', receivedAt: msg.time.created } })
              }
            } else if (msg.type === 'idle') {
              if (msg.outcome !== 'succeeded') for (const item of this.state.items) if (item.turnId === turn && item.status === 'inProgress') item.status = msg.outcome
              this.receive({ type: 'end', error: msg.error?.message })
            }
          }
          if (!idle && turn && !this.state.turnId) this.receive({ type: 'start', turnId: turn })
          const [permissions, forms] = await Promise.all([this.api(`/api/session/${session}/permission`), this.api(`/api/session/${session}/form`)])
          if (historyRevision !== this.historyRevision || this.nativeSelectionsPending || this.nativeSelectionUncertain) continue
          this.receive({ type: 'attention', pending: (permissions.data?.length ?? 0) > 0 || (forms.data?.length ?? 0) > 0 })
          await delay(250)
        } catch (error) {
          if (historyRevision !== this.historyRevision || this.nativeSelectionsPending || this.nativeSelectionUncertain) continue
          throw error
        }
      }
    } catch (error) { if (!this.disposed) this.fail(`OpenCode connection lost: ${String(error)}`) }
  }
  protected override async editHistory(item: ConversationItem): Promise<void> {
    this.editingHistory = true; this.historyRevision++
    const path = `/api/session/${encodeURIComponent(this.state.threadId!)}`
    try {
      // Explicitly preserve workspace files; only replace the conversation suffix.
      await this.api(`${path}/revert/stage`, { messageID: item.id, files: false })
      await this.api(`${path}/revert/commit`, {})
      const page = await this.api(`${path}/message?limit=200&order=desc`)
      if (!Array.isArray(page.data) || page.data.some((msg: Json) => msg.id === item.id)) throw new Error('OpenCode history edit was not applied')
      const index = this.state.items.findIndex(row => row.id === item.id)
      this.state.items = this.state.items.slice(0, index)
      this.rendered.clear()
      this.state.turnId = null; this.state.turnStartedAt = undefined
      this.changed()
    } catch (error) {
      this.fail(`OpenCode history edit could not be confirmed. Check the terminal before retrying. ${String(error)}`)
      throw error
    } finally { this.historyRevision++; this.editingHistory = false }
  }
  protected async deliver(command: { id: string; type: 'send' | 'interrupt'; text?: string; sessionId: string; turnId: string | null }): Promise<void> {
    const path = `/api/session/${encodeURIComponent(command.sessionId)}`
    try {
      if (command.type === 'interrupt') { await this.api(`${path}/interrupt`, {}); return }
      const before = this.lastUser
      await this.api(`${path}/prompt`, { text: command.text })
      for (let i = 0; i < 100 && !this.disposed && this.state.connection === 'ready'; i++) {
        if (this.lastUser !== before && this.state.items.some(item => item.id === this.lastUser && item.text === command.text)) return
        await delay(50)
      }
      throw new Error('Prompt delivery could not be confirmed')
    } catch (error) { this.fail(`OpenCode delivery is unknown. Check the terminal before retrying. ${String(error)}`); throw error }
  }
  dispose(): Promise<void> {
    if (this.stopping) return this.stopping
    this.close(); this.abort.abort()
    this.stopping = (async () => {
      await this.startup?.catch(() => {})
      for (const socket of this.sockets) socket.destroy()
      this.sockets.clear()
      this.proxy?.closeAllConnections(); this.proxy?.close()
      if (this.child?.pid && this.child.exitCode === null && this.child.signalCode === null) {
        if (process.platform === 'win32') await promisify(execFile)('taskkill', ['/PID', String(this.child.pid), '/T', '/F'], { windowsHide: true, timeout: 5000 }).catch(() => { this.child?.kill() })
        else this.child.kill()
      }
      await this.polling
      await this.loadingModels
    })()
    return this.stopping
  }
}
