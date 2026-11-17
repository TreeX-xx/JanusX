import { readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { runChecked } from '../platform/process-host'
import { managedCliEnv, managedCliPaths } from './managed-paths'
import type { ExternalCliToolDescriptor } from './tool-registry'

export async function dshProfileHint(): Promise<string | undefined> {
  try {
    const root = join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'profiles/dsh-tui/node_modules/@deepseek-harness-tui/dsh-tui')
    const metadata = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as { name?: string }
    if (metadata.name !== '@deepseek-harness-tui/dsh-tui') throw new Error('Wrong DSH profile component')
    await stat(join(root, 'lib/types/index.js'))
    return undefined
  } catch {
    return 'DSH is installed, but the dsh-tui profile is missing or incomplete. Repair the installation in JanusX, or run: dsh plugin --profile dsh-tui add @deepseek-harness-tui/dsh-tui'
  }
}

export async function verifyManagedInstall(tool: ExternalCliToolDescriptor, version: string, paths = managedCliPaths()): Promise<{ path: string; version: string }> {
  const modules = paths.modules
  const metadata = JSON.parse(await readFile(join(modules, tool.npmPackage!, 'package.json'), 'utf8')) as { name?: string; version?: string }
  if (metadata.name !== tool.npmPackage || !metadata.version || (version !== 'latest' && metadata.version !== version)) {
    throw new Error(`Could not verify ${tool.displayName} in the managed install directory.`)
  }
  const path = join(paths.toolsBin, `${tool.binaryNames[0]}${paths.commandExtension}`)
  if (!(await stat(path)).isFile()) throw new Error(`Installed ${tool.displayName} has no command at ${path}.`)
  if (tool.id === 'dsh') {
    // Upstream's supported noninteractive equivalent of the first dsh-tui launch.
    const companion = '@deepseek-harness-tui/dsh-tui'
    const tui = JSON.parse(await readFile(join(modules, companion, 'package.json'), 'utf8')) as { name?: string; version?: string }
    if (tui.name !== companion || !tui.version || !/^[\d.]+(?:-[\w.]+)?$/.test(tui.version)) throw new Error('Could not verify the installed DSH TUI component.')
    const args = ['plugin', '--profile', 'dsh-tui', 'add', `${companion}@${tui.version}`]
    await runChecked(path, args, { env: managedCliEnv(), timeoutMs: 300_000 })
    const profilePackage = join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'profiles/dsh-tui/node_modules', companion, 'package.json')
    const profile = JSON.parse(await readFile(profilePackage, 'utf8')) as { version?: string }
    if (profile.version !== tui.version) throw new Error('DSH profile initialization did not install the expected TUI version. Repair and retry.')
    const hint = await dshProfileHint()
    if (hint) throw new Error(hint)
  }
  return { path, version: metadata.version }
}
