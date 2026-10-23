import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { parsePluginManifest, PLUGIN_CAPABILITIES, type PluginManifest } from '../../packages/plugin-sdk/src'
import { PluginModels, type PluginModelRoute, type PluginModelChunk } from '../../src/main/plugins/models'
import { PluginService } from '../../src/main/plugins/service'

const cleanup: Array<() => unknown> = []
afterEach(async () => { vi.useRealTimers(); for (const close of cleanup.splice(0).reverse()) await close() })
async function manifest(): Promise<PluginManifest> {
  return parsePluginManifest(await readFile('packages/plugin-sdk/examples/p6-model-provider/manifest.json', 'utf8'))
}
function route(change: Partial<PluginModelRoute> = {}): PluginModelRoute {
  return { contextWindow: 16_384, maxOutputTokens: 1024, secrets: ['host-secret-token'], current: async () => true,
    stream: vi.fn(async function* () { yield { type: 'text' as const, text: 'A concise summary.' }; yield { type: 'finish' as const, reason: 'stop', inputTokens: 12, outputTokens: 5 } }), ...change }
}
async function fixture(value = route()) {
  const data = await manifest(); const step = data.contributes.tasks![0].steps[0]
  const backend = { resolve: vi.fn(async () => value) }; const models = new PluginModels(backend)
  const run = (prompt: unknown = 'A long supplied text.', signal = new AbortController().signal) => models.generate(data, step, prompt, () => {}, signal)
  return { data, step, backend, models, run, route: value }
}
async function serviceFixture(value = route()) {
  const directory = await mkdtemp(join(tmpdir(), 'janusx-model-'))
  cleanup.push(() => rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }))
  const root = join(directory, 'root'); await mkdir(root)
  const data = await manifest(); const source = join(directory, 'plugin'); await mkdir(source)
  await writeFile(join(source, 'manifest.json'), JSON.stringify(data))
  const service = new PluginService({ directory: join(directory, 'profile'), modelBackend: { resolve: async () => value },
    resolveProject: async (_id, scope) => ({ root: scope ?? root, name: 'Project' }), changed: vi.fn(), event: vi.fn(), openView: vi.fn(), toast: vi.fn() })
  cleanup.push(() => service.dispose()); await service.initialize(); await service.setDevelopment(true)
  await service.import(source, 'linked'); await service.enable(data.id, ['project']); await service.setContext('project', root, 'en', { id: '', tokens: {} })
  const start = (input = { text: 'Summarize this text.' }) => service.backgroundManage({ type: 'taskStart', id: data.id, task: 'summarize', input, projectId: null, scopePath: null }) as Promise<{ id: string }>
  const finish = async (id: string) => { await vi.waitFor(() => expect(service.snapshot().tasks!.find(run => run.id === id)?.state).not.toBe('running')); return service.snapshot().tasks!.find(run => run.id === id)! }
  return { data, source, root, service, start, finish }
}

