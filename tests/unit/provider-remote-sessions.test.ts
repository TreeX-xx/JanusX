import { beforeEach, expect, it, vi } from 'vitest'
import { runtimeResource } from '../../src/shared/workspace-runtime'

const mocks = vi.hoisted(() => ({ request: vi.fn(), import: vi.fn() }))
vi.mock('../../src/main/workspace/runtime', () => ({
  registeredExternalWorkspaces: async () => [{ id: 'remote', name: 'Linux host', runtime: { kind: 'ssh', root: '/repo' } }],
  projectWorkspace: () => ({ path: 'janus-runtime://remote/repo' }),
}))
vi.mock('../../src/main/workspace/remote-harness', () => ({ remoteBackendRequest: mocks.request }))
vi.mock('../../src/main/git/worktrees', () => ({ listWorktrees: async () => [{ path: 'janus-runtime://remote/repo' }] }))
vi.mock('../../src/main/sessions/session-registry', () => ({ agentSessionRegistry: {
  beginBatch() {}, endBatch() {}, importExternalSession: mocks.import,
} }))
import { scanRemoteSessions, readRemoteTranscript } from '../../src/main/workspace/remote-sessions'
beforeEach(() => { vi.clearAllMocks() })
const record = { engine: 'pi', providerSessionId: 'id', cwd: '/repo', transcriptPath: '/history/id.jsonl' }

it.each([false, true])('preserves target identity for old and new backend responses (new=%s)', async modern => {
  mocks.request.mockResolvedValue(modern ? { records: [record], issues: [{ engine: 'codex', reason: 'permission-denied', path: '/history' }] } : [record])
  const result = await scanRemoteSessions()
  expect(result.imported).toBe(1)
  expect(result.errors).toHaveLength(modern ? 1 : 0)
  expect(mocks.import).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 'remote', cwd: runtimeResource('remote', '/repo'), transcriptPath: runtimeResource('remote', '/history/id.jsonl') }))
})
it('reports unreachable backends without importing any local substitute', async () => {
  mocks.request.mockRejectedValue(new Error('connection lost'))
  const result = await scanRemoteSessions()
  expect(result.imported).toBe(0)
  expect(result.errors[0]).toContain('connection lost')
  expect(mocks.import).not.toHaveBeenCalled()
})
it('requests details with both provider identity and original remote path', async () => {
  mocks.request.mockResolvedValue(null)
  await readRemoteTranscript({ ...record, cwd: runtimeResource('remote', '/repo'), transcriptPath: runtimeResource('remote', '/history/id.jsonl') } as Parameters<typeof readRemoteTranscript>[0])
  expect(mocks.request).toHaveBeenCalledWith(runtimeResource('remote', '/repo'), 'session.transcript', ['pi:id', '/history/id.jsonl'])
})
