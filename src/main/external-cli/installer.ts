import { app } from 'electron'
import { readFile } from 'node:fs/promises'
import { delimiter, join, resolve } from 'node:path'
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
  resolveSiblingRoot?: () => string | undefined
}

export interface LocalToolSource {
  packageDir: string
  version?: string
}

function npmBinaryNames(platform: NodeJS.Platform): readonly string[] {
  return platform === 'win32' ? ['npm.cmd', 'npm.exe', 'npm'] : ['npm']
}

function lastLines(text: string, count: number): string {
  return text.split(/\r?\n/).map(line => line.trim()).filter(Boolean).slice(-count).join('\n')
}

function defaultSiblingRoot(): string | undefined {
  try {
    return resolve(app.getAppPath(), '..', 'janus-agentX')
  } catch {
    return undefined
  }
}

export class CliInstaller {
  private running = false

  constructor(private readonly deps: CliInstallerDependencies) {}

  isBusy(): boolean {
    return this.running
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

  /**
   * 定位自有 sibling 源码包目录并校验包名；顺带读出源码版本号（最新版比对用）。
   * 打包后或目录缺失时返回 undefined，调用方降级为手动指引。
   */
  async locateLocalSource(tool: ExternalCliToolDescriptor): Promise<LocalToolSource | undefined> {
    const lifecycle = tool.localLifecycle
    if (!lifecycle) return undefined
    const root = this.deps.resolveSiblingRoot?.() ?? defaultSiblingRoot()
    if (!root) return undefined
    try {
      const packageDir = join(root, 'packages', lifecycle.packageDirName)
      const raw = await readFile(join(packageDir, 'package.json'), 'utf8')
      const parsed = JSON.parse(raw) as { name?: unknown; version?: unknown }
      if (parsed.name !== lifecycle.packageName) return undefined
      return { packageDir, version: typeof parsed.version === 'string' ? parsed.version : undefined }
    } catch {
      return undefined
    }
  }

  buildCommand(npmPath: string, tool: ExternalCliToolDescriptor, version = 'latest'): { file: string; args: readonly string[]; display: string } {
    if (!tool.npmPackage) throw new Error(`${tool.displayName} is not npm-distributed.`)
    if (version !== 'latest' && !/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Invalid release version.')
    const target = `${tool.npmPackage}@${version}`
    if (this.deps.platform === 'win32') {
      // 与探测同理走 PowerShell：npm 报错与缺 node 的 cmd 报错都是 GBK，固定 UTF-8 才可读。
      const script = `$OutputEncoding=[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new(); & ${quotePowerShellPath(npmPath)} i -g ${target}; exit $LASTEXITCODE`
      return {
        file: 'powershell.exe',
        args: ['-NoProfile', '-NonInteractive', '-Command', script],
        display: `& "${npmPath}" i -g ${target}`,
      }
    }
    return { file: npmPath, args: ['i', '-g', target], display: `${npmPath} i -g ${target}` }
  }

  /** Codex self-heal half: `uninstall || install` starts by removing the broken bits. */
  buildUninstallCommand(npmPath: string, tool: ExternalCliToolDescriptor): { file: string; args: readonly string[]; display: string } {
    if (!tool.npmPackage) throw new Error(`${tool.displayName} is not npm-distributed.`)
    if (this.deps.platform === 'win32') {
      const script = `$OutputEncoding=[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new(); & ${quotePowerShellPath(npmPath)} rm -g ${tool.npmPackage}; exit $LASTEXITCODE`
      return {
        file: 'powershell.exe',
        args: ['-NoProfile', '-NonInteractive', '-Command', script],
        display: `& "${npmPath}" rm -g ${tool.npmPackage}`,
      }
    }
    return { file: npmPath, args: ['rm', '-g', tool.npmPackage], display: `${npmPath} rm -g ${tool.npmPackage}` }
  }

  /** 自有源码更新：包目录内 build 后全局 link；两步任一步失败即停并透出尾部输出。 */
  private async installLocal(
    npmPath: string,
    pathDirs: string[],
    source: LocalToolSource,
  ): Promise<{ success: boolean; command?: string; error?: string }> {
    const steps: Array<{ display: string; file: string; args: readonly string[] }> = this.deps.platform === 'win32'
      ? (['run build', 'link'] as const).map(args => ({
        display: `npm ${args} (${source.packageDir})`,
        file: 'powershell.exe',
        args: [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `$OutputEncoding=[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new(); & ${quotePowerShellPath(npmPath)} ${args}; exit $LASTEXITCODE`,
        ],
      }))
      : ([
        { display: `npm run build (${source.packageDir})`, args: ['run', 'build'] as const },
        { display: `npm link (${source.packageDir})`, args: ['link'] as const },
      ]).map(step => ({ ...step, file: npmPath }))
    const displays: string[] = []
    for (const step of steps) {
      displays.push(step.display)
      const result = await this.deps.run(step.file, step.args, { timeout: INSTALL_TIMEOUT_MS, pathDirs, cwd: source.packageDir })
      if (result.exitCode !== 0) {
        return {
          success: false,
          command: displays.join(' && '),
          error: lastLines(`${result.stderr}\n${result.stdout}`, 8) || `${step.display} exited with code ${result.exitCode}.`,
        }
      }
    }
    return { success: true, command: displays.join(' && ') }
  }

  async install(tool: ExternalCliToolDescriptor, version = 'latest', replace?: ExternalCliToolDescriptor): Promise<{ success: boolean; command?: string; error?: string }> {
    if (this.running) return { success: false, error: 'Another install is already running.' }
    // 同步置位：检查与置位之间不允许 await，否则两次同步进入的调用会同时通过检查。
    this.running = true
    try {
      const located = await this.locateNpm()
      if (!located) return { success: false, command: tool.manualInstallCommand, error: 'npm was not found. Run the manual command in a terminal.' }
      if (tool.localLifecycle) {
        const source = await this.locateLocalSource(tool)
        if (source) return this.installLocal(located.path, located.pathDirs, source)
        if (!tool.npmPackage) {
          return { success: false, command: tool.manualInstallCommand, error: 'Local janus-agentX source was not found. Follow the manual steps in a terminal.' }
        }
        // 无源码回退到 npm 安装（janus 已发布到 registry）。
      }
      if (!tool.npmPackage) return { success: false, command: tool.manualInstallCommand, error: 'No install strategy for this tool.' }
      const command = this.buildCommand(located.path, tool, version)
      // Only remove a conflicting npm package after reading its actual installed version.
      // The same lock covers inspection, removal, installation and failure recovery.
      let restore: string | undefined
      const displays: string[] = []
      if (replace?.npmPackage) {
        const inspect = this.deps.platform === 'win32'
          ? { file: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-Command', `$OutputEncoding=[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new(); & ${quotePowerShellPath(located.path)} ls -g --depth=0 --json ${replace.npmPackage}; exit $LASTEXITCODE`] }
          : { file: located.path, args: ['ls', '-g', '--depth=0', '--json', replace.npmPackage] }
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
      if (!located) return { success: false, command: tool.manualInstallCommand, error: 'npm was not found. Run the manual command in a terminal.' }
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