describe('P6 model declaration and broker', () => {
  it('requires model capability/permission and a string input, with strict bounded steps', async () => {
    const value = await manifest()
    for (const patch of [{ permissions: value.permissions.filter(item => item.name !== 'models.generate') },
      { capabilities: { ...value.capabilities, required: value.capabilities.required.filter(item => item !== 'models.generate') } }]) {
      expect(() => parsePluginManifest(JSON.stringify({ ...value, ...patch }))).toThrow()
    }
    for (const step of [{ type: 'model', promptInput: 'missing', instruction: 'Summarize', maxOutputTokens: 256 },
      { ...value.contributes.tasks![0].steps[0], provider: 'arbitrary' },
      { ...value.contributes.tasks![0].steps[0], maxOutputTokens: 1025 }]) {
      const changed = structuredClone(value); changed.contributes.tasks![0].steps = [step as any]
      expect(() => parsePluginManifest(JSON.stringify(changed))).toThrow()
    }
    expect(() => parsePluginManifest(JSON.stringify(value), { apiVersion: '1.0.0', capabilities: PLUGIN_CAPABILITIES.filter(item => item !== 'models.generate') })).toThrow()
  })
  it('returns only bounded text and normalized reported usage, without route/config/credentials', async () => {
    const f = await fixture(); const result = await f.run()
    expect(result).toEqual({ text: 'A concise summary.', finishReason: 'stop', usage: { inputTokens: 12, outputTokens: 5 } })
    expect(JSON.stringify(result)).not.toContain('host-secret-token')
    expect(f.route.stream).toHaveBeenCalledWith(expect.any(String), 'A long supplied text.', 256, expect.any(AbortSignal))
  })
  it('refuses missing grants, empty/oversized input, missing backend and unavailable routes before inference', async () => {
    const f = await fixture()
    const denied = { ...f.data, permissions: f.data.permissions.filter(item => item.name !== 'models.generate') }
    await expect(f.models.generate(denied, f.step, 'text', () => {}, new AbortController().signal)).rejects.toMatchObject({ code: 'PERMISSION_DENIED' })
    for (const prompt of ['', ' ', 'x'.repeat(4097), 3]) await expect(f.run(prompt)).rejects.toMatchObject({ code: 'INVALID_REQUEST' })
    await expect(new PluginModels().generate(f.data, f.step, 'text', () => {}, new AbortController().signal)).rejects.toMatchObject({ code: 'MODEL_UNAVAILABLE' })
    const unavailable = new PluginModels({ resolve: async () => null })
    await expect(unavailable.generate(f.data, f.step, 'text', () => {}, new AbortController().signal)).rejects.toMatchObject({ code: 'MODEL_UNAVAILABLE' })
    expect(f.route.stream).not.toHaveBeenCalled()
  })
  it.each([{ contextWindow: 512 }, { maxOutputTokens: 128 }])('refuses insufficient model limits %j', async change => {
    const f = await fixture(route(change)); await expect(f.run()).rejects.toMatchObject({ code: 'MODEL_UNAVAILABLE' }); expect(f.route.stream).not.toHaveBeenCalled()
  })
  it.each(['before', 'after'])('refuses a changed host default %s generation', async when => {
    const current = vi.fn().mockResolvedValueOnce(when !== 'before').mockResolvedValue(false)
    const f = await fixture(route({ current })); await expect(f.run()).rejects.toMatchObject({ code: 'MODEL_UNAVAILABLE' })
    if (when === 'before') expect(f.route.stream).not.toHaveBeenCalled()
  })
  it.each(['bytes', 'tokens', 'chunks', 'incomplete', 'echo', 'error'])('withholds %s responses without exposing provider diagnostics', async kind => {
    const stream = async function* (): AsyncIterable<PluginModelChunk> {
      if (kind === 'error') throw new Error('Authorization host-secret-token https://private.endpoint/')
      if (kind === 'chunks') for (let index = 0; index < 4097; index++) yield { type: 'text', text: '' }
      yield { type: 'text', text: kind === 'bytes' ? '汉'.repeat(6000) : kind === 'echo' ? 'host-secret-token' : 'result' }
      if (kind !== 'incomplete') yield { type: 'finish', reason: 'stop', inputTokens: 2, outputTokens: kind === 'tokens' ? 257 : 2 }
    }
    const f = await fixture(route({ stream }))
    await expect(f.run()).rejects.toMatchObject({ code: ['bytes', 'tokens', 'chunks'].includes(kind) ? 'RATE_LIMITED' : 'MODEL_UNAVAILABLE' })
    try { await f.run() } catch (cause) { expect(String(cause)).not.toMatch(/host-secret-token|private.endpoint/) }
  })
  it('represents unknown usage explicitly, rather than claiming zero tokens', async () => {
    const f = await fixture(route({ stream: async function* () { yield { type: 'finish', reason: 'vendor-specific' } } }))
    expect(await f.run()).toMatchObject({ finishReason: 'other', usage: { inputTokens: null, outputTokens: null } })
  })
  it('propagates cancellation and releases host work even if route resolution ignores abort', async () => {
    const data = await manifest(); const backend = { resolve: vi.fn(async () => new Promise<PluginModelRoute>(() => {})) }
    const models = new PluginModels(backend); const abort = new AbortController()
    const pending = models.generate(data, data.contributes.tasks![0].steps[0], 'text', () => {}, abort.signal)
    const stopped = expect(pending).rejects.toMatchObject({ code: 'CANCELLED' }); abort.abort(); await stopped
    const preaborted = new AbortController(); preaborted.abort()
    await expect(models.generate(data, data.contributes.tasks![0].steps[0], 'text', () => {}, preaborted.signal)).rejects.toMatchObject({ code: 'CANCELLED' })
    backend.resolve.mockResolvedValue(route())
    await expect(models.generate(data, data.contributes.tasks![0].steps[0], 'text', () => {}, new AbortController().signal)).resolves.toMatchObject({ text: 'A concise summary.' })
  })
  it('enforces the 30-second host deadline even during route resolution', async () => {
    const f = await fixture(); vi.useFakeTimers(); f.backend.resolve.mockImplementation(async () => new Promise(() => {}))
    const stopped = expect(f.run()).rejects.toMatchObject({ code: 'TIMEOUT' })
    await vi.advanceTimersByTimeAsync(30_001); await stopped
  })
  it('checks activation after awaited generation before returning results', async () => {
    let active = true
    const f = await fixture(route({ stream: async function* () { yield { type: 'text', text: 'late result' }; active = false; yield { type: 'finish', reason: 'stop' } } }))
    await expect(f.models.generate(f.data, f.step, 'text', () => { if (!active) throw new Error('Stale') }, new AbortController().signal)).rejects.toThrow()
  })
  it('enforces per-plugin rates, global rates and global concurrency', async () => {
    const f = await fixture(); await f.run(); await f.run()
    await expect(f.run()).rejects.toMatchObject({ code: 'RATE_LIMITED' })
    for (let index = 0; index < 6; index++) await f.models.generate({ ...f.data, id: `example.other-${index}` }, f.step, 'text', () => {}, new AbortController().signal)
    await expect(f.models.generate({ ...f.data, id: 'example.ninth' }, f.step, 'text', () => {}, new AbortController().signal)).rejects.toMatchObject({ code: 'RATE_LIMITED' })
    const hanging = new PluginModels({ resolve: async () => new Promise(() => {}) }); const abort = new AbortController()
    const calls = ['example.one', 'example.two'].map(id => hanging.generate({ ...f.data, id }, f.step, 'text', () => {}, abort.signal))
    const stopped = Promise.all(calls.map(call => expect(call).rejects.toThrow()))
    await expect(hanging.generate({ ...f.data, id: 'example.three' }, f.step, 'text', () => {}, abort.signal)).rejects.toMatchObject({ code: 'RATE_LIMITED' })
    await expect(hanging.generate({ ...f.data, id: 'example.one' }, f.step, 'text', () => {}, abort.signal)).rejects.toMatchObject({ code: 'RATE_LIMITED' })
    abort.abort(); await stopped
  })
})

