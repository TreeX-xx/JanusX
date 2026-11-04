// Note: hosted platform abstraction with GitHub over gh CLI — see
// .agents/notes/remote/hosted-github-reviews.md
import type {
  FailedCheckLog,
  HostedCapability,
  HostedCheck,
  HostedComment,
  HostedIssue,
  HostedProviderId,
  HostedReview,
} from '../../shared/ipc/hosted'
import { gitRemoteUrl, parseGitRemote } from '../git/worktrees'
import { checkHostedConnection, runHostedCli } from './cli'

const FAILED_LOG_BYTES = 6 * 1024

export interface HostedProvider {
  id: HostedProviderId
  capabilities: HostedCapability[]
  detect(cwd: string): Promise<boolean>
  listReviews(cwd: string, branch: string): Promise<HostedReview[]>
  getChecks(cwd: string, branch: string): Promise<HostedCheck[]>
  getFailedLogs(cwd: string, branch: string): Promise<FailedCheckLog[]>
  createReview(cwd: string, input: { title: string; body?: string; base: string; head: string; draft?: boolean }): Promise<HostedReview>
  mergeReview(cwd: string, number: number, method?: 'squash' | 'merge' | 'rebase'): Promise<{ merged: boolean }>
  listIssues(cwd: string, query?: string): Promise<HostedIssue[]>
  listComments(cwd: string, number: number): Promise<HostedComment[]>
  postComment(cwd: string, number: number, body: string): Promise<{ posted: boolean }>
  setAutoMerge(cwd: string, number: number, enable: boolean): Promise<{ autoMerge: boolean }>
}

async function runGh(cwd: string, args: string[]): Promise<string> {
  const remote = await gitRemoteUrl(cwd, 'origin')
  const parsed = remote ? parseGitRemote(remote) : null
  if (!parsed || parsed.host !== 'github.com') throw new Error('当前仓库不是 GitHub.com 仓库')
  return runHostedCli('github', [...args, '--repo', 'github.com/' + parsed.owner + '/' + parsed.repo])
}

function safeJson<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T
  } catch {
    return null
  }
}

interface GhPr {
  number?: number
  title?: string
  isDraft?: boolean
  state?: string
  baseRefName?: string
  headRefName?: string
  url?: string
  statusCheckRollup?: Array<{ status?: string; conclusion?: string }>
}

