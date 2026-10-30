import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { deflateRawSync } from 'node:zlib'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CpaInstaller, extractCpaArchive, type Download } from '../../plugins/cpa/src/main/installer'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
const digest = (buffer: Buffer) => 'sha256:' + createHash('sha256').update(buffer).digest('hex')

function zip(entries: Record<string, string>): Buffer {
  const locals: Buffer[] = [], headers: Buffer[] = []
  let offset = 0
  for (const [name, content] of Object.entries(entries)) {
    const filename = Buffer.from(name), input = Buffer.from(content), packed = deflateRawSync(input)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(8, 8); local.writeUInt32LE(packed.length, 18)
    local.writeUInt32LE(input.length, 22); local.writeUInt16LE(filename.length, 26)
    const header = Buffer.alloc(46)
    header.writeUInt32LE(0x02014b50); header.writeUInt16LE(8, 10); header.writeUInt32LE(packed.length, 20)
    header.writeUInt32LE(input.length, 24); header.writeUInt16LE(filename.length, 28); header.writeUInt32LE(offset, 42)
    locals.push(local, filename, packed); headers.push(header, filename)
    offset += local.length + filename.length + packed.length
  }
  const end = Buffer.alloc(22), central = Buffer.concat(headers)
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(Object.keys(entries).length, 10)
  end.writeUInt32LE(central.length, 12); end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, central, end])
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'janusx-cpa-installer-')); roots.push(root)
  const archive = zip({ 'cli-proxy-api.exe': 'MZ official fixture', LICENSE: 'MIT', '../escape.exe': 'bad', 'config.example.yaml': 'do not use' })
  const html = Buffer.from('<html>CPA</html>')
  const assets = new Map<string, Buffer>()
  const release = (repo: string, tag: string, name: string, bytes: Buffer) => {
    const url = `https://github.com/router-for-me/${repo}/releases/download/${tag}/${name}`
    assets.set(url, bytes)
    const metadata = { tag_name: tag, draft: false, prerelease: false, assets: [{ name, browser_download_url: url, digest: digest(bytes), size: bytes.length }] }
    assets.set(`https://api.github.com/repos/router-for-me/${repo}/releases/latest`, Buffer.from(JSON.stringify(metadata)))
    return metadata
  }
  const backend = release('CLIProxyAPI', 'v8.0.31', 'CLIProxyAPI_8.0.31_windows_amd64.zip', archive)
  const frontend = release('Cli-Proxy-API-Management-Center', 'v1.26.5', 'management.html', html)
  assets.set('https://raw.githubusercontent.com/router-for-me/Cli-Proxy-API-Management-Center/v1.26.5/LICENSE', Buffer.from('MIT frontend'))
  const download = vi.fn<Download>(async (url, _limit, signal, progress) => {
    signal.throwIfAborted(); progress?.(50)
    const value = assets.get(url)
    if (!value) throw new Error('Unexpected URL ' + url)
    return value
  })
  const installer = new CpaInstaller(root, 'win32', 'x64', download)
  return { root, archive, html, assets, backend, frontend, download, installer }
}

