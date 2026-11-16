import { findLocalCommands, localDefaultShell } from '../platform/local-shell'
import { getTerminalPresetMeta, resolveTerminalLaunchCommand } from '../../shared/terminalLaunch'
import type { TerminalPreset, TerminalPresetConfig } from './types'


function createPresetConfig(
  preset: TerminalPreset,
  name: string,
  description: string
): TerminalPresetConfig {
  const meta = getTerminalPresetMeta(preset)
  return {
    name,
    preset,
    command: meta.command,
    args: meta.args,
    description,
  }
}

export const PRESETS: Record<TerminalPreset, TerminalPresetConfig> = {
  shell: createPresetConfig('shell', '普通终端', 'Bash / Zsh / PowerShell'),
  claude: createPresetConfig('claude', 'Claude Code', '自动启动 Claude Code CLI'),
  codex: createPresetConfig('codex', 'Codex', '自动启动 Codex CLI'),
  opencode: createPresetConfig('opencode', 'OpenCode', '自动启动 OpenCode CLI'),
  janus: createPresetConfig('janus', 'Janus', '自动启动 Janus CLI'),
  'pi': createPresetConfig('pi', 'Pi', '自动启动 Pi CLI'),
  dsh: createPresetConfig('dsh', 'DeepSeek', '自动启动 DeepSeek Harness TUI'),
}

export function getAutoCommand(preset: TerminalPreset): string | undefined {
  return resolveTerminalLaunchCommand(preset)
}

export function getPresetName(preset: TerminalPreset): string {
  return PRESETS[preset]?.name ?? '终端'
}

export async function checkCommandExists(command: string): Promise<boolean> {
  return findLocalCommands(command).length > 0
}

export function getDefaultShell(): string {
  return localDefaultShell()
}

export function getShellName(shell: string): string {
  const basename = shell.split(/[/\\]/).pop() ?? shell
  const nameMap: Record<string, string> = {
    bash: 'Bash',
    zsh: 'Zsh',
    fish: 'Fish',
    powershell: 'PowerShell',
    'powershell.exe': 'PowerShell',
    pwsh: 'PowerShell',
    cmd: 'CMD',
    'cmd.exe': 'CMD',
  }
  return nameMap[basename.toLowerCase()] ?? basename
}
