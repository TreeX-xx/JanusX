import { afterEach, beforeAll, expect, it } from 'vitest'
import { fork, execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { acquireLock, releaseLock, SUPPORTED_HARNESS_PROFILE } from '@janus-agent/harness-node'
import { NativePluginService } from '../../src/main/plugins/native-service'
import { NativeServiceError, type JsonValue } from '../../packages/plugin-sdk/src'
import { makeNode } from '../../plugins/blueprint/src/main/janus/blueprint-factory'

beforeAll(() => { execFileSync(process.execPath, ['plugins/blueprint/build.mjs'], { windowsHide: true, stdio: 'pipe' }) }, 30_000)
const cleanup: Array<() => Promise<unknown>> = []
afterEach(async () => { for (const clean of cleanup.splice(0).reverse()) await clean() })
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'blueprint-native-'))
  cleanup.push(() => rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  const root = join(directory, 'workspace'), state = join(directory, 'data')
  await mkdir(join(root, '.agents/notes'), { recursive: true })
  await mkdir(state)
  const repoId = randomUUID(), noteId = randomUUID()
  await writeFile(join(root, '.agents/harness.json'), JSON.stringify({ schemaVersion: 1, repoId, name: 'Native fixture', profile: SUPPORTED_HARNESS_PROFILE }))
  const notePath = join(root, '.agents/notes/module.md')
  const body = '---\n' + JSON.stringify({ schema: 'harness-note/2', id: noteId, kind: 'module', lifecycle: 'accepted', created: '2026-10-10', updated: '2026-10-10T00:00:00Z',
    moduleState: 'partial', role: 'project' }, null, 2) + '\n---\n\n# Native fixture\n\n## Responsibility\n\nStore notes.\n\n## Design\n\nA queue is planned.\n'
  await writeFile(notePath, body)
  const project = { id: 'granted-project', root, name: 'Native fixture' }
  const events: Array<{ name: string; value: any }> = [], failures: string[] = []
  let requestCount = 0, slow = false, service: NativePluginService, child: ReturnType<typeof fork>
  let proposedDesign = 'A persistent queue is planned.'
  let agentReply: ((value: any, tool: (name: string, input: JsonValue) => Promise<any>, signal: AbortSignal) => Promise<JsonValue>) | undefined
  const open = async () => {
    service = new NativePluginService({
      spawn(generation) {
        child = fork(resolve('plugins/blueprint/dist/service.cjs'), [`--janusx-native-generation=${generation}`], {
          windowsHide: true, execArgv: [], stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
        })
        child.stderr?.on('data', () => {})
        return { send: packet => { child.send(packet) }, listen: listener => { child.on('message', listener); return () => { child.off('message', listener) } },
          exited: listener => { child.on('exit', listener); return () => { child.off('exit', listener) } }, terminate: () => { child.kill() } }
      }, stopped: code => failures.push(code),
      async host(method, value, signal) {
        if (method === 'models.select') return { providerId: 'fixture', modelId: 'fixture', contextWindow: 262144, maxOutputTokens: 8192 }
        if (method === 'models.generate') return { text: JSON.stringify({ summary: 'Clarify design', operations: [{ operationId: 'clarify', type: 'update-node',
          nodeId: noteId, reason: 'User approved clarification', evidenceRefs: [], dependsOn: [], risk: 'low', after: { sections: { Design: proposedDesign } } }] }) }
        if (method !== 'agent.run') throw new NativeServiceError('UNKNOWN_METHOD')
        requestCount++
        if (slow) await new Promise<void>(resolve => { signal.addEventListener('abort', () => resolve(), { once: true }); if (signal.aborted) resolve() })
        signal.throwIfAborted()
        const request = value as { runId: string }
        if (agentReply) return agentReply(value, (tool, input) => service.call('agent.tool', { runId: request.runId, tool, input }, signal), signal)
        await service.call('agent.tool', { runId: request.runId, tool: 'review.read', input: { path: '.agents/notes/module.md' } }, signal)
        return { text: JSON.stringify({ findings: [], coverage: 'complete', limitations: [] }), cancelled: false, toolTraces: [] }
      },
    })
    await service.start({ apiVersion: 1, pluginId: 'official.blueprint', dataVersion: 1, directory: state, applicationDataDirectory: directory, projects: [project] })
    service.onEvent((name, value) => events.push({ name, value }))
  }
  const stop = async () => {
    const exited = child.exitCode !== null || child.signalCode ? Promise.resolve() : new Promise<void>(resolve => child.once('exit', () => resolve()))
    await service.shutdown(); await exited
  }
  cleanup.push(stop)
  await open()
  const call = (method: string, input: JsonValue = null, scope: typeof project | null = project) => service.call(method, { project: scope, input }).catch(cause => {
    throw new Error(`${method}: ${cause instanceof Error ? cause.message : cause}`)
  }) as Promise<any>
  return { root, state, directory, project, repoId, noteId, notePath, body, events, failures, call, open, stop,
    slow: () => { slow = true }, requests: () => requestCount, raw: () => service,
    propose: (design: string) => { proposedDesign = design },
    agent: (reply: NonNullable<typeof agentReply>) => { agentReply = reply } }
}

