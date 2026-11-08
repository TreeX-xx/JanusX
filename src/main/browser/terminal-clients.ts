// Note: registrations share the native files and writer used by Skills/MCP — .agents/notes/desktop/browser-control.md
import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { copyFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { parseDocument } from 'yaml'
import { applyEdits, modify } from 'jsonc-parser'
import { SerialQueue } from '../lib/atomic-file'
import { LocalIntegrationService, readIntegrationFile, writablePath, writeIntegrationFile } from '../local-integrations/service'
import { parseConfig } from '../local-integrations/config'
import { probeMcp } from '../local-integrations/probe'
import { connectBrowserTerminal } from './terminal-connection'
import { BROWSER_CLIENTS, type BrowserClient, type BrowserClientChange, type BrowserClientStatus } from '../../shared/ipc/control'
import type { LocalIntegrationClient } from '../../shared/local-integrations'

const key = 'janusx-browser'
const labels = { claude: 'Claude Code', codex: 'Codex', opencode: 'OpenCode', janus: 'Janus CLI', pi: 'Pi', dsh: 'DSH' }
const hash = (raw: string) => createHash('sha256').update(raw).digest('hex')
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const start = '# janusx-browser managed begin', end = '# janusx-browser managed end'
function dshEntry(raw: string) {
  const doc = parseDocument(raw || '[]', { customTags: [{ tag: 'tag:yaml.org,2002:js', resolve: (value: string) => value }] })
  const rows = doc.toJS()
  if (doc.errors.length || !Array.isArray(rows)) throw new Error('Invalid DSH patch list')
  const entries = rows.flatMap(row => Array.isArray(object(row).insert) ? object(row).insert as unknown[] : [row]).map(object).filter(row => row.id === key)
  const starts = [...raw.matchAll(/^# janusx-browser managed begin\r?$/gm)], ends = [...raw.matchAll(/^# janusx-browser managed end\r?$/gm)]
  if (!starts.length && !ends.length) return { entry: entries[0], owned: false, clean: raw }
  if (starts.length !== 1 || ends.length !== 1 || starts[0].index! >= ends[0].index!) throw new Error('Invalid DSH browser block')
  const first = starts[0].index!, last = ends[0].index! + ends[0][0].length
  const block = parseDocument(raw.slice(first + starts[0][0].length, ends[0].index)).toJS()
  if (entries.length !== 1 || !isDeepStrictEqual(block, [{ insert: [entries[0]] }]) || entries[0].name !== '@deepseek-ai/dsh-mcp-client') throw new Error('DSH block contains unrelated settings')
  return { entry: entries[0].config, owned: true, clean: raw.slice(0, first) + raw.slice(last).replace(/^\r?\n/, '') }
}

export class BrowserTerminalClients {
  private queue = new SerialQueue()
  constructor(private deps: { service: LocalIntegrationService; home: string; env: NodeJS.ProcessEnv; directory: string; entry: string; executable: string; piBundle: string; disconnect(client: string): Promise<void> }) {}
  private launch(client: BrowserClient) {
    return { command: this.deps.executable, args: [this.deps.entry], env: { ELECTRON_RUN_AS_NODE: '1', JANUSX_BROWSER_CONNECTION: join(this.deps.directory, 'connection.json'), JANUSX_BROWSER_CLIENT: client } }
  }
  private desired(client: BrowserClient) {
    const launch = this.launch(client)
    return client === 'opencode' ? { type: 'local', command: [launch.command, ...launch.args], environment: launch.env, enabled: true } : launch
  }
  private piPath() { return join(this.deps.directory, 'pi-browser.mjs') }
  private async native(client: Exclude<BrowserClient, 'pi' | 'dsh'>) {
    const query = { scope: 'user' as const, client: client as LocalIntegrationClient }
    const catalog = await this.deps.service.scan(query)
    const sources = catalog.sources.filter(source => source.kind === 'mcp' && source.scope === 'user')
    // The explicit OpenCode override wins over its conventional source for registration.
    const source = sources.find(source => this.deps.env.OPENCODE_CONFIG && source.path === this.deps.env.OPENCODE_CONFIG)
      ?? sources.find(source => source.exists) ?? sources[0]
    if (!source || source.issue) throw new Error('Client configuration is unavailable')
    const entries = catalog.entries.filter(entry => entry.kind === 'mcp' && entry.name === key)
    if (entries.length > 1) throw new Error('Duplicate browser MCP registrations; resolve them in Skills & MCP')
    const entry = entries[0]
    const document = entry ? await this.deps.service.read(query, entry.id) : undefined
    const config = document ? JSON.parse(document.content) : undefined
    const launch = this.launch(client)
    const command = client === 'opencode' ? config?.command : [config?.command, ...(Array.isArray(config?.args) ? config.args : [])]
    const owned = config && isDeepStrictEqual(command, [launch.command, ...launch.args])
      && object(client === 'opencode' ? config.environment : config.env).JANUSX_BROWSER_CONNECTION === join(this.deps.directory, 'connection.json')
    return { query, source: entry ? catalog.sources.find(source => source.id === entry.sourceId)! : source, entry, document, config, owned }
  }
  private async extra(client: 'pi' | 'dsh') {
    const boundary = client === 'pi' ? this.deps.env.PI_CODING_AGENT_DIR || join(this.deps.home, '.pi', 'agent') : this.deps.env.DSH_HOME || join(this.deps.home, '.dsh')
    const path = join(boundary, client === 'pi' ? 'settings.json' : 'cordis.patch.yml')
    const raw = await readIntegrationFile(path)
    if (client === 'dsh') return { boundary, path, raw, ...dshEntry(raw) }
    const settings = parseConfig(raw, 'janus')
    if (settings.extensions !== undefined && (!Array.isArray(settings.extensions) || !settings.extensions.every(item => typeof item === 'string'))) throw new Error('Invalid Pi extensions')
    const extensions = (settings.extensions ?? []) as string[]
    return { boundary, path, raw, entry: extensions.includes(this.piPath()) ? this.piPath() : undefined, owned: extensions.includes(this.piPath()), clean: '', extensions }
  }
  async status(): Promise<BrowserClientStatus[]> {
    return Promise.all(BROWSER_CLIENTS.map(async id => {
      try {
        if (id === 'pi' || id === 'dsh') {
          const info = await this.extra(id)
          return { id, label: labels[id], path: info.path, revision: hash(info.raw), state: info.entry ? info.owned ? 'configured' : 'conflict' : 'absent' } as BrowserClientStatus
        }
        const info = await this.native(id)
        return { id, label: labels[id], path: info.source.path, revision: info.document?.revision ?? info.source.revision, state: info.entry ? info.owned ? 'configured' : 'conflict' : 'absent' } as BrowserClientStatus
      } catch { return { id, label: labels[id], path: '', revision: '', state: 'unavailable' } as BrowserClientStatus }
    }))
  }
  change(input: BrowserClientChange): Promise<void> {
    return this.queue.run(async () => {
      const client = input.client
      if (client !== 'pi' && client !== 'dsh') {
        const info = await this.native(client)
        if (info.entry && !info.owned) throw new Error('The janusx-browser name belongs to another MCP')
        if (input.action === 'remove') {
          if (!info.document) return
          const preview = await this.deps.service.prepareRemoval(info.query, info.entry!.id, input.expectedRevision)
          await this.deps.service.remove(preview.token)
        } else await this.deps.service.save({ query: info.query, sourceId: info.source.id, entryId: info.entry?.id, name: key, content: JSON.stringify(this.desired(client)), expectedRevision: input.expectedRevision })
      } else {
        const info = await this.extra(client)
        if (hash(info.raw) !== input.expectedRevision) throw new Error('Client configuration changed; refresh before retrying')
        if (info.entry && !info.owned) throw new Error('The browser registration belongs to another configuration')
        if (!await writablePath(info.path, info.boundary)) throw new Error('Client configuration is read-only')
        let next: string
        if (client === 'pi') {
          const extensions = (info as { extensions: string[] }).extensions.filter(path => path !== this.piPath())
          if (input.action === 'import') {
            await mkdir(this.deps.directory, { recursive: true })
            await copyFile(this.deps.piBundle, this.piPath())
            extensions.push(this.piPath())
          }
          next = applyEdits(info.raw || '{}', modify(info.raw || '{}', ['extensions'], extensions, { formattingOptions: { insertSpaces: true, tabSize: 2 } }))
        } else {
          const clean = info.clean.replace(/^[ \t]*\[\][ \t]*(?=#|\r?$)/m, '')
          const config = { serverName: key, transport: 'stdio', ...this.launch(client) }
          next = clean + (input.action === 'import' ? `${clean && !clean.endsWith('\n') ? '\n' : ''}${start}\n- insert: ${JSON.stringify([{ id: key, name: '@deepseek-ai/dsh-mcp-client', config }])}\n${end}\n` : '')
          dshEntry(next)
        }
        if (info.raw) await writeIntegrationFile(info.path + '.janusx-browser.bak', info.raw)
        await mkdir(dirname(info.path), { recursive: true })
        if (!await writablePath(info.path, info.boundary) || await readIntegrationFile(info.path) !== info.raw) throw new Error('Client configuration changed; refresh before retrying')
        await writeIntegrationFile(info.path, next)
      }
      await this.deps.disconnect(client)
    })
  }
  async probe(client: BrowserClient, revision: string) {
    const status = (await this.status()).find(row => row.id === client)!
    if (status.revision !== revision || status.state !== 'configured') throw new Error('Refresh and register the client before checking')
    if (client === 'pi') {
      const connection = await connectBrowserTerminal(join(this.deps.directory, 'connection.json'), 'pi', this.deps.home)
      try { return { ok: true, tools: connection.tools.length } } finally { await connection.close() }
    }
    const config = client === 'dsh' ? this.launch(client) : (await this.native(client)).config
    const probe = await probeMcp(config, this.deps.home)
    return { ok: probe.state === 'passed', tools: probe.tools, error: probe.issue }
  }
}
