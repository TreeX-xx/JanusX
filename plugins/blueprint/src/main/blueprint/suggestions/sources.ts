// Note: original files and stable identity — see .agents/notes/blueprint/maintenance/suggestions/module.md
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { open, realpath } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import { promisify } from 'node:util'
import { NoteService, readHarnessIdentity } from '@janus-agent/harness-node'
import { reviewPathSchema, type ReviewContext, type ReviewSourceSnapshot } from '../../../shared/blueprint-review'
import { reviewContextKey } from './store'
import { reviewStructure } from '../review/structure'
import { abortableRead } from '../read-task'

const exec = promisify(execFile)
const digest = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex')
const conflict = (): Error => Object.assign(new Error('Review sources changed; read the current workspace'), { code: 'CONFLICT' })
async function retryBusy<T>(read: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  const deadline = Date.now() + 60_000
  for (let attempt = 0; ; attempt++) {
    signal?.throwIfAborted()
    try { return await abortableRead(read(), signal) }
    catch (error) {
      if ((error as { code?: string }).code !== 'BUSY' || Date.now() >= deadline) throw error
      await delay(Math.min(100 * (attempt + 1), 1000, deadline - Date.now()), undefined, { signal })
    }
  }
}

export interface SuggestionSources {
  capture(context: ReviewContext, evidencePaths: string[], signal?: AbortSignal): Promise<ReviewSourceSnapshot>
  bytes(context: ReviewContext, path: string): Promise<Buffer>
}

export class WorkspaceSuggestionSources implements SuggestionSources {
  constructor(readonly notes: NoteService = new NoteService()) {}

  snapshot(context: ReviewContext, signal?: AbortSignal) { return retryBusy(() => this.notes.readSnapshot(context.workspacePath), signal) }

  private async branch(root: string): Promise<string> {
    const git = async (...args: string[]): Promise<string> => (await exec('git', args, {
      cwd: root, windowsHide: true, timeout: 5000, maxBuffer: 1024 * 1024, env: { ...process.env, LC_ALL: 'C' },
    })).stdout.trim()
    try { return await git('symbolic-ref', '-q', 'HEAD') } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' || /not a git repository/i.test(String((error as { stderr?: string }).stderr))) return 'no-git'
      if ((error as { code?: number }).code !== 1) throw error
      return 'detached:' + await git('rev-parse', '--verify', 'HEAD')
    }
  }

  async context(path: string): Promise<ReviewContext> {
    const canonical = await realpath(path)
    const root = await retryBusy(() => this.notes.resolveRoot(canonical))
    if (!root.ok || !root.root) throw new Error('Workspace has no readable Note repository')
    const workspacePath = await realpath(root.root)
    // Identity lookup does not need to parse or hash every Note. capture still validates two source snapshots.
    const identity = await readHarnessIdentity(workspacePath)
    if (!identity.repoId) throw new Error('Workspace has no valid Note repository identity')
    return { repoId: identity.repoId, workspacePath, branch: await this.branch(workspacePath) }
  }

  /** Existing files must resolve inside the selected checkout, including symlink targets. */
  async bytes(context: ReviewContext, path: string, maxBytes?: number): Promise<Buffer> {
    const target = await realpath(resolve(context.workspacePath, reviewPathSchema.parse(path)))
    const rel = relative(context.workspacePath, target)
    if (isAbsolute(rel) || rel === '..' || rel.startsWith('../') || rel.startsWith('..\\')) throw new Error('Review source escapes the selected workspace')
    const handle = await open(target, 'r')
    try {
      if (maxBytes === undefined) return await handle.readFile()
      const info = await handle.stat()
      if (!info.isFile() || info.size > maxBytes) throw new Error('Source file exceeds the reading limit')
      const result = Buffer.alloc(Math.min(info.size + 1, maxBytes + 1))
      let count = 0
      while (count < result.length) {
        const { bytesRead } = await handle.read(result, count, result.length - count, null)
        if (!bytesRead) break
        count += bytesRead
      }
      if (count > maxBytes || count !== info.size) throw conflict()
      return result.subarray(0, count)
    } finally { await handle.close() }
  }

  async capture(context: ReviewContext, evidencePaths: string[], signal?: AbortSignal): Promise<ReviewSourceSnapshot> {
    if (reviewContextKey(await this.context(context.workspacePath)) !== reviewContextKey(context)) throw conflict()
    signal?.throwIfAborted()
    const first = await this.snapshot(context, signal)
    signal?.throwIfAborted()
    const notes = first.entries.flatMap(entry => entry.classification === 'valid' && entry.doc && entry.sourceHash ? [{
      noteId: entry.doc.id, path: entry.relPath, hash: entry.sourceHash, kind: entry.doc.kind,
      lifecycle: entry.doc.lifecycle, ...(entry.doc.module ? { module: entry.doc.module } : {}),
    }] : [])
    const unavailable = first.entries.filter(entry => ['unreadable', 'malformed', 'conflicting-identity'].includes(entry.classification))
    // An unreadable/malformed moved file may own a missing UUID. Its absence is unproven.
    const complete = first.coverage.status === 'complete' && unavailable.length === 0
    const evidence: Record<string, string | null> = Object.create(null) as Record<string, string | null>
    for (const path of new Set(evidencePaths)) {
      reviewPathSchema.parse(path)
      try { evidence[path] = digest(await this.bytes(context, path)) } catch { evidence[path] = null }
    }
    signal?.throwIfAborted()
    const second = await this.snapshot(context, signal)
    signal?.throwIfAborted()
    if (first.coverage.snapshotHash !== second.coverage.snapshotHash || second.repoId !== context.repoId) throw conflict()
    for (const [path, hash] of Object.entries(evidence)) {
      let current: string | null = null
      try { current = digest(await this.bytes(context, path)) } catch { /* Unavailable remains explicit. */ }
      if (hash !== current) throw conflict()
    }
    if (await this.branch(context.workspacePath) !== context.branch) throw conflict()
    signal?.throwIfAborted()
    return { context, complete, notes, structure: reviewStructure(first), unavailablePaths: unavailable.map(entry => entry.relPath), evidence }
  }
}
