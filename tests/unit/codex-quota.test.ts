import { afterEach, beforeEach, expect, it, onTestFinished, vi } from 'vitest'
import { CodexQuotaSession, officialLaunch } from '../../src/main/terminal/codex-quota'
import { DesktopCodexConversation } from '../../src/main/terminal/codex-conversation'
import type { CodexRpc } from '../../src/main/terminal/codex-managed-transport'
import type { CodexQuota } from '../../src/shared/codex-quota'

const start = Date.UTC(2026, 10, 25)
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(start) })
afterEach(() => vi.useRealTimers())
const win = (usedPercent: number, windowDurationMins: number, reset?: number) => ({ usedPercent, windowDurationMins, resetsAt: reset })
const snapshot = () => ({ accountId: 'workspace', rateLimits: { limitId: 'codex', primary: win(28, 300), secondary: win(62, 10080) } })

function fixture(id = 'a') {
  const settings: CodexRpc = { config: { model_provider: 'openai' } }
  const identity: CodexRpc = { account: { type: 'chatgpt', email: 'fixture@example.invalid' }, userId: 'user',
    workspaceRouting: { chatgptAccountId: 'workspace', backendOrigin: 'https://chatgpt.com' } }
  const getQuota = vi.fn<() => Promise<CodexRpc>>(async () => snapshot())
  const status = { authMethod: 'chatgpt' }
  const rpc = vi.fn(async (method: string) => {
    if (method === 'config/read') return settings
    if (method === 'account/read') return identity
    if (method === 'getAuthStatus') return status
    if (method === 'account/rateLimits/read') return getQuota()
    throw new Error('Unsupported')
  })
  const emit = vi.fn<(quota: CodexQuota | null) => void>()
  const session = new CodexQuotaSession(id, rpc, emit)
  onTestFinished(() => session.invalidate())
  return { session, rpc, settings, identity, status, getQuota, latest: () => emit.mock.lastCall?.[0] }
}

it.each(['apikey', 'signed out', 'external tokens', 'custom provider', 'custom endpoint', 'custom profile', 'custom backend'])(
  'hides %s and makes zero quota calls', async mode => {
    const f = fixture()
    if (mode === 'apikey') f.identity.account.type = 'apiKey'
    if (mode === 'signed out') f.identity.account = null
    if (mode === 'external tokens') f.status.authMethod = 'chatgptAuthTokens'
    if (mode === 'custom provider') f.settings.config.model_provider = 'janusx_managed'
    if (mode === 'custom endpoint') f.settings.config.openai_base_url = 'https://relay.example/v1'
    if (mode === 'custom profile') Object.assign(f.settings.config, { profile: 'relay', profiles: { relay: { model_provider: 'custom' } } })
    if (mode === 'custom backend') f.identity.workspaceRouting.backendOrigin = 'https://chatgpt.com.example'
    await f.session.read('/tmp', 'visible')
    expect(f.latest()).toBeNull()
    expect(f.getQuota).not.toHaveBeenCalled()
  })

it('shares account requests, tracks freshness per window and throttles manual refresh', async () => {
  const a = fixture(), b = fixture('b')
  await Promise.all([a.session.read('/', 'visible'), b.session.read('/', 'visible')])
  expect(a.getQuota.mock.calls.length + b.getQuota.mock.calls.length).toBe(1)
  expect(b.latest()?.secondary?.used).toBe(62)
  vi.setSystemTime(start + 59_999)
  await b.session.read('/', 'visible')
  expect(b.getQuota).not.toHaveBeenCalled()
  a.session.push({ limitId: 'special-model', primary: win(99, 300) })
  expect(b.latest()?.primary?.used).toBe(28)
  a.session.push({ primary: win(55, 300) })
  expect(b.latest()).toMatchObject({ primary: { updatedAt: start + 59_999 }, secondary: { updatedAt: start } })
  vi.setSystemTime(start + 60_000)
  await b.session.read('/', 'visible')
  expect(b.getQuota).toHaveBeenCalledTimes(1)
  vi.setSystemTime(start + 69_999)
  await a.session.read('/', 'manual')
  expect(a.getQuota).toHaveBeenCalledTimes(1)
  vi.setSystemTime(start + 70_000)
  await a.session.read('/', 'manual')
  expect(a.getQuota).toHaveBeenCalledTimes(2)
  vi.setSystemTime(start + 369_999)
  await b.session.read('/', 'details')
  expect(b.getQuota).toHaveBeenCalledTimes(1)
  vi.setSystemTime(start + 370_000)
  await b.session.read('/', 'details')
  expect(b.getQuota).toHaveBeenCalledTimes(2)
})