it('treats checkouts without Notes as empty discovery, including an unrelated .agents directory', async () => {
  const f = await fixture()
  await rm(join(f.root, '.agents'), { recursive: true })
  expect(await f.call('workspace.status')).toMatchObject({ state: 'not-found', noteCount: 0 })
  await f.call('workspace.activate')
  await f.call('workspace.release')
  await mkdir(join(f.root, '.agents'))
  await writeFile(join(f.root, '.agents/unrelated.json'), '{}')
  expect(await f.call('workspace.status')).toMatchObject({ state: 'foreign', noteCount: 0 })
  await f.call('workspace.activate')
  await f.call('workspace.release')
  expect(f.failures).toEqual([])
})

it('imports legacy data only after project-scoped preview and explicit confirmation', async () => {
  const f = await fixture(), first = randomUUID(), second = randomUUID()
  const node = makeNode({ title: 'Old requirement', type: 'feature', description: 'Keep the original intent.' })
  const raw = JSON.stringify({ schemaVersion: 4, id: 'legacy-board', name: 'Legacy board', source: 'json',
    nodeIds: [node.id], nodes: { [node.id]: node }, rootNodeId: node.id, relations: [], requirementCandidates: [],
    canvasLayout: {}, collapsedNodeIds: null, contentRevision: 1 })
  await mkdir(join(f.state, 'legacy'), { recursive: true })
  const source = join(f.state, 'legacy/legacy-board.json')
  await writeFile(source, raw)
  const call = (owner: string, method: string, input: JsonValue = null) => f.raw().call(method, { project: f.project, input, instanceId: owner }) as Promise<any>
  await expect(f.call('legacy.list', null, null)).rejects.toThrow('PATH_NOT_GRANTED')
  expect(await call(first, 'legacy.list')).toMatchObject([{ id: 'legacy-board', nodes: 1 }])
  const abandoned = await call(first, 'legacy.preview', 'legacy-board')
  expect(await readFile(source, 'utf8')).toBe(raw)
  await expect(call(second, 'legacy.apply', abandoned.token)).rejects.toThrow('NOT_READY')
  await f.raw().call('lifecycle.release', { instanceId: first })
  await expect(call(first, 'legacy.apply', abandoned.token)).rejects.toThrow('NOT_READY')
  const preview = await call(second, 'legacy.preview', 'legacy-board')
  const applied = await call(second, 'legacy.apply', preview.token)
  expect(applied.uris.slice(0, -1)).toEqual(preview.notes.map((note: any) => note.uri))
  expect(await readFile(applied.archivedPath, 'utf8')).toBe(raw)
  expect((await call(second, 'blueprint.graph')).blueprint.nodeIds).toHaveLength(3)
  expect(await call(second, 'legacy.list')).toEqual([])
  expect(f.requests()).toBe(0)
})

it('streams only the active discussion, rejects stale progress and bounds original-file reads', async () => {
  const f = await fixture()
  await writeFile(join(f.root, 'large.txt'), Buffer.alloc(2 * 1024 * 1024 + 1, 'x'))
  let runId = '', finish: () => void = () => {}
  const waiting = new Promise<void>(resolve => { finish = resolve })
  f.agent(async (request, tool, signal) => {
    runId = request.runId
    expect(request.progress).toBe(true)
    await expect(tool('project.read', { path: 'large.txt' })).rejects.toThrow()
    await f.raw().call('agent.progress', { runId, sequence: 2, text: 'Current answer', phase: 'answer' }, signal)
    await f.raw().call('agent.progress', { runId, sequence: 1, text: 'Old answer', phase: 'answer' }, signal)
    await waiting
    return { text: 'Final answer', cancelled: false, toolTraces: [] }
  })
  const history = await f.call('discussion.read')
  const job = await f.call('discussion.run', { providerId: 'fixture', modelId: 'fixture', message: 'Explain the project', expectedRevision: history.revision, noteRefs: [] })
  await expect.poll(async () => (await f.call('jobs.read', job.id)).progress?.text).toBe('Current answer')
  finish()
  await expect.poll(async () => (await f.call('jobs.read', job.id)).status).toBe('completed')
  await expect(f.raw().call('agent.progress', { runId, sequence: 3, text: 'Late answer', phase: 'answer' })).rejects.toThrow('CANCELLED')
  expect((await f.call('discussion.read')).messages.at(-1).content).toBe('Final answer')
})

