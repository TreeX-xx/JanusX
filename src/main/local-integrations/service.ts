// Note: local source boundaries and conservative discovery — .agents/notes/workbench/local-skills-mcp.md
import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, open, readdir, realpath, rename, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { SerialQueue } from '../lib/atomic-file'
import type { InstalledPlugin } from '../../shared/ipc/plugins'
import type { LocalIntegrationCatalog, LocalIntegrationDocument, LocalIntegrationEntry, LocalIntegrationQuery, LocalIntegrationSave, LocalIntegrationSource, LocalIntegrationRemoval, LocalIntegrationRemovalResult } from '../../shared/local-integrations'
import { LOCAL_INTEGRATION_CLIENTS } from '../../shared/local-integrations'
import { collection, IntegrationError, mcpTransport, object, parseConfig, updateServer, validateServer } from './config'
import { parseSkill } from './skills'
import { snapshotSkillRemoval } from './removal-snapshot'

const hash = (text: string) => createHash('sha256').update(text).digest('hex')
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT'
const outside = (path: string) => path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path)
const maxBytes = 1024 * 1024
interface Source extends LocalIntegrationSource { boundary: string; keys: string[]; raw: string }
interface Entry { view: LocalIntegrationEntry; source: Source; content: string; revision: string; config?: Record<string, unknown> }
interface Dependencies {
  home: string; env: NodeJS.ProcessEnv; resolveWorkspace: (id: string) => Promise<string | undefined>
  plugins?: () => InstalledPlugin[]
  trashItem?: (path: string) => Promise<void>
  backupDirectory?: string
}
interface PendingRemoval { preview: LocalIntegrationRemoval; query: LocalIntegrationQuery; revision: string; treeRevision?: string }
export async function readIntegrationFile(path: string): Promise<string> {
  let file
  try {
    file = await open(path, 'r')
    const stat = await file.stat()
    if (!stat.isFile() || stat.size > maxBytes) throw new IntegrationError('file-limit')
    const buffer = Buffer.alloc(maxBytes + 1)
    let length = 0
    while (length < buffer.length) {
      const read = await file.read(buffer, length, buffer.length - length, null)
      if (!read.bytesRead) break
      length += read.bytesRead
    }
    if (length > maxBytes) throw new IntegrationError('file-limit')
    try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buffer.subarray(0, length)) }
    catch { throw new IntegrationError('encoding') }
  } catch (error) { if (missing(error)) return ''; throw error }
  finally { await file?.close() }
}

/** Discovery follows linked skills, but writes never follow a link outside the selected source. */
async function writablePath(path: string, boundary: string): Promise<boolean> {
  if (outside(relative(boundary, path))) return false
  let cursor = resolve(path)
  while (true) {
    try { if ((await lstat(cursor)).isSymbolicLink()) return false }
    catch (error) { if (!missing(error)) return false }
    if (cursor === resolve(boundary)) return true
    const parent = dirname(cursor)
    if (parent === cursor) return false
    cursor = parent
  }
}
const issue = (error: unknown) => error instanceof IntegrationError ? error.code : 'read-failed'

// Native config can contain credentials. Preserve its mode and keep new files private.
async function writeIntegrationFile(path: string, text: string) {
  const previous = await lstat(path).catch(error => { if (missing(error)) return undefined; throw error })
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, text, { flag: 'wx', mode: previous ? previous.mode & 0o777 : 0o600 })
    await rename(temporary, path)
  } finally { await unlink(temporary).catch(() => {}) }
}

export class LocalIntegrationService {
  private queue = new SerialQueue()
  private removals = new Map<string, PendingRemoval>()
  constructor(private readonly deps: Dependencies) {}

  private async context(query: LocalIntegrationQuery) {
    if (!query || !LOCAL_INTEGRATION_CLIENTS.includes(query.client) || !['user', 'workspace'].includes(query.scope)) throw new IntegrationError('invalid-request')
    if (query.scope === 'user') return { root: undefined }
    if (typeof query.workspaceId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(query.workspaceId)) throw new IntegrationError('workspace-unavailable')
    const path = await this.deps.resolveWorkspace(query.workspaceId)
    if (!path || !isAbsolute(path) || /^(janusx|workspace|runtime):/.test(path)) throw new IntegrationError('local-only')
    try { return { root: await realpath(path) } } catch { throw new IntegrationError('workspace-unavailable') }
  }

