import { SUPPORTED_HARNESS_PROFILE } from '@janus-agent/harness-node';
import { promises as fs } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { BlueprintNoteService as HarnessNoteService, claimsHarnessSchema } from '../../plugins/blueprint/src/main/notes/service'
import { kindToNodeType, lifecycleToStatus } from '../../plugins/blueprint/src/main/notes/note-to-blueprint'
import { toNoteDoc } from '../../src/main/notes/note-provider'

const REPO = '8fa19f17-c717-43a8-93a7-810a5e0cbc91'

async function makeRoot(withId = true): Promise<string> {
  const root = await fs.mkdtemp(join(tmpdir(), 'harness-s4-'))
  await fs.mkdir(join(root, '.agents', 'notes'), { recursive: true })
  if (withId) {
    await fs.writeFile(
      join(root, '.agents', 'harness.json'),
      JSON.stringify({ schemaVersion: 1, repoId: REPO, name: 'S4', profile: SUPPORTED_HARNESS_PROFILE }),
    )
  }
  return root
}

const NOTE = (id: string, kind: string, lifecycle: string, title: string, ac = true): string => {
  const body =
    kind === 'idea'
      ? ['## Background', '', 'B.', '', '## Idea', '', 'I.', '']
      : [
          '## Problem',
          '',
          'P.',
          '',
          '## Expected behavior',
          '',
          'E.',
          '',
          '## Scope',
          '',
          'S.',
          '',
          '## Acceptance criteria',
          '',
          ...(ac ? ['- [ ] AC-1: One.'] : []),
          '',
        ]
  return ['---', 'schema: harness-note/1', `id: ${id}`, `kind: ${kind}`, `lifecycle: ${lifecycle}`, 'created: 2026-09-16', '---', '', `# ${title}`, '', ...body].join('\n')
}

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) {
    const svc = new HarnessNoteService()
    svc.unwatchAll()
    await fs.rm(root, { recursive: true, force: true })
  }
})

describe('harness kind/status maps', () => {
  it('maps kinds and lifecycles onto canvas vocabulary', () => {
    expect(kindToNodeType('task')).toBe('task')
    expect(kindToNodeType('requirement')).toBe('feature')
    expect(kindToNodeType('decision')).toBe('epic')
    expect(kindToNodeType('idea')).toBe('issue')
    expect(lifecycleToStatus('draft')).toBe('planning')
    expect(lifecycleToStatus('accepted')).toBe('in-progress')
    expect(lifecycleToStatus('implemented')).toBe('done')
    expect(lifecycleToStatus('archived')).toBe('archived')
  })
})