it('waits for another process index lock during a cold graph read without replaying writes', async () => {
  const f = await fixture()
  const lock = await acquireLock(f.root)
  const graph = f.call('blueprint.graph-open')
  try {
    await new Promise(resolve => setTimeout(resolve, 250))
  } finally { await releaseLock(f.root, lock) }
  const snapshot = await graph
  const part = await f.call('blueprint.graph-part', { id: snapshot.id, index: 0 })
  expect(JSON.parse(part.text).blueprint.nodes[f.noteId].title).toBe('Native fixture')
  await f.call('blueprint.graph-close', snapshot.id)
  expect(await readFile(f.notePath, 'utf8')).toBe(f.body)
  expect(f.requests()).toBe(0)
})

it('runs the real downloaded backend: graph, persisted layout, read acknowledgement and independent review', async () => {
  const f = await fixture()
  const graph = await f.call('blueprint.graph')
  expect(graph.blueprint.nodes[f.noteId].title).toBe('Native fixture')
  const source = await f.call('notes.read', `note://${f.repoId}/${f.noteId}`)
  expect(source.raw).toBe(f.body)
  expect(source.view.headings.map((heading: any) => heading.text)).toEqual(['Native fixture', 'Responsibility', 'Design'])
  expect(source.view.headings.find((heading: any) => heading.text === 'Design').anchor).toBe('design')
  await f.call('blueprint.layout', { canvasLayout: { [f.noteId]: { x: 42, y: 68 } }, collapsedNodeIds: [f.noteId] })
  expect((await f.call('blueprint.graph')).blueprint.canvasLayout[f.noteId]).toEqual({ x: 42, y: 68 })
  const settings = await f.call('settings.snapshot', null, null)
  await f.call('settings.update', { value: { ...settings.value, generation: { providerId: 'test', modelId: 'test' } }, expectedRevision: settings.revision }, null)
  const { id } = await f.call('review.run', f.noteId)
  await expect.poll(async () => (await f.call('jobs.read', id)).status, { timeout: 15_000 }).toBe('completed')
  expect((await f.call('jobs.read', id)).result.report).toMatchObject({ coverage: 'complete', findings: [] })
  expect(f.requests()).toBe(1)
  expect(await readFile(f.notePath, 'utf8')).toBe(f.body)
  const view = await f.call('review.read')
  const marked = await f.call('reading.mark', { context: view.context, versions: [{ noteId: f.noteId, hash: graph.blueprint.nodes[f.noteId].sourceHash, path: '.agents/notes/module.md' }], bulk: true })
  expect(marked.updates.entries.find((item: any) => item.noteId === f.noteId).unread).toBe(false)
  expect(f.events.some(event => event.name === 'job.changed' && event.value.scope.projectId === f.project.id)).toBe(true)
  await f.stop(); await f.open()
  expect((await f.call('review.saved')).items.find((item: any) => item.noteId === f.noteId).report.coverage).toBe('complete')
  expect((await f.call('blueprint.graph')).blueprint.collapsedNodeIds).toContain(f.noteId)
})

it('loads the repository Notes corpus through bounded native graph parts without model calls', async () => {
  const f = await fixture()
  await cp(resolve('.agents/notes'), join(f.root, '.agents/notes'), { recursive: true })
  await cp(resolve('.agents/harness.json'), join(f.root, '.agents/harness.json'))
  const transfer = await f.call('blueprint.graph-open')
  expect(transfer.parts).toBeGreaterThan(1)
  const parts: string[] = []
  for (let index = 0; index < transfer.parts; index++) {
    const part = await f.call('blueprint.graph-part', { id: transfer.id, index })
    expect(Buffer.byteLength(JSON.stringify(part))).toBeLessThan(1024 * 1024)
    parts.push(part.text)
  }
  const text = parts.join(''), graph = JSON.parse(text)
  expect(Buffer.byteLength(text)).toBeGreaterThan(4 * 1024 * 1024)
  expect(graph.blueprint.nodeIds.length).toBeGreaterThan(300)
  expect(graph.blueprint.nodeIds.some((id: string) => graph.blueprint.nodes[id].title === 'JanusX')).toBe(true)
  await f.call('blueprint.graph-close', transfer.id)
  await expect(f.call('blueprint.graph-part', { id: transfer.id, index: 0 })).rejects.toThrow('RESOURCE_CHANGED')
  expect(f.requests()).toBe(0)
})

