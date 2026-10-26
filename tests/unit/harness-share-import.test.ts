import { SUPPORTED_HARNESS_PROFILE } from '@janus-agent/harness-node';
import { promises as fs } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { BlueprintNoteService as HarnessNoteService } from '../../plugins/blueprint/src/main/notes/service'
import type { ShareSnapshot } from '../../src/main/harness/service'

const REPO = '8fa19f17-c717-43a8-93a7-810a5e0cbc91'

async function makeRoot(withId = true): Promise<string> {
  const root = await fs.mkdtemp(join(tmpdir(), 'harness-import-'))
  await fs.mkdir(join(root, '.agents', 'notes'), { recursive: true })
  if (withId) {
    await fs.writeFile(
      join(root, '.agents', 'harness.json'),
      JSON.stringify({ schemaVersion: 1, repoId: REPO, name: 'Import', profile: SUPPORTED_HARNESS_PROFILE }),
    )
  }
  return root
}

const NOTE = (id: string, kind: string, lifecycle: string, title: string): string => {
  const body =
    kind === 'idea'
      ? ['## Background', '', 'B.', '', '## Idea', '', 'I.', '']
      : ['## Problem', '', 'P.', '', '## Expected behavior', '', 'E.', '', '## Scope', '', 'S.', '', '## Acceptance criteria', '', '- [ ] AC-1: One.', '']
  return ['---', 'schema: harness-note/1', `id: ${id}`, `kind: ${kind}`, `lifecycle: ${lifecycle}`, 'created: 2026-09-19', '---', '', `# ${title}`, '', ...body].join('\n')
}

const RECEIPT_JSON = JSON.stringify({
  schema: 'harness-receipt/1',
  id: 'rc-import-1',
  taskUri: `note://${REPO}/44444444-4444-4433-8433-444444444444`,
  taskContractHash: 'f'.repeat(64),
  mode: 'xdo',
  attempt: 1,
  actor: 'tester',
  createdAt: '2026-09-19T00:00:00.000Z',
  inputs: [],
  codeManifest: [],
  checks: [{ id: 'c1', kind: 'manual', required: true, status: 'passed', repoId: REPO, summary: 'Eyeballed.', performedBy: 'tester' }],
  coverage: [],
  review: { kind: 'manual', verdict: 'approved', reviewedManifestHash: 'e'.repeat(64), actor: 'tester' },
})

function snapshotOf(notes: ShareSnapshot['notes'], evidence: ShareSnapshot['evidence'] = []): ShareSnapshot {
  return {
    schema: 'harness-share/1',
    repoId: REPO,
    repoName: 'Import',
    exportedAt: '2026-09-19T00:00:00.000Z',
    notes,
    repositories: [{ repoId: REPO, name: 'Import' }],
    unresolved: [],
    evidence,
  }
}

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) {
    new HarnessNoteService().unwatchAll()
    await fs.rm(root, { recursive: true, force: true })
  }
})

