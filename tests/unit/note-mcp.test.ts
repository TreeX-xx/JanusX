import { beforeAll, afterAll, expect, it } from 'vitest'
import { build } from 'esbuild'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { SUPPORTED_HARNESS_PROFILE } from '@janus-agent/harness-node'
import { WorkspaceSuggestionSources } from '../../plugins/blueprint/src/main/blueprint/suggestions/sources'
import { WorkspaceSuggestions } from '../../plugins/blueprint/src/main/blueprint/suggestions/workspace-service'
import { ReviewStore } from '../../plugins/blueprint/src/main/blueprint/suggestions/store'
import { SuggestionService } from '../../plugins/blueprint/src/main/blueprint/suggestions/service'

let root: string, client: Client, transport: StdioClientTransport, store: ReviewStore, sources: WorkspaceSuggestionSources
let a: string, b: string, uri: string, noteId: string, findingId: string
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'note-mcp-')); a = join(root, 'a'); b = join(root, 'b')
  await mkdir('.cache/note-mcp', { recursive: true })
  await build({ entryPoints: ['plugins/blueprint/src/main/blueprint/note-mcp.ts'], outfile: '.cache/note-mcp/server.mjs', bundle: true, platform: 'node', format: 'esm', packages: 'external' })
  noteId = randomUUID(); const repoId = randomUUID(); uri = `note://${repoId}/${noteId}`
  for (const [path, title] of [[a, 'Alpha'], [b, 'Beta']]) {
    await mkdir(join(path, '.agents/notes'), { recursive: true })
    await writeFile(join(path, '.agents/harness.json'), JSON.stringify({ schemaVersion: 1, repoId, name: title, profile: SUPPORTED_HARNESS_PROFILE }))
    await writeFile(join(path, '.agents/notes/module.md'), '---\n' + JSON.stringify({ schema: 'harness-note/2', id: noteId, kind: 'module', role: 'project', lifecycle: 'accepted', moduleState: 'partial', created: '2026-10-10', updated: '2026-10-10T00:00:00Z' }, null, 2) + `\n---\n\n# ${title}\n\n## Responsibility\n\nRead and maintain original Notes.\n\n## Design\n\nThe recovery design is pending.\n`)
  }
  sources = new WorkspaceSuggestionSources(); store = new ReviewStore(join(root, 'state/current-suggestions.sqlite'))
  const workspace = new WorkspaceSuggestions(new SuggestionService(store), sources)
  const context = await sources.context(a); const ticket = await workspace.begin(context, noteId, [])
  findingId = randomUUID()
  await workspace.publish(context, noteId, ticket.id, { findings: [{ id: findingId, category: 'insufficient', summary: 'Recovery needs a boundary', explanation: 'A recovery design is explicitly pending.', suggestion: 'Describe the recovery boundary.', citations: [{ path: '.agents/notes/module.md', quote: 'The recovery design is pending.' }], verification: 'not-configured' }], coverage: 'complete', limitations: [], resolvedFindings: [] })
  client = new Client({ name: 'independent-note-consumer', version: '1.0.0' })
  transport = new StdioClientTransport({ command: process.execPath, args: [resolve('.cache/note-mcp/server.mjs')], cwd: root, env: { ...process.env as Record<string,string>, JANUSX_NOTE_STATE_ROOT: join(root, 'state') }, stderr: 'pipe' })
  let stderr = ''
  transport.stderr?.on('data', data => { stderr += String(data) })
  try { await client.connect(transport) } catch { throw new Error('Note MCP startup: ' + stderr.slice(0, 4000)) }
}, 20000)
afterAll(async () => { await client?.close(); await transport?.close(); sources?.notes.unwatchAll(); store?.close(); await rm(root, { recursive: true, force: true }) })
const call = async (name: string, args: Record<string, unknown>) => {
  const response = await client.callTool({ name, arguments: args })
  const text = (response.content as Array<{ text: string }>)[0].text
  if (response.isError) throw new Error(text)
  return JSON.parse(text)
}
async function freshWorkspace() {
  const path = join(root, randomUUID())
  await mkdir(join(path, '.agents/notes'), { recursive: true })
  await writeFile(join(path, '.agents/harness.json'), await readFile(join(a, '.agents/harness.json')))
  await writeFile(join(path, '.agents/notes/module.md'), await readFile(join(a, '.agents/notes/module.md')))
  return path
}
it('runs without a desktop or WorkflowX, uses explicit invocation roots and shared suggestions', async () => {
  const tools = (await client.listTools()).tools.map(tool => tool.name)
  expect(tools).toEqual(expect.arrayContaining(['note.list','note.read','note.write','note.init','note.context','note.suggestions','note.suggestions.close']))
  expect(tools.some(name => /review|generate/.test(name))).toBe(false)
  await expect(call('note.list', {})).rejects.toThrow('workspacePath')
  expect((await call('note.list', { workspacePath: a })).notes[0].title).toBe('Alpha')
  expect((await call('note.list', { workspacePath: b })).notes[0].title).toBe('Beta')
  const view = await call('note.suggestions', { workspacePath: a, noteId })
  expect(view.items[0].report.findings[0].id).toBe(findingId)
  expect((await call('note.suggestions', { workspacePath: b, noteId })).items).toEqual([])
  const note = await call('note.read', { workspacePath: a, uri })
  await call('note.write', { workspacePath: a, reason: 'Define the authorized recovery boundary', operations: [{ type: 'update', uri, expectedHash: note.expectedHash, sections: { Design: 'Recover pending work once after restart.' } }] })
  const updated = await call('note.read', { workspacePath: a, uri })
  expect(updated.markdown).toContain('Recover pending work once after restart.')
  const stale = await call('note.suggestions', { workspacePath: a, noteId })
  expect(stale.items[0].report.stale).toBe(true)
  await expect(call('note.suggestions.close', { workspacePath: a, noteId, branch: view.context.branch, reportRevision: view.items[0].reportRevision, findingIds: [findingId] })).rejects.toThrow()
  await call('note.suggestions.close', { workspacePath: a, noteId, branch: stale.context.branch, reportRevision: stale.items[0].reportRevision, findingIds: [findingId] })
  expect((await call('note.suggestions', { workspacePath: a, noteId })).items).toEqual([])
  expect((await call('note.context', { workspacePath: a, uris: [uri] })).notes[0].expectedHash).toBe(updated.expectedHash)
  expect((await call('note.read', { workspacePath: b, uri })).markdown).toContain('The recovery design is pending.')
})