it('rejects cross-project requests and cancels an in-flight review without terminating another service', async () => {
  const f = await fixture()
  await expect(f.call('notes.snapshot', null, { ...f.project, id: 'ungranted' })).rejects.toThrow('PATH_NOT_GRANTED')
  await expect(f.call('notes.snapshot', null, null)).rejects.toThrow('PATH_NOT_GRANTED')
  const settings = await f.call('settings.snapshot')
  await f.call('settings.update', { value: { ...settings.value, generation: { providerId: 'test', modelId: 'test' } }, expectedRevision: settings.revision })
  f.slow()
  const first = await f.call('review.run', f.noteId)
  await expect.poll(f.requests).toBe(1)
  await f.call('jobs.cancel', first.id)
  await expect.poll(async () => (await f.call('jobs.read', first.id)).status).toBe('cancelled')
  expect((await f.call('blueprint.graph')).blueprint.nodes[f.noteId].title).toBe('Native fixture')
  expect(f.failures).toEqual([])
  const next = await f.call('review.run', f.noteId)
  expect(next.id).not.toBe(first.id)
  await expect.poll(f.requests).toBe(2)
  await f.stop()
  expect(f.failures).toEqual(['SERVICE_STOPPED'])
  await f.open()
  expect((await f.call('review.saved')).items.find((item: any) => item.noteId === f.noteId)?.pending).toBeNull()
})

it('applies the confirmed preview directly without audit files or audit/undo methods', async () => {
  const f = await fixture(), conversationId = randomUUID()
  // An unusable audit path must never block a confirmed Note transaction.
  const auditPath = join(f.state, 'maintenance-audit')
  await writeFile(auditPath, 'existing user data: preserve exactly')
  const task = await f.call('maintenance.start', { conversationId, goal: 'Clarify the planned queue', nodeScope: { type: 'blueprint' } })
  const job = await f.call('maintenance.propose', { taskId: task.id, conversationId, providerId: 'fixture', modelId: 'fixture',
    messages: [{ role: 'user', content: 'Clarify the design to say a persistent queue is planned.' }] })
  await expect.poll(async () => (await f.call('jobs.read', job.id)).status, { timeout: 15_000 }).not.toBe('running')
  expect((await f.call('maintenance.list'))[0].error).toBeUndefined()
  expect((await f.call('jobs.read', job.id)).status).toBe('completed')
  expect(await readFile(f.notePath, 'utf8')).toBe(f.body)
  const proposal = (await f.call('jobs.read', job.id)).result
  expect(proposal.status).toBe('proposal-ready')
  const selected = { taskId: task.id, changeSetId: proposal.changeSet.id, operationIds: ['clarify'] }
  const preview = await f.call('maintenance.preview', { ...selected, conversationId })
  expect(preview.files[0].after).toContain('A persistent queue is planned.')
  expect(await readFile(f.notePath, 'utf8')).toBe(f.body)
  const applied = await f.call('maintenance.apply', { ...selected, previewId: preview.id })
  expect(applied.task).toMatchObject({ status: 'active', changeSet: null })
  expect(applied.appliedOperationIds).toEqual(['clarify'])
  const withoutUpdate = (source: string) => source.replace(/"updated": "[^"]+"/, '"updated": "transaction-time"')
  expect(withoutUpdate(await readFile(f.notePath, 'utf8'))).toBe(withoutUpdate(preview.files[0].after))
  expect(await readFile(auditPath, 'utf8')).toBe('existing user data: preserve exactly')
  for (const method of ['maintenance.audits', 'maintenance.undo-prepare', 'maintenance.undo-apply']) {
    await expect(f.call(method)).rejects.toThrow('UNKNOWN_METHOD')
  }
  const transactions = await readdir(join(f.root, '.agents/.local/transactions'))
  await expect(f.call('maintenance.apply', { ...selected, previewId: preview.id })).rejects.toThrow()
  expect(await readdir(join(f.root, '.agents/.local/transactions'))).toEqual(transactions)
  // A follow-up proposal reads the committed revision without an audit snapshot.
  f.propose('A persistent queue with retries is planned.')
  const next = await f.call('maintenance.propose', { taskId: task.id, conversationId, providerId: 'fixture', modelId: 'fixture',
    messages: [{ role: 'user', content: 'Clarify the queue again.' }] })
  await expect.poll(async () => (await f.call('jobs.read', next.id)).status, { timeout: 15_000 }).not.toBe('running')
  expect((await f.call('jobs.read', next.id)).status).toBe('completed')
  await f.call('maintenance.complete', task.id)
  await f.stop(); await f.open()
  expect(withoutUpdate(await readFile(f.notePath, 'utf8'))).toBe(withoutUpdate(preview.files[0].after))
  expect(await readFile(auditPath, 'utf8')).toBe('existing user data: preserve exactly')
})

