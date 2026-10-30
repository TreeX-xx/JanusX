import { afterEach, describe, expect, it, vi } from 'vitest'
import { createServer } from 'node:net'
import type { Session } from 'electron'
import { BrowserOAuthBridge, probeOAuthPort } from '../../src/main/plugins/browser-oauth'

const oauth = { prefix: '/v8/management/oauth/', auth: '/v8/management/oauth/auth-url', status: '/v8/management/oauth/status', session: '/v8/management/oauth/session',
  providers: { codex: {port:1455,urls:['https://auth.openai.com/oauth/authorize']}, claude: {port:54545,urls:['https://claude.ai/oauth/authorize']}, antigravity: {port:51121,urls:['https://accounts.google.com/o/oauth2/auth','https://accounts.google.com/o/oauth2/v2/auth']} } }
const bridges: BrowserOAuthBridge[] = []
afterEach(() => { bridges.splice(0).forEach((bridge) => bridge.dispose()); vi.useRealTimers() })
function fixture(reason: 'restricted' | 'occupied' | 'unavailable' | undefined = 'restricted') {
  const onBeforeRequest = vi.fn()
  const onCompleted = vi.fn(), onErrorOccurred = vi.fn()
  const report = vi.fn()
  const status = vi.fn(async (_state: string, _signal: AbortSignal): Promise<string | undefined> => 'wait')
  const probe = vi.fn(async () => reason)
  const bridge = new BrowserOAuthBridge({ webRequest: { onBeforeRequest, onCompleted, onErrorOccurred } } as unknown as Session,
    'http://127.0.0.1:8317', report, oauth, probe, status)
  bridges.push(bridge)
  const handler = onBeforeRequest.mock.calls[0][1] as (details: unknown, callback: (response: unknown) => void) => void
  const request = (url: string, method = 'GET', id = 1) => new Promise<any>((resolve) => handler({ url, method, id }, resolve))
  const complete = (url: string, method = 'GET', id = 1, statusCode = 200) => onCompleted.mock.calls[0][1]({ url, method, id, statusCode })
  return { bridge, request, complete, report, status, probe, onBeforeRequest, onCompleted, onErrorOccurred }
}

