// Note: offline worktree discovery plus login-free repo avatars — see
// .agents/notes/sessions/worktrees/worktree-sidebar-scoping.md
// Note: background creation, scoped deletion, and branch review — see
// .agents/notes/sessions/worktrees/worktree-create-delete.md
// Note: creation metadata plus local Ship diff/merge/abort — see
// .agents/notes/sessions/worktrees/worktree-create-delete.md
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { access, copyFile, lstat, mkdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve, posix } from 'node:path'
import { promisify } from 'node:util'
import type { RepoIdentity, WorktreeInfo } from '../../shared/ipc/worktree'
import { worktreeMetaStore } from './worktree-meta'
import { parseRuntimeResource, runtimeResource } from '../../shared/workspace-runtime'
import { resolveRuntimeResource, runtimeRequest } from '../workspace/runtime'
import { runWorkspaceProcess } from '../workspace/runtime-process'

const commandRoot = (value: string) => parseRuntimeResource(value) ? value : resolve(value)
const remoteCreations = new Map<string, { workspacePath: string; operationId: string }>()

const execFileAsync = promisify(execFile)
const LOCAL_GIT_TIMEOUT_MS = 10000
const AVATAR_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000

export interface ParsedRemote {
  host: string
  owner: string
  repo: string
}

/**
 * Parse https, ssh, and scp-like remote URLs into host/owner/repo.
 * Returns null for unparseable values instead of throwing.
 */
export function parseGitRemote(url: string): ParsedRemote | null {
  const trimmed = url.trim().replace(/\/+$/, '')
  if (!trimmed) return null
  const withoutGit = trimmed.endsWith('.git') ? trimmed.slice(0, -4) : trimmed
  const patterns = [
    /^https?:\/\/([^/:]+)(?::\d+)?\/(.+)\/([^/]+)$/,
    /^ssh:\/\/[^@]*@([^/:]+)(?::\d+)?\/(.+)\/([^/]+)$/,
    /^[^@/:]+@([^:]+):(.+)\/([^/]+)$/,
  ]
  for (const pattern of patterns) {
    const match = pattern.exec(withoutGit)
    if (match) return { host: match[1].toLowerCase(), owner: match[2], repo: match[3] }
  }
  return null
}

export interface ParsedWorktree {
  path: string
  branch: string | null
  detached: boolean
  bare: boolean
  locked: boolean
  prunable: boolean
}

/** Parse `git worktree list --porcelain` output without throwing. */
export function parseWorktreeList(output: string): ParsedWorktree[] {
  const entries: ParsedWorktree[] = []
  let current: ParsedWorktree | null = null
  const flush = () => {
    if (current) entries.push(current)
    current = null
  }
  for (const line of output.split('\n')) {
    if (line.startsWith('worktree ')) {
      flush()
      current = { path: line.slice(9).trim(), branch: null, detached: false, bare: false, locked: false, prunable: false }
    } else if (!current) {
      continue
    } else if (line.startsWith('branch ')) {
      const ref = line.slice(7).trim()
      current.branch = ref.startsWith('refs/heads/') ? ref.slice(11) : ref
    } else if (line === 'detached') {
      current.detached = true
    } else if (line === 'bare') {
      current.bare = true
    } else if (line === 'locked') {
      current.locked = true
    } else if (line === 'prunable') {
      current.prunable = true
    }
  }
  flush()
  return entries
}

async function runGit(cwd: string, args: string[]): Promise<string | null> {
  try {
    if (parseRuntimeResource(cwd)) {
      const result = await runWorkspaceProcess(cwd, ['git', ...args], { timeout: LOCAL_GIT_TIMEOUT_MS, maxBytes: 8 * 1024 * 1024 })
      return result.exitCode === 0 ? result.stdout : null
    }
    const { stdout } = await execFileAsync('git', args, { cwd, timeout: LOCAL_GIT_TIMEOUT_MS })
    return stdout
  } catch {
    return null
  }
}

interface GitCaptureOk {
  ok: true
  stdout: string
  stderr: string
}

