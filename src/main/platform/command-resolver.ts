// Note: .agents/notes/desktop/platform-runtime-boundaries.md
import { accessSync, constants, statSync } from 'node:fs'
import { envValue, targetPath } from './environment'
import { runtimePathKey } from '../../shared/runtime/path-identity'

export interface CommandEnvironment { platform: NodeJS.Platform; env: NodeJS.ProcessEnv; knownDirs?: readonly string[] }
export type CommandFileState = 'executable' | 'missing' | 'not-file' | 'permission-denied'
export function inspectCommandFile(file: string, platform: NodeJS.Platform): CommandFileState {
  try {
    if (!statSync(file).isFile()) return 'not-file'
    if (platform !== 'win32') accessSync(file, constants.X_OK)
    return 'executable'
  } catch (error) {
    return ['EACCES', 'EPERM'].includes((error as NodeJS.ErrnoException).code ?? '') ? 'permission-denied' : 'missing'
  }
}

export function commandCandidates(command: string, context: CommandEnvironment): string[] {
  const path = targetPath(context.platform)
  if (path.isAbsolute(command)) return [path.normalize(command)]
  // Relative commands require an explicit cwd policy, never the desktop cwd.
  if (command.includes('/') || command.includes('\\') || command.includes('\0')) return []
  const names = context.platform === 'win32' && !path.extname(command)
    ? ['.exe', '.cmd', '.bat', '.com'].map(ext => command + ext) : [command]
  const directories = [...(envValue(context.env, 'PATH', context.platform) ?? '').split(path.delimiter), ...(context.knownDirs ?? [])]
  const seen = new Set<string>()
  return directories.filter(directory => path.isAbsolute(directory)).flatMap(directory => names.map(name => path.join(directory, name))).filter(file => {
    const key = runtimePathKey(file, context.platform === 'win32' ? 'windows' : 'posix')
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function findCommands(command: string, context: CommandEnvironment, inspect = inspectCommandFile): string[] {
  return commandCandidates(command, context).filter(file => inspect(file, context.platform) === 'executable')
}

export function resolveCommand(command: string, context: CommandEnvironment, inspect = inspectCommandFile): { path: string | null; state: CommandFileState } {
  let state: CommandFileState = 'missing'
  for (const file of commandCandidates(command, context)) {
    const result = inspect(file, context.platform)
    if (result === 'executable') return { path: file, state: result }
    if (result !== 'missing') state = result
  }
  return { path: null, state }
}
