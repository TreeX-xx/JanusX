import './tool-palette'
import { useWorkspaceStore } from '@/stores/workspace'
import { useWorktreeStore } from '@/stores/worktree'
import { useGitStore } from '@/stores/git'
import { useSessionStore } from '@/stores/session'
import { getActiveScopePath, loadWorkspaceFileTree, switchActiveWorktree } from '@/features/workspace/actions'

type Kind = 'files' | 'status' | 'log' | 'sessions'
const gates = new Map<string, Array<(fail: boolean) => void>>()
function read<T>(kind: Kind, path: string, value: T): Promise<T> {
  const queue = gates.get(`${kind}:${path}`)
  return queue ? new Promise((resolve, reject) => queue.push(fail => fail ? reject(new Error(`${kind} unavailable`)) : resolve(value)))
    : Promise.resolve(value)
}
const name = (path: string) => path.split('/').at(-1)!
window.electron.fileTree.load = path => read('files', path, [
  { name: `${name(path)}.ts`, path: `${name(path)}.ts`, type: 'file' },
  ...Array.from({ length: 35 }, (_, i) => ({ name: `module-${i}.tsx`, path: `module-${i}.tsx`, type: 'file' as const })),
])
window.electron.git.status = path => read('status', path, {
  branch: { name: name(path), ahead: 0, behind: 0 }, clean: false,
  changes: [{ path: `${name(path)}.ts`, status: 'M', staged: false, additions: 3, deletions: 1 }],
})
window.electron.git.log = path => read('log', path, [
  { hash: path, shortHash: 'abc123', message: `${name(path)} history`, author: 'JanusX', date: new Date().toISOString() },
])
window.electron.session.list = filter => {
  const path = filter?.cwd ?? 'all'
  return read('sessions', path, [{ id: path, workspaceId: name(path), engine: 'codex', cwd: path,
    firstPrompt: `${name(path)} session`, turnCount: 2, checkpointCount: 0, status: 'completed',
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), archived: false }])
}
useWorkspaceStore.setState({ workspaces: ['palette', 'other', 'third'].map(id => ({
  id, name: id, path: `C:/${id}`, clis: [], layout: { mode: 'tabs', positions: [] }, createdAt: '', updatedAt: '',
})) })
// Mirror the bootstrap status subscription while leaving initialization and
// native runtime services outside this browser fixture.
useWorkspaceStore.subscribe((state, previous) => {
  if (state.activeWorkspaceId !== previous.activeWorkspaceId) {
    const path = getActiveScopePath()
    if (path) void useGitStore.getState().fetchStatus(path)
  }
})
await loadWorkspaceFileTree('C:/palette')
await useGitStore.getState().fetchStatus('C:/palette')
Object.assign(window, { workspaceTransitionFixture: {
  clearWorkspace: () => useWorkspaceStore.getState().setActiveWorkspace(null),
  hold: (kind: Kind, path: string) => gates.set(`${kind}:${path}`, []),
  release: (kind: Kind, path: string, fail = false) => {
    const key = `${kind}:${path}`
    const queue = gates.get(key) ?? []
    gates.delete(key)
    queue.forEach(resolve => resolve(fail))
  },
  queued: (kind: Kind, path: string) => gates.get(`${kind}:${path}`)?.length ?? 0,
  refreshFiles: () => { const path = getActiveScopePath(); if (path) void loadWorkspaceFileTree(path).catch(() => {}) },
  refreshGit: () => { const path = getActiveScopePath(); if (path) void useGitStore.getState().fetchStatus(path) },
  refreshSessions: () => void useSessionStore.getState().fetchSessions(useSessionStore.getState().lastFilter ?? {}, { silent: true }),
  worktree: () => {
    useWorktreeStore.setState({ worktreesByWorkspace: { other: [] } })
    void switchActiveWorktree('other', 'C:/task')
  },
} })
