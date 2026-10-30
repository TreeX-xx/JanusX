import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink, link } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { WorkspaceAgentRuntime } from '@janus-agent/agent-core'
import { parsePluginManifest, PLUGIN_CAPABILITIES, createPluginClient, type PluginManifest } from '../../packages/plugin-sdk/src'
import { PluginService } from '../../src/main/plugins/service'
import { registerPluginTools } from '../../src/main/agent/runtime/tools/plugin-tools'

const cleanup: Array<() => unknown> = []
afterEach(async () => { vi.restoreAllMocks(); for (const close of cleanup.splice(0).reverse()) await close() })
const signal = () => new AbortController().signal
const manifest = async () => parsePluginManifest(await readFile('packages/plugin-sdk/examples/p6-context-provider/manifest.json', 'utf8'))
async function fixture(data?: PluginManifest, protectedPath?: string) {
  data ??= await manifest()
  const directory = await mkdtemp(join(tmpdir(), 'janusx-context-'))
  cleanup.push(() => rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }))
  const root = join(directory, 'root'); const other = join(directory, 'other'); await mkdir(root); await mkdir(other)
  await writeFile(join(root, 'README.md'), 'Saved project reference 汉字')
  const service = new PluginService({ directory: join(directory, 'profile'), protectedDirectories: protectedPath ? [join(root, protectedPath)] : [],
    resolveProject: async (_id, scope) => ({ root: scope ?? root, name: 'Project' }), changed: vi.fn(), event: vi.fn(), openView: vi.fn(), toast: vi.fn() })
  cleanup.push(() => service.dispose()); await service.initialize(); await service.setDevelopment(true)
  const install = async (value: PluginManifest) => {
    const source = join(directory, value.id); await mkdir(source); await writeFile(join(source, 'manifest.json'), JSON.stringify(value))
    if (value.contributes.views.length) { await mkdir(join(source, 'dist')); await writeFile(join(source, 'dist/index.html'), '<p>Context</p>') }
    await service.import(source, 'linked'); await service.enable(value.id, ['project']); return source
  }
  const source = await install(data); await service.setContext('project', root, 'en', { id: '', tokens: {} })
  const context = { workspaceId: 'project', workspaceRoot: root }
  const catalog = await service.discoverDocumentContexts(context, signal()); const found = catalog.providers[0]
  const request = { plugin: data.id, provider: found.provider, version: found.version, revision: found.revision }
  const read = (input: unknown = request, abort: AbortSignal = signal()) => service.readDocumentContext(context, input, abort)
  const mount = async (id = data.id, view = 'details') => { const page = await service.mount(id, view, 'project', root); service.bind(page.instanceId, page.binding); return page }
  const call = (page: Awaited<ReturnType<typeof mount>>, method: string, params: unknown = {}) => service.call(page.instanceId, page.binding,
    { protocol: 1, type: 'request', requestId: crypto.randomUUID(), method, params, contextRevision: page.context.revision }) as Promise<any>
  return { data, directory, root, other, service, source, context, catalog, found, request, read, mount, call, install }
}

