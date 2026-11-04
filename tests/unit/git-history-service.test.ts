import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getChangeDiff, getCommitChanges, getCommitFileDiff, getHistory, getStatus } from '../../src/main/git/service'
const exec = promisify(execFile)
let cwd = ''
async function git(...args: string[]) { return (await exec('git', args, { cwd })).stdout.trim() }
async function commit(name: string, text: string) {
  await writeFile(join(cwd, name), text)
  await git('add', '--', name)
  await git('commit', '-m', text)
  return git('rev-parse', 'HEAD')
}
beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'janusx-git-history-'))
  await git('init', '-b', 'main')
  await git('config', 'user.name', 'Test | 中文')
  await git('config', 'user.email', 'test@example.test')
})
afterEach(async () => {
  // mkdtemp returns this test's absolute directory, never a computed workspace path.
  await rm(cwd, { recursive: true, force: true })
})
describe('real Git history and diffs', () => {
  it('pages a real merge graph with true parents, peeled tags and remote refs', async () => {
    const root = await commit('base.txt', 'root | 初始')
    await git('checkout', '-b', 'feature/ui')
    const topic = await commit('topic.txt', 'topic | 中文\n\nDetailed description\n第二行')
    await git('tag', '-a', 'v1', '-m', 'tag')
    await git('update-ref', 'refs/remotes/origin/feature/ui', topic)
    await git('checkout', 'main')
    const main = await commit('main.txt', 'main change')
    await git('merge', '--no-ff', 'feature/ui', '-m', 'merge')
    const first = await getHistory(cwd, { scope: 'all', limit: 2 })
    expect(first.commits[0].parents).toEqual([main, topic])
    expect(first.commits[0].refs).toEqual(expect.arrayContaining([{ kind: 'head', name: 'HEAD' }, { kind: 'local', name: 'main' }]))
    const second = await getHistory(cwd, { scope: 'all', limit: 2, cursor: first.cursor! })
    expect(second.cursor).toBeNull()
    const all = [...first.commits, ...second.commits]
    expect(new Set(all.map(item => item.hash)).size).toBe(4)
    expect(all.at(-1)?.hash).toBe(root)
    const feature = all.find(item => item.hash === topic)!
    expect(feature).toMatchObject({ message: 'topic | 中文', author: 'Test | 中文', body: 'Detailed description\n第二行' })
    expect(feature.refs).toEqual(expect.arrayContaining([{ kind: 'tag', name: 'v1' }, { kind: 'remote', name: 'origin/feature/ui' }]))
    const changes = await getCommitChanges(cwd, first.commits[0].hash)
    expect(changes).toEqual([expect.objectContaining({ path: 'topic.txt', status: 'A' })])
    expect((await getCommitFileDiff(cwd, first.commits[0].hash, 'topic.txt')).content).toContain('+topic | 中文')
  }, 30000)
  it('separates all branches from HEAD ancestry, including an unborn checkout', async () => {
    await commit('base.txt', 'root')
    await git('checkout', '-b', 'unmerged')
    const topic = await commit('topic.txt', 'unmerged')
    await git('checkout', 'main')
    expect((await getHistory(cwd, { scope: 'current' })).commits.some(item => item.hash === topic)).toBe(false)
    const all = await getHistory(cwd, { scope: 'all' })
    expect(all.commits.some(item => item.hash === topic)).toBe(true)
    await writeFile(join(cwd, 'base.txt'), 'stash only')
    await git('stash', 'push', '-m', 'not a branch')
    const afterStash = await getHistory(cwd, { scope: 'all' })
    expect(afterStash.snapshot).toBe(all.snapshot)
    expect(afterStash.commits).toHaveLength(2)
    await git('checkout', '--orphan', 'new-root')
    expect((await getHistory(cwd, { scope: 'current' })).commits).toEqual([])
    expect((await getHistory(cwd, { scope: 'all' })).commits).toHaveLength(2)
  }, 30000)
  it('rejects a stale cursor instead of skipping or duplicating commits after a new commit', async () => {
    await commit('one.txt', 'one')
    await commit('two.txt', 'two')
    const page = await getHistory(cwd, { scope: 'all', limit: 1 })
    await commit('three.txt', 'three')
    await expect(getHistory(cwd, { scope: 'all', limit: 1, cursor: page.cursor! })).rejects.toThrow('history changed')
    expect((await getHistory(cwd, { scope: 'all' })).commits).toHaveLength(3)
  }, 30000)
  it('returns the correct staged, unstaged, deleted and untracked patches', async () => {
    await commit('tracked.txt', 'baseline\n')
    await writeFile(join(cwd, 'tracked.txt'), 'staged\n')
    await git('add', 'tracked.txt')
    await writeFile(join(cwd, 'tracked.txt'), 'working\n')
    expect((await getChangeDiff(cwd, 'tracked.txt', true)).content).toContain('+staged')
    expect((await getChangeDiff(cwd, 'tracked.txt', false)).content).toContain('-staged\n+working')
    await writeFile(join(cwd, 'new.txt'), 'untracked\n')
    expect((await getChangeDiff(cwd, 'new.txt', false)).content).toContain('+untracked')
    await rm(join(cwd, 'tracked.txt'))
    expect((await getChangeDiff(cwd, 'tracked.txt', false)).content).toContain('-staged')
    await expect(getChangeDiff(cwd, '../outside', false)).rejects.toThrow('Invalid Git file path')
    await writeFile(join(cwd, 'large.txt'), 'line\n'.repeat(60000))
    const large = await getChangeDiff(cwd, 'large.txt', false)
    expect(large.truncated).toBe(true)
    expect(Buffer.byteLength(large.content)).toBeLessThanOrEqual(256 * 1024)
  }, 30000)
  it('keeps rename paths and distinguishes additions from modified files', async () => {
    await commit('原始.txt', 'first\n')
    await git('mv', '原始.txt', '新的文件.txt')
    await git('commit', '-m', 'rename')
    expect(await getCommitChanges(cwd, await git('rev-parse', 'HEAD'))).toEqual([{ path: '新的文件.txt', status: 'R', additions: 0, deletions: 0 }])
    const rename = await getCommitFileDiff(cwd, await git('rev-parse', 'HEAD'), '新的文件.txt')
    expect(rename.content).toContain('similarity index 100%')
    expect(rename.content).not.toContain('+first')
    await commit('新的文件.txt', 'first\nextra\n')
    expect(await getCommitChanges(cwd, await git('rev-parse', 'HEAD'))).toEqual([expect.objectContaining({ status: 'M', additions: 1, deletions: 0 })])
  }, 30000)
  it('previews only the selected historical file, including roots, deletions, binaries and bounds', async () => {
    const root = await commit('[literal].txt', 'root content\n')
    expect((await getCommitFileDiff(cwd, root, '[literal].txt')).content).toContain('+root content')
    const other = await commit('unrelated.txt', 'other content\n')
    expect((await getCommitFileDiff(cwd, other, '[literal].txt')).content).toBe('')
    await git('rm', '[literal].txt')
    await git('commit', '-m', 'delete')
    expect((await getCommitFileDiff(cwd, await git('rev-parse', 'HEAD'), '[literal].txt')).content).toContain('-root content')
    await writeFile(join(cwd, 'image.bin'), Buffer.from([0, 1, 2]))
    await writeFile(join(cwd, 'large.txt'), 'line\n'.repeat(60000))
    await git('add', '.')
    await git('commit', '-m', 'binary and large')
    const hash = await git('rev-parse', 'HEAD')
    expect((await getCommitFileDiff(cwd, hash, 'image.bin')).content).toContain('Binary files')
    const large = await getCommitFileDiff(cwd, hash, 'large.txt')
    expect(large.truncated).toBe(true)
    expect(Buffer.byteLength(large.content)).toBeLessThanOrEqual(256 * 1024)
    await expect(getCommitFileDiff(cwd, '--all', 'large.txt')).rejects.toThrow('Invalid commit hash')
    await expect(getCommitFileDiff(cwd, hash, '../outside')).rejects.toThrow('Invalid Git file path')
  }, 30000)
  it('separates index and worktree counts before the first commit', async () => {
    await writeFile(join(cwd, 'new.txt'), 'staged\n')
    await git('add', 'new.txt')
    await writeFile(join(cwd, 'new.txt'), 'staged\nworking\n')
    expect((await getStatus(cwd)).changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'new.txt', staged: true, additions: 1, deletions: 0 }),
      expect.objectContaining({ path: 'new.txt', staged: false, additions: 1, deletions: 0 }),
    ]))
  })
  it('returns empty history in a new repository and validates page bounds', async () => {
    expect((await getHistory(cwd, { scope: 'all' })).commits).toEqual([])
    await expect(getHistory(cwd, { scope: 'all', limit: Number.NaN })).rejects.toThrow('Invalid history page')
    await expect(getHistory(cwd, { scope: 'all', cursor: { offset: -1, snapshot: '' } })).rejects.toThrow('Invalid history page')
  })
})
