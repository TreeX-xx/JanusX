// CLI-owned browser authorization; the UI displays the official prompts and device code.
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import type { HostedLoginSession } from '../../shared/ipc/hosted'
import { terminalManager } from '../terminal/manager'
import { resolveCLIPath } from '../janus-runner/cli-resolver'
import { resolveHostedRepository } from './repository'

interface Session { owner: number; state: HostedLoginSession; timer: ReturnType<typeof setTimeout> }
const sessions = new Map<string, Session>()
const starts = new Map<number, number>()

function sessionFor(id: string, owner: number): Session {
  const session = sessions.get(id)
  if (!session || session.owner !== owner) throw new Error('The sign-in session has ended')
  return session
}

export async function startHostedLogin(workspacePath: string, owner: number): Promise<HostedLoginSession> {
  const generation = (starts.get(owner) ?? 0) + 1
  starts.set(owner, generation)
  const repo = await resolveHostedRepository(workspacePath)
  if (!repo) throw new Error('Only GitHub.com and GitLab.com are supported')
  const command = repo.provider === 'github' ? 'gh' : 'glab'
  const program = await resolveCLIPath(command)
  if (starts.get(owner) !== generation) throw new Error('The sign-in request was superseded')
  if (!program) throw new Error(command + ' is not installed or is not on PATH')
  // A single visible authorization flow per window; no workspace sessions or history are created.
  for (const [id, session] of sessions) if (session.owner === owner) stopHostedLogin(id, owner)
  const id = 'hosted-login-' + randomUUID()
  const state: HostedLoginSession = { id, provider: repo.provider, output: '', finished: false }
  const terminal = terminalManager.create({
    id, workspaceId: '__hosted_login__', cwd: homedir(),
    shell: process.platform === 'win32' ? 'powershell.exe' : 'bash', program,
    programArgs: ['auth', 'login', '--hostname', repo.provider === 'github' ? 'github.com' : 'gitlab.com', '--web',
      ...(repo.provider === 'github' ? ['--git-protocol', 'https', '--skip-ssh-key'] : [])],
    env: { GH_HOST: 'github.com', GITLAB_HOST: 'gitlab.com', GITLAB_API_HOST: 'gitlab.com', GLAB_API_PROTOCOL: 'https' },
    cols: 76, rows: 16,
  })
  terminal.pty.onData(data => { state.output = (state.output + data).slice(-48000) })
  terminal.pty.onExit(({ exitCode }) => {
    state.finished = true; state.exitCode = exitCode
    const session = sessions.get(id)
    if (session) clearTimeout(session.timer)
  })
  const timer = setTimeout(() => {
    state.finished = true
    state.output += '\r\nSign-in timed out. Close this window and try again.\r\n'
    terminalManager.kill(id)
  }, 10 * 60_000)
  timer.unref?.()
  sessions.set(id, { owner, state, timer })
  return { ...state }
}

export function readHostedLogin(id: string, owner: number): HostedLoginSession {
  return { ...sessionFor(id, owner).state }
}
export function inputHostedLogin(id: string, data: string, owner: number): void {
  const session = sessionFor(id, owner)
  if (session.state.finished) return
  if (typeof data !== 'string' || data.length > 4096) throw new Error('Invalid sign-in input')
  terminalManager.write(id, data)
}
export function stopHostedLogin(id: string, owner: number): void {
  const session = sessions.get(id)
  if (!session || session.owner !== owner) return
  clearTimeout(session.timer)
  terminalManager.kill(id)
  sessions.delete(id)
}
export function stopHostedLoginsForOwner(owner: number): void {
  starts.set(owner, (starts.get(owner) ?? 0) + 1)
  for (const [id, session] of sessions) if (session.owner === owner) stopHostedLogin(id, owner)
}
