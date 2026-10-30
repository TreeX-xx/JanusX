import { ProxyAgent } from 'undici'
import { CpaProxy as HostProxy } from './desktop'

export type HostDownload = (url: string, limit: number, signal: AbortSignal, progress?: (percent: number) => void) => Promise<Buffer>

/** Bounded downloads use the application's proxy even before model services initialize. */
export const downloadHostAsset: HostDownload = async (url, limit, signal, progress) => {
  if (!Number.isSafeInteger(limit) || limit <= 0) throw new Error('DOWNLOAD_OVERSIZED')
  const relay = new HostProxy()
  let dispatcher: ProxyAgent | undefined
  try {
    signal.throwIfAborted()
    dispatcher = new ProxyAgent(await relay.start())
    const timeout = AbortSignal.timeout(180_000)
    const options: RequestInit & { dispatcher: ProxyAgent } = {
      dispatcher, signal: AbortSignal.any([signal, timeout]), headers: { 'User-Agent': 'JanusX' }, redirect: 'manual',
    }
    let target = new URL(url)
    const secure = target.protocol === 'https:'
    for (let redirects = 0; redirects <= 5; redirects++) {
      if (!['http:', 'https:'].includes(target.protocol) || secure && target.protocol !== 'https:' || target.username || target.password) throw new Error('DOWNLOAD_FAILED')
      const response = await fetch(target, options)
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        await response.body?.cancel()
        const location = response.headers.get('location')
        if (!location) throw new Error('DOWNLOAD_FAILED')
        target = new URL(location, target)
        continue
      }
      if (!response.ok || !response.body) { await response.body?.cancel(); throw new Error('DOWNLOAD_FAILED') }
      const declared = Number(response.headers.get('content-length'))
      if (declared > limit) { await response.body.cancel(); throw new Error('DOWNLOAD_OVERSIZED') }
      const chunks: Buffer[] = []
      let total = 0
      const reader = response.body.getReader()
      try {
        while (true) {
          const item = await reader.read()
          if (item.done) break
          total += item.value.byteLength
          if (total > limit) throw new Error('DOWNLOAD_OVERSIZED')
          chunks.push(Buffer.from(item.value))
          if (declared > 0) progress?.(Math.min(99, Math.floor(total / declared * 100)))
        }
      } finally { await reader.cancel().catch(() => {}) }
      return Buffer.concat(chunks)
    }
    throw new Error('DOWNLOAD_FAILED')
  } catch (cause) {
    if (signal.aborted) throw signal.reason
    if (cause instanceof Error && cause.message === 'DOWNLOAD_OVERSIZED') throw cause
    if (cause instanceof Error && cause.name === 'TimeoutError') throw new Error('DOWNLOAD_TIMEOUT')
    throw new Error('DOWNLOAD_FAILED')
  } finally { await dispatcher?.destroy(); await relay.close() }
}
