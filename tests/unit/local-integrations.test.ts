import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { LocalIntegrationService } from '../../src/main/local-integrations/service'
import { parseConfig, updateServer, validateServer } from '../../src/main/local-integrations/config'
import type { LocalIntegrationQuery } from '../../src/shared/local-integrations'

let temporary: string, home: string, workspace: string, service: LocalIntegrationService
const query: LocalIntegrationQuery = { client: 'codex', scope: 'workspace', workspaceId: 'project' }
const skill = (name: string, description = 'Review changes') => `---\nname: ${name}\ndescription: ${description}\n---\n\nKeep changes focused.\n`
async function put(path: string, content: string | Buffer) { await mkdir(dirname(path), { recursive: true }); await writeFile(path, content) }
beforeEach(async () => {
  temporary = await mkdtemp(join(tmpdir(), 'janus-local-integrations-'))
  home = join(temporary, 'home'); workspace = join(temporary, 'project')
  await mkdir(home); await mkdir(workspace)
  service = new LocalIntegrationService({ home, env: {}, resolveWorkspace: async id => id === 'project' ? workspace : 'runtime://remote' })
})
afterEach(async () => { await rm(temporary, { recursive: true, force: true }) })

describe('local resource discovery and guarded writes', () => {
  it('shows inherited, project, legacy, duplicate and malformed skills with real source paths', async () => {
    await put(join(home, '.agents/skills/review/SKILL.md'), skill('review'))
    await put(join(workspace, '.agents/skills/review/SKILL.md'), skill('review', 'Project review'))
    await put(join(workspace, '.codex/skills/legacy/SKILL.md'), skill('legacy'))
    await put(join(workspace, '.agents/skills/broken/SKILL.md'), '# Missing frontmatter')
    const result = await service.scan(query)
    expect(result.entries.filter(entry => entry.state === 'duplicate')).toHaveLength(2)
    expect(result.entries.find(entry => entry.inherited)?.scope).toBe('user')
    expect(result.entries.find(entry => entry.name === 'legacy')?.state).toBe('discovered')
    const broken = result.entries.find(entry => entry.name === 'broken')!
    expect(broken).toMatchObject({ state: 'invalid', issue: 'invalid-skill', writable: true })
    expect((await service.read(query, broken.id)).content).toBe('# Missing frontmatter')
    expect(JSON.stringify(result)).not.toContain('raw')
    expect((await service.scan({ client: 'codex', scope: 'user' })).entries).toHaveLength(1)
  })

  it('creates one skill, rejects traversal and duplicates, and keeps edits when the file changed externally', async () => {
    const source = (await service.scan(query)).sources.find(item => item.kind === 'skill' && item.scope === 'workspace')!
    const input = { query, sourceId: source.id, expectedRevision: source.revision, name: 'review', content: skill('review') }
    await expect(service.save({ ...input, name: '../escape' })).rejects.toThrow('invalid-name')
    const added = await service.save(input)
    expect(await readFile(added.entry.path, 'utf8')).toBe(input.content)
    await expect(service.save(input)).rejects.toThrow('already-exists')
    await writeFile(added.entry.path, skill('review', 'External edit'))
    await expect(service.save({ ...input, entryId: added.entry.id, expectedRevision: added.revision, content: skill('review', 'My edit') })).rejects.toThrow('changed')
    expect(await readFile(added.entry.path, 'utf8')).toContain('External edit')
    await expect(service.read(query, '../../outside')).rejects.toThrow('entry-missing')
    await expect(service.scan({ ...query, workspaceId: 'remote' })).rejects.toThrow('local-only')
  })

  it('keeps Claude personal project MCP separate and updates only its entry with comments and BOM intact', async () => {
    const path = join(home, '.claude.json')
    const data = { preference: 'keep', mcpServers: { user: { command: 'node' } }, projects: { [workspace]: { trust: true, mcpServers: { personal: { command: 'old', env: { SECRET: 'not-in-catalog' } } } } } }
    await put(path, '\uFEFF// keep this comment\r\n' + JSON.stringify(data, null, 2).replace(/\n/g, '\r\n'))
    await put(join(workspace, '.mcp.json'), '{"mcpServers":{"project":{"url":"https://example.com/mcp?token=secret"}}}')
    const claude: LocalIntegrationQuery = { ...query, client: 'claude' }
    const catalog = await service.scan(claude)
    expect(catalog.entries.map(entry => entry.scope).sort()).toEqual(['private', 'user', 'workspace'])
    expect(JSON.stringify(catalog)).not.toContain('not-in-catalog')
    expect(JSON.stringify(catalog)).not.toContain('token=secret')
    const entry = catalog.entries.find(item => item.name === 'personal')!
    const document = await service.read(claude, entry.id)
    await service.save({ query: claude, sourceId: entry.sourceId, entryId: entry.id, name: entry.name, content: '{"command":"new"}', expectedRevision: document.revision })
    const saved = await readFile(path, 'utf8')
    expect(saved.startsWith('\uFEFF// keep this comment\r\n')).toBe(true)
    expect(parseConfig(saved, 'claude')).toEqual({ ...data, projects: { [workspace]: { trust: true, mcpServers: { personal: { command: 'new' } } } } })
  })

  it('isolates malformed source files so project resources remain usable', async () => {
    await put(join(home, '.claude.json'), '{broken')
    await put(join(workspace, '.mcp.json'), '{"mcpServers":{"valid":{"command":"node"}}}')
    await put(join(workspace, '.claude/skills/project/SKILL.md'), skill('project'))
    const result = await service.scan({ ...query, client: 'claude' })
    expect(result.entries.map(entry => entry.name)).toEqual(['project', 'valid'])
    expect(result.sources.filter(source => source.issue === 'invalid-config')).toHaveLength(2)
    expect(result.sources.filter(source => source.issue).every(source => !source.writable)).toBe(true)
  })

  it('reads linked skill directories without granting write access', async () => {
    const original = join(temporary, 'external-skill')
    await put(join(original, 'SKILL.md'), skill('linked'))
    const skills = join(workspace, '.agents/skills')
    await mkdir(skills, { recursive: true })
    await symlink(original, join(skills, 'linked'), process.platform === 'win32' ? 'junction' : 'dir')
    const entry = (await service.scan(query)).entries[0]
    expect(entry).toMatchObject({ name: 'linked', writable: false })
    const document = await service.read(query, entry.id)
    await expect(service.save({ query, entryId: entry.id, sourceId: entry.sourceId, name: 'linked', content: skill('linked'), expectedRevision: document.revision })).rejects.toThrow('read-only')
    expect(await readFile(join(original, 'SKILL.md'), 'utf8')).toBe(skill('linked'))
  })

  it('preserves UTF-8 failures and oversized files without offering edits', async () => {
    await put(join(workspace, '.agents/skills/encoding/SKILL.md'), Buffer.from([0xff, 0xfe, 0x61]))
    await put(join(workspace, '.codex/config.toml'), 'x'.repeat(1024 * 1024 + 1))
    const result = await service.scan(query)
    expect(result.entries[0]).toMatchObject({ issue: 'encoding', writable: false })
    expect(result.sources.find(source => source.scope === 'workspace' && source.kind === 'mcp')).toMatchObject({ issue: 'file-limit', writable: false })
  })

  it('reads OpenCode native command arrays, JSONC and disabled servers; refuses stale probes', async () => {
    await put(join(workspace, 'opencode.jsonc'), '// retained\n{"mcp":{"local":{"type":"local","command":["node","server.js"]},"off":{"type":"remote","url":"https://example.com/mcp","enabled":false}},"theme":"keep"}')
    const opencode: LocalIntegrationQuery = { ...query, client: 'opencode' }
    const catalog = await service.scan(opencode)
    expect(catalog.entries.find(entry => entry.name === 'off')?.state).toBe('disabled')
    const entry = catalog.entries.find(entry => entry.name === 'local')!
    const document = await service.read(opencode, entry.id)
    expect(await service.probeConfiguration(opencode, entry.id, document.revision)).toMatchObject({ config: { command: ['node', 'server.js'] }, cwd: workspace })
    await service.save({ query: opencode, sourceId: entry.sourceId, entryId: entry.id, name: entry.name, content: '{"type":"local","command":["node","updated.js"]}', expectedRevision: document.revision })
    const saved = await readFile(entry.path, 'utf8')
    expect(saved).toContain('// retained')
    expect(parseConfig(saved, 'opencode').theme).toBe('keep')
    await expect(service.probeConfiguration(opencode, entry.id, document.revision)).rejects.toThrow('changed')
  })
})

