import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parsePluginManifest, validatePluginCall } from '../../packages/plugin-sdk/src'
import { PluginService } from '../../src/main/plugins/service'
import { extensionRegistry } from '../../src/renderer/src/extensions/registry'
import { createExtensionPaneContent, isAvailableExtensionPane } from '../../src/renderer/src/lib/workspace-pane'

const cleanup: Array<() => unknown> = []
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn() })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'janusx-instances-'))
  cleanup.push(() => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }))
  const source = join(root, 'plugin'); await mkdir(join(source, 'dist'), { recursive: true })
  const manifest = JSON.parse(await readFile('packages/plugin-sdk/template/manifest.json', 'utf8'))
  manifest.capabilities.required.push('views.multiple'); manifest.contributes.views[0].instancePolicy = 'multiple'
  await writeFile(join(source, 'manifest.json'), JSON.stringify(manifest))
  await writeFile(join(source, 'dist/index.html'), '<p>multiple</p>'); await writeFile(join(source, 'dist/summary.html'), '<p>single</p>')
  const openView = vi.fn()
  const resolveProject = vi.fn(async () => ({ root, name: 'Project' }))
  const service = new PluginService({ directory: join(root, 'profile'), resolveProject, changed() {}, event() {}, openView, toast() {} })
  cleanup.push(() => service.dispose())
  await service.initialize(); await service.import(source, 'linked'); await service.setDevelopment(true); await service.enable(manifest.id, ['p'])
  await service.setContext('p', root, 'en', { id: 'dark', tokens: {} })
  const mount = async (key: string) => { const page = await service.mount(manifest.id, 'details', 'p', root, undefined, key); service.bind(page.instanceId, page.binding); return page }
  return { root, manifest, service, mount, openView, resolveProject }
}
describe('P4 general workspace instances', () => {
  it('waits for a superseding context resolution before allowing the renderer to mount', async () => {
    const f = await fixture()
    let first!: (value: { root: string; name: string }) => void
    let second!: (value: { root: string; name: string }) => void
    f.resolveProject.mockImplementationOnce(() => new Promise(resolve => { first = resolve }))
      .mockImplementationOnce(() => new Promise(resolve => { second = resolve }))
    let settled = false
    const older = f.service.setContext('p', `${f.root}/new-selection`, 'en', { id: 'dark', tokens: {} }).then(() => { settled = true })
    const newer = f.service.setContext('p', `${f.root}/new-selection`, 'en', { id: 'planche', tokens: {} })
    first({ root: f.root, name: 'Project' }); await new Promise(resolve => setImmediate(resolve))
    expect(settled).toBe(false)
    second({ root: f.root, name: 'Project' }); await Promise.all([older, newer])
    expect((await f.mount('ready')).context.project?.projectId).toBe('p')
  })
  it('propagates a superseding resolution failure and permits a later retry', async () => {
    const f = await fixture()
    let first!: (value: { root: string; name: string }) => void
    let fail!: (reason: Error) => void
    f.resolveProject.mockImplementationOnce(() => new Promise(resolve => { first = resolve }))
      .mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject }))
    const older = f.service.setContext('p', `${f.root}/retry`, 'en', { id: 'dark', tokens: {} })
    const newer = f.service.setContext('p', `${f.root}/retry`, 'en', { id: 'dark', tokens: {} })
    const results = Promise.allSettled([older, newer])
    first({ root: f.root, name: 'Project' }); await new Promise(resolve => setImmediate(resolve))
    fail(new Error('Resolution failed'))
    expect((await results).map(result => result.status)).toEqual(['rejected', 'rejected'])
    await expect(f.mount('unavailable')).rejects.toMatchObject({ code: 'CONTEXT_UNAVAILABLE' })
    await f.service.setContext('p', f.root, 'en', { id: 'dark', tokens: {} })
    expect((await f.mount('recovered')).context.project?.projectId).toBe('p')
  })
  it('requires the multi-instance capability and limits it to workspace pages', async () => {
    const f = await fixture()
    const data = parsePluginManifest(JSON.stringify(f.manifest))
    expect(() => validatePluginCall(data, 'views.open', { view: 'summary', instanceKey: 'one' })).toThrow()
    expect(() => validatePluginCall(data, 'views.open', { view: 'details', instanceKey: '../one' })).toThrow()
    data.contributes.views[0].location = 'right'
    expect(() => parsePluginManifest(JSON.stringify(data))).toThrow()
    data.contributes.views[0].location = 'workspace'; data.capabilities.required = data.capabilities.required.filter(item => item !== 'views.multiple')
    expect(() => parsePluginManifest(JSON.stringify(data))).toThrow()
  })
  it('separates keys, rejects duplicates and preserves the key when reopening after cleanup', async () => {
    const f = await fixture(); const first = await f.mount('one'); const second = await f.mount('two')
    expect(first.instanceId).not.toBe(second.instanceId); expect(first.context.instanceKey).toBe('one')
    await expect(f.mount('one')).rejects.toMatchObject({ code: 'INVALID_REQUEST' })
    f.service.close(first.instanceId)
    const reopened = await f.mount('one'); expect(reopened.instanceId).not.toBe(first.instanceId)
    expect(reopened.context.instanceKey).toBe('one')
    await f.service.disable(f.manifest.id); expect(f.service.snapshot().plugins[0].runtime?.pages).toBe(0)
    expect(() => f.service.inspect(second.instanceId, second.binding)).toThrow()
  })
  it('routes SDK opens to the requested instance instead of returning the first page', async () => {
    const f = await fixture(); const first = await f.mount('one'); const second = await f.mount('two')
    const result = await f.service.call(first.instanceId, first.binding, { protocol: 1, type: 'request', requestId: 'open-two', method: 'views.open', params: { view: 'details', instanceKey: 'two' }, contextRevision: first.context.revision })
    expect(result).toMatchObject({ ok: true, result: { instanceId: second.instanceId } })
    expect(f.openView).toHaveBeenCalledWith(f.manifest.id, 'details', 'two')
  })
  it('retains per-plugin page budgets across distinct keys', async () => {
    const f = await fixture()
    for (let index = 0; index < 8; index++) await f.mount(`page-${index}`)
    await expect(f.mount('overflow')).rejects.toMatchObject({ code: 'RATE_LIMITED' })
  })
  it('uses stable pane keys on restore and different keys for repeated menu actions', () => {
    cleanup.push(extensionRegistry.register({ id: 'example.multi', views: [{ id: 'page', title: 'Page', location: 'workspace', scope: 'project', instancePolicy: 'multiple', component: () => null }] }))
    const id = 'extension:example.multi/page'
    const first = createExtensionPaneContent(id, 'p')!; const next = createExtensionPaneContent(id, 'p')!
    expect(first.id).not.toBe(next.id)
    expect(createExtensionPaneContent(id, 'p', first.instanceKey)).toEqual(first)
    expect(isAvailableExtensionPane(JSON.parse(JSON.stringify(first)))).toBe(true)
    expect(isAvailableExtensionPane({ ...first, instanceKey: undefined })).toBe(false)
  })
})