it('reports missing context materials and provides a readable maintenance guide', async () => {
  const missing = uri.replace(noteId, randomUUID())
  const context = await call('note.context', { workspacePath: b, uris: [uri, missing] })
  expect(context.notes).toHaveLength(1)
  expect(context.unavailable).toEqual([{ uri: missing, reason: 'Source is absent or invalid' }])
  expect(context.continuation).toContain('expectedHash')
  const guide = await client.readResource({ uri: 'janusx-note://maintenance' })
  expect(guide.contents[0].text).toContain('note.suggestions')
})

it('updates a Note read through context and preserves unrelated sections', async () => {
  const workspacePath = await freshWorkspace()
  const context = await call('note.context', { workspacePath, uris: [uri] })
  const page = context.notes[0]
  const result = await call('note.write', { workspacePath, reason: 'Define recovery from the selected context',
    operations: [{ type: 'update', uri, expectedHash: page.expectedHash, sections: { Design: 'Recover after restart.' } }] })
  expect(result.status).toBe('applied')
  const updated = await call('note.read', { workspacePath, uri })
  expect(updated.markdown).toContain('Recover after restart.')
  expect(updated.markdown).toContain('Read and maintain original Notes.')
})

it('exposes and executes hash-bound continuation and rejects changed source pages', async () => {
  const definition = (await client.listTools()).tools.find(tool => tool.name === 'note.read')!
  expect(definition.inputSchema.properties).toHaveProperty('expectedHash')
  const file = join(b, '.agents/notes/module.md')
  const original = await readFile(file, 'utf8')
  try {
    await writeFile(file, original + '\n' + 'Long source line\n'.repeat(100))
    const first = await call('note.read', { workspacePath: b, uri, maxChars: 500 })
    const next = await call('note.read', { workspacePath: b, uri, offset: first.nextOffset, maxChars: 500, expectedHash: first.expectedHash })
    expect(next.expectedHash).toBe(first.expectedHash)
    expect(next.offset).toBe(first.nextOffset)
    await writeFile(file, original + '\nExternal modification\n')
    await expect(call('note.read', { workspacePath: b, uri, offset: first.nextOffset, expectedHash: first.expectedHash })).rejects.toThrow('CONFLICT')
  } finally { await writeFile(file, original) }
})

