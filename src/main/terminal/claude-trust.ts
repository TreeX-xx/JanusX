import { existsSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { applyEdits, modify } from 'jsonc-parser'

// Native Claude 2.1.318 project consent storage; see
// .agents/notes/workbench/terminal-dialog-dual-mode.md (Claude startup trust).
export function claudeTrustDirectory(cwd: string): string {
  // Windows realpathSync preserves the caller's casing; native restores the
  // on-disk spelling used by Claude's case-sensitive workspace consent lookup.
  return (process.platform === 'win32' ? realpathSync.native(cwd) : realpathSync(cwd)).replaceAll('\\', '/')
}

/** Called only after explicit consent for this exact, resolved directory. */
export function acceptClaudeWorkspaceTrust(directory: string, env: NodeJS.ProcessEnv): void {
  if (claudeTrustDirectory(directory) !== directory) throw new Error('Workspace directory changed; create a new conversation')
  const home = env.USERPROFILE || env.HOME || homedir()
  const file = env.CLAUDE_CONFIG_DIR ? join(env.CLAUDE_CONFIG_DIR, '.claude.json') : join(home, '.claude.json')
  const before = existsSync(file) ? readFileSync(file, 'utf8') : undefined
  let config
  try { config = JSON.parse(before ?? '{}') }
  catch { throw new Error('Invalid Claude configuration JSON; trust was not changed') }
  const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value))
  if (!object(config) || (config.projects !== undefined && !object(config.projects))) throw new Error('Invalid Claude configuration; trust was not changed')
  const projects = (config.projects ?? {}) as Record<string, unknown>
  const sameDirectory = (key: string) => process.platform === 'win32'
    ? key.replaceAll('\\', '/').toLowerCase() === directory.toLowerCase() : key === directory
  const keys = [...new Set([directory, ...Object.keys(projects).filter(sameDirectory)])]
  let next = before ?? '{}'
  for (const key of keys) {
    if (projects[key] !== undefined && !object(projects[key])) throw new Error('Invalid Claude project configuration; trust was not changed')
    next = applyEdits(next, modify(next, ['projects', key, 'hasTrustDialogAccepted'], true, { formattingOptions: { insertSpaces: true, tabSize: 2 } }))
  }
  const temporary = `${file}.${randomUUID()}.tmp`
  try {
    writeFileSync(temporary, next, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    // No await between the fresh read, conflict check and atomic replacement.
    // Native processes are independent writers: refuse detected changes rather
    // than overwrite them. The subsequent --bg is the effective trust readback.
    const current = existsSync(file) ? readFileSync(file, 'utf8') : undefined
    if (current !== before) throw new Error('Claude configuration changed concurrently; retry confirmation')
    renameSync(temporary, file)
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary)
  }
}
