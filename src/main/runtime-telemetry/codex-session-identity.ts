// Note: bounded hook-free attribution — see .agents/notes/terminal/usage-telemetry-hook-decoupling.md
import { open, stat } from 'node:fs/promises'
import { sourceVersion } from './source-version'

interface CodexSessionIdentity {
  sessionId: string
  cwd: string
  activatedAt: number
}

const CHUNK_BYTES = 64 * 1024
const MAX_HEADER_BYTES = 1024 * 1024
const TAIL_BYTES = 256 * 1024
const cache = new Map<string, { version: string; identity: CodexSessionIdentity }>()

/** Identity comes from the complete first record; activity from complete native
 * records at the tail. File mtime is not a clock for an open Windows rollout.
 * Cache by size AND filesystem identity/times so preserved-mtime growth is read. */
export async function readCodexSessionIdentity(filePath: string): Promise<CodexSessionIdentity | undefined> {
  const info = await stat(filePath).catch(() => undefined)
  if (!info?.isFile() || !info.size) return undefined
  const version = sourceVersion(info)
  const cached = cache.get(filePath)
  if (cached?.version === version) return cached.identity
  const handle = await open(filePath, 'r').catch(() => undefined)
  if (!handle) return undefined
  try {
    const chunks: Buffer[] = []
    let position = 0
    let header: Buffer | undefined
    while (position < Math.min(info.size, MAX_HEADER_BYTES)) {
      const buffer = Buffer.alloc(Math.min(CHUNK_BYTES, info.size - position, MAX_HEADER_BYTES - position))
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position)
      if (!bytesRead) return undefined
      const end = buffer.subarray(0, bytesRead).indexOf(10)
      chunks.push(buffer.subarray(0, end < 0 ? bytesRead : end))
      position += bytesRead
      if (end >= 0 || position === info.size) { header = Buffer.concat(chunks); break }
    }
    if (!header) return undefined
    const meta = JSON.parse(header.toString('utf8'))
    const payload = meta?.payload
    if (meta?.type !== 'session_meta' || typeof payload?.id !== 'string' || !payload.id
      || typeof payload.cwd !== 'string' || !payload.cwd
      || (payload.source && typeof payload.source !== 'string')) return undefined

    const start = Math.max(0, info.size - TAIL_BYTES)
    const buffer = Buffer.alloc(info.size - start)
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, start)
    if (bytesRead !== buffer.length || sourceVersion(await handle.stat()) !== version) return undefined
    const lines = buffer.toString('utf8').split(/\r?\n/)
    if (start) lines.shift()
    let activatedAt = Date.parse(meta.timestamp ?? payload.timestamp)
    for (const line of lines) {
      try {
        const value = JSON.parse(line)
        const at = Date.parse(value.timestamp)
        if (Number.isFinite(at) && (!Number.isFinite(activatedAt) || at > activatedAt)) activatedAt = at
      } catch { /* A partial last record is retried when the source grows. */ }
    }
    const identity = { sessionId: payload.id, cwd: payload.cwd,
      activatedAt: Number.isFinite(activatedAt) ? activatedAt : info.mtimeMs }
    cache.delete(filePath)
    cache.set(filePath, { version, identity })
    if (cache.size > 4096) cache.delete(cache.keys().next().value!)
    return identity
  } catch { return undefined }
  finally { await handle.close() }
}
