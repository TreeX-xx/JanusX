import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, open, readFile, realpath, rename, unlink } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative } from 'node:path'
import { createTwoFilesPatch } from 'diff'
import type { SuperAgentCheckout } from '../../shared/superagent-environment'
import { controlledGit, inspectCheckout, sameLocation } from './controlled-worktree'

interface CommitFile { path: string; mode: '100644' | '100755' | '0'; bytes: Buffer; hash: string }
export interface ControlledCommitPlan { head: string; branch: string; indexHash: string; files: CommitFile[] }
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')

async function captureFile(checkout: SuperAgentCheckout, path: string): Promise<CommitFile> {
  if (!path || isAbsolute(path) || /[\x00-\x1f\\:]/.test(path) || path.split('/').some(part => !part || part === '.' || part === '..')
    || ['.git', '.agents', '.codex', '.aws'].includes(path.split('/')[0].toLowerCase())) throw new Error('Commit requires explicit relative code file paths')
  const file = join(checkout.path, path)
  const parent = await realpath(dirname(file))
  const rel = relative(checkout.path, parent)
  if (isAbsolute(rel) || rel === '..' || rel.startsWith('../') || rel.startsWith('..\\')) throw new Error('Commit path escapes the assigned checkout')
  try {
    const info = await lstat(file)
    if (!info.isFile() || info.isSymbolicLink() || info.size > 8 * 1024 * 1024) throw new Error('Commit accepts regular files up to 8 MiB each')
    if (!sameLocation(await realpath(file), file)) throw new Error('Commit path aliases another location')
    const bytes = await readFile(file)
    const tracked = process.platform === 'win32' ? await controlledGit(checkout.path, ['--literal-pathspecs', 'ls-tree', 'HEAD', '--', path]) : ''
    return { path, mode: process.platform === 'win32' ? tracked.startsWith('100755 ') ? '100755' : '100644' : info.mode & 0o111 ? '100755' : '100644', bytes, hash: digest(bytes) }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    const tracked = await controlledGit(checkout.path, ['--literal-pathspecs', 'ls-tree', 'HEAD', '--', path])
    if (!tracked || !/^(100644|100755) blob /.test(tracked)) throw new Error('Deleted commit path must be a tracked regular file')
    return { path, mode: '0', bytes: Buffer.alloc(0), hash: 'deleted' }
  }
}

export async function previewControlledCommit(checkout: SuperAgentCheckout, plan: ControlledCommitPlan) {
  return Promise.all(plan.files.map(async file => {
    const tracked = await controlledGit(checkout.path, ['--literal-pathspecs', 'ls-tree', plan.head, '--', file.path])
    const before = tracked ? await controlledGit(checkout.path, ['show', `${plan.head}:${file.path}`]) : ''
    const after = file.bytes.toString('utf8')
    const patch = before.includes('\0') || after.includes('\0') ? 'Binary content; review the file in the checkout.'
      : createTwoFilesPatch(`a/${file.path}`, `b/${file.path}`, before, after, '', '', { context: 3 })
    return { path: file.path, sha256: file.hash, bytes: file.bytes.length, patch: patch.slice(0, 24_000), truncated: patch.length > 24_000 }
  }))
}

export async function prepareControlledCommit(checkout: SuperAgentCheckout, paths: string[]): Promise<ControlledCommitPlan> {
  if (!paths.length || paths.length > 100 || new Set(paths).size !== paths.length) throw new Error('Select 1–100 distinct files for a commit')
  if ((await controlledGit(checkout.path, ['diff', '--cached', '--name-only'])).trim()) throw new Error('Existing staged changes must be resolved before a managed commit')
  const files = await Promise.all(paths.map(path => captureFile(checkout, path)))
  if (files.reduce((sum, file) => sum + file.bytes.length, 0) > 16 * 1024 * 1024) throw new Error('Managed commit content exceeds 16 MiB')
  const index = await readFile(join(checkout.gitDir, 'index'))
  return { head: checkout.head, branch: checkout.branch, indexHash: digest(index), files }
}

/** Commit exactly the approved bytes through a private index; never execute clean filters or touch work files. */
export async function executeControlledCommit(checkout: SuperAgentCheckout, plan: ControlledCommitPlan, message: string, scratchDirectory: string): Promise<string> {
  const actual = await inspectCheckout(checkout.path)
  if (actual.head !== plan.head || actual.branch !== plan.branch || actual.directoryIdentity !== checkout.directoryIdentity || actual.gitDir !== checkout.gitDir) throw new Error('Commit environment changed')
  for (const file of plan.files) {
    const current = await captureFile(checkout, file.path)
    if (current.hash !== file.hash || current.mode !== file.mode) throw new Error(`Commit file changed after review: ${file.path}`)
  }
  await mkdir(scratchDirectory, { recursive: true })
  const temporary = join(scratchDirectory, `${randomUUID()}.index`)
  const lockPath = join(checkout.gitDir, 'index.lock')
  const lock = await open(lockPath, 'wx')
  let lockExists = true
  let branchUpdateStarted = false
  try {
    if (digest(await readFile(join(checkout.gitDir, 'index'))) !== plan.indexHash) throw new Error('Staged state changed after review')
    await controlledGit(checkout.path, ['read-tree', plan.head], { indexFile: temporary })
    for (const file of plan.files) {
      const hash = file.mode === '0' ? '0'.repeat(plan.head.length) : (await controlledGit(checkout.path, ['hash-object', '-w', '--no-filters', '--stdin'], { input: file.bytes })).trim()
      await controlledGit(checkout.path, ['update-index', '-z', '--index-info'], { indexFile: temporary, input: Buffer.from(`${file.mode} ${hash}\t${file.path}\0`) })
    }
    const tree = (await controlledGit(checkout.path, ['write-tree'], { indexFile: temporary })).trim()
    const originalTree = (await controlledGit(checkout.path, ['rev-parse', `${plan.head}^{tree}`])).trim()
    if (tree === originalTree) throw new Error('Reviewed files contain no changes to commit')
    const commit = (await controlledGit(checkout.path, ['commit-tree', tree, '-p', plan.head], { input: Buffer.from(message + '\n') })).trim()
    // Check identities again before changing the branch, then use Git's expected-old-value guard.
    const latest = await inspectCheckout(checkout.path)
    if (latest.head !== plan.head || latest.branch !== plan.branch || latest.directoryIdentity !== checkout.directoryIdentity) throw new Error('Commit target changed during preparation')
    await lock.writeFile(await readFile(temporary)); await lock.sync(); await lock.close()
    branchUpdateStarted = true
    await controlledGit(checkout.path, ['update-ref', `refs/heads/${plan.branch}`, commit, plan.head])
    // An index replacement failure after update-ref is uncertain and must never trigger an automatic retry.
    await rename(lockPath, join(checkout.gitDir, 'index')); lockExists = false
    return commit
  } finally {
    await lock.close().catch(() => undefined)
    if (lockExists && !branchUpdateStarted) await unlink(lockPath).catch(() => undefined)
    await unlink(temporary).catch(() => undefined)
  }
}
