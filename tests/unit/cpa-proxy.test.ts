import { afterEach, describe, expect, it, vi } from 'vitest'
import { ClientRequest, createServer, type Server } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import { connect } from 'node:net'
import { generate } from 'selfsigned'
import { ProxyAgent } from 'undici'
import { HostProxy as CpaProxy, hostBypassesProxy as cpaBypassesProxy } from '../../src/main/lib/host-proxy'
import { connectDesktop } from '../../plugins/cpa/src/main/desktop'
import type { NativePeer } from '@janusx/plugin-sdk/native'
import { cpaLocalRequest } from '../../plugins/cpa/src/main/local-request'
import { downloadCpaAsset } from '../../plugins/cpa/src/main/installer'

const h = vi.hoisted(() => ({ proxy: null as string | null }))
vi.mock('@janusx/llm-core', () => ({ getProxyManager: () => ({ getProxyUrl: () => h.proxy }), getSystemProxy: () => null }))
const servers: Server[] = [], relays: CpaProxy[] = []
afterEach(async () => {
  await Promise.all(relays.splice(0).map((relay) => relay.close()))
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()) })))
  h.proxy = null; vi.unstubAllEnvs()
})
async function listen(server: Server) {
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return (server.address() as { port: number }).port
}
async function relay() { const value = new CpaProxy(); relays.push(value); return new URL(await value.start()) }
function request(proxy: URL, target: string, authenticate = true, method = 'GET'): Promise<{ code: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = new ClientRequest({ host: proxy.hostname, port: proxy.port, method, path: target, agent: false,
      headers: authenticate ? { 'Proxy-Authorization': 'Basic ' + Buffer.from(`${proxy.username}:${proxy.password}`).toString('base64') } : {},
    }, (res) => {
      let body = ''; res.setEncoding('utf8'); res.on('data', (data: string) => { body += data })
      res.on('end', () => resolve({ code: res.statusCode!, body })); res.on('error', reject)
    })
    req.on('connect', (res, socket) => { socket.destroy(); resolve({ code: res.statusCode!, body: '' }) })
    req.on('error', reject); req.setTimeout(3000, () => req.destroy(new Error('fixture-timeout'))); req.end()
  })
}

