// Note: official managed CPA component ownership — see .agents/notes/workbench/service-integrations.md
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { chmod, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { gunzipSync, inflateRawSync } from 'node:zlib'
import { writeFileAtomic } from '@janusx/plugin-sdk/native'
import { downloadHostAsset, type HostDownload } from './download'

const BACKEND = 'CLIProxyAPI'
const FRONTEND = 'Cli-Proxy-API-Management-Center'
const MAX_ARCHIVE = 100 * 1024 * 1024
const MAX_BINARY = 160 * 1024 * 1024
type Asset = { name: string; browser_download_url: string; digest: string; size: number }
type Release = { tag_name: string; draft: boolean; prerelease: boolean; assets: Asset[] }
export interface CpaInstallation {
  id: string
  backend: string
  frontend: string
  binaryHash: string
  pageHash: string
}
export type Download = HostDownload
export const downloadCpaAsset: Download = async (...args) => {
  try { return await downloadHostAsset(...args) }
  catch (cause) {
    if (cause instanceof Error && cause.message === 'DOWNLOAD_OVERSIZED') throw new Error('cpa-download-oversized')
    if (cause instanceof Error && ['DOWNLOAD_FAILED', 'DOWNLOAD_NOT_FOUND'].includes(cause.message)) throw new Error('cpa-download-failed')
    throw cause
  }
}

const hash = (data: Buffer) => createHash('sha256').update(data).digest('hex')
async function hashFile(path: string): Promise<string> {
  const digest = createHash('sha256')
  for await (const chunk of createReadStream(path)) digest.update(chunk)
  return digest.digest('hex')
}

/** Extract only root-level files we actually distribute. No archive paths reach disk. */
export function extractCpaArchive(data: Buffer, zip: boolean, binaryName: string): Map<string, Buffer> {
  const allowed = new Set([binaryName, 'LICENSE'])
  const files = new Map<string, Buffer>()
  const add = (name: string, value: Buffer) => {
    if (files.has(name) || value.length > MAX_BINARY) throw new Error('cpa-invalid-archive')
    files.set(name, value)
  }
  if (zip) {
    let end = -1
    for (let i = data.length - 22; i >= Math.max(0, data.length - 65557); i--) {
      if (data.readUInt32LE(i) === 0x06054b50 && i + 22 + data.readUInt16LE(i + 20) === data.length) { end = i; break }
    }
    if (end < 0) throw new Error('cpa-invalid-archive')
    let offset = data.readUInt32LE(end + 16)
    const count = data.readUInt16LE(end + 10)
    if (count > 1000) throw new Error('cpa-invalid-archive')
    for (let i = 0; i < count; i++) {
      if (offset + 46 > data.length || data.readUInt32LE(offset) !== 0x02014b50) throw new Error('cpa-invalid-archive')
      const nameSize = data.readUInt16LE(offset + 28)
      const name = data.subarray(offset + 46, offset + 46 + nameSize).toString('utf8')
      if (allowed.has(name)) {
        const size = data.readUInt32LE(offset + 24), packed = data.readUInt32LE(offset + 20)
        const local = data.readUInt32LE(offset + 42)
        if (size > MAX_BINARY || local + 30 > data.length || data.readUInt32LE(local) !== 0x04034b50
          || data.readUInt16LE(offset + 8) & 1) throw new Error('cpa-invalid-archive')
        const start = local + 30 + data.readUInt16LE(local + 26) + data.readUInt16LE(local + 28)
        if (start + packed > data.length) throw new Error('cpa-invalid-archive')
        const compression = data.readUInt16LE(offset + 10)
        const input = data.subarray(start, start + packed)
        const value = compression === 0 ? input : compression === 8 ? inflateRawSync(input, { maxOutputLength: MAX_BINARY }) : null
        if (!value || value.length !== size) throw new Error('cpa-invalid-archive')
        add(name, value)
      }
      offset += 46 + nameSize + data.readUInt16LE(offset + 30) + data.readUInt16LE(offset + 32)
    }
  } else {
    const tar = gunzipSync(data, { maxOutputLength: MAX_BINARY + 10 * 1024 * 1024 })
    for (let offset = 0; offset + 512 <= tar.length;) {
      const name = tar.subarray(offset, offset + 100).toString().split('\0')[0]
      if (!name) break
      const size = parseInt(tar.subarray(offset + 124, offset + 136).toString().replace(/\0/g, '').trim(), 8)
      if (!Number.isSafeInteger(size) || size < 0 || offset + 512 + size > tar.length) throw new Error('cpa-invalid-archive')
      if (allowed.has(name)) {
        if (![0, 48].includes(tar[offset + 156])) throw new Error('cpa-invalid-archive')
        add(name, tar.subarray(offset + 512, offset + 512 + size))
      }
      offset += 512 + Math.ceil(size / 512) * 512
    }
  }
  if (!files.has(binaryName) || !files.has('LICENSE')) throw new Error('cpa-invalid-archive')
  return files
}

export class CpaInstaller {
  constructor(readonly root: string, private readonly platform = process.platform, private readonly arch = process.arch,
    private readonly download: Download = downloadCpaAsset) {
    if (!isAbsolute(root)) throw new Error('cpa-invalid-root')
  }

  get binaryName(): string { return this.platform === 'win32' ? 'cli-proxy-api.exe' : 'cli-proxy-api' }
  directory(installation: CpaInstallation): string { return join(this.root, 'versions', installation.id) }

  async read(slot: 'current' | 'pending' | 'previous'): Promise<CpaInstallation | null> {
    try {
      const value = JSON.parse(await readFile(join(this.root, `${slot}.json`), 'utf8')) as CpaInstallation
      if (!/^v8\.\d+\.\d+-v1\.\d+\.\d+-[a-f0-9]{12}$/.test(value.id)
        || !/^v8\.\d+\.\d+$/.test(value.backend) || !/^v1\.\d+\.\d+$/.test(value.frontend)
        || !/^[a-f0-9]{64}$/.test(value.binaryHash) || !/^[a-f0-9]{64}$/.test(value.pageHash)) return null
      const directory = this.directory(value)
      if (await hashFile(join(directory, this.binaryName)) !== value.binaryHash
        || await hashFile(join(directory, 'management.html')) !== value.pageHash) return null
      return value
    } catch { return null }
  }

  async activate(value: CpaInstallation): Promise<void> {
    const old = await this.read('current')
    if (old && old.id !== value.id) await writeFileAtomic(join(this.root, 'previous.json'), JSON.stringify(old))
    await writeFileAtomic(join(this.root, 'current.json'), JSON.stringify(value))
    await rm(join(this.root, 'pending.json'), { force: true })
    await this.pruneVersions().catch(() => {})
  }

  private async pruneVersions(): Promise<void> {
    const slots = await Promise.all(['current', 'pending', 'previous'].map((slot) => this.read(slot as 'current' | 'pending' | 'previous')))
    const keep = new Set(slots.filter((value) => value !== null).map((value) => value.id))
    const versions = resolve(this.root, 'versions')
    for (const entry of await readdir(versions, { withFileTypes: true })) {
      if (keep.has(entry.name) || !/^v8\.\d+\.\d+-v1\.\d+\.\d+-[a-f0-9]{12}$/.test(entry.name)) continue
      const path = resolve(versions, entry.name)
      if (relative(versions, path) !== entry.name) continue
      await rm(path, { recursive: true, force: true })
    }
  }

  async install(signal: AbortSignal, progress: (value: number) => void): Promise<CpaInstallation> {
    const os = this.platform === 'win32' ? 'windows' : this.platform === 'darwin' ? 'darwin' : this.platform === 'linux' ? 'linux' : null
    const cpu = this.arch === 'x64' ? 'amd64' : this.arch === 'arm64' ? 'aarch64' : null
    if (!os || !cpu) throw new Error('cpa-platform-unsupported')
    const release = async (repo: string, major: number): Promise<Release> => {
      const data = JSON.parse((await this.download(`https://api.github.com/repos/router-for-me/${repo}/releases/latest`, 1024 * 1024, signal)).toString()) as Release
      if (data.draft || data.prerelease || !new RegExp(`^v${major}\\.\\d+\\.\\d+$`).test(data.tag_name)) throw new Error('cpa-version-unsupported')
      return data
    }
    const [backend, frontend] = await Promise.all([release(BACKEND, 8), release(FRONTEND, 1)])
    const extension = os === 'windows' ? 'zip' : 'tar.gz'
    const binaryAssetName = `CLIProxyAPI_${backend.tag_name.slice(1)}_${os}_${cpu}.${extension}`
    const asset = (repo: string, data: Release, name: string): Asset => {
      const item = data.assets.find((candidate) => candidate.name === name)
      if (!item || item.browser_download_url !== `https://github.com/router-for-me/${repo}/releases/download/${data.tag_name}/${name}`
        || !/^sha256:[a-f0-9]{64}$/.test(item.digest) || item.size > MAX_ARCHIVE) throw new Error('cpa-invalid-release')
      return item
    }
    const binary = asset(BACKEND, backend, binaryAssetName), page = asset(FRONTEND, frontend, 'management.html')
    const installed = await this.read('current')
    if (installed?.backend === backend.tag_name && installed.frontend === frontend.tag_name) return installed
    const [archive, html, frontendLicense] = await Promise.all([
      this.download(binary.browser_download_url, MAX_ARCHIVE, signal, progress),
      this.download(page.browser_download_url, 20 * 1024 * 1024, signal),
      this.download(`https://raw.githubusercontent.com/router-for-me/${FRONTEND}/${frontend.tag_name}/LICENSE`, 100_000, signal),
    ])
    signal.throwIfAborted()
    if (hash(archive) !== binary.digest.slice(7) || hash(html) !== page.digest.slice(7)) throw new Error('cpa-checksum-mismatch')
    const files = extractCpaArchive(archive, os === 'windows', this.binaryName)
    const value: CpaInstallation = {
      id: `${backend.tag_name}-${frontend.tag_name}-${hash(archive).slice(0, 12)}`, backend: backend.tag_name,
      frontend: frontend.tag_name, binaryHash: hash(files.get(this.binaryName)!), pageHash: hash(html),
    }
    const staging = resolve(this.root, `download-${randomUUID()}`)
    if (!relative(resolve(this.root), staging).match(/^download-[a-f0-9-]+$/)) throw new Error('cpa-invalid-root')
    await mkdir(staging, { recursive: true })
    try {
      for (const [name, content] of files) await writeFile(join(staging, name), content)
      await writeFile(join(staging, 'management.html'), html)
      await writeFile(join(staging, 'MANAGEMENT-LICENSE'), frontendLicense)
      await chmod(join(staging, this.binaryName), 0o700)
      await mkdir(join(this.root, 'versions'), { recursive: true })
      signal.throwIfAborted()
      const target = resolve(this.directory(value))
      if (!relative(resolve(this.root, 'versions'), target).match(/^[^\\/]+$/)) throw new Error('cpa-invalid-root')
      // Never delete an existing/running version to finish a download.
      try { await rename(staging, target) } catch (error) {
        if (!['EEXIST', 'ENOTEMPTY', 'EPERM'].includes((error as NodeJS.ErrnoException).code ?? '')
          || await hashFile(join(target, this.binaryName)) !== value.binaryHash
          || await hashFile(join(target, 'management.html')) !== value.pageHash) throw error
      }
      await writeFileAtomic(join(this.root, 'pending.json'), JSON.stringify(value))
      progress(100)
      return value
    } finally { await rm(staging, { recursive: true, force: true }) }
  }
}
