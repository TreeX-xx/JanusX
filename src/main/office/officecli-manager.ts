// Note: OfficeCLI is a bundled asset, not a managed download — see .agents/notes/desktop/officecli-bundled.md
import { stat } from 'node:fs/promises'
import { dirname, isAbsolute, resolve } from 'node:path'
import { runProcess } from '../platform/process-host'
import { localSystem } from '../platform/runtime-context'
import type { OfficecliInfo } from '../../shared/office'
import { OFFICECLI_BUNDLED_VERSION } from './office-bundled-path'

const SUPPORTED_VERSION = OFFICECLI_BUNDLED_VERSION
const PROBE_TIMEOUT_MS = 5_000
const REQUIRED_CAPABILITIES = ['watch', 'create', 'batch'] as const

interface CommandResult {
  exitCode: number
  stdout: string
  stderr: string
  timedOut?: boolean
}

interface OfficecliManagerDependencies {
  env: NodeJS.ProcessEnv
  platform: NodeJS.Platform
  bundledBinaryPath?: string
  isRegularFile(path: string): Promise<boolean>
  run(binary: string, args: readonly string[], signal?: AbortSignal): Promise<CommandResult>
}

interface ResolvedBinary {
  path: string
  source: 'bundled'
}

function parseVersion(output: string): string | undefined {
  return output.match(/\b(\d+\.\d+\.\d+)\b/)?.[1]
}

function boundedRuntimeDiagnostic(result: CommandResult): string {
  const detail = `${result.stderr}\n${result.stdout}`.toLowerCase()
  if (result.timedOut) return 'Bundled OfficeCLI timed out during its startup check. Reinstall JanusX and retry.'
  if (detail.includes('icu') || detail.includes('globalization')) {
    return 'Bundled OfficeCLI could not load ICU/globalization support. Install the required system runtime and retry.'
  }
  if (detail.includes('.net') || detail.includes('hostfxr') || detail.includes('framework')) {
    return 'Bundled OfficeCLI could not load its required .NET runtime. Install the supported .NET runtime and retry.'
  }
  return `Bundled OfficeCLI could not start (exit code ${result.exitCode}). Reinstall JanusX version with ${SUPPORTED_VERSION} and retry.`
}

async function defaultRun(binary: string, args: readonly string[], signal?: AbortSignal): Promise<CommandResult> {
  try {
    const result = await runProcess(binary, args, {
      timeoutMs: PROBE_TIMEOUT_MS,
      signal,
    })
    return { exitCode: result.status === 'exited' ? result.exitCode ?? 1 : 1, stdout: result.stdout, stderr: result.stderr, timedOut: result.status === 'timed-out' }
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

const defaultDependencies: OfficecliManagerDependencies = {
  env: process.env,
  platform: localSystem().platform,
  bundledBinaryPath: undefined,
  isRegularFile: async path => (await stat(path)).isFile(),
  run: defaultRun,
}

export class OfficecliManager {
  private verifiedBinary?: ResolvedBinary
  private bundledBinaryPath?: string

  constructor(private readonly deps: OfficecliManagerDependencies = defaultDependencies) {
    this.bundledBinaryPath = deps.bundledBinaryPath
  }

  configureBundledBinaryPath(path: string | undefined): void {
    this.bundledBinaryPath = path
    this.verifiedBinary = undefined
  }

  async resolveBinary(): Promise<ResolvedBinary | undefined> {
    if (!this.verifiedBinary) await this.detect()
    return this.verifiedBinary
  }

  /** Startup verifies the bundle before opening the window; terminal creation only reads it. */
  getVerifiedBinary(): ResolvedBinary | undefined {
    return this.verifiedBinary
  }

  private async findCandidate(): Promise<ResolvedBinary | undefined> {
    const override = this.deps.env.JANUSX_OFFICECLI_BINARY
    if (override && await this.isRegularAbsoluteFile(override)) {
      return { path: resolve(override), source: 'bundled' }
    }
    if (this.bundledBinaryPath && await this.isRegularAbsoluteFile(this.bundledBinaryPath)) {
      return { path: resolve(this.bundledBinaryPath), source: 'bundled' }
    }
    return undefined
  }

  async verifyCapabilities(binary: string, signal?: AbortSignal): Promise<boolean> {
    if (!(await this.isRegularAbsoluteFile(binary))) return false
    for (const capability of REQUIRED_CAPABILITIES) {
      signal?.throwIfAborted()
      const result = await this.deps.run(binary, [capability, '--help'], signal)
      if (result.exitCode !== 0) return false
    }
    return true
  }

  async verifyBundledBinary(binary: string, signal?: AbortSignal): Promise<boolean> {
    if (!(await this.isRegularAbsoluteFile(binary))) return false
    signal?.throwIfAborted()
    const result = await this.deps.run(binary, ['--version'], signal)
    return result.exitCode === 0 && parseVersion(`${result.stdout}\n${result.stderr}`) === SUPPORTED_VERSION &&
      this.verifyCapabilities(binary, signal)
  }

  async detect(): Promise<OfficecliInfo> {
    this.verifiedBinary = undefined
    const resolvedBinary = await this.findCandidate()
    if (!resolvedBinary) return { installed: false, compatible: false }

    const versionResult = await this.deps.run(resolvedBinary.path, ['--version'])
    if (versionResult.exitCode !== 0) {
      return {
        installed: true,
        compatible: false,
        source: resolvedBinary.source,
        runtimeError: boundedRuntimeDiagnostic(versionResult),
      }
    }

    const version = parseVersion(`${versionResult.stdout}\n${versionResult.stderr}`)
    if (version !== SUPPORTED_VERSION || !(await this.verifyCapabilities(resolvedBinary.path))) {
      return { installed: true, compatible: false, version, source: resolvedBinary.source }
    }

    this.verifiedBinary = resolvedBinary
    return {
      installed: true,
      compatible: true,
      version,
      path: resolvedBinary.path,
      source: resolvedBinary.source,
    }
  }

  resolveAgentPathDir(): string | undefined {
    return this.verifiedBinary ? dirname(this.verifiedBinary.path) : undefined
  }

  async refreshAgentPathDir(): Promise<string | undefined> {
    try {
      await this.detect()
      return this.resolveAgentPathDir()
    } catch {
      this.verifiedBinary = undefined
      return undefined
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

export const officecliManager = new OfficecliManager()

export async function initializeOfficecliProvider(
  manager: Pick<OfficecliManager, 'detect'> = officecliManager,
): Promise<void> {
  await manager.detect()
}
