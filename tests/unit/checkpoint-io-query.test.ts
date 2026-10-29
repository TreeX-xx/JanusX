import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => Promise<any>>(),
  list: vi.fn(), counts: vi.fn(), records: vi.fn(), session: vi.fn(),
}))
vi.mock('electron', () => ({ ipcMain: { handle: (name: string, fn: any) => mocks.handlers.set(name, fn) } }))
vi.mock('@janus-agent/agent-core', () => ({ checkpointManager: {
  listCheckpoints: mocks.list, getChangedFileCounts: mocks.counts, getChangedFileRecords: mocks.records,
} }))
vi.mock('../../src/main/sessions/session-registry', () => ({ agentSessionRegistry: { getSession: mocks.session } }))
import { registerCheckpointHandlers } from '../../src/main/ipc/checkpoint-handlers'

beforeEach(() => { vi.clearAllMocks(); registerCheckpointHandlers() })
describe('checkpoint metadata query', () => {
  it('does not scan files for empty or populated lists; unknown changed count stays unknown', async () => {
    mocks.list.mockResolvedValueOnce([]).mockResolvedValueOnce([{
      id: 'cp', terminalId: 't', engine: 'manual', conversationIndex: 1, createdAt: '2026-10-29',
      branch: 'main', prompt: 'p', filesSnapshot: { 'a.ts': { hash: 'h', size: 1 } }, status: 'ready',
    }])
    const list = mocks.handlers.get('checkpoint:list')!
    expect(await list({}, { cwd: '/project' })).toEqual([])
    expect(await list({}, { cwd: '/project' })).toMatchObject([{ id: 'cp', fileCount: 1, changedFileCount: null }])
    expect(mocks.counts).not.toHaveBeenCalled()
  })
  it('computes details only through an explicit records request', async () => {
    mocks.records.mockResolvedValue([{ path: 'a.ts', status: 'modified' }])
    expect(await mocks.handlers.get('checkpoint:records')!({}, { checkpointId: 'cp', cwd: '/project' }))
      .toEqual([{ path: 'a.ts', status: 'modified' }])
    expect(mocks.records).toHaveBeenCalledWith('cp', '/project')
  })
})
