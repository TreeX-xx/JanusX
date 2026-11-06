import { execFile } from 'node:child_process'
import { lstat, realpath, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import type { SuperAgentCheckout } from '../../shared/superagent-environment'

/** Avoid inherited GIT_DIR/GIT_WORK_TREE and optional status locks changing the inspected target. */
function gitEnvironment(): NodeJS.ProcessEnv {
  return { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('GIT_'))),
    GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' }
}

export const pathKey = (path: string): string => process.platform === 'win32' ? resolve(path).toLowerCase() : resolve(path)
export const sameLocation = (a: string, b: string): boolean => pathKey(a) === pathKey(b)
export function overlaps(a: string, b: string): boolean {
  const left = pathKey(a), right = pathKey(b)
  const separator = process.platform === 'win32' ? '\\' : '/'
  return left === right || left.startsWith(`${right}${separator}`) || right.startsWith(`${left}${separator}`)
}

/** Local only. Command arguments are never interpolated into a shell. */
export async function controlledGit(cwd: string, args: string[], options: { input?: Buffer; indexFile?: string } = {}): Promise<string> {
  const env = { ...gitEnvironment(), ...(options.indexFile ? { GIT_INDEX_FILE: options.indexFile } : {}) }
  // Even `status` may run repository clean/process filters. Host-controlled Git must not execute them.
  const filters = await new Promise<string[]>((resolve, reject) => {
    execFile('git', ['-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null', 'config', '--null', '--name-only', '--get-regexp', '^filter\\..*\\.(clean|smudge|process|required)$'],
      { cwd, env, windowsHide: true, timeout: 15000, maxBuffer: 1024 * 1024, encoding: 'utf8' }, (error, stdout) => {
        if (error && error.code !== 1) { reject(error); return }
        resolve(stdout.split('\0').filter(Boolean).flatMap(key => ['-c', `${key}=${key.endsWith('.required') ? 'false' : ''}`]))
      })
  })
  return new Promise((resolve, reject) => {
    const child = execFile('git', ['-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null',
      '-c', 'commit.gpgsign=false', '-c', 'submodule.recurse=false', ...filters, ...args], {
      cwd, env,
      windowsHide: true, timeout: 15000, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8',
    }, (error, stdout) => error ? reject(error) : resolve(stdout))
    child.stdin?.on('error', () => { /* execFile's completion reports command failure */ })
    child.stdin?.end(options.input)
  })
}

export async function canonicalDirectory(path: string): Promise<string> {
  if (!isAbsolute(path) || /[\x00-\x1f]/.test(path)) throw new Error('A local absolute directory is required')
  const canonical = await realpath(path)
  if (!(await stat(canonical)).isDirectory()) throw new Error('Directory is unavailable')
  return canonical
}

async function fileIdentity(path: string): Promise<string> {
  const value = await stat(path)
  return createHash('sha256').update(`${value.dev}:${value.ino}:${value.birthtimeMs}`).digest('hex')
}

export async function absentTarget(path: string): Promise<string> {
  if (!isAbsolute(path) || /[\x00-\x1f]/.test(path)) throw new Error('A local absolute target is required')
  const parent = await canonicalDirectory(dirname(path))
  const target = join(parent, basename(path))
  try { await lstat(target) } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return target
    throw error
  }
  throw new Error('Worktree target already exists; a new proposal is required')
}

