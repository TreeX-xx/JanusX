// Note: .agents/notes/desktop/platform-runtime-boundaries.md
import { cliKnownBinDirs } from '../external-cli/search-paths'
import { getExternalCliTool } from '../external-cli/tool-registry'
import { resolveCommand, inspectCommandFile } from './command-resolver'
import { localRuntimeContext, type ResolvedLaunch, type RuntimeContext } from './runtime-context'
import { ClaudeNativeBinaryError, claudeSpawnResult, resolveClaudeBinary, selectWindowsSpawnPath, type WindowsSpawnDeps } from './windows-command'
import { targetPath } from './environment'

export function resolveCliExecutable(command: string, context: RuntimeContext = localRuntimeContext(), inspect = inspectCommandFile, readFile?: WindowsSpawnDeps['readFileSync']): string | null {
  const { identity, env } = context
  if (identity.kind !== 'local' || identity.platform === null || identity.home === null) throw new Error('Local CLI resolution requires a known local target')
  const platform = identity.platform
  const stem = targetPath(platform).basename(command).replace(/\.(exe|cmd|bat|com)$/i, '')
  const knownDirs = cliKnownBinDirs(env, platform, identity.home, getExternalCliTool(stem))
  const search = { platform, env, knownDirs }
  const selected = resolveCommand(command, search, inspect).path
  if (platform !== 'win32') return selected
  // Detection chooses the first installation in PATH order. Refine that one
  // shim/native package; never let an unrelated later .exe overtake it.
  const candidates = selected ? [selected] : []
  const deps = { env, homedir: identity.home, existsSync: (file: string) => inspect(file, platform) === 'executable', readFileSync: readFile }
  if (stem.toLowerCase() === 'claude') {
    const resolved = resolveClaudeBinary(candidates, deps)
    const decision = claudeSpawnResult(resolved)
    if (decision.error) throw new ClaudeNativeBinaryError(resolved.foundCommand, resolved.triedExes)
    return decision.path
  }
  return selectWindowsSpawnPath(candidates, stem, deps)
}

export function resolveCliLaunch(command: string, args: readonly string[], cwd?: string, context = localRuntimeContext()): ResolvedLaunch | null {
  const program = resolveCliExecutable(command, context)
  return program ? { identity: context.identity, program, args: [...args], cwd, env: context.env, source: 'local-command' } : null
}
