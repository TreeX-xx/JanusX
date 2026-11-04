// Note: GitLab.com provider over the user's glab CLI — see
// .agents/notes/remote/gitlab-provider-reviews.md
import type {
  FailedCheckLog,
  HostedCheck,
  HostedComment,
  HostedIssue,
  HostedReview,
} from '../../shared/ipc/hosted'
import type { HostedProvider } from './github'
import { gitRemoteUrl, parseGitRemote } from '../git/worktrees'
import { runHostedCli } from './cli'

const FAILED_LOG_BYTES = 6 * 1024

interface GitlabMr {
  iid?: number
  title?: string
  draft?: boolean
  work_in_progress?: boolean
  state?: string
  target_branch?: string
  source_branch?: string
  web_url?: string
}

export function parseMrs(payload: unknown): HostedReview[] {
  if (!Array.isArray(payload)) return []
  return payload
    .filter((item): item is GitlabMr => !!item && typeof item === 'object')
    .filter((item) => typeof item.iid === 'number')
    .map((item) => {
      const state = String(item.state ?? '').toLowerCase()
      const draft = item.draft === true || item.work_in_progress === true
      return {
        number: item.iid as number,
        title: String(item.title ?? ''),
        state: state === 'merged' ? 'merged' : state === 'closed' ? 'closed' : draft ? 'draft' : 'open',
        base: String(item.target_branch ?? ''),
        head: String(item.source_branch ?? ''),
        url: String(item.web_url ?? ''),
        checksState: 'none' as const,
      }
    })
}

interface GitlabJob {
  id?: number
  name?: string
  status?: string
  allow_failure?: boolean
}

export function parseJobs(payload: unknown): HostedCheck[] {
  if (!Array.isArray(payload)) return []
  return payload
    .filter((item): item is GitlabJob => !!item && typeof item === 'object')
    .map((item) => {
      const status = String(item.status ?? '').toLowerCase()
      return {
        name: String(item.name ?? 'job'),
        state:
          status === 'success' || (status === 'failed' && item.allow_failure === true)
            ? 'pass'
            : status === 'failed' || status === 'canceled'
              ? 'fail'
              : status === 'skipped'
                ? 'skipped'
                : 'pending',
      }
    })
}

export function truncateLog(log: string, maxBytes = FAILED_LOG_BYTES): { log: string; truncated: boolean } {
  if (Buffer.byteLength(log) <= maxBytes) return { log, truncated: false }
  const buffer = Buffer.from(log)
  return { log: `…[truncated]\n${buffer.subarray(buffer.byteLength - maxBytes).toString()}`, truncated: true }
}

/** owner/repo to URL-encoded project path. */
interface GitlabIssue {
  iid?: number
  title?: string
  state?: string
  web_url?: string
  labels?: string[]
}

export function parseGitlabIssues(payload: unknown): HostedIssue[] {
  if (!Array.isArray(payload)) return []
  return payload
    .filter((item): item is GitlabIssue => !!item && typeof item === 'object')
    .filter((item) => typeof item.iid === 'number')
    .map((item) => ({
      number: item.iid as number,
      title: String(item.title ?? ''),
      state: String(item.state ?? '').toLowerCase() === 'closed' ? 'closed' : 'open',
      url: String(item.web_url ?? ''),
      labels: Array.isArray(item.labels) ? item.labels.map(String) : [],
    }))
}

interface GitlabNote {
  id?: number
  body?: string
  created_at?: string
  author?: { username?: string }
  position?: { new_path?: string; new_line?: number }
  system?: boolean
}

export function parseGitlabNotes(payload: unknown): HostedComment[] {
  if (!Array.isArray(payload)) return []
  return payload
    .filter((item): item is GitlabNote => !!item && typeof item === 'object')
    .filter((item) => item.system !== true && typeof item.body === 'string' && item.body.trim())
    .map((item) => ({
      id: `gl-${String(item.id ?? Math.random())}`,
      author: String(item.author?.username ?? ''),
      body: String(item.body ?? ''),
      ...(typeof item.position?.new_path === 'string' ? { path: item.position.new_path } : {}),
      ...(typeof item.position?.new_line === 'number' ? { line: item.position.new_line } : {}),
      createdAt: String(item.created_at ?? ''),
    }))
}

export function projectPath(owner: string, repo: string): string | null {
  if (!owner || !repo) return null
  return encodeURIComponent(`${owner}/${repo}`)
}

export class GitlabProvider implements HostedProvider {
  readonly id = 'gitlab' as const
  readonly capabilities: HostedProvider['capabilities'] = ['reviews', 'checks', 'comments', 'autoMerge']

  async detect(cwd: string): Promise<boolean> {
    const remote = await gitRemoteUrl(cwd, 'origin')
    return !!remote && parseGitRemote(remote)?.host === 'gitlab.com'
  }

  private async project(cwd: string): Promise<string> {
    const remote = await gitRemoteUrl(cwd, 'origin')
    const parsed = remote ? parseGitRemote(remote) : null
    if (!parsed || parsed.host !== 'gitlab.com') throw new Error('当前仓库不是 GitLab.com 仓库')
    const project = projectPath(parsed.owner, parsed.repo)
    if (!project) throw new Error('GitLab 项目路径无效')
    return project
  }

  private async request(project: string, path: string, method = 'GET', payload?: unknown): Promise<string> {
    const args = ['api', 'projects/' + project + path, '--hostname', 'gitlab.com', '--method', method]
    if (payload !== undefined) args.push('--input', '-')
    return runHostedCli('gitlab', args, payload === undefined ? undefined : JSON.stringify(payload))
  }

  private async json<T>(project: string, path: string, method = 'GET', payload?: unknown): Promise<T> {
    const raw = await this.request(project, path, method, payload)
    try {
      return JSON.parse(raw) as T
    } catch {
      throw new Error('GitLab 返回了无效的 JSON 响应')
    }
  }

