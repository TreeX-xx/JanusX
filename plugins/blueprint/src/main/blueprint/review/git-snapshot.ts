// Note: fixed Git objects for both Notes and code — see .agents/notes/blueprint/maintenance/note-content-review.md
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve, isAbsolute } from 'node:path'
import { reviewStructure } from './structure'
import { NoteService } from '@janus-agent/harness-node'
import { reviewPathSchema, type ReviewContext, type ReviewSourceSnapshot } from '../../../shared/blueprint-review'
import { isBlueprintBusy } from '../../../shared/blueprint-loading'

const exec = promisify(execFile)
async function retryBusy<T>(read: () => T | Promise<T>, signal?: AbortSignal): Promise<T> {
  const deadline = Date.now() + 60_000
  for (let attempt = 0; ; attempt++) {
    signal?.throwIfAborted()
    try { return await read() }
    catch (error) {
      if (!isBlueprintBusy(error) || Date.now() >= deadline) throw error
      await delay(Math.min(100 * (attempt + 1), 1000, deadline - Date.now()), undefined, { signal })
    }
  }
}
async function readBlobs(root: string, hashes: string[]): Promise<Map<string, Buffer>> {
  if (!hashes.length) return new Map()
  const raw = await new Promise<Buffer>((resolve, reject) => {
    const child = execFile('git', ['cat-file', '--batch'], { cwd: root, windowsHide: true, encoding: 'buffer',
      timeout: 60_000, maxBuffer: 128 * 1024 * 1024 }, (error, stdout) => error ? reject(error) : resolve(stdout))
    child.stdin!.on('error', reject)
    child.stdin!.end(hashes.join('\n') + '\n')
  })
  const blobs = new Map<string, Buffer>()
  let offset = 0
  for (const hash of hashes) {
    const end = raw.indexOf(10, offset)
    const match = /^([a-f0-9]+) blob (\d+)$/.exec(raw.subarray(offset, end).toString('ascii'))
    if (end < 0 || !match || match[1] !== hash) throw new Error('Invalid Git blob response')
    const size = Number(match[2]), start = end + 1
    if (!Number.isSafeInteger(size) || start + size >= raw.length || raw[start + size] !== 10) throw new Error('Truncated Git blob response')
    blobs.set(hash, raw.subarray(start, start + size)); offset = start + size + 1
  }
  return blobs
}
export async function git(root: string, args: string[]): Promise<string> {
  return (await exec('git', args, { cwd: root, windowsHide: true, timeout: 15000, maxBuffer: 32 * 1024 * 1024, env: { ...process.env, LC_ALL: 'C' } })).stdout
}
export async function gitHead(root: string): Promise<string | null> {
  try { return (await git(root, ['rev-parse', '--verify', '--quiet', 'HEAD'])).trim() }
  catch (error) { if ((error as { code?: number }).code === 1) return null; throw error }
}

export class GitReviewSources {
  private readonly notes = new NoteService()
  private parsed?: Awaited<ReturnType<NoteService['readSnapshot']>>
  private readonly files = new Map<string, Buffer>()
  private constructor(readonly context: ReviewContext, readonly commit: string, private readonly directory: string, readonly prefix: string) {}
  static async open(context: ReviewContext, commit: string, signal?: AbortSignal): Promise<GitReviewSources> {
    if (!/^[a-f0-9]{40,64}$/.test(commit)) throw new Error('Invalid review commit')
    const top = await realpath((await git(context.workspacePath, ['rev-parse', '--show-toplevel'])).trim())
    const prefix = relative(top, context.workspacePath).replaceAll('\\', '/')
    if (prefix.startsWith('..') || isAbsolute(prefix)) throw new Error('Workspace is outside its Git checkout')
    const directory = await mkdtemp(join(tmpdir(), 'janusx-note-commit-'))
    const source = new GitReviewSources(context, commit, directory, prefix ? prefix + '/' : '')
    try {
      // Only original Note inputs are materialized for the shared parser. Code is read on demand from the same object tree.
      const tree = await git(context.workspacePath, ['ls-tree', '-rz', '--full-tree', commit, '--', source.prefix + '.agents'])
      const inputs: Array<{ path: string; hash: string }> = []
      for (const entry of tree.split('\0').filter(Boolean)) {
        const match = /^(\d+) blob ([a-f0-9]+)\t([\s\S]+)$/.exec(entry)
        if (!match) continue
        const path = match[3].slice(source.prefix.length)
        if (path !== '.agents/harness.json' && !path.startsWith('.agents/notes/')) continue
        if (path.includes('/.local/')) continue
        reviewPathSchema.parse(path)
        if (match[1] !== '100644' && match[1] !== '100755') throw new Error('Symlinked Note inputs cannot be reviewed from Git')
        inputs.push({ path, hash: match[2] })
      }
      const blobs = await readBlobs(context.workspacePath, [...new Set(inputs.map(input => input.hash))])
      for (const { path, hash } of inputs) {
        const target = resolve(directory, path)
        const rel = relative(directory, target)
        if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('Invalid Git Note path')
        await mkdir(dirname(target), { recursive: true })
        const bytes = blobs.get(hash)!
        source.files.set(path, bytes)
        await writeFile(target, bytes)
      }
      const snapshot = await source.snapshot(context, signal)
      if (snapshot.repoId !== context.repoId || snapshot.coverage.status !== 'complete'
        || snapshot.entries.some(entry => ['unreadable', 'malformed', 'conflicting-identity'].includes(entry.classification))) {
        const issue = reviewStructure(snapshot).issues[0]
        throw new Error('Commit has incomplete or invalid Note sources' + (issue ? ': ' + issue.path + ': ' + issue.message : ''))
      }
      return source
    } catch (error) { await source.close(); throw error }
  }
  async snapshot(_context: ReviewContext, signal?: AbortSignal) {
    if (this.parsed) return this.parsed
    this.parsed = await retryBusy(() => this.notes.readSnapshot(this.directory), signal)
    return this.parsed
  }
  async bytes(_context: ReviewContext, path: string): Promise<Buffer> {
    reviewPathSchema.parse(path)
    const cached = this.files.get(path)
    if (cached) return cached
    const file = this.prefix + path
    const tree = await git(this.context.workspacePath, ['ls-tree', this.commit, '--', file])
    if (!/^100(?:644|755) blob /.test(tree)) throw new Error('Git source is absent or is not a regular file')
    const result = await exec('git', ['show', `${this.commit}:${file}`], { cwd: this.context.workspacePath,
      windowsHide: true, timeout: 15000, encoding: 'buffer', maxBuffer: 8 * 1024 * 1024 })
    this.files.set(path, result.stdout)
    return result.stdout
  }
  async capture(context: ReviewContext, paths: string[]): Promise<ReviewSourceSnapshot> {
    const snapshot = await this.snapshot(context)
    const evidence: Record<string, string | null> = {}
    for (const path of paths) {
      try { evidence[path] = createHash('sha256').update(await this.bytes(context, path)).digest('hex') }
      catch { evidence[path] = null }
    }
    return { context, complete: true, unavailablePaths: [], structure: reviewStructure(snapshot), evidence, notes: snapshot.entries.flatMap(entry => entry.doc && entry.sourceHash && entry.classification === 'valid'
      ? [{ noteId: entry.doc.id, path: entry.relPath, hash: entry.sourceHash, kind: entry.doc.kind, lifecycle: entry.doc.lifecycle, ...(entry.doc.module ? { module: entry.doc.module } : {}) }] : []) }
  }
  async close(): Promise<void> { this.notes.unwatchAll(); await rm(this.directory, { recursive: true, force: true }) }
}
