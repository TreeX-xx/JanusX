import { stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { delimiter, isAbsolute, join, resolve } from 'node:path'
import { execa } from 'execa'
import type { ExternalCliBinarySource, ExternalCliDetectResult, ExternalCliToolId } from '../../shared/ipc/external-cli'
import type { ExternalCliToolDescriptor } from './tool-registry'
import { getExternalCliTool } from './tool-registry'

const PROBE_TIMEOUT_MS = 10_000

export const EXTERNAL_CLI_EXISTING_TERMINAL_NOTICE =
  'Restart existing terminals for the updated PATH to take effect.'

interface CommandResult {
  exitCode: number
  stdout: string
  stderr: string
  timedOut?: boolean
}

interface CliDetectorDependencies {
  env: NodeJS.ProcessEnv
  platform: NodeJS.Platform
  homeDir: string
  isRegularFile(path: string): Promise<boolean>
  run(file: string, args: readonly string[]): Promise<CommandResult>
}

export type { CliDetectorDependencies }

export interface ResolvedCliBinary {
  path: string
  source: ExternalCliBinarySource
}

function binaryNames(tool: ExternalCliToolDescriptor, platform: NodeJS.Platform): readonly string[] {
  if (platform !== 'win32') return tool.binaryNames
  return tool.binaryNames.flatMap(name => [`${name}.cmd`, `${name}.exe`, name])
}

/** 大小写不敏感地读取 PATH（win32 下键名可能是 Path）。 */
export function readPathValue(env: NodeJS.ProcessEnv): string {
  return Object.entries(env).find(([key]) => key.toLowerCase() === 'path')?.[1] ?? ''
}

function expandWindowsVars(raw: string, env: NodeJS.ProcessEnv): string {
  return raw.replace(/%([^%]+)%/g, (_, name: string) => {
    const hit = Object.entries(env).find(([key]) => key.toLowerCase() === String(name).toLowerCase())?.[1]
    return hit ?? ''
  })
}

export function cliKnownBinDirs(env: NodeJS.ProcessEnv, platform: NodeJS.Platform, homeDir: string, tool?: ExternalCliToolDescriptor): string[] {
  if (platform === 'win32') {
    const dirs: string[] = []
    if (env.APPDATA) dirs.push(join(env.APPDATA, 'npm'))
    if (env.ProgramFiles) dirs.push(join(env.ProgramFiles, 'nodejs'))
    for (const raw of tool?.extraKnownDirs?.win32 ?? []) {
      const expanded = expandWindowsVars(raw, env)
      if (expanded) dirs.push(expanded)
    }
    return [...new Set(dirs)]
  }
  const dirs = [
    join(homeDir, '.local', 'bin'),
    join(homeDir, '.npm-global', 'bin'),
    '/usr/local/bin',
    ...(platform === 'darwin' ? ['/opt/homebrew/bin'] : []),
  ]
  return [...new Set(dirs)]
}

/** 兼容旧名：首个工具的已知目录（installer 共用 npm 目录时调用）。 */
export function claudeKnownBinDirs(env: NodeJS.ProcessEnv, platform: NodeJS.Platform, homeDir: string): string[] {
  return cliKnownBinDirs(env, platform, homeDir, getExternalCliTool('claude'))
}

export async function findExecutableOnPath(  names: readonly string[],
  searchDirs: readonly string[],
  isRegularFile: (path: string) => Promise<boolean>,
): Promise<string | undefined> {
  for (const directory of searchDirs) {
    for (const name of names) {
      const candidate = resolve(directory, name)
      if (!isAbsolute(candidate)) continue
      try {
        if (await isRegularFile(candidate)) return candidate
      } catch {
        continue
      }
    }
  }
  return undefined
}

/** Every matching binary in search order; feeds the multi-location confirm dialog. */
export async function findAllExecutablesOnPath(
  names: readonly string[],
  searchDirs: readonly string[],
  isRegularFile: (path: string) => Promise<boolean>,
): Promise<string[]> {
  const found: string[] = []
  for (const directory of searchDirs) {
    for (const name of names) {
      const candidate = resolve(directory, name)
      if (!isAbsolute(candidate)) continue
      if (found.includes(candidate)) continue
      try {
        if (await isRegularFile(candidate)) found.push(candidate)
      } catch {
        continue
      }
    }
  }
  return found
}

export interface CliBinaryLocation {
  path: string
  source: ExternalCliBinarySource
  /** The binary `detect()` would run: first PATH hit, else first known hit. */
  isDefault: boolean
}

function lastLines(text: string, count: number): string {
  return text.split(/\r?\n/).map(line => line.trim()).filter(Boolean).slice(-count).join('\n')
}

function parseVersion(output: string): string | undefined {
  // OpenCode v2 prints "opencode v2.x.y"; normalize the optional v prefix.
  return output.match(/\bv?(\d+\.\d+\.\d+(?:-[\w.]+)?)\b/)?.[1]
}

async function defaultRun(file: string, args: readonly string[]): Promise<CommandResult> {
  try {
    const result = await execa(file, args, {
      timeout: PROBE_TIMEOUT_MS,
      reject: false,
      windowsHide: true,
    })
    return { exitCode: result.exitCode ?? 1, stdout: result.stdout, stderr: result.stderr }
  } catch (error) {
    const failure = error as { exitCode?: number; stdout?: string; stderr?: string; timedOut?: boolean }
    return {
      exitCode: failure.exitCode ?? 1,
      stdout: failure.stdout ?? '',
      stderr: failure.stderr ?? '',
      timedOut: failure.timedOut,
    }
  }
}

/**
 * win32 下统一经 PowerShell 调用已定位的绝对路径，绝不裸调工具名（防劫持与闪窗）。
 * 中文 Windows 的 cmd.exe 按 GBK 输出自身报错（execa 按 UTF-8 解码即乱码），且 chcp 同串无效；
 * 此处显式固定 PowerShell 输出编码为 UTF-8，保证诊断文本可读（实测结论）。
 */
export function quotePowerShellPath(path: string): string {
  return `'${path.replace(/'/g, "''")}'`
}

function versionProbeCommand(platform: NodeJS.Platform, binaryPath: string): { file: string; args: readonly string[] } {
  if (platform === 'win32') {
    const script = `$OutputEncoding=[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new(); & ${quotePowerShellPath(binaryPath)} --version; exit $LASTEXITCODE`
    return { file: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-Command', script] }
  }
  return { file: binaryPath, args: ['--version'] }
}

const defaultDependencies: CliDetectorDependencies = {
  env: process.env,
  platform: process.platform,
  homeDir: homedir(),
  isRegularFile: async path => (await stat(path)).isFile(),
  run: defaultRun,
}

export class CliDetector {
  constructor(
    private readonly toolId: ExternalCliToolId,
    private readonly deps: CliDetectorDependencies = defaultDependencies,
  ) {}

  private get tool(): ExternalCliToolDescriptor {
    const tool = getExternalCliTool(this.toolId)
    if (!tool) throw new Error(`Unsupported tool: ${this.toolId}`)
    return tool
  }

  async findCandidate(): Promise<ResolvedCliBinary | undefined> {
    const names = binaryNames(this.tool, this.deps.platform)
    const pathDirs = readPathValue(this.deps.env).split(delimiter).filter(Boolean)
    const onPath = await findExecutableOnPath(names, pathDirs, path => this.isRegularAbsoluteFile(path))
    if (onPath) return { path: onPath, source: 'path' }
    const knownDirs = cliKnownBinDirs(this.deps.env, this.deps.platform, this.deps.homeDir, this.tool)
    const known = await findExecutableOnPath(names, knownDirs, path => this.isRegularAbsoluteFile(path))
    if (known) return { path: known, source: 'known-location' }
    return undefined
  }

  /**
   * All installed locations, PATH hits first: per-location source, path,
   * and default marker for the upgrade confirm dialog. Shares the exact
   * search order with {@link findCandidate} so the marked default is the
   * binary a bare probe would run.
   */
  async listLocations(): Promise<CliBinaryLocation[]> {
    const names = binaryNames(this.tool, this.deps.platform)
    const pathDirs = readPathValue(this.deps.env).split(delimiter).filter(Boolean)
    const knownDirs = cliKnownBinDirs(this.deps.env, this.deps.platform, this.deps.homeDir, this.tool)
    const seen = new Set<string>()
    const locations: CliBinaryLocation[] = []
    for (const [source, dirs] of [['path', pathDirs], ['known-location', knownDirs]] as const) {
      for (const path of await findAllExecutablesOnPath(names, dirs, candidate => this.isRegularAbsoluteFile(candidate))) {
        if (seen.has(path)) continue
        seen.add(path)
        locations.push({ path, source, isDefault: locations.length === 0 })
      }
    }
    return locations
  }

  async detect(candidateOverride?: ResolvedCliBinary): Promise<ExternalCliDetectResult> {
    const tool = this.tool
    const manualHint = tool.manualInstallCommand
    const candidate = candidateOverride ?? await this.findCandidate()
    if (!candidate) {
      return { toolId: this.toolId, installed: false, runnable: false, hint: manualHint }
    }
    const probe = versionProbeCommand(this.deps.platform, candidate.path)
    const result = await this.deps.run(probe.file, probe.args)
    if (result.exitCode !== 0) {
      return {
        toolId: this.toolId,
        installed: true,
        runnable: false,
        path: candidate.path,
        source: candidate.source,
        hint: result.timedOut
          ? `${tool.displayName} timed out on --version. Reinstall it and retry.`
          : lastLines(`${result.stderr}\n${result.stdout}`, 4) || `${tool.displayName} exited with code ${result.exitCode}.`,
      }
    }
    const version = parseVersion(`${result.stdout}\n${result.stderr}`)
    if (!version) {
      // PowerShell 解析失败时 exit 0 但 stderr 可读，直接透出诊断而非套话。
      const detail = lastLines(`${result.stderr}\n${result.stdout}`, 4)
      return {
        toolId: this.toolId,
        installed: true,
        runnable: false,
        path: candidate.path,
        source: candidate.source,
        hint: detail || `${tool.displayName} ran but reported no parseable version. Reinstall it and retry.`,
      }
    }
    return {
      toolId: this.toolId,
      installed: true,
      runnable: true,
      version,
      path: candidate.path,
      source: candidate.source,
      existingTerminalNotice: EXTERNAL_CLI_EXISTING_TERMINAL_NOTICE,
    }
  }

  private async isRegularAbsoluteFile(candidate: string): Promise<boolean> {
    if (!isAbsolute(candidate)) return false
    try {
      return await this.deps.isRegularFile(candidate)
    } catch {
      return false
    }
  }
}

/** 首个工具的探测器单例（线上默认 wiring 用）。 */
export const claudeDetector = new CliDetector('claude')