describe('P6 document context providers', () => {
  it('requires explicit capabilities, both grants and an exact authorized path', async () => {
    const data = await manifest()
    for (const value of [
      { ...data, capabilities: { ...data.capabilities, required: ['files.readText'] } },
      { ...data, capabilities: { ...data.capabilities, required: ['agent.context'] } },
      { ...data, permissions: data.permissions.filter(item => item.name !== 'agent.context') },
      { ...data, permissions: data.permissions.filter(item => item.name !== 'workspace.files.read') },
      { ...data, permissions: [{ name: 'agent.context' }, { name: 'workspace.files.read', paths: ['other.md'] }] },
    ]) expect(() => parsePluginManifest(JSON.stringify(value))).toThrow()
    expect(() => parsePluginManifest(JSON.stringify(data), { apiVersion: '1.0.0', capabilities: PLUGIN_CAPABILITIES.filter(item => item !== 'agent.context') })).toThrow()
  })
  it.each(['../README.md', '/README.md', 'a\\README.md', '.env', '.git/config', 'private.pem'])('rejects invalid or sensitive declaration %s', async path => {
    const data = await manifest(); data.contributes.contextProviders![0].path = path
    expect(() => parsePluginManifest(JSON.stringify(data))).toThrow()
  })
  it('rejects duplicate, executable, blank or unbounded provider declarations', async () => {
    for (const kind of ['duplicate', 'executable', 'blank', 'count', 'version']) {
      const data = await manifest(); const provider = data.contributes.contextProviders![0]
      if (kind === 'duplicate') data.contributes.contextProviders!.push(provider)
      if (kind === 'executable') Object.assign(provider, { entry: 'provider.js' })
      if (kind === 'blank') provider.description = ' '
      if (kind === 'count') data.contributes.contextProviders = Array.from({ length: 9 }, (_, i) => ({ ...provider, id: `file-${i}` }))
      if (kind === 'version') provider.version = 0
      expect(() => parsePluginManifest(JSON.stringify(data))).toThrow()
    }
  })
  it('discovers only metadata without opening missing files or starting tasks/pages', async () => {
    const f = await fixture(); await rm(join(f.root, 'README.md'))
    const spy = vi.spyOn(f.service as any, 'readText')
    expect(await f.service.discoverDocumentContexts(f.context, signal())).toEqual(f.catalog)
    expect(spy).not.toHaveBeenCalled(); expect(f.found).not.toHaveProperty('text')
    await expect(f.read()).rejects.toMatchObject({ code: 'FILE_NOT_FOUND' })
    expect(f.service.snapshot().tasks).toEqual([]); expect(f.service.snapshot().plugins[0].runtime?.pages).toBe(0)
  })
  it('returns saved UTF-8 text, exact byte/hash provenance and fresh content on each read', async () => {
    const f = await fixture(); const text = 'Saved project reference 汉字'
    const result = await f.read()
    expect(result).toEqual({ ...f.found, trust: 'untrusted-plugin-content', text, bytes: Buffer.byteLength(text), documentVersion: createHash('sha256').update(text).digest('hex') })
    await writeFile(join(f.root, 'README.md'), 'Updated saved reference')
    const changed = await f.read(); expect(changed.text).toBe('Updated saved reference'); expect(changed.documentVersion).not.toBe(result.documentVersion)
    expect(JSON.stringify(result)).not.toContain(f.root)
  })
  it('permits explicit inspect reads in plan mode without approving or invoking services', async () => {
    const f = await fixture(); const runtime = new WorkspaceAgentRuntime(async () => f.root); registerPluginTools(runtime.registry, () => f.service)
    const session = await runtime.createSession({ ...f.context, approvalMode: 'plan' }); const approvals = vi.fn()
    runtime.onEvent(event => { if (event.type === 'approval-requested') approvals() })
    const execute = (toolName: string, input: unknown) => runtime.executeTool({ sessionId: session.id, call: { toolName, input } })
    expect(await execute('plugin.contexts', {})).toMatchObject({ status: 'completed', output: f.catalog })
    expect(await execute('plugin.read-context', f.request)).toMatchObject({ status: 'completed', output: { text: 'Saved project reference 汉字' } })
    expect(approvals).not.toHaveBeenCalled(); expect(f.service.snapshot().tasks).toEqual([])
  })
  it('shares the same contract with SDK pages while denying cross-plugin and application-page reads', async () => {
    const data = await manifest(); data.contributes.views = [
      { id: 'details', title: 'Reference', entry: 'dist/index.html', scope: 'project', location: 'workspace', instancePolicy: 'single' },
      { id: 'app', title: 'Application', entry: 'dist/index.html', scope: 'application', location: 'right', instancePolicy: 'single' },
    ]
    const f = await fixture(data); const page = await f.mount()
    const channel = new MessageChannel(); const client = createPluginClient(channel.port1, page.context.revision)
    channel.port2.onmessage = async event => { const result = await f.service.call(page.instanceId, page.binding, event.data); if (result) channel.port2.postMessage({ ...result, contextRevision: page.context.revision }) }
    cleanup.push(() => { client.close(); channel.port2.close() })
    expect(await client.api.context.providers()).toEqual(f.catalog)
    expect(await client.api.context.read(f.request)).toEqual(await f.read())
    expect(await f.call(page, 'context.read', { ...f.request, plugin: 'example.other' })).toMatchObject({ ok: false, error: { code: 'PERMISSION_DENIED' } })
    const app = await f.service.mount(data.id, 'app', null, null); f.service.bind(app.instanceId, app.binding)
    expect(await f.call(app, 'context.read', f.request)).toMatchObject({ ok: false, error: { code: 'CONTEXT_UNAVAILABLE' } })
  })
  it('rejects wrong version/revision/provider or caller-supplied paths and content', async () => {
    const f = await fixture()
    for (const request of [{ ...f.request, version: 2 }, { ...f.request, revision: '0'.repeat(64) }, { ...f.request, provider: 'missing' },
      { ...f.request, path: 'other.md' }, { ...f.request, text: 'injected' }]) await expect(f.read(request)).rejects.toThrow()
  })
  it('binds discovery and reads to the current worktree with all-workspace authorization', async () => {
    const f = await fixture()
    for (const context of [{ ...f.context, workspaceRoot: f.other }, { ...f.context, workspaceId: 'other' }]) {
      await expect(f.service.discoverDocumentContexts(context, signal())).rejects.toThrow()
      await expect(f.service.readDocumentContext(context, f.request, signal())).rejects.toThrow()
    }
    await f.service.enable(f.data.id, [])
    expect((await f.service.discoverDocumentContexts(f.context, signal())).providers).toHaveLength(1)
    await f.read()
    await f.service.disable(f.data.id)
    expect((await f.service.discoverDocumentContexts(f.context, signal())).providers).toEqual([])
    await expect(f.read()).rejects.toThrow()
  })
  it.each(['disable', 'development', 'uninstall'])('revokes new reads and metadata on %s', async kind => {
    const f = await fixture()
    if (kind === 'disable') await f.service.disable(f.data.id)
    if (kind === 'development') await f.service.setDevelopment(false)
    if (kind === 'uninstall') await f.service.uninstall(f.data.id)
    expect((await f.service.discoverDocumentContexts(f.context, signal())).providers).toEqual([]); await expect(f.read()).rejects.toThrow()
  })
  it('requires reauthorization when only the provider file changes and rejects stale discovery', async () => {
    const f = await fixture(); const second = { ...f.data.contributes.contextProviders![0], path: 'other.md' }
    const value = structuredClone(f.data); value.contributes.contextProviders = [second]
    value.permissions = [{ name: 'agent.context' }, { name: 'workspace.files.read', paths: ['README.md', 'other.md'] }]
    // Grant both paths first, then change only the provider mapping.
    await writeFile(join(f.source, 'manifest.json'), JSON.stringify(value)); await f.service.reload(f.data.id); await f.service.enable(f.data.id, ['project'])
    const before = (await f.service.discoverDocumentContexts(f.context, signal())).providers[0]
    value.contributes.contextProviders![0].path = 'README.md'
    await writeFile(join(f.source, 'manifest.json'), JSON.stringify(value)); await f.service.reload(f.data.id)
    expect(f.service.snapshot().plugins[0].error).toBe('PERMISSION_RECONFIRM_REQUIRED')
    await expect(f.read()).rejects.toThrow(); await f.service.enable(f.data.id, ['project'])
    await expect(f.read({ ...f.request, revision: before.revision })).rejects.toMatchObject({ code: 'STALE_CONTEXT' })
  })
  it.each(['reactivate', 'worktree', 'cancel', 'timeout'])('discards late file content after %s', async kind => {
    const f = await fixture(); const abort = new AbortController(); const original = (f.service as any).readText.bind(f.service)
    vi.spyOn(f.service as any, 'readText').mockImplementation(async (...args) => {
      const result = await original(...args)
      if (kind === 'reactivate') { await f.service.disable(f.data.id); await f.service.enable(f.data.id, ['project']) }
      if (kind === 'worktree') await f.service.setContext('project', f.other, 'en', { id: '', tokens: {} })
      if (kind === 'cancel') abort.abort()
      if (kind === 'timeout') { const now = Date.now(); vi.spyOn(Date, 'now').mockReturnValue(now + 10_001) }
      return result
    })
    await expect(f.read(f.request, abort.signal)).rejects.toMatchObject({ code: kind === 'cancel' ? 'CANCELLED' : kind === 'timeout' ? 'TIMEOUT' : 'STALE_CONTEXT' })
    expect(JSON.stringify(f.service.snapshot().logs)).not.toContain('Saved project reference 汉字')
  })
  it('rejects reactivation during asynchronous workspace validation', async () => {
    const f = await fixture(); const original = (f.service as any).agentContext.bind(f.service)
    vi.spyOn(f.service as any, 'agentContext').mockImplementation(async (...args) => { const valid = await original(...args); await f.service.disable(f.data.id); await f.service.enable(f.data.id, ['project']); return valid })
    await expect(f.read()).rejects.toMatchObject({ code: 'STALE_CONTEXT' })
  })
  it('honors pre-abort without file IO', async () => {
    const f = await fixture(); const abort = new AbortController(); abort.abort(); const spy = vi.spyOn(f.service as any, 'readText')
    await expect(f.read(f.request, abort.signal)).rejects.toMatchObject({ code: 'CANCELLED' })
    await expect(f.service.discoverDocumentContexts(f.context, abort.signal)).rejects.toMatchObject({ code: 'CANCELLED' }); expect(spy).not.toHaveBeenCalled()
  })
  it('withholds absolute paths in unexpected filesystem errors', async () => {
    const f = await fixture(); vi.spyOn(f.service as any, 'readText').mockRejectedValue(new Error(`EIO: ${f.root}/README.md`))
    await expect(f.read()).rejects.toMatchObject({ code: 'INTERNAL_ERROR', message: 'Document context is unavailable.' })
  })
  it('discards page results when the caller cancels during a file read', async () => {
    const data = await manifest(); data.contributes.views = [{ id: 'details', title: 'Reference', entry: 'dist/index.html', scope: 'project', location: 'workspace', instancePolicy: 'single' }]
    const f = await fixture(data); const page = await f.mount(); const original = (f.service as any).readText.bind(f.service)
    vi.spyOn(f.service as any, 'readText').mockImplementation(async (...args) => { const result = await original(...args); await f.service.call(page.instanceId, page.binding, { protocol: 1, type: 'cancel', requestId: 'reading' }); return result })
    expect(await f.service.call(page.instanceId, page.binding, { protocol: 1, type: 'request', requestId: 'reading', method: 'context.read', params: f.request, contextRevision: page.context.revision }))
      .toMatchObject({ ok: false, error: { code: 'CANCELLED' } })
  })
  it.each(['oversize', 'binary', 'invalid-utf8', 'response-budget', 'hardlink', 'junction', 'protected'])('rejects %s resources without returning content', async kind => {
    const data = await manifest()
    if (kind === 'junction') { data.contributes.contextProviders![0].path = 'linked/README.md'; data.permissions = [{ name: 'agent.context' }, { name: 'workspace.files.read', paths: ['linked/README.md'] }] }
    const f = await fixture(data, kind === 'protected' ? 'README.md' : undefined); const path = join(f.root, 'README.md')
    if (kind === 'oversize') await writeFile(path, 'x'.repeat(32 * 1024 + 1))
    if (kind === 'binary') await writeFile(path, Buffer.from([0, 1]))
    if (kind === 'invalid-utf8') await writeFile(path, Buffer.from([0xff]))
    if (kind === 'response-budget') await writeFile(path, '\t'.repeat(32 * 1024))
    if (kind === 'hardlink') await link(path, join(f.root, 'hard.md'))
    if (kind === 'junction') {
      await writeFile(join(f.other, 'README.md'), 'Outside secret')
      await symlink(f.other, join(f.root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir')
    }
    await expect(f.read()).rejects.toMatchObject({ code: kind === 'oversize' ? 'FILE_TOO_LARGE' : kind === 'binary' || kind === 'invalid-utf8' ? 'NOT_TEXT' : kind === 'response-budget' ? 'RATE_LIMITED' : kind === 'protected' ? 'SENSITIVE_PATH_DENIED' : 'INVALID_PACKAGE_PATH' })
  })
  it('bounds shared IO concurrency and frequency and releases slots on failure', async () => {
    const f = await fixture(); const original = (f.service as any).readText.bind(f.service); let release!: () => void
    const pending = new Promise<void>(resolve => { release = resolve })
    const spy = vi.spyOn(f.service as any, 'readText').mockImplementation(async (...args) => { await pending; return original(...args) })
    const reads = Array.from({ length: 4 }, () => f.read()); await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(4))
    await expect(f.read()).rejects.toMatchObject({ code: 'RATE_LIMITED' }); release(); await Promise.all(reads); spy.mockRestore()
    for (let n = 4; n < 60; n++) await f.read()
    await expect(f.read()).rejects.toMatchObject({ code: 'RATE_LIMITED' })
    const now = Date.now(); vi.spyOn(Date, 'now').mockReturnValue(now + 60_001); expect((await f.read()).bytes).toBeGreaterThan(0)
  })
  it('bounds catalog count with explicit truncation, including absent files', async () => {
    const f = await fixture()
    for (let i = 0; i < 4; i++) {
      const data = await manifest(); data.id = `example.context-${i}`; data.contributes.contextProviders = Array.from({ length: 8 }, (_, n) => ({ ...data.contributes.contextProviders![0], id: `doc-${n}` })); await f.install(data)
    }
    const found = await f.service.discoverDocumentContexts(f.context, signal()); expect(found.providers).toHaveLength(32); expect(found.truncated).toBe(true)
    expect(JSON.stringify(found)).not.toContain('Saved project reference 汉字')
  })
})
