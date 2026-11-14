import { delimiter } from 'node:path'
import type { ExternalCliToolDescriptor } from './tool-registry'
import { claudeKnownBinDirs, findExecutableOnPath, quotePowerShellPath, readPathValue } from './cli-detector'

const INSTALL_TIMEOUT_MS = 5 * 60_000

interface RunResult {
  exitCode: number
  stdout: string
  stderr: string
}

interface CliInstallerDependencies {
  platform: NodeJS.Platform
  env: NodeJS.ProcessEnv
  homeDir: string
  isRegularFile(path: string): Promise<boolean>
  run(file: string, args: readonly string[], options: { timeout: number; pathDirs: string[]; cwd?: string }): Promise<RunResult>
  prepareNpm?: (candidate: { path: string; pathDirs: string[] } | undefined) => Promise<{ path: string; pathDirs: string[] }>
  installPrefix?: () => string | undefined
}

function npmBinaryNames(platform: NodeJS.Platform): readonly string[] {
  return platform === 'win32' ? ['npm.cmd', 'npm.exe', 'npm'] : ['npm']
}

function lastLines(text: string, count: number): string {
  return text.split(/\r?\n/).map(line => line.trim()).filter(Boolean).slice(-count).join('\n')
}

export class CliInstaller {
  private running = false

  constructor(private readonly deps: CliInstallerDependencies) {}

  isBusy(): boolean {
    return this.running
  }

  private prefixArgs(): string[] {
    const prefix = this.deps.installPrefix?.()
    return prefix ? ['--prefix', prefix] : []
  }

  private prefixScript(): string {
    const prefix = this.deps.installPrefix?.()
    return prefix ? ` --prefix ${quotePowerShellPath(prefix)}` : ''
  }

  /** 定位 npm 并给出执行期 PATH 补齐目录；找不到则调用方只能展示手动命令。 */
  async locateNpm(): Promise<{ path: string; pathDirs: string[] } | undefined> {
    const names = npmBinaryNames(this.deps.platform)
    const pathDirs = readPathValue(this.deps.env).split(delimiter).filter(Boolean)
    const isFile = async (candidate: string): Promise<boolean> => {
      try {
        return await this.deps.isRegularFile(candidate)
      } catch {
        return false
      }
    }
    const onPath = await findExecutableOnPath(names, pathDirs, isFile)
    const knownDirs = claudeKnownBinDirs(this.deps.env, this.deps.platform, this.deps.homeDir)
    const npmPath = onPath ?? await findExecutableOnPath(names, knownDirs, isFile)
    if (!npmPath) return undefined
    return { path: npmPath, pathDirs: [...knownDirs, ...pathDirs] }
  }

