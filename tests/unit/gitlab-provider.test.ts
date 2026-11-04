import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GitlabProvider, parseGitlabIssues, parseGitlabNotes, parseJobs, parseMrs, projectPath } from '../../src/main/hosted/gitlab'
import { gitRemoteUrl, parseGitRemote } from '../../src/main/git/worktrees'
import { runHostedCli } from '../../src/main/hosted/cli'

vi.mock('../../src/main/git/worktrees', () => ({ gitRemoteUrl: vi.fn(), parseGitRemote: vi.fn() }))
vi.mock('../../src/main/hosted/cli', () => ({ runHostedCli: vi.fn() }))

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(gitRemoteUrl).mockResolvedValue('git@gitlab.com:group/sub/app.git')
  vi.mocked(parseGitRemote).mockReturnValue({ host: 'gitlab.com', owner: 'group/sub', repo: 'app' })
})

describe('parseMrs', () => {
  it('maps states including legacy WIP drafts', () => {
    const reviews = parseMrs([
      { iid: 7, title: 'Auth', state: 'opened', target_branch: 'main', source_branch: 'feat', web_url: 'https://h/t/a/-/merge_requests/7' },
      { iid: 8, title: 'Wip', state: 'opened', work_in_progress: true, target_branch: 'main', source_branch: 'wip' },
      { iid: 9, title: 'Done', state: 'merged', target_branch: 'main', source_branch: 'old' },
      { iid: 10, title: 'Drop', state: 'closed', target_branch: 'main', source_branch: 'drop' },
      { title: 'no-iid' },
    ])
    expect(reviews).toMatchObject([
      { number: 7, state: 'open', base: 'main', head: 'feat', checksState: 'none' },
      { number: 8, state: 'draft' },
      { number: 9, state: 'merged' },
      { number: 10, state: 'closed' },
    ])
  })

  it('rejects non-arrays', () => {
    expect(parseMrs(null)).toEqual([])
  })
})

describe('parseJobs', () => {
  it('treats allowed failures as passing', () => {
    expect(
      parseJobs([
        { id: 1, name: 'build', status: 'success' },
        { id: 2, name: 'flaky', status: 'failed', allow_failure: true },
        { id: 3, name: 'test', status: 'failed' },
        { id: 4, name: 'lint', status: 'running' },
      ]),
    ).toEqual([
      { name: 'build', state: 'pass' },
      { name: 'flaky', state: 'pass' },
      { name: 'test', state: 'fail' },
      { name: 'lint', state: 'pending' },
    ])
  })
})

describe('projectPath', () => {
  it('encodes nested groups', () => {
    expect(projectPath('team', 'app')).toBe('team%2Fapp')
    expect(projectPath('group/sub', 'app')).toBe('group%2Fsub%2Fapp')
    expect(projectPath('', 'app')).toBeNull()
  })
})

describe('parseGitlabIssues', () => {
  it('keeps opened issues with labels', () => {
    expect(
      parseGitlabIssues([
        { iid: 5, title: 'Bug', state: 'opened', web_url: 'https://h/i/5', labels: ['bug'] },
        { iid: 6, title: 'Old', state: 'closed', web_url: 'https://h/i/6' },
      ]),
    ).toEqual([
      { number: 5, title: 'Bug', state: 'open', url: 'https://h/i/5', labels: ['bug'] },
      { number: 6, title: 'Old', state: 'closed', url: 'https://h/i/6', labels: [] },
    ])
  })
})

describe('parseGitlabNotes', () => {
  it('drops system notes and keeps inline positions', () => {
    expect(
      parseGitlabNotes([
        { id: 1, body: 'lgtm', created_at: 't1', author: { username: 'a' } },
        { id: 2, body: 'here', created_at: 't2', author: { username: 'b' }, position: { new_path: 'a.ts', new_line: 3 } },
        { id: 3, body: 'merged it', system: true },
        { id: 4, body: '   ' },
      ]),
    ).toEqual([
      { id: 'gl-1', author: 'a', body: 'lgtm', createdAt: 't1' },
      { id: 'gl-2', author: 'b', body: 'here', path: 'a.ts', line: 3, createdAt: 't2' },
    ])
  })
})

