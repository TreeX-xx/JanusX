import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  JANUS_COMMAND_CHANNELS,
  JANUS_EVENT_CHANNELS,
  type IslandAnalysisEvent,
  type IslandDiscoveredEvent,
  type JanusAPI,
} from '../../src/shared/ipc/janus'

const mocks = vi.hoisted(() => ({
  acceptRequirementCandidate: vi.fn(),
  analyzeNode: vi.fn(),
  bindTerminal: vi.fn(),
  capture: vi.fn(),
  createNode: vi.fn(),
  expose: vi.fn(),
  focusNode: vi.fn(),
  handle: vi.fn(),
  invoke: vi.fn(),
  loadBlueprint: vi.fn(),
  on: vi.fn(),
  registerNodeWorkspace: vi.fn(),
  removeListener: vi.fn(),
  scheduleAnalyze: vi.fn(),
  setMainWindow: vi.fn(),
  maintenanceList: vi.fn(),
  maintenanceAuditList: vi.fn(),
  maintenanceStart: vi.fn(),
  maintenanceApply: vi.fn(),
  maintenanceCancel: vi.fn(),
  maintenanceComplete: vi.fn(),
  maintenanceDismiss: vi.fn(),
}))

let janusApi: JanusAPI
const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>()

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: (
      _name: string,
      api: {
        janus: JanusAPI
      }
    ) => {
      janusApi = api.janus
      mocks.expose(api)
    },
  },
  ipcMain: { handle: mocks.handle },
  ipcRenderer: {
    invoke: mocks.invoke,
    on: mocks.on,
    removeListener: mocks.removeListener,
    send: vi.fn(),
  },
}))

vi.mock('../../src/main/knowledge/observation-service', () => ({
  knowledgeObservationService: { capture: mocks.capture },
}))
// captureForCwd 先解析工作区身份（测试环境无 electron app），此处只验证透传的 capture 契约。
vi.mock('../../src/main/knowledge/workspace-identity', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/main/knowledge/workspace-identity')>()
  return {
    ...actual,
    captureForCwd: async (cwd: string, input: Record<string, unknown>) =>
      mocks.capture({ workspacePath: cwd, ...input }),
  }
})

beforeAll(async () => {
  await import('../../src/preload/index')
  const { registerJanusHandlers } = await import('../../src/main/ipc/janus-handlers')
  registerJanusHandlers()
  for (const [channel, handler] of mocks.handle.mock.calls) {
    handlers.set(channel, handler)
  }
})

