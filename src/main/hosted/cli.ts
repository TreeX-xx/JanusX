// Note: CLI-owned hosting credentials — see .agents/notes/remote/gitlab-provider-reviews.md
import { execFile } from 'node:child_process'
import type { HostedConnection, HostedProviderId } from '../../shared/ipc/hosted'

type FailureStatus = Exclude<HostedConnection['status'], 'ready'>

export class HostedCliError extends Error {
  constructor(readonly status: FailureStatus, message: string) {
    super(message)
  }
}

/** Credentials and refresh remain owned by gh/glab. Never request or persist a token. */
export function runHostedCli(provider: HostedProviderId, args: string[], input?: string): Promise<string> {
  const cli = provider === 'github' ? 'gh' : 'glab'
  const host = provider === 'github' ? 'github.com' : 'gitlab.com'
  return new Promise((resolve, reject) => {
    const child = execFile(cli, args, {
      timeout: 30000,
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true,
      encoding: 'utf8',
      env: {
        ...process.env,
        GH_HOST: 'github.com',
        GITLAB_HOST: 'gitlab.com',
        GITLAB_API_HOST: 'gitlab.com',
        GLAB_API_PROTOCOL: 'https',
        NO_COLOR: '1',
      },
    }, (error, stdout, stderr) => {
      if (!error) return resolve(stdout)
      if (error.code === 'ENOENT') {
        return reject(new HostedCliError('cli-missing', cli + ' CLI is not installed or is not on PATH.'))
      }
      const detail = stderr.trim() || error.message
      const unauthenticated = /auth login|not logged|not authenticated|no (?:access )?token|invalid token|token (?:in keyring )?(?:is )?invalid|HTTP 401|401 Unauthorized|authentication failed|failed to authenticate/i.test(detail)
      reject(new HostedCliError(unauthenticated ? 'unauthenticated' : 'error',
        unauthenticated ? 'Run ' + cli + ' auth login --hostname ' + host + ' --web, then retry.' : detail))
    })
    // An early CLI exit reports its error through execFile; do not leak an EPIPE rejection.
    child.stdin?.on('error', () => {})
    child.stdin?.end(input)
  })
}

export async function checkHostedConnection(provider: HostedProviderId): Promise<HostedConnection> {
  const host = provider === 'github' ? 'github.com' : 'gitlab.com'
  try {
    // Other saved GitHub accounts may be expired; only the active account serves requests.
    const args = ['auth', 'status', '--hostname', host]
    if (provider === 'github') args.push('--active')
    await runHostedCli(provider, args)
    return { provider, status: 'ready' }
  } catch (error) {
    return {
      provider,
      status: error instanceof HostedCliError ? error.status : 'error',
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
