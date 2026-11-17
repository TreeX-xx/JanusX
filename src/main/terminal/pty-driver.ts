// Note: .agents/notes/desktop/platform-runtime-boundaries.md
import { spawn, type IPty } from 'node-pty'
import { existsSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import type { TerminalConfig } from './types'
import { logTerminalDiagnostic } from './diagnostics'
import { localRuntimeContext } from '../platform/runtime-context'
import { environmentWithPath, mergeEnvironment } from '../platform/environment'

const require = createRequire(import.meta.url)
const CONPTY_FILES = ['conpty.dll', 'OpenConsole.exe'] as const
export const DEFAULT_COLS = 120
export const DEFAULT_ROWS = 40
export const MAX_COLS = 1_000
export const MAX_ROWS = 1_000

export function normalizePtyDimension(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(maximum, Math.max(minimum, Math.floor(value)))
}

function findConptySourceDir(packageRoot: string): string | null {
  const prebuildDir = join(packageRoot, 'prebuilds', `${process.platform}-${process.arch}`, 'conpty')
  if (CONPTY_FILES.every(file => existsSync(join(prebuildDir, file)))) {
    return prebuildDir
  }

  const thirdPartyRoot = join(packageRoot, 'third_party', 'conpty')
  if (!existsSync(thirdPartyRoot)) return null

  const archDir = process.arch === 'arm64' ? 'win10-arm64' : 'win10-x64'
  for (const version of readdirSync(thirdPartyRoot)) {
    const candidate = join(thirdPartyRoot, version, archDir)
    if (CONPTY_FILES.every(file => existsSync(join(candidate, file)))) {
      return candidate
    }
  }

  return null
}

function hasBundledConptyFiles(): boolean {
  if (process.platform !== 'win32') return false

  const packageRoot = dirname(require.resolve('node-pty/package.json'))
  const sourceDir = findConptySourceDir(packageRoot)
  if (sourceDir) {
    logTerminalDiagnostic('conpty source ready', { packageRoot, sourceDir })
    return true
  }

  const destDir = join(packageRoot, 'build', 'Release', 'conpty')

  if (CONPTY_FILES.every(file => existsSync(join(destDir, file)))) {
    logTerminalDiagnostic('conpty build release ready', { packageRoot, destDir })
    return true
  }

  logTerminalDiagnostic('conpty files missing', { packageRoot, destDir })
  return false
}

export function spawnLocalPty(
  file: string,
  args: string[],
  config: TerminalConfig,
  officecliPathDir?: string,
): IPty {
  const context = localRuntimeContext()
  const useBundledConptyDll = hasBundledConptyFiles()
  const cols = normalizePtyDimension(config.cols, DEFAULT_COLS, 2, MAX_COLS)
  const rows = normalizePtyDimension(config.rows, DEFAULT_ROWS, 1, MAX_ROWS)

  const baseOptions = {
    name: 'xterm-256color',
    cols,
    rows,
    cwd: config.cwd,
    env: environmentWithPath(mergeEnvironment(config.launch?.env ?? context.env, { ...(config.env ?? {}), TERM: 'xterm-256color', TERM_PROGRAM: 'JanusX' }, context.identity.platform!), context.identity.platform!, officecliPathDir ? [officecliPathDir] : []) as Record<string, string>,
    /*-- 显式启用 ConPTY（build≥18309 默认开，显式更稳妥），Windows 有效，非 Windows 忽略 --*/
    useConpty: true,
  }

  try {
    const pty = spawn(file, args, {
      ...baseOptions,
      useConptyDll: useBundledConptyDll,
    })
    logTerminalDiagnostic('pty spawned', {
      id: config.id,
      cwd: config.cwd,
      file,
      argumentCount: args.length,
      cols,
      rows,
      useConptyDll: useBundledConptyDll,
      pid: pty.pid,
    })
    return pty
  } catch (err) {
    logTerminalDiagnostic('pty spawn failed', {
      id: config.id,
      cwd: config.cwd,
      file,
      argumentCount: args.length,
      useConptyDll: useBundledConptyDll,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    })
    if (!useBundledConptyDll) throw err

    try {
      const fallbackPty = spawn(file, args, {
        ...baseOptions,
        useConptyDll: false,
      })
      logTerminalDiagnostic('pty spawned with system conpty fallback', {
        id: config.id,
        cwd: config.cwd,
        file,
        argumentCount: args.length,
        pid: fallbackPty.pid,
      })
      return fallbackPty
    } catch (fallbackErr) {
      logTerminalDiagnostic('pty system conpty fallback failed', {
        id: config.id,
        cwd: config.cwd,
        file,
        argumentCount: args.length,
        error: fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr),
        stack: fallbackErr instanceof Error ? fallbackErr.stack : undefined,
      })
      throw fallbackErr
    }
  }
}

