import { app } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { cliKnownBinDirs } from './search-paths'
import { environmentWithPath } from '../platform/environment'

export const MANAGED_NODE_VERSION = '24.22.2'

export function managedCliPaths(root?: string) {
  const base = root ?? join(app.getPath('userData'), 'cli-runtime')
  const runtime = join(base, `node-${MANAGED_NODE_VERSION}-${process.platform}-${process.arch}`)
  const bin = process.platform === 'win32' ? runtime : join(runtime, 'bin')
  // Native npm dependencies cannot be shared by Intel and Apple Silicon builds.
  // Keep the existing Windows prefix; leave legacy Mac tools intact for rollback.
  const prefix = join(base, process.platform === 'darwin' ? `tools-darwin-${process.arch}` : 'tools')
  return { base, runtime, bin, prefix, toolsBin: process.platform === 'win32' ? prefix : join(prefix, 'bin'),
    modules: join(prefix, process.platform === 'win32' ? 'node_modules' : 'lib/node_modules'),
    commandExtension: process.platform === 'win32' ? '.cmd' : '',
    node: join(bin, process.platform === 'win32' ? 'node.exe' : 'node'),
    npm: join(bin, process.platform === 'win32' ? 'npm.cmd' : 'npm') }
}

export function managedCliDirs(): string[] {
  try {
    const paths = managedCliPaths()
    return [paths.toolsBin, paths.bin].filter(path => existsSync(path))
  } catch { return [] }
}

/** Compatibility export: use the user's environment, without injecting legacy private installs. */
export function managedCliEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const known = process.platform === 'darwin' ? cliKnownBinDirs(env, process.platform, homedir()).filter(path => existsSync(path)) : []
  if (!known.length) return env
  return environmentWithPath(env, process.platform, [], known)
}
