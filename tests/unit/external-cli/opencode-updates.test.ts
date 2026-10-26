import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { isExternalCliInstallOptions, openCodeChannel, type ExternalCliDetectResult } from '../../../src/shared/ipc/external-cli'
import { fetchOpenCodeVersions } from '../../../src/main/external-cli/opencode-releases'
import { OPENCODE_PACKAGES } from '../../../src/main/external-cli/tool-registry'

vi.mock('electron', () => ({ app: { getPath: () => join(tmpdir(), 'janusx-opencode-test') } }))
const { DefaultExternalCliService } = await import('../../../src/main/external-cli/service')

function harness(current: string | undefined, after = current, installed = true) {
  const probe = (version: string | undefined): ExternalCliDetectResult => ({
    toolId: 'opencode', installed, runnable: !!version, version, path: 'C:/tools/opencode.cmd',
  })
  const detector = { detect: vi.fn().mockResolvedValue(probe(after)).mockResolvedValueOnce(probe(current)) }
  const installer = {
    isBusy: () => false,
    install: vi.fn().mockResolvedValue({ success: true, command: 'npm install' }),
    uninstall: vi.fn(),
  }
  const versions = vi.fn().mockResolvedValue({ v1: '1.19.4', v2: '2.1.4' })
  const service = new DefaultExternalCliService(
    { opencode: detector } as never, undefined, undefined, undefined, installer as never, undefined, versions,
  )
  return { service, detector, installer, versions }
}

describe('OpenCode release lines', () => {
  it.each([
    ['1.19.4', 'v1'], ['2.1.4', 'v2'], ['2.1.5-beta.2', 'v2'], ['2.1.4+build.1', 'v2'],
    ['0.0.0-tui-v2-202606261840', undefined], ['3.0.0', undefined], ['garbage', undefined], [undefined, undefined],
  ])('identifies %s as %s', (version, expected) => {
    expect(openCodeChannel(version)).toBe(expected)
  })

  it('queries the official packages separately and tolerates one failed registry', async () => {
    const fetch = vi.fn(async (name: string) => {
      if (name === OPENCODE_PACKAGES.v1) return '1.19.4'
      throw new Error('offline')
    })
    expect(await fetchOpenCodeVersions(fetch)).toEqual({ v1: '1.19.4' })
    expect(fetch.mock.calls.map(([name]) => name).sort()).toEqual(['@opencode/cli', 'opencode-ai'])
  })

  it.each(['2.0.0', '0.0.0-tui-v2-202606261840', '1.20.0-beta.1', '1.2.3; echo unsafe'])('rejects %s as a v1 stable target', async version => {
    expect(await fetchOpenCodeVersions(async () => version)).toEqual(version === '2.0.0' ? { v2: version } : {})
  })

  it.each([
    { channel: 'v1', version: '2.1.4' }, { channel: 'v2', version: 'latest' },
    { channel: 'v2', version: '2.1.4; whoami' }, { channel: 'v2', version: '2.1.4-beta.1' },
    { channel: 'next', version: '2.1.4' }, null,
  ])('rejects invalid install options %j', options => {
    expect(isExternalCliInstallOptions(options)).toBe(false)
  })
})

describe('OpenCode update service', () => {
  it('returns both latest versions without conflating their release lines', async () => {
    const { service } = harness('1.18.0')
    expect(await service.latest('opencode')).toEqual({ toolId: 'opencode', versions: { v1: '1.19.4', v2: '2.1.4' } })
  })

  it('keeps the default v1 update on v1', async () => {
    const { service, installer } = harness('1.18.0', '1.19.4')
    expect(await service.install('opencode')).toMatchObject({ success: true, version: '1.19.4' })
    expect(installer.install).toHaveBeenCalledWith(expect.objectContaining({ npmPackage: 'opencode-ai' }), '1.19.4', undefined)
  })

  it('switches to the exact v2 version selected by the user', async () => {
    const { service, installer, versions } = harness('1.18.0', '2.1.4')
    expect(await service.install('opencode', { channel: 'v2', version: '2.1.4' })).toMatchObject({ success: true })
    expect(installer.install).toHaveBeenCalledWith(expect.objectContaining({ npmPackage: '@opencode/cli' }), '2.1.4', expect.objectContaining({ npmPackage: 'opencode-ai' }))
    expect(versions).not.toHaveBeenCalled()
  })

  it('keeps v2 on its package, and defaults a new install to v2', async () => {
    for (const initial of ['2.0.0', undefined]) {
      const { service, installer } = harness(initial, '2.1.4', !!initial)
      expect(await service.install('opencode')).toMatchObject({ success: true })
      expect(installer.install.mock.calls[0][0].npmPackage).toBe('@opencode/cli')
      if (initial) expect(installer.install.mock.calls[0][2]).toBeUndefined()
    }
  })

  it('does not guess the release line of an existing unversioned binary', async () => {
    const { service, installer } = harness(undefined)
    expect(await service.install('opencode')).toMatchObject({ success: false, error: expect.stringContaining('unknown') })
    expect(installer.install).not.toHaveBeenCalled()
  })

  it('refuses same-line downgrades and switching v2 back to v1', async () => {
    const { service, installer } = harness('2.1.5')
    expect(await service.install('opencode', { channel: 'v2', version: '2.1.4' })).toMatchObject({ success: false })
    expect(await service.install('opencode', { channel: 'v1', version: '1.19.4' })).toMatchObject({ success: false })
    expect(installer.install).not.toHaveBeenCalled()
  })

  it('fails honestly when the requested branch is offline', async () => {
    const { service, installer, versions } = harness('1.18.0')
    versions.mockResolvedValue({ v2: '2.1.4' })
    expect(await service.install('opencode')).toMatchObject({ success: false })
    expect(installer.install).not.toHaveBeenCalled()
  })

  it('does not accept OpenCode options for another tool or invalid options', async () => {
    const { service, installer } = harness('1.18.0')
    expect(await service.install('claude', { channel: 'v2', version: '2.1.4' })).toMatchObject({ success: false })
    expect(await service.install('opencode', { channel: 'v1', version: '2.1.4' })).toMatchObject({ success: false })
    expect(installer.install).not.toHaveBeenCalled()
  })

  it('reports PATH shadowing instead of calling an unchanged binary a success', async () => {
    const { service } = harness('1.18.0', '1.18.0')
    expect(await service.install('opencode', { channel: 'v2', version: '2.1.4' })).toMatchObject({ success: false, error: expect.stringContaining('Check PATH') })
  })

  it('rejects a failed post-install probe', async () => {
    const { service, detector } = harness('1.18.0')
    detector.detect.mockResolvedValueOnce({ toolId: 'opencode', installed: true, runnable: false, hint: 'locked executable' })
    expect(await service.install('opencode', { channel: 'v1', version: '1.19.4' })).toMatchObject({ success: false })
  })

  it('holds the service lock while awaiting version detection and releases it on failure', async () => {
    const { service, detector } = harness('1.18.0')
    let reject!: (error: Error) => void
    detector.detect.mockReset()
      .mockResolvedValue({ toolId: 'opencode', installed: true, runnable: true, version: '2.1.4' })
      .mockImplementationOnce(() => new Promise((_, fail) => { reject = fail }))
    const first = service.install('opencode')
    expect(await service.install('opencode')).toMatchObject({ success: false, error: expect.stringContaining('already running') })
    const failure = expect(first).rejects.toThrow('probe failed')
    reject(new Error('probe failed'))
    await failure
    expect(await service.install('opencode', { channel: 'v2', version: '2.1.4' })).not.toMatchObject({ error: 'Another install is already running.' })
  })
})
