import { SUPPORTED_HARNESS_PROFILE } from '@janus-agent/harness-node';
import { promises as fs } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { parseNote, validateChangeSet, validateNote } from '@janus-agent/harness-core'
import { BlueprintNoteService as HarnessNoteService } from '../../plugins/blueprint/src/main/notes/service'
import { RoundtableStore } from '../../src/main/roundtable/store'
import { buildArtifactBundle, resolveBundleRetry, snapshotSourceFacts, staleSnapshotDiagnostic } from '../../src/main/roundtable/artifact-bundle'
import type { RoundtableFact } from '../../src/shared/roundtable/events'

const REPO = '8fa19f17-c717-43a8-93a7-810a5e0cbc91'

function fact(partial: Partial<RoundtableFact> & { id: string }): RoundtableFact {
  return {
    kind: 'requirement',
    status: 'confirmed',
    title: `Title ${partial.id}`,
    content: `Content ${partial.id}.`,
    sourceEventIds: [`e-${partial.id}`],
    updatedAt: '2026-09-16T00:00:00.000Z',
    ...partial,
  }
}

async function makeRoot(): Promise<string> {
  const root = await fs.mkdtemp(join(tmpdir(), 'harness-s5-'))
  await fs.mkdir(join(root, '.agents', 'notes'), { recursive: true })
  await fs.writeFile(
    join(root, '.agents', 'harness.json'),
    JSON.stringify({ schemaVersion: 1, repoId: REPO, name: 'S5', profile: SUPPORTED_HARNESS_PROFILE }),
  )
  return root
}

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) {
    const svc = new HarnessNoteService()
    svc.unwatchAll()
    await fs.rm(root, { recursive: true, force: true })
  }
})

const BASE = { sessionId: 's5-session', roundNumber: 3, repoId: REPO }