interface GitCaptureFail {
  ok: false
  stdout: string
  stderr: string
  message: string
}

type GitCapture = GitCaptureOk | GitCaptureFail;

/** Run git while preserving stderr so failures stay actionable instead of collapsing to null. */
async function runGitCapture(cwd: string, args: string[]): Promise<GitCapture> {
  try {
    if (parseRuntimeResource(cwd)) {
      const result = await runWorkspaceProcess(cwd, ['git', ...args], { timeout: LOCAL_GIT_TIMEOUT_MS, maxBytes: 8 * 1024 * 1024 })
      return result.exitCode === 0 ? { ok: true, ...result } : { ok: false, ...result, message: result.stderr || 'Git command failed' }
    }
    const { stdout, stderr } = await execFileAsync('git', args, { cwd, timeout: LOCAL_GIT_TIMEOUT_MS })
    return { ok: true, stdout: stdout ?? '', stderr: (stderr as string | undefined) ?? '' }
  } catch (err) {
    const failure = err as { stdout?: unknown; stderr?: unknown; message?: unknown }
    const stdout = typeof failure.stdout === 'string' ? failure.stdout : String(failure.stdout ?? '')
    const stderr = typeof failure.stderr === 'string' ? failure.stderr : String(failure.stderr ?? '')
    const message =
      typeof failure.message === 'string' && failure.message ? failure.message : stderr || 'git 命令执行失败'
    return { ok: false, stdout, stderr, message }
  }
}

/** First meaningful line of git output for compact error messages. */
function gitErrorText(capture: GitCaptureFail): string {
  const detail = (capture.stderr || capture.stdout || '').trim()
  if (!detail) return capture.message.trim() || 'git 命令执行失败'
  const first = detail.split('\n').map((line) => line.trim()).filter(Boolean)[0] ?? detail
  return first.length > 300 ? first.slice(0, 300) : first
}

/** Registered (non-bare) worktree matching a path across git/native spellings and case. */
async function registeredWorktreeEntry(root: string, requested: string): Promise<ParsedWorktree | null> {
  const output = await runGit(root, ['worktree', 'list', '--porcelain'])
  if (!output) return null
  return parseWorktreeList(output).find((entry) => !entry.bare && samePath(entry.path, requested)) ?? null
}

async function localBranchExists(root: string, branch: string): Promise<boolean> {
  const output = await runGit(root, ['show-ref', '--verify', `refs/heads/${branch}`])
  return output !== null
}

function safeNormalizeFsPath(value: string): string {
  try {
    return normalizeFsPath(value)
  } catch {
    return value
  }
}

/** Every meta-store key spelling that may hold a worktree entry (raw plus normalized). */
function metaKeysFor(...paths: Array<string | null | undefined>): string[] {
  const keys: string[] = []
  for (const candidate of paths) {
    if (!candidate) continue
    if (!keys.includes(candidate)) keys.push(candidate)
    const normalized = safeNormalizeFsPath(candidate)
    if (!keys.includes(normalized)) keys.push(normalized)
  }
  return keys
}

async function removeMetaKeys(keys: string[]): Promise<void> {
  for (const key of keys) {
    await worktreeMetaStore.remove(key).catch(() => undefined)
  }
}

async function remoteUrl(cwd: string, name: string): Promise<string | null> {
  const output = await runGit(cwd, ['remote', 'get-url', name])
  const url = output?.trim()
  return url ? url : null
}

/**
 * Filesystem path equality across git and app spellings. Git prints
 * forward slashes while the workspace registry keeps native separators,
 * so raw string comparison duplicates the main checkout as a linked row.
 * Realpath resolves symlinks and subst drives; any failure falls back
 * to plain resolve so a missing path never breaks listing.
 */
