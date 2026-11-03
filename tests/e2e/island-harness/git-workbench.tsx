import './tool-palette'
import { useGitStore } from '@/stores/git'
import { useRightToolStore } from '@/stores/right-tools'
import type { GitFileChange, GitHistoryCommit } from '../../../src/shared/ipc/git'

const hash = (i: number) => i.toString(16).padStart(40, 'a')
const commits: GitHistoryCommit[] = Array.from({ length: 85 }, (_, i) => ({
  hash: hash(i), shortHash: `ab${String(i).padStart(5, '0')}`,
  message: ['Merge feature/git-workbench', 'feat(git): keep changes and history independent', 'feat(graph): show branches and merges', 'fix(workspace): preserve draft on switch', 'refactor: share theme controls'][i % 5] + ` · ${i}`,
  author: i % 3 === 0 ? 'Tree' : 'JanusX', date: new Date(Date.UTC(2026, 10, 3, 8, 0) - i * 3600000).toISOString(),
  parents: i === 84 ? [] : i % 15 === 0 && i < 82 ? [hash(i + 1), hash(i + 2)] : [hash(Math.min(84, i % 15 === 1 ? i + 2 : i + 1))],
  refs: i === 0 ? [{ name: 'HEAD', kind: 'head' }, { name: 'main', kind: 'local' }, { name: 'origin/main', kind: 'remote' }] : i === 2 ? [{ name: 'feature/git-workbench', kind: 'local' }] : i === 9 ? [{ name: 'v0.9.7', kind: 'tag' }] : [],
}))
const files = new Map<string, GitFileChange[]>()
const getFiles = (cwd: string) => {
  if (!files.has(cwd)) files.set(cwd, Array.from({ length: 500 }, (_, i) => ({
    path: `src/${i < 250 ? 'components' : 'stores'}/file-${String(i).padStart(3, '0')}.tsx`,
    status: i % 10 === 4 ? '??' : i % 10 === 6 ? 'D' : 'M', staged: i < 3, additions: i + 2, deletions: i % 7,
  })))
  return files.get(cwd)!
}
const operations: Array<{ action: string; cwd: string; value?: unknown }> = []
let failCommit = false
let failDetail = false
Object.assign(window.electron.git, {
  status: async (cwd: string) => ({ isRepo: true, branch: { name: cwd.endsWith('other') ? 'feature/other' : 'main', upstream: 'origin/main', ahead: 3, behind: 2 }, clean: !getFiles(cwd).length, changes: getFiles(cwd) }),
  history: async (cwd, query) => {
    operations.push({ action: 'history', cwd, value: query })
    const offset = query.cursor?.offset ?? 0
    const items = query.scope === 'current' ? commits.slice(0, 12) : commits
    const next = offset + (query.limit ?? 60)
    return { commits: items.slice(offset, next), cursor: next < items.length ? { offset: next, snapshot: `${cwd}:${query.scope}` } : null, snapshot: `${cwd}:${query.scope}` }
  },
  stage: async (cwd, paths) => {
    operations.push({ action: 'stage', cwd, value: paths })
    files.set(cwd, getFiles(cwd).map(file => paths.includes(file.path) ? { ...file, staged: true } : file))
    return window.electron.git.status(cwd)
  },
  unstage: async (cwd, paths) => {
    operations.push({ action: 'unstage', cwd, value: paths })
    files.set(cwd, getFiles(cwd).map(file => paths.includes(file.path) ? { ...file, staged: false } : file))
    return window.electron.git.status(cwd)
  },
  commit: async (cwd, message) => {
    operations.push({ action: 'commit', cwd, value: message })
    if (failCommit) throw new Error('Commit hook rejected')
    files.set(cwd, getFiles(cwd).filter(file => !file.staged))
    return window.electron.git.status(cwd)
  },
  discard: async (cwd, path) => {
    operations.push({ action: 'discard', cwd, value: path })
    files.set(cwd, getFiles(cwd).filter(file => file.path !== path))
    return window.electron.git.status(cwd)
  },
  diff: async (cwd, path, staged) => {
    operations.push({ action: 'diff', cwd, value: { path, staged } })
    return { content: `diff --git a/${path} b/${path}\n@@ -1,2 +1,3 @@\n-export const view = 'stacked'\n+export const view = 'tabs'\n+// ${staged ? 'staged' : 'working'} changes\n keepContext()`, truncated: false }
  },
  commitChanges: async () => {
    if (failDetail) throw new Error('Commit detail unavailable')
    return [{ path: 'src/components/GitPanel.tsx', status: 'M', additions: 42, deletions: 18 }, { path: 'src/stores/git.ts', status: 'M', additions: 14, deletions: 6 }]
  },
  push: async cwd => { operations.push({ action: 'push', cwd }) },
  pull: async cwd => { operations.push({ action: 'pull', cwd }) },
})
Object.assign(window, { gitWorkbenchFixture: {
  operations: () => operations,
  failCommit: (value: boolean) => { failCommit = value },
  failDetail: (value: boolean) => { failDetail = value },
  selectWorkspace: (id: string) => (window as any).builtinExtensionFixture.selectProject(id),
} })
await useGitStore.getState().fetchStatus('C:/palette')
useRightToolStore.getState().activateTool('git')
