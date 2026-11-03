import { createServer, type Server } from 'node:http'
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { NativeCatalogEntry } from './conversation-catalog'
import { NativeConversation, type NativeEvent, type NativeLaunch, type NativeCommand } from './native-conversation'
import type { ConversationCommand, ConversationSnapshot } from '../../shared/conversation-display'
import bridgeSource from './native-bridge.js?raw'
import piSource from './pi-extension.js?raw'
import imageSource from './conversation-images.js?raw'
import dshSource from './dsh-extension.js?raw'
import questionSource from './native-questions.js?raw'
import { pathToFileURL } from 'node:url'

class ExtensionConversation extends NativeConversation {
  private server?: Server
  private directory?: string
  private token = randomBytes(32).toString('hex')
  private seq = 0
  private instanceId?: string
  private heartbeat?: ReturnType<typeof setInterval>
  private lastSeen = Date.now()
  private startup?: Promise<{ command: string; args: string[] }>
  private stopping?: Promise<void>
  private pending = new Map<string, { command: unknown; resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>()
  constructor(id: string, engine: 'pi' | 'dsh', publish: (value: ConversationSnapshot) => void, bind?: (id: string, path?: string) => void) { super(id, engine, publish, bind); this.state.capabilities.commands = engine === 'pi'; this.state.capabilities.questions = true }
  start(options: NativeLaunch): Promise<{ command: string; args: string[] }> {
    if (this.startup || this.disposed) throw new Error('Native session already started')
    this.startup = this.launch(options)
    return this.startup
  }
  private async launch(options: NativeLaunch): Promise<{ command: string; args: string[] }> {
    this.session.configureImages(join(options.assetsDir, 'images'), options.cwd)
    // CLI versions are not launch gates; the live extension handshake owns readiness.
    // Note: .agents/notes/workbench/terminal-dialog-dual-mode.md — CLI version policy.
    const dsh = this.state.engine === 'dsh'
    const packageRoot = join(dirname(options.command), 'node_modules', ...(dsh ? ['@deepseek-ai', 'dsh'] : ['@earendil-works', 'pi-coding-agent']))
    if (this.disposed) throw new Error('Native launch cancelled')
    if (dsh) {
      const profile = options.args[options.args.indexOf('--profile') + 1]
      if (profile !== 'dsh-tui') throw new Error('DSH dual mode requires the dsh-tui profile')
    }
    await mkdir(options.assetsDir, { recursive: true })
    this.directory = await mkdtemp(join(options.assetsDir, `${this.state.engine}-`))
    this.server = createServer(async (request, response) => {
      const reply = (status: number, value: unknown) => { if (!response.writableEnded) response.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(value)) }
      const token = request.headers['x-janusx-token']
      if (request.method !== 'POST' || request.url !== '/exchange' || request.headers.origin || typeof token !== 'string' || Buffer.byteLength(token) !== this.token.length || !timingSafeEqual(Buffer.from(token), Buffer.from(this.token))) { reply(403, {}); return }
      try {
        let raw = ''
        for await (const bytes of request) { raw += bytes; if (raw.length > 3_000_000) { reply(413, {}); request.destroy(); return } }
        const body = JSON.parse(raw)
        if (this.disposed) { reply(410, {}); return }
        if (this.state.connection === 'disconnected') { reply(409, {}); return }
        if (typeof body.instanceId !== 'string' || !body.instanceId || (this.instanceId && this.instanceId !== body.instanceId)) throw new Error('Native extension reloaded; create a new dual-mode terminal')
        this.instanceId = body.instanceId
        if (typeof body.sessionId !== 'string' || !body.sessionId || (this.state.threadId && this.state.threadId !== body.sessionId) || body.overflow) throw new Error('Native session changed or bridge overflowed')
        this.lastSeen = Date.now()
        for (const entry of body.events ?? []) {
          if (entry.seq <= this.seq) continue
          if (entry.seq !== this.seq + 1) throw new Error('Native event sequence gap')
          this.receive(entry.event as NativeEvent); this.seq = entry.seq
        }
        if (this.snapshot().connection === 'disconnected') { reply(409, {}); return }
        for (const ack of body.acks ?? []) {
          const pending = this.pending.get(ack.id)
          if (pending) { clearTimeout(pending.timer); this.pending.delete(ack.id); if (ack.ok) pending.resolve(ack.result); else pending.reject(new Error(String(ack.error))) }
        }
        reply(200, { seq: this.seq, mode: this.state.mode, acks: (body.acks ?? []).map((a: { id: string }) => a.id), commands: [...this.pending.values()].map(p => p.command) })
      } catch (error) { this.fail(String(error)); reply(409, {}) }
    })
    this.server.requestTimeout = 5000
    await new Promise<void>((resolve, reject) => { this.server!.once('error', reject); this.server!.listen(0, '127.0.0.1', resolve) })
    this.server.on('error', error => this.fail(error.message))
    const address = this.server.address()
    if (!address || typeof address === 'string') throw new Error('Native bridge unavailable')
    await writeFile(join(this.directory, 'connection.mjs'), `export const endpoint=${JSON.stringify(`http://127.0.0.1:${address.port}`)};export const token=${JSON.stringify(this.token)};`, { mode: 0o600 })
    await writeFile(join(this.directory, 'native-bridge.mjs'), bridgeSource)
    await writeFile(join(this.directory, 'native-questions.mjs'), questionSource)
    await writeFile(join(this.directory, 'conversation-images.mjs'), imageSource)
    const extension = join(this.directory, 'extension.mjs')
    await writeFile(extension, dsh ? dshSource.replace('__DSH_LLM_URL__', pathToFileURL(join(packageRoot, 'node_modules/@deepseek-ai/dsh-llm/lib/index.js')).href) : piSource)
    if (this.disposed) throw new Error('Native launch cancelled')
    this.lastSeen = Date.now()
    this.heartbeat = setInterval(() => { if (Date.now() - this.lastSeen > (this.state.connection === 'starting' ? 60000 : 6000)) this.fail('Native bridge unavailable. Use the terminal; commands will not be resent.') }, 1000)
    if (dsh) {
      const patch = join(this.directory, 'bridge.patch.json')
      await writeFile(patch, JSON.stringify([{ insert: [{ id: 'janusx-conversation', name: pathToFileURL(extension).href }] }]))
      return { command: options.command, args: ['--patch', patch, ...options.args] }
    }
    return { command: options.command, args: [...options.args, '--extension', extension] }
  }
  protected override async loadCommands(): Promise<NativeCatalogEntry[]> {
    if (this.state.engine !== 'pi') return []
    const rows = await this.request({ id: randomUUID(), type: 'catalog', sessionId: this.state.threadId })
    if (!Array.isArray(rows)) throw new Error('Invalid Pi command catalog')
    return rows.filter(row => row && typeof row.name === 'string' && ['skill', 'prompt', 'extension'].includes(row.source)).slice(0, 1000).map(row => ({
      id: JSON.stringify([row.source, row.name]), name: row.name, label: row.name,
      description: String(row.description ?? '').slice(0, 2000), kind: row.source === 'skill' ? 'skill' : row.source === 'prompt' ? 'prompt' : 'command',
      source: String(row.sourceInfo?.scope ?? row.source), execution: 'native',
      invoke: async (args: string) => { await this.request({ id: randomUUID(), type: 'invoke', name: row.name, source: row.source, arguments: args, sessionId: this.state.threadId }) },
    }))
  }
  private request(command: { id: string; [key: string]: unknown }): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(command.id); this.fail('Native delivery is unknown. Check the terminal before sending again.'); reject(new Error('Native delivery unknown')) }, 10000)
      this.pending.set(command.id, { command, resolve, reject, timer })
    })
  }
  protected async deliver(command: NativeCommand): Promise<void> {
    await this.request(command)
  }
  override async command(command: ConversationCommand): Promise<ConversationSnapshot> {
    const result = await super.command(command)
    if (this.server && command.type === 'mode' && this.state.connection === 'ready') {
      await this.request({ id: randomUUID(), type: 'display-mode', mode: command.mode, sessionId: this.state.threadId })
      return this.snapshot()
    }
    return result
  }
  dispose(): Promise<void> {
    if (this.stopping) return this.stopping
    this.close()
    this.stopping = (async () => {
      await this.startup?.catch(() => {})
      if (this.heartbeat) clearInterval(this.heartbeat)
      for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error('Session closed')) }
      this.pending.clear(); this.server?.closeAllConnections(); this.server?.close()
      if (this.directory) await rm(this.directory, { recursive: true, force: true })
    })()
    return this.stopping
  }
}

export class PiConversation extends ExtensionConversation {
  constructor(id: string, publish: (value: ConversationSnapshot) => void, bind?: (id: string, path?: string) => void) { super(id, 'pi', publish, bind) }
}
export class DshConversation extends ExtensionConversation {
  constructor(id: string, publish: (value: ConversationSnapshot) => void, bind?: (id: string, path?: string) => void) { super(id, 'dsh', publish, bind) }
}
