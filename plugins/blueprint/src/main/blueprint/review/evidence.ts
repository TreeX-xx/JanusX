// Note: review sources are opened by the agent on demand — see .agents/notes/blueprint/maintenance/review-first-release.md
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { reviewPathSchema, REVIEW_NOTE_KINDS, type ReviewContext, type ReviewEvidence, type ReviewSource } from '../../../shared/blueprint-review'
import { WorkspaceSuggestionSources } from '../suggestions/sources'
import { isSensitivePath } from '@janus-agent/agent-core'
import { git, type GitReviewSources } from './git-snapshot'

const exec = promisify(execFile)
type Sources = WorkspaceSuggestionSources | GitReviewSources
async function localPaths(root: string): Promise<string[]> {
  const paths: string[] = []
  const visit = async (directory: string, prefix: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (entry.name !== '.git' && entry.name !== 'node_modules') await visit(join(directory, entry.name), prefix + entry.name + '/')
      } else if (entry.isFile()) paths.push(prefix + entry.name)
    }
  }
  await visit(root, '')
  return paths
}
export interface ReviewMaterial extends ReviewEvidence { content: string; totalChars: number; kind: 'note' | 'code' }
export interface ReviewInput { context: ReviewContext; target: ReviewSource; materials: ReviewMaterial[]; limitations: string[]; commit?: string }

/** Only identify the target here. Related Notes and code are choices for the reviewing agent. */
export async function collectReviewEvidence(sources: Sources, context: ReviewContext, noteId: string): Promise<ReviewInput> {
  const snapshot = await sources.snapshot(context)
  const target = snapshot.entries.find(entry => entry.classification === 'valid' && entry.doc?.id === noteId)
  if (!target?.doc || !target.sourceHash || !target.uri || !REVIEW_NOTE_KINDS.has(target.doc.kind)) throw new Error('Select a readable module, decision or requirement Note')
  return { context, target: { noteId, path: target.relPath, hash: target.sourceHash, kind: target.doc.kind,
    lifecycle: target.doc.lifecycle, ...(target.doc.module ? { module: target.doc.module } : {}) }, materials: [],
    limitations: snapshot.coverage.status === 'complete' ? [] : ['Note index coverage is incomplete.'],
    ...('commit' in sources ? { commit: sources.commit } : {}) }
}

export class ReviewEvidenceSession {
  private targetTotalLines = 0
  private readonly targetPages: Array<[number, number]> = []
  private readonly readLines = new Map<string, Map<number, string>>()
  constructor(readonly sources: Sources, readonly input: ReviewInput) {}

  private targetCoveredLines(): number {
    const pages = [...this.targetPages].sort((a, b) => a[0] - b[0])
    let covered = 0
    for (const [start, end] of pages) { if (start > covered + 1) break; covered = Math.max(covered, end) }
    return covered
  }

  private requireTarget(): void {
    if (!this.input.materials.some(item => item.path === this.input.target.path)) throw new Error('Read the target Note first')
    if (this.targetCoveredLines() < this.targetTotalLines) throw new Error('Finish reading the target Note before exploring other sources')
  }

  async notes(query = '', offset = 0) {
    this.requireTarget()
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('Invalid result offset')
    const snapshot = await this.sources.snapshot(this.input.context)
    const matches = snapshot.entries.filter(entry => entry.classification === 'valid' && entry.doc &&
      (!query || [entry.relPath, entry.doc.title, entry.uri].some(value => value?.toLowerCase().includes(query.toLowerCase()))))
    return { total: matches.length, items: matches.slice(offset, offset + 100).map(entry => ({ path: entry.relPath, uri: entry.uri,
      title: entry.doc!.title, kind: entry.doc!.kind, module: entry.doc!.module, codeRefs: entry.doc!.metadata?.codeRefs })) }
  }

  async paths(query = '', offset = 0) {
    this.requireTarget()
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('Invalid result offset')
    const { context } = this.input
    let paths: string[]
    if ('commit' in this.sources) {
      const sources = this.sources
      const raw = await git(context.workspacePath, ['ls-tree', '-r', '--name-only', sources.commit, '--', sources.prefix || '.'])
      paths = raw.split(/\r?\n/).map(path => path.slice(sources.prefix.length))
    } else {
      try {
        const raw = (await exec('rg', ['--files', '--hidden', '-g', '!.git', '-g', '!node_modules'], { cwd: context.workspacePath, windowsHide: true, maxBuffer: 32 * 1024 * 1024 })).stdout
        paths = raw.split(/\r?\n/).map(path => path.replaceAll('\\', '/'))
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        paths = await localPaths(context.workspacePath)
      }
    }
    paths = paths.filter(path => path && !isSensitivePath(path) && path.toLowerCase().includes(query.toLowerCase()))
    return { total: paths.length, items: paths.slice(offset, offset + 100) }
  }

