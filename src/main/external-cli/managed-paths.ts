import { app } from 'electron'
import { existsSync } from 'node:fs'
import { delimiter, join } from 'node:path'

export const MANAGED_NODE_VERSION = '24.22.2'

export function managedCliPaths(root?: string) {
  const base = root ?? join(app.getPath('userData'), 'cli-runtime')
  const runtime = join(base, `node-${MANAGED_NODE_VERSION}-${process.platform}-${process.arch}`)
  const bin = process.platform === 'win32' ? runtime : join(runtime, 'bin')
  const prefix = join(base, 'tools')
  return { base, runtime, bin, prefix, toolsBin: process.platform === 'win32' ? prefix : join(prefix, 'bin'),
    node: join(bin, process.platform === 'win32' ? 'node.exe' : 'node'),
    npm: join(bin, process.platform === 'win32' ? 'npm.cmd' : 'npm') }
}

export function managedCliDirs(): string[] {
  try {
    const paths = managedCliPaths()
    return [paths.toolsBin, paths.bin].filter(path => existsSync(path))
  } catch { return [] }
}

/** Child-process environment only; never writes the system or app PATH. */
export function managedCliEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const dirs = managedCliDirs()
  if (!dirs.length) return env
  const key = Object.keys(env).find(key => key.toLowerCase() === 'path') ?? 'PATH'
  const result = { ...env }
  delete result[key]
  result.PATH = [...dirs, env[key] ?? ''].join(delimiter)
  return result
}