export function normalizeFsPath(value: string): string {
  const resource = parseRuntimeResource(value)
  if (resource) return runtimeResource(resource.workspaceId, posix.normalize(resource.path))
  const trimmed = value.trim()
  let resolved = resolve(trimmed)
  try {
    resolved = realpathSync.native(resolved)
  } catch {
    // Keep the resolved spelling.
  }
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

export function samePath(left: string, right: string): boolean {
  try {
    return normalizeFsPath(left) === normalizeFsPath(right)
  } catch {
    return left === right
  }
}

/** Remote URL for callers outside this module (hosted detection); null when absent. */
export async function gitRemoteUrl(cwd: string, name: string): Promise<string | null> {
  return remoteUrl(cwd, name)
}

/**
 * Absolute git common dir for any checkout of the repo (main or linked
 * worktree). Null for non-git paths. `git rev-parse` may print a relative
 * spelling, so it is resolved against cwd.
 */
export async function gitCommonDir(cwd: string): Promise<string | null> {
  const output = await runGit(cwd, ['rev-parse', '--git-common-dir'])
  const raw = output?.trim()
  if (!raw) return null
  const resource = parseRuntimeResource(cwd)
  if (resource) return runtimeResource(resource.workspaceId, posix.resolve(resource.path, raw))
  return resolve(cwd, raw)
}

/**
 * Stable signature of a listing for change detection. Covers path, branch,
 * and detached/main flags so external add/remove plus branch switches all
 * produce a different signature.
 */
export function worktreeListSignature(worktrees: WorktreeInfo[]): string {
  return worktrees
    .map((entry) => `${entry.path}|${entry.branch ?? ''}|${entry.detached ? 1 : 0}|${entry.isMain ? 1 : 0}`)
    .join('\n')
}

/**
 * Offline repo identity: origin remote plus an upstream fork hint.
 * Never touches the network; unresolvable checkouts yield null.
 */
export async function getRepoIdentity(cwd: string): Promise<RepoIdentity | null> {
  const origin = await remoteUrl(cwd, 'origin')
  const parsed = origin ? parseGitRemote(origin) : null
  if (!parsed) return null
  const upstream = await remoteUrl(cwd, 'upstream')
  const upstreamParsed = upstream ? parseGitRemote(upstream) : null
  const upstreamOwner =
    upstreamParsed && upstreamParsed.owner.toLowerCase() !== parsed.owner.toLowerCase()
      ? upstreamParsed.owner
      : undefined
  const avatarOwner = upstreamOwner ?? parsed.owner
  return {
    host: parsed.host,
    owner: parsed.owner,
    repo: parsed.repo,
    ...(upstreamOwner ? { upstreamOwner } : {}),
    avatarUrl: avatarUrlFor(parsed.host, avatarOwner),
  }
}

/**
 * Login-free avatar URL. Only GitHub exposes an unauthenticated owner
 * image path; every other host returns null and keeps letter fallback.
 */
export function avatarUrlFor(host: string, owner: string): string | null {
  if (host.toLowerCase() === 'github.com' && owner) return `https://github.com/${owner}.png`
  return null
}

/** List linked worktrees; the main checkout is always first. */
export async function listWorktrees(workspaceId: string, workspacePath: string): Promise<WorktreeInfo[]> {
  const resource = await resolveRuntimeResource(workspacePath)
  if (resource) {
    const entries = await runtimeRequest<ParsedWorktree[]>(resource.runtime, 'worktree.list', { root: resource.path })
    return Promise.all(entries.filter(entry => !entry.bare).map(async entry => {
      const path = runtimeResource(resource.workspaceId, entry.path)
      const meta = await worktreeMetaStore.get(path).catch(() => null)
      const isMain = entry.path === resource.path
      return { id: path, workspaceId, path, branch: entry.branch, detached: entry.detached,
        isMain, external: !isMain && !meta, ...(meta ?? {}), locked: entry.locked, prunable: entry.prunable }
    }))
  }
  const main: WorktreeInfo = {
    id: workspacePath,
    workspaceId,
    path: workspacePath,
    branch: await currentBranch(workspacePath),
    detached: false,
    isMain: true,
    external: false,
  }
  const output = await runGit(workspacePath, ['worktree', 'list', '--porcelain'])
  if (!output) return [main]
  const linked = await Promise.all(
    parseWorktreeList(output)
      .filter((entry) => !entry.bare && !samePath(entry.path, workspacePath))
      .map(async (entry): Promise<WorktreeInfo> => {
        // Normalize once: git prints forward slashes, the shell keys native paths.
        const entryPath = normalizeFsPath(entry.path)
        const meta =
          (await worktreeMetaStore.get(entryPath).catch(() => null)) ??
          (await worktreeMetaStore.get(entry.path).catch(() => null))
        return {
          id: entryPath,
          workspaceId,
          path: entryPath,
          branch: entry.branch,
          detached: entry.detached,
          isMain: false,
          external: !meta,
          ...(meta ? { startFrom: meta.startFrom } : {}),
          ...(meta?.provider ? { provider: meta.provider } : {}),
          ...(meta?.linkedIssue ? { linkedIssue: meta.linkedIssue } : {}),
          ...(meta?.linkedReview !== undefined ? { linkedReview: meta.linkedReview } : {}),
          ...(meta?.pushTarget ? { pushTarget: meta.pushTarget } : {}),
          ...(entry.locked ? { locked: true } : {}),
          ...(entry.prunable ? { prunable: true } : {}),
        }
      }),
  )
  return [main, ...linked]
}

async function currentBranch(cwd: string): Promise<string | null> {
  const output = await runGit(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])
  const branch = output?.trim()
  return branch && branch !== 'HEAD' ? branch : null
}

