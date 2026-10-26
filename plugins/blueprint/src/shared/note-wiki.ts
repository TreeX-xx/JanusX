import type { NoteReadEntry, NoteReadSnapshot } from './notes'

// Note: a disposable wiki view, never another relation store — see .agents/notes/blueprint/documents/tasks/note-wiki-r3.md
export function noteWikiView(snapshot: NoteReadSnapshot, uri: string, maxItems = 32, maxChars = 18000) {
  const groups = new Map<string, NoteReadEntry[]>()
  for (const entry of snapshot.entries) {
    if (entry.uri) groups.set(entry.uri, [...(groups.get(entry.uri) ?? []), entry])
  }
  const entries = new Map([...groups].filter(([, rows]) => rows.length === 1 && rows[0].classification === 'valid').map(([id, rows]) => [id, rows[0]]))
  const outgoing = snapshot.relations.filter((edge) => edge.sourceUri === uri)
  const backlinks = snapshot.relations.filter((edge) => edge.targetUri === uri)
  const mentions = snapshot.mentions.filter((edge) => edge.sourceUri === uri)
  const mentionedBy = snapshot.mentions.filter((edge) => edge.targetUri === uri)
  const parents = new Map<string, string[]>()
  for (const edge of snapshot.relations) {
    if (edge.type !== 'parent' || edge.resolution.status !== 'resolved' || !entries.has(edge.targetUri)) continue
    const targets = new Set(parents.get(edge.sourceUri) ?? [])
    targets.add(edge.targetUri); parents.set(edge.sourceUri, [...targets])
  }
  const ancestors: string[] = []
  for (const entry of entries.values()) {
    if (entry.doc?.metadata?.schema === 'harness-note/2' && entry.doc.kind !== 'module' && entry.doc.module) parents.set(entry.uri!, [entry.doc.module])
  }
  const seen = new Set([uri])
  let cursor = uri
  while (ancestors.length < 128) {
    const targets = parents.get(cursor)
    if (targets?.length !== 1 || seen.has(targets[0])) break
    cursor = targets[0]; seen.add(cursor); ancestors.push(cursor)
  }
  const neighbours = [...new Set([
    ...outgoing.map((edge) => edge.targetUri), ...backlinks.map((edge) => edge.sourceUri),
    ...mentions.flatMap((edge) => edge.targetUri ? [edge.targetUri] : []), ...mentionedBy.map((edge) => edge.sourceUri),
  ])].sort()
  const requested = [...new Set([uri, ...ancestors, ...neighbours])]
  const limit = Math.max(1, Math.min(128, Math.floor(maxItems)))
  let budget = Math.max(1, Math.min(64000, Math.floor(maxChars)))
  let truncated = ancestors.length === 128
  const context: Array<{ uri: string; title: string; sourceHash: string | null; text: string }> = []
  for (const id of requested) {
    const entry = entries.get(id)
    if (!entry) continue
    if (context.length >= limit || budget <= 0) { truncated = true; continue }
    const body = entry.doc?.body ?? ''
    const text = body.slice(0, budget)
    context.push({ uri: id, title: entry.doc?.title ?? id, sourceHash: entry.sourceHash, text })
    budget -= text.length
    if (text.length < body.length) truncated = true
  }
  return { entry: entries.get(uri), entries, outgoing, backlinks, mentions, mentionedBy, ancestors,
    context, truncated, unavailable: requested.filter((id) => !entries.has(id)), coverage: snapshot.coverage }
}

/** Multiple parents/cycles remain visible; no first matching parent wins. */
export function noteDirectory(snapshot: NoteReadSnapshot): Array<{ entry: NoteReadEntry; depth: number; warning?: string }> {
  const counts = new Map<string, number>()
  for (const e of snapshot.entries) if (e.uri) counts.set(e.uri, (counts.get(e.uri) ?? 0) + 1)
  const entries = snapshot.entries.filter((e) => e.classification === 'valid' && e.uri && counts.get(e.uri) === 1)
  const ids = new Set(entries.map((e) => e.uri!))
  const parents = new Map<string, Set<string>>()
  for (const edge of snapshot.relations) if (edge.type === 'parent' && ids.has(edge.sourceUri)) {
    const set = parents.get(edge.sourceUri) ?? new Set<string>()
    set.add(edge.targetUri); parents.set(edge.sourceUri, set)
  }
  const paths = new Map<string, string[]>()
  for (const entry of entries) {
    if (entry.doc?.metadata?.schema === 'harness-note/2' && entry.doc.kind !== 'module' && entry.doc.module) parents.set(entry.uri!, new Set([entry.doc.module]))
  }
  const warnings = new Map<string, string>()
  for (const entry of entries) {
    const path = [entry.uri!]
    let current = entry.uri!
    while (parents.has(current)) {
      const ps = [...parents.get(current)!]
      if (ps.length !== 1) { warnings.set(entry.uri!, 'Multiple parents'); break }
      if (!ids.has(ps[0])) { warnings.set(entry.uri!, 'Unresolved parent'); break }
      if (path.includes(ps[0])) { warnings.set(entry.uri!, 'Parent cycle'); path.splice(1); break }
      if (path.length >= 128) { warnings.set(entry.uri!, 'Directory depth truncated'); break }
      path.push(ps[0]); current = ps[0]
    }
    paths.set(entry.uri!, path.reverse())
  }
  const byId = new Map(entries.map((e) => [e.uri!, e]))
  const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0
  entries.sort((a, b) => {
    const pa = paths.get(a.uri!)!, pb = paths.get(b.uri!)!
    for (let i = 0; i < Math.min(pa.length, pb.length); i++) {
      if (pa[i] === pb[i]) continue
      return compare(byId.get(pa[i])?.doc?.title ?? pa[i], byId.get(pb[i])?.doc?.title ?? pb[i]) || compare(pa[i], pb[i])
    }
    return pa.length - pb.length
  })
  return entries.map((entry) => ({ entry, depth: Math.min(16, paths.get(entry.uri!)!.length - 1), warning: warnings.get(entry.uri!) }))
}
