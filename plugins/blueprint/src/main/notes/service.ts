// Note: Janus extends the shared agentX runtime — see .agents/notes/blueprint/agentx-harness-inheritance.md
import { BlueprintReadTasks } from '../blueprint/read-task'
import { resolve } from 'node:path'
import { NoteService, type NoteIndex } from '@janus-agent/harness-node'
import * as sharedHarness from '@janus-agent/harness-node'
import { setTimeout as delay } from 'node:timers/promises'
import { BlueprintNoteProjection, type ProjectView } from './projection'
export type { ProjectView } from './projection'
export type BlueprintNotes = Pick<NoteService, 'resolveRoot' | 'readSnapshot' | 'readNote' | 'applyBundleChangeSet'> & Pick<BlueprintNoteProjection, 'projectView'>
// Keep value exports bound locally: the main bundle materializes this module's namespace during dynamic import.
export const assertNoLocalLeak = sharedHarness.assertNoLocalLeak
export const claimsHarnessSchema = sharedHarness.claimsHarnessSchema
export const stripRemoteCreds = sharedHarness.stripRemoteCreds
export type { ResolveResult, ShareSelection, ShareSnapshot, BindingRecord, ChangeListener } from '@janus-agent/harness-node'

// The host and standalone MCP may scan the same checkout in another process.
// Retry only index/proof reads after lock contention; never replay a submitted write.
async function waitForNoteRead<T>(read: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  const deadline = Date.now() + 10_000
  for (;;) {
    signal?.throwIfAborted()
    try { return await read() }
    catch (error) {
      if ((error as { code?: string })?.code !== 'BUSY' || Date.now() >= deadline) throw error
      await delay(100, undefined, { signal })
    }
  }
}

export class BlueprintNoteService extends NoteService {
  // Note: startup and foreground reads share the cold scan — see .agents/notes/blueprint/requirements/blueprint-performance.md
  private indexReads = new BlueprintReadTasks<{ rev: number; index: NoteIndex }>()

  protected override refreshIndex(root: string): Promise<{ rev: number; index: NoteIndex }> {
    const path = resolve(root)
    const key = process.platform === 'win32' ? path.toLowerCase() : path
    return this.indexReads.run(key, async signal => {
      const result = await waitForNoteRead(() => super.refreshIndex(path), signal)
      signal.throwIfAborted()
      return result
    })
  }

  override rescan(root: string): Promise<{ rev: number; ms: number }> {
    return waitForNoteRead(() => super.rescan(root))
  }

  override async warmup(root: string): Promise<{ rev: number; ms: number }> {
    const started = Date.now()
    const resolved = await this.resolveRoot(root)
    if (!resolved.ok || !resolved.root) throw new Error(`no project notes under ${root}`)
    const { rev } = await this.refreshIndex(resolved.root)
    return { rev, ms: Date.now() - started }
  }

  private readonly projection = new BlueprintNoteProjection({
    readIndex: root => this.refreshIndex(root),
    repoName: root => this.repoName(root),
    // Graph proof reads share the Notes lock; see .agents/notes/planning/blueprint-official-plugin.md.
    readCoverage: (root, rev, entries, repoId) => waitForNoteRead(() => this.coverageOverlay(root, rev, entries, repoId)),
  })

  projectView(root: string): Promise<ProjectView> { return this.projection.projectView(root) }
  projectIdForRoot(root: string, repoId: string | null): string { return this.projection.projectIdForRoot(root, repoId) }
  loadUiState(root: string) { return this.projection.loadUiState(root) }
  saveUiState(root: string, patch: Parameters<BlueprintNoteProjection['saveUiState']>[1]) { return this.projection.saveUiState(root, patch) }
}
export const blueprintNoteService = new BlueprintNoteService()
