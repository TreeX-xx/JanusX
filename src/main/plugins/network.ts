// Note: .agents/notes/workbench/plugin-contract-v1.md — P5 host-only network and credentials.
import { lookup } from 'node:dns/promises'
import { request } from 'node:https'
import { createHash } from 'node:crypto'
import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { PluginError, networkRequestSchema, type PluginManifest, type PluginNetworkRequest, type PluginNetworkResult } from '@janusx/plugin-sdk'
import { SerialQueue, writeFileAtomic } from '../lib/atomic-file'

export interface PluginEncryption { encrypt(value: string): Buffer; decrypt(value: Buffer): string }
export class PluginCredentials {
  private queue = new SerialQueue()
  constructor(private directory: string, private encryption?: PluginEncryption) {}
  private path(plugin: string, scope: string, slot: string, origin: string): string {
    return join(this.directory, createHash('sha256').update(plugin).digest('hex'), createHash('sha256').update(JSON.stringify([scope, slot, origin])).digest('hex') + '.enc')
  }
  status(plugin: string, scope: string, slot: string, origin: string): Promise<boolean> {
    return this.queue.run(async () => { try { await readFile(this.path(plugin, scope, slot, origin)); return true } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return false
      throw new PluginError('CREDENTIAL_UNAVAILABLE', 'Credential storage is unavailable.')
    } })
  }
  set(plugin: string, scope: string, slot: string, origin: string, value: string | null, valid: () => void): Promise<void> {
    return this.queue.run(async () => {
      valid()
      if (value === null) { await rm(this.path(plugin, scope, slot, origin), { force: true }); return }
      if (!value.length || value.length > 4096 || /[^\x21-\x7e]/.test(value)) throw new PluginError('INVALID_REQUEST', 'Invalid credential.')
      try {
        if (!this.encryption) throw new Error('Unavailable')
        const encrypted = this.encryption.encrypt(value)
        valid()
        await writeFileAtomic(this.path(plugin, scope, slot, origin), encrypted)
      } catch (cause) { if (cause instanceof PluginError) throw cause; throw new PluginError('CREDENTIAL_UNAVAILABLE', 'Encrypted storage is unavailable.') }
    })
  }
  get(plugin: string, scope: string, slot: string, origin: string): Promise<string> {
    return this.queue.run(async () => {
      try {
        if (!this.encryption) throw new Error('Unavailable')
        return this.encryption.decrypt(await readFile(this.path(plugin, scope, slot, origin)))
      } catch { throw new PluginError('CREDENTIAL_UNAVAILABLE', 'Credential is unavailable.') }
    })
  }
  deletePlugin(plugin: string): Promise<void> {
    return this.queue.run(() => rm(join(this.directory, createHash('sha256').update(plugin).digest('hex')), { recursive: true, force: true }))
  }
  /** Only host-owned migration mappings may supply a legacy encrypted path; the plugin never receives the secret. */
  importLegacy(plugin: string, slot: string, origin: string, source: string, valid: () => void): Promise<void> {
    return this.queue.run(async () => {
      const target = this.path(plugin, 'application', slot, origin), marker = target + '.imported'
      const exists = async (path: string) => {
        try { await readFile(path); return true } catch (cause) { if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return false; throw cause }
      }
      try {
        valid()
        if (await exists(marker)) return
        if (!await exists(target)) {
          let encrypted: Buffer | undefined
          try { encrypted = await readFile(source) } catch (cause) { if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause }
          if (encrypted) {
            if (!this.encryption) throw new Error('Unavailable')
            const value = this.encryption.decrypt(encrypted)
            if (!value.length || value.length > 4096 || /[^\x21-\x7e]/.test(value)) throw new Error('Invalid credential')
            const migrated = this.encryption.encrypt(value)
            valid(); await writeFileAtomic(target, migrated)
          }
        }
        valid(); await writeFileAtomic(marker, '1\n')
      } catch (cause) { if (cause instanceof PluginError) throw cause; throw new PluginError('CREDENTIAL_UNAVAILABLE', 'Legacy credential could not be migrated; configure this credential in plugin settings.') }
    })
  }
}
/** Only public IPv4 destinations in this increment. DNS is pinned to the checked answer. */
export function isPluginPublicAddress(address: string): boolean {
  const parts = address.split('.').map(Number)
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return false
  const [a, b, c] = parts
  return a > 0 && a < 224 && ![10, 127].includes(a) && !(a === 100 && b >= 64 && b <= 127)
    && !(a === 169 && b === 254) && !(a === 172 && b >= 16 && b <= 31)
    && !(a === 192 && (b === 168 || b === 0 || b === 2 || b === 88 && c === 99))
    && !(a === 198 && (b === 18 || b === 19 || b === 51 && c === 100)) && !(a === 203 && b === 0 && c === 113)
}
export interface PluginNetworkTransport {
  resolve(host: string): Promise<string[]>
  send(url: URL, address: string, input: PluginNetworkRequest, secret: string | undefined, signal: AbortSignal): Promise<{ status: number; body: string; contentType: string; location?: string }>
}
export const pluginNetworkTransport: PluginNetworkTransport = {
  resolve: async host => (await lookup(host, { all: true, family: 4 })).map(answer => answer.address),
  send: (url, address, input, secret, signal) => new Promise((resolve, reject) => {
    const headers: Record<string, string> = { accept: 'application/json, text/plain', 'accept-encoding': 'identity' }
    if (input.body !== undefined) { headers['content-type'] = 'application/json'; headers['content-length'] = String(Buffer.byteLength(input.body)) }
    if (secret) headers.authorization = `Bearer ${secret}`
    const req = request(url, { method: input.method ?? 'GET', headers, signal, agent: false, family: 4,
      lookup: (_hostname, _options, callback) => callback(null, address, 4) }, response => {
      let size = 0; const chunks: Buffer[] = []
      response.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size > 64 * 1024) { req.destroy(); reject(new PluginError('FILE_TOO_LARGE', 'Network response exceeds its limit.')); return }
        chunks.push(chunk)
      })
      response.on('error', reject)
      response.on('end', () => resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8'),
        contentType: String(response.headers['content-type'] ?? '').slice(0, 128), location: response.headers.location }))
    })
    req.on('error', reject); req.end(input.body)
  }),
}
export class PluginNetwork {
  private running = new Map<string, Set<AbortController>>()
  private times = new Map<string, number[]>()
  constructor(private credentials: PluginCredentials, private io: PluginNetworkTransport = pluginNetworkTransport) {}
  revoke(plugin: string): void { for (const controller of this.running.get(plugin) ?? []) controller.abort() }
  close(): void { for (const plugin of this.running.keys()) this.revoke(plugin) }
  async fetch(manifest: PluginManifest, scope: string, raw: PluginNetworkRequest, valid: () => void, signal?: AbortSignal): Promise<PluginNetworkResult> {
    const checked = networkRequestSchema.safeParse(raw)
    if (!checked.success) throw new PluginError('INVALID_REQUEST', 'Invalid network request.')
    const input = checked.data
    if (input.body !== undefined && input.method !== 'POST') throw new PluginError('INVALID_REQUEST', 'Only POST accepts a body.')
    const network = manifest.permissions.find(item => item.name === 'network.fetch')
    if (!network || !manifest.capabilities.required.includes('network.fetch')) throw new PluginError('PERMISSION_DENIED', 'Network is not declared.')
    const times = (this.times.get(manifest.id) ?? []).filter(time => Date.now() - time < 60_000)
    const active = this.running.get(manifest.id) ?? new Set<AbortController>()
    if (active.size >= 2 || [...this.running.values()].reduce((n, set) => n + set.size, 0) >= 16 || times.length >= 20) throw new PluginError('RATE_LIMITED', 'Network budget reached.')
    times.push(Date.now()); this.times.set(manifest.id, times)
    const controller = new AbortController(); active.add(controller); this.running.set(manifest.id, active)
    const abort = () => controller.abort(); signal?.addEventListener('abort', abort, { once: true })
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; abort() }, 4000)
    const assert = () => { valid(); if (signal?.aborted || controller.signal.aborted) throw new PluginError(timedOut ? 'TIMEOUT' : 'CANCELLED', 'Network request stopped.') }
    // Poll the identity-bound request cancellation while DNS/TLS is in flight.
    const guard = setInterval(() => { try { assert() } catch { abort() } }, 25)
    const bounded = <T>(operation: Promise<T>) => new Promise<T>((resolve, reject) => {
      const stopped = () => reject(new PluginError(timedOut ? 'TIMEOUT' : 'CANCELLED', 'Network request stopped.'))
      controller.signal.addEventListener('abort', stopped, { once: true })
      if (controller.signal.aborted) stopped()
      operation.then(resolve, reject).finally(() => controller.signal.removeEventListener('abort', stopped)).catch(() => {})
    })
    try {
      let url = new URL(input.url)
      const initialOrigin = url.origin
      let secret: string | undefined
      const checkUrl = () => {
        if (url.protocol !== 'https:' || !network.origins.includes(url.origin) || url.username || url.password || url.hash || url.port) throw new PluginError('NETWORK_DENIED', 'Network destination is not approved.')
      }
      assert(); checkUrl()
      if (input.credential) {
        const slot = manifest.contributes.credentials?.find(item => item.id === input.credential && item.origin === initialOrigin)
        if (!slot || !manifest.permissions.some(item => item.name === 'credentials.use')) throw new PluginError('PERMISSION_DENIED', 'Credential is not bound to this endpoint.')
        secret = await bounded(this.credentials.get(manifest.id, scope, slot.id, slot.origin))
      }
      for (let redirects = 0; redirects <= 3; redirects++) {
        assert(); checkUrl()
        const addresses = await bounded(this.io.resolve(url.hostname)); assert()
        if (!addresses.length || addresses.some(address => !isPluginPublicAddress(address))) throw new PluginError('NETWORK_DENIED', 'Private and reserved destinations are unavailable.')
        const result = await bounded(this.io.send(url, addresses[0], input, secret, controller.signal)); assert()
        if (result.body.length > 64 * 1024 || Buffer.byteLength(result.body) > 64 * 1024) throw new PluginError('FILE_TOO_LARGE', 'Response exceeds its limit.')
        if (result.status >= 300 && result.status < 400 && result.location) {
          url = new URL(result.location, url)
          checkUrl()
          if (url.origin !== initialOrigin || input.method === 'POST') throw new PluginError('NETWORK_DENIED', 'Cross-origin and POST redirects are unavailable.')
          continue
        }
        // Credentialed calls return status only: a remote echo cannot disclose the key to UI or logs.
        return { status: result.status, body: secret ? '' : result.body, contentType: secret ? '' : result.contentType }
      }
      throw new PluginError('NETWORK_DENIED', 'Too many redirects.')
    } catch (cause) {
      if (cause instanceof PluginError) throw cause
      throw new PluginError('NETWORK_UNAVAILABLE', 'Network request failed.')
    } finally {
      clearTimeout(timer); clearInterval(guard); signal?.removeEventListener('abort', abort)
      active.delete(controller); if (!active.size) this.running.delete(manifest.id)
    }
  }
}