export async function inspectCheckout(path: string): Promise<SuperAgentCheckout> {
  const canonical = await canonicalDirectory(path)
  const top = await canonicalDirectory((await controlledGit(canonical, ['rev-parse', '--show-toplevel'])).trim())
  if (!sameLocation(canonical, top)) throw new Error('Select the registered checkout root, not a subdirectory')
  const [commonRaw, gitRaw, branchRaw, headRaw, status, listing, ignored] = await Promise.all([
    controlledGit(top, ['rev-parse', '--path-format=absolute', '--git-common-dir']),
    controlledGit(top, ['rev-parse', '--absolute-git-dir']),
    controlledGit(top, ['symbolic-ref', '--quiet', '--short', 'HEAD']),
    controlledGit(top, ['rev-parse', '--verify', 'HEAD^{commit}']),
    controlledGit(top, ['status', '--porcelain=v1', '-z', '--untracked-files=all']),
    controlledGit(top, ['worktree', 'list', '--porcelain', '-z']),
    controlledGit(top, ['ls-files', '--others', '--ignored', '--exclude-standard', '--directory', '-z']),
  ])
  const commonDir = await canonicalDirectory(commonRaw.trim()), gitDir = await canonicalDirectory(gitRaw.trim())
  const entries = listing.split('\0\0').filter(Boolean).map(block => block.split('\0'))
  const registered = entries.find(fields => fields.some(field => field.startsWith('worktree ') && sameLocation(field.slice(9), top)))
  if (!registered || registered.includes('bare') || registered.includes('detached')) throw new Error('Checkout must be registered and on a named branch')
  // Nested checkouts would give a worker write access to another checkout through its parent.
  for (const fields of entries) {
    const other = fields.find(field => field.startsWith('worktree '))?.slice(9)
    if (other && !sameLocation(other, top) && overlaps(other, top)) throw new Error('Nested worktrees cannot be assigned to a worker')
  }
  const inProgress = await Promise.all(['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply'].map(async name => {
    try { await lstat(join(gitDir, name)); return true } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
      throw error
    }
  }))
  return { path: top, commonDir, gitDir, repositoryIdentity: await fileIdentity(commonDir), directoryIdentity: await fileIdentity(top),
    branch: branchRaw.trim(), head: headRaw.trim(), dirty: status.length > 0, ignoredEntries: ignored.split('\0').filter(Boolean).sort(),
    locked: registered.some(field => field === 'locked' || field.startsWith('locked ')), isMain: sameLocation(commonDir, gitDir),
    operationInProgress: inProgress.some(Boolean) }
}

export async function resolveCommit(root: string, ref: string): Promise<string> {
  if (!ref || ref.startsWith('-') || /[\x00-\x20]/.test(ref)) throw new Error('Invalid base reference')
  return (await controlledGit(root, ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`])).trim()
}

export async function validateNewBranch(root: string, branch: string): Promise<void> {
  if (branch.startsWith('-') || /[\x00-\x20]/.test(branch)) throw new Error('Invalid branch name')
  await controlledGit(root, ['check-ref-format', `refs/heads/${branch}`])
  const branches = await controlledGit(root, ['for-each-ref', '--format=%(refname)', 'refs/heads/'])
  if (branches.split('\n').includes(`refs/heads/${branch}`)) throw new Error('Branch already exists; select reuse or another branch')
}

export async function createControlledWorktree(root: string, path: string, branch: string, baseCommit: string): Promise<SuperAgentCheckout> {
  const source = await inspectCheckout(root)
  const target = await absentTarget(path)
  if (overlaps(source.path, target) || overlaps(source.commonDir, target)) throw new Error('Worktree must be outside the source checkout and Git metadata')
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(baseCommit)) throw new Error('Creation requires a pinned commit')
  await validateNewBranch(root, branch)
  await controlledGit(root, ['worktree', 'add', '-b', branch, target, baseCommit])
  return inspectCheckout(target)
}

export async function removeControlledWorktree(root: string, path: string) {
  const source = await inspectCheckout(root), target = await inspectCheckout(path)
  if (source.repositoryIdentity !== target.repositoryIdentity || target.isMain || sameLocation(source.path, target.path)) throw new Error('Only a linked worktree of this repository can be removed')
  if (target.dirty || target.locked || target.operationInProgress) throw new Error('Worktree has changes, is locked, or has an unfinished Git operation')
  await controlledGit(source.path, ['worktree', 'remove', '--', target.path])
  return { path: target.path, branch: target.branch, branchDeleted: false, branchKept: target.branch }
}

export async function mergeControlledWorktree(source: SuperAgentCheckout, target: SuperAgentCheckout) {
  if (source.repositoryIdentity !== target.repositoryIdentity || sameLocation(source.path, target.path) || source.branch === target.branch) {
    throw new Error('Merge requires distinct branches of the same repository')
  }
  if (source.dirty || target.dirty || source.locked || target.locked || source.operationInProgress || target.operationInProgress) {
    throw new Error('Resolve pending changes or Git operations before merging')
  }
  // Pin the reviewed source commit; a moving branch name cannot change merge contents.
  await controlledGit(target.path, ['merge', '--no-ff', '--no-edit', source.head, '-m', `Merge ${source.branch}`])
}
