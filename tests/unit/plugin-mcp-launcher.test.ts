import { afterEach, expect, it } from 'vitest'
import { generateKeyPairSync, createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { build } from 'esbuild'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js'
import { PluginService } from '../../src/main/plugins/service'
import { encodePluginArchive, pluginContentDigest, signPluginPayload } from '../../src/main/plugins/distribution/package'
import { resolveInstalledPluginMcp } from '../../src/main/plugins/mcp-launcher'
import { permissionFingerprint } from '../../src/main/plugins/permission-fingerprint'
import { pluginPackageInUse } from '../../src/main/plugins/package-leases'

const cleanup: Array<() => Promise<unknown>> = []
afterEach(async () => { for (const clean of cleanup.splice(0).reverse()) await clean() })
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'plugin-mcp-'))
  cleanup.push(() => rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  const trust = generateKeyPairSync('ed25519'), keys = { test: trust.publicKey.export({ type: 'spki', format: 'pem' }).toString() }
  const manifest = JSON.parse(await readFile('plugins/blueprint/manifest.json', 'utf8'))
  const bundled = await build({ absWorkingDir: resolve('plugins/blueprint'), entryPoints: ['src/main/blueprint/note-mcp.ts'],
    platform: 'node', target: 'node22', format: 'cjs', bundle: true, mainFields: ['module', 'main'], write: false })
  const files = new Map([['manifest.json', Buffer.from(JSON.stringify(manifest))], ['dist/service.cjs', Buffer.from('module.exports = {}')],
    ['dist/note-mcp.cjs', Buffer.from(bundled.outputFiles[0].contents)]])
  for (const view of manifest.contributes.views) files.set(view.entry, Buffer.from('<p>MCP fixture</p>'))
  const archive = await encodePluginArchive(files)
  const release = signPluginPayload({ schemaVersion: 1, id: manifest.id, name: manifest.name, description: '', publisher: 'Fixture', version: manifest.version,
    host: '>=0.9.4', pluginApi: manifest.engines.pluginApi, platforms: [`${process.platform}-${process.arch}`], url: 'https://example.com/test.jxp',
    bytes: archive.length, sha256: createHash('sha256').update(archive).digest('hex'), contentDigest: pluginContentDigest(files) }, 'test', trust.privateKey)
  const options = { directory, pluginId: manifest.id, command: 'note', keys, nativePlugins: { [manifest.id]: ['test'] }, hostVersion: '0.9.4', platform: `${process.platform}-${process.arch}` }
  const service = new PluginService({ directory, official: options, resolveProject: async () => ({ root: directory, name: 'fixture' }), changed() {}, event() {}, openView() {}, toast() {} })
  cleanup.push(() => service.dispose())
  await service.initialize(); await service.installOfficial(archive, release)
  const registryPath = join(directory, 'registry.json')
  // Isolated launcher fixture: native desktop activation is covered by blueprint-native and distribution tests.
  const registry = JSON.parse(await readFile(registryPath, 'utf8'))
  registry.plugins[0].enabled = true; registry.plugins[0].grant = permissionFingerprint(registry.plugins[0].manifest)
  await writeFile(registryPath, JSON.stringify(registry))
  const installVersion = async (version: string) => {
    const next = { ...manifest, version }, nextFiles = new Map(files)
    nextFiles.set('manifest.json', Buffer.from(JSON.stringify(next)))
    const archive = await encodePluginArchive(nextFiles)
    const release = signPluginPayload({ schemaVersion: 1, id: manifest.id, name: manifest.name, description: '', publisher: 'Fixture', version,
      host: '>=0.9.4', pluginApi: manifest.engines.pluginApi, platforms: [`${process.platform}-${process.arch}`], url: 'https://example.com/test.jxp',
      bytes: archive.length, sha256: createHash('sha256').update(archive).digest('hex'), contentDigest: pluginContentDigest(nextFiles) }, 'test', trust.privateKey)
    await service.installOfficial(archive, release)
  }
  return { options, service, directory, registryPath, registry, manifest, installVersion }
}
it('starts a verified installed Note MCP with no desktop and protects its live package from uninstall', async () => {
  const f = await fixture(), workspace = join(f.directory, 'workspace')
  await mkdir(workspace)
  const launcher = join(f.directory, 'fixture-launcher.cjs'), config = join(f.directory, 'fixture-config.json')
  await writeFile(config, JSON.stringify(f.options))
  await build({ stdin: { resolveDir: process.cwd(), loader: 'ts', contents: `
    import { readFile } from 'node:fs/promises'
    import { pathToFileURL } from 'node:url'
    import { resolveInstalledPluginMcp } from './src/main/plugins/mcp-launcher'
    void (async () => {
      const options = JSON.parse(await readFile(process.argv[2], 'utf8'))
      const installed = await resolveInstalledPluginMcp(options)
      process.env.JANUSX_NOTE_STATE_ROOT = installed.stateDirectory
      process.once('exit', installed.release)
      await import(pathToFileURL(installed.entry).href)
    })().catch(() => { process.exitCode = 1 })
  ` }, bundle: true, platform: 'node', target: 'node22', format: 'cjs', mainFields: ['module', 'main'], outfile: launcher })
  const client = new Client({ name: 'fixture', version: '1' })
  const transport = new StdioClientTransport({ command: process.execPath, args: [launcher, config], cwd: workspace, env: getDefaultEnvironment(), stderr: 'pipe' })
  transport.stderr?.on('data', () => {})
  cleanup.push(async () => { await client.close(); await transport.close() })
  await client.connect(transport)
  expect((await client.listTools()).tools.map(tool => tool.name)).toContain('note.read')
  expect((await client.callTool({ name: 'note.list', arguments: { workspacePath: workspace } })).isError).not.toBe(true)
  const packageDirectory = f.registry.plugins[0].packageDirectory
  expect(await pluginPackageInUse(f.directory, packageDirectory)).toBe(true)
  await expect(f.service.uninstall(f.manifest.id)).rejects.toThrow('Close the independent MCP clients')
  await expect(f.service.deleteData(f.manifest.id)).rejects.toThrow('Close the independent MCP clients')
  await client.close(); await transport.close()
  await expect.poll(() => pluginPackageInUse(f.directory, packageDirectory), { timeout: 5000 }).toBe(false)
  await f.service.uninstall(f.manifest.id)
  await expect(resolveInstalledPluginMcp(f.options)).rejects.toThrow('Install the official Blueprint')
})
it('keeps leased generations beyond rollback and protects their shared data until the client exits', async () => {
  const f = await fixture()
  const lease = await resolveInstalledPluginMcp(f.options)
  cleanup.push(async () => lease.release())
  await f.installVersion('1.1.0')
  await f.installVersion('1.2.0')
  expect(await readdir(join(f.directory, 'packages'))).toHaveLength(3)
  const data = join(f.directory, 'data', f.manifest.id, 'native', 'marker')
  await mkdir(join(data, '..'), { recursive: true }); await writeFile(data, 'retained')
  await expect(f.service.deleteData(f.manifest.id)).rejects.toThrow('Close the independent MCP clients')
  await expect(f.service.uninstall(f.manifest.id)).rejects.toThrow('Close the independent MCP clients')
  expect(await readFile(data, 'utf8')).toBe('retained')
  lease.release()
  await f.installVersion('1.3.0')
  expect(await readdir(join(f.directory, 'packages'))).toHaveLength(2)
  await f.service.rollback(f.manifest.id)
  expect(await readdir(join(f.directory, 'packages'))).toHaveLength(1)
  await f.service.deleteData(f.manifest.id)
  await expect(readFile(data, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  await f.service.uninstall(f.manifest.id)
  expect(await readdir(join(f.directory, 'packages'))).toEqual([])
})
it('requires current consent, valid installed bytes and an explicitly trusted signing identity', async () => {
  const f = await fixture()
  await expect(resolveInstalledPluginMcp({ ...f.options, nativePlugins: {} })).rejects.toThrow('not trusted')
  f.registry.plugins[0].grant = 'stale'
  await writeFile(f.registryPath, JSON.stringify(f.registry))
  await expect(resolveInstalledPluginMcp(f.options)).rejects.toThrow('confirm its permissions')
  f.registry.plugins[0].grant = permissionFingerprint(f.manifest)
  f.registry.plugins[0].enabled = false
  await writeFile(f.registryPath, JSON.stringify(f.registry))
  await expect(resolveInstalledPluginMcp(f.options)).rejects.toThrow('Enable the official Blueprint')
  f.registry.plugins[0].enabled = true
  await writeFile(f.registryPath, JSON.stringify(f.registry))
  await writeFile(join(f.registry.plugins[0].packageDirectory, 'dist/note-mcp.cjs'), 'tampered')
  await expect(resolveInstalledPluginMcp(f.options)).rejects.toThrow('installed package changed')
})
