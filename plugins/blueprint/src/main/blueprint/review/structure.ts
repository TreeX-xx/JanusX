// Note: deterministic format results include files without usable identities — see .agents/notes/blueprint/maintenance/note-content-review.md
import type { NoteReadSnapshot } from '@janus-agent/harness-node'
import type { NoteStructureIssue, NoteStructureReview } from '../../../shared/blueprint-review'

/** The shared index already validates raw bytes, the pinned profile and module organization. */
export function reviewStructure(snapshot: NoteReadSnapshot): NoteStructureReview {
  const issues: NoteStructureIssue[] = []
  const counts = new Map<string, number>()
  for (const entry of snapshot.entries) if (entry.doc?.id) counts.set(entry.doc.id, (counts.get(entry.doc.id) ?? 0) + 1)
  const add = (code: string, message: string, path: string, field?: string) => {
    const entry = snapshot.entries.find(entry => entry.relPath === path || entry.uri === path)
    if (path.startsWith('note://') && !path.startsWith('note://' + snapshot.repoId + '/')) return
    // A foreign checkout's availability never determines a local Note's format verdict.
    if (/repository not bound in this index:/.test(message)) return
    const normalized = path.replaceAll('\\', '/')
    const root = snapshot.coverage.checkoutRoot.replaceAll('\\', '/').replace(/\/$/, '')
    const local = entry?.relPath ?? (normalized.startsWith(root + '/') ? normalized.slice(root.length + 1) : normalized)
    issues.push({ code, message, path: local,
      ...(field ? { field } : {}), ...(entry?.sourceHash ? { hash: entry.sourceHash } : {}),
      ...(entry?.doc?.title ? { title: entry.doc.title } : {}),
      ...(entry?.doc?.id && counts.get(entry.doc.id) === 1 && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(entry.doc.id) ? { noteId: entry.doc.id } : {}) })
  }
  for (const entry of snapshot.entries) {
    for (const issue of entry.diagnostics) add(issue.code, issue.message, entry.relPath, issue.path && issue.path !== entry.relPath ? issue.path : undefined)
    if (!entry.diagnostics.length && ['legacy', 'foreign'].includes(entry.classification)) add('SCHEMA_INVALID', 'Expected a formal harness Note using the pinned repository profile', entry.relPath)
  }
  for (const issue of snapshot.diagnostics) add(issue.code, issue.message, issue.path ?? '.agents/harness.json')
  const unique = [...new Map(issues.map(issue => [JSON.stringify([issue.path, issue.code, issue.message]), issue])).values()]
  return { complete: snapshot.coverage.status === 'complete' && !unique.some(issue => ['IO_ERROR', 'UNSUPPORTED_PROFILE', 'PROFILE_MISMATCH'].includes(issue.code)
      || issue.path === '.agents/harness.json'),
    checked: snapshot.entries.length, snapshotHash: snapshot.coverage.snapshotHash, issues: unique }
}

export function assertNoteStructure(snapshot: NoteReadSnapshot, noteId: string) {
  const result = reviewStructure(snapshot)
  const entries = snapshot.entries.filter(entry => entry.doc?.id === noteId)
  const paths = new Set(entries.map(entry => entry.relPath))
  const issue = result.issues.find(issue => paths.has(issue.path) || issue.path === '.agents/notes/module.md' || issue.path === '.agents/harness.json')
  if (!result.complete || issue || entries.length !== 1 || entries[0].classification !== 'valid') {
    const detail = issue ?? result.issues[0]
    throw Object.assign(new Error('Structure check failed: ' + (detail ? detail.path + ': ' + detail.message : 'Note identity or sources are incomplete')),
      { code: 'STRUCTURE_INVALID' })
  }
  return entries[0]
}
