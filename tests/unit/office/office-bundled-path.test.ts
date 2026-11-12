import { resolve, join } from 'node:path'
import { describe, expect, it, vi, afterEach } from 'vitest'
import { expectedBundledOfficecliSha256, resolveBundledOfficecliBinary } from '../../../src/main/office/office-bundled-path'

afterEach(() => vi.unstubAllEnvs())

describe('bundled OfficeCLI targets', () => {
  const resourcesPath = resolve('app resources')

  it.each(['x64', 'arm64'])('keeps the Windows %s executable location', (arch) => {
    expect(resolveBundledOfficecliBinary({ resourcesPath, platform: 'win32', arch, env: {} }))
      .toBe(join(resourcesPath, 'officecli', 'officecli.exe'))
  })

  it.each(['x64', 'arm64'])('selects the macOS %s executable in both development and packaged resources', (arch) => {
    for (const root of [resourcesPath, join(resourcesPath, 'JanusX.app', 'Contents', 'Resources')]) {
      expect(resolveBundledOfficecliBinary({ resourcesPath: root, platform: 'darwin', arch, env: {} }))
        .toBe(join(root, 'officecli', `darwin-${arch}`, 'officecli'))
    }
  })

  it('honors an absolute macOS override and ignores a relative override', () => {
    const binary = join(resourcesPath, 'custom officecli')
    expect(resolveBundledOfficecliBinary({ platform: 'darwin', arch: 'arm64', env: { JANUSX_OFFICECLI_BINARY: binary } })).toBe(binary)
    expect(resolveBundledOfficecliBinary({ resourcesPath, platform: 'darwin', arch: 'arm64', env: { JANUSX_OFFICECLI_BINARY: './officecli' } }))
      .toBe(join(resourcesPath, 'officecli', 'darwin-arm64', 'officecli'))
    vi.stubEnv('JANUSX_OFFICECLI_BINARY', binary)
    expect(resolveBundledOfficecliBinary({ platform: 'darwin', arch: 'arm64' })).toBe(binary)
    expect(resolveBundledOfficecliBinary({ platform: 'darwin', arch: 'arm64', env: {} })).toBeUndefined()
  })

  it('fails closed for missing roots and unsupported targets', () => {
    expect(resolveBundledOfficecliBinary({ platform: 'darwin', arch: 'arm64', resourcesPath: 'relative', env: {} })).toBeUndefined()
    expect(resolveBundledOfficecliBinary({ platform: 'darwin', arch: 'ia32', resourcesPath, env: {} })).toBeUndefined()
    expect(resolveBundledOfficecliBinary({ platform: 'linux', arch: 'x64', resourcesPath, env: {} })).toBeUndefined()
    expect(() => expectedBundledOfficecliSha256('x64', 'linux')).toThrow('unsupported on linux/x64')
    expect(() => expectedBundledOfficecliSha256('universal', 'darwin')).toThrow('unsupported on darwin/universal')
  })

  it.each([
    ['win32', 'x64', '937db176b585e874aa5bff48d536bce78037665cd862b5deefe56e79977e6588'],
    ['win32', 'arm64', 'c818013023f83d3c9ec3dcba4dabaf824bdf861da6fa925d0557f508d3b11558'],
    ['darwin', 'x64', '77178c638ba5b12d21896f9b0091081079645089bc1d909e3b3097e1649bda5c'],
    ['darwin', 'arm64', '0d2a32c7dd460e275ddd8c442be33a8221a32021d4d5f7957cd44a70b2d927dd'],
  ] as const)('pins the published %s/%s checksum', (platform, arch, expected) => {
    expect(expectedBundledOfficecliSha256(arch, platform)).toBe(expected)
  })
})
