import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { BrowserTerminalClients } from '../../src/main/browser/terminal-clients'
import { LocalIntegrationService } from '../../src/main/local-integrations/service'
import { BROWSER_CLIENTS, type BrowserClient } from '../../src/shared/ipc/control'

let root: string, home: string, clients: BrowserTerminalClients, service: LocalIntegrationService
const disconnect = vi.fn(async () => {})
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'browser-clients-')); home = join(root, 'home'); await mkdir(home)
  const bundle = join(root, 'pi.mjs'); await writeFile(bundle, 'export default function () {}')
  service = new LocalIntegrationService({ home, env: {}, resolveWorkspace: async () => undefined, backupDirectory: join(root, 'backups') })
  clients = new BrowserTerminalClients({ service, home, env: {}, directory: join(root, 'browser'), entry: join(root, 'browser-mcp.js'), executable: process.execPath, piBundle: bundle, disconnect })
})
afterEach(async () => { await rm(root, { recursive: true, force: true }) })
const status = async (id: BrowserClient) => (await clients.status()).find(row => row.id === id)!
describe('browser terminal registrations', () => {
  it.each(BROWSER_CLIENTS)('registers and removes %s without overwriting unrelated native settings', async id => {
    const initial = await status(id)
    expect(initial.state).toBe('absent')
    const raw = id === 'codex' ? '# keep this\nmodel = "custom-model"\n[mcp_servers.other]\ncommand = "other"\n'
      : id === 'dsh' ? '# keep this\n- insert: [{id: other, name: other-plugin}]\n'
        : id === 'pi' ? '{"extensions":["other-extension"],"theme":"custom"}'
          : JSON.stringify({ theme: 'custom', [id === 'opencode' ? 'mcp' : 'mcpServers']: { other: id === 'opencode' ? { type: 'local', command: ['other'] } : { command: 'other' } } })
    await mkdir(join(initial.path, '..'), { recursive: true }); await writeFile(initial.path, raw)
    const before = await status(id)
    await clients.change({ client: id, action: 'import', expectedRevision: before.revision })
    const registered = await status(id)
    expect(registered.state).toBe('configured')
    const text = await readFile(registered.path, 'utf8')
    expect(text).toContain('other')
    if (!['pi', 'dsh'].includes(id)) {
      const scanned = await service.scan({ client: id as 'codex', scope: 'user' })
      expect(scanned.entries.filter(entry => entry.name === 'janusx-browser')).toHaveLength(1)
    }
    await clients.change({ client: id, action: 'remove', expectedRevision: registered.revision })
    expect((await status(id)).state).toBe('absent')
    expect(await readFile(registered.path, 'utf8')).toContain('other')
    expect(await readFile(registered.path, 'utf8')).not.toContain('janusx-browser')
  })
  it('refuses stale revisions and a foreign registration', async () => {
    const before = await status('codex')
    await mkdir(join(home, '.codex'), { recursive: true })
    await writeFile(before.path, '[mcp_servers.janusx-browser]\ncommand="someone-else"\n')
    expect((await status('codex')).state).toBe('conflict')
    await expect(clients.change({ client: 'codex', action: 'import', expectedRevision: before.revision })).rejects.toThrow('another MCP')
    const pi = await status('pi')
    await mkdir(join(home, '.pi', 'agent'), { recursive: true }); await writeFile(pi.path, '{"extensions":["new"]}')
    await expect(clients.change({ client: 'pi', action: 'import', expectedRevision: pi.revision })).rejects.toThrow('changed')
  })
  it('can remove the browser registration through the shared Skills/MCP service', async () => {
    const before = await status('claude')
    await clients.change({ client: 'claude', action: 'import', expectedRevision: before.revision })
    const query = { client: 'claude' as const, scope: 'user' as const }
    const entry = (await service.scan(query)).entries.find(row => row.name === 'janusx-browser')!
    const doc = await service.read(query, entry.id)
    const removal = await service.prepareRemoval(query, entry.id, doc.revision)
    await service.remove(removal.token)
    expect((await status('claude')).state).toBe('absent')
  })
})
