export const GIT_CHANNELS = {
  status: 'git:status', log: 'git:log', stage: 'git:stage', unstage: 'git:unstage',
  commit: 'git:commit', push: 'git:push', pull: 'git:pull', fileBaseline: 'git:file-baseline',
  discard: 'git:discard',
  commitChanges: 'git:commit-changes',
  history: 'git:history',
  diff: 'git:diff',
} as const

export interface GitBranch { name: string; upstream: string | null; ahead: number; behind: number }
export interface GitFileChange {
  path: string
  status: 'M' | 'A' | 'D' | 'R' | '??' | 'UU'
  staged: boolean
  additions: number | null
  deletions: number | null
}
export interface GitCommit { hash: string; shortHash: string; message: string; author: string; date: string }
export interface GitRef { name: string; kind: 'head' | 'local' | 'remote' | 'tag' }
export interface GitHistoryCommit extends GitCommit { parents: string[]; refs: GitRef[]; body?: string }
export type GitHistoryScope = 'current' | 'all'
export interface GitHistoryCursor { offset: number; snapshot: string }
export interface GitHistoryQuery { scope: GitHistoryScope; limit?: number; cursor?: GitHistoryCursor }
export interface GitHistoryPage { commits: GitHistoryCommit[]; cursor: GitHistoryCursor | null; snapshot: string }
export interface GitDiff { content: string; truncated: boolean }
export interface GitCommitChange { path: string; status: 'M' | 'A' | 'D' | 'R'; additions: number | null; deletions: number | null }
export interface GitStatus {
  /** false 表示该工作区不是 Git 仓库（结构化返回，不通过抛错传递）。 */
  isRepo?: boolean
  branch: GitBranch
  changes: GitFileChange[]
  clean: boolean
}
export interface GitFileBaseline { content: string; tracked: boolean; available: boolean }

export interface GitAPI {
  status(cwd: string): Promise<GitStatus>
  log(cwd: string, maxCount?: number): Promise<GitCommit[]>
  history(cwd: string, query: GitHistoryQuery): Promise<GitHistoryPage>
  diff(cwd: string, relativePath: string, staged: boolean): Promise<GitDiff>
  stage(cwd: string, paths: string[]): Promise<GitStatus>
  unstage(cwd: string, paths: string[]): Promise<GitStatus>
  commit(cwd: string, message: string): Promise<GitStatus>
  push(cwd: string): Promise<void>
  pull(cwd: string): Promise<void>
  discard(cwd: string, relativePath: string): Promise<GitStatus>
  commitChanges(cwd: string, hash: string): Promise<GitCommitChange[]>
  fileBaseline(cwd: string, relativePath: string): Promise<GitFileBaseline>
}
