import type { Blueprint } from '../../../plugins/blueprint/src/shared/janus/types'
import type { HarnessWorkspaceStatus } from '../../../src/shared/ipc/harness'

export function installBootstrapFixture(graph: Blueprint) {
  const statuses: Record<string, HarnessWorkspaceStatus> = {
    'C:/fixture': { state: 'ok', root: 'C:/fixture', projectId: graph.id, noteCount: graph.nodeIds.length, diagnostics: [] },
    'C:/fixture-b': { state: 'not-found', root: 'C:/fixture-b', noteCount: 0, diagnostics: [] },
    'C:/fixture-empty': { state: 'empty', root: 'C:/fixture-empty', projectId: 'harness:project:empty', noteCount: 0, diagnostics: [] },
    'C:/fixture-invalid': { state: 'invalid', root: 'C:/fixture-invalid', noteCount: 0, diagnostics: [{ code: 'SCHEMA_INVALID', path: '.agents/notes/broken.md', message: 'Missing Note identity' }] },
    'C:/fixture-error': { state: 'error', root: 'C:/fixture-error', noteCount: 0, diagnostics: [{ code: 'IO_ERROR', message: 'Read denied' }] },
  }
  const graphs: Record<string, Blueprint> = { 'C:/fixture': graph,
    'C:/fixture-empty': { ...graph, id: 'harness:project:empty', nodeIds: [], nodes: {}, rootNodeId: '' } }
  const fixture = { applies: [] as string[], previews: [] as string[], undos: [] as string[] }
  if (new URLSearchParams(location.search).has('all-empty')) {
    for (const cwd of Object.keys(statuses)) {
      statuses[cwd] = { root: cwd, state: 'not-found', noteCount: 0, diagnostics: [] }
      delete graphs[cwd]
    }
  }
  ;(window as any).bootstrapFixture = fixture
  Object.assign(window.electron.harness, {
    workspaceStatus: async (cwd: string) => structuredClone(statuses[cwd]),
    initPreview: async (cwd: string) => {
      fixture.previews.push(cwd)
      return { id: 'preview', root: cwd, foreign: false, files: [
        { path: '.agents/harness.json', content: '{"name":"Checkout B"}' },
        { path: '.agents/notes/project.md', content: '---\nlifecycle: draft\n---\n# Checkout B' },
      ] }
    },
    initApply: async (cwd: string) => {
      fixture.applies.push(cwd)
      graphs[cwd] = { ...graph, id: 'harness:project:new', name: 'Checkout B' }
      statuses[cwd] = { root: cwd, state: 'ok', projectId: 'harness:project:new', noteCount: graph.nodeIds.length, diagnostics: [] }
    },
    initUndo: async (cwd: string) => {
      fixture.undos.push(cwd)
      delete graphs[cwd]
      statuses[cwd] = { root: cwd, state: 'not-found', noteCount: 0, diagnostics: [] }
    },
  })
  Object.assign(window.electron.janus, { loadBlueprint: async (cwd: string) => structuredClone(graphs[cwd]) })
}
