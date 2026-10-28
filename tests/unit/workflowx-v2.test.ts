import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { parseNote, validateNote } from '@janus-agent/harness-core'
import { SUPPORTED_HARNESS_PROFILE, NoteChatEditor } from '@janus-agent/harness-node'
import type { ChatTurnPorts } from '@janus-agent/janus-agent'
import { BlueprintNoteService as HarnessNoteService } from '../../plugins/blueprint/src/main/notes/service'
import { attachNoteChatTools } from '../../src/main/harness/note-chat'
import { projectArchitecture } from '../../plugins/blueprint/src/ui/graph/architecture-view'
import { moduleTrail, projectModuleBrowse } from '../../plugins/blueprint/src/ui/graph/module-browsing'
import { noteDirectory, noteWikiView } from '../../src/shared/note-wiki'
import { noteAuthoringContext } from '../../plugins/blueprint/src/main/notes/note-authoring'
import { buildArtifactBundle } from '../../src/main/roundtable/artifact-bundle'
import { createAgentRuntime, registerWorkspaceTools } from '@janus-agent/agent-core'
import { registerCommandTools } from '../../src/main/agent/runtime/tools/command-tools'

const repo = '11111111-1111-4111-8111-111111111111'
const id = (n: number) => `${String(n).padStart(8, '0')}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`
const uri = (n: number) => `note://${repo}/${id(n)}`
const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'janus-v2-')); roots.push(root)
  await mkdir(join(root, '.agents/notes/child'), { recursive: true })
  await mkdir(join(root, '.agents/notes/child/parser'), { recursive: true })
  await writeFile(join(root, '.agents/harness.json'), JSON.stringify({ schemaVersion: 1, repoId: repo, name: 'V2', profile: SUPPORTED_HARNESS_PROFILE }))
  for (const [n, file, extra] of [
    [1, 'module.md', { kind: 'module', role: 'project', moduleState: 'partial' }],
    [2, 'child/module.md', { kind: 'module', parent: uri(1), moduleState: 'planned' }],
    [3, 'detail.md', { kind: 'note', module: uri(1) }],
    [4, 'child/detail.md', { kind: 'note', module: uri(2), parent: uri(3) }],
    [5, 'child/idea.md', { kind: 'idea', module: uri(2) }],
    [6, 'child/parser/module.md', { kind: 'module', parent: uri(2), moduleState: 'partial' }],
    [7, 'child/parser/deep.md', { kind: 'note', module: uri(6) }],
  ] as const) {
    await writeFile(join(root, '.agents/notes', file), `---\n${JSON.stringify({ schema: 'harness-note/2', id: id(n), lifecycle: 'accepted', created: '2026-10-07', updated: '2026-10-08T00:00:00Z', ...extra })}\n---\n# Subject ${n}\n\n## Intent\n\nMaintained source ${n}.\n`)
  }
  return { root, service: new HarnessNoteService() }
}

it('browses immediate module ownership without changing the source, and shares wiki ancestry', async () => {
  const { root, service } = await fixture()
  const source = (await service.projectView(root)).blueprint, before = structuredClone(source)
  const projection = projectArchitecture(source)
  expect(projection.graph.nodeIds).toEqual(expect.arrayContaining([id(1), id(2)]))
  expect(projection.graph.nodeIds).toHaveLength(3)
  expect(source.nodes[id(2)].status).toBe('planning')
  expect(source.nodes[id(3)].updatedAt).toBe('2026-10-08T00:00:00Z')
  const home = projectModuleBrowse(source, projection, null)
  const rootPage = projectModuleBrowse(source, projection, id(1))
  expect(home).toEqual(rootPage)
  expect(home.scopeId).toBe(id(1))
  expect(home.homeModuleId).toBe(id(1))
  expect(home.groups.map(group => group.nodeIds)).toEqual([[id(3)]])
  expect(rootPage.graph.nodeIds).toEqual([id(1), id(2), id(3)])
  const expanded = projectModuleBrowse(source, projection, id(2))
  expect(expanded.graph.nodeIds).toEqual([id(2), id(6), id(4), id(5)])
  expect(expanded.graph.rootNodeId).toBe(id(2))
  expect(expanded.graph.nodes[id(2)].parentId).toBeNull()
  expect(expanded.graph.nodes[id(2)].children).toEqual([id(6), id(4), id(5)])
  for (const child of expanded.graph.nodes[id(2)].children) {
    expect(expanded.graph.nodes[child].parentId).toBe(id(2))
    expect(expanded.graph.canvasLayout[child].y).toBeGreaterThan(expanded.graph.canvasLayout[id(2)].y + 110)
  }
  expect(expanded.groups.map(g => [g.moduleId, g.kind, g.nodeIds])).toEqual([[id(2), 'note', [id(4)]], [id(2), 'idea', [id(5)]]])
  expect(projectModuleBrowse(source, projection, id(6)).graph.nodeIds).toEqual([id(6), id(7)])
  expect(moduleTrail(projection, id(6))).toEqual([id(1), id(2), id(6)])
  for (const group of expanded.groups) for (const child of group.nodeIds) {
    const point = expanded.graph.canvasLayout[child]
    expect(point.x).toBeGreaterThan(group.x); expect(point.x + 240).toBeLessThan(group.x + group.width)
    expect(point.y).toBeGreaterThan(group.y); expect(point.y + 110).toBeLessThan(group.y + group.height)
  }
  expect(source).toEqual(before)
  const snapshot = await service.readSnapshot(root)
  expect(noteWikiView(snapshot, uri(4)).ancestors).toEqual([uri(2), uri(1)])
  expect(noteDirectory(snapshot).find(r => r.entry.uri === uri(4))?.depth).toBe(2)
})

