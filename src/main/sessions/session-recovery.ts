// Note: provider identity and store preflight for native session recovery — see
// .agents/notes/sessions/records/session-resume-detail.md
import { access, readdir, stat } from 'node:fs/promises'
import { constants } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { isNativeResumeEngine } from '../../shared/ipc/session'
import { resolveSessionStorePath } from '../notifications/agent-engine-capabilities'
import { probeOpencodeSessionPresence } from './opencode-sessions'
import { sameRuntimePath } from '../../shared/runtime/path-identity'

export interface SessionRecoverySource {
  engine: string
  cwd: string
  providerSessionId?: string
  transcriptPath?: string
}

export interface SessionRecoveryEnvironment {
  claudeConfigDir?: string
  codexHome?: string
}

export interface PreparedSessionRecovery {
  transcriptPath: string
  environment: SessionRecoveryEnvironment
}

function matchesSessionFile(path: string, engine: string, id: string): boolean {
  const name = basename(path)
  return engine === 'claude' ? name === `${id}.jsonl` : name.endsWith(`-${id}.jsonl`)
}

/** Exact identity only: a newer file in the same cwd cannot prove a conversation. */
async function findSessionFile(root: string, engine: string, id: string): Promise<string | undefined> {
  const pending = [root]
  let visited = 0
  while (pending.length > 0 && visited < 10_000) {
    const directory = pending.pop()!
    let entries
    try {
      entries = await readdir(directory, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (++visited > 10_000) return undefined
      const path = join(directory, entry.name)
      if (entry.isDirectory()) pending.push(path)
      else if (entry.isFile() && matchesSessionFile(path, engine, id)) return path
    }
  }
  return undefined
}

function providerHome(path: string, storeDirectory: string): string | undefined {
  let directory = dirname(resolve(path))
  while (true) {
    if (basename(directory) === storeDirectory
      || (storeDirectory === 'sessions' && basename(directory) === 'archived_sessions')) return dirname(directory)
    const parent = dirname(directory)
    if (parent === directory) return undefined
    directory = parent
  }
}

/** Refuse unavailable history before creating a ledger row or a PTY. */
export async function prepareSessionRecovery(
  source: SessionRecoverySource,
  options: { env?: NodeJS.ProcessEnv; home?: string } = {},
): Promise<PreparedSessionRecovery> {
  const id = source.providerSessionId?.trim()
  if (!isNativeResumeEngine(source.engine) || !id) throw new Error('Session has no native history identity to restore')
  const cwd = await stat(source.cwd).catch(() => null)
  if (!cwd?.isDirectory()) throw new Error(`Session working directory is unavailable: ${source.cwd}`)

  const store = resolveSessionStorePath(
    source.engine as 'claude' | 'codex' | 'opencode', options.env ?? process.env, options.home ?? homedir(), source.cwd,
  )
  if (!store) throw new Error('The active provider configuration has no persistent session store')
  const path = source.transcriptPath?.trim() || (source.engine === 'opencode'
    ? store : await findSessionFile(store, source.engine, id)
      ?? (source.engine === 'codex' ? await findSessionFile(join(dirname(store), 'archived_sessions'), source.engine, id) : undefined))
  if (!path) throw new Error(`Original ${source.engine} session history was not found: ${id}`)
  const file = await stat(path).catch(() => null)
  if (!file?.isFile() || file.size === 0) throw new Error(`Original session history is unavailable: ${path}`)

  if (source.engine === 'opencode') {
    // Opencode has no CLI store selector. An exported or foreign database
    // must not be mistaken for the database its resumed TUI actually uses.
    if (!sameRuntimePath(resolve(path), resolve(store))) throw new Error('Opencode session history is outside the active session store')
    const presence = probeOpencodeSessionPresence(path, id)
    if (presence !== 'present') throw new Error(presence === 'absent'
      ? `Opencode session ${id} is no longer in the session store`
      : 'Opencode session history could not be verified; retry when the session store is readable')
    return { transcriptPath: path, environment: {} }
  }

  if (!matchesSessionFile(path, source.engine, id)) throw new Error('Session history does not match the recorded provider identity')
  await access(path, constants.R_OK).catch(() => { throw new Error(`Original session history is unreadable: ${path}`) })
  const home = providerHome(path, source.engine === 'claude' ? 'projects' : 'sessions')
  if (!home) throw new Error('Session history is outside a native provider session store')
  return {
    transcriptPath: path,
    environment: source.engine === 'claude' ? { claudeConfigDir: home } : { codexHome: home },
  }
}
