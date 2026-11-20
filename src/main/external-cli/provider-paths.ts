// Note: .agents/notes/desktop/platform-runtime-boundaries.md (P4)
// Pi precedence verified against installed @earendil-works/pi-coding-agent 0.85.1.
// Node-only: the existing Linux backend uses this same provider policy.
import { readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { targetPath } from '../platform/environment'

export interface ProviderPathContext {
  platform: NodeJS.Platform
  home: string
  env: NodeJS.ProcessEnv
  cwd?: string
  args?: readonly string[]
}
export type ProviderPathSource = 'default' | 'environment' | 'argument' | 'global-settings' | 'project-settings'
export interface ProviderPaths {
  configHome: string | null
  store: string | null
  source: ProviderPathSource
  /** Pi's custom directory is flat; default sessions use per-cwd subdirectories. */
  customSessionDir?: string
  issues: Array<{ path: string; reason: 'relative-without-cwd' | 'invalid-config' | 'unreadable-config' }>
}
type ReadSettings = (file: string) => Record<string, unknown> | undefined
function readSettings(file: string): Record<string, unknown> | undefined {
  try {
    if (statSync(file).size > 1024 * 1024) throw new Error('Provider settings exceed the read limit')
    const value: unknown = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new SyntaxError('Invalid settings object')
    return value as Record<string, unknown>
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

export function providerPathContext(options: Partial<ProviderPathContext> = {}): ProviderPathContext {
  return { platform: process.platform, home: homedir(), env: process.env, ...options }
}

export function resolveProviderPaths(engine: string, context: ProviderPathContext, read: ReadSettings = readSettings): ProviderPaths {
  const path = targetPath(context.platform)
  const result: ProviderPaths = { configHome: null, store: null, source: 'default', issues: [] }
  const configured = (raw: string): string | null => {
    let value = raw
    if (engine === 'pi' && context.platform === 'win32' && !value.includes('\\')) {
      const drive = /^\/(?:mnt\/|cygdrive\/)?([a-z])(?:\/(.*))?$/i.exec(value)
      if (drive) value = `${drive[1].toUpperCase()}:\\${(drive[2] ?? '').replaceAll('/', '\\')}`
    }
    if (value === '~') value = context.home
    else if (value.startsWith('~/') || context.platform === 'win32' && value.startsWith('~\\')) value = path.join(context.home, value.slice(2))
    if (/^file:\/\//.test(value)) {
      try { value = fileURLToPath(value, { windows: context.platform === 'win32' }) }
      catch { result.issues.push({ path: raw, reason: 'invalid-config' }); return null }
    }
    if (path.isAbsolute(value)) return path.normalize(value)
    if (context.cwd) return path.resolve(context.cwd, value)
    result.issues.push({ path: raw, reason: 'relative-without-cwd' })
    return null
  }
  const settings = (file: string): Record<string, unknown> => {
    try { return read(file) ?? {} }
    catch (error) { result.issues.push({ path: file, reason: error instanceof SyntaxError ? 'invalid-config' : 'unreadable-config' }); return {} }
  }
  const env = context.env
  if (engine === 'claude' || engine === 'codex') {
    const override = (engine === 'claude' ? env.CLAUDE_CONFIG_DIR : env.CODEX_HOME)?.trim()
    result.configHome = configured(override || path.join(context.home, engine === 'claude' ? '.claude' : '.codex'))
    result.source = override ? 'environment' : 'default'
    if (result.configHome) result.store = path.join(result.configHome, engine === 'claude' ? 'projects' : 'sessions')
  } else if (engine === 'dsh') {
    const override = env.DSH_HOME?.trim()
    result.configHome = configured(override || path.join(context.home, '.dsh'))
    result.source = override ? 'environment' : 'default'
    if (result.configHome) result.store = path.join(result.configHome, 'sessions')
  } else if (engine === 'opencode') {
    const base = configured(env.XDG_DATA_HOME?.trim() || path.join(context.home, '.local', 'share'))
    result.configHome = base ? path.join(base, 'opencode') : null
    const db = env.OPENCODE_DB?.trim()
    result.source = db || env.XDG_DATA_HOME ? 'environment' : 'default'
    // A memory-only provider has no discoverable persisted history.
    if (result.configHome && db !== ':memory:') result.store = db ? path.isAbsolute(db) ? path.normalize(db) : path.join(result.configHome, db) : path.join(result.configHome, 'opencode.db')
  } else if (engine === 'pi') {
    result.configHome = configured(env.PI_CODING_AGENT_DIR || path.join(context.home, '.pi', 'agent'))
    const args = context.args ?? []
    let argument: string | undefined
    for (let index = 0; index < args.length; index++) {
      if (args[index] === '--') break
      if (args[index] === '--no-session') return result
      if (args[index] === '--session-dir' && index + 1 < args.length) argument = args[++index]
    }
    let sessionDir = argument || env.PI_CODING_AGENT_SESSION_DIR
    if (argument) result.source = 'argument'
    else if (sessionDir) result.source = 'environment'
    else {
      const global = result.configHome ? settings(path.join(result.configHome, 'settings.json')) : {}
      const project = context.cwd ? settings(path.join(context.cwd, '.pi', 'settings.json')) : {}
      const hasProject = Object.hasOwn(project, 'sessionDir')
      const value = hasProject ? project.sessionDir : global.sessionDir
      if (typeof value === 'string' && value) {
        sessionDir = value
        result.source = hasProject ? 'project-settings' : 'global-settings'
      }
    }
    if (sessionDir) {
      result.store = configured(sessionDir)
      if (result.store) result.customSessionDir = result.store
    } else if (result.configHome) {
      result.store = path.join(result.configHome, 'sessions')
      result.source = env.PI_CODING_AGENT_DIR ? 'environment' : 'default'
    }
  }
  return result
}

/** Resolve startup and discovery from the same effective config, without writing user settings. */
export function providerLaunchPaths(engine: string, context: ProviderPathContext): { paths: ProviderPaths; args: string[]; env: NodeJS.ProcessEnv } {
  const paths = resolveProviderPaths(engine, context)
  const args = [...(context.args ?? [])]
  const env = { ...context.env }
  const key = engine === 'claude' ? 'CLAUDE_CONFIG_DIR' : engine === 'codex' ? 'CODEX_HOME' : engine === 'pi' ? 'PI_CODING_AGENT_DIR' : undefined
  if (key && env[key] && paths.configHome) env[key] = paths.configHome
  if (engine === 'opencode') {
    if (env.XDG_DATA_HOME && paths.configHome) env.XDG_DATA_HOME = targetPath(context.platform).dirname(paths.configHome)
    if (env.OPENCODE_DB && paths.store) env.OPENCODE_DB = paths.store
  }
  if (engine === 'pi' && paths.customSessionDir && paths.source !== 'argument') {
    // Insert before -- so this remains an option even when the prompt follows it.
    const separator = args.indexOf('--')
    args.splice(separator < 0 ? args.length : separator, 0, '--session-dir', paths.customSessionDir)
  }
  return { paths, args, env }
}
