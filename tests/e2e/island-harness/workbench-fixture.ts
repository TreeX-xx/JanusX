import type { Blueprint, BlueprintNode } from '../../../plugins/blueprint/src/shared/janus/types'

// IPC data only: Workbench, Canvas, NoteWiki and the conversation controller
// execute current production code, including the application's Janus CSS.
export function createWorkbenchGraph(repoId: string, rootId: string, workspace: { id: string; name: string; path: string }): Blueprint {
  const childId = '55555555-5555-4555-8555-555555555555'
  const siblingId = '88888888-8888-4888-8888-888888888888'
  const otherId = '66666666-6666-4666-8666-666666666666'
  const lastId = '77777777-7777-4777-8777-777777777777'
  function node(id: string, title: string, parentId: string | null, body: string): BlueprintNode {
    const kind = parentId ? 'task' : 'initiative'
    const parent = parentId ? `note://${repoId}/${parentId}` : null
    return {
      id, title, type: 'epic', kind, lifecycle: 'accepted', status: 'in-progress',
      progress: 0, statusSource: 'manual', positioning: '', description: title,
      features: [], completedItems: [], techSolution: '', notes: '', todos: [],
      issues: [], activities: [], analyses: [], workspaceId: workspace.id,
      primaryWorkspaceId: workspace.id, linkedWorkspaceIds: [],
      workspaceSnapshot: { name: workspace.name, path: workspace.path },
      boundTerminalId: null, terminalHistory: [], lastAnalyzedCommitSha: null,
      children: id === rootId ? [childId, siblingId] : [], parentId, tags: [],
      createdAt: '2026-09-25T00:00:00Z', updatedAt: '2026-09-25T00:00:00Z',
      sourceUri: `note://${repoId}/${id}`, sourceHash: 'a'.repeat(64),
      sourceRelPath: `.agents/notes/${id}.md`,
      note: { id, title, kind, lifecycle: 'accepted', tags: [], parent,
        sections: [], acs: [], relations: [], body: `# ${title}

${body}`,
        metadata: { schema: 'harness-note/1', id, kind, lifecycle: 'accepted', created: '2026-09-25', ...(parent ? { parent } : {}) } },
    }
  }
  const nodes = [
    node(rootId, 'Workbench architecture', null, 'Root Note body from the authorized checkout.'),
    node(childId, 'Implement child task', rootId, 'Child Note body with independent acceptance evidence.'),
    node(siblingId, 'Verify sibling task', rootId, 'Sibling Note body for hierarchy verification.'),
    node(otherId, 'Independent delivery', null, 'Unrelated root delivery Note.'),
    node(lastId, 'Separate research', null, 'Unrelated root research Note.'),
  ]
  return {
    id: `harness:project:${repoId}`, name: workspace.name, source: 'harness',
    adapterVersion: 'v2', contentRevision: 1, description: '', rootNodeId: rootId,
    nodeIds: nodes.map(value => value.id), nodes: Object.fromEntries(nodes.map(value => [value.id, value])),
    relations: [], requirementCandidates: [], mountedTo: null, collapsedNodeIds: [],
    // Model a persisted horizontal layout that the real reset action must repair.
    canvasLayout: Object.fromEntries(nodes.map((value, index) => [value.id, { x: index * 300, y: 40 }])),
    createdAt: '2026-09-25T00:00:00Z', updatedAt: '2026-09-25T00:00:00Z',
    noteSnapshot: { repoId, entries: nodes.map(value => ({ uri: value.sourceUri!,
      relPath: value.sourceRelPath!, sourceHash: value.sourceHash!, classification: 'valid', diagnostics: [], doc: value.note })),
      relations: [], mentions: [], diagnostics: [],
      coverage: { checkoutRoot: workspace.path, status: 'complete', snapshotHash: 'fixture-snapshot', diagnostics: [] } },
  }
}

export function installWorkbenchBoundary(readGraph: () => Blueprint, cwd: string): void {
  let layout = readGraph().canvasLayout
  const fixture = {
    loads: [] as string[],
    lists: [] as string[],
    reads: [] as Array<{ cwd: string; uri: string }>,
    saves: [] as Array<{ cwd: string; id: string; patch: Partial<Blueprint> }>,
    graph: () => ({ ...readGraph(), canvasLayout: structuredClone(layout) }),
  }
  ;(window as unknown as { workbenchFixture: typeof fixture }).workbenchFixture = fixture
  Object.assign(window.electron.janus, {
    listBlueprintSummaries: async (path: string) => {
      fixture.lists.push(path)
      if (path !== cwd) throw new Error(`Unexpected checkout: ${path}`)
      const graph = fixture.graph()
      return [{ id: graph.id, name: graph.name, rootNodeId: graph.rootNodeId, nodeCount: graph.nodeIds.length, source: graph.source }]
    },
    loadBlueprint: async (path: string, id: string) => {
      fixture.loads.push(path + '|' + id)
      // Electron replies arrive on a later task. An immediately resolved mock
      // can starve React's pending selection update while the store reloads.
      await new Promise(resolve => setTimeout(resolve, 0))
      if (path !== cwd || id !== readGraph().id) throw new Error('Unexpected graph load')
      return fixture.graph()
    },
    updateBlueprint: async (path: string, id: string, patch: Partial<Blueprint>) => {
      if (path !== cwd || id !== readGraph().id) throw new Error('Unexpected layout target')
      if (Object.keys(patch).some(key => key !== 'canvasLayout')) throw new Error('Unexpected graph mutation')
      fixture.saves.push(structuredClone({ cwd: path, id, patch }))
      if (patch.canvasLayout) layout = structuredClone(patch.canvasLayout)
      return fixture.graph()
    },
  })
  Object.assign(window.electron.harness, {
    workspaceStatus: async (path: string) => ({ root: path, state: path === cwd ? 'ok' : 'not-found',
      ...(path === cwd ? { projectId: readGraph().id } : {}), noteCount: path === cwd ? readGraph().nodeIds.length : 0, diagnostics: [] }),
    noteRead: async (path: string, uri: string) => {
    fixture.reads.push({ cwd: path, uri })
    const value = Object.values(readGraph().nodes).find(node => node.sourceUri === uri)
    if (path !== cwd || !value?.note) throw new Error('Note outside authorized checkout')
    const raw = ['---', 'schema: harness-note/1', 'id: ' + value.note.id,
      'kind: ' + value.note.kind, 'lifecycle: accepted', 'created: 2026-09-25',
      ...(value.note.parent ? ['parent: ' + value.note.parent] : []),
      '---', '', value.note.body].join('\n')
    return { uri, relPath: value.sourceRelPath, raw,
      sourceHash: value.sourceHash, indexedSourceHash: value.sourceHash, matchesSnapshot: true,
      doc: value.note, view: { excerpt: value.title, headings: [], links: [] } }
  } })
  Object.assign(window.electron.knowledge, { noteWikiPages: async () => [] })
}