function avatarCachePath(userDataDir: string, host: string, owner: string): string {
  const digest = createHash('sha1').update(`${host}/${owner.toLowerCase()}`).digest('hex')
  return join(userDataDir, 'janusx', 'repo-avatars', `${digest}.png`)
}

export type FetchImpl = (url: string) => Promise<{ ok: boolean; arrayBuffer: () => Promise<ArrayBuffer> }>

/**
 * Download-once owner avatar with a 7-day disk cache. Failures resolve to
 * null so callers fall back to the letter avatar; nothing here throws for
 * network states.
 */
export async function fetchRepoAvatar(
  userDataDir: string,
  host: string,
  owner: string,
  fetchImpl: FetchImpl = globalThis.fetch,
): Promise<{ dataUrl: string | null; cached: boolean }> {
  const url = avatarUrlFor(host, owner)
  if (!url) return { dataUrl: null, cached: false }
  const cachePath = avatarCachePath(userDataDir, host, owner)
  try {
    const [cached, stats] = await Promise.all([
      readFile(cachePath).catch(() => null),
      stat(cachePath).catch(() => null),
    ])
    if (cached && stats && isAvatarFresh(stats.mtimeMs)) {
      return { dataUrl: `data:image/png;base64,${cached.toString('base64')}`, cached: true }
    }
    try {
      const response = await fetchImpl(url)
      if (!response.ok) throw new Error('avatar fetch failed')
      const buffer = Buffer.from(await response.arrayBuffer())
      if (buffer.byteLength === 0 || buffer.byteLength > 512 * 1024) throw new Error('avatar empty')
      await mkdir(dirname(cachePath), { recursive: true })
      await writeFile(cachePath, buffer).catch(() => undefined)
      return { dataUrl: `data:image/png;base64,${buffer.toString('base64')}`, cached: false }
    } catch {
      // Offline with a stale cache still beats the letter fallback.
      if (cached) return { dataUrl: `data:image/png;base64,${cached.toString('base64')}`, cached: true }
      return { dataUrl: null, cached: false }
    }
  } catch {
    return { dataUrl: null, cached: false }
  }
}

export function isAvatarFresh(mtimeMs: number, nowMs = Date.now()): boolean {
  return nowMs - mtimeMs < AVATAR_CACHE_TTL_MS
}

/** Display name to branch slug: lowercase, dash-joined, git-safe. */
export function slugifyWorktreeName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-./]/g, '')
    .replace(/-+/g, '-')
    .replace(/^[./-]+|[./-]+$/g, '')
  return slug || 'worktree'
}