  private async discover(query: LocalIntegrationQuery) {
    const { root } = await this.context(query)
    const sources: Source[] = [], entries: Entry[] = []
    let limited = false
    const home = resolve(this.deps.home), env = this.deps.env
    const codex = resolve(env.CODEX_HOME || join(home, '.codex'))
    const claude = resolve(env.CLAUDE_CONFIG_DIR || join(home, '.claude'))
    const configHome = resolve(env.XDG_CONFIG_HOME || join(home, '.config'))
    const source = async (path: string, kind: 'skill' | 'mcp', scope: Source['scope'], boundary: string, keys: string[] = []) => {
      path = resolve(path)
      const id = hash([path, kind, ...keys].join('\0'))
      if (sources.some(item => item.id === id)) return
      const item: Source = { id, path, kind, scope, boundary, keys, raw: '', exists: false, writable: await writablePath(path, boundary), revision: hash('') }
      sources.push(item)
      try {
        item.exists = Boolean(await lstat(path).catch(error => { if (missing(error)) return undefined; throw error }))
        if (kind === 'mcp') {
          item.raw = await readIntegrationFile(path); item.revision = hash(item.raw)
          const data = collection(parseConfig(item.raw, query.client), keys)
          for (const [name, value] of Object.entries(data).slice(0, 500)) {
            const view: LocalIntegrationEntry = { id: hash(id + '\0' + name), sourceId: id, kind, name, description: '', path, scope, inherited: Boolean(root && scope === 'user'), writable: item.writable && /^[\w.-]{1,128}$/.test(name), state: 'configured' }
            let config: Record<string, unknown> | undefined
            try {
              config = object(value)
              view.transport = mcpTransport(config)
              validateServer(config, query.client)
              if (config.enabled === false || config.disabled === true) view.state = 'disabled'
              if (view.transport === 'stdio') view.description = typeof config.command === 'string' ? config.command : String((config.command as string[])[0])
              else {
                try { const url = new URL(String(config.url)); view.description = url.origin + url.pathname }
                catch { view.description = view.transport.toUpperCase() }
              }
            } catch (error) { view.state = 'invalid'; view.issue = issue(error) }
            entries.push({ view, source: item, content: JSON.stringify(value, null, 2), revision: item.revision, config })
          }
          if (Object.keys(data).length > 500) limited = true
        } else if (item.exists) {
          const visited = new Set<string>()
          let directories = 0
          const walk = async (directory: string, depth: number) => {
            if (++directories > 600) { limited = true; return }
            let actual: string
            try { actual = await realpath(directory) } catch { return }
            if (visited.has(actual)) return
            visited.add(actual)
            const file = join(directory, 'SKILL.md')
            const exists = await lstat(file).catch(error => { if (missing(error)) return undefined; throw error })
            if (exists) {
              const view: LocalIntegrationEntry = { id: hash(id + '\0' + file), sourceId: id, kind, name: basename(directory), description: '', path: file, scope, inherited: Boolean(root && scope === 'user'), writable: item.writable && await writablePath(file, boundary), state: 'discovered' }
              let content = ''
              try { content = await readIntegrationFile(file); Object.assign(view, parseSkill(content)) }
              catch (error) { view.state = 'invalid'; view.issue = issue(error); if (view.issue !== 'invalid-skill') view.writable = false }
              entries.push({ view, source: item, content, revision: hash(content) })
              return
            }
            if (depth >= 4) { limited = true; return }
            const children = await readdir(directory, { withFileTypes: true })
            for (const child of children.sort((a, b) => a.name.localeCompare(b.name))) {
              if (directories >= 600) { limited = true; break }
              if (['.git', 'node_modules'].includes(child.name)) continue
              if (child.isDirectory() || child.isSymbolicLink()) await walk(join(directory, child.name), depth + 1)
            }
          }
          await walk(path, 0)
        }
      } catch (error) { item.issue = issue(error); item.writable = false }
    }
    const pair = async (suffix: string, userRoot: string, kind: 'skill' | 'mcp', keys: string[] = [], workspaceSuffix = suffix) => {
      await source(join(userRoot, suffix), kind, 'user', userRoot, keys)
      if (root) await source(join(root, workspaceSuffix), kind, 'workspace', root, keys)
    }
    if (query.client === 'codex') {
      await pair('.agents/skills', home, 'skill')
      await pair('skills', codex, 'skill', [], '.codex/skills')
      await pair('config.toml', codex, 'mcp', ['mcp_servers'], '.codex/config.toml')
    } else if (query.client === 'claude') {
      await pair('skills', claude, 'skill', [], '.claude/skills')
      const claudeJson = env.CLAUDE_CONFIG_DIR ? join(claude, '.claude.json') : join(home, '.claude.json')
      await source(claudeJson, 'mcp', 'user', env.CLAUDE_CONFIG_DIR ? claude : home, ['mcpServers'])
      if (root) {
        await source(join(root, '.mcp.json'), 'mcp', 'workspace', root, ['mcpServers'])
        // Native local MCP scope is project-private even though its file lives under the user home.
        // A broken user file must not hide otherwise valid project skills and servers.
        let projects: string[] = []
        try { projects = Object.keys(object(parseConfig(await readIntegrationFile(claudeJson), 'claude').projects ?? {})) } catch { /* The source exposes its parse error. */ }
        const comparable = (path: string) => process.platform === 'win32' ? resolve(path).toLowerCase() : resolve(path)
        const projectKey = projects.find(path => isAbsolute(path) && comparable(path) === comparable(root)) || root
        await source(claudeJson, 'mcp', 'private', env.CLAUDE_CONFIG_DIR ? claude : home, ['projects', projectKey, 'mcpServers'])
      }
    } else if (query.client === 'opencode') {
      await pair('opencode/skills', configHome, 'skill', [], '.opencode/skills')
      await pair('skills', claude, 'skill', [], '.claude/skills')
      await pair('.agents/skills', home, 'skill')
      for (const [base, scope, boundary] of [[join(configHome, 'opencode'), 'user', configHome], ...(root ? [[root, 'workspace', root]] : [])] as Array<[string, 'user' | 'workspace', string]>) {
        for (const extension of ['json', 'jsonc']) {
          const path = join(base, `opencode.${extension}`)
          if (extension === 'json' || await lstat(path).catch(() => undefined)) await source(path, 'mcp', scope, boundary, ['mcp'])
        }
      }
      if (env.OPENCODE_CONFIG) await source(resolve(env.OPENCODE_CONFIG), 'mcp', 'user', dirname(resolve(env.OPENCODE_CONFIG)), ['mcp'])
    } else {
      for (const plugin of this.deps.plugins?.() ?? []) {
        for (const skill of plugin.manifest.contributes.skills ?? []) {
          if (skill.scope === 'project' && !root) continue
          const id = `plugin:${plugin.manifest.id}:${skill.id}`
          const enabled = plugin.enabled && !['error', 'blocked', 'disabled'].includes(plugin.state)
            && (skill.scope === 'application' || plugin.projectScope === 'all' || plugin.projects.includes(query.workspaceId!))
          const item: Source = { id, path: plugin.source.directory, kind: 'skill', scope: 'plugin', boundary: '', keys: [], raw: '', revision: plugin.digest, exists: true, writable: false }
          sources.push(item)
          entries.push({ source: item, content: skill.instructions, revision: plugin.digest,
            view: { id, sourceId: id, kind: 'skill', name: skill.title, description: skill.description, path: plugin.source.directory, scope: 'plugin', inherited: Boolean(root && skill.scope === 'application'), writable: false, state: enabled ? 'discovered' : 'disabled', pluginId: plugin.manifest.id } })
        }
      }
    }
    // Native clients differ in merge semantics; report duplicates without inventing a universal winner.
    const counts = new Map<string, number>()
    for (const entry of entries) { const key = entry.view.kind + ':' + entry.view.name; counts.set(key, (counts.get(key) ?? 0) + 1) }
    for (const entry of entries) if ((counts.get(entry.view.kind + ':' + entry.view.name) ?? 0) > 1 && ['discovered', 'configured'].includes(entry.view.state)) entry.view.state = 'duplicate'
    return { root, sources, entries, limited }
  }

