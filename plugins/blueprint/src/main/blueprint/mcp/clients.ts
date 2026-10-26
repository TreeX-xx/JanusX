// Note: global registration does not bind a project — see .agents/notes/blueprint/note-mcp.md
import { access, copyFile, readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { SerialQueue, writeFileAtomic } from '@janusx/plugin-sdk/native'
import { clientEntry, desiredEntry, updateClientConfig, type McpConfigFormat, type McpLaunch } from './client-config'
import type { NoteMcpChange, NoteMcpClient, NoteMcpClientStatus, NoteMcpStatus } from '../../../shared/note-mcp'

export interface NoteMcpDirectories { home: string; codexHome?: string; configHome?: string; dshHome?: string; launch: McpLaunch }
const adapters: Array<{ id: NoteMcpClient; label: string; format?: McpConfigFormat }> = [
  { id: 'claude-code', label: 'Claude Code', format: 'mcpServers' },
  { id: 'codex', label: 'Codex', format: 'codex' },
  { id: 'opencode', label: 'OpenCode', format: 'opencode' },
  { id: 'janus', label: 'Janus CLI', format: 'mcpServers' }, { id: 'pi', label: 'Pi' }, { id: 'dsh', label: 'DSH', format: 'dsh' },
]
const hash = (raw: string) => createHash('sha256').update(raw).digest('hex')
async function read(path: string) { try { return await readFile(path, 'utf8') } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''; throw error } }
async function exists(path: string) { try { await access(path); return true } catch { return false } }
function owned(entry: unknown, format: McpConfigFormat): boolean {
  if (!entry || typeof entry !== 'object') return false
  const value = entry as Record<string, unknown>
  const args = format === 'opencode' ? value.command : value.args
  const env = (format === 'opencode' ? value.environment : value.env) as Record<string, unknown> | undefined
  if (!Array.isArray(args)) return false
  const legacy = typeof args.at(-1) === 'string' && basename(args.at(-1)).replace(/\.[cm]?js$/, '') === 'note-mcp'
    && (typeof env?.JANUSX_NOTE_STATE_ROOT === 'string' || typeof env?.JANUSX_PLUGIN_HOME === 'string')
  const current = args.length >= 3 && typeof args.at(-3) === 'string' && basename(args.at(-3)).replace(/\.[cm]?js$/, '') === 'plugin-mcp'
    && args.at(-2) === 'official.blueprint' && args.at(-1) === 'note' && typeof env?.JANUSX_PLUGIN_HOME === 'string'
  return legacy || current
}
export class NoteMcpClients {
  private queue = new SerialQueue()
  constructor(readonly dirs: NoteMcpDirectories) {}
  private async path(client: NoteMcpClient): Promise<string> {
    if (client === 'claude-code') return join(this.dirs.home, '.claude.json')
    if (client === 'codex') return join(this.dirs.codexHome ?? join(this.dirs.home, '.codex'), 'config.toml')
    if (client === 'janus') return join(this.dirs.home, '.janus', 'mcp.json')
    if (client === 'dsh') return join(this.dirs.dshHome ?? join(this.dirs.home, '.dsh'), 'cordis.patch.yml')
    if (client === 'opencode') {
      const path = join(this.dirs.configHome ?? join(this.dirs.home, '.config'), 'opencode', 'opencode.json')
      return await exists(path + 'c') ? path + 'c' : path
    }
    return ''
  }
  async status(): Promise<NoteMcpStatus> {
    const clients = await Promise.all(adapters.map(async (adapter): Promise<NoteMcpClientStatus> => {
      const path = await this.path(adapter.id)
      const base = { id: adapter.id, label: adapter.label, path, hash: '' }
      if (!adapter.format) return { ...base, state: 'unverified' }
      try {
        const raw = await read(path), entry = clientEntry(raw, adapter.format)
        const state = entry === undefined ? 'absent' : isDeepStrictEqual(JSON.parse(JSON.stringify(entry)), desiredEntry(adapter.format, this.dirs.launch))
          ? 'current' : owned(entry, adapter.format) ? 'outdated' : 'conflict'
        return { ...base, hash: hash(raw), state }
      } catch { return { ...base, state: 'unreadable' } }
    }))
    return { available: await exists(this.dirs.launch.args[0] ?? ''), clients }
  }
  change(input: NoteMcpChange): Promise<void> {
    return this.queue.run(async () => {
      const adapter = adapters.find(value => value.id === input.client)
      if (!adapter?.format) throw new Error('Client integration is not verified')
      const path = await this.path(input.client), before = await read(path)
      if (hash(before) !== input.expectedHash) throw new Error('Client configuration changed; refresh before retrying')
      const entry = clientEntry(before, adapter.format)
      if (entry !== undefined && !owned(entry, adapter.format)) throw new Error('The janusx-note name belongs to another configuration; resolve the conflict in the client first')
      if (input.action === 'import' && !await exists(this.dirs.launch.args[0] ?? '')) throw new Error('Note MCP build is unavailable')
      if (entry === undefined && input.action === 'remove') return
      if (input.action === 'import' && entry !== undefined && isDeepStrictEqual(JSON.parse(JSON.stringify(entry)), desiredEntry(adapter.format, this.dirs.launch))) return
      const after = updateClientConfig(before, adapter.format, input.action === 'import' ? this.dirs.launch : null)
      if (before === after) return
      if (before) await copyFile(path, `${path}.janusx-note-backup-${Date.now()}`)
      if (await read(path) !== before) throw new Error('Client configuration changed; refresh before retrying')
      await writeFileAtomic(path, after)
    })
  }
}
