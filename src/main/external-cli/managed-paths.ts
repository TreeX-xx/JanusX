import { app } from 'electron'
import { macProxyEnvironment } from '@janusx/llm-core/mac-system-proxy'
import { existsSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
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

// npm can live behind a symlink while its global executables live outside PATH.
let macNpmBin: string | undefined

export function setMacNpmPrefix(prefix: string): void {
  if (process.platform === 'darwin' && isAbsolute(prefix) && !/[:\r\n\0]/.test(prefix)) {
    macNpmBin = join(prefix, 'bin')
  }
}

/** Compatibility export: use the user's environment, without injecting legacy private installs. */
export function managedCliEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const known = process.platform === 'darwin' ? cliKnownBinDirs(env, process.platform, homedir()).filter(path => existsSync(path)) : []
  if (process.platform === 'darwin' && macNpmBin) known.push(macNpmBin)
  const launchEnv = process.platform === 'darwin' ? macProxyEnvironment(env) : env
  return known.length ? environmentWithPath(launchEnv, process.platform, [], known) : launchEnv
}
