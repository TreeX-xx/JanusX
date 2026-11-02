import { exec } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { managedCliDirs } from '../external-cli/managed-paths'

const execAsync = promisify(exec)

const pathCache = new Map<string, string | null>()

const COMMON_PATHS = [
  join(homedir(), '.local', 'bin'),
  join(homedir(), '.npm-global', 'bin'),
  join(homedir(), '.bun', 'bin'),
  '/usr/local/bin',
  '/usr/bin',
  join(homedir(), 'AppData', 'Roaming', 'npm'),
  join(homedir(), '.cargo', 'bin'),
]

/** Windows extensions node-pty / CreateProcess can launch directly. */
const WIN_SPAWN_EXTS = ['.exe', '.cmd', '.bat', '.com'] as const

function winExtRank(filePath: string): number {
  switch (extname(filePath).toLowerCase()) {
    case '.exe':
      return 0
    case '.cmd':
      return 1
    case '.bat':
      return 2
    case '.com':
      return 3
    default:
      // Extensionless npm shims are shell scripts — not spawnable by node-pty.
      return 100
  }
}

function isWinSpawnable(filePath: string, exists: (p: string) => boolean = existsSync): boolean {
  if (!exists(filePath)) return false
  const ext = extname(filePath).toLowerCase()
  return (WIN_SPAWN_EXTS as readonly string[]).includes(ext)
}

/**
 * If an npm .cmd / shim launches a same-named .exe, prefer that binary.
 * Avoids following node.exe wrappers (e.g. codex.cmd → node + codex.js).
 */
function resolveSameNamedExe(
  filePath: string,
  command: string,
  read: (p: string, enc: BufferEncoding) => string = readFileSync,
  exists: (p: string) => boolean = existsSync,
): string | null {
  if (extname(filePath).toLowerCase() === '.exe') return filePath

  const expected = `${command.toLowerCase()}.exe`
  try {
    const content = read(filePath, 'utf8')
    const dir = dirname(filePath)
    const re = /"([^"\r\n]*?\.exe)"/gi
    let match: RegExpExecArray | null
    while ((match = re.exec(content))) {
      const raw = match[1]
        .replace(/%~dp0%?/gi, `${dir}\\`)
        .replace(/%dp0%?/gi, `${dir}\\`)
        .replace(/\$basedir/g, dir)
      const candidates = [
        isAbsolute(raw) ? resolve(raw) : resolve(dir, raw),
        resolve(dir, raw),
        join(dir, raw),
      ]
      for (const candidate of candidates) {
        if (basename(candidate).toLowerCase() === expected && exists(candidate)) {
          return candidate
        }
      }
    }
  } catch {
    // ignore unreadable shims
  }
  return null
}

/**
 * Pick the best Windows spawn path from candidate paths (e.g. all `where` lines).
 * Prefer .exe > .cmd > .bat > .com; never return extensionless npm shims.
 */
export function selectWindowsSpawnPath(
  candidates: string[],
  command: string,
  deps?: {
    existsSync?: (p: string) => boolean
    readFileSync?: (p: string, enc: BufferEncoding) => string
  },
): string | null {
  const exists = deps?.existsSync ?? existsSync
  const read = deps?.readFileSync ?? readFileSync

  const ranked = candidates
    .map((p) => p.trim())
    .filter(Boolean)
    .filter((p) => isWinSpawnable(p, exists))
    .sort((a, b) => winExtRank(a) - winExtRank(b) || a.length - b.length)

  if (!ranked.length) return null

  const best = ranked[0]
  return resolveSameNamedExe(best, command, read, exists) ?? best
}

function collectCommonCandidates(command: string): string[] {
  const win = process.platform === 'win32'
  const out: string[] = []
  for (const dir of COMMON_PATHS) {
    if (win) {
      for (const ext of WIN_SPAWN_EXTS) {
        out.push(join(dir, `${command}${ext}`))
      }
    } else {
      out.push(join(dir, command))
    }
  }
  return out
}

function parseLookupLines(stdout: string): string[] {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}

export async function resolveCLIPath(command: string): Promise<string | null> {
  // Managed installs take the same precedence as detection, even after a cached miss.
  for (const dir of managedCliDirs()) {
    const candidates = process.platform === 'win32'
      ? WIN_SPAWN_EXTS.map(ext => join(dir, `${command}${ext}`)) : [join(dir, command)]
    const managed = process.platform === 'win32' ? selectWindowsSpawnPath(candidates, command) : candidates.find(path => existsSync(path))
    if (managed) return managed
  }
  if (pathCache.has(command)) return pathCache.get(command)!

  const win = process.platform === 'win32'
  let fromLookup: string[] = []

  try {
    const lookup = win ? `where ${command}` : `which ${command}`
    const { stdout } = await execAsync(lookup)
    fromLookup = parseLookupLines(stdout)
  } catch {
    // not found via which/where
  }

  let resolved: string | null = null

  if (win) {
    resolved = selectWindowsSpawnPath(fromLookup, command)
    if (!resolved) {
      resolved = selectWindowsSpawnPath(collectCommonCandidates(command), command)
    }
  } else {
    const first = fromLookup[0]
    if (first && existsSync(first)) {
      resolved = first
    } else {
      for (const candidate of collectCommonCandidates(command)) {
        if (existsSync(candidate)) {
          resolved = candidate
          break
        }
      }
    }
  }

  pathCache.set(command, resolved)
  return resolved
}

export function clearCache(): void {
  pathCache.clear()
}