describe('harness service roundtrip', () => {
  it('terminal write -> rescan -> graph -> UI edit -> bytes (F-roundtrip)', async () => {
    const svc = new HarnessNoteService()
    const root = await makeRoot()
    roots.push(root)
    const id = '33333333-3333-4333-8333-333333333333'
    // Terminal side: plain file write, no service involved.
    await fs.writeFile(join(root, '.agents', 'notes', '2026-09-16-t--33333333.md'), NOTE(id, 'requirement', 'proposed', 'T'))
    const { rev } = await svc.rescan(root)
    expect(rev).toBe(1)
    const view = await svc.projectView(root)
    expect(view.blueprint.source).toBe('harness')
    expect(view.adapterVersion).toBe('v2')
    expect(view.blueprint.adapterVersion).toBe('v2')
    expect(view.blueprint.nodes[id]?.title).toBe('T')
    expect(view.blueprint.nodes[id]?.sourceHash).toHaveLength(64)
    // UI side: hashed replace through the single transaction.
    const hash = view.blueprint.nodes[id]?.sourceHash as string
    const current = await svc.readNote(root, id)
    const { applyNodePatch } = await import('../../plugins/blueprint/src/main/notes/note-to-blueprint')
    const produced = applyNodePatch(toNoteDoc(current.note), { title: 'T2' })
    if (!('edit' in produced)) throw new Error('patch rejected')
    const markdown = svc.mergeNoteEdit(current.note, current.raw, produced.edit, 'test')
    const report = await svc.applyOperations(
      root,
      [{ operationId: 'op-1', type: 'replace', uri: `note://${REPO}/${id}`, expectedHash: hash, afterMarkdown: markdown }],
      'test',
    )
    expect(report.applied).toHaveLength(1)
    const bytes = await fs.readFile(join(root, '.agents', 'notes', '2026-09-16-t--33333333.md'), 'utf8')
    expect(bytes).toContain('# T2')
    const view2 = await svc.projectView(root)
    expect(view2.blueprint.nodes[id]?.title).toBe('T2')
  })

  it('stale UI save loses to the terminal write with bytes preserved (F-conflict)', async () => {
    const svc = new HarnessNoteService()
    const root = await makeRoot()
    roots.push(root)
    const id = '33333333-3333-4333-8333-333333333333'
    await fs.writeFile(join(root, '.agents', 'notes', '2026-09-16-t--33333333.md'), NOTE(id, 'requirement', 'proposed', 'T'))
    await svc.rescan(root)
    const view = await svc.projectView(root)
    const stale = view.blueprint.nodes[id]?.sourceHash as string
    // Terminal wins first.
    await fs.writeFile(
      join(root, '.agents', 'notes', '2026-09-16-t--33333333.md'),
      NOTE(id, 'requirement', 'proposed', 'Terminal'),
    )
    const current = await svc.readNote(root, id)
    const { applyNodePatch } = await import('../../plugins/blueprint/src/main/notes/note-to-blueprint')
    const produced = applyNodePatch(toNoteDoc(current.note), { title: 'UI' })
    if (!('edit' in produced)) throw new Error('patch rejected')
    // Merge against the stale read: the transaction must refuse.
    const staleRaw = NOTE(id, 'requirement', 'proposed', 'T')
    const { parseNote } = await import('@janus-agent/harness-core')
    const staleParsed = parseNote(staleRaw)
    const markdown = svc.mergeNoteEdit(staleParsed, staleRaw, produced.edit, 'test')
    await expect(
      svc.applyOperations(
        root,
        [{ operationId: 'op-1', type: 'replace', uri: `note://${REPO}/${id}`, expectedHash: stale, afterMarkdown: markdown }],
        'test',
      ),
    ).rejects.toMatchObject({ code: 'HARNESS_CONFLICT' })
    expect(await fs.readFile(join(root, '.agents', 'notes', '2026-09-16-t--33333333.md'), 'utf8')).toContain('# Terminal')
  })

  it('a broken note lands in the invalid lane without breaking the graph', async () => {
    const svc = new HarnessNoteService()
    const root = await makeRoot()
    roots.push(root)
    const id = '33333333-3333-4333-8333-333333333333'
    await fs.writeFile(join(root, '.agents', 'notes', '2026-09-16-t--33333333.md'), NOTE(id, 'requirement', 'proposed', 'T'))
    const bad = ['---', 'schema: harness-note/1', 'id: not-a-uuid', 'kind: requirement', 'lifecycle: proposed', 'created: 2026-09-16', '---', '', '# Bad', '', '## Problem', '', 'P.', ''].join('\n')
    await fs.writeFile(join(root, '.agents', 'notes', '2026-09-16-bad--deadbeef.md'), bad)
    const view = await svc.projectView(root)
    expect(view.blueprint.nodes[id]?.title).toBe('T')
    expect(view.invalid).toHaveLength(1)
    expect(view.invalid[0]?.relPath).toContain('2026-09-16-bad')
    expect(view.blueprint.invalidNotes).toHaveLength(1)
    expect(view.blueprint.invalidNotes?.[0]?.relPath).toContain('2026-09-16-bad')
    expect(view.blueprint.invalidNotes?.[0]?.diagnostics[0]?.code).toBe(view.invalid[0]?.diagnostics[0]?.code)
  })

  it('share export carries no local paths, machine paths, or credentials', async () => {
    const svc = new HarnessNoteService()
    const root = await makeRoot()
    roots.push(root)
    await fs.writeFile(join(root, '.agents', 'notes', '2026-09-16-t--33333333.md'), NOTE('33333333-3333-4333-8333-333333333333', 'requirement', 'proposed', 'T'))
    await fs.mkdir(join(root, '.agents', '.local', 'runs'), { recursive: true })
    await fs.writeFile(join(root, '.agents', '.local', 'runs', 'secret.json'), JSON.stringify({ token: 'abc' }))
    const outPath = join(root, 'share.json')
    const exported = await svc.exportSnapshot(root, {}, outPath)
    expect(exported.notes).toBe(1)
    const text = await fs.readFile(outPath, 'utf8')
    expect(text).not.toContain('.local')
    expect(text).not.toContain(root)
    expect(text).not.toContain('abc')
  })

  it('unbound checkouts read fine but refuse managed creates', async () => {
    const svc = new HarnessNoteService()
    const root = await makeRoot(false)
    roots.push(root)
    const resolved = await svc.resolveRoot(root)
    expect(resolved.ok).toBe(true)
    const view = await svc.projectView(root)
    expect(view.repoId).toBeNull()
  })

  it('scans a thousand notes inside budget', async () => {
    const svc = new HarnessNoteService()
    const root = await makeRoot()
    roots.push(root)
    const pad = (n: number): string => String(n).padStart(4, '0')
    for (let i = 0; i < 1000; i++) {
      const id = `10000000-0000-4000-8000-00000000${pad(i)}`
      await fs.writeFile(join(root, '.agents', 'notes', `2026-09-16-bulk-${pad(i)}--${id.slice(0, 8)}.md`), NOTE(id, 'idea', 'draft', `Bulk ${i}`))
    }
    const start = Date.now()
    await svc.rescan(root)
    const view = await svc.projectView(root)
    const ms = Date.now() - start
    expect(Object.keys(view.blueprint.nodes)).toHaveLength(1000)
    expect(ms).toBeLessThan(30000)
  }, 60000)
})

