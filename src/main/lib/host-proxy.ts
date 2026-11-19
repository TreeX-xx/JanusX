// Shared host proxy routing; respects application and NO_PROXY settings.
import { randomBytes } from 'node:crypto'
import { BlockList, isIP } from 'node:net'
import { Agent as HttpAgent } from 'node:http'
import { Agent as HttpsAgent } from 'node:https'
import { Server } from 'proxy-chain'
import { getProxyManager, getSystemProxy } from '@janusx/llm-core'
import { macProxyEnvironment } from '@janusx/llm-core/mac-system-proxy'

export function hostProxyEnvironment(): NodeJS.ProcessEnv {
  const env = process.platform === 'darwin' ? macProxyEnvironment(process.env) : process.env
  const proxy = getProxyManager().getProxyUrl() ?? (env === process.env ? getSystemProxy(env) : null)
  const http = proxy ?? env.HTTP_PROXY
  const https = proxy ?? env.HTTPS_PROXY
  const bypass = [...new Set([
    ...(env.NO_PROXY ?? '').split(','), ...(env.no_proxy ?? '').split(','),
    'localhost', '127.0.0.1', '::1',
  ].map((entry) => entry.trim()).filter(Boolean))].join(',')
  return {
    ...(http ? { HTTP_PROXY: http, http_proxy: http } : {}),
    ...(https ? { HTTPS_PROXY: https, https_proxy: https } : {}),
    NO_PROXY: bypass, no_proxy: bypass,
  }
}

/** Standard NO_PROXY host, suffix, wildcard and optional port entries; loopback is always direct. */
export function hostBypassesProxy(hostname: string, port: number, bypass = hostProxyEnvironment().NO_PROXY ?? ''): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host === '::1' || /^127(?:\.\d{1,3}){3}$/.test(host)) return true
  return bypass.toLowerCase().split(/[,\s]+/).filter(Boolean).some((entry) => {
    if (entry === '*') return true
    if (entry.includes('/')) {
      const [address, prefix] = entry.split('/')
      if (!isIP(address) || !isIP(host) || !/^\d+$/.test(prefix ?? '')) return false
      try {
        const block = new BlockList()
        block.addSubnet(address, Number(prefix), isIP(address) === 6 ? 'ipv6' : 'ipv4')
        return block.check(host, isIP(host) === 6 ? 'ipv6' : 'ipv4')
      } catch { return false }
    }
    const match = /^(\[[^\]]+\]|[^:]+):(\d+)$/.exec(entry)
    if (match && Number(match[2]) !== port) return false
    const target = (match ? match[1] : entry).replace(/^\[|\]$/g, '')
    if (target.startsWith('*')) return host.endsWith(target.slice(1))
    if (target.startsWith('.')) return host.endsWith(target)
    return host === target || !isIP(target) && host.endsWith(`.${target}`)
  })
}

/** An authenticated local exit for consumers without host proxy hooks. */
export class HostProxy {
  private server?: Server
  private listening?: Promise<void>
  private readonly httpAgent = new HttpAgent()
  private readonly httpsAgent = new HttpsAgent()

  async start(): Promise<string> {
    const password = randomBytes(32).toString('hex')
    const server = new Server({ host: '127.0.0.1', port: 0, verbose: false,
      prepareRequestFunction: ({ username, password: supplied, hostname, port, isHttp }) => {
        if (username !== 'janusx' || supplied !== password) return { requestAuthentication: true }
        const env = hostProxyEnvironment()
        return {
          upstreamProxyUrl: hostBypassesProxy(hostname, port, env.NO_PROXY) ? undefined : (isHttp ? env.HTTP_PROXY : env.HTTPS_PROXY),
          // These connections already target the chosen exit; never apply the host hook again.
          httpAgent: this.httpAgent, httpsAgent: this.httpsAgent,
        }
      },
    })
    this.server = server
    this.listening = server.listen()
    try { await this.listening } catch { await this.close(); throw new Error('HOST_PROXY_UNAVAILABLE') }
    return `http://janusx:${password}@127.0.0.1:${server.port}`
  }

  async close(): Promise<void> {
    const server = this.server
    this.server = undefined
    await this.listening?.catch(() => {})
    if (server?.server.listening) await server.close(true)
    this.httpAgent.destroy(); this.httpsAgent.destroy()
  }
}
