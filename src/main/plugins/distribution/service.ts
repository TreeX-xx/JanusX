// Note: .agents/notes/planning/blueprint-official-plugin.md — catalog and download ownership stays in the host.
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PLUGIN_API_VERSION } from '@janusx/plugin-sdk'
import type { PluginCatalogEntry, PluginDistributionSnapshot } from '../../../shared/ipc/plugins'
import { SerialQueue, writeFileAtomic } from '../../lib/atomic-file'
import { assertPluginCompatibility, pluginDownloadBytes, verifyPluginCatalog, type PluginTrustKeys, type SignedPluginPayload } from './package'

export interface PluginDownload {
  (url: string, limit: number, signal: AbortSignal, progress?: (value: number) => void): Promise<Buffer>
}
export interface PluginDistributionDeps {
  directory: string; catalogUrl: string; keys: PluginTrustKeys; hostVersion: string; platform: string
  download: PluginDownload
  install(archive: Buffer, release: SignedPluginPayload): Promise<void>
  changed(): void
}
export class PluginDistributionService {
  private catalog?: ReturnType<typeof verifyPluginCatalog>
  private envelope?: SignedPluginPayload
  private queue = new SerialQueue()
  private operation?: { id: string; controller: AbortController; percent: number; phase: 'downloading' | 'installing' }
  private error?: string
  private disposed = false
  private lifetime = new AbortController()
  constructor(private deps: PluginDistributionDeps) {}
  snapshot(): PluginDistributionSnapshot {
    const entries: PluginCatalogEntry[] = (this.catalog?.releases ?? []).map(({ release, envelope }) => {
      let compatible = true
      try { assertPluginCompatibility(release, this.deps.hostVersion, PLUGIN_API_VERSION, this.deps.platform) } catch { compatible = false }
      return { id: release.id, name: release.name, description: release.description, version: release.version,
        publisher: release.publisher, bytes: pluginDownloadBytes(release, envelope), compatible }
    })
    return { configured: Boolean(this.deps.catalogUrl && Object.keys(this.deps.keys).length), entries,
      expiresAt: this.catalog?.expiresAt, error: this.error,
      expired: this.catalog ? Date.parse(this.catalog.expiresAt) <= Date.now() : false,
      operation: this.operation ? { id: this.operation.id, percent: this.operation.percent, phase: this.operation.phase } : undefined }
  }
  initialize(): Promise<void> {
    return this.queue.run(async () => {
      try {
        const saved = JSON.parse(await readFile(join(this.deps.directory, 'catalog.json'), 'utf8'))
        // Retain the authenticated sequence even after expiry. Local unsigned counters are not authority.
        this.catalog = verifyPluginCatalog(saved.envelope, this.deps.keys, 0, Date.now(), true)
        this.envelope = saved.envelope
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') this.error = 'CATALOG_UNAVAILABLE'
      }
    })
  }
  refresh(): Promise<void> {
    return this.queue.run(async () => { try { await this.fetchCatalog() } finally { this.deps.changed() } })
  }
  private async fetchCatalog(signal = AbortSignal.timeout(30_000)): Promise<void> {
    if (this.disposed) throw new Error('INSTALLATION_CANCELLED')
    signal = AbortSignal.any([signal, this.lifetime.signal, AbortSignal.timeout(30_000)])
    if (!this.snapshot().configured) throw new Error('DISTRIBUTION_NOT_CONFIGURED')
    try {
      const url = new URL(this.deps.catalogUrl)
      if (url.protocol !== 'https:' || url.username || url.password) throw new Error('INVALID_CATALOG_URL')
      const bytes = await this.deps.download(url.href, 2 * 1024 * 1024, signal)
      const envelope: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
      const catalog = verifyPluginCatalog(envelope, this.deps.keys, this.catalog?.sequence ?? 0)
      if (catalog.sequence === this.catalog?.sequence && (envelope as SignedPluginPayload).payload !== this.envelope?.payload) throw new Error('CATALOG_ROLLBACK')
      await writeFileAtomic(join(this.deps.directory, 'catalog.json'), JSON.stringify({ sequence: catalog.sequence, envelope }))
      this.catalog = catalog; this.envelope = envelope as SignedPluginPayload; this.error = undefined
    } catch (cause) { this.error = distributionErrorCode(cause, 'CATALOG_UNAVAILABLE'); throw cause }
  }
  async install(id: string): Promise<void> {
    if (this.disposed) throw new Error('INSTALLATION_CANCELLED')
    if (this.operation) throw new Error('INSTALLATION_BUSY')
    const controller = new AbortController()
    this.operation = { id, controller, percent: 0, phase: 'downloading' }; this.error = undefined; this.deps.changed()
    try {
      await this.queue.run(async () => {
        // Every installation needs fresh signed metadata. A stale catalog may still be displayed offline.
        await this.fetchCatalog(controller.signal)
        const entry = this.catalog?.releases.find(item => item.release.id === id)
        if (!entry) throw new Error('PLUGIN_NOT_IN_CATALOG')
        assertPluginCompatibility(entry.release, this.deps.hostVersion, PLUGIN_API_VERSION, this.deps.platform)
        const bytes = await this.deps.download(entry.release.url, pluginDownloadBytes(entry.release, entry.envelope), controller.signal, percent => {
          if (this.operation?.controller === controller && Number.isFinite(percent)) { this.operation.percent = Math.max(0, Math.min(99, Math.floor(percent))); this.deps.changed() }
        })
        controller.signal.throwIfAborted()
        this.operation!.phase = 'installing'; this.operation!.percent = 100; this.deps.changed()
        await this.deps.install(bytes, entry.envelope)
      })
    } catch (cause) { this.error = controller.signal.aborted ? 'INSTALLATION_CANCELLED' : distributionErrorCode(cause, 'INSTALLATION_FAILED'); throw new Error(this.error) }
    finally { this.operation = undefined; this.deps.changed() }
  }
  cancel(): void { if (this.operation?.phase === 'downloading') this.operation.controller.abort() }
  dispose(): void { this.disposed = true; this.lifetime.abort(); this.cancel() }
}

/** Do not forward arbitrary network exceptions (URLs, proxy credentials, paths) to renderer state. */
export function distributionErrorCode(cause: unknown, fallback = 'INSTALLATION_FAILED'): string {
  const code = cause instanceof Error ? cause.message : ''
  return /^(INVALID_SIGNATURE|INVALID_PACKAGE|INCOMPATIBLE_PLUGIN|CATALOG_EXPIRED|CATALOG_ROLLBACK|CATALOG_UNAVAILABLE|DISTRIBUTION_NOT_CONFIGURED|INVALID_CATALOG_URL|PLUGIN_NOT_IN_CATALOG|INSTALLATION_BUSY|INSTALLATION_CANCELLED|DOWNLOAD_FAILED|DOWNLOAD_OVERSIZED|DOWNLOAD_TIMEOUT)$/.test(code) ? code : fallback
}
