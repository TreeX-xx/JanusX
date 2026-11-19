import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it, afterEach, vi } from 'vitest'
import { parse } from 'yaml'
import { Arch } from 'builder-util'
import { checkOfficecliResource, officecliRelease, officecliResource, prepareOfficecliResource } from '../../../scripts/officecli-resources.mjs'
import beforePack from '../../../scripts/officecli-before-pack.cjs'
import { expectedBundledOfficecliSha256, resolveBundledOfficecliBinary } from '../../../src/main/office/office-bundled-path'

const roots: string[] = []
async function temp() {
  const root = await mkdtemp(join(tmpdir(), 'janusx-office-resource-'))
  roots.push(root)
  return root
}
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

describe('OfficeCLI resource preparation', () => {
  it.each(['x64', 'arm64'])('shares the macOS %s target with runtime and packaging', async (arch) => {
    const root = await temp()
    const resource = officecliResource({ platform: 'darwin', arch, root })
    expect(resource.url).toBe(`https://github.com/iOfficeAI/OfficeCLI/releases/download/v1.0.135/officecli-mac-${arch}`)
    expect(resource.sha256).toBe(expectedBundledOfficecliSha256(arch, 'darwin'))
    expect(resource.binary).toBe(resolveBundledOfficecliBinary({ resourcesPath: join(root, 'resources'), platform: 'darwin', arch, env: {} }))
    const config = parse(await readFile('electron-builder.yml', 'utf8'))
    const packaged = config.mac.extraResources[0]
    expect(join(root, packaged.from.replace('${arch}', arch))).toBe(resource.binary)
    const appResources = join(root, 'JanusX.app', 'Contents', 'Resources')
    expect(join(appResources, packaged.to.replace('${arch}', arch))).toBe(resolveBundledOfficecliBinary({ resourcesPath: appResources, platform: 'darwin', arch, env: {} }))
    const signIgnore = new RegExp(config.mac.signIgnore[0])
    expect(signIgnore.test(`/Applications/JanusX.app/Contents/Resources/officecli/darwin-${arch}/officecli`)).toBe(true)
    expect(signIgnore.test('/Applications/JanusX.app/Contents/MacOS/JanusX')).toBe(false)
    expect(config.files).toContain('!resources/officecli{,/**/*}')
    expect(config.extraResources).toBeUndefined()
    expect(config.win.extraResources).toEqual([{ from: 'resources/officecli/officecli.exe', to: 'officecli/officecli.exe' }])
  })

  it('reports how to prepare a missing target without downloading during checks', async () => {
    await expect(checkOfficecliResource({ root: await temp(), platform: 'darwin', arch: 'arm64' }))
      .rejects.toThrow('npm run officecli:prepare -- --platform darwin --arch arm64')
    expect(() => officecliResource({ platform: 'darwin', arch: 'universal' })).toThrow('unsupported')
  })

  it('rejects tampered downloads before replacing an existing resource', async () => {
    const options = { root: await temp(), platform: 'darwin', arch: 'arm64' }
    const resource = officecliResource(options)
    await mkdir(dirname(resource.binary), { recursive: true })
    await writeFile(resource.binary, 'existing bytes')
    const fetchAsset = vi.fn().mockResolvedValue(new Response('wrong platform or corrupted binary'))
    await expect(prepareOfficecliResource(options, fetchAsset)).rejects.toThrow('SHA256 mismatch')
    expect(fetchAsset).toHaveBeenCalledWith(resource.url, expect.objectContaining({ signal: expect.any(AbortSignal) }))
    expect(await readFile(resource.binary, 'utf8')).toBe('existing bytes')
    expect(await readdir(dirname(resource.binary))).toEqual(['officecli'])
    await expect(checkOfficecliResource(options)).rejects.toThrow('darwin/arm64')
  })

  it('fails on HTTP errors without creating a resource', async () => {
    const root = await temp()
    await expect(prepareOfficecliResource({ root, platform: 'darwin', arch: 'x64' }, vi.fn().mockResolvedValue(new Response('', { status: 404 }))))
      .rejects.toThrow('HTTP 404')
    expect(await readdir(root)).toEqual([])
  })

  it.each(['darwin', 'win32'])('stages verified %s bytes atomically and reuses the result offline', async (platform) => {
    const options = { root: await temp(), platform, arch: 'x64' }
    const bytes = Buffer.from('test executable bytes')
    // Pin this small fixture for the filesystem test; published hashes are tested separately.
    const target = officecliRelease.targets[`${platform}-x64`]
    const publishedSha = target.sha256
    target.sha256 = createHash('sha256').update(bytes).digest('hex')
    try {
      const resource = officecliResource(options)
      await mkdir(dirname(resource.binary), { recursive: true })
      await writeFile(resource.binary, 'outdated binary')
      const fetchAsset = vi.fn().mockResolvedValue(new Response(bytes))
      await prepareOfficecliResource(options, fetchAsset)
      expect(await readFile(resource.binary)).toEqual(bytes)
      expect(await readdir(dirname(resource.binary))).toEqual([platform === 'darwin' ? 'officecli' : 'officecli.exe'])
      await expect(checkOfficecliResource(options)).resolves.toMatchObject({ binary: resource.binary })
      const offline = vi.fn().mockRejectedValue(new Error('offline'))
      await prepareOfficecliResource(options, offline)
      expect(offline).not.toHaveBeenCalled()
      if (platform === 'darwin' && process.platform !== 'win32') {
        expect((await stat(resource.binary)).mode & 0o777).toBe(0o755)
      }
    } finally {
      target.sha256 = publishedSha
    }
  })

  it('checks the builder target rather than the build host architecture', async () => {
    const projectDir = await temp()
    await expect(beforePack({ electronPlatformName: 'darwin', arch: Arch.arm64, packager: { projectDir } }))
      .rejects.toThrow('--platform darwin --arch arm64')
    await expect(beforePack({ electronPlatformName: 'win32', arch: Arch.x64, packager: { projectDir } }))
      .rejects.toThrow('--platform win32 --arch x64')
    await expect(beforePack({ electronPlatformName: 'darwin', arch: Arch.universal, packager: { projectDir } }))
      .rejects.toThrow('unsupported on darwin/universal')
  })
})
