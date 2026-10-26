import { LEGACY_HARNESS_PROFILE, SUPPORTED_HARNESS_PROFILE } from '@janus-agent/harness-node';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parseNote, validateNote } from '@janus-agent/harness-core'
import { buildNoteIndex } from '@janus-agent/harness-node'
import type { Blueprint } from '../../plugins/blueprint/src/shared/janus/types'
import { applyMigration, previewMigration } from '../../plugins/blueprint/src/main/notes/legacy-conversion'

const REPO = '8fa19f17-c717-43a8-93a7-810a5e0cbc91'
const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })

function fixture(): Blueprint {
  return {
    schemaVersion: 4, source: 'json', contentRevision: 3, id: 'bp-legacy', name: 'Legacy Board', description: 'Old planning board.',
    rootNodeId: 'epic', nodeIds: ['epic', 'feat', 'work', 'bugs'],
    nodes: {
      epic: {
        id: 'epic', title: 'Epic One', type: 'epic', status: 'in-progress', progress: 20, statusSource: 'manual',
        positioning: 'Core area.', description: 'Do the core thing.', features: [], completedItems: [], techSolution: 'Use modules.',
        notes: '', todos: [{ id: 't1', text: 'Confirm scope', done: false }], issues: [], activities: [{ id: 'a1', type: 'note', content: 'Kicked off.', createdAt: '2026-01-01' }],
        analyses: [{ id: 'an1', nodeId: 'epic', trigger: 'manual', inputSummary: { blueprint: '', actual: '' }, result: { schemaVersion: 1, progress: 20, status: 'in-progress', summary: 'On track.', confidence: 0.8, evidence: [], unresolved: [], discoveredRequirements: [], featureUpdates: [] }, applied: false, createdAt: '2026-01-02' }],
        children: ['feat', 'work', 'bugs'], parentId: null,
        workspaceId: null, primaryWorkspaceId: null, linkedWorkspaceIds: [], workspaceSnapshot: null, boundTerminalId: null,
      },
      feat: {
        id: 'feat', title: 'Feature A', type: 'feature', status: 'done', progress: 100, statusSource: 'manual',
        positioning: '', description: 'Ship feature A.', features: [{ id: 'f1', title: 'Login', description: '', progress: 100, status: 'done', requirementNotes: [], createdAt: '', updatedAt: '' }],
        completedItems: [], techSolution: '', notes: '', todos: [], issues: [],
        activities: [], analyses: [], children: [], parentId: 'epic',
        workspaceId: null, primaryWorkspaceId: null, linkedWorkspaceIds: [], workspaceSnapshot: null, boundTerminalId: null,
      },
      work: {
        id: 'work', title: 'Work item', type: 'task', status: 'in-progress', progress: 40, statusSource: 'manual',
        positioning: '', description: 'Implement the worker.', features: [], completedItems: ['Scaffold'], techSolution: '', notes: '', todos: [],
        issues: [], activities: [], analyses: [], children: [], parentId: 'epic',
        workspaceId: null, primaryWorkspaceId: null, linkedWorkspaceIds: [], workspaceSnapshot: null, boundTerminalId: null,
      },
      bugs: {
        id: 'bugs', title: 'Bug triage', type: 'issue', status: 'open', progress: 0, statusSource: 'manual',
        positioning: '', description: '', features: [], completedItems: [], techSolution: '', notes: '', todos: [],
        issues: [
          { id: 'i1', title: 'Crash on start', description: 'Null deref.', severity: 'high', status: 'open', createdAt: '' },
          { id: 'i2', title: 'Typo', description: '', severity: 'low', status: 'resolved', createdAt: '', resolvedAt: '' },
        ],
        activities: [], analyses: [], children: [], parentId: null,
        workspaceId: null, primaryWorkspaceId: null, linkedWorkspaceIds: [], workspaceSnapshot: null, boundTerminalId: null,
      },
    },
    relations: [
      { id: 'r1', sourceNodeId: 'work', targetNodeId: 'feat', type: 'depends-on', createdAt: '', updatedAt: '' },
      { id: 'r2', sourceNodeId: 'work', targetNodeId: 'epic', type: 'implements', createdAt: '', updatedAt: '' },
      { id: 'r3', sourceNodeId: 'feat', targetNodeId: 'bugs', type: 'related-to', createdAt: '', updatedAt: '' },
      { id: 'r4', sourceNodeId: 'epic', targetNodeId: 'bugs', type: 'related-to', createdAt: '', updatedAt: '' },
    ],
    requirementCandidates: [
      { id: 'c1', blueprintId: 'bp-legacy', sourceNodeId: 'epic', sourceAnalysisId: 'an1', title: 'Maybe later', description: '', suggestedParentId: 'epic', confidence: 0.4, status: 'pending', evidence: [], createdAt: '' },
    ],
    mountedTo: null, canvasLayout: {}, createdAt: '', updatedAt: '',
  } as unknown as Blueprint
}

const audits = [
  { id: 'audit-1', taskId: 'task-1', changeSetId: 'cs-1', blueprintId: 'bp-legacy', beforeRevision: 2, afterRevision: 3, selectedOperationIds: ['op-1'], rejectedOperationIds: [], status: 'applied', changeSetSnapshot: {}, beforeSnapshot: {}, createdAt: '2026-02-01', appliedAt: '2026-02-02' },
] as never

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'blueprint-migrate-'))
  roots.push(root)
  await mkdir(join(root, '.agents', 'notes'), { recursive: true })
  await writeFile(join(root, '.agents', 'harness.json'), JSON.stringify({ schemaVersion: 1, repoId: REPO, name: 'Migrate', profile: LEGACY_HARNESS_PROFILE }))
  return root
}

