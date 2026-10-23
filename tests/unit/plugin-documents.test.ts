import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parsePluginManifest, matchesPluginViewer, validatePluginCall, type PluginManifest } from '../../packages/plugin-sdk/src/index'
import { PluginService } from '../../src/main/plugins/service'
import { documentViewerCandidates, documentPreferenceKey, readDocumentViewerDefault, saveDocumentViewerDefault } from '../../src/renderer/src/extensions/document-viewers'

const cleanups: Array<() => unknown> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); vi.unstubAllGlobals() })
async function manifest(): Promise<PluginManifest> {
  const value = JSON.parse(await readFile('packages/plugin-sdk/template/manifest.json', 'utf8'))
  value.permissions.push({ name: 'documents.read' })
  value.capabilities.required.push('documents.viewers', 'documents.readText')
  value.contributes.viewers = [{ id: 'text', title: 'Text preview', view: 'details', extensions: ['.txt'], filenames: ['Makefile'] }]
  return parsePluginManifest(JSON.stringify(value))
}
async function fixture(editing = false) {
  const directory = await mkdtemp(join(tmpdir(), 'janusx-p4-unit-'))
  cleanups.push(() => rm(directory, { recursive: true, force: true }))
  const source = join(directory, 'source'); const root = join(directory, 'project'); const other = join(directory, 'other')
  await mkdir(join(source, 'dist'), { recursive: true }); await mkdir(root); await mkdir(other)
  const value = await manifest()
  if (editing) { value.permissions.push({ name: 'documents.edit' }); value.capabilities.required.push('documents.applyEdit') }
  await writeFile(join(source, 'manifest.json'), JSON.stringify(value))
  await writeFile(join(source, 'dist/index.html'), '<p>viewer</p>'); await writeFile(join(source, 'dist/summary.html'), '<p>summary</p>')
  await writeFile(join(root, 'a.txt'), 'file A'); await writeFile(join(root, 'b.txt'), 'file B')
  const deps = { directory: join(directory, 'profile'), resolveProject: async (id: string) => ({ root: id === 'a' ? root : other, name: id }),
    changed: vi.fn(), event: vi.fn(), openView: vi.fn(), toast: vi.fn() }
  const service = new PluginService(deps)
  cleanups.push(() => service.dispose())
  await service.initialize(); await service.import(source, 'linked'); await service.setDevelopment(true); await service.enable(value.id, ['a', 'b'])
  await service.setContext('a', root, 'en', { id: 'dark', tokens: {} })
  const mount = async (path?: string) => {
    const page = await service.mount(value.id, 'details', 'a', root, path ? { viewer: 'text', path } : undefined)
    service.bind(page.instanceId, page.binding); return page
  }
  let sequence = 0
  const call = (page: Awaited<ReturnType<typeof mount>>, method = 'documents.readText', params = {}) => service.call(page.instanceId, page.binding,
    { protocol: 1, type: 'request', requestId: String(++sequence), method, params, contextRevision: page.context.revision }) as Promise<any>
  return { service, source, root, other, value, mount, call, deps }
}

