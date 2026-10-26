import { afterEach, beforeEach, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { NoteMcpClients } from '../../plugins/blueprint/src/main/blueprint/mcp/clients'
import { clientEntry, updateClientConfig } from '../../plugins/blueprint/src/main/blueprint/mcp/client-config'

let root: string, service: NoteMcpClients
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'note-clients-'))
  const entry = join(root, 'note-mcp.js'); await writeFile(entry, '')
  service = new NoteMcpClients({ home: root, launch: { command: 'node', args: [entry], env: { JANUSX_NOTE_STATE_ROOT: join(root, 'state') } } })
})
afterEach(async () => { await rm(root, { recursive: true, force: true }) })

it.each(['claude-code', 'codex', 'opencode', 'janus', 'dsh'] as const)('imports, updates and removes only its own %s entry with stale-write protection', async id => {
  let state = (await service.status()).clients.find(client => client.id === id)!
  await mkdir(dirname(state.path), { recursive: true })
  const raw = id === 'dsh' ? '# keep comment\n- id: other\n  config:\n    dynamic: !!js process.env.EXAMPLE\n' : id === 'codex' ? '# keep comment\nmodel = "chosen"\n[mcp_servers.other]\ncommand = "other"\n' : '{\n// keep comment\n"unrelated":true,\n"' + (id === 'opencode' ? 'mcp' : 'mcpServers') + '":{"other":{"command":"other"}}\n}'
  await writeFile(state.path, raw)
  await expect(service.change({ client: id, action: 'import', expectedHash: state.hash })).rejects.toThrow('changed')
  state = (await service.status()).clients.find(client => client.id === id)!
  await service.change({ client: id, action: 'import', expectedHash: state.hash })
  const imported = await readFile(state.path, 'utf8')
  expect(imported).toContain('keep comment'); expect(imported).toContain('other')
  state = (await service.status()).clients.find(client => client.id === id)!
  expect(state.state).toBe('current')
  await service.change({ client: id, action: 'import', expectedHash: state.hash })
  expect(await readFile(state.path, 'utf8')).toBe(imported)
  const updated = new NoteMcpClients({ ...service.dirs, launch: { ...service.dirs.launch, command: 'new-node' } })
  expect((await updated.status()).clients.find(client => client.id === id)?.state).toBe('outdated')
  await updated.change({ client: id, action: 'import', expectedHash: state.hash })
  state = (await updated.status()).clients.find(client => client.id === id)!
  await updated.change({ client: id, action: 'remove', expectedHash: state.hash })
  const removed = await readFile(state.path, 'utf8')
  expect(clientEntry(removed, id === 'dsh' ? 'dsh' : id === 'codex' ? 'codex' : id === 'opencode' ? 'opencode' : 'mcpServers')).toBeUndefined()
  expect(removed).toContain('keep comment'); expect(removed).toContain('other')
})

it('does not overwrite collisions, malformed configs, or unverified clients', async () => {
  const path = join(root, '.claude.json')
  const conflict = '{"mcpServers":{"janusx-note":{"command":"custom"}}}'
  await writeFile(path, conflict)
  const state = (await service.status()).clients.find(client => client.id === 'claude-code')!
  expect(state.state).toBe('conflict')
  for (const action of ['import', 'remove'] as const) await expect(service.change({ client: state.id, action, expectedHash: state.hash })).rejects.toThrow('belongs')
  expect(await readFile(path, 'utf8')).toBe(conflict)
  await writeFile(path, '{broken')
  expect((await service.status()).clients.find(client => client.id === 'claude-code')?.state).toBe('unreadable')
  await expect(service.change({ client: 'pi', action: 'import', expectedHash: '' })).rejects.toThrow('not verified')
})

it('uses existing OpenCode JSONC and isolated custom config roots without creating project files', async () => {
  const custom = new NoteMcpClients({ ...service.dirs, codexHome: join(root, 'codex-custom'), configHome: join(root, 'config-custom') })
  const path = join(root, 'config-custom', 'opencode', 'opencode.jsonc')
  await mkdir(dirname(path), { recursive: true }); await writeFile(path, '{}')
  const status = await custom.status()
  expect(status.clients.find(client => client.id === 'opencode')?.path).toBe(path)
  expect(status.clients.find(client => client.id === 'codex')?.path).toBe(join(root, 'codex-custom', 'config.toml'))
})

it('rejects foreign entries and edited or duplicate DSH managed blocks', () => {
  const owned = updateClientConfig('', 'dsh', service.dirs.launch)
  const foreign = '- insert: [{id: janusx-note, name: custom, config: {}}]\n'
  expect(clientEntry(foreign, 'dsh')).toEqual({ foreign: true })
  expect(() => updateClientConfig(foreign, 'dsh', null)).toThrow('not owned')
  for (const damaged of [owned + owned, owned.replace('# janusx-note managed end', '- id: unrelated\n# janusx-note managed end'), owned.replace('# janusx-note managed end', '')]) {
    expect(() => updateClientConfig(damaged, 'dsh', null)).toThrow()
  }
})
