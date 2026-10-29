import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { createServer } from 'node:net'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse } from 'yaml'
import { CpaRuntime, assertCpaPortFree, managedCpaConfig } from '../../plugins/cpa/src/main/runtime'
import type { CpaInstallation, CpaInstaller } from '../../plugins/cpa/src/main/installer'

const h = vi.hoisted(() => ({ spawn: vi.fn(), encrypted: true, encrypt: vi.fn(), clipboard: vi.fn(), openPath: vi.fn(async () => ''),
  proxy: vi.fn<() => string | null>(), systemProxy: vi.fn<() => string | null>(),
}))
vi.mock('../../plugins/cpa/src/main/desktop', async () => {
  const { HostProxy, hostProxyEnvironment } = await import('../../src/main/lib/host-proxy')
  return { CpaProxy: HostProxy, cpaProxyEnvironment: hostProxyEnvironment, desktop: {
    async call(method: string, value: any) {
      if (method === 'desktop.encryption' && !h.encrypted) throw new Error('cpa-encryption-unavailable')
      if (method === 'desktop.clipboard') h.clipboard(value.text)
      if (method === 'desktop.openPath') await h.openPath(value.path)
    },
    async encrypt(value: string) { return h.encrypt(value) },
    async decrypt(value: Buffer) { return Buffer.from(value.toString().slice(10), 'base64').toString() },
  } }
})
vi.mock('@janusx/llm-core', () => ({ getProxyManager: () => ({ getProxyUrl: h.proxy }), getSystemProxy: h.systemProxy }))
vi.mock('node:child_process', () => ({ spawn: (...args: unknown[]) => h.spawn(...args) }))
vi.mock('../../plugins/cpa/src/main/local-request', () => ({ cpaLocalRequest: vi.fn(async () => ({ ok: true })) }))

class Child extends EventEmitter {
  pid = 424242
  exitCode: number | null = null
  stdout = new EventEmitter()
  stderr = new EventEmitter()
  kill = vi.fn(() => { this.exitCode = 0; this.emit('exit', 0); return true })
  unref = vi.fn()
}
const roots: string[] = [], runtimes: CpaRuntime[] = []
beforeEach(() => {
  vi.clearAllMocks(); h.encrypted = true
  h.proxy.mockReturnValue(null); h.systemProxy.mockReturnValue(null)
  h.encrypt.mockImplementation((value: string) => Buffer.from('encrypted:' + Buffer.from(value).toString('base64')))
  h.spawn.mockImplementation(() => new Child())
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })))
})
afterEach(async () => {
  for (const runtime of runtimes.splice(0)) await runtime.dispose()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true, maxRetries: 3 })
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

async function fixture(installed = true) {
  const root = await mkdtemp(join(tmpdir(), 'janusx-cpa-runtime-')); roots.push(root)
  const old: CpaInstallation = { id: 'old', backend: 'v8.0.30', frontend: 'v1.26.4', binaryHash: '', pageHash: '' }
  const next: CpaInstallation = { ...old, id: 'new', backend: 'v8.0.31', frontend: 'v1.26.5' }
  const slots = { current: installed ? old : null, pending: null as CpaInstallation | null }
  const installer = {
    binaryName: 'cli-proxy-api.exe', directory: (value: CpaInstallation) => join(root, 'versions', value.id),
    read: vi.fn(async (slot: 'current' | 'pending') => slots[slot]),
    install: vi.fn(async () => { slots.pending = next; return next }),
    activate: vi.fn(async (value: CpaInstallation) => { slots.current = value; slots.pending = null }),
  }
  const runtime = new CpaRuntime(root, installer as unknown as CpaInstaller); runtimes.push(runtime)
  return { root, runtime, installer, slots, old, next }
}

