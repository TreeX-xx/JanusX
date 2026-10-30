import { afterEach, describe, expect, it, vi } from 'vitest'
import { ClientRequest, createServer, type Server as HttpServer } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { NativePeer } from '@janusx/plugin-sdk/native'
import { RuntimeProxy, proxyAddress, proxyArgs } from '../../plugins/docker/src/main/runtime-proxy'

vi.mock('node:os', async importOriginal => ({ ...await importOriginal<typeof import('node:os')>(), networkInterfaces: () => ({ fixture: [{ family: 'IPv4', address: '127.0.0.1' }] }) }))
const routes = 'Iface Destination Gateway Flags\neth0 00000000 0100007F 0003\n'
const relays: RuntimeProxy[] = [], roots: string[] = [], servers: HttpServer[] = []
afterEach(async () => {
  await Promise.all(relays.splice(0).map(relay => relay.stop()))
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()) })))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})
function request(url: string, authenticate = true, method = 'GET'): Promise<{ code: number; body: string }> {
  const proxy = new URL(url)
  return new Promise((resolve, reject) => {
    const req = new ClientRequest({ host: proxy.hostname, port: proxy.port, method, path: method === 'CONNECT' ? 'target.invalid:443' : 'http://target.invalid/check', agent: false,
      headers: authenticate ? { 'Proxy-Authorization': 'Basic ' + Buffer.from(`${proxy.username}:${proxy.password}`).toString('base64') } : {},
    }, response => { let body = ''; response.on('data', data => { body += data }); response.on('end', () => resolve({ code: response.statusCode!, body })); response.on('error', reject) })
    req.on('connect', (response, socket) => { socket.destroy(); resolve({ code: response.statusCode!, body: '' }) })
    req.on('error', reject); req.setTimeout(3000, () => req.destroy(new Error('timeout'))); req.end()
  })
}
describe('managed WSL proxy', () => {
  it('selects only an actual host interface default gateway and removes inherited localhost proxies', () => {
    expect(proxyAddress(routes, ['127.0.0.1'])).toBe('127.0.0.1')
    expect(() => proxyAddress(routes, ['172.20.0.1'])).toThrow('docker-runtime-proxy-network')
    expect(() => proxyAddress('Iface Destination Gateway Flags\neth0 00000000 0100007F 0000', ['127.0.0.1'])).toThrow()
    expect(proxyArgs()).toContain('HTTPS_PROXY'); expect(proxyArgs()).not.toContain('HTTPS_PROXY=')
    expect(proxyArgs('http://gateway:123')).toContain('https_proxy=http://gateway:123')
  })
  it('authenticates a real relay, chains requests through host proxy, reuses its endpoint and closes on stop', async () => {
    const upstream = createServer((req, res) => { expect(req.url).toBe('http://target.invalid/check'); res.end('proxied') }); servers.push(upstream)
    const tunnels: string[] = []
    upstream.on('connect', (req, socket) => { tunnels.push(req.url!); socket.end('HTTP/1.1 502 fixture\r\nContent-Length: 0\r\n\r\n') })
    await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve))
    const address = upstream.address() as { port: number }
    const host = { call: vi.fn(async (method: string) => method === 'desktop.environment' ? { HTTPS_PROXY: 'http://127.0.0.1:123' } : `http://127.0.0.1:${address.port}`) } as unknown as NativePeer
    const root = await mkdtemp(join(tmpdir(), 'docker-proxy-')); roots.push(root)
    const relay = new RuntimeProxy(root, host); relays.push(relay)
    const [url, same] = await Promise.all([relay.start(async () => routes), relay.start(async () => routes)])
    expect(url).toBe(same)
    expect((await request(url!, false)).code).toBe(407)
    expect(await request(url!)).toEqual({ code: 200, body: 'proxied' })
    expect((await request(url!, false, 'CONNECT')).code).toBe(407)
    expect(tunnels).toEqual([])
    expect((await request(url!, true, 'CONNECT')).code).toBeGreaterThanOrEqual(500)
    expect(tunnels).toEqual(['target.invalid:443'])
    const stored = JSON.parse(await readFile(join(root, 'proxy.json'), 'utf8'))
    expect(stored.port).toBe(Number(new URL(url!).port)); expect(stored).not.toHaveProperty('upstream')
    await relay.stop(); await expect(request(url!)).rejects.toThrow()
    const restarted = new RuntimeProxy(root, host); relays.push(restarted)
    expect(await restarted.start(async () => routes)).toBe(url)
    expect((await request(url!)).body).toBe('proxied')
  })
  it('does not expose a listener or inspect Linux routes when the host has no proxy', async () => {
    const relay = new RuntimeProxy('unused', { call: vi.fn(async () => ({})) } as unknown as NativePeer); relays.push(relay)
    const inspect = vi.fn(async () => routes)
    expect(await relay.start(inspect)).toBeUndefined(); expect(inspect).not.toHaveBeenCalled()
    await relay.stop(); await expect(relay.start(inspect)).rejects.toThrow('docker-runtime-cancelled')
  })
})
