// Note: .agents/notes/desktop/platform-runtime-boundaries.md
import { createShellProfileSeed, shellCandidateProbes } from '../../shared/shellProfiles'
import { findCommands } from './command-resolver'
import { localRuntimeContext } from './runtime-context'

export function localDefaultShell(): string { return localRuntimeContext().shell }
export function localShellProfileSeed() {
  const context = localRuntimeContext()
  const name = context.shell.split(/[\\/]/).pop()?.replace(/\.exe$/i, '') ?? 'shell'
  return { ...createShellProfileSeed(context.identity.platform!), id: `shell-${name}`, name: ({ powershell: 'PowerShell', bash: 'Bash', zsh: 'Zsh', fish: 'Fish' } as Record<string, string>)[name] ?? name, command: context.shell }
}
export function localShellProbes() { return shellCandidateProbes(localRuntimeContext().identity.platform!) }
export function findLocalCommands(command: string): string[] {
  const context = localRuntimeContext()
  return findCommands(command, { platform: context.identity.platform!, env: context.env })
}