  async scan(query: LocalIntegrationQuery): Promise<LocalIntegrationCatalog> {
    const result = await this.discover(query)
    return { entries: result.entries.map(item => item.view), sources: result.sources.map(({ boundary: _boundary, keys: _keys, raw: _raw, ...view }) => view), scannedAt: new Date().toISOString(), workspacePath: result.root, limited: result.limited }
  }
  private async entry(query: LocalIntegrationQuery, id: string): Promise<Entry> {
    const entry = (await this.discover(query)).entries.find(item => item.view.id === id)
    if (!entry) throw new IntegrationError('entry-missing')
    return entry
  }
  async read(query: LocalIntegrationQuery, id: string): Promise<LocalIntegrationDocument> {
    const entry = await this.entry(query, id)
    return { entry: entry.view, content: entry.content, revision: entry.revision }
  }
  async revealPath(query: LocalIntegrationQuery, id: string): Promise<string> { return (await this.entry(query, id)).view.path }
  async prepareRemoval(query: LocalIntegrationQuery, id: string, revision: string): Promise<LocalIntegrationRemoval> {
    for (const [token, item] of this.removals) if (item.preview.expiresAt <= Date.now()) this.removals.delete(token)
    if (this.removals.size >= 32) this.removals.delete(this.removals.keys().next().value!)
    const entry = await this.entry(query, id)
    if (!entry.view.writable || !entry.source.writable || entry.view.pluginId) throw new IntegrationError('read-only')
    if (entry.revision !== revision) throw new IntegrationError('changed')
    const method = entry.view.kind === 'skill' ? 'trash' : 'config'
    const targetPath = method === 'trash' ? dirname(entry.view.path) : entry.view.path
    if (!await writablePath(entry.view.path, entry.source.boundary)) throw new IntegrationError('read-only')
    let tree: Awaited<ReturnType<typeof snapshotSkillRemoval>> | undefined
    if (method === 'trash') {
      if (!this.deps.trashItem) throw new IntegrationError('trash-unavailable')
      tree = await snapshotSkillRemoval(targetPath, entry.source.path)
    } else {
      if (!this.deps.backupDirectory) throw new IntegrationError('backup-failed')
      updateServer(entry.source.raw, query.client, entry.source.keys, entry.view.name, undefined)
    }
    if (hash(await readIntegrationFile(entry.view.path)) !== revision) throw new IntegrationError('changed')
    const preview: LocalIntegrationRemoval = { token: randomUUID(), entry: entry.view, targetPath, method, expiresAt: Date.now() + 5 * 60_000, ...(tree ? { fileCount: tree.fileCount } : {}) }
    this.removals.set(preview.token, { preview, query: { ...query }, revision, treeRevision: tree?.revision })
    return preview
  }
  private async backupConfiguration(raw: string) {
    const directory = this.deps.backupDirectory
    if (!directory) throw new IntegrationError('backup-failed')
    const backupId = randomUUID(), backupPath = join(directory, `${backupId}.config.bak`)
    try {
      if (!await writablePath(directory, dirname(directory))) throw new Error()
      await mkdir(directory, { recursive: true, mode: 0o700 })
      if (!await writablePath(backupPath, dirname(directory))) throw new Error()
      const file = await open(backupPath, 'wx', 0o600)
      try { await file.writeFile(raw, 'utf8'); await file.sync() } finally { await file.close() }
    } catch { throw new IntegrationError('backup-failed') }
    return { backupId, backupPath }
  }
  async revealBackupPath(backupId: string): Promise<string> {
    if (!this.deps.backupDirectory || !/^[a-f0-9-]{36}$/.test(backupId)) throw new IntegrationError('invalid-request')
    const path = join(this.deps.backupDirectory, `${backupId}.config.bak`)
    if (!await writablePath(path, dirname(this.deps.backupDirectory)) || !(await lstat(path)).isFile()) throw new IntegrationError('read-only')
    return path
  }
  remove(token: string): Promise<LocalIntegrationRemovalResult> {
    return this.queue.run(async () => {
      const pending = this.removals.get(token)
      this.removals.delete(token) // Single-use confirmation, including unsuccessful attempts.
      if (!pending || pending.preview.expiresAt <= Date.now()) throw new IntegrationError('delete-expired')
      const { preview, query, revision } = pending
      const entry = await this.entry(query, preview.entry.id)
      if (!entry.view.writable || !entry.source.writable || entry.view.pluginId || !await writablePath(entry.view.path, entry.source.boundary)) throw new IntegrationError('read-only')
      if (entry.revision !== revision || entry.view.path !== preview.entry.path) throw new IntegrationError('changed')
      if (preview.method === 'trash') {
        if (!this.deps.trashItem) throw new IntegrationError('trash-unavailable')
        const snapshot = await snapshotSkillRemoval(dirname(entry.view.path), entry.source.path)
        if (snapshot.revision !== pending.treeRevision || !await writablePath(entry.view.path, entry.source.boundary)) throw new IntegrationError('changed')
        try { await this.deps.trashItem(preview.targetPath) } catch { throw new IntegrationError('trash-unavailable') }
        return { method: 'trash' }
      }
      const updated = updateServer(entry.source.raw, query.client, entry.source.keys, entry.view.name, undefined)
      const backup = await this.backupConfiguration(entry.source.raw)
      if (!await writablePath(entry.view.path, entry.source.boundary) || hash(await readIntegrationFile(entry.view.path)) !== revision) throw new IntegrationError('changed')
      await writeIntegrationFile(entry.view.path, updated)
      return { method: 'config', ...backup }
    })
  }
  async probeConfiguration(query: LocalIntegrationQuery, id: string, revision: string) {
    const entry = await this.entry(query, id)
    if (entry.revision !== revision) throw new IntegrationError('changed')
    if (entry.view.kind !== 'mcp' || !entry.config || entry.view.state === 'invalid') throw new IntegrationError('invalid-server')
    if (entry.view.state === 'disabled') throw new IntegrationError('disabled')
    return { config: validateServer(entry.config, query.client), cwd: (await this.context(query)).root || this.deps.home }
  }
  save(input: LocalIntegrationSave): Promise<LocalIntegrationDocument> {
    return this.queue.run(async () => {
      if (!input || typeof input.content !== 'string' || Buffer.byteLength(input.content) > 256 * 1024 || input.content.includes('\0') || !/^[a-f0-9]{64}$/.test(input.expectedRevision)) throw new IntegrationError('invalid-request')
      const catalog = await this.discover(input.query)
      const source = catalog.sources.find(item => item.id === input.sourceId)
      if (!source || !source.writable) throw new IntegrationError('read-only')
      const existing = input.entryId ? catalog.entries.find(item => item.view.id === input.entryId && item.source.id === source.id) : undefined
      if (input.entryId && !existing) throw new IntegrationError('entry-missing')
      const revision = existing?.revision ?? source.revision
      if (revision !== input.expectedRevision) throw new IntegrationError('changed')
      if (existing && !existing.view.writable) throw new IntegrationError('read-only')
      let path: string, text: string, id: string
      if (source.kind === 'skill') {
        const data = parseSkill(input.content)
        if (!existing && (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.name) || input.name.length > 64 || data.name !== input.name)) throw new IntegrationError('invalid-name')
        path = existing?.view.path ?? join(source.path, input.name, 'SKILL.md')
        if (!existing && await lstat(dirname(path)).catch(error => { if (missing(error)) return undefined; throw error })) throw new IntegrationError('already-exists')
        text = input.content
        id = existing?.view.id ?? hash(source.id + '\0' + path)
      } else {
        if (!/^[\w.-]{1,128}$/.test(input.name) || ['__proto__', 'constructor', 'prototype'].includes(input.name)) throw new IntegrationError('invalid-name')
        if (existing && existing.view.name !== input.name) throw new IntegrationError('invalid-name')
        if (!existing && catalog.entries.some(item => item.source.id === source.id && item.view.name === input.name)) throw new IntegrationError('already-exists')
        let value: unknown
        try { value = JSON.parse(input.content) } catch { throw new IntegrationError('invalid-config') }
        const config = validateServer(value, input.query.client)
        path = source.path
        text = updateServer(source.raw, input.query.client, source.keys, input.name, config)
        id = existing?.view.id ?? hash(source.id + '\0' + input.name)
      }
      if (!await writablePath(path, source.boundary)) throw new IntegrationError('read-only')
      const expected = existing ? (source.kind === 'skill' ? existing.revision : source.revision) : source.kind === 'skill' ? hash('') : source.revision
      if (hash(await readIntegrationFile(path)) !== expected) throw new IntegrationError('changed')
      await mkdir(dirname(path), { recursive: true })
      if (!await writablePath(path, source.boundary) || hash(await readIntegrationFile(path)) !== expected) throw new IntegrationError('changed')
      await writeIntegrationFile(path, text)
      return this.read(input.query, id)
    })
  }
}