describe('CPA OAuth callback fallback', () => {
  it.each([['codex', 1455], ['claude', 54545], ['antigravity', 51121]])('uses the existing manual callback flow for %s when restricted', async (provider, port) => {
    const { request, probe, report } = fixture()
    const result = await request(`http://127.0.0.1:8317/v8/management/oauth/auth-url?provider=${provider}&is_webui=true`)
    expect(probe).toHaveBeenCalledWith(port)
    expect(new URL(result.redirectURL).searchParams.get('is_webui')).toBe('false')
    expect(new URL(result.redirectURL).searchParams.get('provider')).toBe(provider)
    expect(report).toHaveBeenCalledWith({ provider, port, reason: 'restricted' })
  })

  it('keeps available ports on the original automatic callback flow', async () => {
    const f = fixture()
    f.probe.mockResolvedValue(undefined)
    expect(await f.request('http://127.0.0.1:8317/v8/management/oauth/auth-url?provider=codex&is_webui=true')).toEqual({})
    expect(f.report).toHaveBeenCalledWith(undefined)
  })

  it.each(['occupied', 'unavailable'] as const)('reports %s without taking over an existing listener', async (reason) => {
    const { request, report } = fixture(reason)
    await request('http://127.0.0.1:8317/v8/management/oauth/auth-url?provider=codex&is_webui=1')
    expect(report).toHaveBeenCalledWith({ provider: 'codex', port: 1455, reason })
  })

  it.each([
    'http://127.0.0.1:8317/v8/management/oauth/auth-url?provider=xai&is_webui=true',
    'http://127.0.0.1:8317/v8/management/oauth/auth-url?provider=codex&is_webui=false',
    'http://127.0.0.1:8317/v8/management/oauth/callback?provider=codex&is_webui=true',
    'http://127.0.0.1:9000/v8/management/oauth/auth-url?provider=codex&is_webui=true',
  ])('leaves unrelated requests untouched', async (url) => {
    const { request, probe } = fixture()
    expect(await request(url)).toEqual({})
    expect(probe).not.toHaveBeenCalled()
  })

  it('cancels an in-flight probe when its page is disposed and removes the session listener', async () => {
    const f = fixture()
    let finish!: (value: 'restricted') => void
    f.probe.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    const result = f.request('http://127.0.0.1:8317/v8/management/oauth/auth-url?provider=codex&is_webui=true')
    f.bridge.dispose(); finish('restricted')
    expect(await result).toEqual({ cancel: true })
    expect(f.report).toHaveBeenLastCalledWith(undefined)
    expect(f.onBeforeRequest).toHaveBeenLastCalledWith(null)
    expect(f.onCompleted).toHaveBeenLastCalledWith(null)
    expect(f.onErrorOccurred).toHaveBeenLastCalledWith(null)
  })

  it.each(['ok', 'error'])('clears only after the matching session reaches %s, not callback acceptance', async (terminal) => {
    const f = fixture()
    const auth = 'http://127.0.0.1:8317/v8/management/oauth/auth-url?provider=codex&is_webui=true'
    await f.request(auth); f.complete(auth)
    await f.request('http://127.0.0.1:8317/v8/management/oauth/status?state=first')
    await vi.waitFor(() => expect(f.status).toHaveBeenCalledOnce())
    expect(f.report.mock.calls.at(-1)?.[0]?.provider).toBe('codex')
    await f.request('http://127.0.0.1:8317/v8/management/oauth/callback', 'POST')
    expect(f.report.mock.calls.at(-1)?.[0]?.provider).toBe('codex')
    f.status.mockResolvedValue(terminal)
    await f.request('http://127.0.0.1:8317/v8/management/oauth/status?state=first')
    await vi.waitFor(() => expect(f.report).toHaveBeenLastCalledWith(undefined))
  })

  it('ignores old polls and delayed results after a newer flow begins', async () => {
    const f = fixture()
    const auth = 'http://127.0.0.1:8317/v8/management/oauth/auth-url?provider=codex&is_webui=true'
    let finish!: (value: string) => void
    f.status.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    await f.request(auth); f.complete(auth)
    await f.request('http://127.0.0.1:8317/v8/management/oauth/status?state=old')
    await f.request(auth, 'GET', 2); f.complete(auth, 'GET', 2)
    finish('ok')
    await f.request('http://127.0.0.1:8317/v8/management/oauth/status?state=old')
    expect(f.status).toHaveBeenCalledOnce()
    expect(f.report.mock.calls.at(-1)?.[0]?.provider).toBe('codex')
    await f.request('http://127.0.0.1:8317/v8/management/oauth/status?state=new')
    expect(f.status).toHaveBeenCalledTimes(2)
  })

  it('clears confirmed cancellation and expires abandoned notices', async () => {
    vi.useFakeTimers()
    const f = fixture()
    const auth = 'http://127.0.0.1:8317/v8/management/oauth/auth-url?provider=codex&is_webui=true'
    await f.request(auth); f.complete(auth)
    f.bridge.observeAuthorization('https://auth.openai.com/oauth/authorize?state=cancel-me')
    f.complete('http://127.0.0.1:8317/v8/management/oauth/session?state=other', 'DELETE', 3)
    expect(f.report.mock.calls.at(-1)?.[0]?.provider).toBe('codex')
    f.complete('http://127.0.0.1:8317/v8/management/oauth/session?state=cancel-me', 'DELETE', 4)
    expect(f.report).toHaveBeenLastCalledWith(undefined)
    await f.request(auth, 'GET', 2); f.complete(auth, 'GET', 2)
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    expect(f.report).toHaveBeenLastCalledWith(undefined)
  })

  it('probes an occupied real listener without terminating or replacing it', async () => {
    const server = createServer()
    await new Promise<void>((resolve) => server.listen(0, '0.0.0.0', resolve))
    const port = (server.address() as { port: number }).port
    try {
      expect(await probeOAuthPort(port)).toBe('occupied')
      expect(server.listening).toBe(true)
    } finally { await new Promise<void>((resolve) => server.close(() => resolve())) }
    expect(await probeOAuthPort(port)).toBeUndefined()
  })

  it('clears failed link generation and ignores status results after disposal', async () => {
    const f = fixture()
    const auth = 'http://127.0.0.1:8317/v8/management/oauth/auth-url?provider=codex&is_webui=true'
    await f.request(auth); f.complete(auth, 'GET', 1, 500)
    expect(f.report).toHaveBeenLastCalledWith(undefined)
    let finish!: (value: string) => void
    f.status.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    await f.request(auth, 'GET', 2); f.complete(auth, 'GET', 2)
    await f.request('http://127.0.0.1:8317/v8/management/oauth/status?state=dispose-me')
    const signal = f.status.mock.calls[0][1]
    const calls = f.report.mock.calls.length
    f.bridge.dispose(); finish('ok')
    await Promise.resolve()
    expect(signal.aborted).toBe(true)
    expect(f.report).toHaveBeenCalledTimes(calls)
  })
})
