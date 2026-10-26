import { mkdtemp, readFile, rm, writeFile, mkdir, rename } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { randomUUID, createHash } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { SUPPORTED_HARNESS_PROFILE } from '@janus-agent/harness-node'
import { ReviewStore } from '../../plugins/blueprint/src/main/blueprint/suggestions/store'
import { SuggestionService } from '../../plugins/blueprint/src/main/blueprint/suggestions/service'
import { WorkspaceSuggestionSources } from '../../plugins/blueprint/src/main/blueprint/suggestions/sources'
import { WorkspaceSuggestions } from '../../plugins/blueprint/src/main/blueprint/suggestions/workspace-service'
import { reviewResultSchema, type ReviewContext, type ReviewFinding, type ReviewSource, type ReviewSourceSnapshot } from '../../plugins/blueprint/src/shared/blueprint-review'

const repoId = '972afef3-2fc7-49de-a3ee-7e041225d28c'
const noteId = '00000000-0000-4000-8000-000000000001'
const moduleId = '00000000-0000-4000-8000-000000000002'
const path = '.agents/notes/topic.md'
const hash = (text: string) => createHash('sha256').update(text).digest('hex')
const roots: string[] = []
const stores: ReviewStore[] = []
const sources: WorkspaceSuggestionSources[] = []
afterEach(async () => {
  sources.splice(0).forEach(source => source.notes.unwatchAll())
  stores.splice(0).forEach(store => store.close())
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'blueprint-suggestions-')); roots.push(root)
  const db = join(root, 'suggestions.db')
  const store = new ReviewStore(db); stores.push(store)
  let now = 1000
  const service = new SuggestionService(store, () => now)
  const context: ReviewContext = { repoId, workspacePath: root, branch: 'refs/heads/main' }
  const note: ReviewSource = { noteId, path, hash: hash('original'), kind: 'requirement', lifecycle: 'accepted' }
  const scan = (notes = [note], complete = true, evidence: Record<string, string | null> = {}) => {
    const snapshot: ReviewSourceSnapshot = { context, notes, complete, evidence, unavailablePaths: [] }
    service.reconcile(context, snapshot, service.read(context).revision)
  }
  const finding = (summary = 'Required condition is missing') => ({ id: randomUUID(), category: 'omission' as const,
    summary, explanation: 'A required condition is not covered.', suggestion: 'Document the condition.',
    citations: [{ path, quote: 'original' }], verification: 'not-configured' as const })
  const publish = (findings: ReviewFinding[] = [finding()]) => {
    const ticket = service.begin(context, noteId, service.read(context).revision, [])
    service.publish(context, ticket.id, noteId, reviewResultSchema.parse({ findings, coverage: 'complete', limitations: [] }))
    return service.read(context).items.find(item => item.noteId === noteId)!
  }
  scan()
  return { root, db, store, service, context, note, scan, finding, publish, advance: () => { now += 600 } }
}