describe('P6 declarative model task integration', () => {
  it('shares the same model task with the host UI and Agent and keeps output ownership separate', async () => {
    const f = await serviceFixture(); const ui = await f.finish((await f.start()).id)
    const agent = await f.service.callAgentService({ workspaceId: 'project', workspaceRoot: f.root }, { plugin: f.data.id, service: 'summarize', version: 1, input: { text: 'Summarize this text.' } }, new AbortController().signal)
    expect(ui.state).toBe('completed'); expect(agent.state).toBe('completed')
    expect(ui.modelResults).toEqual(agent.modelResults); expect(agent.pluginId).toBe('janusx.agent'); expect(agent.id).not.toBe(ui.id)
    expect((await f.finish((await f.start()).id)).error).toBe('RATE_LIMITED')
  })
  it('aborts on provider disable and discards model text already received', async () => {
    let modelSignal: AbortSignal | undefined
    const f = await serviceFixture(route({ stream: async function* (_instruction, _prompt, _maxTokens, signal) {
      modelSignal = signal; yield { type: 'text', text: 'Not yet committed' }; await new Promise(() => {})
    } }))
    const run = await f.start(); await vi.waitFor(() => expect(modelSignal).toBeDefined())
    await f.service.disable(f.data.id)
    expect(modelSignal!.aborted).toBe(true)
    const result = await f.finish(run.id); expect(result.state).toBe('cancelled'); expect(result.modelResults).toBeUndefined()
  })
  it('requires renewed authorization when an existing task adds model access', async () => {
    const f = await serviceFixture(); const initial = structuredClone(f.data)
    initial.permissions = initial.permissions.filter(item => item.name !== 'models.generate')
    initial.capabilities.required = initial.capabilities.required.filter(item => item !== 'models.generate')
    initial.contributes.tasks![0].steps = [{ type: 'log', message: 'No model access' }]
    await writeFile(join(f.source, 'manifest.json'), JSON.stringify(initial)); await f.service.reload(initial.id); await f.service.enable(initial.id, ['project'])
    await writeFile(join(f.source, 'manifest.json'), JSON.stringify(f.data)); await f.service.reload(initial.id)
    expect(f.service.snapshot().plugins[0].error).toBe('PERMISSION_RECONFIRM_REQUIRED')
    await expect(f.start()).rejects.toThrow()
  })
})
