import { describe, expect, it } from 'vitest'
import { PluginConfigurationDrafts, type PluginConfigurationDraft } from '../../src/renderer/src/extensions/plugin-configuration-drafts'

const target = { id: 'example.plugin', digest: 'revision-a', projectId: null, scopePath: null }
const draft = { configuration: { revision: 'saved-a', values: { label: 'old' }, inherited: {}, overrides: {}, issues: [], migrations: [] },
  patch: { label: 'unsaved' }, reviewing: false } as unknown as PluginConfigurationDraft

describe('plugin configuration draft ownership', () => {
  it('restores a draft across navigation without mixing projects, worktrees or package revisions', () => {
    const store = new PluginConfigurationDrafts()
    store.write(target, draft)
    const project = { ...target, projectId: 'project-a', scopePath: 'C:/project/worktree-a' }
    store.write(project, { ...draft, patch: { label: 'project draft' } })
    expect(store.read(target)?.patch.label).toBe('unsaved')
    expect(store.read(project)?.patch.label).toBe('project draft')
    expect(store.read({ ...project, scopePath: 'C:/project/worktree-b' })).toBeUndefined()
    expect(store.read({ ...target, digest: 'revision-b' })).toBeUndefined()
    expect(store.read({ ...project, projectId: 'project-b' })).toBeUndefined()
  })
  it('retains the original revision for save conflict detection and copies mutable values', () => {
    const store = new PluginConfigurationDrafts()
    store.write(target, draft)
    const read = store.read(target)!
    read.configuration.revision = 'overwrite'
    read.patch.label = 'overwrite'
    expect(store.read(target)?.configuration.revision).toBe('saved-a')
    expect(store.read(target)?.patch.label).toBe('unsaved')
  })
  it('clears only the saved scope, and removes every scope when private data is deleted', () => {
    const store = new PluginConfigurationDrafts()
    const project = { ...target, projectId: 'project', scopePath: 'C:/work' }
    const other = { ...target, id: 'other.plugin' }
    for (const value of [target, project, other]) store.write(value, draft)
    store.write(target, { ...draft, patch: {} })
    expect(store.read(target)).toBeUndefined()
    expect(store.read(project)).toBeDefined()
    store.clearPlugin(target.id)
    expect(store.read(project)).toBeUndefined()
    expect(store.read(other)).toBeDefined()
  })
})
