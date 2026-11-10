// Note: repository browsing and writes — .agents/notes/workbench/ideas/repository-sidebar.md
import type { HostedCheck, HostedComment, HostedDetail, HostedItem, HostedItemKind, HostedMutation, HostedPage, HostedQuery, HostedRepository, HostedTarget, HostedOverview } from '../../shared/ipc/hosted'
import { gitRemoteUrl, parseGitRemote } from '../git/worktrees'
import { runHostedCli } from './cli'

const PAGE_SIZE = 20
interface Person { login?: string; username?: string }
interface ApiItem {
  number?: number; iid?: number; id?: number; title?: string; body?: string; description?: string
  state?: string; draft?: boolean; merged?: boolean; merged_at?: string | null
  html_url?: string; web_url?: string; updated_at?: string; created_at?: string
  user?: Person; author?: Person; assignees?: Person[]; labels?: Array<string | { name?: string }>
  pull_request?: { merged_at?: string | null }
  head?: { ref?: string; sha?: string }; base?: { ref?: string }
  source_branch?: string; target_branch?: string; sha?: string
  head_pipeline?: { status?: string; web_url?: string; sha?: string } | null
  system?: boolean
}

export async function resolveHostedRepository(workspacePath: string): Promise<HostedRepository | null> {
  const remote = await gitRemoteUrl(workspacePath, 'origin')
  const parsed = remote ? parseGitRemote(remote) : null
  if (!parsed || !['github.com', 'gitlab.com'].includes(parsed.host)) return null
  const fullName = parsed.owner + '/' + parsed.repo
  if (fullName.split('/').some(part => !/^[\w.-]+$/.test(part) || part === '.' || part === '..')) return null
  const provider = parsed.host === 'github.com' ? 'github' : 'gitlab'
  return { key: provider + ':' + fullName, provider, fullName, url: 'https://' + parsed.host + '/' + fullName, remote: 'origin' }
}

async function resolveTarget(target: HostedTarget): Promise<HostedRepository> {
  const repository = await resolveHostedRepository(target.workspacePath)
  if (!repository || repository.key !== target.repositoryKey) throw new Error('Repository changed. Refresh before continuing.')
  return repository
}

function numberId(number: number): void {
  if (!Number.isSafeInteger(number) || number < 1) throw new Error('Invalid issue or review number')
}
function pageNumber(page: number): void { numberId(page) }
function itemKind(kind: HostedItemKind): void {
  if (kind !== 'issue' && kind !== 'review') throw new Error('Invalid item kind')
}
function prefix(repo: HostedRepository): string {
  return repo.provider === 'github' ? 'repos/' + repo.fullName : 'projects/' + encodeURIComponent(repo.fullName)
}
function itemPath(repo: HostedRepository, kind: HostedItemKind, number?: number): string {
  return prefix(repo) + '/' + (kind === 'issue' ? 'issues' : repo.provider === 'github' ? 'pulls' : 'merge_requests') + (number ? '/' + number : '')
}
async function api<T>(repo: HostedRepository, path: string, method = 'GET', body?: unknown, accept?: string): Promise<T> {
  const host = repo.provider === 'github' ? 'github.com' : 'gitlab.com'
  const args = ['api', path, '--hostname', host, '--method', method]
  if (accept) args.push('--header', 'Accept: ' + accept)
  if (body !== undefined) args.push('--input', '-')
  const output = await runHostedCli(repo.provider, args, body === undefined ? undefined : JSON.stringify(body))
  try { return JSON.parse(output) as T } catch { throw new Error('The hosting service returned invalid JSON') }
}
function author(person?: Person): string { return person?.login ?? person?.username ?? '' }
function item(raw: ApiItem, kind: HostedItemKind, repo: HostedRepository): HostedItem {
  const number = repo.provider === 'github' ? raw.number : raw.iid
  if (!number || typeof raw.title !== 'string') throw new Error('The hosting service returned an invalid item')
  return {
    kind, number, title: raw.title,
    state: raw.merged || raw.merged_at || raw.pull_request?.merged_at || raw.state === 'merged' ? 'merged'
      : raw.state === 'closed' ? 'closed' : raw.draft ? 'draft' : 'open',
    url: raw.html_url ?? raw.web_url ?? '', author: author(raw.user ?? raw.author), updatedAt: raw.updated_at ?? '',
    labels: (raw.labels ?? []).map(label => typeof label === 'string' ? label : label.name ?? '').filter(Boolean),
  }
}

