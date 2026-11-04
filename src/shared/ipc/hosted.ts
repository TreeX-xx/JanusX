export const HOSTED_CHANNELS = {
  detect: 'hosted:detect',
  connection: 'hosted:connection',
  repository: 'hosted:repository',
  overview: 'hosted:overview',
  image: 'hosted:image',
  browse: 'hosted:browse',
  detail: 'hosted:detail',
  discussion: 'hosted:discussion',
  mutate: 'hosted:mutate',
  loginStart: 'hosted:login-start',
  loginRead: 'hosted:login-read',
  loginInput: 'hosted:login-input',
  loginStop: 'hosted:login-stop',
  listReviews: 'hosted:list-reviews',
  checks: 'hosted:checks',
  failedLogs: 'hosted:failed-logs',
  createReview: 'hosted:create-review',
  mergeReview: 'hosted:merge-review',
  listIssues: 'hosted:list-issues',
  listComments: 'hosted:list-comments',
  postComment: 'hosted:post-comment',
  setAutoMerge: 'hosted:set-auto-merge',
} as const

export type HostedProviderId = 'github' | 'gitlab'

export type HostedCapability =
  | 'reviews'
  | 'checks'
  | 'comments'
  | 'autoMerge'
  | 'stackedReviews'
  | 'reactions'

export type HostedReviewState = 'open' | 'draft' | 'merged' | 'closed'
export type HostedCheckState = 'pass' | 'fail' | 'pending' | 'skipped'

export interface HostedReview {
  number: number
  title: string
  state: HostedReviewState
  base: string
  head: string
  url: string
  checksState: 'passing' | 'failing' | 'pending' | 'none'
}

export interface HostedCheck {
  name: string
  state: HostedCheckState
  url?: string
}

export interface FailedCheckLog {
  name: string
  log: string
  truncated: boolean
}

export interface HostedIssue {
  number: number
  title: string
  state: 'open' | 'closed'
  url: string
  labels: string[]
}

export interface HostedComment {
  id: string
  author: string
  body: string
  path?: string
  line?: number
  createdAt: string
}

export interface CreateReviewInput {
  workspacePath: string
  title: string
  body?: string
  base: string
  head: string
  draft?: boolean
  /** Worktree path to bind the created review onto. */
  worktreePath?: string
}

export interface HostedConnection {
  provider: HostedProviderId
  status: 'ready' | 'cli-missing' | 'unauthenticated' | 'error'
  error?: string
}

export interface HostedAPI {
  image(target: HostedTarget, path: string, ref: string): Promise<string>
  overview(target: HostedTarget): Promise<HostedOverview>
  repository(workspacePath: string): Promise<HostedRepository | null>
  browse(target: HostedTarget, query: HostedQuery): Promise<HostedPage<HostedItem>>
  detail(target: HostedTarget, kind: HostedItemKind, number: number): Promise<HostedDetail>
  discussion(target: HostedTarget, kind: HostedItemKind, number: number, page: number): Promise<HostedPage<HostedComment>>
  mutate(target: HostedTarget, mutation: HostedMutation): Promise<{ number: number }>
  loginStart(workspacePath: string): Promise<HostedLoginSession>
  loginRead(id: string): Promise<HostedLoginSession>
  loginInput(id: string, data: string): Promise<void>
  loginStop(id: string): Promise<void>
  detect(workspacePath: string): Promise<HostedProviderId | null>
  connection(workspacePath: string): Promise<HostedConnection | null>
  listReviews(workspacePath: string, branch: string): Promise<HostedReview[]>
  checks(workspacePath: string, branch: string): Promise<HostedCheck[]>
  failedLogs(workspacePath: string, branch: string): Promise<FailedCheckLog[]>
  createReview(input: CreateReviewInput): Promise<HostedReview>
  mergeReview(
    workspacePath: string,
    number: number,
    method?: 'squash' | 'merge' | 'rebase',
  ): Promise<{ merged: boolean }>
  listIssues(workspacePath: string, query?: string): Promise<HostedIssue[]>
  listComments(workspacePath: string, number: number): Promise<HostedComment[]>
  postComment(workspacePath: string, number: number, body: string): Promise<{ posted: boolean }>
  setAutoMerge(workspacePath: string, number: number, enable: boolean): Promise<{ autoMerge: boolean }>
}

export type HostedItemKind = 'issue' | 'review'
export interface HostedRepository {
  key: string
  provider: HostedProviderId
  fullName: string
  url: string
  remote: 'origin'
}
export interface HostedTarget { workspacePath: string; repositoryKey: string }
export interface HostedOverview {
  description: string
  defaultBranch: string | null
  visibility: 'public' | 'private' | 'internal'
  readme: { text: string; path: string; url: string } | null
  readmeError?: string
}
export interface HostedQuery {
  kind: HostedItemKind
  state: 'open' | 'closed' | 'merged' | 'all'
  filter: 'all' | 'created' | 'assigned'
  search: string
  page: number
}
export interface HostedPage<T> { items: T[]; nextPage: number | null; truncated?: boolean }
export interface HostedItem {
  kind: HostedItemKind
  number: number
  title: string
  state: HostedReviewState
  url: string
  author: string
  updatedAt: string
  labels: string[]
}
export interface HostedDetail extends HostedItem {
  body: string
  assignees: string[]
  head?: string
  base?: string
  sha?: string
  checks: HostedCheck[]
  checksError?: string
}
export type HostedMutation =
  | { action: 'create'; kind: HostedItemKind; title: string; body: string; head?: string; base?: string; draft?: boolean }
  | { action: 'edit'; kind: HostedItemKind; number: number; title: string; body: string }
  | { action: 'comment'; kind: HostedItemKind; number: number; body: string }
  | { action: 'close' | 'reopen'; kind: HostedItemKind; number: number }
  | { action: 'merge'; kind: 'review'; number: number; sha: string }
export interface HostedLoginSession {
  id: string
  provider: HostedProviderId
  output: string
  finished: boolean
  exitCode?: number
}