  async listReviews(cwd: string, branch: string): Promise<HostedReview[]> {
    const project = await this.project(cwd)
    const body = await this.json<unknown>(project,
      '/merge_requests?source_branch=' + encodeURIComponent(branch) + '&state=all&per_page=10')
    return parseMrs(body).filter(review => review.head === branch)
  }

  private async jobs(project: string, branch: string, failedOnly = false): Promise<GitlabJob[]> {
    const pipelines = await this.json<Array<{ id?: number }>>(project,
      '/pipelines?ref=' + encodeURIComponent(branch) + '&per_page=1&order_by=id&sort=desc')
    if (!Array.isArray(pipelines)) throw new Error('GitLab 流水线响应无效')
    const latest = pipelines[0]
    if (!latest || typeof latest.id !== 'number') return []
    const jobs = await this.json<GitlabJob[]>(project,
      '/pipelines/' + latest.id + '/jobs?per_page=50' + (failedOnly ? '&scope[]=failed' : ''))
    if (!Array.isArray(jobs)) throw new Error('GitLab 任务响应无效')
    return jobs
  }

  async getChecks(cwd: string, branch: string): Promise<HostedCheck[]> {
    return parseJobs(await this.jobs(await this.project(cwd), branch))
  }

  async getFailedLogs(cwd: string, branch: string): Promise<FailedCheckLog[]> {
    const project = await this.project(cwd)
    const jobs = (await this.jobs(project, branch, true)).filter(job => job.status === 'failed').slice(0, 3)
    const logs: FailedCheckLog[] = []
    let failure: unknown
    for (const job of jobs) {
      if (typeof job.id !== 'number') continue
      try {
        const raw = await this.request(project, '/jobs/' + job.id + '/trace')
        if (raw) logs.push({ name: String(job.name ?? 'job-' + job.id), ...truncateLog(raw) })
      } catch (error) {
        failure = error
      }
    }
    if (failure && logs.length === 0) throw failure
    return logs
  }

  async createReview(
    cwd: string,
    input: { title: string; body?: string; base: string; head: string; draft?: boolean },
  ): Promise<HostedReview> {
    if (!input.title.trim()) throw new Error('MR 标题不能为空')
    const project = await this.project(cwd)
    const title = input.draft && !/^draft:/i.test(input.title.trim()) ? 'Draft: ' + input.title.trim() : input.title.trim()
    const body = await this.json<unknown>(project, '/merge_requests', 'POST', {
      source_branch: input.head,
      target_branch: input.base,
      title,
      ...(input.body?.trim() ? { description: input.body.trim() } : {}),
      remove_source_branch: true,
    })
    const created = parseMrs([body])[0]
    if (!created) throw new Error('GitLab 未返回创建的 MR')
    return created
  }

  async mergeReview(cwd: string, number: number, method: 'squash' | 'merge' | 'rebase' = 'squash'): Promise<{ merged: boolean }> {
    this.validateNumber(number)
    if (method === 'rebase') throw new Error('GitLab 合并方式由项目设置控制，请在 GitLab 中执行 rebase')
    const project = await this.project(cwd)
    const body = await this.json<{ state?: string }>(project, '/merge_requests/' + number + '/merge', 'PUT',
      { squash: method === 'squash' })
    if (body.state !== 'merged') throw new Error('GitLab 尚未确认 MR 已合并，请刷新查看状态')
    return { merged: true }
  }

  async listIssues(cwd: string, query?: string): Promise<HostedIssue[]> {
    const project = await this.project(cwd)
    const params = new URLSearchParams({ state: 'opened', per_page: '20', order_by: 'updated_at', sort: 'desc' })
    if (query?.trim()) params.set('search', query.trim())
    return parseGitlabIssues(await this.json<unknown>(project, '/issues?' + params.toString()))
  }

  async listComments(cwd: string, number: number): Promise<HostedComment[]> {
    this.validateNumber(number)
    const project = await this.project(cwd)
    return parseGitlabNotes(await this.json<unknown>(project,
      '/merge_requests/' + number + '/notes?per_page=50&sort=asc&order_by=created_at'))
  }

  async postComment(cwd: string, number: number, comment: string): Promise<{ posted: boolean }> {
    this.validateNumber(number)
    if (!comment.trim()) throw new Error('评论内容不能为空')
    const project = await this.project(cwd)
    await this.request(project, '/merge_requests/' + number + '/notes', 'POST', { body: comment.trim() })
    return { posted: true }
  }

  async setAutoMerge(cwd: string, number: number, enable: boolean): Promise<{ autoMerge: boolean }> {
    this.validateNumber(number)
    const project = await this.project(cwd)
    if (enable) {
      const body = await this.json<{ auto_merge_enabled?: boolean; merge_when_pipeline_succeeds?: boolean; state?: string }>(
        project, '/merge_requests/' + number + '/merge', 'PUT', { auto_merge: true, squash: true })
      if (body.state !== 'merged' && !body.auto_merge_enabled && !body.merge_when_pipeline_succeeds) {
        throw new Error('GitLab 未确认自动合并已启用')
      }
      return { autoMerge: body.state !== 'merged' }
    }
    // The older endpoint remains available on GitLab.com and returns a status hash.
    const body = await this.json<{ status?: string }>(project,
      '/merge_requests/' + number + '/cancel_merge_when_pipeline_succeeds', 'POST')
    if (body.status !== 'success') throw new Error('GitLab 未能取消自动合并')
    return { autoMerge: false }
  }

  private validateNumber(number: number): void {
    if (!Number.isSafeInteger(number) || number <= 0) throw new Error('MR 编号无效：' + number)
  }
}
