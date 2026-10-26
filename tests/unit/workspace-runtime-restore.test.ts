import { beforeEach, describe, expect, it, vi } from 'vitest'

const { state, launch } = vi.hoisted(() => ({
  state: { activeWorkspaceId: 'remote', workspaces: [] as any[], terminals: [] as any[], terminalSnapshots: {} as Record<string, any> },
  launch: vi.fn(async () => ({ ok: true })),
}))
vi.mock('@/stores/workspace', () => ({ useWorkspaceStore: { getState: () => state } }))
vi.mock('@/lib/terminal-launch', () => ({ launchTerminalPreset: launch }))
import { collectShellRestore, restoreShells } from '../../src/renderer/src/lib/shell-restore'

describe('workspace terminal restore', () => {
  beforeEach(() => {
    launch.mockClear()
    state.workspaces = [{ id: 'remote', path: 'janusx-workspace://remote/project', runtime: { kind: 'wsl', distro: 'test', root: '/project' } }]
    state.terminals = []; state.terminalSnapshots = {}
    vi.stubGlobal('window', { electron: {
      session: { getLayout: vi.fn(async () => null), clearLayout: vi.fn(async () => {}) },
      workspaceRuntime: { terminals: vi.fn(async () => [{ id: 'persisted', cwd: '/project', preset: 'codex', exitCode: null }]) },
    } })
  })

  it('reattaches after a crash without a saved layout and never reruns the agent', async () => {
    expect(await restoreShells()).toBe(1)
    expect(launch).toHaveBeenCalledWith(expect.objectContaining({ terminalId: 'persisted', attachOnly: true, preset: 'codex', cwd: 'janusx-workspace://remote/project' }))
  })

  it('keeps identities in the layout and avoids an already attached terminal', async () => {
    state.terminals = [{ id: 'persisted', workspaceId: 'remote', cwd: 'janusx-workspace://remote/project', preset: 'codex', name: 'work' }]
    expect(collectShellRestore().workspaces[0].terminals[0].id).toBe('persisted')
    expect(await restoreShells()).toBe(0)
    expect(launch).not.toHaveBeenCalled()
  })

  it('never falls back to launching a new shell when the target is offline', async () => {
    vi.mocked(window.electron.workspaceRuntime!.terminals).mockRejectedValue(new Error('offline'))
    vi.mocked(window.electron.session.getLayout).mockResolvedValue({ version: 1, savedAt: '', workspaces: [{ workspaceId: 'remote', terminals: [{ id: 'old', cwd: 'janusx-workspace://remote/project', preset: 'codex', name: 'work' }] }] })
    expect(await restoreShells()).toBe(0)
    expect(launch).not.toHaveBeenCalled()
  })
})