it('confirms the reset once, retains old data on failure and respects Retry-After even for manual reads', async () => {
  const f = fixture()
  f.getQuota.mockResolvedValueOnce({ rateLimits: { primary: win(100, 300, start / 1000 + 4) } })
  await f.session.read('/', 'visible')
  expect(f.latest()?.blocked).toBe(false)
  vi.setSystemTime(start + 4000)
  f.getQuota.mockRejectedValueOnce(Object.assign(new Error('HTTP 429'), { data: { headers: { 'Retry-After': '120' } } }))
  await f.session.read('/', 'reset')
  expect(f.latest()).toMatchObject({ unavailable: true, primary: { used: 100 } })
  vi.setSystemTime(start + 100_000)
  await f.session.read('/', 'manual')
  expect(f.getQuota).toHaveBeenCalledTimes(2)
  vi.setSystemTime(start + 124_000)
  f.getQuota.mockResolvedValueOnce({ ordinaryUsageAllowed: false, rateLimits: { primary: win(100, 300, start / 1000 + 4) } })
  await f.session.read('/', 'manual')
  expect(f.latest()?.blocked).toBe(true)
  await f.session.read('/', 'visible')
  expect(f.getQuota).toHaveBeenCalledTimes(3)
})

it('rejects late replies after logout and snapshots from another workspace', async () => {
  const f = fixture()
  let complete!: (value: CodexRpc) => void
  f.getQuota.mockImplementationOnce(() => new Promise(resolve => { complete = resolve }))
  const read = f.session.read('/', 'visible')
  await vi.waitFor(() => expect(complete).toBeTypeOf('function'))
  f.identity.account = null
  f.session.invalidate()
  complete(snapshot()); await read
  f.session.push({ primary: win(71, 300) })
  expect(f.latest()).toBeNull()
  f.identity.account = { type: 'chatgpt' }
  f.getQuota.mockResolvedValueOnce({ ...snapshot(), accountId: 'other' })
  await f.session.read('/', 'visible')
  expect(f.latest()).toBeNull()
})

it('does not let an older full read overwrite a newer push', async () => {
  const f = fixture()
  let complete!: (value: CodexRpc) => void
  f.getQuota.mockImplementationOnce(() => new Promise(resolve => { complete = resolve }))
  const read = f.session.read('/', 'visible')
  await vi.waitFor(() => expect(complete).toBeTypeOf('function'))
  f.session.push({ primary: win(77, 300) })
  complete(snapshot()); await read
  expect(f.latest()).toMatchObject({ primary: { used: 77 }, secondary: { used: 62 } })
})

it('uses the waiting terminal when the owner of a shared request signs out', async () => {
  const a = fixture(), b = fixture('b')
  let finish!: (value: CodexRpc) => void
  a.getQuota.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const first = a.session.read('/', 'visible')
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
  const second = b.session.read('/', 'manual')
  await vi.waitFor(() => expect(b.latest()).toBeTruthy())
  a.session.invalidate()
  finish(snapshot())
  await Promise.all([first, second])
  expect(a.latest()).toBeNull()
  expect(b.getQuota).toHaveBeenCalledTimes(1)
  expect(b.latest()?.primary?.used).toBe(28)
})

it('preserves explicit restrictions and credits across sparse updates until the backend confirms recovery', async () => {
  const f = fixture()
  await f.session.read('/', 'visible')
  expect(f.rpc).toHaveBeenCalledWith('getAuthStatus', { includeToken: false, refreshToken: false })
  f.session.push({ credits: { hasCredits: true } })
  f.session.push({ rateLimitReachedType: 'rate_limit_reached', primary: win(100, 300) })
  expect(f.latest()?.blocked).toBe(false)
  f.session.push({ credits: { hasCredits: false, unlimited: false } })
  expect(f.latest()?.blocked).toBe(true)
  vi.setSystemTime(start + 61_000)
  await f.session.read('/', 'visible')
  expect(f.latest()?.blocked).toBe(true)
  vi.setSystemTime(start + 122_000)
  f.getQuota.mockResolvedValueOnce({ ...snapshot(), ordinaryUsageAllowed: true })
  await f.session.read('/', 'visible')
  expect(f.latest()?.blocked).toBe(false)
})

it('uses the selected thread provider and drops its quota on a live provider change', async () => {
  expect(officialLaunch({ OPENAI_BASE_URL: 'http://127.0.0.1:9876/v1' })).toBe(false)
  const f = fixture()
  const adapter = new DesktopCodexConversation('desktop', () => adapter.syncQuotaThread())
  const wire = adapter as any
  adapter.onQuota = vi.fn()
  wire.quotaCwd = '/tmp'
  wire.call = f.rpc
  wire.attach({ id: 'main', modelProvider: 'openai', turns: [] })
  await adapter.readQuota('visible')
  expect(adapter.onQuota).toHaveBeenLastCalledWith(expect.objectContaining({ quota: expect.objectContaining({ primary: expect.objectContaining({ used: 28 }) }) }))
  wire.receive({ method: 'thread/settings/updated', params: { threadId: 'main', threadSettings: { modelProvider: 'janusx_managed' } } })
  await adapter.readQuota('visible')
  expect(adapter.onQuota).toHaveBeenLastCalledWith({ id: 'desktop', quota: null })
  expect(f.getQuota).toHaveBeenCalledTimes(1)
  await adapter.dispose()
})
