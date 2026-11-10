import { beforeEach, expect, it, vi } from 'vitest'
import { repositoryImage } from '../../src/main/hosted/repository'
import { resolveRepositoryImage } from '../../src/renderer/src/lib/repository-image'
import { runHostedCli } from '../../src/main/hosted/cli'
import { gitRemoteUrl } from '../../src/main/git/worktrees'
vi.mock('../../src/main/hosted/cli', () => ({ runHostedCli: vi.fn() }))
vi.mock('../../src/main/git/worktrees', async original => ({ ...await original<object>(), gitRemoteUrl: vi.fn() }))
const target = { workspacePath: 'runtime://ssh/app', repositoryKey: 'github:team/app' }
const file = { size: 4, encoding: 'base64', content: Buffer.from([0, 128, 255, 42]).toString('base64') }
beforeEach(() => { vi.clearAllMocks(); vi.mocked(gitRemoteUrl).mockResolvedValue('https://github.com/team/app.git'); vi.mocked(runHostedCli).mockResolvedValue(JSON.stringify(file)) })

it.each(['github', 'gitlab'])('reads private %s image bytes via the CLI and encodes paths and revision', async provider => {
  vi.mocked(gitRemoteUrl).mockResolvedValue('https://' + provider + '.com/team/app.git')
  expect(await repositoryImage({ ...target, repositoryKey: provider + ':team/app' }, 'docs/a b.png', 'release/next')).toBe('data:image/png;base64,' + file.content)
  expect(vi.mocked(runHostedCli).mock.calls[0][0]).toBe(provider)
  expect(vi.mocked(runHostedCli).mock.calls[0][1][1]).toBe(provider === 'github' ? 'repos/team/app/contents/docs/a%20b.png?ref=release%2Fnext' : 'projects/team%2Fapp/repository/files/docs%2Fa%20b.png?ref=release%2Fnext')
})
it('uses the GitHub blob endpoint for a bounded image larger than 1 MiB', async () => {
  vi.mocked(runHostedCli).mockResolvedValueOnce(JSON.stringify({ size: 2000000, encoding: 'none', sha: 'a'.repeat(40) })).mockResolvedValueOnce(JSON.stringify(file))
  await repositoryImage(target, 'screen.png', 'main')
  expect(vi.mocked(runHostedCli).mock.calls[0][1]).toContain('Accept: application/vnd.github.object+json')
  expect(vi.mocked(runHostedCli).mock.calls[1][1][1]).toBe('repos/team/app/git/blobs/' + 'a'.repeat(40))
})
it.each(['../private.png', '/etc/a.png', 'docs/../a.png', 'https://evil.test/a.png', 'a.html', 'a\\b.png'])('rejects invalid image paths before network access: %s', async path => {
  await expect(repositoryImage(target, path, 'main')).rejects.toThrow()
  expect(runHostedCli).not.toHaveBeenCalled()
})
it('rejects oversized images, stale repository identity and authentication failures', async () => {
  vi.mocked(runHostedCli).mockResolvedValueOnce(JSON.stringify({ size: 5 * 1024 * 1024 }))
  await expect(repositoryImage(target, 'a.png', 'main')).rejects.toThrow('4 MiB')
  vi.mocked(runHostedCli).mockClear()
  await expect(repositoryImage({ ...target, repositoryKey: 'github:other/repo' }, 'a.png', 'main')).rejects.toThrow('Repository changed')
  expect(runHostedCli).not.toHaveBeenCalled()
  vi.mocked(runHostedCli).mockRejectedValueOnce(new Error('HTTP 401'))
  await expect(repositoryImage(target, 'a.png', 'main')).rejects.toThrow('401')
})
it.each(['../images/screen.png', '/images/screen.png', 'https://github.com/team/app/blob/release%2Fnext/images/screen.png', 'https://raw.githubusercontent.com/team/app/release/next/images/screen.png'])('resolves repository images: %s', src => {
  expect(resolveRepositoryImage(src, 'https://github.com/team/app/blob/release%2Fnext/docs/README.md', target.repositoryKey, 'release/next')).toMatchObject({ path: 'images/screen.png' })
})
it('resolves GitLab subgroups and leaves external images unauthenticated', () => {
  expect(resolveRepositoryImage('img/a.svg', 'https://gitlab.com/group/sub/app/-/blob/main/README.md', 'gitlab:group/sub/app', 'main')).toMatchObject({ path: 'img/a.svg' })
  expect(resolveRepositoryImage('https://badge.example/a.svg', 'https://github.com/team/app/blob/main/README.md', target.repositoryKey, 'main')).toEqual({ url: 'https://badge.example/a.svg' })
  expect(resolveRepositoryImage('file:///secret.png', 'https://github.com/team/app/blob/main/README.md', target.repositoryKey, 'main')).toBeNull()
  expect(resolveRepositoryImage('javascript:alert(1)', 'https://github.com/team/app/blob/main/README.md', target.repositoryKey, 'main')).toBeNull()
})
