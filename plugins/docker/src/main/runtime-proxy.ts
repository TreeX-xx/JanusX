import { randomBytes } from 'node:crypto'
import { networkInterfaces } from 'node:os'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Server } from 'proxy-chain'
import type { NativePeer } from '@janusx/plugin-sdk/native'
import { writeFileAtomic } from '@janusx/plugin-sdk/native'

/** NAT's default gateway must be one of Windows' own interface addresses. */
export function proxyAddress(routes: string, addresses: string[]): string {
  for (const line of routes.split(/\r?\n/).slice(1)) {
    const [, destination, gateway, flags] = line.trim().split(/\s+/)
    if (destination !== '00000000' || !/^[a-f0-9]{8}$/i.test(gateway ?? '') || !(parseInt(flags, 16) & 2)) continue
    const address = gateway.match(/../g)!.reverse().map(byte => parseInt(byte, 16)).join('.')
    if (addresses.includes(address)) return address
  }
  throw new Error('docker-runtime-proxy-network')
}
export class RuntimeProxy {
  private server?: Server
  private stopped = false
  private pending?: Promise<string | undefined>
  constructor(private root: string, private host: NativePeer) {}
  start(routes: () => Promise<string>): Promise<string | undefined> {
    return this.pending ??= this.open(routes).finally(() => { this.pending = undefined })
  }
  private async open(routes: () => Promise<string>): Promise<string | undefined> {
    if (this.stopped) throw new Error('docker-runtime-cancelled')
    if (this.server) return this.url
    const environment = await this.host.call('desktop.environment', null) as Record<string, string> | null
    if (!environment?.HTTPS_PROXY && !environment?.HTTP_PROXY) return undefined
    const address = proxyAddress(await routes(), Object.values(networkInterfaces()).flatMap(items => (items ?? []).filter(item => item.family === 'IPv4').map(item => item.address)))
    const upstream = await this.host.call('desktop.proxy', null) as string
    // Stable credentials and port let an existing daemon reconnect after plugin reactivation.
    const file = join(this.root, 'proxy.json')
    let saved: { password: string; port: number }
    try {
      saved = JSON.parse(await readFile(file, 'utf8'))
      if (!/^[a-f0-9]{64}$/.test(saved.password) || !Number.isInteger(saved.port) || saved.port < 1024 || saved.port > 65535) throw new Error('docker-runtime-proxy-config')
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause
      saved = { password: randomBytes(32).toString('hex'), port: 0 }
    }
    if (this.stopped) throw new Error('docker-runtime-cancelled')
    const server = new Server({ host: address, port: saved.port, verbose: false,
      prepareRequestFunction: ({ username, password }) => username === 'janusx' && password === saved.password ? { upstreamProxyUrl: upstream } : { requestAuthentication: true },
    })
    this.server = server
    try {
      await server.listen()
      if (this.stopped) throw new Error('docker-runtime-cancelled')
      await writeFileAtomic(file, JSON.stringify({ ...saved, port: server.port }))
      return this.url = `http://janusx:${saved.password}@${address}:${server.port}`
    } catch { if (server.server.listening) await server.close(true); this.server = undefined; throw new Error('docker-runtime-proxy-unavailable') }
  }
  private url?: string
  async stop(): Promise<void> { this.stopped = true; const server = this.server; this.server = undefined; if (server?.server.listening) await server.close(true) }
}

/** Pass the relay only to this command; never write Windows proxy settings or user apt files. */
export function proxyArgs(url?: string): string[] {
  return ['/usr/bin/env', '-u', 'HTTP_PROXY', '-u', 'HTTPS_PROXY', '-u', 'ALL_PROXY', '-u', 'http_proxy', '-u', 'https_proxy', '-u', 'all_proxy',
    ...(url ? [`HTTP_PROXY=${url}`, `HTTPS_PROXY=${url}`, `http_proxy=${url}`, `https_proxy=${url}`, 'NO_PROXY=localhost,127.0.0.1,::1', 'no_proxy=localhost,127.0.0.1,::1'] : [])]
}
