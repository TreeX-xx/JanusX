import { beforeEach, describe, expect, it, vi } from 'vitest'
import { browseRepository, mutateRepository, repositoryDetail, repositoryDiscussion, resolveHostedRepository, repositoryOverview } from '../../src/main/hosted/repository'
import { runHostedCli } from '../../src/main/hosted/cli'
import { gitRemoteUrl } from '../../src/main/git/worktrees'
import type { HostedQuery } from '../../src/shared/ipc/hosted'

vi.mock('../../src/main/hosted/cli', () => ({ runHostedCli: vi.fn() }))
vi.mock('../../src/main/git/worktrees', async importOriginal => ({ ...await importOriginal<object>(), gitRemoteUrl: vi.fn() }))
const target = { workspacePath: 'runtime://ssh/work/app', repositoryKey: 'github:team/app' }
const query: HostedQuery = { kind: 'issue', state: 'open', filter: 'all', search: '', page: 1 }
const issue = { number: 7, title: 'Fix navigation', state: 'open', user: { login: 'tree' }, body: 'Details', labels: [{ name: 'bug' }], updated_at: '2026-11-03T00:00:00Z' }
const sha = 'a'.repeat(40)
beforeEach(() => { vi.clearAllMocks(); vi.mocked(gitRemoteUrl).mockResolvedValue('git@github.com:team/app.git') })

