import type { Blueprint } from '../../../plugins/blueprint/src/shared/janus/types'
import { useNoteSourceStore } from '../../../src/renderer/src/stores/note-source'
import { useBlueprintReviewStore } from '../../../src/renderer/src/stores/blueprint-review'
import { useBlueprintActivityStore } from '../../../src/renderer/src/stores/blueprint-review-activity'
import { useBlueprintStore } from '../../../src/renderer/src/stores/blueprint'
import type { BlueprintReviewResults } from '../../../plugins/blueprint/src/shared/ipc/blueprint-review'
import type { NoteReadResult } from '../../../plugins/blueprint/src/shared/blueprint-attention'

export function installAttentionFixture(graph: Blueprint, root: string) {
  const deep = '00000005-aaaa-4aaa-8aaa-aaaaaaaaaaaa', other = '00000003-aaaa-4aaa-8aaa-aaaaaaaaaaaa', child = '00000000-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  graph.nodes[deep].kind = graph.nodes[deep].note!.kind = 'requirement'
  graph.nodes[child].kind = graph.nodes[child].note!.kind = 'requirement'
  graph.nodes[deep].note!.body = Array.from({ length: 32 }, (_, index) => `Paragraph ${index + 1}. Original engineering requirement with a recoverable failure.`).join('\n\n')
  const context = { repoId: graph.noteSnapshot!.repoId, workspacePath: root, branch: 'refs/heads/main' }
  const findings = [{ id: '99999999-1111-4111-8111-111111111111', summary: 'Recovery rule is missing', explanation: 'The requirement does not explain how to resume after interruption.', suggestion: 'Document the recovery checkpoint.', citations: [{ path: graph.nodes[deep].sourceRelPath, quote: 'recoverable failure' }], verification: 'not-configured', stale: false }]
  const view: any = { context, revision: 1, sourceComplete: true, activities: [], activityRevision: 1,
    updates: { ready: true, complete: true, revision: 1, entries: graph.nodeIds.map(noteId => ({ noteId, hash: graph.nodes[noteId].sourceHash, path: graph.nodes[noteId].sourceRelPath, unread: [deep, other, child].includes(noteId), change: 'modified', observedAt: '2026-10-10T17:00:00Z', available: true })) },
    items: [{ noteId: deep, reportRevision: 1, availability: 'available', error: null, report: { findings, coverage: 'complete', limitations: [], stale: false } },
      { noteId: child, reportRevision: 2, availability: 'available', error: null, report: { findings: [], coverage: 'insufficient', limitations: ['Referenced recovery file could not be read from this commit.'], stale: false } }],
    automatic: { context, phase: 'failed', reason: 'review-failed', commits: 0, threshold: 5, remaining: 0,
      lastRun: { finishedAt: '2026-10-10T17:00:00Z', outcome: 'reviewed', reviewed: 2, findings: 1, failed: 1, incomplete: 1 },
      targets: [{ noteId: deep, state: 'reviewed', commit: 'a'.repeat(40), reportRevision: 1 }, { noteId: other, state: 'failed', commit: 'a'.repeat(40), stage: 'analyzing', error: 'Generation request timed out while reviewing this Note.' },
        { noteId: child, state: 'incomplete', commit: 'a'.repeat(40), reportRevision: 2 }] } }
  const calls = { mark: [] as any[], run: 0, close: 0, read: 0 }
  const resultEvents = new Set<(result: BlueprintReviewResults) => void>()
  const events = new Set<(result: NoteReadResult) => void>(), undo = new Map<string, any[]>()
  let releaseReview: (() => void) | undefined
  let delay = 0, fail = false
  let automaticEnabled = true
  let failSync = false
  const readNote = window.electron.harness.noteRead
  window.electron.harness.noteRead = async (...args) => {
    const wait = delay, shouldFail = fail
    if (wait) await new Promise(resolve => setTimeout(resolve, wait))
    if (shouldFail) throw new Error('Fixture source unavailable')
    return readNote(...args)
  }
  Object.assign(window.electron.blueprintReview, {
    read: async () => { calls.read++; if (failSync) throw Error('Source temporarily unavailable'); return structuredClone(view) },
    activityRead: async () => structuredClone({ root, revision: view.activityRevision, automaticSettings: { enabled: automaticEnabled, commits: 5 }, automatic: view.automatic, activities: view.activities }),
    onResultsChanged: (listener: (result: BlueprintReviewResults) => void) => { resultEvents.add(listener); return () => resultEvents.delete(listener) },
    onReadChanged: (listener: (result: NoteReadResult) => void) => { events.add(listener); return () => events.delete(listener) },
    markRead: async (_context: unknown, versions: any[], bulk: boolean) => {
      if (versions.some(version => Object.keys(version).sort().join(',') !== 'hash,noteId,path')) throw new Error('Invalid Note version payload')
      calls.mark.push({ versions, bulk })
      if (fail) throw new Error('Reading state could not be saved')
      const token = crypto.randomUUID(), previous = structuredClone(view.updates.entries)
      undo.set(token, previous)
      for (const version of versions) { const row = view.updates.entries.find((row: any) => row.noteId === version.noteId); if (row?.hash === version.hash) row.unread = false }
      view.updates.revision++
      for (const listener of events) listener(structuredClone({ context, updates: view.updates }))
      return structuredClone({ context, updates: view.updates, ...(bulk ? { undoToken: token, expiresAt: Date.now() + 8000 } : {}) })
    },
    undoRead: async (token: string) => { view.updates.entries = undo.get(token); view.updates.revision++; return structuredClone({ context, updates: view.updates }) },
    run: async () => { calls.run++; return view.items[0] },
    close: async () => { calls.close++; return 'closed' },
  })
  ;(window as any).attentionFixture = { view, calls, deep, other, child,
    holdOldRead: () => {
      const old = structuredClone(view)
      window.electron.blueprintReview.read = () => new Promise(resolve => { releaseReview = () => resolve(old) })
      void useBlueprintReviewStore.getState().refresh(root)
    },
    writeRepair: async () => {
      useBlueprintStore.setState({ currentBlueprint: structuredClone(graph) })
      const node = graph.nodes[deep], hash = 'c'.repeat(64)
      node.sourceHash = hash; node.note!.body = 'Repaired recovery checkpoint: resume from the last persisted step.'
      const entry = graph.noteSnapshot!.entries.find(entry => entry.uri === node.sourceUri)!
      entry.sourceHash = hash; entry.doc = node.note
      graph.noteSnapshot!.coverage.snapshotHash = hash
      graph.contentRevision++
      const source = await useNoteSourceStore.getState().refresh(root, node.sourceUri!, true)
      useBlueprintStore.getState().applyNoteSource(root, source)
    },
    publishReview: () => {
      view.revision++; view.items[0].reportRevision++; view.items[0].report.findings = []
      for (const listener of resultEvents) listener(structuredClone({ context, revision: view.revision, items: view.items }))
    },
    failSync: (value: boolean) => { failSync = value },
    delay: (value: number) => { delay = value }, fail: (value: boolean) => { fail = value },
    holdReview: () => {
      useBlueprintReviewStore.setState({ views: {}, errors: {} })
      window.electron.blueprintReview.read = () => new Promise(resolve => { releaseReview = () => resolve(structuredClone(view)) })
      void useBlueprintReviewStore.getState().refresh(root)
    },
    releaseReview: async () => {
      window.electron.blueprintReview.read = async () => structuredClone(view)
      releaseReview?.(); releaseReview = undefined
      await useBlueprintReviewStore.getState().refresh(root)
    },
    enabled: async (value: boolean) => { automaticEnabled = value; view.activityRevision++; await useBlueprintActivityStore.getState().refresh(root) },
    update: async (id: string) => {
      const entry = view.updates.entries.find((entry: any) => entry.noteId === id)
      entry.hash = 'b'.repeat(64); entry.unread = true; view.updates.revision++
      graph.nodes[id].sourceHash = entry.hash
      graph.contentRevision++
      useBlueprintStore.setState({ currentBlueprint: structuredClone(graph) })
      await useBlueprintReviewStore.getState().refresh(root)
    },
    refresh: () => useBlueprintReviewStore.getState().refresh(root),
  }
}