/** Read only a file in the selected repository; CLI credentials never accompany external image URLs. */
export async function repositoryImage(target: HostedTarget, path: string, ref: string): Promise<string> {
  if (typeof path !== 'string' || path.length > 2048 || !path || path.split('/').some(part => !part || part === '.' || part === '..') || /[\\\x00-\x1f]/.test(path)) throw new Error('Invalid image path')
  if (typeof ref !== 'string' || !ref || ref.length > 1024 || /[\x00-\x1f]/.test(ref)) throw new Error('Invalid image revision')
  const types: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', avif: 'image/avif', ico: 'image/x-icon' }
  const mime = types[path.split('.').pop()!.toLowerCase()]
  if (!mime) throw new Error('Unsupported image format')
  const repo = await resolveTarget(target)
  const endpoint = prefix(repo) + (repo.provider === 'github' ? '/contents/' + path.split('/').map(encodeURIComponent).join('/') : '/repository/files/' + encodeURIComponent(path)) + '?ref=' + encodeURIComponent(ref)
  type FileContent = { content?: string; encoding?: string; size?: number; sha?: string }
  let file = await api<FileContent>(repo, endpoint, 'GET', undefined, repo.provider === 'github' ? 'application/vnd.github.object+json' : undefined)
  const limit = 4 * 1024 * 1024
  if (typeof file.size !== 'number' || file.size > limit) throw new Error('Image exceeds the 4 MiB preview limit')
  // GitHub omits content for files above 1 MiB; the blob endpoint still returns bounded base64.
  if (repo.provider === 'github' && file.encoding === 'none' && /^[a-f0-9]{40,64}$/i.test(file.sha ?? '')) file = await api<FileContent>(repo, prefix(repo) + '/git/blobs/' + file.sha)
  if (file.encoding !== 'base64' || typeof file.content !== 'string' || file.content.length > Math.ceil(limit / 3) * 4 + 100000) throw new Error('Image content is unavailable')
  const bytes = Buffer.from(file.content, 'base64')
  if (!bytes.length || bytes.length > limit) throw new Error('Image exceeds the preview limit or is empty')
  return 'data:' + mime + ';base64,' + bytes.toString('base64')
}

export async function repositoryOverview(target: HostedTarget): Promise<HostedOverview> {
  const repo = await resolveTarget(target)
  const meta = await api<{ description?: string; default_branch?: string; private?: boolean; visibility?: string; readme_url?: string | null }>(repo, prefix(repo))
  const result: HostedOverview = {
    description: meta.description ?? '', defaultBranch: meta.default_branch || null,
    visibility: meta.visibility === 'internal' ? 'internal' : meta.visibility === 'private' || meta.private ? 'private' : 'public',
    readme: null,
  }
  if (!result.defaultBranch) return result
  try {
    let path = ''
    let endpoint = prefix(repo) + '/readme?ref=' + encodeURIComponent(result.defaultBranch)
    if (repo.provider === 'gitlab') {
      if (!meta.readme_url) return result
      const url = new URL(meta.readme_url)
      const start = new URL(repo.url).pathname + '/-/blob/' + result.defaultBranch + '/'
      const pathname = decodeURIComponent(url.pathname)
      if (url.origin !== 'https://gitlab.com' || !pathname.startsWith(start)) throw new Error('Could not locate the repository README')
      path = pathname.slice(start.length)
      endpoint = prefix(repo) + '/repository/files/' + encodeURIComponent(path) + '?ref=' + encodeURIComponent(result.defaultBranch)
    }
    const file = await api<{ content?: string; encoding?: string; size?: number; path?: string }>(repo, endpoint)
    if ((file.size ?? 0) > 512 * 1024 || (file.content?.length ?? 0) > 720 * 1024) throw new Error('README is too large to preview. Open the repository in your browser.')
    if (file.encoding !== 'base64' || typeof file.content !== 'string') throw new Error('README content is unavailable. Open the repository in your browser.')
    path = file.path ?? path
    const text = Buffer.from(file.content, 'base64').toString('utf8')
    if (Buffer.byteLength(text) > 512 * 1024) throw new Error('README is too large to preview. Open the repository in your browser.')
    result.readme = { text, path, url: repo.url + (repo.provider === 'github' ? '/blob/' : '/-/blob/') + encodeURIComponent(result.defaultBranch) + '/' + path.split('/').map(encodeURIComponent).join('/') }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!/HTTP 404|\(404\)/i.test(message)) result.readmeError = message
  }
  return result
}