it('keeps maintenance, suggestions and layouts independent in two worktrees of the same project', async () => {
  const f = await fixture()
  const git = (...args: string[]) => execFileSync('git', args, { cwd: f.root, windowsHide: true, stdio: 'pipe' })
  git('init', '--initial-branch=main')
  git('add', '.agents')
  git('-c', 'user.name=Blueprint fixture', '-c', 'user.email=blueprint@fixture.invalid', 'commit', '-m', 'Notes')
  const feature = join(f.directory, 'feature')
  git('worktree', 'add', '-b', 'feature', feature)
  const featureProject = { ...f.project, root: feature }, featureNote = join(feature, '.agents/notes/module.md')
  const mainOwner = randomUUID(), featureOwner = randomUUID()
  const call = (project: typeof f.project, owner: string, method: string, input: JsonValue = null) =>
    f.raw().call(method, { project, instanceId: owner, input }) as Promise<any>
  const main = (method: string, input: JsonValue = null) => call(f.project, mainOwner, method, input)
  const other = (method: string, input: JsonValue = null) => call(featureProject, featureOwner, method, input)
  const prepare = async (run: typeof main, design: string, task: any, conversationId: string) => {
    f.propose(design)
    const job = await run('maintenance.propose', { taskId: task.id, conversationId, providerId: 'fixture', modelId: 'fixture',
      messages: [{ role: 'user', content: design }] })
    await expect.poll(async () => (await run('jobs.read', job.id)).status, { timeout: 15_000 }).not.toBe('running')
    const result = await run('jobs.read', job.id)
    expect(result.status).toBe('completed')
    const selection = { taskId: task.id, changeSetId: result.result.changeSet.id, operationIds: ['clarify'] }
    const preview = await run('maintenance.preview', { ...selection, conversationId })
    return { task, selection, preview }
  }
  const mainGraph = await main('blueprint.graph'), featureGraph = await other('blueprint.graph')
  expect(mainGraph.repoId).toBe(featureGraph.repoId)
  expect(mainGraph.blueprint.id).not.toBe(featureGraph.blueprint.id)
  expect(mainGraph.blueprint.nodeIds).toEqual(featureGraph.blueprint.nodeIds)
  await main('blueprint.layout', { canvasLayout: { [f.noteId]: { x: 42, y: 68 } } })
  expect((await other('blueprint.graph')).blueprint.canvasLayout[f.noteId]).toBeUndefined()
  const mainConversation = randomUUID(), featureConversation = randomUUID()
  const [mainTask, featureTask] = await Promise.all([
    main('maintenance.start', { conversationId: mainConversation, goal: 'Clarify main only', nodeScope: { type: 'blueprint' } }),
    other('maintenance.start', { conversationId: featureConversation, goal: 'Clarify feature only', nodeScope: { type: 'blueprint' } }),
  ])
  const first = await prepare(main, 'Main worktree design.', mainTask, mainConversation)
  const second = await prepare(other, 'Feature worktree design.', featureTask, featureConversation)
  expect((await main('maintenance.list')).map((task: any) => task.id)).toEqual([first.task.id])
  expect((await other('maintenance.list')).map((task: any) => task.id)).toEqual([second.task.id])
  await expect(other('maintenance.apply', { ...first.selection, previewId: first.preview.id })).rejects.toThrow('PATH_NOT_GRANTED')
  await expect(main('maintenance.apply', { ...second.selection, previewId: second.preview.id })).rejects.toThrow('PATH_NOT_GRANTED')
  await other('maintenance.apply', { ...second.selection, previewId: second.preview.id })
  expect(await readFile(f.notePath, 'utf8')).toBe(f.body)
  // The other worktree's committed edit must not invalidate this preview or its evidence.
  await main('maintenance.apply', { ...first.selection, previewId: first.preview.id })
  const mainBytes = await readFile(f.notePath, 'utf8'), featureBytes = await readFile(featureNote, 'utf8')
  expect(mainBytes).toContain('Main worktree design.')
  expect(mainBytes).not.toContain('Feature worktree design.')
  expect(featureBytes).toContain('Feature worktree design.')
  expect(featureBytes).not.toContain('Main worktree design.')
  await expect(main('maintenance.apply', { ...first.selection, previewId: first.preview.id })).rejects.toThrow()
  expect(await readFile(featureNote, 'utf8')).toBe(featureBytes)

  const settings = await f.call('settings.snapshot')
  await f.call('settings.update', { value: { ...settings.value, generation: { providerId: 'fixture', modelId: 'fixture' } }, expectedRevision: settings.revision })
  const findingId = randomUUID()
  f.agent(async (_request, tool) => {
    const source = await tool('review.read', { path: '.agents/notes/module.md' })
    const quote = JSON.stringify(source).includes('Feature worktree design.') ? 'Feature worktree design.' : 'Main worktree design.'
    return { text: JSON.stringify({ findings: [{ id: findingId, category: 'omission', summary: 'Clarify this design', explanation: 'Explain persistence.',
      suggestion: 'State its persistence boundary.', citations: [{ path: '.agents/notes/module.md', quote }], verification: 'not-configured' }], coverage: 'complete', limitations: [] }),
      cancelled: false, toolTraces: [] }
  })
  for (const run of [main, other]) {
    const job = await run('review.run', f.noteId)
    await expect.poll(async () => (await run('jobs.read', job.id)).status, { timeout: 15_000 }).not.toBe('running')
    expect((await run('jobs.read', job.id)).status).toBe('completed')
  }
  const mainReview = await main('review.read'), featureReview = await other('review.read')
  const mainItem = mainReview.items.find((item: any) => item.noteId === f.noteId)
  const featureItem = featureReview.items.find((item: any) => item.noteId === f.noteId)
  expect(mainItem.report.findings).toHaveLength(1)
  expect(featureItem.report.findings).toHaveLength(1)
  await expect(other('review.close', { context: mainReview.context, noteId: f.noteId, revision: mainItem.reportRevision, findingIds: [findingId] })).rejects.toThrow('PATH_NOT_GRANTED')
  await main('review.close', { context: mainReview.context, noteId: f.noteId, revision: mainItem.reportRevision, findingIds: [findingId] })
  expect((await other('review.read')).items.find((item: any) => item.noteId === f.noteId).report.findings).toHaveLength(1)
  const conflicting = await prepare(main, 'A later main design.', mainTask, mainConversation)
  const externallyEdited = mainBytes + '\nExternal edit in main only.\n'
  await writeFile(f.notePath, externallyEdited)
  await expect(main('maintenance.apply', { ...conflicting.selection, previewId: conflicting.preview.id })).rejects.toThrow()
  expect(await readFile(f.notePath, 'utf8')).toBe(externallyEdited)
  expect(await readFile(featureNote, 'utf8')).toBe(featureBytes)
  await f.stop(); await f.open()
  expect((await main('blueprint.graph')).blueprint.canvasLayout[f.noteId]).toEqual({ x: 42, y: 68 })
  expect((await other('blueprint.graph')).blueprint.canvasLayout[f.noteId]).toBeUndefined()
  expect(await readFile(f.notePath, 'utf8')).toBe(externallyEdited)
  expect(await readFile(featureNote, 'utf8')).toBe(featureBytes)
})