describe('native MCP configuration edits', () => {
  it('preserves unrelated TOML settings, tables, comments and line endings', () => {
    const original = '# preference\r\nmodel = "gpt-5"\r\n[mcp_servers.target]\r\ncommand = "old"\r\n[mcp_servers.target.env]\r\nTOKEN = "previous"\r\n[mcp_servers.other]\r\n# other server comment\r\ncommand = "stay"\r\n[projects."C:/work"]\r\ntrust_level = "trusted"\r\n'
    const updated = updateServer(original, 'codex', ['mcp_servers'], 'target', { url: 'https://example.com/mcp', http_headers: { Test: 'value' } })
    expect(updated).toContain('# preference\r\n')
    expect(updated).toContain('# other server comment\r\ncommand = "stay"')
    expect(parseConfig(updated, 'codex')).toEqual({ model: 'gpt-5', mcp_servers: { target: { url: 'https://example.com/mcp', http_headers: { Test: 'value' } }, other: { command: 'stay' } }, projects: { 'C:/work': { trust_level: 'trusted' } } })
    expect(() => updateServer('mcp_servers = { target = { command = "old" } }', 'codex', ['mcp_servers'], 'target', { command: 'new' })).toThrow('toml-layout')
  })

  it('adds safely quoted TOML names and rejects invalid native command shapes', () => {
    expect(validateServer({ url: '${SERVER_URL}' }, 'claude')).toEqual({ url: '${SERVER_URL}' })
    expect(parseConfig(updateServer('', 'codex', ['mcp_servers'], 'a.b', { command: 'node' }), 'codex')).toEqual({ mcp_servers: { 'a.b': { command: 'node' } } })
    expect(() => validateServer({ type: 'local', command: [''] }, 'opencode')).toThrow('invalid-server')
    expect(() => validateServer({ command: ['node'] }, 'codex')).toThrow('invalid-server')
    expect(() => validateServer({ url: 'file:///tmp/mcp' }, 'claude')).toThrow('invalid-server')
  })
})


