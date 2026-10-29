import { createHash } from 'node:crypto'
import { open, rename, rm } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { ProxyAgent, fetch } from 'undici'
import type { NativePeer } from '@janusx/plugin-sdk/native'

// Ubuntu's official SHA256SUMS, checked 2026-10-29. Updating the rootfs requires changing both pins.
export const rootfsAssets = {
  x64: { name: 'ubuntu-base-24.04.5-base-amd64.tar.gz', sha256: 'e77b6f10c2590cef872b33ee9f635a0e3fd1f57fb074c0e52b5c7f56147a0c86' },
  arm64: { name: 'ubuntu-base-24.04.5-base-arm64.tar.gz', sha256: 'a91d5a93010193712d346d761372b7c9db6dfcf093893161c64ca107f05914f2' },
} as const
export async function hashFile(file: string): Promise<string> {
  const hash = createHash('sha256'); for await (const chunk of createReadStream(file)) hash.update(chunk); return hash.digest('hex')
}
export type DownloadRootfs = (file: string, signal: AbortSignal, progress: (percent: number) => void) => Promise<void>
export function rootfsDownloader(host: NativePeer, architecture: string): DownloadRootfs {
  return async (file, signal, progress) => {
    const asset = rootfsAssets[architecture as keyof typeof rootfsAssets]
    if (!asset) throw new Error('docker-runtime-unsupported')
    if (await hashFile(file).catch(() => '') === asset.sha256) return
    const temporary = file + '.part'
    const dispatcher = new ProxyAgent(await host.call('desktop.proxy', null) as string)
    try {
      const response = await fetch(`https://cdimage.ubuntu.com/ubuntu-base/releases/24.04/release/${asset.name}`, {
        dispatcher, signal: AbortSignal.any([signal, AbortSignal.timeout(600_000)]), redirect: 'error', headers: { 'User-Agent': 'JanusX' },
      })
      if (!response.ok || !response.body) { await response.body?.cancel(); throw new Error('docker-runtime-download-failed') }
      const limit = 256 * 1024 * 1024, declared = Number(response.headers.get('content-length'))
      if (declared > limit) { await response.body.cancel(); throw new Error('docker-output-limit') }
      const output = await open(temporary, 'w'), hash = createHash('sha256')
      let size = 0
      try {
        for await (const chunk of response.body) {
          size += chunk.length; if (size > limit) throw new Error('docker-output-limit')
          hash.update(chunk); await output.writeFile(chunk)
          if (declared > 0) progress(Math.min(99, Math.floor(size / declared * 100)))
        }
      } finally { await output.close() }
      if (hash.digest('hex') !== asset.sha256) throw new Error('docker-runtime-checksum-failed')
      await rename(temporary, file); progress(100)
    } finally { await rm(temporary, { force: true }); await dispatcher.close() }
  }
}