describe('current suggestion lifecycle', () => {
  it('settles pending scores when publishing an old Git snapshot or invalidating current evidence', async () => {
    const f = await setup()
    const finding = { ...f.finding(), verification: 'pending' as const }
    const ticket = f.service.begin(f.context, noteId, f.service.read(f.context).revision, [{ path: 'src/code.ts', hash: hash('old code') }], f.note, 'a'.repeat(40))
    f.service.publish(f.context, ticket.id, noteId, reviewResultSchema.parse({ findings: [finding], coverage: 'complete', limitations: [] }), { 'src/code.ts': hash('new code') })
    expect(f.service.read(f.context).items[0].report).toMatchObject({ stale: true, findings: [{ verification: 'failed' }] })
    f.publish([finding])
    expect(f.service.read(f.context).items[0].report?.findings[0].verification).toBe('pending')
    f.scan([{ ...f.note, hash: hash('changed Note') }])
    expect(f.service.read(f.context).items[0].report).toMatchObject({ stale: true, findings: [{ verification: 'failed' }] })
    const report = f.service.read(f.context).items[0].report!
    expect(f.service.score(f.context, noteId, report.id, f.note.hash, { ...finding, verification: 'scored' })).toBe(false)
  })

  it('marks a complete Git snapshot report stale immediately when only its code evidence differs from the workspace', async () => {
    const f = await setup(); f.publish(); f.service.retire(f.context, noteId, f.note.hash)
    const ticket = f.service.begin(f.context, noteId, f.service.read(f.context).revision, [{ path: 'src/code.ts', hash: hash('committed code') }], f.note, 'a'.repeat(40))
    f.service.publish(f.context, ticket.id, noteId, reviewResultSchema.parse({ findings: [], coverage: 'complete', limitations: [] }), { 'src/code.ts': hash('working tree code') })
    expect(f.service.read(f.context).items[0]).toMatchObject({ report: { coverage: 'complete', findings: [], stale: true }, awaitingReview: { hash: f.note.hash } })
  })
  it('persists pending re-review without old findings, then replaces it with findings from the repaired version', async () => {
    const f = await setup(); const old = f.publish()
    const current = { ...f.note, hash: hash('repaired') }; f.scan([current])
    f.service.retire(f.context, noteId, current.hash)
    const reopened = new ReviewStore(f.db)
    try { expect(reopened.read(f.context).items[0]).toMatchObject({ report: null, awaitingReview: { hash: current.hash } }) }
    finally { reopened.close() }
    expect(() => f.service.close(f.context, noteId, old.reportRevision, old.report!.findings.map(finding => finding.id))).not.toThrow()
    const fresh = { ...f.finding('New version still needs recovery conditions'), citations: [{ path, quote: 'repaired' }] }
    const next = f.publish([fresh])
    expect(next.awaitingReview).toBeUndefined()
    expect(next.report!.findings).toEqual([expect.objectContaining({ id: fresh.id, summary: fresh.summary, source: current, stale: false })])
    expect(next.report!.findings.some(finding => finding.id === old.report!.findings[0].id)).toBe(false)
  })
  it('rejects late scores for replaced, handled and changed-source findings without changing counts', async () => {
    const f = await setup(), original = f.finding(), first = f.publish([original])
    const score = { ...original, verification: 'scored' as const, verificationDetail: { score: 0.01, model: 'jev', question: 'Evidence?' } }
    expect(f.service.score(f.context, noteId, first.report!.id, f.note.hash, score)).toBe(true)
    expect(f.service.read(f.context).items[0].report!.findings).toHaveLength(1)
    const next = f.publish([f.finding('New result')])
    expect(f.service.score(f.context, noteId, first.report!.id, f.note.hash, score)).toBe(false)
    f.scan([{ ...f.note, hash: hash('changed') }])
    expect(f.service.score(f.context, noteId, next.report!.id, f.note.hash, { ...score, id: next.report!.findings[0].id })).toBe(false)
    f.service.close(f.context, noteId, f.service.read(f.context).items[0].reportRevision, next.report!.findings.map(finding => finding.id))
    expect(f.service.score(f.context, noteId, next.report!.id, f.note.hash, score)).toBe(false)
  })
  it('invalidates old handling requests on every dependency change, even in an already stale report', async () => {
    const f = await setup()
    const a = f.finding('A'), b = f.finding('B')
    for (const [finding, path] of [[a, 'src/a.ts'], [b, 'src/b.ts']] as const) {
      const ticket = f.service.begin(f.context, noteId, f.service.read(f.context).revision, [{ path, hash: hash('original') }])
      f.service.publish(f.context, ticket.id, noteId, reviewResultSchema.parse({ findings: [finding], coverage: 'complete', limitations: [] }))
    }
    f.scan([f.note], true, { 'src/a.ts': hash('changed'), 'src/b.ts': hash('original') })
    const before = f.service.read(f.context).items[0].reportRevision
    f.scan([f.note], true, { 'src/a.ts': hash('changed'), 'src/b.ts': hash('changed') })
    expect(() => f.service.close(f.context, noteId, before, [b.id])).toThrow('changed')
    const staleRevision = f.service.read(f.context).items[0].reportRevision
    f.scan([f.note], true, { 'src/a.ts': hash('changed'), 'src/b.ts': hash('changed again') })
    expect(() => f.service.close(f.context, noteId, staleRevision, [b.id])).toThrow('changed')
    const stableRevision = f.service.read(f.context).items[0].reportRevision
    f.scan([f.note], true, { 'src/a.ts': hash('changed'), 'src/b.ts': hash('changed again') })
    expect(f.service.read(f.context).items[0].reportRevision).toBe(stableRevision)
  })
  it('deduplicates new findings and replaces earlier wording and identity on complete review', async () => {
    const f = await setup(); const original = f.finding()
    f.publish([original])
    const repeated = f.publish([{ ...original, id: randomUUID() }, { ...original, id: randomUUID() }])
    expect(repeated.report!.findings).toHaveLength(1)
    expect(repeated.report!.findings[0].id).not.toBe(original.id)
    const other = { ...original, id: randomUUID(), explanation: 'A different condition.' }
    expect(f.publish([other]).report!.findings).toHaveLength(1)
    f.service.close(f.context, noteId, f.service.read(f.context).items[0].reportRevision, [original.id, other.id])
    const independent = { ...original, id: randomUUID() }
    expect(f.publish([independent]).report!.findings[0].id).toBe(independent.id)
  })
  it('does not review on creation/read and isolates checkout/branch identities', async () => {
    const f = await setup()
    expect(f.service.read(f.context).items[0].report).toBeNull()
    f.publish()
    expect(f.service.read({ ...f.context, branch: 'refs/heads/other' }).items).toEqual([])
    expect(f.service.read({ ...f.context, workspacePath: resolve(f.root, 'other') }).items).toEqual([])
  })
  it('keeps old findings on incomplete review but replaces them with a complete empty result', async () => {
    const f = await setup(); const original = f.publish()
    f.scan([{ ...f.note, hash: hash('changed') }])
    let ticket = f.service.begin(f.context, noteId, f.service.read(f.context).revision, [])
    f.service.publish(f.context, ticket.id, noteId, reviewResultSchema.parse({ findings: [], coverage: 'insufficient', limitations: ['Missing code'] }))
    expect(f.service.read(f.context).items[0].report?.findings).toEqual(original.report!.findings.map(item => ({ ...item, stale: true })))
    ticket = f.service.begin(f.context, noteId, f.service.read(f.context).revision, [])
    f.service.publish(f.context, ticket.id, noteId, reviewResultSchema.parse({ findings: [], coverage: 'complete', limitations: [] }))
    expect(f.service.read(f.context).items[0].report?.findings).toHaveLength(0)
  })
  it('only clears explicitly verified resolutions and does not persist their text as history', async () => {
    const f = await setup(); const item = f.publish()
    const ticket = f.service.begin(f.context, noteId, f.service.read(f.context).revision, [])
    f.service.publish(f.context, ticket.id, noteId, reviewResultSchema.parse({ findings: [], coverage: 'complete', limitations: [],
      resolvedFindings: [{ id: item.report!.findings[0].id, reason: 'Unique resolution explanation', citations: [{ path, quote: 'original' }] }] }))
    expect(f.service.read(f.context).items[0].report?.findings).toEqual([])
    expect((await readFile(f.db)).includes(Buffer.from('Unique resolution explanation'))).toBe(false)
    expect((await readFile(f.db)).includes(Buffer.from('Required condition is missing'))).toBe(false)
  })
  it('keeps identity through moves and module changes; archived targets remain eligible', async () => {
    const f = await setup(); f.publish()
    f.scan([{ ...f.note, path: '.agents/notes/moved.md', lifecycle: 'archived', module: `note://${repoId}/${moduleId}` }])
    expect(f.service.read(f.context).items[0]).toMatchObject({ availability: 'available', source: { path: '.agents/notes/moved.md' }, report: { stale: true } })
  })
  it('does not delete on incomplete or transient scans and restores a temporarily missing target', async () => {
    const f = await setup(); f.publish(); f.scan([], false); f.advance(); f.scan([], false)
    expect(f.service.read(f.context).items[0].report?.findings).toHaveLength(1)
    f.scan([]); f.scan()
    expect(f.service.read(f.context).items[0].availability).toBe('available')
    expect(f.service.read(f.context).items[0].report?.findings).toHaveLength(1)
  })
  it('confirmed deletion clears content, other branches survive, and restoration rejects late publication', async () => {
    const f = await setup(); f.publish()
    const ticket = f.service.begin(f.context, noteId, f.service.read(f.context).revision, [])
    const other = { ...f.context, branch: 'refs/heads/other' }
    f.service.reconcile(other, { context: other, complete: true, notes: [f.note], unavailablePaths: [], evidence: {} }, 0)
    f.scan([]); f.advance(); f.scan([])
    expect(f.service.read(f.context).items).toEqual([])
    expect(f.service.read(other).items).toHaveLength(1)
    expect((await readFile(f.db)).includes(Buffer.from('Required condition is missing'))).toBe(false)
    f.scan()
    expect(() => f.service.publish(f.context, ticket.id, noteId, reviewResultSchema.parse({ findings: [f.finding()], coverage: 'complete', limitations: [] }))).toThrow()
    expect(f.service.read(f.context).items[0].report).toBeNull()
  })
  it('invalidates dependency changes without deleting the target finding', async () => {
    const f = await setup()
    const ticket = f.service.begin(f.context, noteId, f.service.read(f.context).revision, [{ path: 'src/input.ts', hash: hash('code') }])
    f.service.publish(f.context, ticket.id, noteId, reviewResultSchema.parse({ findings: [f.finding()], coverage: 'complete', limitations: [] }))
    f.scan([f.note], true, { 'src/input.ts': null })
    expect(f.service.read(f.context).items[0].report).toMatchObject({ stale: true, findings: [{ stale: true }] })
  })
  it('clears excluded types and does not restore old reports on reentry', async () => {
    const f = await setup(); f.publish(); f.scan([{ ...f.note, kind: 'idea' }])
    expect(f.service.read(f.context).items).toEqual([])
    f.scan(); expect(f.service.read(f.context).items[0].report).toBeNull()
  })
  it('partial handling keeps remaining suggestions and makes old requests conflict', async () => {
    const f = await setup(); const findings = [f.finding('one'), f.finding('two')]; const item = f.publish(findings)
    const ticket = f.service.begin(f.context, noteId, f.service.read(f.context).revision, [])
    expect(f.service.close(f.context, noteId, item.reportRevision, [findings[0].id])).toBe('closed')
    expect(f.service.read(f.context).items[0].report?.findings.map(row => row.summary)).toEqual(['two'])
    expect(() => f.service.close(f.context, noteId, item.reportRevision, [findings[1].id])).toThrow()
    expect(() => f.service.publish(f.context, ticket.id, noteId, reviewResultSchema.parse({ findings, coverage: 'complete', limitations: [] }))).toThrow()
    f.service.close(f.context, noteId, f.service.read(f.context).items[0].reportRevision, [findings[1].id])
    expect(f.service.read(f.context).items[0].report).toBeNull()
    expect(f.service.close(f.context, noteId, item.reportRevision, [findings[0].id])).toBe('absent')
  })
  it('rejects stale scans and malformed resolution results', async () => {
    const f = await setup(); const revision = f.service.read(f.context).revision; f.publish()
    expect(() => f.service.reconcile(f.context, { context: f.context, complete: true, notes: [], unavailablePaths: [], evidence: {} }, revision)).toThrow()
    expect(() => reviewResultSchema.parse({ findings: [], coverage: 'insufficient', limitations: ['missing'], resolvedFindings: [{ id: randomUUID(), reason: 'guess', citations: [{ path, quote: 'original' }] }] })).toThrow()
  })
  it('persists current results after reopening and rolls back failed transactions', async () => {
    const f = await setup(); const item = f.publish()
    expect(() => f.store.mutate(f.context, state => { state.items.length = 0; throw new Error('fail') })).toThrow()
    const second = new ReviewStore(f.db); stores.push(second)
    expect(new SuggestionService(second).read(f.context).items[0]).toEqual(item)
  })
})

