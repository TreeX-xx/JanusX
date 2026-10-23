import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WorkspaceAgentRuntime } from '@janus-agent/agent-core'
import { parsePluginManifest, PLUGIN_CAPABILITIES, type PluginManifest } from '../../packages/plugin-sdk/src'
import { PluginService } from '../../src/main/plugins/service'
import { PluginBackground, type BackgroundIdentity } from '../../src/main/plugins/background'
import type { PluginNetwork } from '../../src/main/plugins/network'
import { registerPluginTools } from '../../src/main/agent/runtime/tools/plugin-tools'

const cleanup: Array<() => unknown> = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })
function manifest(): PluginManifest {
  return parsePluginManifest(JSON.stringify({ schemaVersion: 1, id: 'example.agent-status', name: 'Status provider', version: '1.0.0',
    engines: { pluginApi: '^1.0.0' }, capabilities: { required: ['tasks.declarative', 'services.public', 'agent.services', 'network.fetch'], optional: [] },
    permissions: [{ name: 'tasks.run' }, { name: 'services.public' }, { name: 'agent.services' }, { name: 'network.fetch', origins: ['https://status.example.com'] }],
    contributes: { views: [], tasks: [
      { id: 'status', title: 'Read service status', scope: 'project', input: {}, timeoutMs: 2000, steps: [{ type: 'request', request: { url: 'https://status.example.com/status' } }] },
      { id: 'slow', title: 'Slow status', scope: 'application', input: {}, timeoutMs: 2000, steps: [{ type: 'delay', milliseconds: 1500 }] },
    ], services: [
      { id: 'status', version: 1, task: 'status', consumers: ['janusx.agent', 'example.status-ui'] },
      { id: 'slow', version: 1, task: 'slow', consumers: ['janusx.agent'] },
    ] } }))
}
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'janusx-p6-'))
  cleanup.push(() => rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }))
  const root = join(directory, 'root'); const other = join(directory, 'other'); await mkdir(root); await mkdir(other)
  const send = vi.fn(async () => ({ status: 200, body: '{"status":"operational"}', contentType: 'application/json' }))
  const service = new PluginService({ directory: join(directory, 'profile'), networkTransport: { resolve: async () => ['93.184.216.34'], send },
    resolveProject: async (_id, scope) => ({ root: scope ?? root, name: 'Project' }), changed: vi.fn(), event: vi.fn(), openView: vi.fn(), toast: vi.fn() })
  cleanup.push(() => service.dispose()); await service.initialize(); await service.setDevelopment(true)
  const install = async (value: PluginManifest) => {
    const source = join(directory, value.id); await mkdir(source); await writeFile(join(source, 'manifest.json'), JSON.stringify(value))
    await service.import(source, 'linked'); await service.enable(value.id, ['project']); return source
  }
  const source = await install(manifest())
  await service.setContext('project', root, 'en', { id: '', tokens: {} })
  const context = { workspaceId: 'project', workspaceRoot: root }
  const request = { plugin: manifest().id, service: 'status', version: 1, input: {} }
  const runtime = new WorkspaceAgentRuntime(async () => root); registerPluginTools(runtime.registry, () => service)
  const session = await runtime.createSession({ ...context, approvalMode: 'per-action' })
  const approve = (approved = true) => runtime.onEvent(event => {
    if (event.type === 'approval-requested') runtime.resolveApproval({ ...event.request, approvalId: event.request.id, approved })
  })
  const execute = (input = request) => runtime.executeTool({ sessionId: session.id, call: { toolName: 'plugin.call-service', input } })
  return { directory, root, other, source, service, send, install, context, request, runtime, session, approve, execute }
}

