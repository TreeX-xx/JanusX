import { existsSync } from 'node:fs'
import { findLocalCommands, localDefaultShell, localShellProbes } from '../platform/local-shell'
import { configService } from '../config/service'
import {
  composeShellEntryLaunch,
  composeShellLaunchFromCommandLine,
  describeShellEntry,
  getDefaultShellEntry,
  isShellEntryLaunchable,
  normalizeShellProfiles,
  shellEntryExecutable,
  type ShellCandidate,
  type ShellProfileEntry,
  type ShellProfilesSettings,
} from '../../shared/shellProfiles'


export function getShellProfilesSettings(): ShellProfilesSettings {
  return configService.getShellProfiles()
}

export async function saveShellProfiles(settings: unknown): Promise<ShellProfilesSettings> {
  return configService.updateShellProfiles(normalizeShellProfiles(settings))
}

/** The launch line of the configured default entry, or the platform fallback. */
export function getDefaultShellCommand(): string {
  const settings = getShellProfilesSettings()
  const entry = getDefaultShellEntry(settings)
  if (entry) return describeShellEntry(entry)
  return localDefaultShell()
}

export function getShellProfileEntry(id: string | undefined): ShellProfileEntry | undefined {
  const settings = getShellProfilesSettings()
  if (id) {
    const matched = settings.entries.find((entry) => entry.id === id)
    // 条目被删除或还在填命令（草稿）时不能中断启动：落到默认条目。
    if (matched && isShellEntryLaunchable(matched)) return matched
  }
  return getDefaultShellEntry(settings)
}

export interface ShellProfileLaunch {
  program?: { command: string; args: string[] }
  /** Set when the entry cannot start; the caller throws inside its own try so rollback runs. */
  error?: string
}

/**
 * Resolve the program for an ordinary shell terminal. Returns no program when
 * no entry is configured at all, which keeps the legacy `config.shell` spawn.
 */
export async function resolveShellProfileLaunch(input: {
  id?: string
  commandLine?: string
}): Promise<ShellProfileLaunch> {
  if (input.commandLine) {
    const program = composeShellLaunchFromCommandLine(input.commandLine)
    if (!program) return { error: 'Restored shell command is empty' }
    const resolved = findLocalCommands(program.command)[0]
    return resolved ? { program: { ...program, command: resolved } } : { error: `Restored shell was not found: ${program.command}` }
  }

  const entry = getShellProfileEntry(input.id)
  if (!entry) return {}

  const program = composeShellEntryLaunch(entry)
  if (!program) return { error: `Shell "${entry.name}" has no command` }

  const missing = await findMissingExecutable(program.command)
  if (missing) {
    return {
      error:
        missing === 'path'
          ? `Shell "${entry.name}" was not found at ${program.command} — install it or update the command in settings`
          : `Shell "${entry.name}" (${program.command}) was not found on this machine — install it or update the command in settings`,
    }
  }
  const resolved = findLocalCommands(program.command)[0]
  return resolved ? { program: { ...program, command: resolved } } : { error: `Shell "${entry.name}" is not executable: ${program.command}` }
}

/** 'path' = explicit path does not exist, 'name' = executable not on PATH. */
async function findMissingExecutable(command: string): Promise<'path' | 'name' | null> {
  if (command.includes('/') || command.includes('\\')) {
    return existsSync(command) ? null : 'path'
  }
  const resolved = await probeExecutable(command)
  return resolved ? null : 'name'
}

async function probeExecutable(executable: string): Promise<string | undefined> {
  return findLocalCommands(executable)[0]
}

/**
 * Detected shells that are not configured yet. Candidates stay out of the
 * entry points until the user confirms them into the list (AC-5).
 */
export async function detectShellCandidates(): Promise<ShellCandidate[]> {
  const settings = getShellProfilesSettings()
  const configuredExecutables = new Set(settings.entries.map(shellEntryExecutable))
  const probes = localShellProbes()
  const candidates: ShellCandidate[] = []
  for (const probe of probes) {
    const resolvedPath = await probeExecutablePath(probe)
    if (!resolvedPath) continue
    candidates.push({
      executable: probe.executable,
      path: resolvedPath,
      suggestedName: probe.suggestedName,
      ...(probe.suggestedSuffix ? { suggestedSuffix: probe.suggestedSuffix } : {}),
      configured: configuredExecutables.has(probe.executable),
    })
  }
  return candidates
}

/** All resolved paths, preferring a match for `preferPathPattern` (Git for Windows bash). */
async function probeExecutablePath(probe: {
  executable: string
  preferPathPattern?: RegExp
}): Promise<string | undefined> {
  const lines = findLocalCommands(probe.executable)
  if (lines.length === 0) return undefined
  if (probe.preferPathPattern) {
    const preferred = lines.find((line) => probe.preferPathPattern?.test(line))
    if (preferred) return preferred
  }
  return lines[0]
}