describe('official CPA component installation', () => {
  it('verifies downloads, extracts only allowed files, stages separately and preserves accounts on activation', async () => {
    const { installer, root, download } = await fixture()
    const progress = vi.fn()
    const value = await installer.install(new AbortController().signal, progress)
    expect(progress).toHaveBeenLastCalledWith(100)
    expect(await installer.read('current')).toBeNull()
    expect(await installer.read('pending')).toEqual(value)
    expect(await readFile(join(installer.directory(value), 'LICENSE'), 'utf8')).toBe('MIT')
    await expect(readFile(join(root, 'escape.exe'))).rejects.toThrow()
    await expect(readFile(join(installer.directory(value), 'config.example.yaml'))).rejects.toThrow()
    await writeFile(join(root, 'accounts-sentinel'), 'keep')
    await installer.activate(value)
    expect(await installer.read('current')).toEqual(value)
    expect(await installer.read('pending')).toBeNull()
    expect(await readFile(join(root, 'accounts-sentinel'), 'utf8')).toBe('keep')
    download.mockClear()
    expect(await installer.install(new AbortController().signal, progress)).toEqual(value)
    expect(download).toHaveBeenCalledTimes(2)
  })

  it('rejects a modified download and a modified installed binary', async () => {
    const { installer, assets, backend } = await fixture()
    const url = backend.assets[0].browser_download_url
    const good = assets.get(url)!
    assets.set(url, Buffer.from('tampered'))
    await expect(installer.install(new AbortController().signal, () => {})).rejects.toThrow('cpa-checksum-mismatch')
    expect(await installer.read('pending')).toBeNull()
    assets.set(url, good)
    const value = await installer.install(new AbortController().signal, () => {})
    await installer.activate(value)
    await writeFile(join(installer.directory(value), 'cli-proxy-api.exe'), 'changed')
    expect(await installer.read('current')).toBeNull()
  })

  it('rejects nonofficial URLs and unsupported major versions before executing or installing anything', async () => {
    const { installer, assets, backend } = await fixture()
    const key = 'https://api.github.com/repos/router-for-me/CLIProxyAPI/releases/latest'
    backend.assets[0].browser_download_url = 'https://example.org/binary.zip'
    assets.set(key, Buffer.from(JSON.stringify(backend)))
    await expect(installer.install(new AbortController().signal, () => {})).rejects.toThrow('cpa-invalid-release')
    backend.tag_name = 'v9.0.0'
    assets.set(key, Buffer.from(JSON.stringify(backend)))
    await expect(installer.install(new AbortController().signal, () => {})).rejects.toThrow('cpa-version-unsupported')
  })

  it('cancels downloads and rejects untrusted manifest paths', async () => {
    const { installer, root } = await fixture()
    const abort = new AbortController(); abort.abort()
    await expect(installer.install(abort.signal, () => {})).rejects.toThrow()
    await writeFile(join(root, 'current.json'), JSON.stringify({ id: '../../outside', backend: 'v8.0.31', frontend: 'v1.26.5' }))
    expect(await installer.read('current')).toBeNull()
  })

  it('rejects malformed archives and archives without the executable or license', () => {
    expect(() => extractCpaArchive(Buffer.from('not a zip'), true, 'cli-proxy-api.exe')).toThrow('cpa-invalid-archive')
    expect(() => extractCpaArchive(zip({ '../cli-proxy-api.exe': 'escape', LICENSE: 'MIT' }), true, 'cli-proxy-api.exe')).toThrow('cpa-invalid-archive')
  })

  it('retains only current and previous component versions without touching accounts', async () => {
    const { installer, assets, backend, archive, root } = await fixture()
    await writeFile(join(root, 'account-sentinel'), 'keep')
    for (const patch of [31, 32, 33]) {
      backend.tag_name = `v8.0.${patch}`
      backend.assets[0].name = `CLIProxyAPI_8.0.${patch}_windows_amd64.zip`
      backend.assets[0].browser_download_url = `https://github.com/router-for-me/CLIProxyAPI/releases/download/${backend.tag_name}/${backend.assets[0].name}`
      assets.set(backend.assets[0].browser_download_url, archive)
      assets.set('https://api.github.com/repos/router-for-me/CLIProxyAPI/releases/latest', Buffer.from(JSON.stringify(backend)))
      await installer.activate(await installer.install(new AbortController().signal, () => {}))
    }
    expect((await installer.read('current'))?.backend).toBe('v8.0.33')
    expect((await installer.read('previous'))?.backend).toBe('v8.0.32')
    expect(await readdir(join(root, 'versions'))).toHaveLength(2)
    expect(await readFile(join(root, 'account-sentinel'), 'utf8')).toBe('keep')
  })
})
