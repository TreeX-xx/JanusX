// Note: .agents/notes/desktop/platform-runtime-boundaries.md
import { localPlatform } from './local-platform'
import { homedir } from 'node:os'
import { managedCliEnv } from '../external-cli/managed-paths'
import type { RuntimeIdentity } from '../../shared/runtime/contracts'
import { runtimeIdentityFromProbe } from '../../shared/runtime/contracts'
import { defaultShell, environmentRevision } from './environment'

export interface RuntimeContext {
  identity: RuntimeIdentity
  env: NodeJS.ProcessEnv
  shell: string
}
export interface ResolvedLaunch {
  identity: RuntimeIdentity
  program: string
  args: string[]
  cwd?: string
  env: NodeJS.ProcessEnv
  source: string
  version?: string
}

export function localSystem() { return { platform: localPlatform(), architecture: process.arch, home: homedir() } }

/** Fresh snapshots make PATH/config changes invalidate resolutions, including misses. */
export function localRuntimeContext(env: NodeJS.ProcessEnv = managedCliEnv()): RuntimeContext {
  const { platform, architecture, home } = localSystem()
  const snapshot = Object.freeze({ ...env })
  return {
    identity: runtimeIdentityFromProbe({ id: 'local', kind: 'local', revision: environmentRevision(platform, architecture, home, snapshot) }, { platform, architecture, home }),
    env: snapshot,
    shell: defaultShell(platform, snapshot),
  }
}

export function assertLocalLaunch(launch: ResolvedLaunch, current: RuntimeContext): void {
  if (launch.identity.kind !== 'local' || launch.identity.id !== current.identity.id) throw new Error('Launch belongs to another execution target')
  if (launch.identity.revision !== current.identity.revision) throw new Error('Launch environment changed; resolve the command again')
}
