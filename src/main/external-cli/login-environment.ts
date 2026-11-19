import { homedir } from 'node:os'
import { managedCliEnv, setMacNpmPrefix } from './managed-paths'
import { resolveCommand } from '../platform/command-resolver'
import { runChecked } from '../platform/process-host'
import { defaultShell } from '../platform/environment'

const MARKER = 'JANUSX_LOGIN_ENV_START'

/** Ignore shell startup output; values may contain newlines, so use NUL records. */
export function mergeLoginEnvironment(current: NodeJS.ProcessEnv, output: string): NodeJS.ProcessEnv {
  const start = output.indexOf(`\0${MARKER}\0`)
  if (start < 0) throw new Error('Login shell did not return its environment')
  const login: NodeJS.ProcessEnv = {}
  for (const record of output.slice(start + MARKER.length + 2).split('\0')) {
    const separator = record.indexOf('=')
    if (separator < 1) continue
    const key = record.slice(0, separator)
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) && !['_', 'SHLVL', 'PWD', 'OLDPWD'].includes(key)) login[key] = record.slice(separator + 1)
  }
  if (!login.PATH) throw new Error('Login shell returned no PATH')
  // Explicit app-launch overrides win; PATH also needs shell-manager shims (nvm, fnm, asdf).
  return { ...login, ...current, PATH: [...new Set([...login.PATH.split(':'), ...(current.PATH ?? '').split(':')].filter(Boolean))].join(':') }
}

/** Finder does not inherit the interactive shell environment. Never changes the OS environment. */
export async function restoreMacLoginEnvironment(): Promise<void> {
  if (process.platform !== 'darwin') return
  const shell = defaultShell(process.platform, process.env)
  try {
    const result = await runChecked(shell, ['-ilc', `printf '\\0${MARKER}\\0'; /usr/bin/env -0`], {
      env: process.env, timeoutMs: 5000, maxOutputBytes: 1024 * 1024,
    })
    Object.assign(process.env, mergeLoginEnvironment(process.env, result.stdout))
  } catch {
    // Retain the launch environment and known-directory fallback; never log credentials.
    console.warn('[cli] Could not read the login shell environment; using launch environment and known CLI directories.')
  }
  const env = managedCliEnv()
  const npm = resolveCommand('npm', { platform: 'darwin', env }).path
  if (npm) {
    try {
      const result = await runChecked(npm, ['prefix', '-g'], { env, cwd: homedir(), timeoutMs: 5000, maxOutputBytes: 8192 })
      setMacNpmPrefix(result.stdout.trim())
    } catch {
      // npm is optional. A later successful install refreshes its prefix.
    }
  }
}