/** Sibling directory for a new worktree; numeric suffix on collision. */
export async function worktreeDirFor(workspacePath: string, slug: string): Promise<string> {
  const base = `${basename(resolve(workspacePath))}-${slug}`
  const parent = dirname(resolve(workspacePath))
  let candidate = join(parent, base)
  for (let attempt = 2; ; attempt++) {
    try {
      await access(candidate)
      candidate = join(parent, `${base}-${attempt}`)
    } catch {
      return candidate
    }
  }
}

export interface CreateWorktreeInput {
  name: string
  branch?: string
  startFrom?: string
  linkedIssue?: string
}

export interface CreateWorktreeResult {
  worktree: WorktreeInfo
  shared: string[]
  copied: string[]
}

async function verifyStartPoint(workspacePath: string, startFrom: string): Promise<void> {
  const checked = await runGit(workspacePath, ['rev-parse', '--verify', startFrom])
  if (!checked) throw new Error(`起始点不存在：${startFrom}`)
}

/**
 * Minimal dependency sharing for a fresh checkout. Large rebuildable
 * directories arrive as links, local secrets as owned copies; every step
 * is best-effort and reported rather than failing creation.
 */
async function shareNewWorktreeDeps(workspacePath: string, worktreePath: string): Promise<{ shared: string[]; copied: string[] }> {
  const shared: string[] = []
  const copied: string[] = []
  const nodeModulesSrc = join(workspacePath, 'node_modules')
  const nodeModulesDst = join(worktreePath, 'node_modules')
  try {
    const stats = await lstat(nodeModulesSrc).catch(() => null)
    if (stats?.isDirectory() && !(await lstat(nodeModulesDst).catch(() => null))) {
      await symlink(nodeModulesSrc, nodeModulesDst, process.platform === 'win32' ? 'junction' : 'dir')
      shared.push('node_modules')
    }
  } catch {
    // Rebuildable: a missing link only costs an install.
  }
  for (const file of ['.env', '.env.local']) {
    try {
      await access(join(workspacePath, file))
      await copyFile(join(workspacePath, file), join(worktreePath, file))
      copied.push(file)
    } catch {
      // Absent secrets are normal; never fail creation for them.
    }
  }
  return { shared, copied }
}

/** Create a linked worktree on a new branch; failures throw with git output. */
export async function createWorktree(
  workspacePath: string,
  input: CreateWorktreeInput,
  creationId?: string,
): Promise<CreateWorktreeResult> {
  const resource = await resolveRuntimeResource(workspacePath)
  if (resource) {
    const operationId = randomUUID()
    if (creationId) remoteCreations.set(creationId, { workspacePath, operationId })
    try {
      const created = await runtimeRequest<{ path: string; branch: string }>(resource.runtime, 'worktree.create', {
        root: resource.path, ...input, operationId,
      })
      const path = runtimeResource(resource.workspaceId, created.path)
      const startFrom = input.startFrom?.trim() || 'origin/main'
      await worktreeMetaStore.set(path, { startFrom, branch: created.branch, createdAt: new Date().toISOString(),
        ...(input.linkedIssue?.trim() ? { linkedIssue: input.linkedIssue.trim() } : {}) }).catch(() => undefined)
      return { worktree: { id: path, path, workspaceId: resource.workspaceId, branch: created.branch,
        detached: false, isMain: false, external: false, startFrom }, shared: [], copied: [] }
    } finally { if (creationId) remoteCreations.delete(creationId) }
  }
  const root = commandRoot(workspacePath)
  const branch = (input.branch?.trim() || slugifyWorktreeName(input.name))
  const startFrom = input.startFrom?.trim() || 'origin/main'
  if (!input.name.trim()) throw new Error('任务盘名称不能为空')
  await verifyStartPoint(root, startFrom)
  const path = await worktreeDirFor(root, slugifyWorktreeName(branch))
  await runWorktreeAdd(root, branch, path, startFrom, creationId)
  const { shared, copied } = await shareNewWorktreeDeps(root, path)
  // Metadata must never fail creation; the base falls back to origin/main.
  // Keys stay normalized so `git worktree list` spellings (forward slashes,
  // Windows case) always hit; the raw spelling is a legacy fallback on read.
  await worktreeMetaStore
    .set(safeNormalizeFsPath(path), {
      startFrom,
      branch,
      createdAt: new Date().toISOString(),
      ...(input.linkedIssue?.trim() ? { linkedIssue: input.linkedIssue.trim() } : {}),
    })
    .catch(() => undefined)
  return {
    worktree: {
      id: path,
      workspaceId: '',
      path,
      branch,
      detached: false,
      isMain: false,
      external: false,
    },
    shared,
    copied,
  }
}