describe('Janus IPC contract', () => {
  beforeEach(() => {
    mocks.invoke.mockReset()
    mocks.invoke.mockResolvedValue(null)
    mocks.on.mockClear()
    mocks.removeListener.mockClear()
    ;[
      mocks.acceptRequirementCandidate,
      mocks.analyzeNode,
      mocks.bindTerminal,
      mocks.capture,
      mocks.createNode,
      mocks.focusNode,
      mocks.loadBlueprint,
      mocks.registerNodeWorkspace,
      mocks.scheduleAnalyze,
    ].forEach((m) => m.mockReset())
    mocks.capture.mockResolvedValue(undefined)
  })

  function handler(channel: string): (...args: unknown[]) => Promise<unknown> {
    const registered = handlers.get(channel)
    if (!registered) throw new Error(`Missing handler for ${channel}`)
    return registered
  }


  it('defines unique channels and registers all main commands', () => {
    const commands = Object.values(JANUS_COMMAND_CHANNELS)
    const events = Object.values(JANUS_EVENT_CHANNELS)

    expect(commands).toHaveLength(34)
    expect(events).toHaveLength(3)
    expect(new Set([...commands, ...events]).size).toBe(37)
    expect(mocks.handle.mock.calls.map(([channel]) => channel)).toEqual(
      expect.arrayContaining(commands)
    )
    // Does not expose generic bridges.
    const exposed = mocks.expose.mock.calls[0]?.[0]
    expect(exposed).not.toHaveProperty('invoke')
    expect(exposed).not.toHaveProperty('send')
    expect(exposed).not.toHaveProperty('on')
  })

  it('rejects retired maintenance commands before invoking a host service', async () => {
    for (const [name, channel] of Object.entries(JANUS_COMMAND_CHANNELS)) {
      if (!name.startsWith('maintenance') && name !== 'dispatchComposeBrief') continue
      await expect(handler(channel)({}, {})).rejects.toThrow('BLUEPRINT_PLUGIN_REQUIRED')
    }
    expect(mocks.maintenanceStart).not.toHaveBeenCalled()
    expect(mocks.maintenanceApply).not.toHaveBeenCalled()
    expect(mocks.maintenanceList).not.toHaveBeenCalled()
    expect(mocks.maintenanceAuditList).not.toHaveBeenCalled()
  })

  it('routes every command through the fixed API with exact argument order', async () => {
    const createInput = { name: 'demo', rootType: 'epic' as const }
    const updatePatch = { name: 'renamed' }
    const nodeInput = { title: 'Root', type: 'task' as const }
    const featureInput = { title: 'Typed IPC' }
    const featurePatch = { description: 'done' }
    const focusPayload = { workspacePath: 'C:\\repo', nodeId: 'node-1' }
    const analyzePayload = { nodeId: 'node-1', workspacePath: 'C:\\repo' }
    const patchPayload = {
      workspacePath: 'C:\\repo',
      blueprintId: 'bp-1',
      nodeId: 'node-1',
      patch: { progress: 50 },
    }
    const historyPayload = { workspacePath: 'C:\\repo', blueprintId: 'bp-1', nodeId: 'node-1' }
    const applyPayload = { ...historyPayload, analysisId: 'analysis-1' }
    const listPayload = { workspacePath: 'C:\\repo', blueprintId: 'bp-1' }
    const acceptPayload = { ...listPayload, candidateId: 'candidate-1' }
    const rejectPayload = { ...acceptPayload, decisionNote: 'duplicate' }
    const discoveredPayload = {
      ...listPayload,
      discovered: { title: 'New', description: 'New task', suggestedParent: '', confidence: 0.8 },
    }
    const maintenanceStart = { blueprintId: 'bp-1' } as Parameters<JanusAPI['startMaintenanceTask']>[0]
    const maintenanceAudits = { blueprintId: 'bp-1', taskId: 'task-1' }
    const maintenanceApply = { taskId: 'task-1', changeSetId: 'set-1', operationIds: ['op-1'] }

    await janusApi.listBlueprints('C:\\repo')
    await janusApi.loadBlueprint('C:\\repo', 'bp-1')
    await janusApi.createBlueprint('C:\\repo', createInput)
    await janusApi.updateBlueprint('C:\\repo', 'bp-1', updatePatch)
    await janusApi.deleteBlueprint('C:\\repo', 'bp-1')
    await janusApi.createNode('C:\\repo', 'bp-1', nodeInput, null)
    await janusApi.updateNode('C:\\repo', 'bp-1', 'node-1', { status: 'done' })
    await janusApi.deleteNode('C:\\repo', 'bp-1', 'node-1')
    await janusApi.replaceNodeFeatures('C:\\repo', 'bp-1', 'node-1', [featureInput])
    await janusApi.addNodeFeature('C:\\repo', 'bp-1', 'node-1', featureInput)
    await janusApi.updateNodeFeature('C:\\repo', 'bp-1', 'node-1', 'feature-1', featurePatch)
    await janusApi.deleteNodeFeature('C:\\repo', 'bp-1', 'node-1', 'feature-1')
    await janusApi.focusNode(focusPayload)
    await janusApi.bindTerminal('C:\\repo', 'node-1', 'terminal-1')
    await janusApi.analyze(analyzePayload)
    await janusApi.applyAnalysisPatch(patchPayload)
    await janusApi.listAnalyses(historyPayload)
    await janusApi.applyAnalysis(applyPayload)
    await janusApi.listRequirementCandidates(listPayload)
    await janusApi.acceptRequirementCandidate(acceptPayload)
    await janusApi.rejectRequirementCandidate(rejectPayload)
    await janusApi.acceptDiscovered(discoveredPayload)
    await janusApi.listMaintenanceTasks()
    await janusApi.listMaintenanceAudits(maintenanceAudits)
    await janusApi.startMaintenanceTask(maintenanceStart)
    await janusApi.applyMaintenanceChangeSet(maintenanceApply)
    await janusApi.previewMaintenanceChangeSet(maintenanceApply)
    await janusApi.cancelMaintenanceTask('task-1')
    await janusApi.completeMaintenanceTask('task-1')
    await janusApi.dismissMaintenanceProposal({ taskId: 'task-1' })

    expect(mocks.invoke.mock.calls).toEqual([
      [JANUS_COMMAND_CHANNELS.listBlueprints, 'C:\\repo'],
      [JANUS_COMMAND_CHANNELS.loadBlueprint, 'C:\\repo', 'bp-1'],
      [JANUS_COMMAND_CHANNELS.createBlueprint, 'C:\\repo', createInput],
      [JANUS_COMMAND_CHANNELS.updateBlueprint, 'C:\\repo', 'bp-1', updatePatch],
      [JANUS_COMMAND_CHANNELS.deleteBlueprint, 'C:\\repo', 'bp-1'],
      [JANUS_COMMAND_CHANNELS.createNode, 'C:\\repo', 'bp-1', nodeInput, null],
      [JANUS_COMMAND_CHANNELS.updateNode, 'C:\\repo', 'bp-1', 'node-1', { status: 'done' }],
      [JANUS_COMMAND_CHANNELS.deleteNode, 'C:\\repo', 'bp-1', 'node-1'],
      [JANUS_COMMAND_CHANNELS.replaceNodeFeatures, 'C:\\repo', 'bp-1', 'node-1', [featureInput]],
      [JANUS_COMMAND_CHANNELS.addNodeFeature, 'C:\\repo', 'bp-1', 'node-1', featureInput],
      [JANUS_COMMAND_CHANNELS.updateNodeFeature, 'C:\\repo', 'bp-1', 'node-1', 'feature-1', featurePatch],
      [JANUS_COMMAND_CHANNELS.deleteNodeFeature, 'C:\\repo', 'bp-1', 'node-1', 'feature-1'],
      [JANUS_COMMAND_CHANNELS.focusNode, 'C:\\repo', 'node-1'],
      [JANUS_COMMAND_CHANNELS.bindTerminal, 'C:\\repo', 'node-1', 'terminal-1'],
      [JANUS_COMMAND_CHANNELS.analyze, analyzePayload],
      [JANUS_COMMAND_CHANNELS.applyAnalysisPatch, patchPayload],
      [JANUS_COMMAND_CHANNELS.listAnalyses, historyPayload],
      [JANUS_COMMAND_CHANNELS.applyAnalysis, applyPayload],
      [JANUS_COMMAND_CHANNELS.listRequirementCandidates, listPayload],
      [JANUS_COMMAND_CHANNELS.acceptRequirementCandidate, acceptPayload],
      [JANUS_COMMAND_CHANNELS.rejectRequirementCandidate, rejectPayload],
      [JANUS_COMMAND_CHANNELS.acceptDiscovered, discoveredPayload],
      [JANUS_COMMAND_CHANNELS.maintenanceList],
      [JANUS_COMMAND_CHANNELS.maintenanceAuditList, maintenanceAudits],
      [JANUS_COMMAND_CHANNELS.maintenanceStart, maintenanceStart],
      [JANUS_COMMAND_CHANNELS.maintenanceApply, maintenanceApply],
      [JANUS_COMMAND_CHANNELS.maintenancePreview, maintenanceApply],
      [JANUS_COMMAND_CHANNELS.maintenanceCancel, 'task-1'],
      [JANUS_COMMAND_CHANNELS.maintenanceComplete, 'task-1'],
      [JANUS_COMMAND_CHANNELS.maintenanceDismiss, { taskId: 'task-1' }],
    ])
  })

  it('rejects every legacy Blueprint command without reading or mutating old data', async () => {
    for (const channel of Object.values(JANUS_COMMAND_CHANNELS)) {
      await expect(handler(channel)(undefined, 'C:/repo', 'legacy')).rejects.toThrow('BLUEPRINT_PLUGIN_REQUIRED')
    }
    for (const fn of [mocks.loadBlueprint, mocks.createNode, mocks.focusNode, mocks.bindTerminal, mocks.acceptRequirementCandidate]) expect(fn).not.toHaveBeenCalled()
  })

  it('redirects retired analysis before starting a host model or observation', async () => {
    const payload = { nodeId: 'node-1', workspacePath: 'C:\\repo', commitLimit: 3 }

    await expect(
      handler(JANUS_COMMAND_CHANNELS.analyze)(undefined, payload)
    ).rejects.toThrow('BLUEPRINT_PLUGIN_REQUIRED')
    expect(mocks.analyzeNode).not.toHaveBeenCalled()
    expect(mocks.capture).not.toHaveBeenCalled()
  })

  it('hides Electron events and removes each exact registered listener', () => {
    const analysisCallback = vi.fn()
    const analysisPayload = {
      blueprintId: 'bp-1',
      workspacePath: 'C:\\repo',
      nodeId: 'node-1',
      nodeTitle: 'Node',
      applied: true,
      result: {
        schemaVersion: 1,
        progress: 100,
        status: 'done',
        summary: 'done',
        confidence: 1,
        evidence: [],
        unresolved: [],
        discoveredRequirements: [],
        featureUpdates: [],
        newFeatureRequirements: [],
      },
      createdAt: '2026-07-17T00:00:00.000Z',
    } satisfies IslandAnalysisEvent
    const discoveredCallback = vi.fn()
    const discoveredPayload = {
      blueprintId: 'bp-1',
      workspacePath: 'C:\\repo',
      nodeId: 'node-1',
      nodeTitle: 'Node',
      discovered: [],
      createdAt: '2026-07-17T00:00:00.000Z',
    } satisfies IslandDiscoveredEvent

    const unsubscribeAnalysis = janusApi.onAnalysisResult(analysisCallback)
    const [, analysisListener] = mocks.on.mock.calls[0]
    analysisListener({ sender: 'electron' }, analysisPayload)
    unsubscribeAnalysis()

    const unsubscribeDiscovered = janusApi.onDiscovered(discoveredCallback)
    const [, discoveredListener] = mocks.on.mock.calls[1]
    discoveredListener({ sender: 'electron' }, discoveredPayload)
    unsubscribeDiscovered()

    expect(analysisCallback).toHaveBeenCalledWith(analysisPayload)
    expect(discoveredCallback).toHaveBeenCalledWith(discoveredPayload)
    expect(mocks.removeListener.mock.calls).toEqual([
      [JANUS_EVENT_CHANNELS.analysis, analysisListener],
      [JANUS_EVENT_CHANNELS.discovered, discoveredListener],
    ])
  })
})