  async search(query: string, path = '', offset = 0) {
    this.requireTarget()
    if (!query.trim()) throw new Error('Search query is required')
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('Invalid result offset')
    if (path) reviewPathSchema.parse(path)
    if (path && isSensitivePath(path)) throw new Error('Sensitive source path is unavailable')
    const { context } = this.input
    let raw: string
    try {
      raw = 'commit' in this.sources
        ? await git(context.workspacePath, ['grep', '-n', '-F', '-I', '--full-name', '-e', query, this.sources.commit, '--', this.sources.prefix + (path || '.')])
        : (await exec('rg', ['-n', '-F', '--hidden', '-g', '!.git', '-g', '!node_modules', '--', query, ...(path ? [path] : ['.'])],
          { cwd: context.workspacePath, windowsHide: true, maxBuffer: 32 * 1024 * 1024 })).stdout
    } catch (error) {
      if ((error as { code?: number }).code === 1) raw = ''
      else if ((error as NodeJS.ErrnoException).code === 'ENOENT' && !('commit' in this.sources)) {
        const items: string[] = []
        let total = 0
        for (const file of await localPaths(context.workspacePath)) {
          if (isSensitivePath(file) || path && file !== path && !file.startsWith(path + '/')) continue
          let content: string
          try {
            const bytes = await this.sources.bytes(context, file)
            if (bytes.includes(0)) continue
            content = bytes.toString('utf8')
          } catch { continue }
          for (const [index, line] of content.split(/\r?\n/).entries()) if (line.includes(query)) {
            if (total >= offset && items.length < 100) items.push(file + ':' + (index + 1) + ':' + line)
            total++
          }
        }
        return { total, items }
      } else throw error
    }
    const lines = raw.split(/\r?\n/).filter(Boolean).map(line => {
      if (!('commit' in this.sources)) return line.replace(/^\.\//, '').replace(/^([^:]+):([0-9]+):/, (_, path: string, number: string) => path.replaceAll('\\', '/') + ':' + number + ':')
      const prefix = this.sources.commit + ':' + this.sources.prefix
      return line.startsWith(prefix) ? line.slice(prefix.length) : line
    })
      .filter(line => !isSensitivePath(line.split(':')[0]))
    return { total: lines.length, items: lines.slice(offset, offset + 100) }
  }

  async read(path: string, startLine = 1, lineCount = 200) {
    reviewPathSchema.parse(path)
    if (isSensitivePath(path)) throw new Error('Sensitive source path is unavailable')
    if (path !== this.input.target.path) this.requireTarget()
    if (!Number.isSafeInteger(startLine) || startLine < 1 || !Number.isSafeInteger(lineCount) || lineCount < 1 || lineCount > 400) throw new Error('Invalid line page')
    const bytes = await this.sources.bytes(this.input.context, path)
    const hash = createHash('sha256').update(bytes).digest('hex')
    if (path === this.input.target.path && hash !== this.input.target.hash) throw Object.assign(new Error('Review target changed'), { code: 'CONFLICT' })
    const full = bytes.toString('utf8'), lines = full.split('\n')
    if (path === this.input.target.path) {
      this.targetTotalLines = lines.length
      this.targetPages.push([startLine, Math.min(lines.length, startLine + lineCount - 1)])
    }
    const content = lines.slice(startLine - 1, startLine - 1 + lineCount).join('\n')
    const previous = this.input.materials.find(material => material.path === path)
    if (previous && previous.hash !== hash) throw Object.assign(new Error('Review source changed during reading'), { code: 'CONFLICT' })
    const read = this.readLines.get(path) ?? new Map<number, string>()
    lines.slice(startLine - 1, startLine - 1 + lineCount).forEach((line, index) => read.set(startLine + index, line))
    this.readLines.set(path, read)
    // Sort and merge overlapping pages. A NUL prevents a quote from bridging unread lines.
    let combined = '', last = 0
    for (const [number, line] of [...read].sort((a, b) => a[0] - b[0])) {
      combined += (last ? number === last + 1 ? '\n' : '\0' : '') + line
      last = number
    }
    if (previous) previous.content = combined
    else this.input.materials.push({ path, hash, content: combined, totalChars: full.length, kind: path.startsWith('.agents/notes/') ? 'note' : 'code' })
    return { path, hash, startLine, totalLines: lines.length, content, hasMore: startLine - 1 + lineCount < lines.length }
  }

  validateTargetRead(): void {
    if (!this.input.materials.some(item => item.path === this.input.target.path)) throw new Error('Agent did not read the target Note')
    if (this.targetCoveredLines() < this.targetTotalLines) throw new Error('Agent did not finish reading the target Note')
  }

  async validate(): Promise<void> {
    this.validateTargetRead()
    const stable = await this.sources.capture(this.input.context, this.input.materials.map(item => item.path))
    if (stable.notes.find(note => note.noteId === this.input.target.noteId)?.hash !== this.input.target.hash ||
      this.input.materials.some(item => stable.evidence[item.path] !== item.hash)) throw Object.assign(new Error('Review evidence changed; retry with current sources'), { code: 'CONFLICT' })
  }

  async validateCoverage(coverage: 'complete' | 'insufficient'): Promise<void> {
    if (coverage !== 'complete') return
    const snapshot = await this.sources.snapshot(this.input.context)
    const target = snapshot.entries.find(entry => entry.classification === 'valid' && entry.doc?.id === this.input.target.noteId)
    const refs = target?.doc?.metadata?.codeRefs?.filter(ref => ref.repoId === this.input.context.repoId) ?? []
    const unread = refs.filter(ref => !this.input.materials.some(item => item.kind === 'code'
      && (item.path === ref.path || item.path.startsWith(ref.path.replace(/\/$/, '') + '/'))))
    if (unread.length) {
      throw new Error('Agent did not check implementation referenced by the Note: ' + [...new Set(unread.map(ref => ref.path))].join(', '))
    }
  }
}
