import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lstat, opendir } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import { diffLines } from 'diff'
import type { TurnChangedFile } from '../../shared/ipc/terminal'
import { workspaceIo, readIoFile } from '@janus-agent/agent-core'

const execFileAsync = promisify(execFile)
const MAX_FILE_BYTES = 2 * 1024 * 1024
const MAX_TEXT_BYTES = 16 * 1024 * 1024
const SKIP = new Set(['.git', '.janusX', 'node_modules', 'out', 'dist', 'build', '.cache', '.next', '.vite', '.turbo', 'coverage'])

interface FileSnapshot {
  hash: string
  size: number
  binary: boolean
  oversized: boolean
  text?: string
}
export type TurnFileSnapshot = Map<string, FileSnapshot>

async function walk(cwd: string, dir = cwd): Promise<string[]> {
  const paths: string[] = []
  for await (const entry of await opendir(dir)) {
    await workspaceIo.step()
    if (SKIP.has(entry.name)) continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) paths.push(...await walk(cwd, path))
    else if (entry.isFile()) paths.push(relative(cwd, path))
  }
  return paths
}

async function filePaths(cwd: string): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
      cwd, timeout: 15_000, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
    })
    return [...new Set(stdout.split('\0').filter(Boolean))].sort()
  } catch (error) {
    // Non-repository folders and hosts without Git still support turn changes.
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'ENOENT' && String(code) !== '128') throw error
    return walk(cwd)
  }
}

async function captureFile(root: string, path: string): Promise<[string, FileSnapshot] | undefined> {
  const normalized = path.replace(/\\/g, '/')
  if (normalized.split('/').some(part => SKIP.has(part))) return
  const absolute = resolve(root, path)
  const rel = relative(root, absolute)
  if (isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`)) return
  try {
    const stats = await lstat(absolute)
    if (!stats.isFile()) return
    if (stats.size >= MAX_FILE_BYTES) {
      return [normalized, { hash: `${stats.size}:${stats.mtimeMs}:${stats.ctimeMs}`, size: stats.size, binary: false, oversized: true }]
    }
    const content = await readIoFile(absolute, MAX_FILE_BYTES)
    const after = await lstat(absolute)
    if (content.length !== stats.size || after.mtimeMs !== stats.mtimeMs || after.ctimeMs !== stats.ctimeMs) {
      throw new Error(`File changed during turn snapshot: ${normalized}`)
    }
    const binary = content.subarray(0, 8192).includes(0)
    const oversized = content.length >= MAX_FILE_BYTES
    return [normalized, {
      hash: createHash('sha256').update(content).digest('hex'), size: content.length, binary, oversized,
      ...(!binary && !oversized ? { text: content.toString('utf8') } : {}),
    }]
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

export async function captureTurnFiles(cwd: string, signal?: AbortSignal): Promise<TurnFileSnapshot> {
  return workspaceIo.run(cwd, async batch => {
    const root = resolve(cwd)
    const snapshot: TurnFileSnapshot = new Map()
    const paths = (await filePaths(root)).sort()
    let textBytes = 0
    // Note: one shared lane across terminals and checkpoints; see
    // .agents/notes/planning/workspace-data-contract-baseline.md.
    await batch.each(paths, async candidate => {
      const entry = await captureFile(root, candidate)
      if (!entry) return
      const [path, file] = entry
      if (file.text !== undefined) {
        if (textBytes + file.size <= MAX_TEXT_BYTES) textBytes += file.size
        else delete file.text
      }
      snapshot.set(path, file)
    })
    return snapshot
  }, { signal, background: true })
}

export function compareTurnFiles(before: TurnFileSnapshot, after: TurnFileSnapshot): TurnChangedFile[] {
  const files: TurnChangedFile[] = []
  for (const path of [...new Set([...before.keys(), ...after.keys()])].sort()) {
    const old = before.get(path)
    const current = after.get(path)
    if (old && current && old.hash === current.hash && old.size === current.size) continue
    const status = !old ? 'added' : !current ? 'deleted'
      : old.oversized || current.oversized ? 'oversized' : old.binary || current.binary ? 'binary' : 'modified'
    const record: TurnChangedFile = { path, status, additions: null, deletions: null, size: current?.size ?? old!.size }
    if ((!old || old.text !== undefined) && (!current || current.text !== undefined)) {
      // Bound diff work on unrelated large texts; missing counts stay unknown.
      const changes = diffLines(old?.text ?? '', current?.text ?? '', { timeout: 100 })
      if (changes) {
        record.additions = changes.reduce((count, part) => count + (part.added ? part.count : 0), 0)
        record.deletions = changes.reduce((count, part) => count + (part.removed ? part.count : 0), 0)
      }
    }
    files.push(record)
  }
  return files
}
