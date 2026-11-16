// Note: .agents/notes/desktop/platform-runtime-boundaries.md
import { createHash } from 'node:crypto'
import { posix, win32 } from 'node:path'
import { runtimePathKey } from '../../shared/runtime/path-identity'

/** Pure target policy: never use the desktop OS to interpret a target's PATH. */
export function targetPath(platform: NodeJS.Platform) { return platform === 'win32' ? win32 : posix }
export function envValue(env: NodeJS.ProcessEnv, name: string, platform: NodeJS.Platform): string | undefined {
  return env[name] ?? (platform === 'win32'
    ? Object.entries(env).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1] : undefined)
}
export function mergeEnvironment(base: NodeJS.ProcessEnv, overrides: NodeJS.ProcessEnv, platform: NodeJS.Platform): NodeJS.ProcessEnv {
  const result = { ...base }
  for (const [key, value] of Object.entries(overrides)) {
    if (platform === 'win32') for (const existing of Object.keys(result)) if (existing.toLowerCase() === key.toLowerCase()) delete result[existing]
    result[key] = value
  }
  return result
}
export function environmentWithPath(env: NodeJS.ProcessEnv, platform: NodeJS.Platform, prepend: readonly string[] = [], append: readonly string[] = []): NodeJS.ProcessEnv {
  const result = { ...env }
  const path = targetPath(platform)
  const entries = [...prepend, ...(envValue(env, 'PATH', platform) ?? '').split(path.delimiter), ...append]
  const seen = new Set<string>()
  const filtered = entries.filter(entry => {
    // Empty PATH entries mean cwd; don't introduce implicit cwd execution.
    if (!entry) return false
    const key = runtimePathKey(entry, platform === 'win32' ? 'windows' : 'posix')
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  if (platform === 'win32') for (const key of Object.keys(result)) if (key.toLowerCase() === 'path') delete result[key]
  result.PATH = filtered.join(path.delimiter)
  return result
}

export function defaultShell(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string {
  if (platform === 'win32') return 'powershell.exe'
  const configured = env.SHELL
  return configured && posix.isAbsolute(configured) ? configured : platform === 'darwin' ? '/bin/zsh' : '/bin/bash'
}

/** Opaque invalidation token; environment values must never be sent to the UI. */
export function environmentRevision(platform: string, architecture: string, home: string, env: NodeJS.ProcessEnv): string {
  const entries = Object.entries(env).filter(([, value]) => value !== undefined).sort(([a], [b]) => a.localeCompare(b))
  return createHash('sha256').update(JSON.stringify([platform, architecture, home, entries])).digest('hex')
}
