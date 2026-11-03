// Note: fail-closed skill folder deletion — .agents/notes/workbench/local-skills-mcp.md
import { createHash } from 'node:crypto'
import { lstat, open, readdir, realpath } from 'node:fs/promises'
import { basename, isAbsolute, join, relative, sep } from 'node:path'
import { IntegrationError } from './config'

/** Hash every file, including resources. Never follow links or delete a skills collection. */
export async function snapshotSkillRemoval(directory: string, sourceDirectory: string): Promise<{ revision: string; fileCount: number }> {
  const source = await realpath(sourceDirectory), target = await realpath(directory)
  const child = relative(source, target)
  if (!child || child === '..' || child.startsWith(`..${sep}`) || isAbsolute(child)) throw new IntegrationError('unsafe-delete')
  const digest = createHash('sha256')
  let count = 0, fileCount = 0, bytes = 0
  const buffer = Buffer.alloc(64 * 1024)
  const walk = async (path: string, depth: number): Promise<void> => {
    if (++count > 5000 || depth > 16) throw new IntegrationError('delete-limit')
    const stat = await lstat(path)
    if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) throw new IntegrationError('unsafe-delete')
    digest.update(JSON.stringify([relative(directory, path), stat.dev, stat.ino, stat.mode, stat.size, stat.mtimeMs, stat.ctimeMs]))
    if (stat.isDirectory()) {
      const children = (await readdir(path)).sort()
      for (const name of children) await walk(join(path, name), depth + 1)
    } else {
      if (basename(path).toLowerCase() === 'skill.md' && path !== join(directory, 'SKILL.md')) throw new IntegrationError('unsafe-delete')
      fileCount++
      if (bytes + stat.size > 64 * 1024 * 1024) throw new IntegrationError('delete-limit')
      const file = await open(path, 'r')
      try {
        const opened = await file.stat()
        if (opened.ino !== stat.ino || opened.dev !== stat.dev || !opened.isFile()) throw new IntegrationError('changed')
        while (true) {
          const { bytesRead } = await file.read(buffer, 0, buffer.length, null)
          if (!bytesRead) break
          bytes += bytesRead
          if (bytes > 64 * 1024 * 1024) throw new IntegrationError('delete-limit')
          digest.update(buffer.subarray(0, bytesRead))
        }
        const after = await file.stat()
        if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs) throw new IntegrationError('changed')
      } finally { await file.close() }
    }
  }
  await walk(directory, 0)
  return { revision: digest.digest('hex'), fileCount }
}
