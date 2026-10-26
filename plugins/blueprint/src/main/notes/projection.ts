// Note: .agents/notes/planning/blueprint-official-plugin.md - blueprint projection consumes the owning Note service.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { Diagnostic } from '@janus-agent/harness-core'
import { indexEntries, toSlimSnapshot, type NoteIndex, type LoadedNoteEntry } from '@janus-agent/harness-node'
import { projectGraph, projectGraphId } from './note-to-blueprint'
import { composeBlueprint } from '../blueprint/blueprint-composition'
import { ADAPTER_VERSION } from './note-types'
import type { Blueprint } from '../../shared/janus/types'

export interface BlueprintProjectionSource {
  readIndex(root: string): Promise<{ rev: number; index: NoteIndex }>
  repoName(root: string): Promise<string>
  readCoverage(root: string, rev: number, entries: LoadedNoteEntry[], repoId: string): Promise<Map<string, {
    taskDone: boolean; requirement: { covered: boolean; uncovered: string[] } | null; acCount: number
  }>>
}

export interface ProjectView {
  blueprint: Blueprint
  rev: number
  repoId: string | null
  repoName: string
  invalid: Array<{ relPath: string; diagnostics: Diagnostic[] }>
  adapterVersion: string
}

export class BlueprintNoteProjection {
  constructor(private readonly source: BlueprintProjectionSource) {}

  // Note: display only this workspace; cross-workspace references stay in the source; see .agents/notes/blueprint/workspaces/module.md
  async projectView(root: string): Promise<ProjectView> {
    const view = await this.singleProjectView(root)
    return { ...view, blueprint: composeBlueprint({ skeleton: view.blueprint, checkouts: [], localOnly: true }) }
  }

  private async singleProjectView(root: string): Promise<ProjectView> {
    const started = Date.now()
    // Note: reads refresh through the hash-only probe; unchanged bytes ride
    // the cached index allocation-only, changed files patch incrementally.
    // Only the watcher path and explicit rescan skip the probe.
    const { index, rev } = await this.source.readIndex(root)
    const afterCache = Date.now()
    const { entries, invalid } = indexEntries(index)
    const repoName = await this.source.repoName(root)
    const ui = await this.loadUiState(root)
    const blueprint = projectGraph(
      {
        repoId: index.repoId,
        repoName,
        entries: entries.map((e) => ({ doc: e.doc, relPath: e.relPath, sha256: e.sha256 })),
        revision: rev,
        snapshot: toSlimSnapshot(index),
      },
      root,
    )
    // Transport slimming: cards and composition overlays read metadata only;
    // bodies/sections travel on demand via readNote, never on every load.
    for (const node of Object.values(blueprint.nodes)) {
      if (node.note && (node.note.body || (node.note.sections?.length ?? 0) > 0)) {
        node.note = { ...node.note, body: undefined, sections: [] }
      }
    }
    const afterProject = Date.now()
    blueprint.canvasLayout = ui.canvasLayout
    blueprint.collapsedNodeIds = ui.collapsedNodeIds
    // Invalid notes stay out of the graph but travel on the projection for
    // the invalid-lane UI; the canvas must never throw on them.
    blueprint.invalidNotes = invalid.map((item) => ({
      relPath: item.relPath,
      classification: item.classification,
      diagnostics: item.diagnostics.map((d) => ({ code: d.code, message: d.message })),
    }))
    // Note: coverage comes from portable receipts - see .agents/notes/agent/harness-execution-adapter-s8.md
    if (index.repoId) {
      const overlay = await this.source.readCoverage(root, rev, entries, index.repoId)
      for (const node of Object.values(blueprint.nodes)) {
        const state = overlay.get(node.id)
        if (!state) continue
        node.noteEvidence = { taskDone: Boolean(state.taskDone), ...(state.requirement ? { coveredACs: state.acCount - state.requirement.uncovered.length, totalACs: state.acCount } : {}) }
        if (state.taskDone) { node.status = 'done'; node.progress = 100 }
        if (state.requirement) {
          for (const feature of node.features) {
            const covered = !state.requirement.uncovered.includes(feature.id)
            feature.progress = covered ? 100 : 0
            feature.status = covered ? 'done' : 'planned'
          }
          node.progress = state.acCount ? Math.round(100 * (state.acCount - state.requirement.uncovered.length) / state.acCount) : 0
          if (state.requirement.covered) node.status = 'done'
        }
      }
    }
    console.debug(`[blueprint-r7] projectView rev=${rev} cache=${afterCache - started}ms project=${afterProject - afterCache}ms overlay=${Date.now() - afterProject}ms total=${Date.now() - started}ms root=${root}`)
    return { blueprint, rev, repoId: index.repoId, repoName, invalid, adapterVersion: ADAPTER_VERSION }
  }

  projectIdForRoot(root: string, repoId: string | null): string {
    return projectGraphId(repoId, root)
  }

  /** Canvas-only overlay state. Local, never shared, best effort. */
  async loadUiState(root: string): Promise<{ canvasLayout: Record<string, { x: number; y: number }>; collapsedNodeIds: string[] | null }> {
    try {
      const raw = await readFile(join(root, '.agents', '.local', 'ui', 'project.json'), 'utf8')
      const data = JSON.parse(raw) as { canvasLayout?: unknown; collapsedNodeIds?: unknown }
      return {
        canvasLayout: (data.canvasLayout ?? {}) as Record<string, { x: number; y: number }>,
        collapsedNodeIds: Array.isArray(data.collapsedNodeIds) ? (data.collapsedNodeIds as string[]) : null,
      }
    } catch {
      return { canvasLayout: {}, collapsedNodeIds: null }
    }
  }

  async saveUiState(
    root: string,
    patch: { canvasLayout?: Record<string, { x: number; y: number }>; collapsedNodeIds?: string[] | null },
  ): Promise<void> {
    const current = await this.loadUiState(root)
    const next = {
      canvasLayout: patch.canvasLayout ?? current.canvasLayout,
      collapsedNodeIds: patch.collapsedNodeIds !== undefined ? patch.collapsedNodeIds : current.collapsedNodeIds,
    }
    const file = join(root, '.agents', '.local', 'ui', 'project.json')
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, JSON.stringify(next, null, 2), 'utf8')
  }

}