describe('P4 read-only document viewers', () => {
  it('requires explicit editing permission, capability and a document binding', async () => {
    const value = await manifest()
    const params = { text: 'draft', expectedVersion: 'a'.repeat(64) }
    expect(() => validatePluginCall(value, 'documents.applyEdit', params)).toThrow()
    value.permissions.push({ name: 'documents.edit' })
    expect(() => parsePluginManifest(JSON.stringify(value))).toThrow()
    value.capabilities.required.push('documents.applyEdit')
    expect(parsePluginManifest(JSON.stringify(value)).permissions).toContainEqual({ name: 'documents.edit' })
    for (const invalid of [{ ...params, path: 'b.txt' }, { ...params, text: '\0' }, { ...params, text: '汉'.repeat(400000) }, { ...params, expectedVersion: 'stale' }]) {
      expect(() => validatePluginCall(value, 'documents.applyEdit', invalid)).toThrow()
    }
    const f = await fixture(true); const normal = await f.mount()
    expect(await f.call(normal, 'documents.applyEdit', params)).toMatchObject({ ok: false, error: { code: 'CONTEXT_UNAVAILABLE' } })
  })
  it('waits for host acceptance and never writes the file when applying a draft', async () => {
    const f = await fixture(true); const page = await f.mount('a.txt'); const other = await f.mount('b.txt')
    expect(page.context.document?.editable).toBe(true)
    const { result } = await f.call(page)
    f.deps.event.mockImplementation((instanceId, packet: any) => {
      if (packet.type !== 'documentEdit') return
      expect(instanceId).toBe(page.instanceId)
      expect(packet).toMatchObject({ path: 'a.txt', baseText: 'file A', text: 'my draft', version: result.version })
      expect(() => f.service.documentEditResult(other.instanceId, other.binding, packet.editId, true)).toThrow()
      f.service.documentEditResult(page.instanceId, page.binding, packet.editId, true)
    })
    expect(await f.call(page, 'documents.applyEdit', { text: 'my draft', expectedVersion: result.version })).toMatchObject({ ok: true, result: { applied: true } })
    expect(await readFile(join(f.root, 'a.txt'), 'utf8')).toBe('file A')
    await writeFile(join(f.root, 'a.txt'), 'external change')
    expect(await f.call(page, 'documents.applyEdit', { text: 'lost update', expectedVersion: result.version })).toMatchObject({ ok: false, error: { code: 'DOCUMENT_CONFLICT' } })
  })
  it.each(['reject', 'close', 'cancel'] as const)('handles %s while a host draft is pending', async action => {
    const f = await fixture(true); const page = await f.mount('a.txt'); const { result } = await f.call(page)
    f.deps.event.mockImplementation((_id, packet: any) => {
      if (packet.type !== 'documentEdit') return
      if (action === 'close') f.service.close(page.instanceId)
      else if (action === 'reject') f.service.documentEditResult(page.instanceId, page.binding, packet.editId, false)
      else {
        void f.service.call(page.instanceId, page.binding, { protocol: 1, type: 'cancel', requestId: '2' })
        expect(() => f.service.documentEditResult(page.instanceId, page.binding, packet.editId, true)).toThrow()
      }
    })
    expect(await f.call(page, 'documents.applyEdit', { text: 'draft', expectedVersion: result.version })).toMatchObject({ ok: false })
    expect(await readFile(join(f.root, 'a.txt'), 'utf8')).toBe('file A')
  })
  it('validates selectors, scope, references, required capabilities and permission', async () => {
    const value = await manifest()
    for (const mutate of [
      (m: PluginManifest) => { m.contributes.viewers![0].view = 'missing' },
      (m: PluginManifest) => { m.contributes.viewers![0].view = 'summary' },
      (m: PluginManifest) => { m.contributes.views[0].scope = 'application' },
      (m: PluginManifest) => { m.contributes.viewers![0].extensions = ['*'] },
      (m: PluginManifest) => { m.contributes.viewers![0].filenames = ['../secret'] },
      (m: PluginManifest) => { m.permissions = m.permissions.filter(p => p.name !== 'documents.read') },
      (m: PluginManifest) => { m.capabilities.required = m.capabilities.required.filter(c => c !== 'documents.viewers') },
      (m: PluginManifest) => { m.contributes.viewers!.push(m.contributes.viewers![0]) },
    ]) { const copy = structuredClone(value); mutate(copy); expect(() => parsePluginManifest(JSON.stringify(copy))).toThrow() }
    expect(() => parsePluginManifest(JSON.stringify(value), { apiVersion: '1.0.0', capabilities: ['views.workspace'] })).toThrow()
  })
  it('matches explicit case-insensitive suffixes and filenames while rejecting sensitive/traversal paths', async () => {
    const viewer = (await manifest()).contributes.viewers![0]
    for (const path of ['dir/A.TXT', 'Makefile', 'build/MAKEFILE']) expect(matchesPluginViewer(viewer, path)).toBe(true)
    for (const path of ['a.txt.js', '../a.txt', '.env.txt', 'C:/a.txt', 'dir\\a.txt', '.git/config.txt']) expect(matchesPluginViewer(viewer, path)).toBe(false)
  })
  it('binds each file separately, keeps regular view identity and prevents duplicate document instances', async () => {
    const f = await fixture(); const first = await f.mount('a.txt'); const second = await f.mount('b.txt'); const regular = await f.mount()
    expect(new Set([first.instanceId, second.instanceId, regular.instanceId]).size).toBe(3)
    expect(first.context.document).toEqual({ path: 'a.txt', viewer: 'text' })
    expect(await f.call(first)).toMatchObject({ ok: true, result: { path: 'a.txt', text: 'file A', bytes: 6, version: expect.stringMatching(/^[a-f0-9]{64}$/) } })
    expect(await f.call(second)).toMatchObject({ ok: true, result: { path: 'b.txt', text: 'file B' } })
    expect(await f.call(regular)).toMatchObject({ ok: false, error: { code: 'CONTEXT_UNAVAILABLE' } })
    await expect(f.mount('a.txt')).rejects.toMatchObject({ code: 'INVALID_REQUEST' })
    expect(await f.call(first, 'documents.readText', { path: 'b.txt' })).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } })
    expect(await f.call(first, 'workspace.readText', { path: 'b.txt' })).toMatchObject({ ok: false, error: { code: 'PATH_NOT_GRANTED' } })
    f.service.close(first.instanceId)
    expect(await f.call(second)).toMatchObject({ ok: true, result: { text: 'file B' } })
  })
  it('checks file existence, UTF-8, size, selectors and real filesystem boundaries before mounting', async () => {
    const f = await fixture()
    await writeFile(join(f.root, 'binary.txt'), Buffer.from([0, 255]))
    await writeFile(join(f.root, 'large.txt'), 'x'.repeat(1024 * 1024 + 1))
    await symlink(f.other, join(f.root, 'linked'), 'junction')
    await writeFile(join(f.other, 'outside.txt'), 'outside')
    for (const path of ['missing.txt', 'binary.txt', 'large.txt', 'a.json', '../outside.txt', 'linked/outside.txt', '.env.txt']) await expect(f.mount(path)).rejects.toThrow()
    expect(f.service.snapshot().plugins[0].runtime?.pages).toBe(0)
  })
  it('reads external updates with a new version and revokes old document requests after project switch', async () => {
    const f = await fixture(); const first = await f.mount('a.txt')
    const before = await f.call(first)
    await writeFile(join(f.root, 'a.txt'), 'updated')
    const after = await f.call(first)
    expect(after.result.text).toBe('updated'); expect(after.result.version).not.toBe(before.result.version)
    await f.service.setContext('b', f.other, 'en', { id: 'dark', tokens: {} })
    await expect(f.call(first)).rejects.toMatchObject({ code: 'INSTANCE_CLOSED' })
  })
  it('requires reconfirmation when viewer file selectors change', async () => {
    const f = await fixture(); await f.mount('a.txt')
    f.value.contributes.viewers![0].extensions.push('.log')
    await writeFile(join(f.source, 'manifest.json'), JSON.stringify(f.value)); await f.service.reload(f.value.id, true)
    expect(f.service.snapshot().plugins[0]).toMatchObject({ state: 'blocked', error: 'PERMISSION_RECONFIRM_REQUIRED', runtime: { pages: 0 } })
  })
  it.each(['project', 'reload'] as const)('rejects an unfinished document mount after %s changes', async change => {
    const f = await fixture()
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    f.deps.resolveProject = async id => { if (id === 'a') await gate; return { root: id === 'a' ? f.root : f.other, name: id } }
    const mounting = f.mount('a.txt')
    // Observe rejection before releasing the deterministic checkpoint.
    const rejected = expect(mounting).rejects.toMatchObject({ code: 'STALE_CONTEXT' })
    if (change === 'project') await f.service.setContext('b', f.other, 'en', { id: 'dark', tokens: {} })
    else await f.service.reload(f.value.id, true)
    release(); await rejected
    expect(f.service.snapshot().plugins[0].runtime?.pages).toBe(0)
  })
  it('keeps document reading a separately declared permission', async () => {
    const value = await manifest(); value.permissions = value.permissions.filter(p => p.name !== 'documents.read')
    expect(() => validatePluginCall(value, 'documents.readText', {})).toThrow()
  })
  it('filters choices by enabled state, grants, development mode and selectors', async () => {
    const f = await fixture(); const snapshot = f.service.snapshot()
    expect(documentViewerCandidates(snapshot, 'a', 'a.txt')).toHaveLength(1)
    expect(documentViewerCandidates(snapshot, 'ungranted', 'a.txt')).toEqual([])
    expect(documentViewerCandidates(snapshot, 'a', 'a.json')).toEqual([])
    await f.service.disable(f.value.id)
    expect(documentViewerCandidates(f.service.snapshot(), 'a', 'a.txt')).toEqual([])
    snapshot.developmentMode = false
    expect(documentViewerCandidates(snapshot, 'a', 'a.txt')).toEqual([])
  })
  it('persists and resets defaults by file type, handles corrupt data and reports storage failure', () => {
    const data = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value) })
    expect(documentPreferenceKey('folder/A.TXT')).toBe('extension:.txt')
    expect(documentPreferenceKey('Makefile')).toBe('filename:makefile')
    expect(readDocumentViewerDefault('a.txt')).toBe('builtin')
    saveDocumentViewerDefault('a.txt', 'example.test/text')
    expect(readDocumentViewerDefault('other/B.TXT')).toBe('example.test/text')
    saveDocumentViewerDefault('a.txt', 'builtin')
    expect(readDocumentViewerDefault('a.txt')).toBe('builtin')
    data.set('janusx.document-viewers.v1', '{bad')
    expect(readDocumentViewerDefault('a.txt')).toBe('builtin')
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => { throw new Error('full') } })
    expect(() => saveDocumentViewerDefault('a.txt', 'other/text')).toThrow('full')
    expect(readDocumentViewerDefault('a.txt')).toBe('builtin')
  })
})