it('invalidates a page confirmation waiting on the old worktree before any Note transaction starts', async () => {
  const f = await fixture(), owner = randomUUID(), conversationId = randomUUID()
  const call = (method: string, input: JsonValue = null) => f.raw().call(method, { project: f.project, instanceId: owner, input }) as Promise<any>
  const task = await call('maintenance.start', { conversationId, goal: 'Clarify design', nodeScope: { type: 'blueprint' } })
  const job = await call('maintenance.propose', { taskId: task.id, conversationId, providerId: 'fixture', modelId: 'fixture',
    messages: [{ role: 'user', content: 'Clarify the design.' }] })
  await expect.poll(async () => (await call('jobs.read', job.id)).status, { timeout: 15_000 }).not.toBe('running')
  const proposal = (await call('jobs.read', job.id)).result
  const selected = { taskId: task.id, changeSetId: proposal.changeSet.id, operationIds: ['clarify'] }
  const preview = await call('maintenance.preview', { ...selected, conversationId })
  // Invalidate the proof cache without changing approved Note bytes. Index
  // probes compare hashes, so touching mtime cannot force a locked read.
  await mkdir(join(f.root, '.agents/evidence'), { recursive: true })
  await writeFile(join(f.root, '.agents/evidence/cache-stamp'), 'force proof refresh')
  const lock = await acquireLock(f.root)
  const applying = call('maintenance.apply', { ...selected, previewId: preview.id }).then(
    value => ({ value, error: undefined }), error => ({ value: undefined, error }))
  try {
    await expect.poll(() => f.events.some(event => event.name === 'maintenance.changed' && event.value.data.task.status === 'applying')).toBe(true)
    await f.raw().call('lifecycle.release', { instanceId: owner })
    await expect.poll(async () => (await f.call('maintenance.list'))[0].status).toBe('cancelled')
  } finally { await releaseLock(f.root, lock) }
  expect((await applying).error).toBeDefined()
  // Wait for the blocked read to drain; its late continuation must still refuse the commit.
  await f.call('blueprint.graph')
  await expect(f.call('maintenance.apply', { ...selected, previewId: preview.id })).rejects.toThrow()
  expect(await readFile(f.notePath, 'utf8')).toBe(f.body)
  expect(await readdir(join(f.root, '.agents/.local/transactions')).catch(() => [])).toEqual([])
  const next = await f.call('maintenance.start', { conversationId: randomUUID(), goal: 'New page', nodeScope: { type: 'blueprint' } })
  expect(next.id).not.toBe(task.id)
})