describe('GitLab.com over glab', () => {
  const provider = new GitlabProvider()
  const cwd = 'runtime://remote-workspace/repo'
  const mr = { iid: 7, title: 'Auth', state: 'opened', target_branch: 'main', source_branch: 'feat',
    web_url: 'https://gitlab.com/group/sub/app/-/merge_requests/7' }

  it('recognizes GitLab.com before authorization and rejects self-managed hosts', async () => {
    expect(await provider.detect(cwd)).toBe(true)
    expect(gitRemoteUrl).toHaveBeenCalledWith(cwd, 'origin')
    expect(runHostedCli).not.toHaveBeenCalled()
    vi.mocked(parseGitRemote).mockReturnValue({ host: 'git.company.com', owner: 'team', repo: 'app' })
    expect(await provider.detect(cwd)).toBe(false)
    await expect(provider.listIssues(cwd)).rejects.toThrow('GitLab.com')
    expect(runHostedCli).not.toHaveBeenCalled()
  })

  it('pins the host and encoded project without passing a remote workspace as local cwd', async () => {
    vi.mocked(runHostedCli).mockResolvedValue(JSON.stringify([mr, { ...mr, iid: 8, source_branch: 'other' }]))
    expect(await provider.listReviews(cwd, 'feat')).toMatchObject([{ number: 7, head: 'feat' }])
    expect(runHostedCli).toHaveBeenCalledWith('gitlab', [
      'api', 'projects/group%2Fsub%2Fapp/merge_requests?source_branch=feat&state=all&per_page=10',
      '--hostname', 'gitlab.com', '--method', 'GET',
    ], undefined)
  })

  it('keeps search parameters encoded and returns issue labels', async () => {
    vi.mocked(runHostedCli).mockResolvedValue(JSON.stringify([{ iid: 5, title: 'Bug', state: 'opened', labels: ['bug'] }]))
    expect(await provider.listIssues(cwd, 'bug & state=closed')).toMatchObject([{ number: 5, state: 'open', labels: ['bug'] }])
    expect(vi.mocked(runHostedCli).mock.calls[0][1][1]).toContain('search=bug+%26+state%3Dclosed')
  })

  it('propagates authorization, transport and invalid response failures', async () => {
    vi.mocked(runHostedCli).mockRejectedValueOnce(new Error('glab auth login'))
    await expect(provider.listReviews(cwd, 'feat')).rejects.toThrow('glab auth login')
    vi.mocked(runHostedCli).mockRejectedValueOnce(new Error('HTTP 403'))
    await expect(provider.listIssues(cwd)).rejects.toThrow('HTTP 403')
    vi.mocked(runHostedCli).mockResolvedValueOnce('<html>proxy error</html>')
    await expect(provider.listIssues(cwd)).rejects.toThrow('JSON')
  })

  it('reads checks and failed traces through the same CLI identity', async () => {
    const jobs = [{ id: 1001, name: 'test', status: 'failed' }, { id: 1002, name: 'build', status: 'success' }]
    vi.mocked(runHostedCli).mockImplementation(async (_provider, args) => {
      if (args[1].includes('/pipelines?')) return JSON.stringify([{ id: 100 }])
      if (args[1].includes('/jobs?')) return JSON.stringify(jobs)
      if (args[1].endsWith('/trace')) return 'FAILED\n' + 'x'.repeat(8000) + '\nTAIL'
      throw new Error('Unexpected request')
    })
    expect(await provider.getChecks(cwd, 'feat')).toEqual([{ name: 'test', state: 'fail' }, { name: 'build', state: 'pass' }])
    const logs = await provider.getFailedLogs(cwd, 'feat')
    expect(logs).toMatchObject([{ name: 'test', truncated: true }])
    expect(logs[0].log.endsWith('TAIL')).toBe(true)
    expect(runHostedCli).toHaveBeenCalledWith('gitlab', expect.arrayContaining([
      'projects/group%2Fsub%2Fapp/jobs/1001/trace', '--hostname', 'gitlab.com',
    ]), undefined)
  })

  it('finds failed jobs even when newer successful jobs fill the first page', async () => {
    vi.mocked(runHostedCli).mockImplementation(async (_provider, args) => {
      const path = args[1]
      if (path.includes('/pipelines?')) return JSON.stringify([{ id: 100 }])
      if (path.includes('/jobs?')) {
        const query = new URLSearchParams(path.split('?')[1])
        return JSON.stringify(query.get('scope[]') === 'failed'
          ? [{ id: 1, name: 'early failure', status: 'failed' }]
          : Array.from({ length: 50 }, (_, index) => ({ id: index + 2, name: 'success', status: 'success' })))
      }
      if (path.endsWith('/jobs/1/trace')) return 'failure details'
      throw new Error('Unexpected request')
    })
    expect(await provider.getFailedLogs(cwd, 'feat')).toEqual([
      { name: 'early failure', log: 'failure details', truncated: false },
    ])
  })

  it('passes multiline bodies literally on stdin and creates an actual draft MR', async () => {
    vi.mocked(runHostedCli).mockResolvedValueOnce(JSON.stringify({ ...mr, title: 'Draft: New', draft: true }))
    const text = 'first line\n$(not-a-command)\n@not-a-file'
    expect(await provider.createReview(cwd, { title: 'New', body: text, base: 'main', head: 'feat', draft: true }))
      .toMatchObject({ number: 7, state: 'draft' })
    const [, args, input] = vi.mocked(runHostedCli).mock.calls[0]
    expect(args).toContain('--input')
    expect(args).not.toContain(text)
    expect(JSON.parse(input!)).toEqual({
      title: 'Draft: New', description: text, source_branch: 'feat', target_branch: 'main', remove_source_branch: true,
    })
    vi.mocked(runHostedCli).mockResolvedValueOnce('{}')
    await expect(provider.postComment(cwd, 7, text)).resolves.toEqual({ posted: true })
    expect(JSON.parse(vi.mocked(runHostedCli).mock.calls[1][2]!)).toEqual({ body: text })
  })

  it('reads MR comments and verifies merge outcomes', async () => {
    vi.mocked(runHostedCli).mockResolvedValueOnce(JSON.stringify([{ id: 1, body: 'ack', author: { username: 'reviewer' } }]))
    expect(await provider.listComments(cwd, 7)).toMatchObject([{ id: 'gl-1', body: 'ack' }])
    vi.mocked(runHostedCli).mockResolvedValueOnce(JSON.stringify({ state: 'merged' }))
    await expect(provider.mergeReview(cwd, 7)).resolves.toEqual({ merged: true })
    expect(JSON.parse(vi.mocked(runHostedCli).mock.calls[1][2]!)).toEqual({ squash: true })
    vi.mocked(runHostedCli).mockResolvedValueOnce(JSON.stringify({ state: 'opened' }))
    await expect(provider.mergeReview(cwd, 7)).rejects.toThrow('尚未确认')
    await expect(provider.mergeReview(cwd, 7, 'rebase')).rejects.toThrow('rebase')
  })

  it('sets auto_merge and checks cancellation status instead of trusting HTTP success', async () => {
    vi.mocked(runHostedCli).mockResolvedValueOnce(JSON.stringify({ merge_when_pipeline_succeeds: true }))
    await expect(provider.setAutoMerge(cwd, 7, true)).resolves.toEqual({ autoMerge: true })
    expect(JSON.parse(vi.mocked(runHostedCli).mock.calls[0][2]!)).toEqual({ auto_merge: true, squash: true })
    vi.mocked(runHostedCli).mockResolvedValueOnce(JSON.stringify({ status: 'success' }))
    await expect(provider.setAutoMerge(cwd, 7, false)).resolves.toEqual({ autoMerge: false })
    expect(vi.mocked(runHostedCli).mock.calls[1][1][1]).toMatch(/\/cancel_merge_when_pipeline_succeeds$/)
    vi.mocked(runHostedCli).mockResolvedValueOnce(JSON.stringify({ status: 'error' }))
    await expect(provider.setAutoMerge(cwd, 7, false)).rejects.toThrow('取消')
  })

  it('rejects invalid writes before running the CLI', async () => {
    await expect(provider.postComment(cwd, 7, '  ')).rejects.toThrow('不能为空')
    await expect(provider.mergeReview(cwd, -1)).rejects.toThrow('编号')
    await expect(provider.listComments(cwd, 1.5)).rejects.toThrow('编号')
    expect(runHostedCli).not.toHaveBeenCalled()
  })
})