it('requires a successful source read rather than a list hash before updating', async () => {
  const workspacePath = await freshWorkspace()
  const file = join(workspacePath, '.agents/notes/module.md'), original = await readFile(file, 'utf8')
  const listed = await call('note.list', { workspacePath })
  const operations = [{ type: 'update', uri, expectedHash: listed.notes[0].sourceHash, sections: { Design: 'Unexpected change' } }]
  await expect(call('note.write', { workspacePath, reason: 'Update design', operations })).rejects.toThrow('Read the Note')
  expect(await readFile(file, 'utf8')).toBe(original)
  await call('note.read', { workspacePath, uri })
  expect((await call('note.write', { workspacePath, reason: 'Update design', operations })).status).toBe('applied')
})

it('identifies malformed update arguments and preserves source for a corrected retry', async () => {
  const workspacePath = await freshWorkspace()
  const page = await call('note.read', { workspacePath, uri })
  const file = join(workspacePath, '.agents/notes/module.md'), original = await readFile(file, 'utf8')
  await expect(call('note.write', { workspacePath, reason: 'Update design',
    operations: [{ type: 'update', uri, sections: { Design: 'New design' } }] })).rejects.toThrow('require uri and expectedHash')
  await expect(call('note.write', { workspacePath, reason: 'Update design',
    operations: [{ type: 'update', uri, expectedHash: page.expectedHash, sections: ['New design'] }] })).rejects.toThrow('operations.0.sections')
  await expect(call('note.write', { workspacePath, reason: 'Update design',
    operations: [{ type: 'update', uri, expectedHash: page.expectedHash, markdown: 'Raw document' }] })).rejects.toThrow('markdown')
  expect(await readFile(file, 'utf8')).toBe(original)
  expect((await call('note.write', { workspacePath, reason: 'Update design',
    operations: [{ type: 'update', uri, expectedHash: page.expectedHash, sections: { Design: 'Corrected design body' } }] })).status).toBe('applied')
})

it('a stale update cannot partially apply a mixed create/update transaction', async () => {
  const workspacePath = await freshWorkspace()
  const page = await call('note.read', { workspacePath, uri })
  const file = join(workspacePath, '.agents/notes/module.md')
  const external = page.markdown + '\nExternal change\n'
  await writeFile(file, external)
  await expect(call('note.write', { workspacePath, reason: 'Apply changes atomically', operations: [
    { type: 'create', kind: 'note', title: 'Atomic new topic', module: uri, sections: { Summary: 'New topic body' } },
    { type: 'update', uri, expectedHash: page.expectedHash, sections: { Design: 'Unexpected overwrite' } },
  ] })).rejects.toThrow('CONFLICT')
  expect(await readFile(file, 'utf8')).toBe(external)
  expect((await call('note.list', { workspacePath })).notes).toHaveLength(1)
})

it('initializes a workspace explicitly, creates a topic and updates it through its context', async () => {
  const workspacePath = join(root, randomUUID())
  await mkdir(workspacePath)
  const preview = await call('note.init', { workspacePath, name: 'MCP maintenance fixture' })
  expect(preview.files.map((file: { path: string }) => file.path)).toEqual(expect.arrayContaining(['.agents/harness.json', '.agents/notes/module.md']))
  await call('note.init', { workspacePath, previewId: preview.previewId })
  const module = (await call('note.list', { workspacePath })).notes[0]
  const created = await call('note.write', { workspacePath, reason: 'Create stable topic', operations: [
    { type: 'create', kind: 'note', title: '维护专题', module: module.uri, sections: { Summary: '原始专题正文。' } },
  ] })
  const target = created.files[0].uri
  const context = await call('note.context', { workspacePath, uris: [target] })
  expect(context.notes.map((page: { uri: string }) => page.uri)).toContain(module.uri)
  const page = context.notes.find((page: { uri: string }) => page.uri === target)
  await call('note.write', { workspacePath, reason: 'Update stable topic', operations: [
    { type: 'update', uri: target, expectedHash: page.expectedHash, sections: { Summary: '更新后的专题正文。' } },
  ] })
  expect((await call('note.read', { workspacePath, uri: target })).markdown).toContain('更新后的专题正文。')
})
