import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { realpath } from 'node:fs/promises'
import type { AutomationPreview, AutomationReport, AutomationReview } from '../../shared/automations'

const execute = promisify(execFile)
export async function git(root: string, args: string[], signal?: AbortSignal): Promise<string> {
  const result = await execute('git', ['-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=', ...args],
    { cwd: root, windowsHide: true, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, timeout: 30_000, signal, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' } })
  return result.stdout
}
export async function resolveRepository(root: string): Promise<string> {
  return realpath((await git(root, ['rev-parse', '--show-toplevel'])).trim())
}
export async function resolveHead(root: string, branch: string): Promise<string> {
  if (branch.startsWith('refs/') && !branch.startsWith('refs/heads/')) throw new Error('Only local branches are supported by this template')
  const ref = branch.startsWith('refs/heads/') ? branch : `refs/heads/${branch}`
  await git(root, ['check-ref-format', ref])
  return (await git(root, ['rev-parse', '--verify', `${ref}^{commit}`])).trim()
}
export async function range(root: string, head: string, base: string): Promise<AutomationPreview> {
  if (!/^[a-f0-9]{40,64}$/.test(base)) throw new Error('baseline_conflict: select a full commit SHA')
  try { await git(root, ['merge-base', '--is-ancestor', base, head]) }
  catch { throw new Error('baseline_conflict: base is missing or is no longer an ancestor') }
  const files = (await git(root, ['diff', '--no-ext-diff', '--no-textconv', '--name-only', '-z', base, head, '--'])).split('\0').filter(Boolean)
  return { root, head, base, files, noChanges: base === head }
}
export interface ReviewContext extends AutomationPreview {
  text: string; contents: Record<string, string>; skipped: string[]
}
// Git objects are an immutable snapshot. Never read the user's dirty working tree or execute repository scripts.
export async function reviewContext(input: AutomationPreview, signal: AbortSignal): Promise<ReviewContext> {
  const contents: Record<string, string> = {}, skipped: string[] = []
  let bytes = 0
  for (const path of input.files) {
    signal.throwIfAborted()
    if (Object.keys(contents).length >= 200 || bytes > 500_000) { skipped.push(path); continue }
    try {
      const tree = await git(input.root, ['ls-tree', input.head, '--', path], signal)
      if (tree && !/^100(644|755) blob /.test(tree)) { skipped.push(path); continue }
      const content = tree ? await git(input.root, ['show', `${input.head}:${path}`], signal) : ''
      if (content.includes('\0') || content.includes('\ufffd') || content.length > 100_000) { skipped.push(path); continue }
      contents[path] = content; bytes += content.length
    } catch { skipped.push(path) }
  }
  const diff = await git(input.root, ['diff', '--no-ext-diff', '--no-textconv', '--no-renames', '--unified=3', input.base, input.head, '--'], signal)
  if (diff.length > 500_000) skipped.push('(diff exceeds fixed input limit)')
  return { ...input, contents, skipped, text: JSON.stringify({ base: input.base, head: input.head, files: input.files,
    contents, skipped, diff: diff.slice(0, 500_000) }) }
}
export function validateReview(review: AutomationReview, context: ReviewContext): void {
  const known = new Set(context.files)
  if (new Set(review.coveredFiles).size !== review.coveredFiles.length || review.coveredFiles.some(path => !known.has(path))) throw new Error('Invalid coverage paths')
  for (const finding of review.findings) {
    const content = context.contents[finding.path]
    if (!known.has(finding.path) || content === undefined || finding.line > content.split('\n').length || !finding.evidence.trim())
      throw new Error('Invalid finding location or missing evidence')
  }
}
export function completeReport(reviews: AutomationReview[], context: ReviewContext, checks: AutomationReport['checks']): AutomationReport {
  const complete = !context.skipped.length && reviews.every(review => !review.incomplete && context.files.every(path => review.coveredFiles.includes(path)))
  const findings = reviews.flatMap(review => review.findings)
  return { base: context.base, head: context.head, ruleVersion: 'incremental-review/1', files: context.files,
    skipped: context.skipped, checks, summary: reviews.map(review => review.summary).join('\n\n'), findings,
    coveredFiles: context.files.filter(path => reviews.every(review => review.coveredFiles.includes(path))),
    incomplete: !complete, verdict: !complete ? 'incomplete' : findings.length || checks.some(check => !check.passed) ? 'findings' : 'clean' }
}
