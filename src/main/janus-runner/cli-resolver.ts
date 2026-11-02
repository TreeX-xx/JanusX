import { exec } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, win32 } from 'node:path'
import { promisify } from 'node:util'

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

/**
 * Native Claude Code binaries an npm global install lays down. The package
 * exe is the supported npm layout; the optional platform packages are where
 * npm actually downloads that binary before linking it.
 */
const CLAUDE_NPM_EXE_RELATIVE = [
  ['node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe'],
  ['node_modules', '@anthropic-ai', 'claude-code-win32-x64', 'claude.exe'],
  ['node_modules', '@anthropic-ai', 'claude-code-win32-arm64', 'claude.exe'],
] as const

const SHIM_FOLLOW_LIMIT = 5

export interface WindowsSpawnDeps {
  existsSync?: (p: string) => boolean
  readFileSync?: (p: string, enc: BufferEncoding) => string
  env?: NodeJS.ProcessEnv
  homedir?: string
}

export interface ClaudeBinaryResolution {
  /** Spawn path: native exe when one was found, otherwise a cmd/bat launcher. */
  path: string | null
  /** Command or shim JanusX found before native-exe substitution. */
  foundCommand: string | null
  /** Native exe paths that were checked. */
  triedExes: string[]
  /** True when `path` is a cmd/bat that launches a local script, not a forwarder. */
  directLauncher: boolean
  /** True when the shim points at another claude command, npm, or a missing claude.exe. */
  forwarder: boolean
}

export class ClaudeNativeBinaryError extends Error {
  readonly foundCommand: string | null
  readonly triedExes: readonly string[]

  constructor(foundCommand: string | null, triedExes: readonly string[]) {
    super(formatClaudeNativeExeError(foundCommand, triedExes))
    this.name = 'ClaudeNativeBinaryError'
    this.foundCommand = foundCommand
    this.triedExes = triedExes
  }
}

function rankTriedExe(filePath: string): number {
  const normalized = filePath.toLowerCase()
  if (normalized.includes('\\npm\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe')) return 0
  if (normalized.endsWith('\\claude.exe') && normalized.includes('\\.local\\bin\\')) return 1
  if (normalized.includes('\\programs\\claude\\claude.exe')) return 2
  if (normalized.includes('\\claude-code\\bin\\claude.exe')) return 3
  return 4
}

/** Keep the dialog readable: canonical npm and native-install paths first. */
function pathsForError(triedExes: readonly string[]): string[] {
  const ordered = [...triedExes].sort((a, b) => rankTriedExe(a) - rankTriedExe(b) || a.length - b.length)
  const unique: string[] = []
  for (const filePath of ordered) {
    if (unique.some((item) => item.toLowerCase() === filePath.toLowerCase())) continue
    unique.push(filePath)
    if (unique.length === 4) break
  }
  return unique
}

export function formatClaudeNativeExeError(foundCommand: string | null, triedExes: readonly string[]): string {
  const found = foundCommand
    ? `JanusX found "${foundCommand}".`
    : 'JanusX did not find a claude command.'
  const shown = pathsForError(triedExes)
  const tried = shown.length > 0
    ? `Looked for native claude.exe at: ${shown.join('; ')}.`
    : 'No native claude.exe path was available to check.'
  return `Claude dual mode requires native claude.exe (npm installation supported). ${found} ${tried}`
}

/** Launch decision for Windows Claude. Direct node launchers stay launchable. */
export function claudeSpawnResult(resolution: ClaudeBinaryResolution): { path: string | null; error?: string } {
  if (resolution.path && (resolution.path.toLowerCase().endsWith('.exe') || resolution.directLauncher)) {
    return { path: resolution.path }
  }
  if (resolution.forwarder && resolution.foundCommand) {
    return { path: null, error: formatClaudeNativeExeError(resolution.foundCommand, resolution.triedExes) }
  }
  return { path: resolution.path }
}

function winExtRank(filePath: string): number {
  switch (win32.extname(filePath).toLowerCase()) {
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

function isWinSpawnable(filePath: string, exists: (p: string) => boolean): boolean {
  if (!exists(filePath)) return false
  const ext = win32.extname(filePath).toLowerCase()
  return (WIN_SPAWN_EXTS as readonly string[]).includes(ext)
}

function commandStem(command: string): string {
  return win32.basename(command).replace(/\.(exe|cmd|bat|com)$/i, '')
}

function envValue(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const hit = Object.entries(env).find(([key]) => key.toLowerCase() === name.toLowerCase())
  const value = hit?.[1]?.trim()
  return value || undefined
}

function expandShimToken(raw: string, dir: string, env: NodeJS.ProcessEnv): string {
  const expanded = raw
    .replace(/%~dp0%?/gi, `${dir}\\`)
    .replace(/%dp0%?/gi, `${dir}\\`)
    .replace(/\$basedir/g, dir)
    .replace(/%([^%]+)%/g, (_, name: string) => envValue(env, name) ?? '')
  if (win32.isAbsolute(expanded)) return win32.normalize(expanded)
  return win32.normalize(win32.join(dir, expanded))
}

function quotedShimTargets(content: string, dir: string, env: NodeJS.ProcessEnv): string[] {
  const targets: string[] = []
  const re = /"([^"\r\n]*)"/g
  let match: RegExpExecArray | null
  while ((match = re.exec(content))) {
    const raw = match[1].trim()
    if (!raw) continue
    targets.push(expandShimToken(raw, dir, env))
  }
  return targets
}

