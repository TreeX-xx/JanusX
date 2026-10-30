import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { JsonValue } from '@janusx/plugin-sdk'
import type { NativePeer, NativePluginImplementation } from '@janusx/plugin-sdk/native'
import { createCpaService, importCpaData } from '../../plugins/cpa/src/main/service'

const h = vi.hoisted(() => ({ runtime: { start: vi.fn(), stop: vi.fn(), status: vi.fn(), dispose: vi.fn(),
  setManagementKey: vi.fn(), stageUpdate: vi.fn(), copyKey: vi.fn(), openLogs: vi.fn(), oauthStatus: vi.fn() } }))
vi.mock('../../plugins/cpa/src/main/runtime', () => ({ CpaRuntime: class {
  start = h.runtime.start; stop = h.runtime.stop; status = h.runtime.status; dispose = h.runtime.dispose
  setManagementKey = h.runtime.setManagementKey; stageUpdate = h.runtime.stageUpdate
  copyKey = h.runtime.copyKey; openLogs = h.runtime.openLogs; oauthStatus = h.runtime.oauthStatus
} }))
const roots: string[] = [], services: NativePluginImplementation[] = []
beforeEach(() => { vi.resetAllMocks(); h.runtime.status.mockResolvedValue({ phase: 'running', pid: 123 }) })
afterEach(async () => {
  for (const service of services.splice(0)) await service.stop()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true, maxRetries: 3 })
})
async function directory() { const root = await mkdtemp(join(tmpdir(), 'cpa-plugin-')); roots.push(root); return root }
async function fixture(legacy: JsonValue = null, allowLegacyImport = true) {
  const root = await directory(), host = { call: vi.fn(async () => legacy) }
  const service = await createCpaService({ directory: root, allowLegacyImport }, host as unknown as NativePeer)
  services.push(service)
  const call = (method: string, input: JsonValue = {}, instanceId = randomUUID()) => service.call(method, { input, instanceId }, new AbortController().signal) as Promise<any>
  const idle = () => vi.waitFor(async () => expect((await call('runtime.status')).data.busy).toBe(false))
  return { root, host, service, call, idle }
}

describe('optional CPA native plugin', () => {
  it('starts only an enabled managed instance and retains it after UI release', async () => {
    const f = await fixture()
    expect(h.runtime.start).not.toHaveBeenCalled()
    expect(await f.call('settings.save', { settings: { mode: 'managed', enabled: true, port: 18317 } })).toMatchObject({ ok: true })
    await f.idle()
    expect(h.runtime.start).toHaveBeenCalledOnce()
    const stopped = h.runtime.stop.mock.calls.length
    await f.service.releaseContext!(randomUUID())
    expect(h.runtime.stop).toHaveBeenCalledTimes(stopped)
    expect(h.runtime.dispose).not.toHaveBeenCalled()
    await f.service.stop()
    expect(h.runtime.dispose).toHaveBeenCalledOnce()
    expect(await f.call('runtime.start')).toEqual({ ok: false, error: 'cpa-stopped' })
  })
  it('migrates a complete snapshot once, preserves legacy originals and starts on demand', async () => {
    const legacy = await directory()
    await mkdir(join(legacy, 'accounts'))
    await writeFile(join(legacy, 'accounts/account.json'), 'login-data')
    await writeFile(join(legacy, 'management-key.enc'), 'encrypted-legacy-key')
    const f = await fixture({ directory: legacy, settings: { mode: 'managed', enabled: true, port: 18318 } })
    expect(h.runtime.start).not.toHaveBeenCalled()
    await f.call('runtime.start'); await f.idle()
    expect(h.runtime.start).toHaveBeenCalledWith(expect.objectContaining({ port: 18318 }))
    expect(await readFile(join(f.root, 'components/accounts/account.json'), 'utf8')).toBe('login-data')
    expect(await readFile(join(f.root, 'components/management-key.enc'), 'utf8')).toBe('encrypted-legacy-key')
    expect(await readFile(join(legacy, 'accounts/account.json'), 'utf8')).toBe('login-data')
    await writeFile(join(legacy, 'accounts/account.json'), 'changed')
    await importCpaData(f.root, { directory: legacy, settings: {} })
    expect(await readFile(join(f.root, 'components/accounts/account.json'), 'utf8')).toBe('login-data')
  })
  it('honors explicit data reset by never reimporting legacy settings', async () => {
    const f = await fixture(null, false)
    expect(f.host.call).not.toHaveBeenCalled()
    expect((await f.call('settings.read')).data).toMatchObject({ mode: 'managed', enabled: false })
  })
  it('rejects linked migration data and never activates a partial snapshot', async () => {
    const root = await directory(), legacy = await directory(), outside = await directory()
    await symlink(outside, join(legacy, 'linked'), 'junction')
    await expect(importCpaData(root, { directory: legacy, settings: null })).rejects.toThrow('cpa-invalid-legacy-directory')
    expect(await readdir(root)).toEqual([])
  })
  it('recovers invalid legacy configuration without changing its original', async () => {
    const legacy = await directory()
    const f = await fixture({ directory: legacy, settings: { managementUrl: 'file:///secret' } })
    expect((await f.call('settings.read')).data).toMatchObject({ mode: 'managed', enabled: false })
  })
  it('reports asynchronous failures, accepts retry and prevents overlapping operations', async () => {
    const f = await fixture()
    h.runtime.start.mockRejectedValueOnce(new Error('cpa-download-failed'))
    await f.call('settings.save', { settings: { mode: 'managed', enabled: true } })
    await f.idle()
    expect((await f.call('runtime.status')).data.operationError).toBe('cpa-download-failed')
    let finish!: () => void
    h.runtime.start.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
    expect(await f.call('runtime.start')).toMatchObject({ ok: true })
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    expect(await f.call('runtime.restart')).toMatchObject({ ok: false, error: 'cpa-operation-in-progress' })
    finish(); await f.idle()
    expect((await f.call('runtime.status')).data.operationError).toBeUndefined()
  })
  it.each(['runtime.stop', 'shutdown'])('does not restart after %s interrupts a queued settings change', async method => {
    const f = await fixture()
    let finish!: () => void
    h.runtime.stop.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
    await f.call('settings.save', { settings: { mode: 'managed', enabled: true } })
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    const stopping = method === 'shutdown' ? f.service.stop() : f.call(method)
    finish(); await stopping
    expect(h.runtime.start).not.toHaveBeenCalled()
  })
  it('does not start, stop or update external processes and forwards only the host-owned page identity', async () => {
    const f = await fixture(), owner = randomUUID()
    await f.call('settings.save', { settings: { mode: 'external', managementUrl: 'localhost:9000' } })
    await f.idle()
    expect(h.runtime.start).not.toHaveBeenCalled()
    const stops = h.runtime.stop.mock.calls.length
    await f.call('runtime.start')
    expect(h.runtime.stop).toHaveBeenCalledTimes(stops)
    expect(await f.call('runtime.update')).toMatchObject({ ok: false })
    await f.call('browser.open', {}, owner)
    expect(f.host.call).toHaveBeenLastCalledWith('desktop.browser.open', { owner, url: 'http://localhost:9000/management.html', direct: false })
    await f.call('browser.bounds', { owner: randomUUID(), rect: { x: 0, y: 0, width: 600, height: 400 } }, owner)
    expect(f.host.call.mock.calls.at(-1)?.[1]).toMatchObject({ owner })
    expect(await f.call('settings.save', { settings: { mode: 'external', managementUrl: 'https://example.test' }, key: 'fixture-key' })).toMatchObject({ ok: false, error: 'cpa-not-managed' })
  })
})