describe('managed CPA runtime ownership', () => {
  it('uses an explicit local relay for config and environment without persisting upstream credentials', async () => {
    const { runtime, root } = await fixture()
    h.proxy.mockReturnValue('http://fixture-user:fixture-password@127.0.0.1:7897')
    h.systemProxy.mockReturnValue('http://127.0.0.1:9999')
    vi.stubEnv('NO_PROXY', 'example.test, localhost')
    vi.stubEnv('no_proxy', 'internal.test,example.test')
    vi.stubEnv('UNRELATED_SECRET', 'must-not-inherit')
    const originalBypass = process.env.NO_PROXY
    const settings = { managementUrl: '', port: 18317, autoUpdate: false }
    await runtime.start(settings)
    const calls = () => h.spawn.mock.calls.filter(([file]) => file !== 'powershell.exe')
    const env = calls()[0][2].env
    expect(env.HTTPS_PROXY).toMatch(/^http:\/\/janusx:[a-f0-9]+@127\.0\.0\.1:\d+$/)
    expect(env.HTTP_PROXY).toBe(env.HTTPS_PROXY)
    expect(env.http_proxy).toBe(env.HTTPS_PROXY)
    expect(env.https_proxy).toBe(env.HTTPS_PROXY)
    expect(env.NO_PROXY.split(',')).toEqual(expect.arrayContaining(['example.test', 'internal.test', 'localhost', '127.0.0.1', '::1']))
    expect(env.no_proxy).toBe(env.NO_PROXY)
    expect(env.UNRELATED_SECRET).toBeUndefined()
    expect(process.env.NO_PROXY).toBe(originalBypass)
    expect(await readFile(join(root, 'config.yaml'), 'utf8')).not.toContain('fixture-password')
    expect(parse(await readFile(join(root, 'config.yaml'), 'utf8')).requests['proxy-url']).toBe(env.HTTPS_PROXY)
    expect(JSON.stringify(await runtime.status())).not.toContain('fixture-password')
    await runtime.stop()
    h.proxy.mockReturnValue('http://127.0.0.1:7898')
    await runtime.start(settings)
    expect(calls()[1][2].env.HTTPS_PROXY).not.toBe(env.HTTPS_PROXY)
  })

  it('persists custom keys encrypted, rotates only while stopped and reuses the new key across runtime recreation', async () => {
    const { runtime, root, installer } = await fixture()
    const settings = { managementUrl: '', port: 18317, autoUpdate: false }
    await runtime.setManagementKey('first-custom-key')
    await runtime.start(settings)
    expect(h.spawn.mock.calls[0][2].env.MANAGEMENT_PASSWORD).toBe('first-custom-key')
    await expect(runtime.setManagementKey('second-custom-key')).rejects.toThrow('cpa-key-change-requires-stop')
    await runtime.stop()
    await runtime.setManagementKey('second-custom-key')
    expect((await readFile(join(root, 'management-key.enc'))).toString()).not.toContain('second-custom-key')
    await runtime.dispose()
    const recreated = new CpaRuntime(root, installer as unknown as CpaInstaller); runtimes.push(recreated)
    await recreated.start(settings)
    await recreated.copyKey()
    expect(h.clipboard).toHaveBeenLastCalledWith('second-custom-key')
    const calls = h.spawn.mock.calls.filter(([file]) => file !== 'powershell.exe')
    expect(calls.at(-1)![2].env.MANAGEMENT_PASSWORD).toBe('second-custom-key')
    expect(await readFile(join(root, 'config.yaml'), 'utf8')).not.toContain('second-custom-key')
  })

  it('retains the prior cached and encrypted key when a replacement cannot be saved', async () => {
    const { runtime, root } = await fixture()
    await runtime.setManagementKey('retained-key')
    const before = await readFile(join(root, 'management-key.enc'))
    h.encrypt.mockImplementationOnce(() => { throw new Error('storage failed') })
    await expect(runtime.setManagementKey('replacement-key')).rejects.toThrow('cpa-key-save-failed')
    expect(await readFile(join(root, 'management-key.enc'))).toEqual(before)
    await runtime.copyKey()
    expect(h.clipboard).toHaveBeenLastCalledWith('retained-key')
    h.encrypted = false
    await expect(runtime.setManagementKey('replacement-key')).rejects.toThrow('cpa-encryption-unavailable')
    expect(await readFile(join(root, 'management-key.enc'))).toEqual(before)
  })

  it('does not cache an unpersisted generated key after encryption failure', async () => {
    const { runtime } = await fixture()
    h.encrypt.mockImplementationOnce(() => { throw new Error('storage failed') })
    await expect(runtime.copyKey()).rejects.toThrow('cpa-key-save-failed')
    await runtime.copyKey()
    expect(h.encrypt).toHaveBeenCalledTimes(2)
    expect(h.clipboard).toHaveBeenCalledOnce()
  })
  it('uses a protected key, local-only config and a single process, retaining account data across restart', async () => {
    const { root, runtime } = await fixture()
    const settings = { managementUrl: '', port: 18317, autoUpdate: false }
    await runtime.start(settings)
    await runtime.start(settings)
    const calls = h.spawn.mock.calls.filter(([file]) => file !== 'powershell.exe')
    expect(calls).toHaveLength(1)
    expect(calls[0][2]).toMatchObject({ windowsHide: true, shell: false, env: {
      MANAGEMENT_PASSWORD: expect.stringMatching(/^[a-f0-9]{64}$/), MANAGEMENT_STATIC_PATH: expect.stringContaining('management.html'),
    } })
    const key = calls[0][2].env.MANAGEMENT_PASSWORD
    expect(JSON.stringify(calls[0][1])).not.toContain(key)
    const config = await readFile(join(root, 'config.yaml'), 'utf8')
    expect(config).not.toContain(key)
    expect((await readFile(join(root, 'management-key.enc'))).toString()).not.toContain(key)
    expect(parse(config)).toMatchObject({ server: { host: '127.0.0.1', port: 18317 }, management: { 'allow-remote': false, 'disable-auto-update-panel': true }, oauth: { 'auth-dir': join(root, 'accounts') } })
    await runtime.copyKey(); expect(h.clipboard).toHaveBeenCalledWith(key)
    await writeFile(join(root, 'accounts', 'sentinel'), 'keep')
    await runtime.stop()
    expect((await runtime.status()).phase).toBe('stopped')
    await runtime.start(settings)
    expect(await readFile(join(root, 'accounts', 'sentinel'), 'utf8')).toBe('keep')
    expect(h.spawn.mock.calls.filter(([file]) => file !== 'powershell.exe')[1][2].env.MANAGEMENT_PASSWORD).toBe(key)
  })

  it('does not start or kill another service when the selected port is occupied', async () => {
    const server = createServer()
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address() as { port: number }
    try {
      const { runtime } = await fixture()
      await expect(runtime.start({ managementUrl: '', port: address.port })).rejects.toThrow('cpa-port-in-use')
      expect(h.spawn).not.toHaveBeenCalled()
      expect((await runtime.status()).error).toBe('cpa-port-in-use')
      expect(server.listening).toBe(true)
    } finally { await new Promise<void>((resolve) => server.close(() => resolve())) }
  })

  it('refuses plaintext credential fallback and keeps component failures retryable', async () => {
    const { runtime, installer } = await fixture(false)
    h.encrypted = false
    await expect(runtime.start({ managementUrl: '', port: 18317 })).rejects.toThrow('cpa-encryption-unavailable')
    expect(installer.install).not.toHaveBeenCalled()
    h.encrypted = true
    installer.install.mockRejectedValueOnce(new Error('cpa-download-failed'))
    await expect(runtime.start({ managementUrl: '', port: 18317 })).rejects.toThrow('cpa-download-failed')
    expect(h.spawn).not.toHaveBeenCalled()
    await runtime.start({ managementUrl: '', port: 18317, autoUpdate: false })
    expect((await runtime.status()).phase).toBe('running')
  })

  it('stages updates without interrupting the running process and applies them on next start', async () => {
    const { runtime, installer, next } = await fixture()
    const settings = { managementUrl: '', port: 18317, autoUpdate: false }
    await runtime.start(settings)
    const child = h.spawn.mock.results[0].value as Child
    await runtime.stageUpdate()
    expect(child.kill).not.toHaveBeenCalled()
    expect((await runtime.status()).pendingVersion).toContain('v8.0.31')
    await runtime.stop()
    await runtime.start(settings)
    expect(installer.activate).toHaveBeenLastCalledWith(next)
    expect((await runtime.status()).pendingVersion).toBeUndefined()
  })

  it('rolls back a failed staged program without overwriting accounts or the prior config', async () => {
    const { root, runtime, slots, next, old, installer } = await fixture()
    slots.pending = next
    await writeFile(join(root, 'config.yaml'), 'custom-setting: keep\n')
    h.spawn.mockImplementation((file: string) => {
      const child = new Child()
      if (file.includes(join('versions', 'new'))) queueMicrotask(() => { child.exitCode = 1; child.emit('exit', 1) })
      return child
    })
    await runtime.start({ managementUrl: '', port: 18317, autoUpdate: false })
    expect(installer.activate).toHaveBeenLastCalledWith(old)
    expect((await runtime.status()).updateError).toBe('cpa-update-rolled-back')
    expect(parse(await readFile(join(root, 'config.yaml'), 'utf8'))['custom-setting']).toBe('keep')
  })

  it('keeps updater failures separate from a usable running service', async () => {
    const { runtime, installer } = await fixture()
    await runtime.start({ managementUrl: '', port: 18317, autoUpdate: false })
    installer.install.mockRejectedValueOnce(new Error('cpa-download-failed'))
    await expect(runtime.stageUpdate()).rejects.toThrow('cpa-download-failed')
    expect(await runtime.status()).toMatchObject({ phase: 'running', updateError: 'cpa-download-failed' })
  })

  it('cancels an in-progress installation before starting a process', async () => {
    const { runtime, installer } = await fixture(false)
    let downloading!: () => void
    const began = new Promise<void>((resolve) => { downloading = resolve })
    installer.install.mockImplementationOnce((signal: AbortSignal) => new Promise((_resolve, reject) => {
      downloading(); signal.addEventListener('abort', () => reject(new Error('cpa-stopped')), { once: true })
    }))
    const start = runtime.start({ managementUrl: '', port: 18317, autoUpdate: false })
    const result = expect(start).rejects.toThrow('cpa-stopped')
    await began
    await runtime.stop()
    await result
    expect(h.spawn).not.toHaveBeenCalled()
    expect((await runtime.status()).phase).toBe('not-installed')
  })

  it('invalidates a queued start before it can replace the stopped abort signal', async () => {
    const { runtime, installer } = await fixture(false)
    const starting = runtime.start({ managementUrl: '', port: 18317, autoUpdate: false })
    const rejected = expect(starting).rejects.toThrow('cpa-stopped')
    await runtime.stop(); await rejected
    expect(installer.install).not.toHaveBeenCalled()
    expect(h.spawn).not.toHaveBeenCalled()
  })

  it('creates one encrypted key when startup and clipboard requests overlap', async () => {
    const { runtime, root } = await fixture()
    await Promise.all([runtime.copyKey(), runtime.copyKey(), runtime.start({ managementUrl: '', port: 18317, autoUpdate: false })])
    expect(h.encrypt).toHaveBeenCalledTimes(1)
    const key = h.clipboard.mock.calls[0][0]
    expect(h.clipboard.mock.calls[1][0]).toBe(key)
    expect(h.spawn.mock.calls[0][2].env.MANAGEMENT_PASSWORD).toBe(key)
    const saved = await readFile(join(root, 'management-key.enc'))
    expect(Buffer.from(saved.toString().slice(10), 'base64').toString()).toBe(key)
  })

  it('enforces managed listener rules over legacy settings while preserving user API configuration', () => {
    const result = parse(managedCpaConfig('host: 0.0.0.0\nport: 99\nproxy-url: http://legacy:9999\nrequests:\n  proxy-url: direct\n  custom-header: keep\naccess:\n  api-keys: [keep-me]\n', { managementUrl: '', port: 18417 }, '/accounts'))
    expect(result.host).toBeUndefined(); expect(result.port).toBeUndefined()
    expect(result.server.host).toBe('127.0.0.1')
    expect(result.access['api-keys']).toEqual(['keep-me'])
    expect(result['proxy-url']).toBeUndefined()
    expect(result.requests).toEqual({ 'proxy-url': '', 'custom-header': 'keep' })
  })
})