function isNodeBinary(filePath: string): boolean {
  const name = win32.basename(filePath).toLowerCase()
  return name === 'node.exe' || name === 'node'
}

function sameNamed(filePath: string, command: string, ext: string): boolean {
  return win32.basename(filePath).toLowerCase() === `${command.toLowerCase()}${ext}`
}

function claudePackageExes(dir: string): string[] {
  return CLAUDE_NPM_EXE_RELATIVE.map((parts) => win32.join(dir, ...parts))
}

function knownClaudeRoots(env: NodeJS.ProcessEnv, home: string): string[] {
  const appData = envValue(env, 'APPDATA') || win32.join(home, 'AppData', 'Roaming')
  const localAppData = envValue(env, 'LOCALAPPDATA') || win32.join(home, 'AppData', 'Local')
  return [
    win32.join(appData, 'npm'),
    win32.join(home, '.npm-global'),
    win32.join(localAppData, 'Programs', 'claude'),
    win32.join(home, '.local', 'bin'),
  ]
}

function knownClaudeExes(env: NodeJS.ProcessEnv, home: string): string[] {
  const roots = knownClaudeRoots(env, home)
  const packaged = roots.flatMap((root) => claudePackageExes(root))
  const appData = envValue(env, 'APPDATA') || win32.join(home, 'AppData', 'Roaming')
  const localAppData = envValue(env, 'LOCALAPPDATA') || win32.join(home, 'AppData', 'Local')
  return [
    ...packaged,
    win32.join(appData, 'npm', 'claude.exe'),
    win32.join(localAppData, 'Programs', 'claude', 'claude.exe'),
    win32.join(home, '.local', 'bin', 'claude.exe'),
  ]
}

function knownClaudeShims(env: NodeJS.ProcessEnv, home: string): string[] {
  const appData = envValue(env, 'APPDATA') || win32.join(home, 'AppData', 'Roaming')
  const npm = win32.join(appData, 'npm')
  return [win32.join(npm, 'claude.cmd'), win32.join(npm, 'claude.bat')]
}

interface ShimScan {
  tried: string[]
  seen: Set<string>
  directLauncher: string | null
  forwarder: boolean
}

function rememberExe(scan: ShimScan, exePath: string): void {
  if (scan.tried.some((item) => item.toLowerCase() === exePath.toLowerCase())) return
  scan.tried.push(exePath)
}

function resolveFromShim(
  filePath: string,
  command: string,
  exists: (p: string) => boolean,
  read: (p: string, enc: BufferEncoding) => string,
  env: NodeJS.ProcessEnv,
  scan: ShimScan,
  depth: number,
  allowPackageLayout: boolean,
): string | null {
  const key = filePath.toLowerCase()
  if (scan.seen.has(key) || depth > SHIM_FOLLOW_LIMIT) return null
  scan.seen.add(key)

  if (win32.extname(filePath).toLowerCase() === '.exe') {
    rememberExe(scan, filePath)
    return exists(filePath) && sameNamed(filePath, command, '.exe') ? filePath : null
  }

  const dir = win32.dirname(filePath)
  if (allowPackageLayout) {
    for (const exePath of claudePackageExes(dir)) {
      rememberExe(scan, exePath)
      if (exists(exePath)) return exePath
    }
  }

  let content = ''
  try {
    content = read(filePath, 'utf8')
  } catch {
    return null
  }

  if (/\bnpm\b/i.test(content)) scan.forwarder = true

  const targets = quotedShimTargets(content, dir, env)
  for (const target of targets) {
    if (!sameNamed(target, command, '.exe')) continue
    rememberExe(scan, target)
    if (exists(target)) return target
    scan.forwarder = true
  }

  for (const target of targets) {
    if (isNodeBinary(target)) continue
    const ext = win32.extname(target).toLowerCase()
    if (ext === '.cmd' || ext === '.bat') {
      if (!sameNamed(target, command, ext)) continue
      scan.forwarder = true
      if (!exists(target) || target.toLowerCase() === key) continue
      const followed = resolveFromShim(target, command, exists, read, env, scan, depth + 1, allowPackageLayout)
      if (followed) return followed
      continue
    }
    if (exists(target)) scan.directLauncher = scan.directLauncher ?? filePath
  }

  return null
}