const rawNote = (id: string, kind: 'module' | 'requirement', body = 'original') => '---\n' + JSON.stringify({
  schema: 'harness-note/2', id, kind, lifecycle: 'accepted', created: '2026-10-10', updated: '2026-10-10T00:00:00Z',
  ...(kind === 'module' ? { moduleState: 'partial' } : { module: `note://${repoId}/${moduleId}` }),
}, null, 2) + '\n---\n\n# Source\n\n' + (kind === 'requirement'
  ? '## Expected behavior\n\n' + body + '\n\n## Acceptance criteria\n\n- [ ] AC-1: Keep source.\n'
  : '## Responsibility\n\n' + body + '\n\n## Design\n\nShared source.\n')

describe('shared Note source integration', () => {
  async function workspace() {
    const f = await setup()
    await mkdir(join(f.root, '.agents/notes'), { recursive: true })
    await writeFile(join(f.root, '.agents/harness.json'), JSON.stringify({ schemaVersion: 1, repoId, name: 'Review', profile: SUPPORTED_HARNESS_PROFILE }))
    await writeFile(join(f.root, '.agents/notes/module.md'), rawNote(moduleId, 'module'))
    await writeFile(join(f.root, path), rawNote(noteId, 'requirement'))
    const source = new WorkspaceSuggestionSources(); sources.push(source)
    const context = await source.context(f.root)
    const service = new SuggestionService(f.store)
    const api = new WorkspaceSuggestions(service, source)
    await api.read(context)
    return { ...f, service, source, context, api }
  }
  it('reads real bytes, rejects fabricated citations, and rejects changed inputs before publishing', async () => {
    const f = await workspace()
    const ticket = await f.api.begin(f.context, noteId, [])
    await expect(f.api.publish(f.context, noteId, ticket.id, reviewResultSchema.parse({ findings: [{ ...f.finding(), citations: [{ path, quote: 'fabricated' }] }], coverage: 'complete', limitations: [] }))).rejects.toThrow('citation')
    await writeFile(join(f.root, path), rawNote(noteId, 'requirement', 'changed'))
    await expect(f.api.publish(f.context, noteId, ticket.id, reviewResultSchema.parse({ findings: [f.finding()], coverage: 'complete', limitations: [] }))).rejects.toThrow()
  })
  it('moves safely, preserves malformed sources and deletes only after stable complete scans', async () => {
    const f = await workspace(); const ticket = await f.api.begin(f.context, noteId, [])
    await f.api.publish(f.context, noteId, ticket.id, reviewResultSchema.parse({ findings: [f.finding()], coverage: 'complete', limitations: [] }))
    const moved = '.agents/notes/renamed.md'
    await rename(join(f.root, path), join(f.root, moved))
    expect((await f.api.read(f.context)).items.find(item => item.noteId === noteId)?.source?.path).toBe(moved)
    await writeFile(join(f.root, moved), '---\nschema: harness-note/2\nid: broken\n---\n# Broken')
    expect((await f.api.read(f.context)).items.find(item => item.noteId === noteId)?.report?.findings).toHaveLength(1)
    await rm(join(f.root, moved))
    expect((await f.api.read(f.context)).items.some(item => item.noteId === noteId)).toBe(false)
  })
  it('reports workspace loss as unavailable rather than clearing persisted suggestions', async () => {
    const f = await workspace(); const ticket = await f.api.begin(f.context, noteId, [])
    await f.api.publish(f.context, noteId, ticket.id, reviewResultSchema.parse({ findings: [f.finding()], coverage: 'complete', limitations: [] }))
    await rename(join(f.root, '.agents'), join(f.root, '.agents-offline'))
    await expect(f.api.read(f.context)).rejects.toThrow()
    expect(f.service.read(f.context).items.find(item => item.noteId === noteId)?.report?.findings).toHaveLength(1)
  })
  it('rejects cross-branch completion and confines evidence to the workspace', async () => {
    const f = await workspace()
    execFileSync('git', ['init', '-b', 'main', f.root], { windowsHide: true, stdio: 'pipe' })
    const main = await f.source.context(f.root); await f.api.read(main)
    const ticket = await f.api.begin(main, noteId, [])
    execFileSync('git', ['symbolic-ref', 'HEAD', 'refs/heads/other'], { cwd: f.root, windowsHide: true })
    await expect(f.api.publish(main, noteId, ticket.id, reviewResultSchema.parse({ findings: [f.finding()], coverage: 'complete', limitations: [] }))).rejects.toThrow()
    await expect(f.source.bytes(main, '../outside')).rejects.toThrow()
  })
})