describe('share import into twin checkouts', () => {
  it('refuses an unsupported profile before writing any imported evidence', async () => {
    const target = await makeRoot()
    roots.push(target)
    await fs.writeFile(join(target, '.agents/harness.json'), JSON.stringify({ schemaVersion: 1, repoId: REPO, name: 'Import', profile: { ...SUPPORTED_HARNESS_PROFILE, digest: '0'.repeat(64) } }))
    const service = new HarnessNoteService()
    await expect(service.applyShareImport(target, snapshotOf([], [{ id: 'rc-import-1', json: RECEIPT_JSON, sha256: 'x' }]))).rejects.toMatchObject({ code: 'UNSUPPORTED_SCHEMA' })
    await expect(fs.stat(join(target, '.agents/evidence/rc-import-1.json'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect((await service.projectView(target)).invalid[0].diagnostics[0].code).toBe('UNSUPPORTED_SCHEMA')
  })

  it('roundtrips an export into an empty twin checkout', async () => {
    const svc = new HarnessNoteService()
    const source = await makeRoot()
    const target = await makeRoot()
    roots.push(source, target)
    const id = '33333333-3333-4333-8333-333333333333'
    await fs.writeFile(join(source, '.agents', 'notes', '2026-09-19-t--33333333.md'), NOTE(id, 'requirement', 'proposed', 'T'))
    const exported = await svc.exportSnapshot(source, {}, join(source, 'share.json'))
    expect(exported.notes).toBe(1)
    const snapshot = JSON.parse(await fs.readFile(join(source, 'share.json'), 'utf8')) as ShareSnapshot
    const preview = await svc.previewShareImport(target, snapshot)
    expect(preview.notes).toMatchObject([{ kind: 'create', id }])
    const report = await svc.applyShareImport(target, snapshot)
    expect(report.notes).toMatchObject([{ id, action: 'applied' }])
    const view = await svc.projectView(target)
    expect(view.blueprint.nodes[id]?.title).toBe('T')
    expect(view.invalid).toHaveLength(0)
  })

  it('updates drifted notes, skips identical ones, and converges on retry', async () => {
    const svc = new HarnessNoteService()
    const source = await makeRoot()
    const target = await makeRoot()
    roots.push(source, target)
    const moved = '33333333-3333-4333-8333-333333333333'
    const same = '44444444-4444-4433-8433-444444444444'
    await fs.writeFile(join(source, '.agents', 'notes', '2026-09-19-t--33333333.md'), NOTE(moved, 'requirement', 'proposed', 'Source title'))
    await fs.writeFile(join(source, '.agents', 'notes', '2026-09-19-s--44444444.md'), NOTE(same, 'idea', 'draft', 'Same'))
    await svc.applyShareImport(target, JSON.parse(JSON.stringify(snapshotOf([
      { id: moved, uri: `note://${REPO}/${moved}`, relPath: '.agents/notes/2026-09-19-t--33333333.md', markdown: NOTE(moved, 'requirement', 'proposed', 'Old title'), sha256: 'x' },
      { id: same, uri: `note://${REPO}/${same}`, relPath: '.agents/notes/2026-09-19-s--44444444.md', markdown: NOTE(same, 'idea', 'draft', 'Same'), sha256: 'y' },
    ]))))
    const snapshot = snapshotOf([
      { id: moved, uri: `note://${REPO}/${moved}`, relPath: '.agents/notes/2026-09-19-t--33333333.md', markdown: NOTE(moved, 'requirement', 'proposed', 'Source title'), sha256: 'z' },
      { id: same, uri: `note://${REPO}/${same}`, relPath: '.agents/notes/2026-09-19-s--44444444.md', markdown: (await svc.readNote(target, same)).raw, sha256: (await svc.readNote(target, same)).sha256 },
    ])
    const preview = await svc.previewShareImport(target, snapshot)
    expect(preview.notes).toMatchObject([{ kind: 'replace', id: moved }, { kind: 'identical', id: same }])
    const report = await svc.applyShareImport(target, snapshot)
    expect(report.notes).toMatchObject([{ id: moved, action: 'applied' }, { id: same, action: 'identical' }])
    expect((await svc.projectView(target)).blueprint.nodes[moved]?.title).toBe('Source title')
    const movedCurrent = await svc.readNote(target, moved)
    const sameCurrent = await svc.readNote(target, same)
    const retry = await svc.applyShareImport(target, snapshotOf([
      { id: moved, uri: `note://${REPO}/${moved}`, relPath: '.agents/notes/2026-09-19-t--33333333.md', markdown: movedCurrent.raw, sha256: movedCurrent.sha256 },
      { id: same, uri: `note://${REPO}/${same}`, relPath: '.agents/notes/2026-09-19-s--44444444.md', markdown: sameCurrent.raw, sha256: sameCurrent.sha256 },
    ]))
    expect(retry.notes).toMatchObject([{ id: moved, action: 'identical' }, { id: same, action: 'identical' }])
  })

  it('imports valid receipts, refuses broken ones, and never overwrites evidence', async () => {
    const svc = new HarnessNoteService()
    const target = await makeRoot()
    roots.push(target)
    const id = '33333333-3333-4333-8333-333333333333'
    const snapshot = snapshotOf(
      [{ id, uri: `note://${REPO}/${id}`, relPath: '.agents/notes/2026-09-19-t--33333333.md', markdown: NOTE(id, 'requirement', 'proposed', 'T'), sha256: 'x' }],
      [
        { id: 'rc-import-1', json: RECEIPT_JSON, sha256: 'x' },
        { id: 'rc-broken', json: '{"schema":"harness-receipt/1"}', sha256: 'y' },
      ],
    )
    const report = await svc.applyShareImport(target, snapshot)
    expect(report.notes).toMatchObject([{ id, action: 'applied' }])
    expect(report.receipts).toMatchObject([
      { id: 'rc-import-1', action: 'applied' },
      { id: 'rc-broken', action: 'invalid' },
    ])
    expect(JSON.parse(await fs.readFile(join(target, '.agents', 'evidence', 'rc-import-1.json'), 'utf8')).id).toBe('rc-import-1')
    const clash = snapshotOf([], [{ id: 'rc-import-1', json: RECEIPT_JSON.replace('Eyeballed.', 'Forged.'), sha256: 'z' }])
    const second = await svc.applyShareImport(target, clash)
    expect(second.receipts).toMatchObject([{ id: 'rc-import-1', action: 'conflict' }])
    expect(await fs.readFile(join(target, '.agents', 'evidence', 'rc-import-1.json'), 'utf8')).toBe(RECEIPT_JSON)
  })

  it('refuses foreign-repo snapshots, bad envelopes, and leaking text', async () => {
    const svc = new HarnessNoteService()
    const target = await makeRoot()
    roots.push(target)
    const foreign = snapshotOf([])
    foreign.repoId = '00000000-0000-4000-8000-000000000000'
    await expect(svc.applyShareImport(target, foreign)).rejects.toMatchObject({ code: 'UNRESOLVED_REFERENCE' })
    await expect(svc.applyShareImport(target, { ...snapshotOf([]), schema: 'harness-share/9' })).rejects.toMatchObject({ code: 'SCHEMA_INVALID' })
    const id = '33333333-3333-4333-8333-333333333333'
    const leaking = snapshotOf([
      { id, uri: `note://${REPO}/${id}`, relPath: '.agents/notes/2026-09-19-t--33333333.md', markdown: `${NOTE(id, 'requirement', 'proposed', 'T')}\n\nSee file://${target}/secret.\n`, sha256: 'x' },
    ])
    await expect(svc.previewShareImport(target, leaking)).rejects.toMatchObject({ code: 'PERMISSION_DENIED' })
  })

  it('quarantines notes whose identity or prose fails validation', async () => {
    const svc = new HarnessNoteService()
    const target = await makeRoot()
    roots.push(target)
    const report = await svc.applyShareImport(target, snapshotOf([
      { id: 'not-a-note', uri: null, relPath: '.agents/notes/2026-09-19-x--deadbeef.md', markdown: '# No frontmatter here\n', sha256: 'x' },
      { id: '33333333-3333-4333-8333-333333333333', uri: null, relPath: '.agents/notes/2026-09-19-y--33333333.md', markdown: NOTE('44444444-4444-4433-8433-444444444444', 'idea', 'draft', 'Mismatch'), sha256: 'y' },
    ]))
    expect(report.notes).toMatchObject([
      { id: 'not-a-note', action: 'invalid' },
      { id: '33333333-3333-4333-8333-333333333333', action: 'invalid' },
    ])
    expect(await svc.projectView(target)).toMatchObject({ invalid: [] })
  })
})