function resolveWindowsCommand(
  candidates: string[],
  command: string,
  deps: WindowsSpawnDeps | undefined,
  allowPackageLayout: boolean,
): ClaudeBinaryResolution {
  const exists = deps?.existsSync ?? existsSync
  const read = deps?.readFileSync ?? readFileSync
  const env = deps?.env ?? process.env
  const home = deps?.homedir ?? homedir()
  const stem = commandStem(command)

  const ranked = candidates
    .map((p) => p.trim())
    .filter(Boolean)
    .filter((p) => isWinSpawnable(p, exists))
    .sort((a, b) => winExtRank(a) - winExtRank(b) || a.length - b.length)

  const scan: ShimScan = { tried: [], seen: new Set(), directLauncher: null, forwarder: false }
  const foundCommand = ranked.find((p) => win32.extname(p).toLowerCase() !== '.exe') ?? ranked[0] ?? null
  for (const candidate of candidates) {
    const trimmed = candidate.trim()
    if (!trimmed || win32.extname(trimmed).toLowerCase() !== '.exe') continue
    rememberExe(scan, trimmed)
  }

  for (const candidate of ranked) {
    if (win32.extname(candidate).toLowerCase() !== '.exe') continue
    const exe = resolveFromShim(candidate, stem, exists, read, env, scan, 0, allowPackageLayout)
    if (exe) {
      return { path: exe, foundCommand: candidate, triedExes: scan.tried, directLauncher: false, forwarder: false }
    }
  }

  for (const shim of ranked) {
    if (win32.extname(shim).toLowerCase() === '.exe') continue
    const exe = resolveFromShim(shim, stem, exists, read, env, scan, 0, allowPackageLayout)
    if (exe) {
      return { path: exe, foundCommand: foundCommand ?? shim, triedExes: scan.tried, directLauncher: false, forwarder: false }
    }
  }

  // A cmd that runs its own local script (test doubles, node-based CLIs) wins
  // over a machine-wide Claude install that happens to exist elsewhere.
  if (scan.directLauncher) {
    return {
      path: scan.directLauncher,
      foundCommand: scan.directLauncher,
      triedExes: scan.tried,
      directLauncher: true,
      forwarder: false,
    }
  }

  if (allowPackageLayout) {
    for (const shim of knownClaudeShims(env, home)) {
      if (!exists(shim)) continue
      const exe = resolveFromShim(shim, stem, exists, read, env, scan, 0, true)
      if (exe) {
        return { path: exe, foundCommand: foundCommand ?? shim, triedExes: scan.tried, directLauncher: false, forwarder: false }
      }
    }
    for (const exePath of knownClaudeExes(env, home)) {
      rememberExe(scan, exePath)
      if (exists(exePath)) {
        return { path: exePath, foundCommand: foundCommand ?? exePath, triedExes: scan.tried, directLauncher: false, forwarder: false }
      }
    }
  }

  // The npm shim itself may be a node launcher (older installs) with no native exe.
  if (scan.directLauncher) {
    return {
      path: scan.directLauncher,
      foundCommand: foundCommand ?? scan.directLauncher,
      triedExes: scan.tried,
      directLauncher: true,
      forwarder: false,
    }
  }

  return {
    path: ranked[0] ?? null,
    foundCommand,
    triedExes: scan.tried,
    directLauncher: false,
    forwarder: scan.forwarder,
  }
}

/**
 * Pick the best Windows spawn path from candidate paths (e.g. all `where` lines).
 * Prefer .exe > .cmd > .bat > .com; never return extensionless npm shims.
 * For claude, also follow forwarders and the npm-global native exe.
 */
export function selectWindowsSpawnPath(
  candidates: string[],
  command: string,
  deps?: WindowsSpawnDeps,
): string | null {
  const stem = commandStem(command)
  return resolveWindowsCommand(candidates, stem, deps, stem.toLowerCase() === 'claude').path
}

/**
 * Resolve Claude Code's native exe on Windows.
 * Does not stop at the first PATH shim: a `~\.local\bin\claude.cmd` forwarder
 * with no sibling node_modules still yields the npm-global `claude.exe`.
 */
export function resolveClaudeBinary(candidates: string[], deps?: WindowsSpawnDeps): ClaudeBinaryResolution {
  return resolveWindowsCommand(candidates, 'claude', deps, true)
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

function isAbsoluteCommand(command: string): boolean {
  return isAbsolute(command) || win32.isAbsolute(command)
}

export async function resolveCLIPath(command: string): Promise<string | null> {
  if (pathCache.has(command)) return pathCache.get(command)!

  const win = process.platform === 'win32'
  const absolute = isAbsoluteCommand(command)
  let fromLookup: string[] = []

  if (!absolute) {
    try {
      const lookup = win ? `where ${command}` : `which ${command}`
      const { stdout } = await execAsync(lookup)
      fromLookup = parseLookupLines(stdout)
    } catch {
      // not found via which/where
    }
  }

  let resolved: string | null = null

  if (win) {
    const stem = commandStem(command)
    const listed = absolute ? [command, ...fromLookup] : fromLookup
    const candidates = [...listed, ...collectCommonCandidates(stem)]
    if (stem.toLowerCase() === 'claude') {
      const resolution = resolveClaudeBinary(candidates)
      const decision = claudeSpawnResult(resolution)
      if (decision.error) throw new ClaudeNativeBinaryError(resolution.foundCommand, resolution.triedExes)
      resolved = decision.path
    } else {
      resolved = selectWindowsSpawnPath(candidates, stem)
    }
  } else if (absolute) {
    resolved = existsSync(command) ? command : null
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
