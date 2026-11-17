import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { checkHostedConnection, runHostedCli } from '../../src/main/hosted/cli'

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }))
vi.mock('../../src/main/platform/process-host', () => ({ runProcess: execute }))

function respond(error: Error | null = null, stderr = '', stdout = '{}') {
  execute.mockResolvedValue({ status: error && 'code' in error ? 'spawn-error' : 'exited', exitCode: error ? 1 : 0, stdout, stderr, error })
}

beforeEach(() => { vi.clearAllMocks(); respond() })
afterEach(() => vi.unstubAllEnvs())

describe('hosted CLI credentials', () => {
  it.each([['github', 'gh', 'github.com'], ['gitlab', 'glab', 'gitlab.com']] as const)(
    'checks %s with the installed CLI and explicit public host', async (provider, cli, host) => {
      expect(await checkHostedConnection(provider)).toEqual({ provider, status: 'ready' })
      const args = ['auth', 'status', '--hostname', host, ...(provider === 'github' ? ['--active'] : [])]
      expect(execute).toHaveBeenCalledWith(cli, args, expect.objectContaining({
        timeoutMs: 30000,
      }))
    },
  )

  it('allows a valid active GitHub account when an inactive account has invalid credentials', async () => {
    const active = 'Logged in to github.com account TreeX-xx (keyring)\nActive account: true'
    const inactive = 'Failed to log in to github.com account TreeX-X (keyring)\nActive account: false\nThe token in keyring is invalid.'
    execute.mockImplementation(async (_cli, args) => ({ status: 'exited', exitCode: args.includes('--active') ? 0 : 1,
      stdout: '', stderr: args.includes('--active') ? active : active + '\n' + inactive }))
    expect(await checkHostedConnection('github')).toEqual({ provider: 'github', status: 'ready' })
  })

  it.each(['The token in keyring is invalid.', 'The token is invalid.', 'invalid token'])(
    'requires login when active credentials fail: %s', async detail => {
      respond(new Error('exit 1'), detail)
      expect(await checkHostedConnection('github')).toEqual({
        provider: 'github', status: 'unauthenticated',
        error: 'Run gh auth login --hostname github.com --web, then retry.',
      })
    },
  )

  it('keeps JSON input literal and pins host selection despite inherited self-hosted defaults', async () => {
    vi.stubEnv('GITLAB_HOST', 'git.company.com')
    vi.stubEnv('GITLAB_API_HOST', 'api.company.com')
    vi.stubEnv('GLAB_API_PROTOCOL', 'http')
    const body = JSON.stringify({ body: 'first\n$(shell)\n@file' })
    await runHostedCli('gitlab', ['api', 'projects/team%2Fapp/notes', '--input', '-'], body)
    expect(execute.mock.calls[0][2].input).toBe(body)
    const options = execute.mock.calls[0][2]
    expect(options.env).toMatchObject({ GITLAB_HOST: 'gitlab.com', GITLAB_API_HOST: 'gitlab.com', GLAB_API_PROTOCOL: 'https' })
    expect(options).not.toHaveProperty('shell')
    expect(options).not.toHaveProperty('cwd')
    expect(execute.mock.calls[0][1]).not.toContain(body)
  })

  it('distinguishes a missing CLI from missing authorization', async () => {
    respond(Object.assign(new Error('spawn failed'), { code: 'ENOENT' }))
    expect(await checkHostedConnection('gitlab')).toMatchObject({ status: 'cli-missing' })
    respond(new Error('exit 1'), 'You are not logged into any GitLab hosts. Run glab auth login.')
    expect(await checkHostedConnection('gitlab')).toMatchObject({ status: 'unauthenticated', error: expect.stringContaining('glab auth login --hostname gitlab.com --web') })
  })

  it('keeps network and permissions failures separate from a login requirement', async () => {
    respond(new Error('exit 1'), 'dial tcp: connection timed out')
    expect(await checkHostedConnection('github')).toMatchObject({ status: 'error' })
    respond(new Error('exit 1'), 'HTTP 403: insufficient permissions')
    await expect(runHostedCli('gitlab', ['api', 'user'])).rejects.toMatchObject({ status: 'error', message: expect.stringContaining('403') })
  })

  it('discards auth output and immediately rechecks after login', async () => {
    respond(new Error('exit 1'), 'Run gh auth login')
    expect(await checkHostedConnection('github')).toMatchObject({ status: 'unauthenticated' })
    respond(null, '', 'Account information from CLI')
    expect(await checkHostedConnection('github')).toEqual({ provider: 'github', status: 'ready' })
    expect(execute).toHaveBeenCalledTimes(2)
  })
})