describe('repository collaboration', () => {
  it('loads GitHub metadata and UTF-8 README from the default branch', async () => {
    vi.mocked(runHostedCli).mockResolvedValueOnce(JSON.stringify({ description: 'Project', private: true, default_branch: 'release/next' }))
      .mockResolvedValueOnce(JSON.stringify({ encoding: 'base64', content: Buffer.from('# Hello 世界').toString('base64'), path: 'docs/README.md' }))
    expect(await repositoryOverview(target)).toMatchObject({ description: 'Project', visibility: 'private', defaultBranch: 'release/next', readme: { text: '# Hello 世界', path: 'docs/README.md', url: 'https://github.com/team/app/blob/release%2Fnext/docs/README.md' } })
    expect(vi.mocked(runHostedCli).mock.calls[1][1][1]).toBe('repos/team/app/readme?ref=release%2Fnext')
  })

  it('loads a GitLab README with subgroups, nested paths and a slash in the branch', async () => {
    vi.mocked(gitRemoteUrl).mockResolvedValue('https://gitlab.com/group/sub/app.git')
    vi.mocked(runHostedCli).mockResolvedValueOnce(JSON.stringify({ visibility: 'internal', default_branch: 'release/next', readme_url: 'https://gitlab.com/group/sub/app/-/blob/release/next/docs/README.md' }))
      .mockResolvedValueOnce(JSON.stringify({ encoding: 'base64', content: Buffer.from('Read me').toString('base64') }))
    expect(await repositoryOverview({ ...target, repositoryKey: 'gitlab:group/sub/app' })).toMatchObject({ visibility: 'internal', readme: { path: 'docs/README.md', text: 'Read me' } })
    expect(vi.mocked(runHostedCli).mock.calls[1][1][1]).toBe('projects/group%2Fsub%2Fapp/repository/files/docs%2FREADME.md?ref=release%2Fnext')
  })

  it.each([['HTTP 404: Not Found', false], ['HTTP 403: Forbidden', true], ['connection timed out', true]])('retains metadata and distinguishes README failure: %s', async (message, isError) => {
    vi.mocked(runHostedCli).mockResolvedValueOnce('{"default_branch":"main","description":"Kept"}').mockRejectedValueOnce(new Error(message))
    const result = await repositoryOverview(target)
    expect(result).toMatchObject({ description: 'Kept', readme: null })
    expect(result.readmeError).toBe(isError ? message : undefined)
  })

  it('does not request files from an empty repository', async () => {
    vi.mocked(runHostedCli).mockResolvedValueOnce('{"default_branch":null}')
    expect(await repositoryOverview(target)).toMatchObject({ defaultBranch: null, readme: null })
    expect(runHostedCli).toHaveBeenCalledTimes(1)
  })

  it('bounds README previews and rejects stale repository identity', async () => {
    vi.mocked(runHostedCli).mockResolvedValueOnce('{"default_branch":"main"}').mockResolvedValueOnce('{"size":999999,"encoding":"base64","content":""}')
    expect(await repositoryOverview(target)).toMatchObject({ readme: null, readmeError: expect.stringContaining('too large') })
    vi.mocked(runHostedCli).mockClear()
    await expect(repositoryOverview({ ...target, repositoryKey: 'github:other/app' })).rejects.toThrow('Repository changed')
    expect(runHostedCli).not.toHaveBeenCalled()
  })

  it('resolves runtime remotes without authorization and rejects custom hosts', async () => {
    expect(await resolveHostedRepository(target.workspacePath)).toMatchObject({ key: target.repositoryKey, fullName: 'team/app', remote: 'origin' })
    expect(runHostedCli).not.toHaveBeenCalled()
    vi.mocked(gitRemoteUrl).mockResolvedValue('git@gitlab.company.test:team/app.git')
    expect(await resolveHostedRepository(target.workspacePath)).toBeNull()
  })

  it('keeps GitHub searches in the selected repository and pages without a branch restriction', async () => {
    vi.mocked(runHostedCli).mockResolvedValue(JSON.stringify({ items: [issue], total_count: 43 }))
    const result = await browseRepository(target, { ...query, search: 'repo:other/secret "test"' })
    expect(result).toMatchObject({ items: [{ number: 7, author: 'tree', labels: ['bug'] }], nextPage: 2 })
    const [provider, args] = vi.mocked(runHostedCli).mock.calls[0]
    expect(provider).toBe('github')
    const params = new URLSearchParams(args[1].split('?')[1])
    expect(params.get('q')).toBe('repo:team/app is:issue state:open "repo:other/secret \\"test\\""')
    expect(args).toEqual(expect.arrayContaining(['--hostname', 'github.com', '--method', 'GET']))
    expect(args).not.toContain('--repo')
  })

  it('uses the authenticated account for personal filters and exposes the search limit', async () => {
    vi.mocked(runHostedCli).mockResolvedValueOnce('{"login":"tree"}').mockResolvedValueOnce(JSON.stringify({ items: [], total_count: 1200 }))
    const result = await browseRepository(target, { ...query, filter: 'assigned', page: 50 })
    expect(decodeURIComponent(vi.mocked(runHostedCli).mock.calls[1][1][1])).toContain('assignee:tree')
    expect(result).toMatchObject({ nextPage: null, truncated: true })
    await expect(browseRepository(target, { ...query, page: 51 })).rejects.toThrow('1,000')
  })

  it('separates closed and merged reviews consistently across platforms', async () => {
    vi.mocked(runHostedCli).mockResolvedValue('{"items":[],"total_count":0}')
    await browseRepository(target, { ...query, kind: 'review', state: 'closed' })
    expect(decodeURIComponent(vi.mocked(runHostedCli).mock.calls[0][1][1])).toContain('is:unmerged')
    await browseRepository(target, { ...query, kind: 'review', state: 'merged' })
    expect(decodeURIComponent(vi.mocked(runHostedCli).mock.calls[1][1][1])).toContain('is:merged')
  })

  it('encodes GitLab subgroups and uses server search and paging', async () => {
    vi.mocked(gitRemoteUrl).mockResolvedValue('https://gitlab.com/group/sub/app.git')
    vi.mocked(runHostedCli).mockResolvedValue(JSON.stringify(Array.from({ length: 20 }, (_, i) => ({ iid: i + 1, title: 'MR', state: 'merged', author: { username: 'tree' } }))))
    const result = await browseRepository({ ...target, repositoryKey: 'gitlab:group/sub/app' }, { ...query, kind: 'review', state: 'merged', search: 'bug & state=all', page: 2 })
    expect(result.nextPage).toBe(3)
    expect(result.items[0].state).toBe('merged')
    const path = vi.mocked(runHostedCli).mock.calls[0][1][1]
    expect(path).toContain('projects/group%2Fsub%2Fapp/merge_requests?')
    expect(new URLSearchParams(path.split('?')[1]).get('search')).toBe('bug & state=all')
  })

  it('refuses stale repository writes before issuing any API command', async () => {
    vi.mocked(gitRemoteUrl).mockResolvedValue('git@github.com:other/app.git')
    await expect(mutateRepository(target, { action: 'close', kind: 'issue', number: 7 })).rejects.toThrow('Repository changed')
    expect(runHostedCli).not.toHaveBeenCalled()
  })

  it('binds checks to the selected PR head commit and retains details if checks fail', async () => {
    vi.mocked(runHostedCli).mockImplementation(async (_provider, args) => {
      if (args[1].endsWith('/pulls/7')) return JSON.stringify({ ...issue, head: { ref: 'feature', sha }, base: { ref: 'main' } })
      expect(args[1]).toContain('/commits/' + sha + '/')
      throw new Error('HTTP 403 checks permission')
    })
    expect(await repositoryDetail(target, 'review', 7)).toMatchObject({ number: 7, head: 'feature', sha, checksError: 'HTTP 403 checks permission' })
  })

  it('loads an issue description and rejects treating a PR as an issue', async () => {
    vi.mocked(runHostedCli).mockResolvedValueOnce(JSON.stringify(issue))
    expect(await repositoryDetail(target, 'issue', 7)).toMatchObject({ body: 'Details', checks: [], state: 'open' })
    vi.mocked(runHostedCli).mockResolvedValueOnce(JSON.stringify({ ...issue, pull_request: {} }))
    await expect(repositoryDetail(target, 'issue', 7)).rejects.toThrow('pull request')
  })

  it('posts literal comment bodies to the correct Issue or MR endpoint', async () => {
    vi.mocked(gitRemoteUrl).mockResolvedValue('git@gitlab.com:team/app.git')
    vi.mocked(runHostedCli).mockResolvedValue('{}')
    const body = 'first\n$(do-not-execute)\n@not-a-file'
    for (const kind of ['issue', 'review'] as const) await mutateRepository({ ...target, repositoryKey: 'gitlab:team/app' }, { action: 'comment', kind, number: 7, body })
    expect(vi.mocked(runHostedCli).mock.calls.map(call => call[1][1])).toEqual(['projects/team%2Fapp/issues/7/notes', 'projects/team%2Fapp/merge_requests/7/notes'])
    expect(JSON.parse(vi.mocked(runHostedCli).mock.calls[0][2]!)).toEqual({ body })
    expect(vi.mocked(runHostedCli).mock.calls[0][1]).toContain('--input')
  })

  it('paginates discussions without counting system notes as user comments', async () => {
    vi.mocked(gitRemoteUrl).mockResolvedValue('git@gitlab.com:team/app.git')
    vi.mocked(runHostedCli).mockResolvedValue(JSON.stringify(Array.from({ length: 20 }, (_, i) => ({ id: i, body: 'event', system: i !== 19, author: { username: 'tree' } }))))
    expect(await repositoryDiscussion({ ...target, repositoryKey: 'gitlab:team/app' }, 'review', 7, 2))
      .toMatchObject({ items: [{ id: '19', author: 'tree' }], nextPage: 3 })
  })

  it.each(['github', 'gitlab'] as const)('guards %s merge by the displayed SHA and requires confirmation from the service', async provider => {
    vi.mocked(gitRemoteUrl).mockResolvedValue(`git@${provider}.com:team/app.git`)
    vi.mocked(runHostedCli).mockResolvedValueOnce(provider === 'github' ? '{"merged":false,"message":"Head changed"}' : '{"state":"opened"}')
    await expect(mutateRepository({ ...target, repositoryKey: provider + ':team/app' }, { action: 'merge', kind: 'review', number: 7, sha })).rejects.toThrow()
    expect(JSON.parse(vi.mocked(runHostedCli).mock.calls[0][2]!)).toMatchObject({ sha })
    vi.mocked(runHostedCli).mockResolvedValueOnce(provider === 'github' ? '{"merged":true}' : '{"state":"merged"}')
    expect(await mutateRepository({ ...target, repositoryKey: provider + ':team/app' }, { action: 'merge', kind: 'review', number: 7, sha })).toEqual({ number: 7 })
  })

  it('validates write inputs without launching a command and makes GitLab drafts explicit', async () => {
    await expect(mutateRepository(target, { action: 'merge', kind: 'review', number: 7, sha: 'branch-name' })).rejects.toThrow('Refresh')
    await expect(mutateRepository(target, { action: 'create', kind: 'issue', title: '', body: '' })).rejects.toThrow('title')
    expect(runHostedCli).not.toHaveBeenCalled()
    vi.mocked(gitRemoteUrl).mockResolvedValue('git@gitlab.com:team/app.git')
    vi.mocked(runHostedCli).mockResolvedValue('{"iid":8,"title":"Draft: Change"}')
    await mutateRepository({ ...target, repositoryKey: 'gitlab:team/app' }, { action: 'create', kind: 'review', title: 'Change', body: 'text', head: 'feature', base: 'main', draft: true })
    expect(JSON.parse(vi.mocked(runHostedCli).mock.calls[0][2]!)).toEqual({ title: 'Draft: Change', description: 'text', source_branch: 'feature', target_branch: 'main' })
  })
})
