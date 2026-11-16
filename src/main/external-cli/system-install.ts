// Note: .agents/notes/terminal/macos-cli-sessions.md (system CLI installation)
import { readFile, realpath, stat } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, sep } from 'node:path'
import { CliInstaller, type CliInstallOutcome } from './installer'
import { CliDetector } from './cli-detector'
import { managedCliEnv } from './managed-paths'
import { findCliPackage } from './package-location'
import { dshProfileHint } from './managed-install'
import { OPENCODE_PACKAGES, type ExternalCliToolDescriptor } from './tool-registry'
import { localSystem } from '../platform/runtime-context'
import { environmentWithPath, targetPath } from '../platform/environment'
import { runProcess } from '../platform/process-host'
import { resolveCliExecutable } from '../platform/cli-launch'
import { resolveCommand } from '../platform/command-resolver'
import { cliKnownBinDirs } from './search-paths'
import { sameRuntimePath } from '../../shared/runtime/path-identity'

async function physical(path: string): Promise<string> { return realpath(path).catch(() => path) }
function inside(root: string, file: string): boolean {
  const part = relative(root, file)
  return part === '' || !isAbsolute(part) && part !== '..' && !part.startsWith(`..${sep}`)
}

/** Prove command ownership; an unrelated package near a native binary is not sufficient. */
export async function npmOwnsCommand(command: string, modules: string, packageName: string): Promise<boolean> {
  const root = join(modules, packageName)
  if (inside(await physical(root), await physical(command))) return true
  if (!/\.(cmd|ps1|bat)$/i.test(command)) return false
  const info = await stat(command).catch(() => undefined)
  if (!info || info.size > 64 * 1024) return false
  const text = (await readFile(command, 'utf8')).replaceAll('\\', '/')
  // Windows npm shims are anchored at %dp0% / $basedir, never an arbitrary nearby prefix.
  return sameRuntimePath(dirname(command), dirname(modules))
    && text.includes(`node_modules/${packageName}/`)
    && /%dp0%|\$basedir/.test(text)
}

export function nativeUpdateCommand(tool: string, command: string, physicalPath: string, home: string, platform: NodeJS.Platform, version: string, brew?: string): { file: string; args: string[] } | undefined {
  const path = targetPath(platform)
  const normalized = physicalPath.replaceAll('\\', '/')
  const formula = /\/(?:Cellar|Caskroom)\/([a-zA-Z0-9@+_.-]+)\//.exec(normalized)?.[1]
  if (formula) {
    if (!brew) throw new Error('Homebrew owns this CLI, but brew is not available in the current environment.')
    if (version !== 'latest') throw new Error(`This CLI is managed by Homebrew. Use brew upgrade ${formula}; npm release selection cannot change its install source.`)
    return { file: brew, args: ['upgrade', formula] }
  }
  if (tool === 'claude' && (sameRuntimePath(command, path.join(home, '.local', 'bin', platform === 'win32' ? 'claude.exe' : 'claude'))
    || normalized.startsWith(path.join(home, '.local', 'share', 'claude', 'versions').replaceAll('\\', '/') + '/'))) {
    return { file: command, args: ['update'] }
  }
  if (tool === 'opencode' && sameRuntimePath(command, path.join(home, '.opencode', 'bin', platform === 'win32' ? 'opencode.exe' : 'opencode'))) {
    return { file: command, args: version === 'latest' ? ['upgrade'] : ['upgrade', version] }
  }
  return undefined
}