const pendingCreations = new Map<string, { child: ChildProcess; path: string }>()

function runWorktreeAdd(
  root: string,
  branch: string,
  path: string,
  startFrom: string,
  creationId?: string,
): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn('git', ['worktree', 'add', '-b', branch, path, startFrom], {
      cwd: root,
      timeout: LOCAL_GIT_TIMEOUT_MS,
    })
    if (creationId) pendingCreations.set(creationId, { child, path })
    let stderr = ''
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.on('error', (err) => {
      if (creationId) pendingCreations.delete(creationId)
      rejectPromise(err)
    })
    child.on('close', (code, signal) => {
      if (creationId) pendingCreations.delete(creationId)
      if (code === 0) resolvePromise()
      else if (signal) rejectPromise(new Error(`创建已取消：${branch}`))
      else rejectPromise(new Error(stderr.trim() || `git worktree add 失败：${branch}`))
    })
  })
}

/** Cancel a running creation; best-effort prune of partial state. */
export async function cancelCreateWorktree(workspacePath: string, creationId: string): Promise<boolean> {
  if (parseRuntimeResource(workspacePath)) {
    const pending = remoteCreations.get(creationId)
    if (!pending || pending.workspacePath !== workspacePath) return false
    const resource = await resolveRuntimeResource(workspacePath)
    await runtimeRequest(resource!.runtime, 'process.cancel', { operationId: pending.operationId })
    return true
  }
  const pending = pendingCreations.get(creationId)
  if (!pending) return false
  pendingCreations.delete(creationId)
  try {
    pending.child.kill('SIGTERM')
  } catch {
    return false
  }
  const root = commandRoot(workspacePath)
  await runGit(root, ['worktree', 'prune'])
  await rm(pending.path, { recursive: true, force: true }).catch(() => undefined)
  return true
}

export interface RemoveWorktreeResult {
  /** Canonical worktree path git reported (or the requested path when unregistered). */
  path: string
  branch: string | null
  branchDeleted: boolean
  /** Set when git refuses to drop the branch (unmerged commits). */
  branchKept?: string
}

/** Current branch of a checkout; null when detached or unresolvable. */
export async function worktreeBranch(worktreePath: string): Promise<string | null> {
  return currentBranch(worktreePath)
}

/** True when the worktree has uncommitted changes. */
export async function isWorktreeDirty(worktreePath: string): Promise<boolean> {
  const output = await runGit(worktreePath, ['status', '--porcelain'])
  return output !== null && output.trim().length > 0
}

/**
 * Remove disk plus branch. The main checkout refuses here; branches git
 * will not drop stay listed via branchKept for explicit review instead of
 * force-deletion. Protected names (the main checkout's own branch) are
 * never deleted.
 *
 * The renderer keys linked worktrees by normalized path (lowercased on
 * Windows) while git records the original spelling, so the registered entry
 * is resolved with samePath and its canonical spelling drives
 * `git worktree remove`. Git stderr is preserved: dirty/locked/busy
 * checkouts surface the real reason instead of a bare failure. A requested
 * path with no registered entry (orphan directory, manually deleted .git)
 * never auto-deletes user files without force; it prunes stale admin state
 * and guides branch-only cleanup.
 */
