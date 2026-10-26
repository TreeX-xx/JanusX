import { open } from 'node:fs/promises'
import { SIGNED_PACKAGE_LIMIT } from './package'

/** The main-process picker owns the path; bound reads even if a file grows after stat. */
export async function readPluginImport(path: string): Promise<Buffer> {
  const file = await open(path, 'r').catch(() => { throw new Error('PACKAGE_READ_FAILED') })
  try {
    const stat = await file.stat()
    if (!stat.isFile() || !stat.size || stat.size > SIGNED_PACKAGE_LIMIT) throw new Error('INVALID_PACKAGE')
    const bytes = Buffer.allocUnsafe(stat.size + 1)
    let length = 0
    while (length < bytes.length) {
      const { bytesRead } = await file.read(bytes, length, bytes.length - length, null)
      if (!bytesRead) break
      length += bytesRead
    }
    if (length !== stat.size) throw new Error('INVALID_PACKAGE')
    return bytes.subarray(0, length)
  } catch (cause) {
    if (cause instanceof Error && cause.message === 'INVALID_PACKAGE') throw cause
    throw new Error('PACKAGE_READ_FAILED')
  } finally { await file.close() }
}
