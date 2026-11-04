import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HOSTED_CHANNELS } from '../../src/shared/ipc/hosted'
import { registerHostedHandlers } from '../../src/main/ipc/hosted-handlers'

const { handlers, detect, connection, merge } = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => Promise<unknown>>(),
  detect: vi.fn(), connection: vi.fn(), merge: vi.fn(),
}))
vi.mock('electron', () => ({ ipcMain: { handle: (key: string, handler: (...args: unknown[]) => Promise<unknown>) => handlers.set(key, handler) } }))
vi.mock('../../src/main/hosted/github', () => ({ detectProvider: detect, hostedConnection: connection }))
vi.mock('../../src/main/git/worktree-meta', () => ({ worktreeMetaStore: {} }))
vi.mock('../../src/main/hosted/login', () => ({ startHostedLogin: vi.fn(), readHostedLogin: vi.fn(), inputHostedLogin: vi.fn(), stopHostedLogin: vi.fn(), stopHostedLoginsForOwner: vi.fn() }))

beforeEach(() => { vi.clearAllMocks(); handlers.clear(); registerHostedHandlers() })

describe('hosted IPC', () => {
  it('routes merge to the detected GitLab provider', async () => {
    detect.mockResolvedValue({ id: 'gitlab', mergeReview: merge })
    merge.mockResolvedValue({ merged: true })
    expect(await handlers.get(HOSTED_CHANNELS.mergeReview)!(null, { workspacePath: 'repo', number: 7, method: 'squash' }))
      .toEqual({ merged: true })
    expect(detect).toHaveBeenCalledWith('repo')
    expect(merge).toHaveBeenCalledWith('repo', 7, 'squash')
  })

  it('rejects merging an unsupported checkout', async () => {
    detect.mockResolvedValue(null)
    await expect(handlers.get(HOSTED_CHANNELS.mergeReview)!(null, { workspacePath: 'repo', number: 7 })).rejects.toThrow('托管平台')
    expect(merge).not.toHaveBeenCalled()
  })

  it('returns connection guidance without exposing the old credential API', async () => {
    connection.mockResolvedValue({ provider: 'gitlab', status: 'cli-missing' })
    expect(await handlers.get(HOSTED_CHANNELS.connection)!(null, { workspacePath: 'repo' }))
      .toEqual({ provider: 'gitlab', status: 'cli-missing' })
    expect([...handlers.keys()].some(key => key.startsWith('hosted:gitlab-'))).toBe(false)
  })
})