it.each(['repair', 'discuss', 'drift'] as const)('runs a scoped native Note %s with source validation and no Agent write tool', async mode => {
  const f = await fixture()
  const malformed = f.body.replace(/  "updated": "[^"]+",\n/, '')
  await writeFile(f.notePath, malformed)
  const view = await f.call('review.read')
  expect(view.structure.issues.length).toBeGreaterThan(0)
  const { createHash } = await import('node:crypto')
  const plan = await f.call('repair.prepare', { context: view.context, intent: mode === 'discuss' ? 'discuss' : 'repair', kind: 'structure',
    path: '.agents/notes/module.md', hash: createHash('sha256').update(malformed).digest('hex') })
  f.agent(async (request, tool) => {
    expect(request.tools.every((item: any) => item.actionRisk === 'read')).toBe(true)
    const read = await tool('note.repair_read', {})
    expect(read.markdown).toBe(malformed)
    if (mode === 'drift') await writeFile(f.notePath, malformed + '\nExternal edit.\n')
    return { text: JSON.stringify({ message: 'The required update timestamp is missing.', edit: mode === 'discuss' ? null : {
      markdown: f.body, expectedHash: read.expectedHash, reason: 'Restore required metadata without changing identity or content.',
    } }), cancelled: false, toolTraces: [] }
  })
  const job = await f.call('repair.run', { id: plan.id, conversationId: randomUUID(), providerId: 'fixture', modelId: 'fixture',
    messages: [{ role: 'user', content: mode === 'discuss' ? 'Explain this issue.' : 'Fix the selected structural issue.' }] })
  await expect.poll(async () => (await f.call('jobs.read', job.id)).status, { timeout: 15_000 }).toBe('completed')
  const result = (await f.call('jobs.read', job.id)).result
  expect(result.update.phase).toBe(mode === 'repair' ? 'resolved' : mode === 'discuss' ? 'discussed' : 'failed')
  if (mode === 'repair') {
    expect((await f.call('review.read')).structure.issues).toEqual([])
    expect((await f.call('repair.diff', plan.id)).before).toBe(malformed)
    expect(await readFile(f.notePath, 'utf8')).toContain('A queue is planned.')
  } else expect(await readFile(f.notePath, 'utf8')).toBe(malformed + (mode === 'drift' ? '\nExternal edit.\n' : ''))
})

it('releases closed page jobs while retaining another page watching the same checkout', async () => {
  const f = await fixture(), first = randomUUID(), second = randomUUID()
  const call = (owner: string, method: string, input: JsonValue = null) => f.raw().call(method, { project: f.project, input, instanceId: owner }) as Promise<any>
  await call(first, 'workspace.activate'); await call(second, 'workspace.activate')
  const settings = await f.call('settings.snapshot')
  await f.call('settings.update', { value: { ...settings.value, generation: { providerId: 'fixture', modelId: 'fixture' } }, expectedRevision: settings.revision })
  f.slow()
  const job = await call(first, 'review.run', f.noteId)
  await expect.poll(f.requests).toBe(1)
  await f.raw().call('lifecycle.release', { instanceId: first })
  await expect.poll(async () => (await call(second, 'jobs.read', job.id)).status).toBe('cancelled')
  const count = f.events.filter(event => event.name === 'notes.changed').length
  await writeFile(f.notePath, f.body.replace('A queue is planned.', 'A queue is planned with recovery.'))
  await expect.poll(() => f.events.filter(event => event.name === 'notes.changed').length, { timeout: 10_000 }).toBeGreaterThan(count)
  expect((await call(second, 'blueprint.graph')).blueprint.nodes[f.noteId].title).toBe('Native fixture')
  await f.raw().call('lifecycle.release', { instanceId: second })
})

it('previews initialization without writes and binds confirmation and undo to the requesting page', async () => {
  const f = await fixture(), first = randomUUID(), second = randomUUID()
  await rm(join(f.root, '.agents'), { recursive: true, force: true })
  const call = (owner: string, method: string, input: JsonValue = null) => f.raw().call(method, { project: f.project, input, instanceId: owner }) as Promise<any>
  expect((await call(first, 'workspace.status')).state).toBe('not-found')
  const preview = await call(first, 'workspace.init-preview', 'Initialized project')
  expect(preview.files.some((file: any) => file.path === '.agents/harness.json')).toBe(true)
  await expect(readFile(join(f.root, '.agents/harness.json'))).rejects.toMatchObject({ code: 'ENOENT' })
  await expect(call(second, 'workspace.init-apply', { id: preview.id, confirmForeign: false })).rejects.toThrow()
  await call(first, 'workspace.init-apply', { id: preview.id, confirmForeign: false })
  expect((await call(first, 'workspace.status')).state).toBe('ok')
  await call(first, 'workspace.init-undo', preview.id)
  expect((await call(first, 'workspace.status')).state).toBe('not-found')
})