export function parsePrList(payload: unknown, branch: string): HostedReview[] {
  if (!Array.isArray(payload)) return []
  return payload
    .filter((item): item is GhPr => !!item && typeof item === 'object')
    .filter((item) => item.headRefName === branch && typeof item.number === 'number')
    .map((item) => {
      const state = String(item.state ?? '').toUpperCase()
      const reviewState =
        state === 'MERGED' ? 'merged' : state === 'CLOSED' ? 'closed' : item.isDraft ? 'draft' : 'open'
      const rollup = item.statusCheckRollup ?? []
      const bad = new Set(['FAILURE', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STALE'])
      const failing = rollup.some((check) => !!check.conclusion && bad.has(String(check.conclusion)))
      const pending = !failing && rollup.some((check) => check.status !== 'COMPLETED')
      return {
        number: item.number as number,
        title: String(item.title ?? ''),
        state: reviewState,
        base: String(item.baseRefName ?? ''),
        head: String(item.headRefName ?? ''),
        url: String(item.url ?? ''),
        checksState: failing ? 'failing' : pending ? 'pending' : rollup.length > 0 ? 'passing' : 'none',
      }
    })
}

interface GhCheck {
  name?: string
  state?: string
  link?: string
}

export function parseChecks(payload: unknown): HostedCheck[] {
  if (!Array.isArray(payload)) return []
  return payload
    .filter((item): item is GhCheck => !!item && typeof item === 'object')
    .map((item) => {
      const state = String(item.state ?? '').toUpperCase()
      return {
        name: String(item.name ?? 'unknown'),
        state:
          state === 'SUCCESS' ? 'pass' : state === 'FAILURE' ? 'fail' : state === 'SKIPPED' ? 'skipped' : 'pending',
        ...(item.link ? { url: String(item.link) } : {}),
      }
    })
}

interface GhRun {
  databaseId?: number
  name?: string
  conclusion?: string
}

export function selectFailedRuns(payload: unknown, limit = 3): Array<{ id: number; name: string }> {
  if (!Array.isArray(payload)) return []
  return payload
    .filter((item): item is GhRun => !!item && typeof item === 'object')
    .filter((item) => item.conclusion === 'failure' && typeof item.databaseId === 'number')
    .slice(0, limit)
    .map((item) => ({ id: item.databaseId as number, name: String(item.name ?? 'run') }))
}

export function truncateLog(log: string, maxBytes = FAILED_LOG_BYTES): { log: string; truncated: boolean } {
  if (Buffer.byteLength(log) <= maxBytes) return { log, truncated: false }
  const buffer = Buffer.from(log)
  return { log: `…[truncated]\n${buffer.subarray(buffer.byteLength - maxBytes).toString()}`, truncated: true }
}

async function githubRemote(cwd: string): Promise<boolean> {
  const url = await gitRemoteUrl(cwd, 'origin').catch(() => null)
  return !!url && parseGitRemote(url)?.host === 'github.com'
}

class GitHubProvider implements HostedProvider {
  readonly id = 'github' as const
  readonly capabilities: HostedCapability[] = ['reviews', 'checks', 'comments']

  async detect(cwd: string): Promise<boolean> {
    return githubRemote(cwd)
  }

  async listReviews(cwd: string, branch: string): Promise<HostedReview[]> {
    const stdout = await runGh(cwd, [
      'pr', 'list', '--head', branch, '--state', 'all', '--limit', '10',
      '--json', 'number,title,isDraft,state,baseRefName,headRefName,url,statusCheckRollup',
    ])
    return parsePrList(safeJson(stdout), branch)
  }

  async getChecks(cwd: string, branch: string): Promise<HostedCheck[]> {
    const stdout = await runGh(cwd, ['pr', 'checks', branch, '--json', 'name,state,link'])
    return parseChecks(safeJson(stdout))
  }

  async getFailedLogs(cwd: string, branch: string): Promise<FailedCheckLog[]> {
    const runsJson = await runGh(cwd, [
      'run', 'list', '--branch', branch, '--limit', '10', '--json', 'databaseId,name,conclusion',
    ]).catch(() => null)
    if (!runsJson) return []
    const failed = selectFailedRuns(safeJson(runsJson))
    const logs: FailedCheckLog[] = []
    for (const run of failed) {
      try {
        const output = await runGh(cwd, ['run', 'view', String(run.id), '--log-failed'])
        const { log, truncated } = truncateLog(output)
        logs.push({ name: run.name, log, truncated })
      } catch {
        // One unreadable run must not hide the others.
      }
    }
    return logs
  }

  async createReview(
    cwd: string,
    input: { title: string; body?: string; base: string; head: string; draft?: boolean },
  ): Promise<HostedReview> {
    if (!input.title.trim()) throw new Error('PR 标题不能为空')
    const args = [
      'pr', 'create',
      '--base', input.base,
      '--head', input.head,
      '--title', input.title.trim(),
    ]
    if (input.body?.trim()) args.push('--body', input.body.trim())
    if (input.draft) args.push('--draft')
    const stdout = await runGh(cwd, args)
    const created = safeJson<{ number?: number; url?: string; title?: string }>(stdout)
    const url = created?.url ?? stdout.trim().split('\n').pop() ?? ''
    const match = /\/pull\/(\d+)/.exec(url)
    return {
      number: created?.number ?? (match ? Number(match[1]) : NaN),
      title: created?.title ?? input.title.trim(),
      state: input.draft ? 'draft' : 'open',
      base: input.base,
      head: input.head,
      url,
      checksState: 'none',
    }
  }

  async mergeReview(cwd: string, number: number, method: 'squash' | 'merge' | 'rebase' = 'squash'): Promise<{ merged: boolean }> {
    if (!Number.isFinite(number)) throw new Error(`PR 编号无效：${number}`)
    await runGh(cwd, ['pr', 'merge', String(number), `--${method}`])
    return { merged: true }
  }

  async listIssues(cwd: string, query?: string): Promise<HostedIssue[]> {
    const args = ['issue', 'list', '--state', 'open', '--limit', '20', '--json', 'number,title,state,url,labels']
    if (query?.trim()) args.push('--search', query.trim())
    const stdout = await runGh(cwd, args)
    return parseIssues(safeJson(stdout))
  }

  async listComments(cwd: string, number: number): Promise<HostedComment[]> {
    if (!Number.isFinite(number)) throw new Error(`PR 编号无效：${number}`)
    const stdout = await runGh(cwd, ['pr', 'view', String(number), '--json', 'comments,reviews'])
    return parsePrComments(safeJson(stdout))
  }

  async postComment(cwd: string, number: number, body: string): Promise<{ posted: boolean }> {
    if (!Number.isFinite(number)) throw new Error(`PR 编号无效：${number}`)
    if (!body.trim()) throw new Error('评论内容不能为空')
    await runGh(cwd, ['pr', 'comment', String(number), '--body', body.trim()])
    return { posted: true }
  }

  async setAutoMerge(cwd: string, number: number, enable: boolean): Promise<{ autoMerge: boolean }> {
    if (!Number.isFinite(number)) throw new Error(`PR 编号无效：${number}`)
    await runGh(cwd, enable ? ['pr', 'merge', String(number), '--auto', '--squash'] : ['pr', 'merge', '--disable-auto', String(number)])
    return { autoMerge: enable }
  }
}

interface GhIssue {
  number?: number
  title?: string
  state?: string
  url?: string
  labels?: Array<{ name?: string }>
}

export function parseIssues(payload: unknown): HostedIssue[] {
  if (!Array.isArray(payload)) return []
  return payload
    .filter((item): item is GhIssue => !!item && typeof item === 'object')
    .filter((item) => typeof item.number === 'number')
    .map((item) => ({
      number: item.number as number,
      title: String(item.title ?? ''),
      state: String(item.state ?? '').toUpperCase() === 'CLOSED' ? 'closed' : 'open',
      url: String(item.url ?? ''),
      labels: Array.isArray(item.labels)
        ? item.labels.map((label) => String(label?.name ?? '')).filter(Boolean)
        : [],
    }))
}

interface GhReviewComment {
  author?: { login?: string }
  body?: string
  createdAt?: string
  path?: string
  line?: number
}

interface GhReview {
  author?: { login?: string }
  body?: string
  state?: string
  submittedAt?: string
  comments?: GhReviewComment[]
}

interface GhPrView {
  comments?: GhReviewComment[]
  reviews?: GhReview[]
}

export function parsePrComments(payload: unknown): HostedComment[] {
  if (!payload || typeof payload !== 'object') return []
  const view = payload as GhPrView
  const comments: HostedComment[] = []
  let seq = 0
  const push = (author: string, body: string, createdAt: string, path?: string, line?: number) => {
    if (!body.trim()) return
    seq += 1
    comments.push({
      id: `gh-${seq}`,
      author,
      body,
      ...(path ? { path } : {}),
      ...(typeof line === 'number' ? { line } : {}),
      createdAt,
    })
  }
  for (const comment of view.comments ?? []) {
    push(String(comment.author?.login ?? ''), String(comment.body ?? ''), String(comment.createdAt ?? ''))
  }
  for (const review of view.reviews ?? []) {
    const author = String(review.author?.login ?? '')
    const at = String(review.submittedAt ?? '')
    push(author, String(review.body ?? ''), at)
    for (const inline of review.comments ?? []) {
      push(
        String(inline.author?.login ?? author),
        String(inline.body ?? ''),
        String(inline.createdAt ?? at),
        inline.path,
        inline.line,
      )
    }
  }
  return comments
}

import { GitlabProvider } from './gitlab'

const providers: HostedProvider[] = [new GitHubProvider(), new GitlabProvider()]

/** First provider that claims the checkout, or null for local-only work. */
export async function detectProvider(cwd: string): Promise<HostedProvider | null> {
  for (const provider of providers) {
    try {
      if (await provider.detect(cwd)) return provider
    } catch {
      // Detection never blocks local flows.
    }
  }
  return null
}

export function getProvider(id: HostedProviderId): HostedProvider | null {
  return providers.find((provider) => provider.id === id) ?? null
}

/** Identify the checkout independently of the CLI's installation or authorization. */
export async function hostedConnection(cwd: string) {
  const provider = await detectProvider(cwd)
  return provider ? checkHostedConnection(provider.id) : null
}
