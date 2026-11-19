// Note: CLI-owned hosting credentials — see .agents/notes/remote/gitlab-provider-reviews.md
import { runProcess } from '../platform/process-host'
import type { HostedConnection, HostedProviderId } from '../../shared/ipc/hosted'

type FailureStatus = Exclude<HostedConnection['status'], 'ready'>

export class HostedCliError extends Error {
  constructor(readonly status: FailureStatus, message: string) {
    super(message)
  }
}

/** Credentials and refresh remain owned by gh/glab. Never request or persist a token. */
export async function runHostedCli(provider: HostedProviderId, args: string[], input?: string): Promise<string> {
  const cli = provider === 'github' ? 'gh' : 'glab'
  const host = provider === 'github' ? 'github.com' : 'gitlab.com'
  const result = await runProcess(cli, args, {
    timeoutMs: 30000,
    maxOutputBytes: 8 * 1024 * 1024,
    input,
    env: {
      ...process.env,
      GH_HOST: 'github.com',
      GITLAB_HOST: 'gitlab.com',
      GITLAB_API_HOST: 'gitlab.com',
      GLAB_API_PROTOCOL: 'https',
      NO_COLOR: '1',
    },
  })
  if (result.status === 'exited' && result.exitCode === 0) return result.stdout
  if ((result.error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') {
    throw new HostedCliError('cli-missing', cli + ' CLI is not installed or is not on PATH.')
  }
  const detail = result.stderr.trim() || `CLI ${result.status} (exit ${result.exitCode})`
  const unauthenticated = /auth login|not logged|not authenticated|no (?:access )?token|invalid token|token (?:in keyring )?(?:is )?invalid|HTTP 401|401 Unauthorized|authentication failed|failed to authenticate/i.test(detail)
  throw new HostedCliError(unauthenticated ? 'unauthenticated' : 'error',
    unauthenticated ? 'Run ' + cli + ' auth login --hostname ' + host + ' --web, then retry.' : detail)
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
