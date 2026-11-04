import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getFileBaseline, getStatus, push, stage } from '../../src/main/git/service'

const execFileAsync = promisify(execFile)

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd })
  return stdout.trim()
}

describe('Git service push', () => {
  let root = ''
  let repository = ''
  let remote = ''

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'janusx-git-service-'))
    repository = join(root, 'repository')
    remote = join(root, 'remote.git')

    await execFileAsync('git', ['init', '--bare', remote])
    await execFileAsync('git', ['init', '-b', 'main', repository])
    await git(repository, 'config', 'user.name', 'JanusX Test')
    await git(repository, 'config', 'user.email', 'janusx@example.test')
    await writeFile(join(repository, 'README.md'), '# test\n')
    await git(repository, 'add', 'README.md')
    await git(repository, 'commit', '-m', 'initial commit')
    await git(repository, 'remote', 'add', 'origin', remote)
  })

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true })
  })

  it('sets the upstream automatically on the first push', async () => {
    await push(repository)

    await expect(git(repository, 'rev-parse', '--abbrev-ref', '@{upstream}')).resolves.toBe('origin/main')
    await expect(git(remote, 'rev-parse', '--verify', 'refs/heads/main')).resolves.toMatch(/^[0-9a-f]{40}$/)
  })

  it('reports a clear error when no remote is configured', async () => {
    await git(repository, 'remote', 'remove', 'origin')

    await expect(push(repository)).rejects.toThrow('No Git remote is configured')
  })

  it('reports independent staged, unstaged and untracked line counts', async () => {
    await writeFile(join(repository, 'README.md'), '# staged\n')
    await git(repository, 'add', 'README.md')
    await writeFile(join(repository, 'README.md'), '# working\nextra\n')
    await writeFile(join(repository, 'new-file.txt'), 'one\ntwo\n')

    const status = await getStatus(repository)
    const readmeChanges = status.changes.filter((change) => change.path === 'README.md')
    const newFile = status.changes.find((change) => change.path === 'new-file.txt')

    expect(readmeChanges).toHaveLength(2)
    expect(readmeChanges).toEqual(expect.arrayContaining([
      expect.objectContaining({ staged: true, additions: 1, deletions: 1 }),
      expect.objectContaining({ staged: false, additions: 2, deletions: 1 }),
    ]))
    expect(newFile).toMatchObject({ status: '??', additions: 2, deletions: 0 })
  })

  it('uses a binary fallback when an untracked file has no line statistics', async () => {
    await writeFile(join(repository, 'image.bin'), Buffer.from([0, 1, 2, 3]))

    const status = await getStatus(repository)

    expect(status.changes.find((change) => change.path === 'image.bin')).toMatchObject({
      status: '??',
      additions: null,
      deletions: null,
    })
  })

  it('keeps the destination path and zero-line statistic for a pure rename', async () => {
    await git(repository, 'mv', 'README.md', 'GUIDE.md')

    const status = await getStatus(repository)

    expect(status.changes).toContainEqual(expect.objectContaining({
      path: 'GUIDE.md',
      status: 'R',
      additions: 0,
      deletions: 0,
    }))
  })

  it('returns the HEAD baseline and an empty baseline for untracked files', async () => {
    await writeFile(join(repository, 'README.md'), '# working\n')
    await writeFile(join(repository, 'new-file.txt'), 'new\n')

    await expect(getFileBaseline(repository, 'README.md')).resolves.toEqual({
      content: '# test\n',
      tracked: true,
      available: true,
    })
    await expect(getFileBaseline(repository, 'new-file.txt')).resolves.toEqual({
      content: '',
      tracked: false,
      available: true,
    })
  })

  it('rejects baseline paths outside the workspace', async () => {
    await expect(getFileBaseline(repository, '..\\outside.txt')).rejects.toThrow('outside the workspace')
  })

  it('reports that diff baselines are unavailable outside a Git repository', async () => {
    await expect(getFileBaseline(root, 'plain.txt')).resolves.toEqual({
      content: '',
      tracked: false,
      available: false,
    })
  })

  it('returns a structured placeholder status when the workspace is not a Git repository', async () => {
    await expect(getStatus(root)).resolves.toEqual({
      isRepo: false,
      branch: { name: '', upstream: null, ahead: 0, behind: 0 },
      changes: [],
      clean: true,
    })
  })

  it('replaces git fatal output with a stable message outside a Git repository', async () => {
    await expect(stage(root, ['README.md'])).rejects.toThrow('This folder is not a Git repository yet')
  })
})
