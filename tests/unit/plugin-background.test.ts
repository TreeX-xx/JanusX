import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { MessageChannel } from 'node:worker_threads'
import { createPluginClient, parsePluginManifest, validatePluginCall, matchesPluginMessage, type PluginManifest } from '../../packages/plugin-sdk/src/index'
import { PluginService } from '../../src/main/plugins/service'
import { PluginCredentials, PluginNetwork, isPluginPublicAddress, type PluginNetworkTransport } from '../../src/main/plugins/network'

const cleanups: Array<() => unknown> = []
afterEach(async () => { vi.useRealTimers(); for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })
function manifest(id = 'example.background'): PluginManifest {
  return parsePluginManifest(JSON.stringify({ schemaVersion: 1, id, name: 'Background sample', version: '1.0.0', engines: { pluginApi: '^1.0.0' },
    capabilities: { required: ['tasks.declarative', 'network.fetch', 'credentials.use', 'events.public', 'services.public'], optional: [] },
    permissions: [{ name: 'tasks.run' }, { name: 'network.fetch', origins: ['https://api.example.com', 'https://other.example.com'] },
      { name: 'credentials.use' }, { name: 'events.public' }, { name: 'services.public' }],
    contributes: { views: [],
      credentials: [{ id: 'token', title: 'API token', origin: 'https://api.example.com' }],
      tasks: [
        { id: 'quick', title: 'Quick', scope: 'application', input: {}, timeoutMs: 1000, steps: [{ type: 'log', message: 'Started' }, { type: 'delay', milliseconds: 10 }, { type: 'log', message: 'Done' }] },
        { id: 'slow', title: 'Slow', scope: 'project', input: {}, timeoutMs: 1000, steps: [{ type: 'delay', milliseconds: 900 }] },
        { id: 'timeout', title: 'Timeout', scope: 'application', input: {}, timeoutMs: 20, steps: [{ type: 'delay', milliseconds: 500 }] },
        { id: 'fetch', title: 'Fetch', scope: 'application', input: {}, timeoutMs: 1000, steps: [{ type: 'request', request: { url: 'https://api.example.com/data' } }] },
        { id: 'auth', title: 'Auth', scope: 'application', input: {}, timeoutMs: 1000, steps: [{ type: 'request', request: { url: 'https://api.example.com/data', credential: 'token' } }] },
      ], events: [{ id: 'done', version: 1, scope: 'application', data: { message: 'string' }, consumers: ['example.consumer', 'example.background'] }],
      services: [{ id: 'quick', version: 1, task: 'quick', consumers: ['example.consumer', 'example.background'] }],
    } }))
}
async function temp() { const directory = await mkdtemp(join(tmpdir(), 'janusx-p5-unit-')); cleanups.push(() => rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })); return directory }
function encryption() {
  const key = randomBytes(32)
  return { encrypt: (value: string) => { const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key, iv); const data = Buffer.concat([cipher.update(value), cipher.final()]); return Buffer.concat([iv, cipher.getAuthTag(), data]) },
    decrypt: (value: Buffer) => { const cipher = createDecipheriv('aes-256-gcm', key, value.subarray(0, 12)); cipher.setAuthTag(value.subarray(12, 28)); return Buffer.concat([cipher.update(value.subarray(28)), cipher.final()]).toString() } }
}
async function fixture() {
  const directory = await temp(); const roots = [join(directory, 'a'), join(directory, 'b'), join(directory, 'tree')]
  await Promise.all(roots.map(root => mkdir(root)))
  const io: PluginNetworkTransport = { resolve: vi.fn(async () => ['93.184.216.34']), send: vi.fn(async () => ({ status: 200, body: 'public data', contentType: 'text/plain' })) }
  const event = vi.fn()
  const service = new PluginService({ directory: join(directory, 'profile'), encryption: encryption(), networkTransport: io,
    resolveProject: async (id, scope) => ({ root: scope ?? (id === 'a' ? roots[0] : roots[1]), name: id }), changed: vi.fn(), event, openView: vi.fn(), toast: vi.fn() })
  cleanups.push(() => service.dispose()); await service.initialize(); await service.setDevelopment(true)
  const install = async (value: PluginManifest, enable = true) => {
    const source = join(directory, value.id); await mkdir(join(source, 'dist'), { recursive: true })
    await writeFile(join(source, 'manifest.json'), JSON.stringify(value)); await writeFile(join(source, 'dist/index.html'), '<p>background</p>')
    await service.import(source, 'linked'); if (enable) await service.enable(value.id, ['a', 'b']); return source
  }
  const value = manifest(); const source = await install(value)
  await service.setContext('a', roots[0], 'en', { id: '', tokens: {} })
  const start = async (task: string, projectId: string | null = null, input = {}) => service.backgroundManage({ type: 'taskStart', id: value.id, task, projectId, scopePath: projectId ? roots[0] : null, input }) as Promise<{ id: string }>
  const runs = () => service.snapshot().tasks!
  const finish = async (id: string) => { await vi.waitFor(() => expect(runs().find(run => run.id === id)?.state).not.toBe('running')); return runs().find(run => run.id === id)! }
  const credential = (value: string | null, projectId: string | null = null) => service.backgroundManage({ type: 'credentialSet', id: 'example.background', projectId, scopePath: projectId ? roots[0] : null, slot: 'token', value })
  return { directory, roots, service, value, source, io, event, install, start, runs, finish, credential }
}
describe('P5 declarative contract', () => {
  it('serializes SDK background calls, public subscriptions, unsubscribe and AbortSignal cancellation', async () => {
    const { port1, port2 } = new MessageChannel(); const client = createPluginClient(port1 as unknown as MessagePort, 7)
    cleanups.push(() => { client.close(); port2.close() })
    const packets: any[] = []
    port2.on('message', packet => {
      packets.push(packet)
      if (packet.type !== 'request' || packet.method === 'network.fetch') return
      const result = packet.method === 'events.subscribe' ? { subscriptionId: 'sub' } : packet.method === 'tasks.start' || packet.method === 'services.call' ? { id: 'run' } : []
      port2.postMessage({ protocol: 1, contextRevision: 7, type: 'response', requestId: packet.requestId, ok: true, result })
    })
    expect(await client.api.tasks.start({ task: 'quick', input: {} })).toEqual({ id: 'run' })
    expect(await client.api.services.call({ plugin: 'example.provider', service: 'quick', version: 1, input: {} })).toEqual({ id: 'run' })
    const received = vi.fn(); const unsubscribe = await client.api.events.subscribe({ plugin: 'example.provider', event: 'done', version: 1 }, received)
    port2.postMessage({ protocol: 1, contextRevision: 7, type: 'event', event: 'public', subscriptionId: 'sub', payload: { source: 'example.provider' } })
    await vi.waitFor(() => expect(received).toHaveBeenCalledWith({ source: 'example.provider' })); unsubscribe()
    const controller = new AbortController(); const pending = client.api.network.fetch({ url: 'https://api.example.com' }, { signal: controller.signal })
    controller.abort(); await expect(pending).rejects.toMatchObject({ code: 'CANCELLED' })
    await vi.waitFor(() => expect(packets.some(packet => packet.type === 'cancel')).toBe(true))
    expect(packets.find(packet => packet.type === 'unsubscribe')).toEqual({ protocol: 1, type: 'unsubscribe', subscriptionId: 'sub' })
    expect(packets.find(packet => packet.method === 'network.fetch').params).toEqual({ url: 'https://api.example.com' })
  })
  it('accepts a truly pageless package and rejects executable background entries and unknown steps', () => {
    const value = manifest(); expect(value.contributes.views).toEqual([])
    for (const change of [ { main: 'main.js' }, { background: 'main.js' }, { contributes: { ...value.contributes, tasks: [{ ...value.contributes.tasks![0], steps: [{ type: 'exec', command: 'node' }] }] } },
      { contributes: { views: [] } }, { permissions: value.permissions.filter(item => item.name !== 'tasks.run') },
      { contributes: { ...value.contributes, credentials: [{ id: 'bad', title: 'bad', origin: 'https://unapproved.example' }] } } ]) {
      expect(() => parsePluginManifest(JSON.stringify({ ...value, ...change }))).toThrow()
    }
  })
  it('validates strict request schemas, primitive data and declarations', () => {
    const value = manifest()
    expect(() => validatePluginCall(value, 'tasks.start', { task: 'quick', input: {} })).not.toThrow()
    for (const [method, params] of [['tasks.start', { task: 'quick', input: {}, projectId: 'b' }], ['network.fetch', { url: 'x', headers: { authorization: 'x' } }], ['services.call', { plugin: 'x', service: 'x', version: 0, input: {} }]]) expect(() => validatePluginCall(value, method as string, params)).toThrow()
    expect(matchesPluginMessage({ n: 'number' }, { n: 4 })).toBe(true)
    expect(matchesPluginMessage({ n: 'number' }, { n: '4' })).toBe(false)
    expect(matchesPluginMessage({}, { extra: true })).toBe(false)
    expect(() => validatePluginCall(value, 'network.fetch', { url: 'https://api.example.com', method: 'POST', body: '汉'.repeat(12_000) })).toThrow()
  })
  it.each(['127.0.0.1', '10.1.1.1', '169.254.169.254', '172.31.0.1', '192.168.1.1', '100.64.0.1', '0.0.0.0', '224.1.1.1', '198.18.0.1', '::1', '::ffff:127.0.0.1'])('rejects private/reserved target %s', address => expect(isPluginPublicAddress(address)).toBe(false))
})
describe('P5 tasks and lifecycle', () => {
  it('runs without pages, records bounded logs and results, and supports explicit retry', async () => {
    const f = await fixture(); const { id } = await f.start('quick'); expect((await f.finish(id)).state).toBe('completed')
    expect(f.runs()[0].logs.map(log => log.message).filter(Boolean)).toEqual(['Started', 'Done'])
    expect(f.service.snapshot().plugins[0].runtime?.pages).toBe(0)
    expect((await f.finish((await f.start('fetch')).id)).results[0].body).toBe('public data')
    expect((await f.finish((await f.start('quick')).id)).state).toBe('completed')
  })
  it('cancels, times out, and does not write results after disable or project/worktree switches', async () => {
    const f = await fixture()
    const cancelled = await f.start('slow', 'a'); await f.service.backgroundManage({ type: 'taskCancel', runId: cancelled.id })
    expect((await f.finish(cancelled.id)).state).toBe('cancelled')
    expect((await f.finish((await f.start('timeout')).id)).state).toBe('timeout')
    const project = await f.start('slow', 'a'); const application = await f.start('quick')
    await f.service.setContext('b', f.roots[1], 'en', { id: '', tokens: {} })
    expect((await f.finish(project.id)).state).toBe('cancelled'); expect((await f.finish(application.id)).state).toBe('completed')
    await f.service.setContext('a', f.roots[0], 'en', { id: '', tokens: {} }); const worktree = await f.start('slow', 'a')
    await f.service.setContext('a', f.roots[2], 'en', { id: '', tokens: {} }); expect((await f.finish(worktree.id)).state).toBe('cancelled')
    await expect(f.start('slow', 'a')).rejects.toMatchObject({ code: 'STALE_CONTEXT' })
    await f.service.disable(f.value.id); await expect(f.start('quick')).rejects.toMatchObject({ code: 'PLUGIN_DISABLED' })
  })
  it('limits concurrency and requires scope/input/permissions before starting work', async () => {
    const f = await fixture()
    await expect(f.start('quick', null, { unexpected: true })).rejects.toMatchObject({ code: 'INVALID_REQUEST' })
    await expect(f.start('slow')).rejects.toMatchObject({ code: 'INVALID_REQUEST' })
    await Promise.all(Array.from({ length: 4 }, () => f.start('slow', 'a')))
    await expect(f.start('slow', 'a')).rejects.toMatchObject({ code: 'RATE_LIMITED' })
    await f.service.setDevelopment(false); expect(f.runs().every(run => run.state === 'cancelled')).toBe(true)
  })
  it('revokes on reload, regrants on changed task declarations and retains no running work on dispose', async () => {
    const f = await fixture(); const run = await f.start('slow', 'a')
    f.value.contributes.tasks![0].steps.push({ type: 'log', message: 'Changed' })
    await writeFile(join(f.source, 'manifest.json'), JSON.stringify(f.value)); await f.service.reload(f.value.id)
    expect((await f.finish(run.id)).state).toBe('cancelled'); expect(f.service.snapshot().plugins[0].state).toBe('blocked')
    await f.service.enable(f.value.id, ['a']); await f.start('slow', 'a'); f.service.dispose()
    expect(f.runs().every(run => run.state !== 'running')).toBe(true)
  })
})
describe('P5 host network and credentials', () => {
  it('encrypts scoped secrets, never returns a credentialed response body, and supports revocation and data deletion', async () => {
    const f = await fixture(); await f.credential('secret-fixture-token')
    vi.mocked(f.io.send).mockImplementation(async (_url, _address, _input, secret) => ({ status: 200, body: `echo ${secret}`, contentType: 'token-echo' }))
    const run = await f.finish((await f.start('auth')).id); expect(run.results).toEqual([{ status: 200, body: '', contentType: '' }])
    expect(vi.mocked(f.io.send).mock.calls[0][3]).toBe('secret-fixture-token')
    expect(JSON.stringify(f.service.snapshot())).not.toContain('secret-fixture-token')
    const credentials = join(f.directory, 'profile/credentials'); const plugin = (await readdir(credentials))[0]
    const path = join(credentials, plugin, (await readdir(join(credentials, plugin)))[0])
    expect((await readFile(path)).includes(Buffer.from('secret-fixture-token'))).toBe(false)
    await f.credential('project-fixture-token', 'a'); await f.credential(null)
    expect((await f.finish((await f.start('auth')).id)).error).toBe('CREDENTIAL_UNAVAILABLE')
    expect(await f.service.backgroundManage({ type: 'credentialStatus', id: f.value.id, slot: 'token', projectId: 'a', scopePath: f.roots[0] })).toEqual({ configured: true })
    await f.service.deleteData(f.value.id); expect(f.runs()).toEqual([]); expect(await readdir(credentials)).toEqual([])
  })
  it('fails closed without encryption and preserves the previous secret if encryption fails', async () => {
    const directory = await temp(); const store = new PluginCredentials(directory)
    await expect(store.set('x', 'application', 'token', 'https://api.example.com', 'key', () => {})).rejects.toMatchObject({ code: 'CREDENTIAL_UNAVAILABLE' })
    const crypto = encryption(); const configured = new PluginCredentials(directory, crypto)
    await configured.set('x', 'application', 'token', 'https://api.example.com', 'old-key', () => {})
    crypto.encrypt = () => { throw new Error('Unavailable') }
    await expect(configured.set('x', 'application', 'token', 'https://api.example.com', 'new-key', () => {})).rejects.toThrow()
    expect(await configured.get('x', 'application', 'token', 'https://api.example.com')).toBe('old-key')
  })
  it('rejects a project credential write if reload and reauthorization occurred during root resolution', async () => {
    const f = await fixture()
    const deps = (f.service as any).deps
    const resolveProject = deps.resolveProject
    let release!: () => void; let entered!: () => void
    const gate = new Promise<void>(resolve => { release = resolve }); const started = new Promise<void>(resolve => { entered = resolve })
    deps.resolveProject = async (...args: unknown[]) => { entered(); await gate; return resolveProject(...args) }
    const pending = f.credential('stale-fixture-token', 'a')
    await started; deps.resolveProject = resolveProject
    await f.service.reload(f.value.id, true); await f.service.enable(f.value.id, ['a'])
    release(); await expect(pending).rejects.toMatchObject({ code: 'STALE_CONTEXT' })
    expect(await f.service.backgroundManage({ type: 'credentialStatus', id: f.value.id, projectId: 'a', scopePath: f.roots[0], slot: 'token' })).toEqual({ configured: false })
  })
  it('rejects mixed/public-to-private DNS and unapproved/cross-origin redirects before another transport call', async () => {
    const directory = await temp(); const io = { resolve: vi.fn(async () => ['93.184.216.34']), send: vi.fn(async () => ({ status: 302, body: '', contentType: '', location: 'https://unapproved.example/data' })) }
    const broker = new PluginNetwork(new PluginCredentials(directory), io); const value = manifest()
    await expect(broker.fetch(value, 'application', { url: 'http://api.example.com' }, () => {})).rejects.toMatchObject({ code: 'NETWORK_DENIED' }); expect(io.send).not.toHaveBeenCalled()
    await expect(broker.fetch(value, 'application', { url: 'https://api.example.com' }, () => {})).rejects.toMatchObject({ code: 'NETWORK_DENIED' }); expect(io.send).toHaveBeenCalledTimes(1)
    io.resolve.mockResolvedValue(['93.184.216.34', '127.0.0.1']); io.send.mockClear()
    await expect(broker.fetch(value, 'application', { url: 'https://api.example.com' }, () => {})).rejects.toMatchObject({ code: 'NETWORK_DENIED' }); expect(io.send).not.toHaveBeenCalled()
    io.resolve.mockResolvedValue(['93.184.216.34']); io.send.mockResolvedValue({ status: 302, body: '', contentType: '', location: 'https://other.example.com' })
    await expect(broker.fetch(value, 'application', { url: 'https://api.example.com' }, () => {})).rejects.toMatchObject({ code: 'NETWORK_DENIED' }); expect(io.send).toHaveBeenCalledTimes(1)
  })
  it('aborts pending I/O on disable and blocks late response delivery', async () => {
    const f = await fixture(); let finish!: (value: any) => void
    vi.mocked(f.io.send).mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const run = await f.start('fetch'); await vi.waitFor(() => expect(f.io.send).toHaveBeenCalled())
    await f.service.disable(f.value.id); finish({ status: 200, body: 'late', contentType: '' })
    const stopped = await f.finish(run.id); expect(stopped.state).toBe('cancelled'); expect(stopped.results).toEqual([])
  })
})
describe('P5 public events and services', () => {
  async function connected() {
    const f = await fixture()
    f.value.contributes.views = [{ id: 'app', title: 'App', entry: 'dist/index.html', location: 'workspace', scope: 'application', instancePolicy: 'single' }]
    f.value.contributes.consumes = { events: [{ plugin: 'example.consumer', id: 'done', version: 1, schema: { message: 'string' }, optional: true }],
      services: [{ plugin: 'example.consumer', id: 'quick', version: 1, schema: {}, optional: true }] }
    await writeFile(join(f.source, 'manifest.json'), JSON.stringify(f.value)); await f.service.reload(f.value.id); await f.service.enable(f.value.id, ['a', 'b'])
    const consumer = manifest('example.consumer'); consumer.contributes.views = structuredClone(f.value.contributes.views)
    consumer.contributes.consumes = { events: [{ plugin: f.value.id, id: 'done', version: 1, schema: { message: 'string' } }],
      services: [{ plugin: f.value.id, id: 'quick', version: 1, schema: {} }] }
    consumer.contributes.events![0].consumers = [f.value.id]; consumer.contributes.services![0].consumers = [f.value.id]
    const consumerSource = await f.install(consumer)
    let sequence = 0
    const page = async (id: string) => { const mount = await f.service.mount(id, 'app', null, null); f.service.bind(mount.instanceId, mount.binding); return mount }
    const call = (mount: Awaited<ReturnType<typeof page>>, method: string, params = {}) => f.service.call(mount.instanceId, mount.binding,
      { protocol: 1, type: 'request', requestId: String(++sequence), method, params, contextRevision: mount.context.revision }) as Promise<any>
    const provider = await page(f.value.id); const client = await page(consumer.id)
    return { ...f, consumer, consumerSource, page, call, provider, client }
  }
  it('discovers and invokes declared services without exposing provider private tasks; closing the caller page leaves work running', async () => {
    const f = await connected()
    expect((await f.call(f.client, 'services.discover')).result).toEqual([{ plugin: f.value.id, service: 'quick', version: 1, scope: 'application' }])
    expect((await f.call(f.client, 'services.call', { plugin: f.value.id, service: 'quick', version: 2, input: {} })).error.code).toBe('PERMISSION_DENIED')
    const run = await f.call(f.client, 'services.call', { plugin: f.value.id, service: 'quick', version: 1, input: {} })
    expect(run.ok).toBe(true); f.service.close(f.client.instanceId)
    expect((await f.finish(run.result.id)).state).toBe('completed')
    const providerTasks = (await f.call(f.provider, 'tasks.list')).result
    expect(providerTasks.some((item: any) => item.id === run.result.id)).toBe(false)
    const own = await f.start('quick')
    const newClient = await f.page(f.consumer.id)
    expect((await f.call(newClient, 'tasks.cancel', { id: own.id })).error.code).toBe('PERMISSION_DENIED')
  })
  it('validates event schemas, delivers same-scope events, rejects forged causes and detects continuation loops', async () => {
    const f = await connected()
    const subscribed = await f.call(f.client, 'events.subscribe', { plugin: f.value.id, event: 'done', version: 1 })
    expect(subscribed.ok).toBe(true)
    await f.call(f.provider, 'events.subscribe', { plugin: f.consumer.id, event: 'done', version: 1 })
    expect((await f.call(f.provider, 'events.publish', { event: 'done', data: { message: 2 } })).error.code).toBe('INVALID_REQUEST')
    const first = await f.call(f.provider, 'events.publish', { event: 'done', data: { message: 'ok' } })
    const delivered = f.event.mock.calls.find(([page, packet]) => page === f.client.instanceId && (packet as any).subscriptionId === subscribed.result.subscriptionId)
    expect((delivered![1] as any).payload.source).toBe(f.value.id)
    const next = await f.call(f.client, 'events.publish', { event: 'done', data: { message: 'reply' }, cause: first.result.id })
    expect(next.ok).toBe(true)
    expect((await f.call(f.provider, 'events.publish', { event: 'done', data: { message: 'loop' }, cause: next.result.id })).error.code).toBe('CYCLE_DETECTED')
    expect((await f.call(f.client, 'events.publish', { event: 'done', data: { message: 'forged' }, cause: '00000000-0000-4000-8000-000000000000' })).error.code).toBe('INVALID_REQUEST')
    await f.service.call(f.client.instanceId, f.client.binding, { protocol: 1, type: 'unsubscribe', subscriptionId: subscribed.result.subscriptionId })
    f.event.mockClear(); await f.call(f.provider, 'events.publish', { event: 'done', data: { message: 'after unsubscribe' } })
    expect(f.event.mock.calls.some(([page, packet]) => page === f.client.instanceId && (packet as any).event === 'public')).toBe(false)
  })
  it('rejects missing required dependencies at enable and version/schema mismatches at invocation', async () => {
    const f = await fixture(); const consumer = manifest('example.consumer')
    consumer.contributes.consumes = { services: [{ plugin: 'example.missing', id: 'quick', version: 1, schema: {} }] }
    await f.install(consumer, false)
    await expect(f.service.enable(consumer.id, ['a'])).rejects.toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE' })
    const connectedFixture = await connected()
    await connectedFixture.service.disable(connectedFixture.value.id)
    await expect(connectedFixture.call(connectedFixture.client, 'services.discover')).rejects.toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE' })
  })
  it('terminates cross-plugin service cycles and stops consumer-owned runs when the provider is disabled', async () => {
    const f = await connected()
    f.value.contributes.tasks![0].steps = [{ type: 'service', plugin: f.consumer.id, service: 'quick', version: 1, input: {} }]
    f.consumer.contributes.tasks![0].steps = [{ type: 'service', plugin: f.value.id, service: 'quick', version: 1, input: {} }]
    f.consumer.contributes.consumes!.services![0].optional = true
    await writeFile(join(f.source, 'manifest.json'), JSON.stringify(f.value)); await f.service.reload(f.value.id)
    await writeFile(join(f.consumerSource, 'manifest.json'), JSON.stringify(f.consumer)); await f.service.reload(f.consumer.id)
    await f.service.enable(f.value.id, ['a']); await f.service.enable(f.consumer.id, ['a'])
    const client = await f.page(f.consumer.id)
    const run = await f.call(client, 'services.call', { plugin: f.value.id, service: 'quick', version: 1, input: {} })
    expect((await f.finish(run.result.id)).error).toBe('CYCLE_DETECTED')
  })
  it('enforces the provider concurrency budget for nested service delegates', async () => {
    const f = await connected()
    f.value.contributes.tasks![0].steps = [{ type: 'delay', milliseconds: 900 }]
    f.consumer.contributes.tasks![0].steps = [{ type: 'service', plugin: f.value.id, service: 'quick', version: 1, input: {} }]
    await writeFile(join(f.source, 'manifest.json'), JSON.stringify(f.value)); await f.service.reload(f.value.id); await f.service.enable(f.value.id, ['a'])
    await writeFile(join(f.consumerSource, 'manifest.json'), JSON.stringify(f.consumer)); await f.service.reload(f.consumer.id); await f.service.enable(f.consumer.id, ['a'])
    await Promise.all(Array.from({ length: 4 }, () => f.start('quick')))
    const run = await f.service.backgroundManage({ type: 'taskStart', id: f.consumer.id, task: 'quick', projectId: null, scopePath: null, input: {} }) as { id: string }
    expect((await f.finish(run.id)).error).toBe('RATE_LIMITED')
  })
  it('enforces a nested service deadline while its delay is still pending', async () => {
    const f = await connected()
    f.value.contributes.tasks![0].timeoutMs = 20; f.value.contributes.tasks![0].steps = [{ type: 'delay', milliseconds: 900 }]
    f.consumer.contributes.tasks![0].steps = [{ type: 'service', plugin: f.value.id, service: 'quick', version: 1, input: {} }]
    await writeFile(join(f.source, 'manifest.json'), JSON.stringify(f.value)); await f.service.reload(f.value.id); await f.service.enable(f.value.id, ['a'])
    await writeFile(join(f.consumerSource, 'manifest.json'), JSON.stringify(f.consumer)); await f.service.reload(f.consumer.id); await f.service.enable(f.consumer.id, ['a'])
    const run = await f.service.backgroundManage({ type: 'taskStart', id: f.consumer.id, task: 'quick', projectId: null, scopePath: null, input: {} }) as { id: string }
    await vi.waitFor(() => expect(f.runs().find(item => item.id === run.id)?.state).toBe('timeout'), { timeout: 400, interval: 10 })
  })
  it('bounds root event spam even if a plugin omits continuation provenance', async () => {
    const f = await connected()
    const background = (f.service as any).background
    const identity = (f.service as any).backgroundIdentity(f.value.id, null)
    for (let index = 0; index < 30; index++) background.publish(identity, { event: 'done', data: { message: String(index) } })
    expect(() => background.publish(identity, { event: 'done', data: { message: 'budget' } })).toThrowError(expect.objectContaining({ code: 'RATE_LIMITED' }))
  })
})
