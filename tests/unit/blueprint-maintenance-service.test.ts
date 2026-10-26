import { promises as fs } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Blueprint } from '../../plugins/blueprint/src/shared/janus/types'
import type {
  BlueprintChangeSet,
  BlueprintEvidenceManifest,
  BlueprintMaintenanceTask,
  BlueprintOperation,
} from '../../plugins/blueprint/src/shared/janus/maintenance-types'

// Under full-suite CPU contention the async task pipeline can exceed the
// defaults; generous timeouts keep this file deterministic, and the afterEach
// cancelAll prevents one timeout from poisoning the shared per-blueprint lock.
vi.setConfig({ testTimeout: 30_000 })
const waitFor = <T,>(assertion: () => T) => vi.waitFor(assertion, { timeout: 15_000, interval: 50 })

const mocks = vi.hoisted(() => ({
  generateObject: vi.fn(),
  streamText: vi.fn(),
  getDefaultModel: vi.fn(),
  getLanguageModel: vi.fn(),
  getProviderSettings: vi.fn(),
  loadBlueprint: vi.fn(),
  applyMaintenanceOperations: vi.fn(),
  workspacesDir: vi.fn(),
  createSession: vi.fn(),
  getSession: vi.fn(),
  cancelSession: vi.fn(),
  userData: '',
}))

vi.mock('electron', () => ({ app: { getPath: () => mocks.userData } }))
vi.mock('../../src/main/llm/ai-runtime', () => ({
  generateObject: mocks.generateObject,
  streamText: mocks.streamText,
}))
vi.mock('../../src/main/agent/runtime/shell-runtime', () => ({
  workspaceAgentRuntime: {
    registry: { list: () => [] },
    createSession: mocks.createSession,
    getSession: mocks.getSession,
    cancelSession: mocks.cancelSession,
    executeFunctionCall: vi.fn(),
  },
}))
vi.mock('../../src/main/llm/LlmService', () => ({
  llmService: {
    getDefaultModel: mocks.getDefaultModel,
    getLanguageModel: mocks.getLanguageModel,
    getProviderSettings: mocks.getProviderSettings,
  },
}))
vi.mock('../../src/main/janus/blueprint-store', () => ({
  blueprintStore: {
    loadBlueprint: mocks.loadBlueprint,
    applyMaintenanceOperations: mocks.applyMaintenanceOperations,
  },
  isProjectGraphId: (id: string) => id.startsWith('harness:project:'),
}))
vi.mock('../../src/main/janus/blueprint-paths', () => ({ workspacesDir: mocks.workspacesDir }))

function fixture(): Blueprint {
  return {
    schemaVersion: 2,
    contentRevision: 3,
    id: 'bp-1',
    name: 'Blueprint',
    description: '',
    rootNodeId: 'root',
    nodeIds: ['root'],
    nodes: {
      root: {
        id: 'root', title: 'Root', type: 'epic', status: 'not-started', progress: 0,
        statusSource: 'manual', positioning: '', description: '', features: [], completedItems: [],
        techSolution: '', notes: '', todos: [], issues: [], activities: [], analyses: [], workspaceId: null,
        workspaceSnapshot: null, boundTerminalId: null, terminalHistory: [], lastAnalyzedCommitSha: null,
        children: [], parentId: null, tags: [], createdAt: '', updatedAt: '',
      },
    },
    requirementCandidates: [], mountedTo: null, canvasLayout: {}, createdAt: '', updatedAt: '',
  }
}

