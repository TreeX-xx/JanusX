import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink, link } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parsePluginManifest, validatePluginCall, PLUGIN_CAPABILITIES } from '../../packages/plugin-sdk/src'
import { PluginService } from '../../src/main/plugins/service'
import { listPluginDirectory } from '../../src/main/plugins/files'

const cleanup: Array<() => unknown> = []
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn() })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'janusx-directories-'))
  cleanup.push(() => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }))
  const source = join(root, 'plugin'); const project = join(root, 'project')
  await mkdir(join(source, 'dist'), { recursive: true }); await mkdir(join(project, 'docs'), { recursive: true })
  const manifest = JSON.parse(await readFile('packages/plugin-sdk/template/manifest.json', 'utf8'))
  manifest.capabilities.required.push('files.listDirectory')
  manifest.permissions.push({ name: 'workspace.directories.list', paths: ['docs', '.'] })
  await writeFile(join(source, 'manifest.json'), JSON.stringify(manifest))
  await writeFile(join(source, 'dist/index.html'), '<p>directory</p>'); await writeFile(join(source, 'dist/summary.html'), '<p>summary</p>')
  await writeFile(join(project, 'docs/a.txt'), 'A'); await writeFile(join(project, 'docs/b.txt'), 'B')
  const service = new PluginService({ directory: join(root, 'profile'), resolveProject: async () => ({ root: project, name: 'Project' }), changed() {}, event() {}, openView() {}, toast() {} })
  cleanup.push(() => service.dispose())
  await service.initialize(); await service.import(source, 'linked'); await service.setDevelopment(true); await service.enable(manifest.id, ['p'])
  await service.setContext('p', project, 'en', { id: 'dark', tokens: {} })
  const page = await service.mount(manifest.id, 'details', 'p', project); service.bind(page.instanceId, page.binding)
  let sequence = 0
  const call = (method: string, params: unknown) => service.call(page.instanceId, page.binding, { protocol: 1, type: 'request', requestId: String(++sequence), method, params, contextRevision: page.context.revision }) as Promise<any>
  return { root, source, project, service, manifest, call }
}

describe('P4 directory metadata', () => {
  it('requires explicit directory grants and old-host capability rejection', async () => {
    const f = await fixture()
    const data = parsePluginManifest(JSON.stringify(f.manifest))
    expect(() => parsePluginManifest(JSON.stringify(data), { apiVersion: '1.0.0', capabilities: PLUGIN_CAPABILITIES.filter(item => item !== 'files.listDirectory') })).toThrow()
    expect(() => validatePluginCall(data, 'workspace.listDirectory', { path: 'docs/nested' })).toThrow()
    for (const path of ['../outside', '/absolute', 'docs/../docs', '.git', 'docs/.env']) expect(() => validatePluginCall(data, 'workspace.listDirectory', { path })).toThrow()
    for (const limit of [0, 201, 1.1]) expect(() => validatePluginCall(data, 'workspace.listDirectory', { path: 'docs', limit })).toThrow()
    data.capabilities.required = data.capabilities.required.filter(item => item !== 'files.listDirectory')
    expect(() => parsePluginManifest(JSON.stringify(data))).toThrow()
  })
  it('lists bounded names without file contents or implicit child grants', async () => {
    const f = await fixture()
    expect(await f.call('workspace.listDirectory', { path: 'docs' })).toMatchObject({ ok: true, result: { entries: [{ name: 'a.txt', type: 'file' }, { name: 'b.txt', type: 'file' }], truncated: false } })
    expect(await f.call('workspace.listDirectory', { path: 'docs', limit: 1 })).toMatchObject({ ok: true, result: { entries: [expect.anything()], truncated: true } })
    expect(await f.call('workspace.readText', { path: 'docs/a.txt' })).toMatchObject({ ok: false, error: { code: 'PATH_NOT_GRANTED' } })
    expect(await f.call('workspace.listDirectory', { path: 'docs/nested' })).toMatchObject({ ok: false, error: { code: 'PATH_NOT_GRANTED' } })
  })
  it('filters sensitive, symbolic and hardlinked entries and rejects directory junctions', async () => {
    const f = await fixture()
    await writeFile(join(f.project, 'docs/.env'), 'secret'); await mkdir(join(f.project, 'docs/.git'))
    await link(join(f.project, 'docs/a.txt'), join(f.project, 'docs/hardlink'))
    await symlink(f.source, join(f.project, 'docs/linked'), 'junction')
    expect(await f.call('workspace.listDirectory', { path: 'docs' })).toMatchObject({ ok: true, result: { entries: [{ name: 'b.txt', type: 'file' }] } })
    await expect(listPluginDirectory(f.project, 'docs/linked', 100, () => {})).rejects.toMatchObject({ code: 'INVALID_PACKAGE_PATH' })
    // Remove the junction itself; never recurse through its target during fixture cleanup.
    await rm(join(f.project, 'docs/linked'))
  })
  it('rechecks cancellation during enumeration and closes its directory handle', async () => {
    const f = await fixture(); let checks = 0
    const valid = vi.fn(() => { if (++checks > 3) throw new Error('revoked') })
    await expect(listPluginDirectory(f.project, 'docs', 100, valid)).rejects.toThrow('revoked')
    await rm(join(f.project, 'docs'), { recursive: true })
  })
  it('does not list host-protected storage or its children', async () => {
    const f = await fixture()
    await expect(listPluginDirectory(f.project, 'docs', 100, () => {}, [join(f.project, 'docs')])).rejects.toMatchObject({ code: 'SENSITIVE_PATH_DENIED' })
    expect(await listPluginDirectory(f.project, '.', 100, () => {}, [join(f.project, 'docs')])).toEqual({ entries: [], truncated: false })
  })
  it('reports unavailable paths without exposing absolute paths and requires renewed grants', async () => {
    const f = await fixture()
    await rm(join(f.project, 'docs'), { recursive: true })
    const result = await f.call('workspace.listDirectory', { path: 'docs' })
    expect(result).toMatchObject({ ok: false, error: { code: 'FILE_NOT_FOUND' } })
    expect(JSON.stringify(result)).not.toContain(f.project)
    f.manifest.permissions.find((item: { name: string }) => item.name === 'workspace.directories.list').paths.push('more')
    await writeFile(join(f.source, 'manifest.json'), JSON.stringify(f.manifest)); await f.service.reload(f.manifest.id)
    expect(f.service.snapshot().plugins[0].error).toBe('PERMISSION_RECONFIRM_REQUIRED')
  })
})