describe('CPA proxy exit', () => {
  it('releases the listener when shutdown overlaps startup', async () => {
    const value = new CpaProxy(); relays.push(value)
    const starting = value.start()
    await value.close()
    const url = new URL(await starting)
    await expect(new Promise((resolve, reject) => {
      const socket = connect(Number(url.port), url.hostname, () => { socket.destroy(); resolve(true) }); socket.on('error', reject)
    })).rejects.toMatchObject({ code: 'ECONNREFUSED' })
  })
  it('authenticates the local relay, uses the current upstream and forwards proxy auth only upstream', async () => {
    const seen: { url: string; auth?: string }[] = []
    const port = await listen(createServer((req, res) => {
      seen.push({ url: req.url!, auth: req.headers['proxy-authorization'] }); res.end('quota-fixture')
    }))
    const proxy = await relay()
    h.proxy = `http://test-user:test-password@127.0.0.1:${port}`
    expect((await request(proxy, 'http://quota.invalid/usage', false)).code).toBe(407)
    expect(seen).toHaveLength(0)
    expect(await request(proxy, 'http://quota.invalid/usage')).toEqual({ code: 200, body: 'quota-fixture' })
    expect(seen).toEqual([{ url: 'http://quota.invalid/usage', auth: 'Basic ' + Buffer.from('test-user:test-password').toString('base64') }])
    const next = await listen(createServer((_req, res) => res.end('changed-exit')))
    h.proxy = `http://127.0.0.1:${next}`
    expect((await request(proxy, 'http://quota.invalid/subscriptions')).body).toBe('changed-exit')
  })

  it('keeps loopback and NO_PROXY direct, including when an upstream is unavailable', async () => {
    const port = await listen(createServer((req, res) => { expect(req.headers['proxy-authorization']).toBeUndefined(); res.end('local') }))
    h.proxy = 'http://127.0.0.1:1'
    expect(await request(await relay(), `http://127.0.0.1:${port}/`)).toEqual({ code: 200, body: 'local' })
    vi.stubEnv('NO_PROXY', '*')
    if (process.platform !== 'win32') vi.stubEnv('no_proxy', '*')
    expect(await request(await relay(), `http://localhost:${port}/`)).toEqual({ code: 200, body: 'local' })
  })

  it('tunnels CONNECT through the upstream and releases the relay listener on close', async () => {
    const targets: string[] = []
    const upstream = createServer()
    upstream.on('connect', (req, socket) => { targets.push(req.url!); socket.end('HTTP/1.1 502 fixture\r\nContent-Length: 0\r\n\r\n') })
    h.proxy = `http://127.0.0.1:${await listen(upstream)}`
    const proxy = await relay()
    expect((await request(proxy, 'chatgpt.com:443', true, 'CONNECT')).code).toBeGreaterThanOrEqual(500)
    expect(targets).toEqual(['chatgpt.com:443'])
    await relays.at(-1)!.close()
    await expect(new Promise((resolve, reject) => {
      const socket = connect(Number(proxy.port), proxy.hostname, () => { socket.destroy(); resolve(true) }); socket.on('error', reject)
    })).rejects.toMatchObject({ code: 'ECONNREFUSED' })
  })

  it('passes an HTTPS response through the complete relay chain with certificate validation', async () => {
    const pem = await generate([{ name: 'commonName', value: 'quota-fixture.invalid' }], { extensions: [
      { name: 'basicConstraints', cA: true }, { name: 'subjectAltName', altNames: [{ type: 2, value: 'quota-fixture.invalid' }] },
    ] })
    const target = await listen(createHttpsServer({ key: pem.private, cert: pem.cert }, (_request, response) => response.end('secure-quota-fixture')))
    const upstream = createServer()
    upstream.on('connect', (_req, socket) => {
      const remote = connect(target, '127.0.0.1', () => {
        socket.write('HTTP/1.1 200 Connection Established\r\n\r\n'); remote.pipe(socket); socket.pipe(remote)
      })
      socket.on('error', () => remote.destroy()); remote.on('error', () => socket.destroy())
      socket.on('close', () => remote.destroy()); remote.on('close', () => socket.destroy())
    })
    h.proxy = `http://127.0.0.1:${await listen(upstream)}`
    const dispatcher = new ProxyAgent({ uri: (await relay()).href, requestTls: { ca: pem.cert } })
    try {
      const options: RequestInit & { dispatcher: ProxyAgent } = { dispatcher, signal: AbortSignal.timeout(3000) }
      expect(await (await fetch('https://quota-fixture.invalid/usage', options)).text()).toBe('secure-quota-fixture')
    } finally { await dispatcher.destroy() }
  })

  it.each([
    ['localhost', 80, '', true], ['::1', 8317, '', true], ['127.0.0.2', 1455, '', true],
    ['api.example.test', 443, '.example.test', true], ['example.test', 443, '.example.test', false],
    ['example.test', 443, 'example.test:443', true], ['example.test', 80, 'example.test:443', false],
    ['api.example.test', 443, '*.example.test', true], ['evil-example.test', 443, '*.example.test', false],
    ['2001:db8::1', 443, '[2001:db8::1]:443', true],
    ['10.1.2.3', 443, '10.0.0.0/8', true], ['11.1.2.3', 443, '10.0.0.0/8', false],
    ['2001:db8::2', 443, '2001:db8::/32', true], ['api.example.test', 443, 'example.test', true],
  ])('matches bypass %s:%s against %s', (host, port, rules, expected) => {
    expect(cpaBypassesProxy(host, port, rules)).toBe(expected)
  })

  it('requests local management directly, validates responses and rejects remote destinations', async () => {
    const port = await listen(createServer((req, res) => {
      expect(req.headers.authorization).toBe('Bearer fixture-key')
      res.end(req.url === '/bad' ? 'invalid-json' : JSON.stringify({ status: 'ok' }))
    }))
    const signal = AbortSignal.timeout(3000)
    expect(await cpaLocalRequest(`http://127.0.0.1:${port}/status`, signal, 'fixture-key', true)).toEqual({ ok: true, status: 'ok' })
    await expect(cpaLocalRequest(`http://127.0.0.1:${port}/bad`, signal, 'fixture-key', true)).rejects.toThrow('cpa-invalid-response')
    await expect(cpaLocalRequest('https://remote.invalid/', signal, 'fixture-key')).rejects.toThrow('cpa-invalid-local-url')
  })

  it('uses the same exit for first-enable downloads and preserves size and abort limits', async () => {
    const upstream = createServer()
    const destination = createServer((_req, res) => res.end('component-fixture'))
    const port = await listen(destination)
    const targets: string[] = []
    upstream.on('connect', (req, socket) => {
      targets.push(req.url!)
      const remote = connect(port, '127.0.0.1', () => {
        socket.write('HTTP/1.1 200 Connection Established\r\n\r\n'); remote.pipe(socket); socket.pipe(remote)
      })
      socket.on('error', () => remote.destroy()); remote.on('error', () => socket.destroy())
      socket.on('close', () => remote.destroy()); remote.on('close', () => socket.destroy())
    })
    h.proxy = `http://127.0.0.1:${await listen(upstream)}`
    connectDesktop({ call: async () => (await relay()).href } as unknown as NativePeer)
    const signal = AbortSignal.timeout(3000)
    expect((await downloadCpaAsset('http://download.invalid/component', 100, signal)).toString()).toBe('component-fixture')
    expect(targets).toContain('download.invalid:80')
    await expect(downloadCpaAsset('http://download.invalid/large', 1, signal)).rejects.toThrow('cpa-download-oversized')
    await expect(downloadCpaAsset('http://download.invalid/aborted', 100, AbortSignal.abort())).rejects.toThrow()
  })
})
