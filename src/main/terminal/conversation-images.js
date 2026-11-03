// Shared by the main process and native extensions.
// Note: .agents/notes/workbench/terminal-dialog-dual-mode.md
import { createHash } from 'node:crypto'
import { Buffer } from 'node:buffer'
import { mkdir, open, writeFile } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const IMAGE_MAX_BYTES = 8 * 1024 * 1024

export async function storeConversationImage(root, source, cwd = '') {
  if (!root) throw new Error('Image storage is unavailable')
  let bytes
  if (typeof source.data === 'string' && source.data) {
    const data = source.data.replace(/^data:image\/(?:png|jpeg|webp|gif);base64,/, '')
    if (data.length > Math.ceil(IMAGE_MAX_BYTES * 4 / 3) + 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) throw new Error('Invalid or oversized image data')
    bytes = Buffer.from(data, 'base64')
  } else if (typeof source.path === 'string' && source.path && source.path.length <= 4096) {
    let path = source.path
    if (/^file:/i.test(path)) path = fileURLToPath(path)
    else { try { path = decodeURIComponent(path) } catch { /* Literal percent in a native path. */ } }
    if (/^(?:\\\\|\/\/|[a-z]+:\/\/)/i.test(path) || path.includes('\0')) throw new Error('Image must be a local file')
    if (!isAbsolute(path) && !cwd) throw new Error('Image path has no working directory')
    const file = await open(resolve(cwd, path), 'r')
    try {
      const stat = await file.stat()
      if (!stat.isFile() || stat.size > IMAGE_MAX_BYTES) throw new Error('Image exceeds 8 MB or is not a regular file')
      const buffer = Buffer.alloc(IMAGE_MAX_BYTES + 1)
      let size = 0
      while (size < buffer.length) {
        const read = await file.read(buffer, size, buffer.length - size, size)
        if (!read.bytesRead) break
        size += read.bytesRead
      }
      bytes = buffer.subarray(0, size)
    } finally { await file.close() }
  } else throw new Error('Native image data is unavailable')
  if (!bytes.length || bytes.length > IMAGE_MAX_BYTES) throw new Error('Image exceeds 8 MB or is empty')
  const format = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? 'png'
    : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? 'jpeg'
      : /^GIF8[79]a$/.test(bytes.subarray(0, 6).toString()) ? 'gif'
        : bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP' ? 'webp' : null
  if (!format) throw new Error('Unsupported image format (PNG, JPEG, GIF or WebP required)')
  const id = createHash('sha256').update(bytes).digest('hex')
  const path = join(root, `${id}.${format}`)
  await mkdir(root, { recursive: true })
  await writeFile(path, bytes, { flag: 'wx' }).catch(error => { if (error.code !== 'EEXIST') throw error })
  return { id, path, mimeType: `image/${format}`, status: 'ready' }
}