it('keeps an aggregate home for multiple roots and resolves a stale scope to the current home', async () => {
  const { root, service } = await fixture()
  const source = (await service.projectView(root)).blueprint
  const singleRoot = projectArchitecture(source)
  expect(projectModuleBrowse(source, singleRoot, id(999))).toEqual(projectModuleBrowse(source, singleRoot, null))
  source.nodes[id(2)].note!.parent = null
  delete source.nodes[id(2)].note!.metadata!.parent
  source.nodes[id(2)].note!.relations = source.nodes[id(2)].note!.relations.filter(relation => relation.type !== 'parent')
  source.relations = source.relations.filter(relation => relation.sourceNodeId !== id(2) || relation.type !== 'parent')
  const multipleRoots = projectArchitecture(source)
  const home = projectModuleBrowse(source, multipleRoots, null)
  expect(home.homeModuleId).toBeNull()
  expect(home.scopeId).toBeNull()
  expect([...home.graph.nodeIds].sort()).toEqual([id(1), id(2), id(6)])
  expect(home.groups).toEqual([])
  expect(projectModuleBrowse(source, multipleRoots, id(1)).graph.nodeIds).toEqual([id(1), id(3)])
  expect(projectModuleBrowse(source, multipleRoots, id(999))).toEqual(home)
})

it('retains unassigned and retired documents, while cross-module references do not change ownership', async () => {
  const { root, service } = await fixture()
  const source = (await service.projectView(root)).blueprint
  source.nodes[id(3)].note!.module = uri(999)
  source.nodes[id(3)].note!.metadata!.module = uri(999)
  source.nodes[id(6)].note!.moduleState = 'retired'
  source.nodes[id(2)].note!.relations.push({ type: 'related-to', target: uri(3) })
  const projection = projectArchitecture(source)
  const browse = projectModuleBrowse(source, projection, id(2))
  expect(browse.unassigned).toEqual(expect.arrayContaining([id(3), id(6), id(7)]))
  expect(browse.graph.nodeIds).not.toContain(id(3))
  expect(browse.graph.nodeIds).not.toContain(id(6))
  for (const id of source.nodeIds) { source.nodes[id].kind = 'note'; source.nodes[id].note!.kind = 'note' }
  expect(projectModuleBrowse(source, projectArchitecture(source), null).graph).toBe(source)
})

it('keeps every document in the maintained JanusX corpus reachable through its owner or the unassigned list', async () => {
  const service = new HarnessNoteService(), root = process.cwd()
  // This checks corpus ownership, not the foreground cold-read deadline.
  // Prepare the full real index explicitly before projecting the browse view.
  await service.rescan(root)
  const source = (await service.projectView(root)).blueprint
  const before = JSON.stringify(source), projection = projectArchitecture(source)
  const overview = projectModuleBrowse(source, projection, null)
  const accessible = new Set([...projection.graph.nodeIds, ...overview.unassigned])
  expect(projection.graph.nodeIds.length).toBeGreaterThan(0)
  for (const id of projection.graph.nodeIds) {
    const page = projectModuleBrowse(source, projection, id)
    for (const child of page.graph.nodeIds) {
      accessible.add(child)
      if (child !== id) expect(page.owners[child]).toBe(id)
    }
    expect(moduleTrail(projection, id).at(-1)).toBe(id)
  }
  expect([...accessible].sort()).toEqual([...source.nodeIds].sort())
  expect(JSON.stringify(source)).toBe(before)
})