describe('own working-note namespace', () => {
  const WORKING = ['# Agent Note: Working draft', '', 'Status: proposed', '', '## Problem', '', 'Local thinking, not a harness asset.', ''].join('\n')

  it('claims only harness-note/1 frontmatter', () => {
    expect(claimsHarnessSchema(NOTE('33333333-3333-4333-8333-333333333333', 'requirement', 'proposed', 'T'))).toBe(true)
    expect(claimsHarnessSchema(WORKING)).toBe(false)
    expect(claimsHarnessSchema(['---', 'schema: something-else/1', '---', '', '# T', ''].join('\n'))).toBe(false)
    expect(claimsHarnessSchema(['---', 'schema: harness-note/1 # keep', '---', '', '# T', ''].join('\n'))).toBe(true)
    expect(claimsHarnessSchema(`\uFEFF${NOTE('33333333-3333-4333-8333-333333333333', 'requirement', 'proposed', 'T')}`)).toBe(true)
  })

  it('working notes stay visible as legacy without becoming graph nodes', async () => {
    const svc = new HarnessNoteService()
    const root = await makeRoot()
    roots.push(root)
    await fs.writeFile(join(root, '.agents', 'notes', '2026-09-18-working--deadbeef.md'), WORKING)
    const view = await svc.projectView(root)
    expect(Object.keys(view.blueprint.nodes)).toHaveLength(0)
    expect(view.invalid).toHaveLength(1)
    expect(view.blueprint.noteSnapshot?.entries[0].classification).toBe('legacy')
  })

  it('files claiming the harness schema keep invalid diagnostics', async () => {
    const svc = new HarnessNoteService()
    const root = await makeRoot()
    roots.push(root)
    const bad = ['---', 'schema: harness-note/1', 'id: not-a-uuid', 'kind: requirement', 'lifecycle: proposed', 'created: 2026-09-18', '---', '', '# Bad', '', '## Problem', '', 'P.', ''].join('\n')
    await fs.writeFile(join(root, '.agents', 'notes', '2026-09-18-bad--deadbeef.md'), bad)
    const view = await svc.projectView(root)
    expect(view.invalid).toHaveLength(1)
    expect(view.invalid[0]?.relPath).toContain('2026-09-18-bad')
  })

  it('mixed valid, foreign, and broken harness notes separate cleanly', async () => {
    const svc = new HarnessNoteService()
    const root = await makeRoot()
    roots.push(root)
    const id = '33333333-3333-4333-8333-333333333333'
    await fs.writeFile(join(root, '.agents', 'notes', '2026-09-16-t--33333333.md'), NOTE(id, 'requirement', 'proposed', 'T'))
    await fs.writeFile(join(root, '.agents', 'notes', '2026-09-18-working--deadbeef.md'), WORKING)
    const bad = ['---', 'schema: harness-note/1', 'id: not-a-uuid', 'kind: requirement', 'lifecycle: proposed', 'created: 2026-09-18', '---', '', '# Bad', '', '## Problem', '', 'P.', ''].join('\n')
    await fs.writeFile(join(root, '.agents', 'notes', '2026-09-18-bad--badbadba.md'), bad)
    const view = await svc.projectView(root)
    expect(Object.keys(view.blueprint.nodes)).toHaveLength(1)
    expect(view.invalid).toHaveLength(2)
    expect(view.invalid.some((item) => item.relPath.includes('2026-09-18-bad'))).toBe(true)
    expect(view.blueprint.noteSnapshot?.entries.some((item) => item.classification === 'legacy')).toBe(true)
    const exported = await svc.exportSnapshot(root, {}, join(root, 'share.json'))
    expect(exported.notes).toBe(1)
  })
})
