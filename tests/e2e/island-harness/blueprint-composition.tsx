import React from 'react'
import { createRoot } from 'react-dom/client'
import { BlueprintCanvas } from '../../../src/renderer/src/components/blueprint/BlueprintCanvas'
import { installElectronApiFallback } from '../../../src/renderer/src/lib/electron-api-fallback'
import { initI18n } from '../../../src/renderer/src/i18n'
import { useBlueprintStore } from '../../../src/renderer/src/stores/blueprint'
import { useWorkspaceStore } from '../../../src/renderer/src/stores/workspace'
import type { Blueprint, BlueprintNode } from '../../../plugins/blueprint/src/shared/janus/types'
import type { NoteReadSnapshot } from '../../../src/shared/notes'
import '../../../src/renderer/src/styles/globals.css'
import '../../../src/renderer/src/components/blueprint/blueprint.css'

installElectronApiFallback()
Object.assign(window.electron.system, { getLanguage: async () => 'zh-CN', onPrepareQuit: () => () => {} })
const R = '11111111-1111-4111-8111-111111111111', D = '22222222-2222-4222-8222-222222222222'
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const uri = (repo: string) => 'note://' + repo + '/' + A
function node(id: string, title: string, repo: string, path: string): BlueprintNode {
  return { id, title, type: 'epic', kind: 'initiative', lifecycle: 'accepted', status: 'in-progress', progress: 0, statusSource: 'manual', positioning: '', description: title, features: [], completedItems: [], techSolution: '', notes: '', todos: [], issues: [], activities: [], analyses: [], workspaceId: null, primaryWorkspaceId: null, linkedWorkspaceIds: [], workspaceSnapshot: { name: title, path }, boundTerminalId: null, terminalHistory: [], lastAnalyzedCommitSha: null, children: [], parentId: null, tags: [], createdAt: '', updatedAt: '', sourceUri: uri(repo), sourceHash: 'a'.repeat(64), sourceRelPath: '.agents/notes/a.md', note: { id: A, title, kind: 'initiative', lifecycle: 'accepted', tags: [], parent: null, sections: [], acs: [], relations: [], body: '# ' + title, metadata: { schema: 'harness-note/1', id: A, kind: 'initiative', lifecycle: 'accepted', created: '2026-09-25' } } }
}
const root = node('root', 'Architecture', R, 'C:/architecture')
const x = node('x', 'Provider checkout X', D, 'C:/dev-x'), y = node('y', 'Provider checkout Y', D, 'C:/dev-y')
function snapshot(value: BlueprintNode, repoId: string): NoteReadSnapshot {
  return { repoId, entries: [{ uri: value.sourceUri, relPath: value.sourceRelPath!, sourceHash: value.sourceHash!, classification: 'valid', diagnostics: [], doc: value.note }], relations: [], mentions: [], diagnostics: [], coverage: { checkoutRoot: value.workspaceSnapshot!.path, status: 'complete', snapshotHash: value.id, diagnostics: [] } }
}
const blueprint: Blueprint = { id: 'harness:project:fixture', name: 'Composition fixture', source: 'harness', adapterVersion: 'v2', contentRevision: 3, description: '', rootNodeId: 'root', nodeIds: ['root', 'x', 'y'], nodes: { root, x, y }, relations: [], requirementCandidates: [], mountedTo: null, canvasLayout: {}, collapsedNodeIds: [], createdAt: '', updatedAt: '', noteSnapshot: snapshot(root, R), composition: { version: 'r4', nodes: { root: { layer: 'skeleton', repoId: R, status: 'bound', path: 'C:/architecture' }, x: { layer: 'evidence', repoId: D, checkoutId: 'x', status: 'bound', path: 'C:/dev-x' }, y: { layer: 'evidence', repoId: D, checkoutId: 'y', status: 'stale', path: 'C:/dev-y' } }, checkouts: [{ repoId: D, checkoutId: 'x', path: 'C:/dev-x', revision: 1, status: 'bound', nodeIds: ['x'], snapshot: snapshot(x, D) }, { repoId: D, checkoutId: 'y', path: 'C:/dev-y', revision: 2, selected: true, status: 'stale', nodeIds: ['y'], snapshot: snapshot(y, D) }, { repoId: 'unavailable', checkoutId: 'missing', path: 'C:/missing', revision: null, status: 'unbound', nodeIds: [] }], interfaces: [{ id: 'needs', nodeId: 'root', name: 'reader', direction: 'needs', provider: uri(D), providerNodeId: 'y', status: 'stale' }, { id: 'provides', nodeId: 'y', name: 'reader', direction: 'provides', status: 'stale' }, { id: 'idle', nodeId: 'x', name: 'reader', direction: 'provides', status: 'idle' }, { id: 'dangling', nodeId: 'root', name: 'writer', direction: 'needs', status: 'dangling' }], evidence: [], diagnostics: [{ code: 'UNBOUND_CHECKOUT', message: 'Checkout unavailable: C:/missing' }] } }
const fixture = { reads: [] as string[], saves: [] as unknown[] }
;(window as any).compositionFixture = fixture
Object.assign(window.electron.harness, { noteRead: async (path: string, target: string) => {
  fixture.reads.push(path + '|' + target)
  const value = Object.values(blueprint.nodes).find(item => item.workspaceSnapshot?.path === path && item.sourceUri === target)!
  return { uri: target, relPath: value.sourceRelPath, raw: value.note!.body, sourceHash: value.sourceHash, indexedSourceHash: value.sourceHash, matchesSnapshot: true, doc: { ...value.note, body: value.note!.body + String.fromCharCode(10) + 'Source from ' + path }, view: { excerpt: value.title, headings: [], links: [] } }
} })
Object.assign(window.electron.knowledge, { noteWikiPages: async () => [] })
Object.assign(window.electron.janus, { updateBlueprint: async (...args: unknown[]) => { fixture.saves.push(args); return blueprint }, getBlueprint: async () => blueprint })
useBlueprintStore.setState({ currentBlueprint: blueprint, blueprintWorkspace: { [blueprint.id]: 'C:/architecture' }, loading: false, loadBlueprint: async () => { useBlueprintStore.setState({ currentBlueprint: structuredClone(blueprint) }) } })
useWorkspaceStore.setState({ workspaces: [] })
void initI18n().then(() => createRoot(document.getElementById('root')!).render(<main style={{ height: '100vh' }}><BlueprintCanvas blueprintId={blueprint.id} /></main>))
