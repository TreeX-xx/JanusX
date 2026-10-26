// Note: .agents/notes/planning/blueprint-official-plugin.md — post-commit proof reads must not replay writes.
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { acquireLock, releaseLock, applyHarnessInit, previewHarnessInit, type LoadedNoteEntry } from '@janus-agent/harness-node'
import { afterEach, expect, it, vi } from 'vitest'
import { BlueprintNoteService } from '../../plugins/blueprint/src/main/notes/service'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })

class LockedProofService extends BlueprintNoteService {
  proofCalls = 0
  release: Promise<void> = Promise.resolve()
  failure?: Error
  protected override async coverageOverlay(root: string, rev: number, entries: LoadedNoteEntry[], repoId: string) {
    this.proofCalls++
    if (this.failure) throw this.failure
    if (this.proofCalls === 1) {
      const lock = await acquireLock(root)
      this.release = delay(200).then(() => releaseLock(root, lock))
    }
    return super.coverageOverlay(root, rev, entries, repoId)
  }
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'blueprint-proof-lock-')); roots.push(root)
  await applyHarnessInit(await previewHarnessInit(root, 'Proof fixture'))
  return { root, notes: new LockedProofService() }
}

it('waits for proof-read lock contention after a committed write without resubmitting it', async () => {
  const { root, notes } = await fixture()
  const snapshot = await notes.readSnapshot(root), entry = snapshot.entries.find(item => item.doc?.kind === 'module')!
  const original = await notes.readNote(root, entry.uri!)
  const changed = original.raw + '\nApproved clarification.\n'
  const writes = vi.spyOn(notes, 'applyBundleChangeSet')
  await notes.applyBundleChangeSet(root, { id: 'proof-read-regression', revision: 1,
    source: { type: 'harness', id: 'proof-fixture', revision: 1 },
    operations: [{ operationId: 'clarify', type: 'replace', uri: entry.uri!, expectedHash: original.sha256, afterMarkdown: changed }],
  }, 'Clarify Note')
  const committed = await readFile(join(root, entry.relPath), 'utf8')
  expect(committed).toContain('Approved clarification.')
  const transactions = await readdir(join(root, '.agents/.local/transactions'))
  try {
    const view = await notes.projectView(root)
    expect(view.blueprint.nodes[entry.doc!.id].title).toBe('Proof fixture')
    expect(notes.proofCalls).toBeGreaterThan(1)
    expect(writes).toHaveBeenCalledTimes(1)
    expect(await readFile(join(root, entry.relPath), 'utf8')).toBe(committed)
    expect(await readdir(join(root, '.agents/.local/transactions'))).toEqual(transactions)
  } finally { await notes.release }
})

it('returns a proof-read IO failure without retrying it', async () => {
  const { root, notes } = await fixture()
  notes.failure = Object.assign(new Error('proof unreadable'), { code: 'IO_ERROR' })
  await expect(notes.projectView(root)).rejects.toBe(notes.failure)
  expect(notes.proofCalls).toBe(1)
})