describe('roundtable artifact bundle (S5)', () => {
  it('maps each fact to one validated note with full coverage (F05)', () => {
    const { bundle, diagnostics } = buildArtifactBundle({
      ...BASE,
      items: [
        { fact: fact({ id: 'f-req', kind: 'requirement' }) },
        { fact: fact({ id: 'f-sol', kind: 'solution' }) },
        { fact: fact({ id: 'f-act', kind: 'action' }) },
        { fact: fact({ id: 'f-ev', kind: 'evidence' }) },
        { fact: fact({ id: 'f-q', kind: 'question' }) },
      ],
    })
    expect(diagnostics).toEqual([])
    expect(bundle.schema).toBe('harness-bundle/1')
    expect(bundle.producer).toMatchObject({ type: 'roundtable', id: 's5-session', revision: 3 })
    expect(bundle.artifacts).toHaveLength(5)
    for (const artifact of bundle.artifacts) {
      expect(artifact).not.toHaveProperty('afterMarkdown')
      expect(artifact.sourceRefs).toHaveLength(1)
    }
    expect(validateChangeSet(bundle.changeSet)).toEqual([])
    // Every selected fact is covered; nothing merges silently.
    expect(bundle.coverage.filter((c) => c.status === 'covered')).toHaveLength(5)
    const kinds = bundle.changeSet.operations.map((op) => parseNote(op.afterMarkdown!).meta.kind)
    expect(kinds).toEqual(['requirement', 'decision', 'task', 'idea', 'idea'])
    for (const op of bundle.changeSet.operations) {
      expect(validateNote(parseNote(op.afterMarkdown!))).toEqual([])
    }
    const lifecycles = bundle.changeSet.operations.map((op) => parseNote(op.afterMarkdown!).meta.lifecycle)
    expect(lifecycles).toEqual(['proposed', 'proposed', 'draft', 'draft', 'draft'])
  })

  it('keeps exclusions explicit and refuses silent or empty input', () => {
    const kept = buildArtifactBundle({ ...BASE, items: [{ fact: fact({ id: 'f1' }), exclude: { reason: 'out of scope this round' } }] })
    // An all-excluded selection carries no deliverable; the empty changeset
    // validator says so instead of persisting an applicable-looking bundle.
    expect(kept.diagnostics.some((d) => d.path === 'operations')).toBe(true)
    expect(kept.bundle.coverage).toMatchObject([{ sourceRef: 'f1', status: 'excluded' }])
    expect(kept.bundle.changeSet.operations).toHaveLength(0)

    const noReason = buildArtifactBundle({ ...BASE, items: [{ fact: fact({ id: 'f1' }), exclude: { reason: '  ' } }] })
    expect(noReason.diagnostics.some((d) => d.path === 'items[0].exclude.reason')).toBe(true)

    const dup = buildArtifactBundle({ ...BASE, items: [{ fact: fact({ id: 'f1' }) }, { fact: fact({ id: 'f1' }) }] })
    expect(dup.diagnostics.some((d) => d.message.includes('duplicate fact'))).toBe(true)
    expect(dup.bundle.artifacts).toHaveLength(1)

    const badRepo = buildArtifactBundle({ ...BASE, repoId: 'not-a-uuid', items: [{ fact: fact({ id: 'f1' }) }] })
    expect(badRepo.diagnostics.some((d) => d.path === 'repoId')).toBe(true)
  })

  it('binds retries to the source snapshot, not to prose similarity', () => {
    const facts = [fact({ id: 'f1' }), fact({ id: 'f2' })]
    const first = snapshotSourceFacts(facts, 's', 1)
    expect(snapshotSourceFacts([...facts].reverse(), 's', 1)).toBe(first)
    expect(snapshotSourceFacts([{ ...facts[0], content: 'Changed.' }, facts[1]], 's', 1)).not.toBe(first)
    expect(snapshotSourceFacts(facts, 's', 2)).not.toBe(first)
  })

  it('applies creates once and treats retry as idempotent (F05)', async () => {
    const root = await makeRoot()
    roots.push(root)
    const svc = new HarnessNoteService()
    const { bundle, diagnostics } = buildArtifactBundle({ ...BASE, items: [{ fact: fact({ id: 'f1' }) }] })
    expect(diagnostics).toEqual([])
    const first = await svc.applyBundleChangeSet(root, bundle.changeSet, 'roundtable s r3')
    expect(first.applied).toHaveLength(1)
    const second = await svc.applyBundleChangeSet(root, bundle.changeSet, 'roundtable s r3')
    expect(second.applied.map((a) => a.operationId)).toEqual(first.applied.map((a) => a.operationId))
    const files = await fs.readdir(join(root, '.agents', 'notes'))
    expect(files.filter((f) => f.endsWith('.md'))).toHaveLength(1)
    const view = await svc.projectView(root)
    expect(view.invalid).toEqual([])
    expect(Object.keys(view.blueprint.nodes)).toHaveLength(1)
  })

  it('updates existing notes by section and surfaces stale saves as conflicts', async () => {
    const root = await makeRoot()
    roots.push(root)
    const svc = new HarnessNoteService()
    const created = buildArtifactBundle({ ...BASE, items: [{ fact: fact({ id: 'f1', kind: 'requirement' }) }] })
    expect(created.diagnostics).toEqual([])
    await svc.applyBundleChangeSet(root, created.bundle.changeSet, 'roundtable s r3')
    const view = await svc.projectView(root)
    const [nodeId] = Object.keys(view.blueprint.nodes)
    const read = await svc.readNote(root, nodeId)
    const uri = `note://${REPO}/${nodeId}`

    const updated = buildArtifactBundle({
      ...BASE,
      revision: 2,
      items: [{
        fact: fact({ id: 'f1', kind: 'requirement', content: 'Revised scope.' }),
        update: { uri, expectedHash: read.sha256, baseMarkdown: read.raw, section: 'Scope', text: 'Revised scope.' },
      }],
    })
    expect(updated.diagnostics).toEqual([])
    await svc.applyBundleChangeSet(root, updated.bundle.changeSet, 'roundtable s r4')
    const after = await svc.readNote(root, nodeId)
    expect(after.raw).toContain('Revised scope.')

    const stale = buildArtifactBundle({
      ...BASE,
      revision: 3,
      items: [{
        fact: fact({ id: 'f1', kind: 'requirement' }),
        update: { uri, expectedHash: read.sha256, baseMarkdown: read.raw, section: 'Scope', text: 'Stale write.' },
      }],
    })
    expect(stale.diagnostics).toEqual([])
    await expect(svc.applyBundleChangeSet(root, stale.bundle.changeSet, 'roundtable s r5')).rejects.toMatchObject({
      code: 'HARNESS_CONFLICT',
    })
  })

  it('hangs creates under a parent URI so the graph derives hierarchy', async () => {
    const root = await makeRoot()
    roots.push(root)
    const svc = new HarnessNoteService()
    const parent = buildArtifactBundle({ ...BASE, items: [{ fact: fact({ id: 'p', kind: 'decision' }) }] })
    expect(parent.diagnostics).toEqual([])
    await svc.applyBundleChangeSet(root, parent.bundle.changeSet, 'roundtable s r3')
    const [parentId] = Object.keys((await svc.projectView(root)).blueprint.nodes)
    const parentUri = `note://${REPO}/${parentId}`

    const child = buildArtifactBundle({
      ...BASE,
      revision: 2,
      items: [{ fact: fact({ id: 'c', kind: 'requirement' }), parentUri }],
    })
    expect(child.diagnostics).toEqual([])
    const op = child.bundle.changeSet.operations[0]
    expect(parseNote(op.afterMarkdown!).meta.parent).toBe(parentUri)
    await svc.applyBundleChangeSet(root, child.bundle.changeSet, 'roundtable s r4')
    const nodes = (await svc.projectView(root)).blueprint.nodes
    const [childId] = Object.keys(nodes).filter((id) => id !== parentId)
    expect(nodes[childId].parentId).toBe(parentId)
    expect(nodes[parentId].children).toContain(childId)
  })

  it('refuses bad parent URIs and parent-plus-update combos', () => {
    const bad = buildArtifactBundle({
      ...BASE,
      items: [{ fact: fact({ id: 'f1' }), parentUri: 'not-a-uri' }],
    })
    expect(bad.diagnostics.some((d) => d.path === 'items[0].parentUri')).toBe(true)
    expect(bad.bundle.changeSet.operations).toHaveLength(0)

    const base = [
      '---', 'schema: harness-note/1', 'id: 11111111-1111-4111-8111-111111111111',
      'kind: requirement', 'lifecycle: proposed', 'created: 2026-09-16', '---', '',
      '# Base', '', '## Problem', '', 'P.', '', '## Expected behavior', '', 'E.', '',
      '## Scope', '', 'S.', '', '## Acceptance criteria', '', '- [ ] AC-1: One.', '',
    ].join('\n')
    const clash = buildArtifactBundle({
      ...BASE,
      items: [{
        fact: fact({ id: 'f1' }),
        parentUri: `note://${REPO}/22222222-2222-4222-8222-222222222222`,
        update: {
          uri: `note://${REPO}/11111111-1111-4111-8111-111111111111`,
          expectedHash: 'a'.repeat(64),
          baseMarkdown: base,
          section: 'Scope',
          text: 'New scope.',
        },
      }],
    })
    expect(clash.diagnostics.some((d) => d.path === 'items[0].parentUri')).toBe(true)
  })

  it('persists bundle snapshots beside the journal for retry comparison', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'janusx-roundtable-s5-'))
    roots.push(dir)
    const store = new RoundtableStore({ journalPath: join(dir, 'events.jsonl') })
    const { bundle, diagnostics } = buildArtifactBundle({ ...BASE, items: [{ fact: fact({ id: 'f1' }) }] })
    expect(diagnostics).toEqual([])
    const path = await store.saveBundle(bundle)
    expect(path).toContain('roundtable-bundles')
    const loaded = await store.loadBundle(bundle.id, bundle.revision)
    expect((loaded?.['snapshotHash'] as string)).toBe(bundle.snapshotHash)
    expect(await store.loadBundle(bundle.id, 999)).toBeNull()
  })

  it('guards retries by snapshot: same ids reuse, moved sources demand a new revision (F05)', async () => {
    // Pure verdict table backing RoundtableService.buildBundle (C6).
    expect(resolveBundleRetry(null, 'abc')).toBe('save')
    expect(resolveBundleRetry('abc', 'abc')).toBe('reuse-saved')
    expect(resolveBundleRetry('abc', 'def')).toBe('stale')
    expect(resolveBundleRetry(undefined, 'abc')).toBe('stale')
    expect(resolveBundleRetry(42, 'abc')).toBe('stale')
    const stale = staleSnapshotDiagnostic(2)
    expect(stale.code).toBe('STALE_BASELINE')
    expect(stale.path).toBe('revision')

    // End to end through the real journal store: rebuild with identical
    // facts resolves to the saved bundle (same operation identities, no
    // duplicate notes on retry); changed facts refuse to overwrite.
    const dir = await fs.mkdtemp(join(tmpdir(), 'janusx-roundtable-s5-retry-'))
    roots.push(dir)
    const store = new RoundtableStore({ journalPath: join(dir, 'events.jsonl') })
    const bundleId = 'retry-bundle-1'
    const first = buildArtifactBundle({ ...BASE, bundleId, revision: 1, items: [{ fact: fact({ id: 'f1' }) }] })
    expect(first.diagnostics).toEqual([])
    await store.saveBundle(first.bundle)

    const saved = await store.loadBundle(bundleId, 1)
    const sameFacts = buildArtifactBundle({ ...BASE, bundleId, revision: 1, items: [{ fact: fact({ id: 'f1' }) }] })
    expect(sameFacts.diagnostics).toEqual([])
    // Fresh builds mint fresh operation ids; only the saved copy is retry-safe.
    expect(sameFacts.bundle.changeSet.operations[0].operationId).not.toBe(first.bundle.changeSet.operations[0].operationId)
    expect(resolveBundleRetry((saved as { snapshotHash?: unknown })?.snapshotHash ?? null, sameFacts.bundle.snapshotHash)).toBe('reuse-saved')

    const movedFacts = buildArtifactBundle({ ...BASE, bundleId, revision: 1, items: [{ fact: fact({ id: 'f1', content: 'Changed.' }) }] })
    expect(movedFacts.diagnostics).toEqual([])
    expect(resolveBundleRetry((saved as { snapshotHash?: unknown })?.snapshotHash ?? null, movedFacts.bundle.snapshotHash)).toBe('stale')
    // The saved history survives the refused overwrite.
    expect(((await store.loadBundle(bundleId, 1)) as { snapshotHash?: unknown })?.snapshotHash).toBe(first.bundle.snapshotHash)
  })
})