describe('safe removal', () => {
  const setup = (trashItem?: (path: string) => Promise<void>) => new LocalIntegrationService({ home, env: {}, resolveWorkspace: async () => workspace, trashItem, backupDirectory: join(temporary, 'backups') })
  it('trashes only the confirmed skill folder and rejects token reuse', async () => {
    const folder = join(workspace, '.agents/skills/review')
    await put(join(folder, 'SKILL.md'), skill('review'))
    await put(join(folder, 'scripts/check.js'), 'resource')
    const trashed: string[] = []
    service = setup(async path => { trashed.push(path) })
    const entry = (await service.scan(query)).entries[0], doc = await service.read(query, entry.id)
    const preview = await service.prepareRemoval(query, entry.id, doc.revision)
    expect(preview).toMatchObject({ targetPath: folder, method: 'trash', fileCount: 2 })
    expect(trashed).toEqual([])
    await service.remove(preview.token)
    expect(trashed).toEqual([folder])
    await expect(service.remove(preview.token)).rejects.toThrow('delete-expired')
  })
  it('rejects changed resources and a failing trash operation without permanent deletion', async () => {
    const folder = join(workspace, '.agents/skills/review')
    await put(join(folder, 'SKILL.md'), skill('review'))
    await put(join(folder, 'asset.txt'), 'before')
    let calls = 0
    service = setup(async () => { calls++; throw new Error('unavailable') })
    const entry = (await service.scan(query)).entries[0], doc = await service.read(query, entry.id)
    const preview = await service.prepareRemoval(query, entry.id, doc.revision)
    await put(join(folder, 'asset.txt'), 'after')
    await expect(service.remove(preview.token)).rejects.toThrow('changed')
    expect(calls).toBe(0)
    const next = await service.prepareRemoval(query, entry.id, doc.revision)
    await expect(service.remove(next.token)).rejects.toThrow('trash-unavailable')
    expect(await readFile(join(folder, 'SKILL.md'), 'utf8')).toBe(skill('review'))
  })
  it('rejects nested skills, linked resources and collection roots', async () => {
    const folder = join(workspace, '.agents/skills/review')
    await put(join(folder, 'SKILL.md'), skill('review'))
    await put(join(folder, 'nested/SKILL.md'), skill('nested'))
    service = setup(async () => { throw new Error('must not run') })
    const entry = (await service.scan(query)).entries[0], doc = await service.read(query, entry.id)
    await expect(service.prepareRemoval(query, entry.id, doc.revision)).rejects.toThrow('unsafe-delete')
    await rm(join(folder, 'nested'), { recursive: true })
    const external = join(temporary, 'external'); await mkdir(external)
    await symlink(external, join(folder, 'linked'), process.platform === 'win32' ? 'junction' : 'dir')
    await expect(service.prepareRemoval(query, entry.id, doc.revision)).rejects.toThrow('unsafe-delete')
    await put(join(workspace, '.agents/skills/SKILL.md'), skill('collection'))
    const root = (await service.scan(query)).entries[0], rootDoc = await service.read(query, root.id)
    await expect(service.prepareRemoval(query, root.id, rootDoc.revision)).rejects.toThrow('unsafe-delete')
  })
  it.each(['codex', 'claude', 'opencode'] as const)('backs up %s and preserves unrelated configuration', async client => {
    const q = { ...query, client }
    const raw = client === 'codex' ? '# keep\r\nmodel="keep"\r\n[mcp_servers.target]\r\ncommand="node"\r\n[mcp_servers.other]\r\ncommand="stay"\r\n' : client === 'claude' ? '// keep\n{"setting":true,"mcpServers":{"target":{"command":"node"},"other":{"command":"stay"}}}' : '// keep\n{"setting":true,"mcp":{"target":{"type":"local","command":["node"]},"other":{"type":"local","command":["stay"]}}}'
    const path = join(workspace, client === 'codex' ? '.codex/config.toml' : client === 'claude' ? '.mcp.json' : 'opencode.jsonc')
    await put(path, raw); service = setup()
    const entry = (await service.scan(q)).entries.find(item => item.name === 'target')!, doc = await service.read(q, entry.id)
    const preview = await service.prepareRemoval(q, entry.id, doc.revision)
    const result = await service.remove(preview.token)
    expect(await readFile(result.backupPath!, 'utf8')).toBe(raw)
    expect(await service.revealBackupPath(result.backupId!)).toBe(result.backupPath)
    const text = await readFile(path, 'utf8'); expect(text).toContain('keep')
    const parsed = parseConfig(text, client), key = client === 'codex' ? 'mcp_servers' : client === 'claude' ? 'mcpServers' : 'mcp'
    expect(Object.keys(parsed[key] as object)).toEqual(['other'])
    await expect(service.revealBackupPath('../outside')).rejects.toThrow('invalid-request')
  })
  it('preserves an externally changed MCP file', async () => {
    const path = join(workspace, '.codex/config.toml')
    await put(path, '[mcp_servers.target]\ncommand="node"\n'); service = setup()
    const entry = (await service.scan(query)).entries[0], doc = await service.read(query, entry.id)
    const preview = await service.prepareRemoval(query, entry.id, doc.revision)
    await put(path, '[mcp_servers.target]\ncommand="changed"\n')
    await expect(service.remove(preview.token)).rejects.toThrow('changed')
    expect(await readFile(path, 'utf8')).toContain('changed')
  })
})


it('cancels MCP removal when a backup cannot be written', async () => {
  const path = join(workspace, '.codex/config.toml'), raw = '[mcp_servers.target]\ncommand="node"\n'
  await put(path, raw)
  const blocked = join(temporary, 'not-a-directory'); await put(blocked, 'keep')
  service = new LocalIntegrationService({ home, env: {}, resolveWorkspace: async () => workspace, backupDirectory: blocked })
  const entry = (await service.scan(query)).entries[0], doc = await service.read(query, entry.id)
  const preview = await service.prepareRemoval(query, entry.id, doc.revision)
  await expect(service.remove(preview.token)).rejects.toThrow('backup-failed')
  expect(await readFile(path, 'utf8')).toBe(raw)
})
