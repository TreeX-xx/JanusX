// Note: workspace visibility and explicit initialization — see .agents/notes/blueprint/workspaces/requirements/blueprint-empty-init.md
import { randomUUID } from 'node:crypto'
import { lstat, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { previewHarnessInit, applyHarnessInit, undoHarnessInit, readHarnessIdentity, type HarnessInitPlan } from '@janus-agent/harness-node'
import type { HarnessInitPreview, HarnessWorkspaceStatus } from '../../shared/workspace'
import { projectGraphId } from './note-to-blueprint'
import type { NoteService } from '@janus-agent/harness-node'

const message = (error: unknown): string => error && typeof error === 'object' && 'message' in error ? String(error.message) : String(error)
async function exists(path: string): Promise<boolean> {
  try { await lstat(path); return true } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

export class WorkspaceBlueprintService {
  private previews = new Map<string, { owner: number; plan: HarnessInitPlan; foreign: boolean; applied: boolean; busy: boolean; expires: number }>()
  constructor(private readonly notes: Pick<NoteService, 'readSnapshot' | 'rescan'>) {}

  async status(cwd: string): Promise<HarnessWorkspaceStatus> {
    const root = resolve(cwd)
    const base = { root, noteCount: 0, diagnostics: [] }
    try {
      if (!(await lstat(root)).isDirectory()) throw new Error('Workspace is not a directory')
      if (!await exists(join(root, '.agents'))) return { ...base, state: 'not-found' }
      const snapshot = await this.notes.readSnapshot(root)
      const valid = snapshot.entries.filter(entry => entry.classification === 'valid')
      const problems = snapshot.entries.filter(entry => !['valid', 'foreign'].includes(entry.classification))
      const diagnostics = [...snapshot.diagnostics, ...problems.flatMap(entry => entry.diagnostics.map(d => ({ ...d, path: d.path ?? entry.relPath })))]
      if (!await exists(join(root, '.agents/harness.json'))) {
        if (valid.length || problems.length) return { ...base, state: 'invalid', diagnostics: [...diagnostics, { code: 'NOT_READY', path: '.agents/harness.json', message: 'Notes exist without a project identity. Restore the identity before generating more Notes.' }] }
        const files = await readdir(join(root, '.agents'))
        const foreign = snapshot.entries.length > 0 || files.some(name => !['notes', '.local'].includes(name))
        return { ...base, state: foreign ? 'foreign' : 'not-found' }
      }
      const identity = await readHarnessIdentity(root)
      const projectId = projectGraphId(identity.repoId, root)
      if (!valid.length && identity.diagnostics.length) return { ...base, state: 'invalid', projectId, diagnostics: [...identity.diagnostics, ...diagnostics] }
      if (snapshot.coverage.status !== 'complete') return { ...base, state: 'error', diagnostics }
      return { root, projectId, noteCount: valid.length, diagnostics,
        state: valid.length ? 'ok' : problems.length ? 'invalid' : 'empty' }
    } catch (error) { return { ...base, state: 'error', diagnostics: [{
      code: error && typeof error === 'object' && 'code' in error ? String(error.code) : 'IO_ERROR', message: message(error),
    }] } }
  }

  async preview(cwd: string, name: string, owner: number): Promise<HarnessInitPreview> {
    const state = await this.status(cwd)
    if (!['not-found', 'foreign'].includes(state.state)) throw new Error('Workspace is not available for initialization. Refresh its status.')
    for (const [id, entry] of this.previews) if (!entry.busy && entry.expires < Date.now()) this.previews.delete(id)
    if (this.previews.size >= 100) throw new Error('Too many initialization previews. Close this window and try again.')
    const plan = await previewHarnessInit(state.root, name)
    if (plan.existing) throw new Error('Project was initialized elsewhere. Refresh its status.')
    const id = randomUUID()
    this.previews.set(id, { owner, plan, foreign: state.state === 'foreign', applied: false, busy: false, expires: Date.now() + 24 * 60 * 60 * 1000 })
    return { id, root: plan.root, foreign: state.state === 'foreign', files: plan.files.map(({ path, content }) => ({ path, content })) }
  }

  private entry(cwd: string, id: string, owner: number) {
    const entry = this.previews.get(id)
    if (!entry || entry.owner !== owner || resolve(cwd) !== entry.plan.root || entry.expires < Date.now()) throw new Error('Initialization preview expired. Request a new preview.')
    if (entry.busy) throw new Error('Initialization is already in progress')
    return entry
  }

  async apply(cwd: string, id: string, owner: number, confirmForeign: boolean): Promise<{ refreshError?: string }> {
    const entry = this.entry(cwd, id, owner)
    entry.busy = true
    try {
      if (!entry.applied) {
        const current = await this.status(cwd)
        if (!['not-found', 'foreign'].includes(current.state)) throw new Error('Workspace changed after preview. Refresh before initializing.')
        if ((entry.foreign || current.state === 'foreign') && confirmForeign !== true) throw new Error('Confirm preservation of existing .agents files before initializing.')
      }
      await applyHarnessInit(entry.plan)
      entry.applied = true
      return await this.refresh(entry.plan.root)
    } finally { entry.busy = false }
  }

  async undo(cwd: string, id: string, owner: number): Promise<{ refreshError?: string }> {
    const entry = this.entry(cwd, id, owner)
    entry.busy = true
    try {
      await undoHarnessInit(entry.plan)
      this.previews.delete(id)
      return await this.refresh(entry.plan.root)
    } finally { entry.busy = false }
  }

  private async refresh(root: string): Promise<{ refreshError?: string }> {
    // A cache failure must not hide a completed write or its undo handle.
    try { await this.notes.rescan(root); return {} }
    catch (error) { return { refreshError: message(error) } }
  }

  release(owner: number): void {
    for (const [id, entry] of this.previews) if (entry.owner === owner && !entry.busy) this.previews.delete(id)
  }
}

