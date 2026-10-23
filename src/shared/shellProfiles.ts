import type { TerminalPreset } from './terminalLaunch'

// Note: .agents/notes/terminal/shell-profiles.md — Janus is opt-in at new-terminal entry points.
export const DEFAULT_HIDDEN_CLI_PRESETS: readonly TerminalPreset[] = ['janus']

/**
 * One user-built ordinary-shell entry in the settings "终端管理" list.
 * The command is free-form: JanusX never parses or restricts what the user
 * writes (`bash --login -i`, `ssh user@host`, `docker exec -it foo zsh`, …).
 */
export interface ShellProfileEntry {
  id: string
  name: string
  command: string
  /** Launch suffix appended as trailing argv at spawn time. */
  suffix?: string
  visible: boolean
  isDefault: boolean
}

export interface ShellProfilesSettings {
  entries: ShellProfileEntry[]
  /**
   * CLI preset ids hidden from the new-terminal entries. Hiding only affects
   * the entry points; running terminals and sessions stay visible.
   */
  hiddenCliPresets: string[]
}

/** A shell detected on this machine that is not configured yet. */
export interface ShellCandidate {
  executable: string
  /** Absolute path when the probe resolved one. */
  path?: string
  suggestedName: string
  suggestedSuffix?: string
  /** True when an existing entry already covers this executable. */
  configured: boolean
}

export interface ShellCandidateProbe {
  executable: string
  suggestedName: string
  suggestedSuffix?: string
  /** Windows only: prefer a resolved path matching this (Git for Windows bash). */
  preferPathPattern?: RegExp
}

/** 首版只预置一条默认种子项，其余 shell 由检测候选区确认后入库。 */
export function createShellProfileSeed(platform: NodeJS.Platform): ShellProfileEntry {
  return platform === 'win32'
    ? { id: 'shell-powershell', name: 'PowerShell', command: 'powershell.exe', visible: true, isDefault: true }
    : { id: 'shell-bash', name: 'Bash', command: 'bash', visible: true, isDefault: true }
}

/**
 * Split a free-form command line into argv, honouring single/double quotes.
 * Backslashes stay literal so Windows paths survive inside quotes.
 */
export function parseCommandLine(line: string): string[] {
  const tokens: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  let started = false
  for (const char of line) {
    if (quote) {
      if (char === quote) {
        quote = null
        continue
      }
      current += char
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      started = true
      continue
    }
    if (/\s/.test(char)) {
      if (started) {
        tokens.push(current)
        current = ''
        started = false
      }
      continue
    }
    current += char
    started = true
  }
  if (started) tokens.push(current)
  return tokens
}

/** Wrap a single argv token in double quotes when it contains whitespace. */
export function quoteCommandToken(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return trimmed
  return /\s/.test(trimmed) ? `"${trimmed}"` : trimmed
}

/** Program + argv for a direct PTY spawn: command argv first, suffix as trailing argv. */
export function composeShellEntryLaunch(
  entry: ShellProfileEntry,
): { command: string; args: string[] } | null {
  const tokens = parseCommandLine(entry.command)
  if (tokens.length === 0) return null
  const suffixTokens = entry.suffix ? parseCommandLine(entry.suffix) : []
  return { command: tokens[0], args: [...tokens.slice(1), ...suffixTokens] }
}

/** Same contract as {@link composeShellEntryLaunch} for a whole command line. */
export function composeShellLaunchFromCommandLine(
  commandLine: string,
): { command: string; args: string[] } | null {
  const tokens = parseCommandLine(commandLine)
  if (tokens.length === 0) return null
  return { command: tokens[0], args: tokens.slice(1) }
}

/** Executable identity used to match entries against detected candidates. */
export function shellEntryExecutable(entry: ShellProfileEntry): string {
  const tokens = parseCommandLine(entry.command)
  const first = tokens.length > 0 ? tokens[0] : ''
  const basename = first.split(/[/\\]/).pop() ?? first
  return basename.toLowerCase().replace(/\.exe$/, '')
}

/** Display form of the full launch line (command plus suffix). */
export function describeShellEntry(entry: ShellProfileEntry): string {
  return [entry.command.trim(), entry.suffix?.trim()].filter(Boolean).join(' ')
}

export function listVisibleShellEntries(settings: ShellProfilesSettings): ShellProfileEntry[] {
  return settings.entries.filter((entry) => entry.visible && isShellEntryLaunchable(entry))
}

