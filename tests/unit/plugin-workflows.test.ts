import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { WorkspaceAgentRuntime } from '@janus-agent/agent-core'
import { parsePluginManifest, PLUGIN_CAPABILITIES, PluginError, type PluginManifest } from '../../packages/plugin-sdk/src'
import { PluginService } from '../../src/main/plugins/service'
import type { PluginNetworkTransport } from '../../src/main/plugins/network'
import type { PluginModelBackend } from '../../src/main/plugins/models'
import { registerPluginTools } from '../../src/main/agent/runtime/tools/plugin-tools'

const cleanup: Array<() => unknown> = []
afterEach(async () => { vi.restoreAllMocks(); for (const close of cleanup.splice(0).reverse()) await close() })
async function manifest() { return parsePluginManifest(await readFile('packages/plugin-sdk/examples/p6-workflow-provider/manifest.json', 'utf8')) }
const signal = () => new AbortController().signal
async function fixture(change?: (data: PluginManifest) => void, modelBackend?: PluginModelBackend) {
  const data = await manifest(); change?.(data)
  const directory = await mkdtemp(join(tmpdir(), 'janusx-workflow-'))
  cleanup.push(() => rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }))
  const root = join(directory, 'root'); const other = join(directory, 'other'); await mkdir(root); await mkdir(other)
  const send = vi.fn<PluginNetworkTransport['send']>(async () => ({ status: 200, body: 'result', contentType: 'text/plain' }))
  const service = new PluginService({ directory: join(directory, 'profile'), resolveProject: async (_id, scope) => ({ root: scope ?? root, name: 'Project' }),
    modelBackend,
    networkTransport: { resolve: async () => ['93.184.216.34'], send }, changed: vi.fn(), event: vi.fn(), openView: vi.fn(), toast: vi.fn() })
  cleanup.push(() => service.dispose()); await service.initialize(); await service.setDevelopment(true)
  const install = async (value: PluginManifest) => {
    const source = join(directory, value.id); await mkdir(source); await writeFile(join(source, 'manifest.json'), JSON.stringify(value))
    await service.import(source, 'linked'); await service.enable(value.id, ['project']); return source
  }
  const source = await install(data); await service.setContext('project', root, 'en', { id: '', tokens: {} })
  const context = { workspaceId: 'project', workspaceRoot: root }
  const request = { plugin: data.id, workflow: 'report', version: 1, revision: service.snapshot().plugins.find(item => item.manifest.id === data.id)!.digest, input: { topic: 'supplied text' } }
  const run = (input: unknown = request, abort = signal()) => service.runAgentWorkflow(context, input, abort)
  const start = () => service.backgroundManage({ type: 'taskStart', id: data.id, task: 'report', projectId: 'project', scopePath: root, input: request.input }) as Promise<{ id: string }>
  const finish = async (id: string) => { await vi.waitFor(() => expect(service.snapshot().tasks!.find(run => run.id === id)?.state).not.toBe('running')); return service.snapshot().tasks!.find(run => run.id === id)! }
  const runtime = new WorkspaceAgentRuntime(async () => root); registerPluginTools(runtime.registry, () => service)
  const session = await runtime.createSession({ ...context, approvalMode: 'plan' })
  return { data, source, root, other, service, context, request, run, start, finish, install, send, runtime, session }
}
function network(data: PluginManifest) {
  data.capabilities.required.push('network.fetch'); data.permissions.push({ name: 'network.fetch', origins: ['https://workflow.example.com'] })
  data.contributes.tasks![1].steps = [{ type: 'request', request: { url: 'https://workflow.example.com/collect' }, bodyFromInput: true }]
  data.contributes.tasks![2].steps = [{ type: 'request', request: { url: 'https://workflow.example.com/finish' } }]
}

