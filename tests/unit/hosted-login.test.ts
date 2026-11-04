import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { startHostedLogin, readHostedLogin, inputHostedLogin, stopHostedLogin, stopHostedLoginsForOwner } from '../../src/main/hosted/login'

const mocks = vi.hoisted(() => ({ resolve: vi.fn(), cli: vi.fn(), create: vi.fn(), write: vi.fn(), kill: vi.fn(), data: undefined as undefined | ((data: string) => void), exit: undefined as undefined | ((event: { exitCode: number }) => void) }))
vi.mock('../../src/main/hosted/repository', () => ({ resolveHostedRepository: mocks.resolve }))
vi.mock('../../src/main/janus-runner/cli-resolver', () => ({ resolveCLIPath: mocks.cli }))
vi.mock('../../src/main/terminal/manager', () => ({ terminalManager: { create: mocks.create, write: mocks.write, kill: mocks.kill } }))
beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers()
  mocks.resolve.mockResolvedValue({ provider: 'github' }); mocks.cli.mockResolvedValue('C:/tools/gh.exe')
  mocks.create.mockImplementation(() => ({ pty: { onData: (callback: typeof mocks.data) => { mocks.data = callback }, onExit: (callback: typeof mocks.exit) => { mocks.exit = callback } } }))
})
afterEach(() => { stopHostedLoginsForOwner(1); stopHostedLoginsForOwner(2); vi.useRealTimers() })

it('starts the official browser flow locally with fixed arguments and no workspace shell command', async () => {
  const session = await startHostedLogin('runtime://ssh/checkout', 1)
  expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
    id: session.id, workspaceId: '__hosted_login__', program: 'C:/tools/gh.exe',
    programArgs: ['auth', 'login', '--hostname', 'github.com', '--web', '--git-protocol', 'https', '--skip-ssh-key'],
  }))
  expect(mocks.create.mock.calls[0][0].cwd).not.toContain('runtime:')
  mocks.data?.('One-time code: ABCD-1234')
  expect(readHostedLogin(session.id, 1).output).toContain('ABCD-1234')
  inputHostedLogin(session.id, '\r', 1)
  expect(mocks.write).toHaveBeenCalledWith(session.id, '\r')
})

it('keeps output private to the window that started login and clears it on close', async () => {
  const session = await startHostedLogin('repo', 1)
  expect(() => readHostedLogin(session.id, 2)).toThrow()
  expect(() => inputHostedLogin(session.id, 'secret', 2)).toThrow()
  stopHostedLogin(session.id, 2)
  expect(mocks.kill).not.toHaveBeenCalled()
  stopHostedLogin(session.id, 1)
  expect(mocks.kill).toHaveBeenCalledWith(session.id)
  expect(() => readHostedLogin(session.id, 1)).toThrow()
})

it('replaces only the owner session and terminates abandoned login after ten minutes', async () => {
  const first = await startHostedLogin('repo', 1)
  const other = await startHostedLogin('repo', 2)
  const next = await startHostedLogin('repo', 1)
  expect(mocks.kill).toHaveBeenCalledWith(first.id)
  expect(readHostedLogin(other.id, 2).finished).toBe(false)
  vi.advanceTimersByTime(10 * 60_000)
  expect(readHostedLogin(next.id, 1)).toMatchObject({ finished: true, output: expect.stringContaining('timed out') })
})

it('records process exit without declaring the account authorized', async () => {
  const session = await startHostedLogin('repo', 1)
  mocks.exit?.({ exitCode: 1 })
  expect(readHostedLogin(session.id, 1)).toMatchObject({ finished: true, exitCode: 1 })
  inputHostedLogin(session.id, '\r', 1)
  expect(mocks.write).not.toHaveBeenCalled()
})

it('does not let a delayed launch replace a newer sign-in session', async () => {
  let resolveOld!: (value: string) => void
  mocks.cli.mockImplementationOnce(() => new Promise<string>(resolve => { resolveOld = resolve }))
  const old = startHostedLogin('repo', 1)
  const rejected = expect(old).rejects.toThrow('superseded')
  await vi.waitFor(() => expect(resolveOld).toBeTypeOf('function'))
  const current = await startHostedLogin('repo', 1)
  resolveOld('C:/tools/gh.exe')
  await rejected
  expect(mocks.create).toHaveBeenCalledTimes(1)
  expect(readHostedLogin(current.id, 1).finished).toBe(false)
  expect(mocks.kill).not.toHaveBeenCalled()
})

it('does not start a process when the platform is unsupported or the CLI is missing', async () => {
  mocks.resolve.mockResolvedValueOnce(null)
  await expect(startHostedLogin('repo', 1)).rejects.toThrow('Only GitHub.com')
  mocks.cli.mockResolvedValueOnce(null)
  await expect(startHostedLogin('repo', 1)).rejects.toThrow('not installed')
  expect(mocks.create).not.toHaveBeenCalled()
})
