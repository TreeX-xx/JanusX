import { localPlatform } from '../platform/local-platform'
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
  const platform = localPlatform()
  const runtime = join(base, `node-${MANAGED_NODE_VERSION}-${platform}-${process.arch}`)
  const bin = platform === 'win32' ? runtime : join(runtime, 'bin')
  // Native npm dependencies cannot be shared by Intel and Apple Silicon builds.
  // Keep the existing Windows prefix; leave legacy Mac tools intact for rollback.
  const prefix = join(base, platform === 'darwin' ? `tools-darwin-${process.arch}` : 'tools')
  return { base, runtime, bin, prefix, toolsBin: platform === 'win32' ? prefix : join(prefix, 'bin'),
    modules: join(prefix, platform === 'win32' ? 'node_modules' : 'lib/node_modules'),
    commandExtension: platform === 'win32' ? '.cmd' : '',
    node: join(bin, platform === 'win32' ? 'node.exe' : 'node'),
    npm: join(bin, platform === 'win32' ? 'npm.cmd' : 'npm') }
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
  if (localPlatform() === 'darwin' && isAbsolute(prefix) && !/[:\r\n\0]/.test(prefix)) {
    macNpmBin = join(prefix, 'bin')
  }
}

/** Compatibility export: use the user's environment, without injecting legacy private installs. */
export function managedCliEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const platform = localPlatform()
  const known = platform === 'darwin' ? cliKnownBinDirs(env, platform, homedir()).filter(path => existsSync(path)) : []
  if (platform === 'darwin' && macNpmBin) known.push(macNpmBin)
  const launchEnv = platform === 'darwin' ? macProxyEnvironment(env) : env
  return known.length ? environmentWithPath(launchEnv, platform, [], known) : launchEnv
}