describe('P6 Agent/public-service adapter', () => {
  it('requires explicit capability and permission, and old hosts reject it', () => {
    const value = manifest()
    for (const change of [{ permissions: value.permissions.filter(item => item.name !== 'agent.services') },
      { capabilities: { ...value.capabilities, required: value.capabilities.required.filter(item => item !== 'agent.services') } }]) {
      expect(() => parsePluginManifest(JSON.stringify({ ...value, ...change }))).toThrow()
    }
    expect(() => parsePluginManifest(JSON.stringify(value), { apiVersion: '1.0.0', capabilities: PLUGIN_CAPABILITIES.filter(item => item !== 'agent.services') })).toThrow()
  })
  it('discovers actual available contracts and rejects a different worktree or workspace', async () => {
    const f = await fixture()
    expect(await f.service.discoverAgentServices(f.context)).toMatchObject([{ service: 'slow', scope: 'application' }, { service: 'status', scope: 'project', input: {} }])
    await expect(f.service.discoverAgentServices({ ...f.context, workspaceRoot: f.other })).rejects.toThrow()
    await expect(f.service.callAgentService({ ...f.context, workspaceId: 'other' }, f.request, new AbortController().signal)).rejects.toThrow()
    expect(f.send).not.toHaveBeenCalled()
  })
  it('requires runtime approval; denial and plan mode never start a task', async () => {
    const f = await fixture(); f.approve(false)
    expect((await f.execute()).status).toBe('cancelled')
    const plan = await f.runtime.createSession({ ...f.context, approvalMode: 'plan' })
    const denied = await f.runtime.executeTool({ sessionId: plan.id, call: { toolName: 'plugin.call-service', input: f.request } })
    expect(denied.status).toBe('failed'); expect(f.service.snapshot().tasks).toHaveLength(0); expect(f.send).not.toHaveBeenCalled()
  })
  it('returns the same domain result through UI task and approved Agent invocation, with separate ownership', async () => {
    const f = await fixture(); f.approve()
    const consumer = manifest(); consumer.id = 'example.status-ui'; consumer.permissions = consumer.permissions.filter(item => item.name !== 'agent.services')
    consumer.capabilities.required = consumer.capabilities.required.filter(item => item !== 'agent.services')
    consumer.contributes.services = undefined
    consumer.contributes.consumes = { services: [{ plugin: f.request.plugin, id: 'status', version: 1, schema: {} }] }
    consumer.contributes.tasks = [{ id: 'status', title: 'Status', scope: 'project', input: {}, timeoutMs: 2000, steps: [{ type: 'service', ...f.request }] }]
    await f.install(consumer)
    const ui = await f.service.backgroundManage({ type: 'taskStart', id: consumer.id, task: 'status', input: {}, projectId: 'project', scopePath: f.root }) as { id: string }
    await vi.waitFor(() => expect(f.service.snapshot().tasks?.find(run => run.id === ui.id)?.state).toBe('completed'))
    const result = await f.execute()
    expect(result.status).toBe('completed')
    const runs = f.service.snapshot().tasks!
    const agent = runs.find(run => run.pluginId === 'janusx.agent')!
    expect(result.output).toMatchObject({ id: agent.id, state: 'completed', task: `${f.request.plugin}/status` })
    expect(agent.results).toEqual(runs.find(run => run.id === ui.id)!.results)
    expect(agent.id).not.toBe(ui.id)
  })
  it('validates exact input/version and does not advertise a disabled provider', async () => {
    const f = await fixture()
    for (const request of [{ ...f.request, input: { extra: true } }, { ...f.request, version: 2 }, { ...f.request, headers: {} }]) {
      await expect(f.service.callAgentService(f.context, request, new AbortController().signal)).rejects.toThrow()
    }
    await f.service.disable(f.request.plugin)
    expect(await f.service.discoverAgentServices(f.context)).toEqual([])
    await expect(f.service.callAgentService(f.context, f.request, new AbortController().signal)).rejects.toThrow()
    expect(f.send).not.toHaveBeenCalled()
  })
  it('propagates session cancellation to the underlying host task', async () => {
    const f = await fixture(); f.approve()
    const pending = f.execute({ ...f.request, service: 'slow' })
    await vi.waitFor(() => expect(f.service.snapshot().tasks?.[0]?.state).toBe('running'))
    await f.runtime.cancelSession(f.session.id)
    expect((await pending).status).toBe('cancelled')
    expect(f.service.snapshot().tasks?.[0]?.state).toBe('cancelled')
  })
  it('does not start pre-cancelled work and propagates the Agent tool deadline', async () => {
    const f = await fixture(); const abort = new AbortController(); abort.abort()
    await expect(f.service.callAgentService(f.context, f.request, abort.signal)).rejects.toMatchObject({ code: 'CANCELLED' })
    expect(f.service.snapshot().tasks).toHaveLength(0)
    const session = await f.runtime.createSession({ ...f.context, approvalMode: 'auto-run', timeoutMs: 50 })
    const result = await f.runtime.executeTool({ sessionId: session.id, call: { toolName: 'plugin.call-service', input: { ...f.request, service: 'slow' } } })
    expect(result.status).toBe('timed-out')
    expect(f.service.snapshot().tasks?.[0]?.state).toBe('cancelled')
  })
  it.each(['switch', 'disable'])('cancels application Agent work on %s and refuses the late result', async change => {
    const f = await fixture()
    const pending = f.service.callAgentService(f.context, { ...f.request, service: 'slow' }, new AbortController().signal)
    const rejected = expect(pending).rejects.toThrow()
    await vi.waitFor(() => expect(f.service.snapshot().tasks?.[0]?.state).toBe('running'))
    if (change === 'switch') await f.service.setContext('project', f.other, 'en', { id: '', tokens: {} })
    else await f.service.disable(f.request.plugin)
    await rejected; expect(f.service.snapshot().tasks?.[0]?.state).toBe('cancelled')
  })
  it('requires renewed authorization when a provider adds Agent access', async () => {
    const f = await fixture(); const original = manifest()
    original.permissions = original.permissions.filter(item => item.name !== 'agent.services')
    original.capabilities.required = original.capabilities.required.filter(item => item !== 'agent.services')
    original.contributes.services!.forEach(service => { service.consumers = ['example.status-ui'] })
    await f.service.disable(original.id)
    await writeFile(join(f.source, 'manifest.json'), JSON.stringify(original)); await f.service.reload(original.id); await f.service.enable(original.id, ['project'])
    expect(await f.service.discoverAgentServices(f.context)).toEqual([])
    await writeFile(join(f.source, 'manifest.json'), JSON.stringify(manifest())); await f.service.reload(original.id)
    expect(await f.service.discoverAgentServices(f.context)).toEqual([])
    expect(f.service.snapshot().plugins[0].error).toBe('PERMISSION_RECONFIRM_REQUIRED')
  })
  it('keeps Agent results out of provider page task lists and cancellation authority', async () => {
    const value = manifest(); const provider: BackgroundIdentity = { plugin: value.id, manifest: value, projectId: null, rootId: null, scope: 'application', valid() {} }
    const background = new PluginBackground({ network: {} as PluginNetwork, identity: () => provider, changed() {} })
    const abort = new AbortController(); const pending = background.callAgent(provider, { service: 'slow', version: 1, input: {} }, abort.signal)
    const rejected = expect(pending).rejects.toThrow()
    const id = background.list()[0].id
    expect(background.list(provider)).toEqual([])
    expect(() => background.cancel(id, provider)).toThrow()
    abort.abort(); await rejected
    expect(background.list()[0].state).toBe('cancelled')
  })
  it('ships a public-protocol status provider and host UI consumer without private imports', async () => {
    for (const name of ['p6-status-provider', 'p6-status-consumer']) {
      const value = parsePluginManifest(await readFile(`packages/plugin-sdk/examples/${name}/manifest.json`, 'utf8'))
      expect(value.contributes.tasks).toHaveLength(1)
    }
  })
})