it('routes Chat v2 filters and writes through shared tools and refreshes the same wiki/blueprint source', async () => {
  const { root, service } = await fixture()
  const signal = new AbortController().signal
  const ports = { sessions: { getSession: () => ({ workspaceId: 'ws', workspaceRoot: root, status: 'running' }) }, tools: { registry: { list: () => [] }, executeFunctionCall: async () => ({ status: 'completed', output: 'shared-engineering-result' }) } } as unknown as ChatTurnPorts
  attachNoteChatTools(ports, { conversationId: 'v2', userText: 'Update the Note', signal, resources: [{ agentSessionId: 'session', workspaceId: 'ws', workspacePath: root }], onChange: () => {} })
  const call = (toolName: string, input: object) => ports.tools.executeFunctionCall({ sessionId: 'session', call: { toolName, input } } as never, 'test')
  const listed = await call('note.list', { kind: 'module', moduleState: 'planned' })
  expect(listed.output).toMatchObject({ notes: [{ uri: uri(2), moduleState: 'planned' }] })
  expect((await call('note.list', { kind: 'note', module: uri(2) })).output).toMatchObject({ notes: [{ uri: uri(4) }] })
  const read = await call('note.read', { uri: uri(4) })
  const changed = await call('note.write', { reason: 'Maintain description', operations: [{ type: 'update', uri: uri(4), expectedHash: (read.output as { expectedHash: string }).expectedHash, title: 'Updated detail' }] })
  expect(changed.status).toBe('completed')
  expect((await service.projectView(root)).blueprint.nodes[id(4)].title).toBe('Updated detail')
  expect((await new NoteChatEditor(service).read(root, uri(4))).markdown).toContain('Updated detail')
  for (const name of ['workspace.read', 'workspace.edit', 'command.run']) expect((await call(name, {})).status).toBe('completed')
  expect((await service.readSnapshot(root)).entries.some(e => e.doc?.kind === 'task')).toBe(false)
})

it('prepares module-owned roundtable documents using the v2 writer', async () => {
  const { root, service } = await fixture(), authoring = await noteAuthoringContext(service, root, uri(4))
  expect(authoring).toMatchObject({ module: uri(2), directory: 'child' })
  const result = buildArtifactBundle({ repoId: repo, sessionId: 'meeting', roundNumber: 1, authoring, items: [{ fact: { id: 'fact', kind: 'decision', status: 'confirmed', title: 'Recorded choice', content: 'Use the shared source.' } as never }] })
  expect(result.diagnostics).toEqual([])
  const op = result.bundle.changeSet.operations[0]
  expect(op.relativePath).toBe('child/recorded-choice.md')
  expect(validateNote(parseNote(op.afterMarkdown!))).toEqual([])
  const unchanged = buildArtifactBundle({ repoId: repo, sessionId: 'meeting', roundNumber: 2, authoring, items: [{
    fact: { id: 'same-fact', kind: 'decision', status: 'confirmed', title: 'Recorded choice', content: 'Use the shared source.' } as never,
    update: { uri: op.uri, expectedHash: 'a'.repeat(64), baseMarkdown: op.afterMarkdown!, section: 'Problem', text: 'Use the shared source.' },
  }] })
  expect(unchanged.diagnostics).toEqual([])
  expect(unchanged.bundle.changeSet.operations[0].afterMarkdown).toBe(op.afterMarkdown)
  await service.applyBundleChangeSet(root, result.bundle.changeSet, 'Record choice')
  expect(await readFile(join(root, '.agents/notes/child/recorded-choice.md'), 'utf8')).toContain('harness-note/2')
})

it('executes shared workspace read/edit and a real script through the Chat host without creating a Task', async () => {
  const { root, service } = await fixture()
  await writeFile(join(root, 'probe.txt'), 'before')
  const runtime = createAgentRuntime({ resolveWorkspaceRoot: async () => root })
  registerWorkspaceTools(runtime.registry); registerCommandTools(runtime.registry)
  const session = await runtime.createSession({ workspaceId: 'ws', workspaceRoot: root, approvalMode: 'auto-run' }, 'chat')
  const ports = { sessions: { getSession: () => ({ workspaceId: 'ws', workspaceRoot: root, status: 'running' }) }, tools: { registry: runtime.registry, executeFunctionCall: runtime.executeFunctionCall.bind(runtime) } } as unknown as ChatTurnPorts
  attachNoteChatTools(ports, { conversationId: 'chat', userText: 'Implement the change', signal: new AbortController().signal, resources: [{ agentSessionId: session.id, workspaceId: 'ws', workspacePath: root }], onChange: () => {} })
  const call = (toolName: string, input: object) => ports.tools.executeFunctionCall({ sessionId: session.id, call: { toolName, input: { workspaceId: 'ws', ...input } } } as never, 'chat')
  try {
    const read = await call('workspace.read', { path: 'probe.txt' })
    expect(read.status).toBe('completed')
    expect((await call('workspace.edit', { path: 'probe.txt', expectedHash: (read.output as { sha256: string }).sha256, replacements: [{ oldText: 'before', newText: 'after' }] })).status).toBe('completed')
    const command = await call('command.run', { program: basename(process.execPath), args: ['-e', 'const f=require("fs");process.stdout.write(f.readFileSync("probe.txt","utf8"))'], timeoutMs: 10000 })
    expect(command.output).toMatchObject({ ok: true, exitCode: 0, stdout: 'after' })
    expect(await readFile(join(root, 'probe.txt'), 'utf8')).toBe('after')
    expect((await service.readSnapshot(root)).entries.some(entry => entry.doc?.kind === 'task')).toBe(false)
  } finally { await runtime.cancelSession(session.id) }
})