export async function removeWorktree(
  workspacePath: string,
  worktreePath: string,
  force = false,
  branchHint?: string | null,
): Promise<RemoveWorktreeResult> {
  const resource = await resolveRuntimeResource(workspacePath)
  if (resource) {
    const target = parseRuntimeResource(worktreePath)
    if (!target || target.workspaceId !== resource.workspaceId) throw new Error('Worktree belongs to another workspace')
    const removed = await runtimeRequest<RemoveWorktreeResult>(resource.runtime, 'worktree.remove', {
      root: resource.path, target: target.path, force,
    })
    const path = runtimeResource(resource.workspaceId, removed.path)
    await removeMetaKeys(metaKeysFor(path, worktreePath))
    return { ...removed, path }
  }
  const root = commandRoot(workspacePath)
  const requested = resolve(worktreePath)
  if (samePath(requested, root)) throw new Error('主盘不能在这里删除')
  const hint = branchHint?.trim() ? branchHint.trim() : null
  const entry = await registeredWorktreeEntry(root, requested)
  if (!entry) {
    await runGit(root, ['worktree', 'prune'])
    await removeMetaKeys(metaKeysFor(requested, worktreePath))
    const hintExists = hint ? await localBranchExists(root, hint) : false
    let diskExists = false
    try {
      await access(requested)
      diskExists = true
    } catch {
      diskExists = false
    }
    if (!diskExists) {
      if (hint && hintExists) return { path: requested, branch: hint, branchDeleted: false, branchKept: hint }
      return { path: requested, branch: hint, branchDeleted: false }
    }
    if (!force) {
      throw new Error(
        `该目录不是已注册的任务盘，已执行 prune：${requested}。残留目录可手动删除${hint && hintExists ? `，分支“${hint}”请用“删除分支”清理` : '，遗留分支请用“删除分支”清理'}。`,
      )
    }
    await rm(requested, { recursive: true, force: true }).catch(() => undefined)
    await runGit(root, ['worktree', 'prune'])
    if (hint && hintExists) return { path: requested, branch: hint, branchDeleted: false, branchKept: hint }
    return { path: requested, branch: hint, branchDeleted: false }
  }
  // Canonical spelling: git's own record, not the lowercased renderer key.
  const targetForGit = entry.path
  const branch =
    entry.branch ?? hint ?? (await currentBranch(targetForGit)) ?? (await currentBranch(requested))
  const removal = await runGitCapture(
    root,
    force ? ['worktree', 'remove', '--force', targetForGit] : ['worktree', 'remove', targetForGit],
  )
  if (!removal.ok) {
    const reason = gitErrorText(removal)
    await runGit(root, ['worktree', 'prune'])
    if (!force && /uncommitted|dirty|untracked|modified|changes|未提交|未暂存/i.test(reason)) {
      throw new Error(`任务盘有未提交改动，git 拒绝删除：${reason}。确认丢弃可用强制删除。`)
    }
    if (/locked/i.test(reason)) throw new Error(`任务盘被锁定，git 拒绝删除：${reason}。`)
    if (/permission|denied|resource busy|being used|in use|正被另一进程使用|拒绝访问/i.test(reason)) {
      throw new Error(`磁盘目录被占用，git 删除失败：${reason}。关闭占用进程后重试。`)
    }
    throw new Error(`git worktree remove 失败：${targetForGit}：${reason}`)
  }
  await runGit(root, ['worktree', 'prune'])
  await removeMetaKeys(metaKeysFor(requested, worktreePath, targetForGit))
  if (!branch) return { path: targetForGit, branch: null, branchDeleted: false }
  const mainBranch = await currentBranch(root)
  if (mainBranch && branch === mainBranch) return { path: targetForGit, branch, branchDeleted: false }
  const deleted = await runGitCapture(root, ['branch', '-d', branch])
  if (deleted.ok) return { path: targetForGit, branch, branchDeleted: true }
  return { path: targetForGit, branch, branchDeleted: false, branchKept: branch }
}

/**
 * Explicit branch deletion for the preserved-branches review list.
 * Refuses branches still checked out in any worktree (including the main
 * checkout) with the occupying path, so a branch cleanup never masquerades
 * as a worktree deletion. Git stderr is preserved for unmerged/missing
 * branches.
 */