  buildCommand(npmPath: string, tool: ExternalCliToolDescriptor, version = 'latest'): { file: string; args: readonly string[]; display: string } {
    if (!tool.npmPackage) throw new Error(`${tool.displayName} is not npm-distributed.`)
    if (version !== 'latest' && !/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Invalid release version.')
    const target = `${tool.npmPackage}@${version}`
    if (this.deps.platform === 'win32') {
      // 与探测同理走 PowerShell：npm 报错与缺 node 的 cmd 报错都是 GBK，固定 UTF-8 才可读。
      const script = `$OutputEncoding=[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new(); & ${quotePowerShellPath(npmPath)} i -g ${target}${this.prefixScript()}; exit $LASTEXITCODE`
      return {
        file: 'powershell.exe',
        args: ['-NoProfile', '-NonInteractive', '-Command', script],
        display: `& "${npmPath}" i -g ${target}`,
      }
    }
    return { file: npmPath, args: ['i', '-g', target, ...this.prefixArgs()], display: `${npmPath} i -g ${target}` }
  }

  /** Codex self-heal half: `uninstall || install` starts by removing the broken bits. */
  buildUninstallCommand(npmPath: string, tool: ExternalCliToolDescriptor): { file: string; args: readonly string[]; display: string } {
    if (!tool.npmPackage) throw new Error(`${tool.displayName} is not npm-distributed.`)
    if (this.deps.platform === 'win32') {
      const script = `$OutputEncoding=[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new(); & ${quotePowerShellPath(npmPath)} rm -g ${tool.npmPackage}${this.prefixScript()}; exit $LASTEXITCODE`
      return {
        file: 'powershell.exe',
        args: ['-NoProfile', '-NonInteractive', '-Command', script],
        display: `& "${npmPath}" rm -g ${tool.npmPackage}`,
      }
    }
    return { file: npmPath, args: ['rm', '-g', tool.npmPackage, ...this.prefixArgs()], display: `${npmPath} rm -g ${tool.npmPackage}` }
  }

  async install(tool: ExternalCliToolDescriptor, version = 'latest', replace?: ExternalCliToolDescriptor): Promise<{ success: boolean; command?: string; error?: string }> {
    if (this.running) return { success: false, error: 'Another install is already running.' }
    // 同步置位：检查与置位之间不允许 await，否则两次同步进入的调用会同时通过检查。
    this.running = true
    try {
      const candidate = await this.locateNpm()
      const located = this.deps.prepareNpm ? await this.deps.prepareNpm(candidate) : candidate
      if (!located) return { success: false, command: tool.manualInstallCommand, error: 'npm was not found. Install Node.js LTS (including npm), then retry.' }
      if (!tool.npmPackage) return { success: false, command: tool.manualInstallCommand, error: 'No install strategy for this tool.' }
      const command = this.buildCommand(located.path, tool, version)
      // Only remove a conflicting npm package after reading its actual installed version.
      // The same lock covers inspection, removal, installation and failure recovery.
      let restore: string | undefined
      const displays: string[] = []
      if (replace?.npmPackage) {
        const inspect = this.deps.platform === 'win32'
          ? { file: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-Command', `$OutputEncoding=[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new(); & ${quotePowerShellPath(located.path)} ls -g --depth=0 --json ${replace.npmPackage}${this.prefixScript()}; exit $LASTEXITCODE`] }
          : { file: located.path, args: ['ls', '-g', '--depth=0', '--json', replace.npmPackage, ...this.prefixArgs()] }
        const listed = await this.deps.run(inspect.file, inspect.args, { timeout: INSTALL_TIMEOUT_MS, pathDirs: located.pathDirs })
        try {
          const data = JSON.parse(listed.stdout) as { name?: unknown; error?: unknown; dependencies?: Record<string, { version?: unknown }> }
          // npm ls exits 1 for an empty filtered result, with a valid root object.
          if (!data || data.error || listed.exitCode > 1 || (typeof data.name !== 'string' && !data.dependencies)) {
            return { success: false, error: 'Could not inspect the existing OpenCode npm package; no changes were made.' }
          }
          const installed = data.dependencies?.[replace.npmPackage]?.version
          if (typeof installed === 'string' && /^\d+\.\d+\.\d+$/.test(installed)) restore = installed
          else if (data.dependencies?.[replace.npmPackage]) {
            return { success: false, error: 'Could not inspect the existing OpenCode npm package; no changes were made.' }
          }
        } catch {
          return { success: false, error: 'Could not inspect the existing OpenCode npm package; no changes were made.' }
        }
        if (restore) {
          const remove = this.buildUninstallCommand(located.path, replace)
          displays.push(remove.display)
          const removed = await this.deps.run(remove.file, remove.args, { timeout: INSTALL_TIMEOUT_MS, pathDirs: located.pathDirs })
          if (removed.exitCode !== 0) return { success: false, command: remove.display, error: lastLines(`${removed.stderr}\n${removed.stdout}`, 8) || 'Could not remove the conflicting OpenCode package.' }
        }
      }
      displays.push(command.display)
      const result = await this.deps.run(command.file, command.args, { timeout: INSTALL_TIMEOUT_MS, pathDirs: located.pathDirs })
      if (result.exitCode !== 0) {
        let recovery = ''
        if (restore && replace) {
          // Remove a partially installed target before restoring the old command shims.
          const cleanup = this.buildUninstallCommand(located.path, tool)
          displays.push(cleanup.display)
          await this.deps.run(cleanup.file, cleanup.args, { timeout: INSTALL_TIMEOUT_MS, pathDirs: located.pathDirs })
          const rollback = this.buildCommand(located.path, replace, restore)
          displays.push(rollback.display)
          const restored = await this.deps.run(rollback.file, rollback.args, { timeout: INSTALL_TIMEOUT_MS, pathDirs: located.pathDirs })
          recovery = restored.exitCode === 0 ? '\nPrevious npm package restored; re-detect OpenCode before retrying.' : `\nRestoring the previous npm package failed: ${lastLines(`${restored.stderr}\n${restored.stdout}`, 8)}`
        }
        return {
          success: false,
          command: displays.join(' && '),
          error: (lastLines(`${result.stderr}\n${result.stdout}`, 8) || `Install exited with code ${result.exitCode}.`) + recovery,
        }
      }
      return { success: true, command: displays.join(' && ') }
    } finally {
      this.running = false
    }
  }

  /**
   * Best-effort removal for self-heal flows. The caller decides whether a
   * failed removal blocks the reinstall; a missing npm or non-npm tool is
   * reported the same honest way as {@link install}.
   */
  async uninstall(tool: ExternalCliToolDescriptor): Promise<{ success: boolean; command?: string; error?: string }> {
    if (this.running) return { success: false, error: 'Another install is already running.' }
    this.running = true
    try {
      const located = await this.locateNpm()
      if (!located) return { success: false, command: tool.manualInstallCommand, error: 'npm was not found. Install Node.js LTS (including npm), then retry.' }
      if (!tool.npmPackage) return { success: false, command: tool.manualInstallCommand, error: 'No uninstall strategy for this tool.' }
      const command = this.buildUninstallCommand(located.path, tool)
      const result = await this.deps.run(command.file, command.args, { timeout: INSTALL_TIMEOUT_MS, pathDirs: located.pathDirs })
      if (result.exitCode !== 0) {
        return {
          success: false,
          command: command.display,
          error: lastLines(`${result.stderr}\n${result.stdout}`, 8) || `Uninstall exited with code ${result.exitCode}.`,
        }
      }
      return { success: true, command: command.display }
    } finally {
      this.running = false
    }
  }
}