export async function browseRepository(target: HostedTarget, query: HostedQuery): Promise<HostedPage<HostedItem>> {
  itemKind(query.kind); pageNumber(query.page)
  if (!['open', 'closed', 'merged', 'all'].includes(query.state) || !['all', 'created', 'assigned'].includes(query.filter) || (query.state === 'merged' && query.kind !== 'review')) throw new Error('Invalid repository filter')
  if (typeof query.search !== 'string' || query.search.length > 200) throw new Error('Search is limited to 200 characters')
  const repo = await resolveTarget(target)
  const params = new URLSearchParams({ per_page: String(PAGE_SIZE), page: String(query.page) })
  if (repo.provider === 'github') {
    if (query.page > 1000 / PAGE_SIZE) throw new Error('Narrow the search to browse beyond 1,000 matches')
    const terms = ['repo:' + repo.fullName, 'is:' + (query.kind === 'issue' ? 'issue' : 'pr')]
    if (query.state === 'merged') terms.push('is:merged')
    else if (query.state !== 'all') terms.push('state:' + query.state)
    if (query.kind === 'review' && query.state === 'closed') terms.push('is:unmerged')
    if (query.filter !== 'all') {
      const user = await api<Person>(repo, 'user')
      if (!user.login) throw new Error('Could not identify the authenticated GitHub user')
      terms.push((query.filter === 'created' ? 'author:' : 'assignee:') + user.login)
    }
    // Search text is a literal phrase, never additional repo/type qualifiers.
    if (query.search.trim()) terms.push('"' + query.search.trim().replace(/[\\"]/g, '\\$&') + '"')
    params.set('q', terms.join(' ')); params.set('sort', 'updated'); params.set('order', 'desc')
    const result = await api<{ items: ApiItem[]; total_count: number; incomplete_results?: boolean }>(repo, 'search/issues?' + params)
    if (!Array.isArray(result.items)) throw new Error('Invalid repository search response')
    return {
      items: result.items.map(raw => item(raw, query.kind, repo)),
      nextPage: query.page * PAGE_SIZE < Math.min(result.total_count, 1000) ? query.page + 1 : null,
      truncated: result.total_count > 1000 || result.incomplete_results === true,
    }
  }
  params.set('state', query.state === 'open' ? 'opened' : query.state)
  params.set('scope', query.filter === 'created' ? 'created_by_me' : query.filter === 'assigned' ? 'assigned_to_me' : 'all')
  params.set('order_by', 'updated_at'); params.set('sort', 'desc')
  if (query.search.trim()) params.set('search', query.search.trim())
  const result = await api<ApiItem[]>(repo, itemPath(repo, query.kind) + '?' + params)
  if (!Array.isArray(result)) throw new Error('Invalid repository list response')
  return { items: result.map(raw => item(raw, query.kind, repo)), nextPage: result.length === PAGE_SIZE ? query.page + 1 : null }
}

function checkState(state?: string): HostedCheck['state'] {
  if (['success', 'passed'].includes(state ?? '')) return 'pass'
  if (['failure', 'failed', 'error', 'cancelled', 'canceled', 'timed_out', 'action_required'].includes(state ?? '')) return 'fail'
  if (['skipped', 'neutral'].includes(state ?? '')) return 'skipped'
  return 'pending'
}
export async function repositoryDetail(target: HostedTarget, kind: HostedItemKind, number: number): Promise<HostedDetail> {
  itemKind(kind); numberId(number)
  const repo = await resolveTarget(target)
  const raw = await api<ApiItem>(repo, itemPath(repo, kind, number))
  if (kind === 'issue' && raw.pull_request) throw new Error('This item is a pull request')
  const result: HostedDetail = {
    ...item(raw, kind, repo), body: raw.body ?? raw.description ?? '', assignees: (raw.assignees ?? []).map(author), checks: [],
    ...(kind === 'review' ? { head: raw.head?.ref ?? raw.source_branch, base: raw.base?.ref ?? raw.target_branch, sha: raw.head?.sha ?? raw.sha } : {}),
  }
  if (kind !== 'review') return result
  if (repo.provider === 'gitlab') {
    if (raw.head_pipeline && raw.head_pipeline.sha === result.sha) result.checks = [{ name: 'Pipeline', state: checkState(raw.head_pipeline.status), url: raw.head_pipeline.web_url }]
    return result
  }
  if (!result.sha || !/^[a-f0-9]{40,64}$/i.test(result.sha)) return result
  try {
    const [checks, statuses] = await Promise.all([
      api<{ total_count: number; check_runs: Array<{ name: string; status: string; conclusion?: string; html_url?: string }> }>(repo, prefix(repo) + '/commits/' + result.sha + '/check-runs?per_page=100'),
      api<{ total_count: number; statuses: Array<{ context: string; state: string; target_url?: string }> }>(repo, prefix(repo) + '/commits/' + result.sha + '/status?per_page=100'),
    ])
    result.checks = [...checks.check_runs.map(check => ({ name: check.name, state: checkState(check.conclusion ?? check.status), url: check.html_url })),
      ...statuses.statuses.map(status => ({ name: status.context, state: checkState(status.state), url: status.target_url }))]
    if (checks.total_count > 100 || statuses.total_count > 100) result.checksError = 'Only the first 100 check runs and statuses are shown. Open the review in your browser for all results.'
  } catch (error) { result.checksError = error instanceof Error ? error.message : String(error) }
  return result
}

export async function repositoryDiscussion(target: HostedTarget, kind: HostedItemKind, number: number, page: number): Promise<HostedPage<HostedComment>> {
  itemKind(kind); numberId(number); pageNumber(page)
  const repo = await resolveTarget(target)
  const path = repo.provider === 'github' ? itemPath(repo, 'issue', number) + '/comments' : itemPath(repo, kind, number) + '/notes'
  const rows = await api<ApiItem[]>(repo, path + '?per_page=' + PAGE_SIZE + '&page=' + page + '&order_by=created_at&sort=asc')
  if (!Array.isArray(rows)) throw new Error('Invalid discussion response')
  return { items: rows.filter(row => !row.system).map(row => ({ id: String(row.id), author: author(row.user ?? row.author), body: row.body ?? '', createdAt: row.created_at ?? '' })), nextPage: rows.length === PAGE_SIZE ? page + 1 : null }
}

export async function mutateRepository(target: HostedTarget, mutation: HostedMutation): Promise<{ number: number }> {
  itemKind(mutation.kind)
  if (mutation.action !== 'create') numberId(mutation.number)
  if (['create', 'edit'].includes(mutation.action) && (!('title' in mutation) || !mutation.title?.trim() || mutation.title.length > 255)) throw new Error('A title of 1–255 characters is required')
  if ('body' in mutation && (typeof mutation.body !== 'string' || mutation.body.length > 60000)) throw new Error('Body must be under 60,000 characters')
  if (mutation.action === 'comment' && !mutation.body.trim()) throw new Error('Comment cannot be empty')
  const repo = await resolveTarget(target)
  const github = repo.provider === 'github'
  if (mutation.action === 'create') {
    if (mutation.kind === 'review' && (!mutation.head?.trim() || !mutation.base?.trim() || mutation.head === mutation.base)) throw new Error('Choose different source and target branches')
    const payload = github
      ? { title: mutation.title.trim(), body: mutation.body, ...(mutation.kind === 'review' ? { head: mutation.head, base: mutation.base, draft: !!mutation.draft } : {}) }
      : { title: mutation.kind === 'review' && mutation.draft && !/^draft:/i.test(mutation.title.trim()) ? 'Draft: ' + mutation.title.trim() : mutation.title.trim(), description: mutation.body,
        ...(mutation.kind === 'review' ? { source_branch: mutation.head, target_branch: mutation.base } : {}) }
    const created = await api<ApiItem>(repo, itemPath(repo, mutation.kind), 'POST', payload)
    return { number: item(created, mutation.kind, repo).number }
  }
  const path = itemPath(repo, mutation.kind, mutation.number)
  switch (mutation.action) {
    case 'comment':
      await api(repo, github ? itemPath(repo, 'issue', mutation.number) + '/comments' : path + '/notes', 'POST', { body: mutation.body })
      break
    case 'edit':
      await api(repo, path, github ? 'PATCH' : 'PUT', github ? { title: mutation.title.trim(), body: mutation.body } : { title: mutation.title.trim(), description: mutation.body })
      break
    case 'close': case 'reopen':
      await api(repo, path, github ? 'PATCH' : 'PUT', github ? { state: mutation.action === 'close' ? 'closed' : 'open' } : { state_event: mutation.action === 'close' ? 'close' : 'reopen' })
      break
    case 'merge': {
      if (mutation.kind !== 'review' || !/^[a-f0-9]{40,64}$/i.test(mutation.sha)) throw new Error('Refresh the review before merging')
      const merged = await api<{ merged?: boolean; state?: string; message?: string }>(repo, path + '/merge', 'PUT', github
        ? { sha: mutation.sha, merge_method: 'squash' } : { sha: mutation.sha, squash: true })
      if (github ? merged.merged !== true : merged.state !== 'merged') throw new Error(merged.message ?? 'The service has not confirmed the merge. Refresh the review.')
      break
    }
    default: throw new Error('Unsupported repository action')
  }
  return { number: mutation.number }
}