/** True when the entry has a command that can be spawned. */
export function isShellEntryLaunchable(entry: ShellProfileEntry): boolean {
  return composeShellEntryLaunch(entry) !== null
}

/** The single default entry; a command-less draft is never the default. */
export function getDefaultShellEntry(settings: ShellProfilesSettings): ShellProfileEntry | undefined {
  return (
    settings.entries.find((entry) => entry.isDefault && isShellEntryLaunchable(entry)) ??
    settings.entries.find(isShellEntryLaunchable)
  )
}

export function isCliPresetHidden(settings: ShellProfilesSettings, preset: TerminalPreset): boolean {
  return settings.hiddenCliPresets.includes(preset)
}

/** CLI presets offered at the new-terminal entries after the visibility filter. */
export function listVisibleCliPresets(
  settings: ShellProfilesSettings,
  presets: readonly TerminalPreset[],
): TerminalPreset[] {
  return presets.filter((preset) => !isCliPresetHidden(settings, preset))
}

/** Enforce one default and unique ids; never seeds, so an emptied list stays empty. */
export function normalizeShellProfiles(raw: unknown): ShellProfilesSettings {
  const source = (raw ?? {}) as Partial<ShellProfilesSettings>
  const entries: ShellProfileEntry[] = []
  const seenIds = new Set<string>()
  const rawEntries = Array.isArray(source.entries) ? source.entries : []
  rawEntries.forEach((item, index) => {
    const entry = normalizeShellEntry(item, index)
    if (!entry || seenIds.has(entry.id)) return
    seenIds.add(entry.id)
    entries.push(entry)
  })

  // 空命令只是「刚新增还没填」的草稿：不能当默认项，也不进新建入口。
  for (const entry of entries) {
    if (!isShellEntryLaunchable(entry)) entry.isDefault = false
  }

  let defaultAssigned = false
  for (const entry of entries) {
    if (entry.isDefault && !defaultAssigned) defaultAssigned = true
    else entry.isDefault = false
  }
  if (!defaultAssigned) {
    const fallback =
      entries.find((entry) => entry.visible && isShellEntryLaunchable(entry)) ??
      entries.find(isShellEntryLaunchable)
    if (fallback) fallback.isDefault = true
  }

  const hiddenCliPresets = Array.isArray(source.hiddenCliPresets)
    ? source.hiddenCliPresets.filter((value): value is TerminalPreset => typeof value === 'string')
    : DEFAULT_HIDDEN_CLI_PRESETS

  return {
    entries,
    hiddenCliPresets: [...new Set(hiddenCliPresets)],
  }
}

function normalizeShellEntry(raw: unknown, index: number): ShellProfileEntry | null {
  if (!raw || typeof raw !== 'object') return null
  const source = raw as Partial<ShellProfileEntry>
  const command = typeof source.command === 'string' ? source.command.trim() : ''
  const rawName = typeof source.name === 'string' ? source.name.trim() : ''
  // 草稿可以只有名字没有命令；两者都空才算无效条目。
  if (!command && !rawName) return null
  const name = rawName || command
  const id = typeof source.id === 'string' && source.id.trim() ? source.id.trim() : fallbackShellEntryId(name, index)
  const suffix = typeof source.suffix === 'string' && source.suffix.trim() ? source.suffix.trim() : undefined
  return {
    id,
    name,
    command,
    ...(suffix ? { suffix } : {}),
    visible: source.visible !== false,
    isDefault: source.isDefault === true,
  }
}

function fallbackShellEntryId(name: string, index: number): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug ? `shell-${slug}` : `shell-${index}`
}

/** Detection probes per platform. WSL is deliberately absent (首版不做专门支持). */
export function shellCandidateProbes(platform: NodeJS.Platform): ShellCandidateProbe[] {
  if (platform === 'win32') {
    return [
      // Git for Windows bash.exe; git-bash.exe opens its own window and is not probed.
      { executable: 'bash', suggestedName: 'Git Bash', suggestedSuffix: '--login -i', preferPathPattern: /\\git\\/i },
      { executable: 'pwsh', suggestedName: 'PowerShell 7' },
      { executable: 'powershell', suggestedName: 'PowerShell' },
      { executable: 'cmd', suggestedName: 'CMD' },
    ]
  }
  return [
    { executable: 'zsh', suggestedName: 'Zsh' },
    { executable: 'bash', suggestedName: 'Bash', suggestedSuffix: '--login -i' },
    { executable: 'fish', suggestedName: 'Fish' },
    { executable: 'sh', suggestedName: 'Shell' },
  ]
}