describe('P6 supervised service workflows', () => {
  it.each(['capability', 'binding-capability', 'private', 'non-service', 'too-many', 'duplicate', 'binding-source', 'binding-type', 'binding-overlap', 'binding-target'])('rejects invalid %s manifests', async kind => {
    const data = await manifest(); const task = data.contributes.tasks![0]; const step = task.steps[0]
    if (kind === 'capability') data.capabilities.required = data.capabilities.required.filter(item => item !== 'agent.workflows')
    if (kind === 'binding-capability') data.capabilities.required = data.capabilities.required.filter(item => item !== 'tasks.inputBindings')
    if (kind === 'private') data.contributes.services![0].consumers = [data.id]
    if (kind === 'non-service') task.steps = [{ type: 'log', message: 'arbitrary step' }]
    if (kind === 'too-many') task.steps = Array.from({ length: 9 }, () => step)
    if (kind === 'duplicate') data.contributes.workflows!.push(data.contributes.workflows![0])
    if (kind === 'binding-type') task.input.topic = 'number'
    if (step.type === 'service') {
      if (kind === 'binding-source') step.inputFromTask = { text: 'missing' }
      if (kind === 'binding-target') step.inputFromTask = { missing: 'topic' }
      if (kind === 'binding-overlap') step.input = { text: 'literal' }
    }
    expect(() => parsePluginManifest(JSON.stringify(data))).toThrow()
  })
  it('requires the new capabilities on older hosts without changing legacy task manifests', async () => {
    const data = await manifest()
    for (const capability of ['agent.workflows', 'tasks.inputBindings']) expect(() => parsePluginManifest(JSON.stringify(data), {
      apiVersion: '1.0.0', capabilities: PLUGIN_CAPABILITIES.filter(item => item !== capability),
    })).toThrow()
    const legacy = await readFile('packages/plugin-sdk/examples/p5-consumer/manifest.json', 'utf8')
    expect(parsePluginManifest(legacy).contributes.workflows).toBeUndefined()
  })
  it('discovers the exact workflow contract without invoking providers; plan/denial never start a task', async () => {
    const f = await fixture()
    const catalog = await f.runtime.executeTool({ sessionId: f.session.id, call: { toolName: 'plugin.workflows', input: {} } })
    expect(catalog).toMatchObject({ status: 'completed', output: { workflows: [{ workflow: 'report', revision: f.request.revision, input: { topic: 'string' }, steps: [{ service: 'collect' }, { service: 'finish' }] }], truncated: false } })
    expect((await f.runtime.executeTool({ sessionId: f.session.id, call: { toolName: 'plugin.run-workflow', input: f.request } })).status).toBe('failed')
    await f.runtime.setApprovalMode(f.session.id, 'per-action')
    f.runtime.onEvent(event => { if (event.type === 'approval-requested') f.runtime.resolveApproval({ ...event.request, approvalId: event.request.id, approved: false }) })
    expect((await f.runtime.executeTool({ sessionId: f.session.id, call: { toolName: 'plugin.run-workflow', input: f.request } })).status).toBe('cancelled')
    expect(f.service.snapshot().tasks).toEqual([]); expect(f.send).not.toHaveBeenCalled()
  })
  it('shares sequential UI/Agent execution, maps typed input and tracks result ranges with separate owners', async () => {
    const f = await fixture(network)
    const ui = await f.finish((await f.start()).id); const agent = await f.run()
    expect(ui.state).toBe('completed'); expect(agent.state).toBe('completed')
    expect(ui.pluginId).toBe(f.data.id); expect(agent.pluginId).toBe('janusx.agent'); expect(agent.id).not.toBe(ui.id)
    expect(agent.workflow?.steps).toMatchObject([{ state: 'completed', results: { start: 0, end: 1 } }, { state: 'completed', results: { start: 1, end: 2 } }])
    expect(agent.results).toEqual(ui.results)
    expect(f.send.mock.calls.map(call => call[0].pathname)).toEqual(['/collect', '/finish', '/collect', '/finish'])
    expect(JSON.parse(f.send.mock.calls[0][2].body!)).toEqual({ text: 'supplied text' })
  })
  it('requires one runtime approval for the declared sequence', async () => {
    const f = await fixture(data => { data.contributes.tasks![1].steps = [{ type: 'log', message: 'short' }] })
    await f.runtime.setApprovalMode(f.session.id, 'per-action'); let approvals = 0
    f.runtime.onEvent(event => { if (event.type === 'approval-requested') { approvals++; f.runtime.resolveApproval({ ...event.request, approvalId: event.request.id, approved: true }) } })
    const result = await f.runtime.executeTool({ sessionId: f.session.id, call: { toolName: 'plugin.run-workflow', input: f.request } })
    expect(result).toMatchObject({ status: 'completed', output: { state: 'completed' } }); expect(approvals).toBe(1)
  })
  it('rejects stale versions/revisions, unknown fields and wrong inputs before external effects', async () => {
    const f = await fixture(network)
    for (const input of [{ ...f.request, version: 2 }, { ...f.request, revision: '0'.repeat(64) }, { ...f.request, input: { topic: 4 } }, { ...f.request, input: { topic: 'text', extra: true } }, { ...f.request, headers: {} }]) await expect(f.run(input)).rejects.toThrow()
    expect(f.send).not.toHaveBeenCalled()
  })
  it('stops on first failure, marks later steps skipped and retains completed prefix results', async () => {
    const f = await fixture(network)
    f.data.contributes.tasks![0].steps.push(f.data.contributes.tasks![0].steps[1])
    await writeFile(join(f.source, 'manifest.json'), JSON.stringify(f.data)); await f.service.reload(f.data.id); await f.service.enable(f.data.id, ['project'])
    f.send.mockImplementation(async url => {
      if (url.pathname === '/finish') throw new Error('private diagnostic')
      return { status: 200, body: 'prefix', contentType: 'text/plain' }
    })
    const record = f.service.snapshot().plugins[0]; const result = await f.run({ ...f.request, revision: record.digest })
    expect(result.state).toBe('failed'); expect(result.results).toHaveLength(1)
    expect(result.workflow?.steps.map(step => step.state)).toEqual(['completed', 'failed', 'skipped'])
    expect(JSON.stringify(result)).not.toContain('private diagnostic'); expect(f.send).toHaveBeenCalledTimes(2)
  })
  it.each(['cancel', 'disable', 'worktree', 'development', 'timeout'])('stops the active step and skips later steps on %s', async kind => {
    const f = await fixture(data => { data.contributes.tasks![1].steps = [{ type: 'delay', milliseconds: 5000 }]; if (kind === 'timeout') data.contributes.tasks![0].timeoutMs = 100 })
    const abort = new AbortController(); const pending = f.run(f.request, abort.signal)
    const outcome = pending.catch(cause => cause)
    await vi.waitFor(() => expect(f.service.snapshot().tasks![0]?.workflow?.steps[0].state).toBe('running'))
    if (kind === 'cancel') abort.abort()
    if (kind === 'disable') await f.service.disable(f.data.id)
    if (kind === 'worktree') await f.service.setContext('project', f.other, 'en', { id: '', tokens: {} })
    if (kind === 'development') await f.service.setDevelopment(false)
    await outcome
    const run = f.service.snapshot().tasks![0]
    expect(run.state).toBe(kind === 'timeout' ? 'timeout' : 'cancelled')
    expect(run.workflow?.steps.map(step => step.state)).toEqual([kind === 'timeout' ? 'timeout' : 'cancelled', 'skipped'])
  })
  it('pins a later direct provider before the first effect and cancels if it is reactivated', async () => {
    const f = await fixture(data => { data.contributes.tasks![1].steps = [{ type: 'delay', milliseconds: 5000 }] })
    const provider = await manifest(); provider.id = 'example.later'; provider.capabilities.required = ['tasks.declarative', 'services.public']; provider.permissions = [{ name: 'tasks.run' }, { name: 'services.public' }]
    provider.contributes = { views: [], tasks: [provider.contributes.tasks![2]], services: [{ id: 'finish', version: 1, task: 'finish', consumers: [f.data.id] }] }
    await f.install(provider)
    const step = f.data.contributes.tasks![0].steps[1]; if (step.type === 'service') step.plugin = provider.id
    f.data.contributes.consumes!.services![1].plugin = provider.id
    await writeFile(join(f.source, 'manifest.json'), JSON.stringify(f.data)); await f.service.reload(f.data.id); await f.service.enable(f.data.id, ['project'])
    const owner = f.service.snapshot().plugins.find(item => item.manifest.id === f.data.id)!
    const pending = f.run({ ...f.request, revision: owner.digest }).catch(cause => cause)
    await vi.waitFor(() => expect(f.service.snapshot().tasks![0]?.workflow?.steps[0].state).toBe('running'))
    await f.service.disable(provider.id); await f.service.enable(provider.id, ['project']); await pending
    expect(f.service.snapshot().tasks![0].workflow?.steps.map(step => step.state)).toEqual(['cancelled', 'skipped'])
  })
  it('requires renewed authorization for a sequence change and invalidates old discovery after regrant', async () => {
    const f = await fixture(); f.data.contributes.workflows![0].title = 'Changed sequence label'
    await writeFile(join(f.source, 'manifest.json'), JSON.stringify(f.data)); await f.service.reload(f.data.id)
    expect(f.service.snapshot().plugins[0].error).toBe('PERMISSION_RECONFIRM_REQUIRED')
    expect((await f.service.discoverAgentWorkflows(f.context, signal())).workflows).toEqual([])
    await f.service.enable(f.data.id, ['project']); await expect(f.run()).rejects.toMatchObject({ code: 'STALE_CONTEXT' })
  })
  it('reports a child network deadline as timeout on both the workflow and active step', async () => {
    const f = await fixture(network); f.send.mockRejectedValue(new PluginError('TIMEOUT', 'Request deadline'))
    const run = await f.run()
    expect(run.state).toBe('timeout')
    expect(run.workflow?.steps.map(step => step.state)).toEqual(['timeout', 'skipped'])
    expect(f.send).toHaveBeenCalledTimes(1)
  })
  it('preflights optional direct participants before any effect, including ordinary service invocations', async () => {
    const f = await fixture(data => {
      network(data)
      const step = data.contributes.tasks![0].steps[1]; if (step.type === 'service') step.plugin = 'example.missing'
      data.contributes.consumes!.services![1].plugin = 'example.missing'; data.contributes.consumes!.services![1].optional = true
    })
    expect((await f.service.discoverAgentWorkflows(f.context, signal())).workflows).toEqual([])
    await expect(f.run()).rejects.toThrow()
    await expect(f.start()).rejects.toThrow()
    await expect(f.service.callAgentService(f.context, { plugin: f.data.id, service: 'report', version: 1, input: f.request.input }, signal())).rejects.toThrow()
    expect(f.send).not.toHaveBeenCalled(); expect(f.service.snapshot().tasks).toEqual([])
  })
  it('shares the one-model-call budget across workflow steps instead of resetting it per service', async () => {
    let calls = 0
    const f = await fixture(data => {
      data.capabilities.required.push('models.generate'); data.permissions.push({ name: 'models.generate' })
      for (const task of data.contributes.tasks!.slice(1)) {
        task.input = { text: 'string' }; task.steps = [{ type: 'model', promptInput: 'text', instruction: 'Summarize', maxOutputTokens: 16 }]
      }
      data.contributes.consumes!.services![1].schema = { text: 'string' }
      const step = data.contributes.tasks![0].steps[1]; if (step.type === 'service') step.input = { text: 'second input' }
    }, { resolve: async () => ({ contextWindow: 16000, maxOutputTokens: 1024, secrets: [], current: async () => true,
      stream: async function* () { calls++; yield { type: 'text', text: 'summary' }; yield { type: 'finish', reason: 'stop', outputTokens: 3 } } }) })
    const run = await f.run()
    expect(calls).toBe(1); expect(run.error).toBe('RATE_LIMITED')
    expect(run.workflow?.steps).toMatchObject([{ state: 'completed', modelResults: { start: 0, end: 1 } }, { state: 'failed', modelResults: { start: 1, end: 1 } }])
  })
  it('does not expose project workflows outside grants or the current worktree', async () => {
    const f = await fixture()
    await expect(f.service.discoverAgentWorkflows({ ...f.context, workspaceRoot: f.other }, signal())).rejects.toThrow()
    await f.service.enable(f.data.id, [])
    expect((await f.service.discoverAgentWorkflows(f.context, signal())).workflows).toEqual([]); await expect(f.run()).rejects.toThrow()
  })
  it('honors cancellation before discovery or workflow start', async () => {
    const f = await fixture(); const abort = new AbortController(); abort.abort()
    await expect(f.service.discoverAgentWorkflows(f.context, abort.signal)).rejects.toMatchObject({ code: 'CANCELLED' })
    await expect(f.run(f.request, abort.signal)).rejects.toMatchObject({ code: 'CANCELLED' })
    expect(f.service.snapshot().tasks).toEqual([])
  })
})
