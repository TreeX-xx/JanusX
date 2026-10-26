import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseNote, RELATION_TYPES } from '@janus-agent/harness-core'
import { SUPPORTED_HARNESS_PROFILE } from '@janus-agent/harness-node'
import { loadNoteEntries, toNoteDoc } from '../../src/main/notes/note-provider'
import { projectGraph } from '../../plugins/blueprint/src/main/notes/note-to-blueprint'
import { BlueprintNoteService as HarnessNoteService } from '../../plugins/blueprint/src/main/notes/service'

const repo = '972afef3-2fc7-49de-a3ee-7e041225d28c'
const other = 'd2499d5b-4ceb-4d46-aa3b-18e5c9b86034'
const a = '00000000-0000-4000-8000-000000000001'
const b = '00000000-0000-4000-8000-000000000002'
const uri = (id: string, owner = repo): string => 'note://' + owner + '/' + id
const note = (id = a, title = 'Source'): string => [
  '---', 'schema: harness-note/1', 'id: ' + id, 'kind: initiative', 'lifecycle: accepted', 'created: 2026-09-25',
  'class: architecture', 'tags: [wiki]', 'repositories: {primary: ' + repo + ', related: [' + other + ']}',
  'interfaces: [{name: ReadNote, direction: needs, provider: ' + uri(b, other) + '}]',
  'codeRefs: [{repoId: ' + repo + ', path: src/main/notes/note-provider.ts, role: entry}]',
  '---', '', '# ' + title, '', '## Goal', '', 'Read [source](' + uri(b, other) + ').', '', '## Scope', '', 'One checkout.',
  '', '## Acceptance criteria', '', '- [x] AC-1: Keep source.', '',
].join('\n')
const roots: string[] = []
const services: HarnessNoteService[] = []
async function setup(): Promise<string> {
  const root = await fs.mkdtemp(join(tmpdir(), 'note-r2-'))
  roots.push(root)
  await fs.mkdir(join(root, '.agents', 'notes'), { recursive: true })
  await fs.writeFile(join(root, '.agents', 'harness.json'), JSON.stringify({ schemaVersion: 1, repoId: repo, name: 'Notes', profile: SUPPORTED_HARNESS_PROFILE }))
  return root
}
function service(): HarnessNoteService { const value = new HarnessNoteService(); services.push(value); return value }
afterEach(async () => {
  for (const svc of services.splice(0)) svc.unwatchAll()
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true })
})