export async function deleteBranch(workspacePath: string, branch: string, force = false): Promise<void> {
  const name = branch.trim()
  if (!name) throw new Error('分支名不能为空')
  const root = commandRoot(workspacePath)
  const listing = await runGit(root, ['worktree', 'list', '--porcelain'])
  const occupant = listing
    ? parseWorktreeList(listing).find((item) => !item.bare && item.branch === name)
    : undefined
  if (occupant) {
    throw new Error(`分支“${name}”仍被任务盘占用：${occupant.path}，请先删除任务盘（磁盘目录将被移除），不要直接删分支。`)
  }
  const mainBranch = await currentBranch(root)
  if (mainBranch === name) throw new Error(`分支“${name}”是主盘当前分支，请先切换主盘分支后再删除。`)
  const result = await runGitCapture(root, ['branch', force ? '-D' : '-d', name])
  if (result.ok) return
  const reason = gitErrorText(result)
  if (!force && /not fully merged|not merged|未合并|包含未合并/i.test(reason)) {
    throw new Error(`删除分支失败：${name}：${reason}。确认丢弃未合并提交可二次确认强制删除。`)
  }
  if (/not found|no branch|unknown revision|ambiguous argument|找不到|不存在/i.test(reason)) {
    throw new Error(`删除分支失败：${name}：分支不存在（${reason}）。`)
  }
  if (/checked out|already checked|checked-out|被占用|当前分支/i.test(reason)) {
    throw new Error(`删除分支失败：${name}：${reason}。该分支仍被某任务盘占用，请先删除任务盘。`)
  }
  throw new Error(`删除分支失败：${name}：${reason}`)
}

export interface BranchFileDiff {
  path: string
  additions: number | null
  deletions: number | null
}

export interface BranchDiff {
  base: string
  branch: string
  files: BranchFileDiff[]
  additions: number
  deletions: number
}

/** Committed diff of a branch against its base (three-dot range). */
export async function diffBranchToBase(mainPath: string, base: string, branch: string): Promise<BranchDiff> {
  const root = commandRoot(mainPath)
  const output = await runGit(root, ['diff', '--numstat', `${base}...${branch}`])
  if (output === null) throw new Error(`读取分支差异失败：${branch} → ${base}`)
  const files: BranchFileDiff[] = []
  let additions = 0
  let deletions = 0
  for (const line of output.split('\n')) {
    const match = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(line)
    if (!match) continue
    const additionsForFile = match[1] === '-' ? null : Number(match[1])
    const deletionsForFile = match[2] === '-' ? null : Number(match[2])
    files.push({ path: match[3], additions: additionsForFile, deletions: deletionsForFile })
    additions += additionsForFile ?? 0
    deletions += deletionsForFile ?? 0
  }
  return { base, branch, files, additions, deletions }
}

export interface MergeResult {
  merged: boolean
  upToDate: boolean
  conflicts: string[]
}

/**
 * Merge a worktree branch into the main checkout's current branch.
 * Conflicts return as a list for explicit abort; nothing merges silently.
 */
export async function mergeBranchToBase(mainPath: string, branch: string): Promise<MergeResult> {
  const root = commandRoot(mainPath)
  const current = await currentBranch(root)
  if (current && current === branch) throw new Error('不能把分支合并到自己')
  const dirty = await runGit(root, ['status', '--porcelain'])
  if (dirty === null) throw new Error('读取主盘状态失败')
  if (dirty.trim()) throw new Error('主盘有未提交改动，先提交或清理后再合并')
  const output = await runGit(root, ['merge', '--no-ff', branch, '-m', `Merge branch '${branch}'`])
  if (output !== null) {
    return { merged: true, upToDate: /already up to date/i.test(output), conflicts: [] }
  }
  const conflicted = await runGit(root, ['diff', '--name-only', '--diff-filter=U'])
  return {
    merged: false,
    upToDate: false,
    conflicts: conflicted ? conflicted.split('\n').map((line) => line.trim()).filter(Boolean) : [],
  }
}

/** Abort an in-progress conflicted merge in the main checkout. */
export async function abortMerge(mainPath: string): Promise<void> {
  const aborted = await runGit(commandRoot(mainPath), ['merge', '--abort'])
  if (aborted === null) throw new Error('中止合并失败')
}