export function createSystemCliInstaller(): CliInstaller {
  let plan: { prefix: string; modules: string; command: string } | undefined
  const run = async (file: string, args: readonly string[], options: { timeout: number; pathDirs: string[]; cwd?: string }) => {
    const env = environmentWithPath(managedCliEnv(), localSystem().platform, [], options.pathDirs)
    const result = await runProcess(file, args, { env, cwd: options.cwd ?? localSystem().home, timeoutMs: options.timeout })
    return { exitCode: result.status === 'exited' ? result.exitCode ?? 1 : 1, stdout: result.stdout,
      stderr: result.stderr || (result.status !== 'exited' ? `CLI process ${result.status}` : '') }
  }
  const packages = (tool: ExternalCliToolDescriptor) => tool.id === 'opencode' ? Object.values(OPENCODE_PACKAGES) : [tool.npmPackage!]
  const commandProbe = async (tool: ExternalCliToolDescriptor, command: string) => {
    const resolved = resolveCliExecutable(command) ?? command
    const probe = await new CliDetector(tool.id).detect({ path: resolved, source: 'path' })
    if (!probe.runnable || !probe.version) throw new Error(probe.hint ?? `Could not run ${tool.displayName} at ${command}`)
    return { path: probe.path ?? resolved, version: probe.version }
  }
  return new CliInstaller({
    get platform() { return localSystem().platform },
    get env() { return managedCliEnv() },
    get homeDir() { return localSystem().home },
    isRegularFile: async path => (await stat(path)).isFile(), run,
    installPrefix: () => plan?.prefix,
    installExisting: async (tool, version): Promise<CliInstallOutcome | undefined> => {
      plan = undefined
      const active = await new CliDetector(tool.id).findCandidate()
      if (!active) return undefined
      const real = await physical(active.path)
      const host = localSystem()
      const brew = resolveCommand('brew', { platform: host.platform, env: managedCliEnv(), knownDirs: cliKnownBinDirs(managedCliEnv(), host.platform, host.home) }).path ?? undefined
      // Homebrew may itself distribute an npm package; its ownership takes precedence.
      if (!/\/(Cellar|Caskroom)\//.test(real.replaceAll('\\', '/'))) {
        for (const name of packages(tool)) {
          const root = findCliPackage(active.path, name)
          const modules = root?.slice(0, -(name.length + 1))
            ?? (host.platform === 'win32' ? join(dirname(active.path), 'node_modules') : undefined)
          if (modules && await npmOwnsCommand(active.path, modules, name)) return undefined
        }
      }
      const update = nativeUpdateCommand(tool.id, active.path, real, host.home, host.platform, version, brew)
      if (!update) throw new Error(`${tool.displayName} at ${active.path} is not owned by the active npm installation. Update it with its original package manager; no second copy was installed.`)
      const result = await run(update.file, update.args, { timeout: 300_000, pathDirs: [] })
      const display = [update.file, ...update.args].join(' ')
      if (result.exitCode !== 0) return { success: false, command: display, error: (result.stderr || result.stdout).trim() || 'CLI update failed.' }
      const target = await commandProbe(tool, active.path)
      if (version !== 'latest' && target.version !== version) return { success: false, command: display, error: `Requested ${version}, but the original installation reports ${target.version}.` }
      return { success: true, command: display, target }
    },
    prepareInstall: async (tool, located, replace) => {
      plan = undefined
      const inspect = async (args: string[]) => {
        const result = await run(located.path, args, { timeout: 30_000, pathDirs: located.pathDirs })
        const value = result.stdout.trim()
        if (result.exitCode !== 0 || !isAbsolute(value) || /[\r\n]/.test(value)) throw new Error(result.stderr.trim() || 'Could not determine the system npm global installation location.')
        return value
      }
      const prefix = await inspect(['prefix', '-g'])
      const modules = await inspect(['root', '-g'])
      const expectedModules = join(prefix, localSystem().platform === 'win32' ? 'node_modules' : 'lib/node_modules')
      if (!sameRuntimePath(await physical(modules), await physical(expectedModules))) throw new Error('npm prefix and global package root disagree; check the current Node/npm environment.')
      const bin = localSystem().platform === 'win32' ? prefix : join(prefix, 'bin')
      const command = join(bin, tool.binaryNames[0] + (localSystem().platform === 'win32' ? '.cmd' : ''))
      const active = await new CliDetector(tool.id).findCandidate()
      if (active) {
        const names = [tool.npmPackage!, ...(replace?.npmPackage ? [replace.npmPackage] : [])]
        const owned = await Promise.all(names.map(name => npmOwnsCommand(active.path, modules, name)))
        if (!owned.some(Boolean)) throw new Error(`${tool.displayName} resolves to ${active.path}, outside the active npm prefix ${prefix}. Use the Node/npm environment that owns this CLI; no installation was changed.`)
      }
      plan = { prefix, modules, command }
    },
    verifyInstall: async (tool, version, located) => {
      if (!plan || !tool.npmPackage) throw new Error('System install target was not resolved.')
      const metadata = JSON.parse(await readFile(join(plan.modules, tool.npmPackage, 'package.json'), 'utf8')) as { name?: string; version?: string }
      if (metadata.name !== tool.npmPackage || !metadata.version || version !== 'latest' && metadata.version !== version) throw new Error('The system npm package does not match the requested CLI version.')
      const target = await commandProbe(tool, plan.command)
      if (target.version !== metadata.version) throw new Error(`The installed package is ${metadata.version}, but its command reports ${target.version}.`)
      if (tool.id === 'dsh') {
        const companion = '@deepseek-harness-tui/dsh-tui'
        const tui = JSON.parse(await readFile(join(plan.modules, companion, 'package.json'), 'utf8')) as { version?: string }
        if (!tui.version || !/^[\d.]+(?:-[\w.]+)?$/.test(tui.version)) throw new Error('The DSH TUI component is missing.')
        const profile = await run(target.path, ['plugin', '--profile', 'dsh-tui', 'add', `${companion}@${tui.version}`], { timeout: 300_000, pathDirs: located.pathDirs })
        if (profile.exitCode !== 0) throw new Error(profile.stderr || 'DSH profile initialization failed.')
        const hint = await dshProfileHint()
        if (hint) throw new Error(hint)
      }
      return target
    },
  })
}
