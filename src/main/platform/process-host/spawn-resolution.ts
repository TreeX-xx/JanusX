import { existsSync, readFileSync } from 'node:fs'
import { win32 } from 'node:path'
import { envValue } from '../environment'
import { resolveCommand } from '../command-resolver'

export interface SpawnResolution { program: string; args: string[]; batch: boolean }

/** Only bypass the standard npm Node shim, never arbitrary user batch setup. */
export function resolveProcessSpawn(program: string, args: readonly string[], env: NodeJS.ProcessEnv, platform: NodeJS.Platform, cwd?: string): SpawnResolution {
  if (platform === 'win32') {
    if (!win32.isAbsolute(program) && /[\\/]/.test(program)) program = win32.resolve(cwd ?? process.cwd(), program)
    else if (!win32.isAbsolute(program)) program = resolveCommand(program, { platform, env }).path ?? program
  }
  if (platform !== 'win32' || !/\.(cmd|bat)$/i.test(program)) return { program, args: [...args], batch: false }
  let body: string
  try { body = readFileSync(program, 'utf8') } catch { return { program, args: [...args], batch: true } }
  // npm's generated shim has a single _prog invocation and no custom setup.
  const standard = /^@ECHO off\r?\nGOTO start\r?\n:find_dp0\r?\nSET dp0=%~dp0\r?\nEXIT \/b\r?\n:start\r?\nSETLOCAL\r?\nCALL :find_dp0\r?\n\r?\nIF EXIST "%dp0%\\node.exe" \(\r?\n {2}SET "_prog=%dp0%\\node.exe"\r?\n\) ELSE \(\r?\n {2}SET "_prog=node"\r?\n {2}SET PATHEXT=%PATHEXT:;.JS;=;%\r?\n\)\r?\n\r?\nendLocal & goto #_undefined_# 2>NUL \|\| title %COMSPEC% & "%_prog%"\s+"%dp0%\\([^"\r\n]+)" %\*\s*$/i.exec(body)
  if (!standard) return { program, args: [...args], batch: true }
  const directory = win32.dirname(program)
  const script = win32.resolve(directory, standard[1])
  if (!existsSync(script)) return { program, args: [...args], batch: true }
  const localNode = win32.join(directory, 'node.exe')
  const node = [localNode, ...(envValue(env, 'PATH', platform) ?? '').split(';').filter(Boolean).map(dir => win32.join(dir, 'node.exe'))].find(file => existsSync(file))
  if (!node) return { program, args: [...args], batch: true }
  return { program: node, args: [script, ...args], batch: false }
}