describe('legacy blueprint migration', () => {
  it('imports v2 documents under their module, keeps duplicate titles distinct, and refuses a mismatched checkout', async () => {
    const root = await makeRoot()
    const moduleId = '22222222-2222-4222-8222-222222222222'
    const moduleUri = `note://${REPO}/${moduleId}`
    await writeFile(join(root, '.agents/harness.json'), JSON.stringify({ schemaVersion: 1, repoId: REPO, name: 'V2', profile: SUPPORTED_HARNESS_PROFILE }))
    await writeFile(join(root, '.agents/notes/module.md'), `---\n${JSON.stringify({ schema: 'harness-note/2', id: moduleId, kind: 'module', role: 'project', lifecycle: 'accepted', created: '2026-10-08', updated: '2026-10-08T00:00:00Z', moduleState: 'partial' })}\n---\n# Project\n\nOwns imported history.\n`)
    const blueprint = fixture()
    blueprint.nodes.work.title = blueprint.nodes.feat.title
    const context = { schema: 'harness-note/2' as const, module: moduleUri, directory: '' }
    const preview = previewMigration(blueprint, REPO, audits, context)
    expect(preview.notes.some(note => ['task', 'initiative'].includes(note.kind))).toBe(false)
    expect(preview.relationCount).toBeGreaterThan(0)
    await expect(applyMigration(root, moduleId, blueprint, audits, async () => '')).rejects.toThrow('selected checkout')
    const result = await applyMigration(root, REPO, blueprint, audits, async () => '/archived/source.json')
    const index = await buildNoteIndex(root)
    expect(index.diagnostics).toEqual([])
    expect(index.byId.size).toBe(result.uris.length + 1)
    for (const entry of index.entries.filter(entry => entry.note?.meta.kind !== 'module')) {
      expect(entry.diagnostics).toEqual([])
      expect(entry.note!.meta).toMatchObject({ schema: 'harness-note/2', module: moduleUri, lifecycle: 'draft' })
      expect(entry.note!.meta.kind).not.toBe('task')
    }
    expect(index.entries.some(entry => entry.relPath === '.agents/notes/feature-a-2.md')).toBe(true)
    expect(index.entries.some(entry => `note://${REPO}/${entry.note?.meta.id}` === result.reportUri)).toBe(true)
  })

  it('previews kinds, lifecycles, relations, and warnings without writing', async () => {
    const root = await makeRoot()
    const preview = previewMigration(fixture(), REPO, audits)
    expect(preview).toMatchObject({ blueprintId: 'bp-legacy', nodeCount: 4, auditCount: 1, appliedAuditCount: 1, targetRepoId: REPO })
    const kinds = preview.notes.map((note) => `${note.kind}/${note.lifecycle}`).sort()
    expect(kinds).toContain('requirement/draft')
    expect(kinds).toContain('task/draft')
    expect(kinds).toContain('decision/draft')
    expect(kinds).toContain('initiative/draft')
    expect(kinds).toContain('idea/draft')
    expect(kinds).not.toContain('task/archived')
    expect(preview.relationCount).toBeGreaterThan(0)
    expect(preview.warnings.some((warning) => warning.includes('done'))).toBe(true)
    expect(preview.warnings.some((warning) => warning.includes('as evidence'))).toBe(true)
    const { readdir } = await import('node:fs/promises')
    expect(await readdir(join(root, '.agents', 'notes'))).toEqual([])
  })

  it('applies valid notes, anchors relations, archives the source', async () => {
    const root = await makeRoot()
    const blueprint = fixture()
    let archived = ''
    const result = await applyMigration(root, REPO, blueprint, audits, async (id) => { archived = `/archived/${id}.json`; return archived })
    expect(result.uris.length).toBeGreaterThan(6)
    expect(archived).toContain('bp-legacy')
    const index = await buildNoteIndex(root)
    const notes = [...index.byId.values()].map((entry) => entry.note)
    expect(notes.length).toBe(result.uris.length)
    for (const note of notes) {
      expect(validateNote(note!)).toEqual([])
    }
    const byKind = (kind: string) => notes.filter((note) => note!.meta.kind === kind)
    expect(byKind('initiative')).toHaveLength(1)
    const requirement = byKind('requirement')[0]!
    const workTask = byKind('task').find((note) => note!.title === 'Work item')!
    expect((requirement.meta.relations ?? []).some((relation) => relation.type === 'governed-by')).toBe(true)
    const depends = (workTask.meta.relations ?? []).find((relation) => relation.type === 'depends-on')
    expect(depends).toBeTruthy()
    expect(result.uris).toContain(depends!.target as string)
    const impl = (workTask.meta.relations ?? []).find((relation) => relation.type === 'implements')
    expect(impl).toBeTruthy()
    expect(result.uris).toContain(impl!.target as string)
    const report = byKind('idea').find((note) => note!.title.startsWith('Migration report'))!
    expect(report.sections.some((section) => section.name === 'Background')).toBe(true)
    await expect(applyMigration(root, REPO, { ...blueprint, source: 'harness' } as Blueprint, audits, async () => '')).rejects.toMatchObject({ code: 'SCHEMA_INVALID' })
  })

  it('refuses harness blueprints without touching anything', async () => {
    const root = await makeRoot()
    expect(() => previewMigration({ ...fixture(), source: 'harness' } as Blueprint, REPO, audits)).toThrow()
    const { readdir } = await import('node:fs/promises')
    expect(await readdir(join(root, '.agents', 'notes'))).toEqual([])
  })
})
