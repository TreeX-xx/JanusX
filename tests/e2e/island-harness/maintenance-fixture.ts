import type { Blueprint } from '../../../plugins/blueprint/src/shared/janus/types'
import type { BlueprintMaintenancePreviewInput, BlueprintMaintenancePreview } from '../../../plugins/blueprint/src/shared/janus/maintenance-types'
import type { BlueprintChangeSet, BlueprintMaintenanceTask, BlueprintMaintenanceStartInput, BlueprintMaintenanceApplyInput, BlueprintMaintenanceAuditRecord, BlueprintMaintenanceUndoApplyInput, BlueprintMaintenanceEvent } from '../../../plugins/blueprint/src/shared/janus/maintenance-types'

/** IPC boundary double only. Selection, approval, chat and refresh use production code. */
export function installMaintenanceFixture(initial: Blueprint, workspace: { id: string; path: string; name: string }) {
  const graph = structuredClone(initial)
  const nodeId = graph.rootNodeId
  const listeners = new Set<(event: BlueprintMaintenanceEvent) => void>()
  const state = {
    starts: [] as BlueprintMaintenanceStartInput[], applies: [] as BlueprintMaintenanceApplyInput[],
    previews: [] as BlueprintMaintenancePreviewInput[], failPreview: false,
    undoPrepares: [] as Array<{ blueprintId: string; auditId: string }>, undoApplies: [] as BlueprintMaintenanceUndoApplyInput[],
    graphReads: [] as string[], refreshes: [] as string[], mutations: 0,
    checkoutViews: {} as Record<string, Blueprint>,
    tasks: [] as BlueprintMaintenanceTask[], audits: [] as BlueprintMaintenanceAuditRecord[],
    dispatchBriefs: [] as Array<{ taskId: string; conversationId: string; messages: Array<{ role: string; content: string }> }>,
    binds: [] as Array<{ cwd: string; nodeId: string; terminalId: string }>,
    terminalCreates: [] as Array<{ id: string; preset: string; cwd?: string }>,
    terminalInputs: [] as Array<{ terminalId: string; data: string }>,
    failDispatch: false,
    gateStart: false, finishStart: null as (() => void) | null,
    failList: false,
    longPreview: false,
    dropTaskEvents: false, dropResult: false,
    proposalOutcome: 'ready' as 'ready' | 'empty' | 'failed',
    gateProposal: false, finishProposal: null as (() => void) | null,
    beginProposal(taskId: string) {
      const task = state.tasks.find(item => item.id === taskId)!
      task.status = 'analyzing'; task.error = undefined; task.phase = 'Organizing…'; publish(task)
    },
    stopProposal(taskId: string) {
      const task = state.tasks.find(item => item.id === taskId)!
      if (task.status !== 'analyzing') return
      task.status = task.changeSet ? 'proposal-ready' : 'active'; task.phase = 'Organization stopped'; publish(task)
    },
    changeSourceHash(hash: string) { graph.nodes[nodeId].sourceHash = hash },
    completeProposal(taskId: string) {
      const task = state.tasks.find(item => item.id === taskId)!
      if (task.status !== 'analyzing') return
      if (state.proposalOutcome !== 'ready') {
        task.status = 'failed'
        task.phase = state.proposalOutcome === 'failed' ? 'Proposal generation failed' : 'No changes needed'
        task.error = state.proposalOutcome === 'failed' ? 'Fixture proposal unavailable' : 'No reviewable file: no justified changes'
        publish(task)
        return
      }
      task.changeSet = proposal(task.id); task.status = 'proposal-ready'; task.progress = 100; task.phase = 'Ready'; publish(task)
    },
    replaceProposal() {
      const task = state.tasks[0]
      if (!task?.changeSet) throw new Error('No proposal to replace')
      task.changeSet = { ...task.changeSet, reason: 'Revised proposal with the same identity', operations: task.changeSet.operations.map(op => op.type === 'update-node' ? { ...op, after: { title: 'Revised title' } } : op) }
      publish(task)
    },
    graph: () => structuredClone(graph),
  }
  const publish = (task: BlueprintMaintenanceTask) => { if (!state.dropTaskEvents) listeners.forEach(listener => listener({ task: structuredClone(task) })) }
  const proposal = (taskId: string): BlueprintChangeSet => ({
    id: 'proposal-1', taskId, blueprintId: graph.id, baseRevision: 1, version: 1, status: 'ready', createdAt: '2026-09-25T00:00:00Z', reason: 'Update selected note and clean obsolete nodes',
    sourceHashes: { [nodeId]: graph.nodes[nodeId].sourceHash! },
    evidence: [{ workspaceId: workspace.id, workspaceRootFingerprint: workspace.path, files: [{ path: 'src/value.ts', sha256: 'e'.repeat(64), role: 'critical', sourceState: 'committed', supportsOperationIds: ['rename', 'description'] }] }],
    operations: [
      { operationId: 'rename', type: 'update-node', nodeId, before: { title: 'Task' }, after: { title: 'Maintained task' }, reason: 'Clarify title', evidenceRefs: ['src/value.ts'], dependsOn: [], risk: 'low' },
      { operationId: 'description', type: 'update-node', nodeId, before: { description: '' }, after: { description: 'Verified implementation' }, reason: 'Document implementation', evidenceRefs: ['src/value.ts'], dependsOn: ['rename'], risk: 'low' },
      ...['delete-a', 'delete-b'].map(operationId => ({ operationId, type: 'delete-node' as const, nodeId: operationId, impact: { title: operationId, parentId: nodeId, childIds: [], incomingRelationIds: [], outgoingRelationIds: [] }, reason: 'Remove obsolete note', evidenceRefs: [], dependsOn: [], risk: 'high' as const })),
    ],
    groups: [
      { id: 'details', kind: 'node', title: 'Note details', summary: 'Title and description', risk: 'low', operationIds: ['rename', 'description'], evidenceRefs: ['src/value.ts'] },
      { id: 'cleanup', kind: 'deletes', title: 'Obsolete notes', summary: 'Two individual deletions', risk: 'high', operationIds: ['delete-a', 'delete-b'], evidenceRefs: [] },
    ],
  })
  let reverse: BlueprintChangeSet | null = null
  let preview: { id: string; signature: string; operations: string[] } | null = null
  Object.assign(window.electron.janus, {
    listMaintenanceTasks: async () => { if (state.failList) throw new Error('Task list unavailable'); return structuredClone(state.tasks) },
    listMaintenanceAudits: async () => structuredClone(state.audits),
    onMaintenanceTask: (listener: (event: BlueprintMaintenanceEvent) => void) => { listeners.add(listener); return () => listeners.delete(listener) },
    startMaintenanceTask: async (input: BlueprintMaintenanceStartInput) => {
      state.starts.push(structuredClone(input))
      if (state.gateStart) await new Promise<void>(resolve => { state.finishStart = resolve })
      const task: BlueprintMaintenanceTask = { ...input, id: 'maintenance-1', blueprintName: graph.name, baseRevision: 1, status: 'draft', progress: 0, phase: 'Created', messages: [], changeSet: null, changeSetHistory: [], createdAt: '2026-09-25T00:00:00Z', updatedAt: '2026-09-25T00:00:00Z' }
      state.tasks = [task]; publish(task); return structuredClone(task)
    },
    previewMaintenanceChangeSet: async (input: BlueprintMaintenancePreviewInput): Promise<BlueprintMaintenancePreview> => {
      state.previews.push(structuredClone(input))
      if (state.failPreview) throw new Error('Fixture preview unavailable')
      const task = state.tasks.find(item => item.id === input.taskId)!
      if (task.conversationId !== input.conversationId || task.workspaceId !== input.workspaceId || task.status !== 'proposal-ready') throw new Error('STALE_PREVIEW')
      preview = { id: `preview-${state.previews.length}`, signature: JSON.stringify(task.changeSet), operations: input.operationIds }
      return { id: preview.id, changeSetId: input.changeSetId, files: input.operationIds.map(operationId => ({
        uri: `note://fixture/${operationId}`, path: `.agents/notes/${operationId}.md`, kind: 'replace',
        reason: 'Review this Note change', operationIds: [operationId], before: '# Original Note', after: `# Reviewed ${operationId}${state.longPreview ? '\n\n' + 'Detailed acceptance evidence.\n'.repeat(100) + 'End of reviewed document.' : ''}`,
      })) }
    },
    applyMaintenanceChangeSet: async (input: BlueprintMaintenanceApplyInput) => {
      state.applies.push(structuredClone(input))
      const task = state.tasks.find(item => item.id === input.taskId)!
      const changeSet = task.changeSet!
      if (!preview || preview.id !== input.previewId || preview.signature !== JSON.stringify(changeSet)
        || JSON.stringify(preview.operations) !== JSON.stringify(input.operationIds)) throw new Error('STALE_PREVIEW')
      if (changeSet.sourceHashes?.[nodeId] !== graph.nodes[nodeId].sourceHash) {
        task.status = 'stale'; task.error = 'STALE_SOURCE_HASH: selected note changed; refresh and propose again'; publish(task)
        throw new Error(task.error)
      }
      if (input.operationIds.includes('description') && !input.operationIds.includes('rename')) throw new Error('Missing dependency rename')
      for (const op of changeSet.operations.filter(op => input.operationIds.includes(op.operationId))) {
        if (op.type === 'delete-node' && !input.confirmedDeleteOperationIds?.includes(op.operationId)) throw new Error('Deletion needs individual confirmation')
      }
      const beforeSnapshot = structuredClone(graph)
      for (const op of changeSet.operations.filter(op => input.operationIds.includes(op.operationId))) {
        if (op.type === 'update-node') Object.assign(graph.nodes[op.nodeId], op.after)
        if (op.type === 'delete-node') { delete graph.nodes[op.nodeId]; graph.nodeIds = graph.nodeIds.filter(id => id !== op.nodeId) }
      }
      graph.nodes[nodeId].sourceHash = 'b'.repeat(64); state.mutations++
      state.audits.push({ id: 'audit-1', taskId: task.id, changeSetId: changeSet.id, blueprintId: graph.id, beforeRevision: 1, afterRevision: 2, selectedOperationIds: input.operationIds, rejectedOperationIds: changeSet.operations.filter(op => !input.operationIds.includes(op.operationId)).map(op => op.operationId), confirmedDeleteOperationIds: input.confirmedDeleteOperationIds, status: 'applied', changeSetSnapshot: structuredClone(changeSet), beforeSnapshot, afterSnapshot: structuredClone(graph), harnessRoot: workspace.path, createdAt: '2026-09-25T00:00:01Z' })
      task.changeSet = null; task.status = 'active'; publish(task)
      return { task: structuredClone(task), blueprintRevision: 2, appliedOperationIds: input.operationIds }
    },
    loadBlueprint: async (cwd: string) => { state.refreshes.push(cwd); return structuredClone(graph) },
    completeMaintenanceTask: async (taskId: string) => { const task = state.tasks.find(item => item.id === taskId)!; task.status = 'completed'; publish(task); return structuredClone(task) },
    cancelMaintenanceTask: async (taskId: string) => { const task = state.tasks.find(item => item.id === taskId)!; task.status = 'cancelled'; publish(task); return structuredClone(task) },
    dismissMaintenanceProposal: async ({ taskId }: { taskId: string }) => {
      const task = state.tasks.find(item => item.id === taskId)!
      task.changeSetHistory.push({ ...task.changeSet!, status: 'rejected' }); task.changeSet = null; task.status = 'active'; publish(task)
      return structuredClone(task)
    },
    prepareMaintenanceUndo: async (input: { blueprintId: string; auditId: string }) => {
      state.undoPrepares.push(input)
      const audit = state.audits.find(item => item.id === input.auditId)!
      // These fixture proposals update title/description; only applied fields reverse.
      const textFields = (patch: { title?: string; description?: string }) => ({
        ...('title' in patch ? { title: patch.title } : {}),
        ...('description' in patch ? { description: patch.description } : {}),
      })
      reverse = { ...structuredClone(audit.changeSetSnapshot), id: 'undo-1', undoOfAuditId: audit.id, sourceHashes: { [nodeId]: graph.nodes[nodeId].sourceHash! }, groups: undefined, operations: audit.changeSetSnapshot.operations.flatMap(op => op.type === 'update-node' && audit.selectedOperationIds.includes(op.operationId) ? [{ ...op, operationId: 'undo-' + op.operationId, dependsOn: [], before: textFields(op.after), after: textFields(op.before) }] : []) }
      return { changeSet: structuredClone(reverse), conflicts: [] }
    },
    applyMaintenanceUndo: async (input: BlueprintMaintenanceUndoApplyInput) => {
      state.undoApplies.push(structuredClone(input))
      if (reverse?.sourceHashes?.[nodeId] !== graph.nodes[nodeId].sourceHash) throw new Error('STALE_SOURCE_HASH: undo source changed')
      const beforeSnapshot = structuredClone(graph)
      for (const op of reverse!.operations.filter(op => input.operationIds.includes(op.operationId))) if (op.type === 'update-node') Object.assign(graph.nodes[op.nodeId], op.after)
      graph.nodes[nodeId].sourceHash = 'c'.repeat(64); state.mutations++
      state.audits.push({ id: 'audit-undo', taskId: 'maintenance-1', changeSetId: reverse!.id, blueprintId: graph.id, beforeRevision: 2, afterRevision: 3, selectedOperationIds: input.operationIds, rejectedOperationIds: reverse!.operations.filter(op => !input.operationIds.includes(op.operationId)).map(op => op.operationId), status: 'applied', changeSetSnapshot: structuredClone(reverse!), beforeSnapshot, afterSnapshot: structuredClone(graph), undoOfAuditId: 'audit-1', harnessRoot: workspace.path, createdAt: '2026-09-25T00:00:02Z' })
      return { blueprintRevision: 3, appliedOperationIds: input.operationIds, auditId: 'audit-undo' }
    },
  })
  Object.assign(window.electron.harness, { projectGraph: async (cwd: string) => {
    state.graphReads.push(cwd)
    const source = cwd === workspace.path ? graph : state.checkoutViews[cwd]
    return source ? { blueprint: structuredClone(source), rev: 1, repoId: source.nodes[source.rootNodeId].sourceUri!.split('/')[2], repoName: source.name, invalid: [], adapterVersion: 'fixture' } : null
  } })
  // Note: dispatch is a host action — brief over IPC, terminal through the real
  // renderer launch path so the prefill/bind sequence is exercised.
  Object.assign(window.electron.janus, {
    composeDispatchBrief: async (input: { taskId: string; conversationId: string; messages: Array<{ role: string; content: string }> }) => {
      state.dispatchBriefs.push(structuredClone(input))
      if (state.failDispatch) throw new Error('Fixture brief unavailable')
      const noteUri = graph.nodes[nodeId].sourceUri!
      const brief = { goal: 'Implement the clarified title', steps: ['update the heading', 'keep the body intact'], acceptance: ['heading matches the clarified title'], constraints: ['no Note rewrite'], noteRefs: [noteUri, 'note://ghost/not-authorized'] }
      return { brief, text: [
        `# ${graph.name} · 派发实施简报`, '', `工作区：${workspace.name}（${workspace.path}）`, '',
        '## 目标', brief.goal, '', '## 需求依据（Note 已在同一 checkout 内，直接按路径读取）', `- ${noteUri}`, '',
        '## 实施步骤', ...brief.steps.map((step, index) => `${index + 1}. ${step}`), '',
        '## 验收要点', ...brief.acceptance.map((item) => `- ${item}`), '', '## 约束', ...brief.constraints.map((item) => `- ${item}`),
      ].join('\n'), anchorNodeId: nodeId, workspaceId: workspace.id, workspaceName: workspace.name, workspacePath: workspace.path }
    },
    bindTerminal: async (cwd: string, targetNodeId: string, terminalId: string) => {
      state.binds.push({ cwd, nodeId: targetNodeId, terminalId })
      const target = graph.nodes[targetNodeId]
      if (!target) throw new Error('NOT_FOUND: node missing')
      target.boundTerminalId = terminalId
      return structuredClone(target)
    },
    focusNode: async (_payload: { workspacePath: string; nodeId: string }) => structuredClone(graph.nodes[_payload.nodeId]),
  })
  const created = new Set<(event: { id: string; preset: string }) => void>()
  Object.assign(window.electron.terminal, {
    create: async (input: { id: string; preset: string; cwd?: string }) => {
      state.terminalCreates.push({ id: input.id, preset: input.preset, cwd: input.cwd })
      // The renderer gates its prefill on this event, keyed by `id`.
      for (const listener of created) listener({ id: input.id, preset: input.preset })
      return { pid: 4242 }
    },
    input: (terminalId: string, data: string) => { state.terminalInputs.push({ terminalId, data }) },
    onCreated: (listener: (event: { id: string; preset: string }) => void) => { created.add(listener); return () => created.delete(listener) },
  })
  return state
}