describe('R2 shared read boundary', () => {
  it('retains metadata, unknown values, body, AC checkmarks and relation annotations', () => {
    const parsed = parseNote(note())
    parsed.meta.relations = [{ type: 'implements', target: uri(b), criteria: ['AC-1'], scope: 'partial', reason: 'read boundary' }]
    parsed.meta.execution = { mode: 'xdo', state: 'queued', baseline: { taskContractHash: 'a'.repeat(64), inputs: [] }, attempt: 1, receipts: [], closeout: 'commit-required' }
    parsed.unknownFields = { futureDisplay: { value: 7 } }
    const doc = toNoteDoc(parsed)
    expect(doc.metadata).toEqual(parsed.meta)
    expect(doc.metadata).not.toBe(parsed.meta)
    expect(doc.unknownFields).toEqual(parsed.unknownFields)
    expect(doc.body).toBe(parsed.body)
    expect(doc.acs).toEqual(parsed.acs)
    expect(doc.relations).toEqual(parsed.meta.relations)
    const projected = projectGraph({ repoId: repo, repoName: 'R', entries: [{ doc, relPath: 'a.md', sha256: 'a' }], revision: 1 }, 'checkout')
    expect(projected.nodes[a].note).toEqual(doc)
    expect(projected.nodes[a].features[0].progress).toBe(0)
    expect(projected.nodes[a].status).not.toBe('done')
    expect(projected.relations[0]).toMatchObject({ type: 'implements', criteria: ['AC-1'], scope: 'partial', reason: 'read boundary' })
  })

  it('accounts for every file including conflicting identities and unmanaged assets', async () => {
    const root = await setup()
    for (const [path, text] of Object.entries({ 'a.md': note(), 'duplicate.md': note(), 'valid.md': note(b), 'legacy.md': '# Agent Note: Old\n\nStatus: implemented\n', 'helper.md': '# A helper\n', 'broken.md': '---\nschema: harness-note/1\nid: broken\n---\n# Broken\n' })) {
      await fs.writeFile(join(root, '.agents', 'notes', path), text)
    }
    const loaded = await loadNoteEntries(root)
    const counts = loaded.snapshot.entries.reduce<Record<string, number>>((out, e) => { out[e.classification] = (out[e.classification] ?? 0) + 1; return out }, {})
    expect(counts).toEqual({ valid: 1, 'conflicting-identity': 2, legacy: 1, foreign: 1, malformed: 1 })
    expect(loaded.entries.map((entry) => entry.doc.id)).toEqual([b])
    expect(loaded.invalid).toHaveLength(5)
    expect(loaded.snapshot.mentions[0]).toMatchObject({ sourceUri: uri(b), targetUri: uri(b, other), resolution: { status: 'unavailable' } })
    expect(JSON.parse(JSON.stringify(loaded.snapshot))).toEqual(loaded.snapshot)
    expect((await loadNoteEntries(root)).snapshot.coverage.snapshotHash).toBe(loaded.snapshot.coverage.snapshotHash)
  })

  it('keeps all seven edge types, prevents cross-repo aliases and flattens parent cycles', () => {
    const da = toNoteDoc(parseNote(note(a)))
    const db = toNoteDoc(parseNote(note(b)))
    da.parent = uri(b)
    db.parent = uri(a)
    da.relations = RELATION_TYPES.map((type) => ({ type, target: type === 'parent' ? uri(b) : uri(b, other), reason: 'declared' }))
    const input = { repoId: repo, repoName: 'R', revision: 1, entries: [{ doc: da, relPath: 'a.md', sha256: 'a' }, { doc: db, relPath: 'b.md', sha256: 'b' }] }
    const projected = projectGraph(input, 'checkout')
    expect(new Set(projected.relations.map((edge) => edge.type))).toEqual(new Set(RELATION_TYPES))
    expect(projected.relations.find((edge) => edge.type === 'depends-on')).toMatchObject({ targetNodeId: uri(b, other), targetUri: uri(b, other), reason: 'declared' })
    expect(projected.nodes[a].parentId).toBeNull()
    expect(projected.nodes[b].parentId).toBeNull()
    expect(projected.projectionDiagnostics).toHaveLength(2)
    expect(projectGraph(input, 'checkout')).toEqual(projected)
  })

  it('pairs fresh raw bytes with fresh hashes and refuses changed or foreign identity', async () => {
    const root = await setup()
    const file = join(root, '.agents', 'notes', 'a.md')
    await fs.writeFile(file, note())
    const svc = service()
    await svc.rescan(root)
    const original = await svc.readNote(root, a)
    const raw = '\ufeff' + note(a, 'Edited').replaceAll('\n', '\r\n')
    await fs.writeFile(file, raw)
    const fresh = await svc.readNote(root, uri(a))
    expect(fresh.raw).toBe(raw)
    expect(fresh.sha256).toBe(createHash('sha256').update(Buffer.from(raw)).digest('hex'))
    expect(fresh.indexedSourceHash).toBe(original.sha256)
    expect(fresh.matchesSnapshot).toBe(false)
    await expect(svc.readNote(root, uri(a, other))).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await fs.writeFile(file, note(b))
    await expect(svc.readNote(root, a)).rejects.toMatchObject({ code: 'CONFLICT' })
  })

  it('keeps revisions stable for unchanged bytes and separates checkout snapshots', async () => {
    const root = await setup()
    const second = await setup()
    await fs.writeFile(join(root, '.agents', 'notes', 'a.md'), note())
    await fs.writeFile(join(second, '.agents', 'notes', 'a.md'), note(a, 'Other checkout'))
    const svc = service()
    const first = await svc.projectView(root)
    expect((await svc.projectView(root)).rev).toBe(first.rev)
    const alternate = await svc.projectView(second)
    expect(alternate.blueprint.id).not.toBe(first.blueprint.id)
    expect(alternate.blueprint.nodes[a].title).toBe('Other checkout')
    await fs.writeFile(join(root, '.agents', 'notes', 'a.md'), note(a, 'Changed'))
    expect((await svc.projectView(root)).rev).toBe(first.rev + 1)
    expect((await svc.readSnapshot(second)).entries[0].doc?.title).toBe('Other checkout')
  })

  it('notifies changes in new subdirectories and HEAD without mixing checkout roots', async () => {
    const root = await setup()
    const second = await setup()
    await fs.mkdir(join(root, '.git'))
    await fs.writeFile(join(root, '.git', 'HEAD'), 'ref: refs/heads/main\n')
    const svc = service()
    const changed = vi.fn()
    svc.onChange(changed)
    await svc.watch(root)
    await fs.mkdir(join(root, '.agents', 'notes', 'new'))
    await fs.writeFile(join(root, '.agents', 'notes', 'new', 'a.md'), note())
    await vi.waitFor(() => expect(changed).toHaveBeenCalled(), { timeout: 5000 })
    expect(changed.mock.calls.every(([event]) => event.root === root && !event.error)).toBe(true)
    expect((await svc.readSnapshot(root)).entries[0].doc?.id).toBe(a)
    changed.mockClear()
    await fs.writeFile(join(second, '.agents', 'notes', 'a.md'), note())
    await fs.writeFile(join(root, '.git', 'HEAD'), 'ref: refs/heads/topic\n')
    await vi.waitFor(() => expect(changed).toHaveBeenCalled(), { timeout: 5000 })
    expect(changed.mock.calls.every(([event]) => event.root === root)).toBe(true)
  })
})