it('persists read-only discussion, rejects stale revisions and validates selected Note versions', async () => {
  const f = await fixture()
  const initial = await f.call('discussion.read'), graph = await f.call('blueprint.graph')
  f.agent(async (request, tool) => {
    expect(request.tools.every((item: any) => item.actionRisk === 'read')).toBe(true)
    const list = await tool('note.list', {})
    expect(list.entries[0].uri).toBe(`note://${f.repoId}/${f.noteId}`)
    expect((await tool('project.read', { path: '.agents/notes/module.md' })).text).toContain('A queue is planned.')
    await expect(tool('project.read', { path: '.env' })).rejects.toThrow()
    await expect(tool('project.read', { path: '../private.txt' })).rejects.toThrow()
    await expect(tool('project.write', { path: '.agents/notes/module.md', text: 'lost' })).rejects.toThrow()
    return { text: 'The queue is planned; no file was changed.', cancelled: false, toolTraces: [] }
  })
  const input = { providerId: 'fixture', modelId: 'fixture', message: 'Discuss the planned queue.', expectedRevision: initial.revision,
    noteRefs: [{ uri: `note://${f.repoId}/${f.noteId}`, expectedHash: graph.blueprint.nodes[f.noteId].sourceHash }] }
  const run = async (input: JsonValue) => {
    const { id } = await f.call('discussion.run', input)
    await expect.poll(async () => (await f.call('jobs.read', id)).status, { timeout: 15_000 }).not.toBe('running')
    return f.call('jobs.read', id)
  }
  const completed = await run(input)
  expect(completed.status).toBe('completed')
  expect(completed.result.messages.map((item: any) => item.role)).toEqual(['user', 'assistant'])
  expect((await run(input)).error).toBe('RESOURCE_CHANGED')
  await expect(f.call('discussion.clear', 0)).rejects.toThrow('RESOURCE_CHANGED')
  expect(await readFile(f.notePath, 'utf8')).toBe(f.body)
  await f.stop(); await f.open()
  expect(await f.call('discussion.read')).toEqual(completed.result)
  await writeFile(f.notePath, f.body + '\nSource drift.\n')
  expect((await run({ ...input, expectedRevision: completed.result.revision })).error).toBe('RESOURCE_CHANGED')
  const cleared = await f.call('discussion.clear', completed.result.revision)
  expect(cleared.messages).toEqual([])
  expect(cleared.id).not.toBe(completed.result.id)
})

it('cancels discussion without publishing an answer or leaving the workspace locked', async () => {
  const f = await fixture(), initial = await f.call('discussion.read')
  f.slow()
  const input = { providerId: 'fixture', modelId: 'fixture', message: 'Discuss without editing.', expectedRevision: initial.revision, noteRefs: [] }
  const { id } = await f.call('discussion.run', input)
  await expect.poll(f.requests).toBe(1)
  await expect(f.call('discussion.clear', initial.revision)).rejects.toThrow('RATE_LIMITED')
  await f.call('jobs.cancel', id)
  await expect.poll(async () => (await f.call('jobs.read', id)).status).toBe('cancelled')
  expect((await f.call('discussion.read')).messages).toEqual([])
  expect((await f.call('discussion.clear', initial.revision)).revision).toBe(1)
  expect(await readFile(f.notePath, 'utf8')).toBe(f.body)
})

it('rejects conflicting settings writes and preserves the accepted configuration across restart', async () => {
  const f = await fixture(), first = await f.call('settings.snapshot', null, null)
  const value = { ...first.value, automatic: { enabled: false, commits: 9 } }
  const writes = await Promise.allSettled([
    f.call('settings.update', { value, expectedRevision: first.revision }, null),
    f.call('settings.update', { value: { ...first.value, automatic: { enabled: false, commits: 11 } }, expectedRevision: first.revision }, null),
  ])
  expect(writes.map(result => result.status)).toEqual(['fulfilled', 'rejected'])
  expect((writes[1] as PromiseRejectedResult).reason.message).toContain('RESOURCE_CHANGED')
  const current = await f.call('settings.snapshot', null, null)
  expect(current.revision).not.toBe(first.revision)
  expect(current.value).toEqual(value)
  await f.stop(); await f.open()
  expect(await f.call('settings.snapshot', null, null)).toEqual(current)
})
