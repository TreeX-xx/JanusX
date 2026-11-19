import { stat } from 'node:fs/promises'
import { targetPath, envValue } from '../platform/environment'
import { runProcess } from '../platform/process-host'
import { resolveCliExecutable } from '../platform/cli-launch'
import { localRuntimeContext, localSystem } from '../platform/runtime-context'
import { managedCliEnv } from './managed-paths'
import { cliKnownBinDirs } from './search-paths'
export { cliKnownBinDirs, readPathValue } from './search-paths'
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
  return tool.binaryNames.flatMap(name => [`${name}.exe`, `${name}.cmd`, `${name}.bat`, `${name}.com`])
}

/** 兼容旧名：首个工具的已知目录（installer 共用 npm 目录时调用）。 */
export function claudeKnownBinDirs(env: NodeJS.ProcessEnv, platform: NodeJS.Platform, homeDir: string): string[] {
  return cliKnownBinDirs(env, platform, homeDir, getExternalCliTool('claude'))
}

export async function findExecutableOnPath(  names: readonly string[],
  searchDirs: readonly string[],
  isRegularFile: (path: string) => Promise<boolean>,
  platform: NodeJS.Platform = defaultDependencies.platform,
): Promise<string | undefined> {
  const { resolve, isAbsolute } = targetPath(platform)
  for (const directory of searchDirs) {
    if (!isAbsolute(directory)) continue
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
  platform: NodeJS.Platform = defaultDependencies.platform,
): Promise<string[]> {
  const { resolve, isAbsolute } = targetPath(platform)
  const found: string[] = []
  for (const directory of searchDirs) {
    if (!isAbsolute(directory)) continue
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

async function defaultRun(file: string, args: readonly string[], env = managedCliEnv()): Promise<CommandResult> {
  const result = await runProcess(file, args, { timeoutMs: PROBE_TIMEOUT_MS, env })
  return { exitCode: result.status === 'exited' ? result.exitCode ?? 1 : 1, stdout: result.stdout,
    stderr: result.stderr || (result.status !== 'exited' ? `CLI process ${result.status}` : ''), timedOut: result.status === 'timed-out' }
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
  get env() { return managedCliEnv() },
  get platform() { return localSystem().platform },
  get homeDir() { return localSystem().home },
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

  private launchCandidate(candidate: ResolvedCliBinary): ResolvedCliBinary {
    // Injected detectors own their virtual filesystem; production shares the
    // same native/shim resolution as launch, including the reported path.
    if (this.deps !== defaultDependencies) return candidate
    try {
      const path = resolveCliExecutable(candidate.path, localRuntimeContext(this.deps.env))
      return path ? { ...candidate, path } : candidate
    } catch { return candidate } // broken forwarders remain visible as installed but unrunnable
  }

  async findCandidate(): Promise<ResolvedCliBinary | undefined> {
    const names = binaryNames(this.tool, this.deps.platform)
    const pathDirs = (envValue(this.deps.env, 'PATH', this.deps.platform) ?? '').split(targetPath(this.deps.platform).delimiter).filter(Boolean)
    const onPath = await findExecutableOnPath(names, pathDirs, path => this.isRegularAbsoluteFile(path), this.deps.platform)
    if (onPath) return this.launchCandidate({ path: onPath, source: 'path' })
    const knownDirs = cliKnownBinDirs(this.deps.env, this.deps.platform, this.deps.homeDir, this.tool)
    const known = await findExecutableOnPath(names, knownDirs, path => this.isRegularAbsoluteFile(path), this.deps.platform)
    if (known) return this.launchCandidate({ path: known, source: 'known-location' })
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
    const pathDirs = (envValue(this.deps.env, 'PATH', this.deps.platform) ?? '').split(targetPath(this.deps.platform).delimiter).filter(Boolean)
    const knownDirs = cliKnownBinDirs(this.deps.env, this.deps.platform, this.deps.homeDir, this.tool)
    const seen = new Set<string>()
    const locations: CliBinaryLocation[] = []
    for (const [source, dirs] of [['path', pathDirs], ['known-location', knownDirs]] as const) {
      for (const binary of await findAllExecutablesOnPath(names, dirs, candidate => this.isRegularAbsoluteFile(candidate), this.deps.platform)) {
        const { path } = this.launchCandidate({ path: binary, source })
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
    const candidate = candidateOverride ? this.launchCandidate(candidateOverride) : await this.findCandidate()
    if (!candidate) {
      return { toolId: this.toolId, installed: false, runnable: false, hint: manualHint }
    }
    const probe = versionProbeCommand(this.deps.platform, candidate.path)
    const result = this.deps === defaultDependencies
      ? await defaultRun(probe.file, probe.args, this.deps.env)
      : await this.deps.run(probe.file, probe.args)
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
    if (!targetPath(this.deps.platform).isAbsolute(candidate)) return false
    try {
      return await this.deps.isRegularFile(candidate)
    } catch {
      return false
    }
  }
}

/** 首个工具的探测器单例（线上默认 wiring 用）。 */
export const claudeDetector = new CliDetector('claude')