describe('Blueprint maintenance legacy settlement', () => {
  let root = ''
  let workspace = ''
  let workspace2 = ''
  let registry = ''
  let serviceRef: {
    tasks: Map<string, BlueprintMaintenanceTask>
    cancelAll(): void
  } | null = null

  beforeAll(async () => {
    root = await fs.mkdtemp(join(tmpdir(), 'janusx-maintenance-'))
    mocks.userData = root
    workspace = join(root, 'workspace')
    workspace2 = join(root, 'workspace-2')
    registry = join(root, 'registry')
    await fs.mkdir(workspace)
    await fs.mkdir(workspace2)
    await fs.mkdir(registry)
    await fs.writeFile(join(registry, 'workspace.json'), JSON.stringify({ id: 'ws-1', path: workspace }), 'utf8')
    await fs.writeFile(join(registry, 'workspace-2.json'), JSON.stringify({ id: 'ws-2', path: workspace2 }), 'utf8')
    mocks.workspacesDir.mockReturnValue(registry)
    mocks.getDefaultModel.mockResolvedValue({ provider: { id: 'provider' }, modelId: 'model' })
    mocks.getLanguageModel.mockResolvedValue({})
    mocks.getProviderSettings.mockResolvedValue({ modelId: 'model' })
    mocks.loadBlueprint.mockImplementation(async () => fixture())
    mocks.createSession.mockImplementation(async ({ workspaceId }: { workspaceId: string }) => ({ id: `agent-session-${workspaceId}` }))
    mocks.getSession.mockImplementation((id: string) => {
      const workspaceId = String(id).replace(/^agent-session-/, '')
      return { id, status: 'running', workspace: { workspaceId, workspaceRoot: workspace } }
    })
    mocks.cancelSession.mockResolvedValue({ status: 'cancelled' })
    serviceRef = (await import('../../src/main/janus/maintenance/service')).blueprintMaintenanceService as unknown as {
      tasks: Map<string, BlueprintMaintenanceTask>
      cancelAll(): void
    }
  })

  afterAll(async () => {
    if (root.startsWith(join(tmpdir(), 'janusx-maintenance-'))) {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  afterEach(async () => {
    // One timed-out test must not leave an active task holding the
    // per-blueprint lock and poison every later test in this file.
    const { blueprintMaintenanceService } = await import('../../src/main/janus/maintenance/service')
    blueprintMaintenanceService.cancelAll()
  })

  function serviceOf() {
    if (!serviceRef) throw new Error('maintenance service not bound yet')
    return serviceRef
  }

  function stageLegacyTask(changeSet: BlueprintChangeSet): void {
    serviceOf().tasks.set('t-1', {
      id: 't-1',
      blueprintId: 'bp-1',
      blueprintName: 'Blueprint',
      baseRevision: 3,
      workspaceId: 'ws-1',
      workspaceName: 'Workspace',
      workspacePath: workspace,
      authorizedWorkspaces: [{ workspaceId: 'ws-1', workspaceName: 'Workspace', workspacePath: workspace }],
      nodeScope: { type: 'blueprint' },
      goal: 'legacy settlement',
      status: 'proposal-ready',
      progress: 0,
      phase: '',
      messages: [],
      changeSet,
      changeSetHistory: [],
      createdAt: '',
      updatedAt: '',
    })
  }

  function legacyChangeSet(operations: BlueprintOperation[], evidence: BlueprintEvidenceManifest[] = []): BlueprintChangeSet {
    return {
      id: 'cs-1', taskId: 't-1', blueprintId: 'bp-1', baseRevision: 3, version: 1, status: 'ready',
      reason: 'legacy settlement', evidence, operations, createdAt: '',
    }
  }

  function legacyUpdateOp(operationId: string, evidenceRefs: string[] = []): BlueprintOperation {
    return {
      operationId, type: 'update-node', nodeId: 'root', after: { notes: 'verified' },
      reason: 'Use evidence', evidenceRefs, dependsOn: [], risk: 'low',
    }
  }

  async function collectManifest(): Promise<BlueprintEvidenceManifest> {
    const { janusWorkspaceFs } = await import('@janus-agent/agent-core')
    const collected = await janusWorkspaceFs.collectTextEvidence(workspace, 'ws-1', new AbortController().signal, {
      maxContextBytes: 240 * 1024, maxFiles: 100,
    })
    if (!collected.ok) throw new Error('evidence collection failed in test')
    return structuredClone((collected as unknown as { value: { manifest: BlueprintEvidenceManifest } }).value.manifest)
  }

  function markCritical(manifest: BlueprintEvidenceManifest, path: string, operationId: string): BlueprintEvidenceManifest {
    return {
      ...manifest,
      files: manifest.files.map((file) => file.path === path
        ? { ...file, role: 'critical' as const, supportsOperationIds: [operationId] }
        : file),
    }
  }

  async function auditFiles(): Promise<string[]> {
    const auditDirectory = join(root, 'janusx', 'blueprint-maintenance-audit')
    return fs.readdir(auditDirectory).catch(() => [])
  }

  async function removeAuditFiles(names: string[]): Promise<void> {
    const auditDirectory = join(root, 'janusx', 'blueprint-maintenance-audit')
    for (const file of names) {
      await fs.rm(join(auditDirectory, file), { force: true }).catch(() => undefined)
    }
  }

  it('rejects concurrent starts for the same Blueprint before async validation completes', async () => {
    let releaseLoad!: () => void
    mocks.loadBlueprint.mockImplementationOnce(() => new Promise<Blueprint>((resolve) => {
      releaseLoad = () => resolve(fixture())
    }))
    const input = {
      blueprintId: 'bp-race', workspaceId: 'ws-1', workspaceName: 'Workspace', workspacePath: workspace,
      nodeScope: { type: 'blueprint' as const }, goal: 'race test', conversationId: 'shared-race',
    }
    const { blueprintMaintenanceService } = await import('../../src/main/janus/maintenance/service')
    const first = blueprintMaintenanceService.start(input)
    await waitFor(() => expect(mocks.loadBlueprint).toHaveBeenCalled())
    await expect(blueprintMaintenanceService.start(input)).rejects.toThrow('已有活动维护任务')
    releaseLoad()
    await expect(first).rejects.toThrow('Note blueprint')
  })

  it('marks a proposal stale when collected workspace evidence changes before apply', async () => {
    await fs.writeFile(join(workspace, 'evidence.md'), 'before')
    const recorded = markCritical(await collectManifest(), 'evidence.md', 'evidence-update')
    expect(recorded.files.find((file) => file.path === 'evidence.md')?.sha256).toMatch(/^[a-f0-9]{64}$/)
    stageLegacyTask(legacyChangeSet([legacyUpdateOp('evidence-update', ['evidence.md'])], [recorded]))

    await fs.writeFile(join(workspace, 'evidence.md'), 'after')
    const { blueprintMaintenanceService } = await import('../../src/main/janus/maintenance/service')
    await expect(blueprintMaintenanceService.apply({
      taskId: 't-1',
      changeSetId: 'cs-1',
      operationIds: ['evidence-update'],
    })).rejects.toThrow('工程证据已变化')
    expect(serviceOf().tasks.get('t-1')?.status).toBe('stale')
    expect(mocks.applyMaintenanceOperations).not.toHaveBeenCalled()
  })

  it('marks a proposal stale when workspace authorization is removed before apply', async () => {
    stageLegacyTask(legacyChangeSet([legacyUpdateOp('authorization-update')]))
    const { blueprintMaintenanceService } = await import('../../src/main/janus/maintenance/service')
    const registration = join(registry, 'workspace.json')
    const disabledRegistration = join(registry, 'workspace.disabled')
    await fs.rename(registration, disabledRegistration)
    try {
      await expect(blueprintMaintenanceService.apply({
        taskId: 't-1',
        changeSetId: 'cs-1',
        operationIds: ['authorization-update'],
      })).rejects.toThrow('工程证据已变化')
      expect(serviceOf().tasks.get('t-1')?.status).toBe('stale')
      expect(mocks.applyMaintenanceOperations).not.toHaveBeenCalled()
    } finally {
      await fs.rename(disabledRegistration, registration)
    }
  })

  it('persists the approved ChangeSet, evidence, and before/after snapshots', async () => {
    const before = fixture()
    const after = { ...fixture(), contentRevision: 4 }
    mocks.applyMaintenanceOperations.mockResolvedValueOnce({
      before, after, createdNodeIds: {}, createdRelationIds: {},
    })
    const existingAudits = new Set(await auditFiles())
    stageLegacyTask(legacyChangeSet([legacyUpdateOp('audit-update', ['evidence.md'])]))
    const { blueprintMaintenanceService } = await import('../../src/main/janus/maintenance/service')
    await blueprintMaintenanceService.apply({
      taskId: 't-1',
      changeSetId: 'cs-1',
      operationIds: ['audit-update'],
    })

    const created = (await auditFiles()).filter((file) => !existingAudits.has(file))
    expect(created).toHaveLength(1)
    const audit = JSON.parse(await fs.readFile(join(root, 'janusx', 'blueprint-maintenance-audit', created[0]), 'utf8'))
    expect(audit).toMatchObject({
      status: 'applied',
      changeSetSnapshot: { id: 'cs-1' },
      beforeSnapshot: { contentRevision: 3 },
      afterSnapshot: { contentRevision: 4 },
    })
    expect(serviceOf().tasks.get('t-1')?.changeSetHistory).toEqual([
      expect.objectContaining({ id: 'cs-1', status: 'applied' }),
    ])
    await expect(blueprintMaintenanceService.listAudits({ blueprintId: 'bp-1', taskId: 't-1' })).resolves.toEqual([
      expect.objectContaining({ id: audit.id, status: 'applied' }),
    ])
    await removeAuditFiles(created)
  })

  it('refuses to apply delete operations without individual high-risk confirmation', async () => {
    const delOp: BlueprintOperation = {
      operationId: 'del-root', type: 'delete-node', nodeId: 'root',
      reason: 'Obsolete node', evidenceRefs: [], dependsOn: [], risk: 'high',
      impact: { title: 'Root', parentId: null, childIds: [], incomingRelationIds: [], outgoingRelationIds: [] },
    }
    stageLegacyTask(legacyChangeSet([delOp]))
    const { blueprintMaintenanceService } = await import('../../src/main/janus/maintenance/service')
    mocks.applyMaintenanceOperations.mockClear()
    await expect(blueprintMaintenanceService.apply({
      taskId: 't-1', changeSetId: 'cs-1', operationIds: ['del-root'],
    })).rejects.toThrow('逐项高风险确认')
    expect(mocks.applyMaintenanceOperations).not.toHaveBeenCalled()
  })

  it('prepares and applies a reverse ChangeSet from an applied audit record', async () => {
    const auditDirectory = join(root, 'janusx', 'blueprint-maintenance-audit')
    await fs.mkdir(auditDirectory, { recursive: true })
    const before = fixture()
    const applied = fixture()
    applied.contentRevision = 3
    applied.nodes.root.notes = 'audited'
    mocks.loadBlueprint.mockImplementation(async () => structuredClone(applied))
    const auditRecord = {
      id: 'undo-source-audit', taskId: 'task-x', changeSetId: 'cs-x', blueprintId: 'bp-1',
      beforeRevision: 2, afterRevision: 3,
      selectedOperationIds: ['op-notes'], rejectedOperationIds: [],
      status: 'applied',
      changeSetSnapshot: {
        id: 'cs-x', taskId: 'task-x', blueprintId: 'bp-1', baseRevision: 2, version: 1, status: 'applied',
        reason: 'original', operations: [{
          operationId: 'op-notes', type: 'update-node', nodeId: 'root',
          before: { notes: '' }, after: { notes: 'audited' },
          reason: 'note it', evidenceRefs: [], dependsOn: [], risk: 'low',
        }], createdAt: '',
      },
      beforeSnapshot: before, afterSnapshot: applied, createdAt: '', appliedAt: '',
    }
    await fs.writeFile(join(auditDirectory, `${auditRecord.id}.json`), JSON.stringify(auditRecord), 'utf8')
    mocks.applyMaintenanceOperations.mockResolvedValueOnce({
      before: applied, after: { ...structuredClone(before), contentRevision: 4 },
      createdNodeIds: {}, createdRelationIds: {},
    })

    const { blueprintMaintenanceService } = await import('../../src/main/janus/maintenance/service')
    const prepared = await blueprintMaintenanceService.prepareUndo({ blueprintId: 'bp-1', auditId: auditRecord.id })
    expect(prepared.changeSet.undoOfAuditId).toBe(auditRecord.id)
    expect(prepared.changeSet.operations).toEqual([
      expect.objectContaining({ type: 'update-node', after: { notes: '' } }),
    ])

    const result = await blueprintMaintenanceService.applyUndo({
      blueprintId: 'bp-1', undoChangeSetId: prepared.changeSet.id,
      operationIds: prepared.changeSet.operations.map((operation) => operation.operationId),
    })
    expect(result.blueprintRevision).toBe(4)
    const undoAudits = await blueprintMaintenanceService.listAudits({ blueprintId: 'bp-1' })
    expect(undoAudits.some((record) => record.undoOfAuditId === auditRecord.id && record.status === 'applied')).toBe(true)

    // A prepared undo is single-use: the revision moved, so it must be re-prepared.
    await expect(blueprintMaintenanceService.applyUndo({
      blueprintId: 'bp-1', undoChangeSetId: prepared.changeSet.id, operationIds: ['undo-op-notes'],
    })).rejects.toThrow('不存在或已失效')

    mocks.loadBlueprint.mockImplementation(async () => fixture())
    for (const file of await fs.readdir(auditDirectory)) {
      if (file.includes('undo') || file.includes(auditRecord.id)) await fs.rm(join(auditDirectory, file), { force: true })
    }
  })
})
