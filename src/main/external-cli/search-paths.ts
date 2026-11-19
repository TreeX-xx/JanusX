import { targetPath } from '../platform/environment'
import type { ExternalCliToolDescriptor } from './tool-registry'

/** 大小写不敏感地读取 PATH（win32 下键名可能是 Path）。 */
export function readPathValue(env: NodeJS.ProcessEnv): string {
  return env.PATH ?? Object.entries(env).find(([key]) => key.toLowerCase() === 'path')?.[1] ?? ''
}

function expandWindowsVars(raw: string, env: NodeJS.ProcessEnv): string {
  return raw.replace(/%([^%]+)%/g, (_, name: string) => {
    const hit = Object.entries(env).find(([key]) => key.toLowerCase() === String(name).toLowerCase())?.[1]
    return hit ?? ''
  })
}

export function cliKnownBinDirs(env: NodeJS.ProcessEnv, platform: NodeJS.Platform, homeDir: string, tool?: ExternalCliToolDescriptor): string[] {
  const { join } = targetPath(platform)
  if (platform === 'win32') {
    const dirs: string[] = [join(homeDir, '.local', 'bin')]
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
    join(homeDir, '.bun', 'bin'),
    join(homeDir, '.cargo', 'bin'),
    '/usr/local/bin',
    ...(platform === 'darwin' ? ['/opt/homebrew/bin'] : []),
    '/usr/bin',
  ]
  return [...new Set(dirs)]
}

