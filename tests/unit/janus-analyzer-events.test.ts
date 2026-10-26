import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { JANUS_EVENT_CHANNELS } from '../../src/shared/ipc/janus'
import type {
  BlueprintNode,
  BlueprintRequirementCandidate,
} from '../../plugins/blueprint/src/shared/janus/types'

const mocks = vi.hoisted(() => ({
  appendAnalysis: vi.fn(),
  applyAnalysisPatch: vi.fn(),
  commitExists: vi.fn(),
  findNode: vi.fn(),
  generateObject: vi.fn(),
  getCommitDiff: vi.fn(),
  getCommitRange: vi.fn(),
  getDefaultModel: vi.fn(),
  getLanguageModel: vi.fn(),
  send: vi.fn(),
  setCursor: vi.fn(),
  upsertRequirementCandidates: vi.fn(),
}))

vi.mock('electron', () => ({ BrowserWindow: class {} }))
vi.mock('../../src/main/git/service', () => ({
  commitExists: mocks.commitExists,
  getCommitDiff: mocks.getCommitDiff,
  getCommitRange: mocks.getCommitRange,
}))
vi.mock('../../src/main/llm/LlmService', () => ({
  llmService: {
    getDefaultModel: mocks.getDefaultModel,
    getLanguageModel: mocks.getLanguageModel,
  },
}))
vi.mock('../../src/main/llm/ai-runtime', () => ({
  generateObject: mocks.generateObject,
}))
vi.mock('../../src/main/janus/blueprint-store', () => ({
  blueprintStore: {
    appendAnalysis: mocks.appendAnalysis,
    applyAnalysisPatch: mocks.applyAnalysisPatch,
    findNode: mocks.findNode,
    setCursor: mocks.setCursor,
    upsertRequirementCandidates: mocks.upsertRequirementCandidates,
  },
  isProjectGraphId: (id: string) => id.startsWith('harness:project:'),
}))

let analyzer: typeof import('../../src/main/janus/analyzer').analyzer

const node: BlueprintNode = {
  id: 'node-1',
  title: 'Typed Janus IPC',
  type: 'task',
  status: 'in-progress',
  progress: 40,
  statusSource: 'manual',
  positioning: 'Migrate the boundary',
  description: 'Keep event payloads intact',
  features: [],
  completedItems: [],
  techSolution: 'Shared contract',
  notes: '',
  todos: [],
  issues: [],
  activities: [],
  analyses: [],
  workspaceId: 'workspace-1',
  workspaceSnapshot: { name: 'JanusX', path: 'C:\\repo' },
  boundTerminalId: null,
  terminalHistory: [],
  lastAnalyzedCommitSha: null,
  children: [],
  parentId: 'root-node',
  tags: [],
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
}

const candidate: BlueprintRequirementCandidate = {
  id: 'candidate-1',
  blueprintId: 'bp-1',
  sourceNodeId: 'node-1',
  sourceAnalysisId: 'analysis-source',
  title: 'Add event coverage',
  description: 'Exercise the discovered event producer',
  suggestedParentId: 'root-node',
  suggestedParentTitle: 'Root',
  confidence: 0.85,
  status: 'pending',
  evidence: ['focused test'],
  createdAt: '2026-07-17T00:00:00.000Z',
}

beforeAll(async () => {
  analyzer = (await import('../../src/main/janus/analyzer')).analyzer
})

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-07-17T08:00:00.000Z'))
  vi.clearAllMocks()
  analyzer.setMainWindow({ webContents: { send: mocks.send } } as unknown as Electron.BrowserWindow)
  mocks.findNode.mockResolvedValue({ blueprintId: 'bp-1', node })
  mocks.getCommitRange.mockResolvedValue([
    {
      hash: 'abcdef123456',
      shortHash: 'abcdef1',
      message: 'migrate Janus IPC',
      author: 'Tree',
      date: '2026-07-17T07:00:00.000Z',
    },
  ])
  mocks.getCommitDiff.mockResolvedValue('diff --git a/old.ts b/new.ts\n+typed boundary')
  mocks.getDefaultModel.mockResolvedValue({ provider: { id: 'provider-1' }, modelId: 'model-1' })
  mocks.getLanguageModel.mockResolvedValue({})
  mocks.appendAnalysis.mockResolvedValue(undefined)
  mocks.applyAnalysisPatch.mockResolvedValue(node)
  mocks.setCursor.mockResolvedValue(undefined)
  mocks.upsertRequirementCandidates.mockResolvedValue([candidate])
})

afterAll(() => {
  analyzer.setMainWindow(null)
  vi.useRealTimers()
})

describe('Janus analyzer Island event producers', () => {
  it('publishes complete analysis and discovered payloads through shared channels', async () => {
    mocks.generateObject.mockResolvedValue({
      object: {
        progress: 75,
        status: 'testing',
        summary: 'Typed boundary completed',
        confidence: 0.9,
        evidence: ['shared contract'],
        unresolved: [],
        discoveredRequirements: [
          {
            title: candidate.title,
            description: candidate.description,
            suggestedParent: 'Root',
            confidence: candidate.confidence,
          },
        ],
        featureUpdates: [],
        newFeatureRequirements: [],
      },
    })

    const analysis = await analyzer.analyzeNode('node-1', {
      workspacePath: 'C:\\repo',
      trigger: 'manual',
    })

    expect(analysis).not.toBeNull()
    if (!analysis) throw new Error('Expected a successful analysis')
    expect(mocks.send.mock.calls).toEqual([
      [
        JANUS_EVENT_CHANNELS.analysis,
        {
          blueprintId: 'bp-1',
          workspacePath: 'C:\\repo',
          nodeId: 'node-1',
          nodeTitle: node.title,
          applied: true,
          error: undefined,
          result: analysis.result,
          createdAt: analysis.createdAt,
        },
      ],
      [
        JANUS_EVENT_CHANNELS.discovered,
        {
          blueprintId: 'bp-1',
          workspacePath: 'C:\\repo',
          nodeId: 'node-1',
          nodeTitle: node.title,
          candidateIds: ['candidate-1'],
          requirements: [candidate],
          discovered: [
            {
              title: candidate.title,
              description: candidate.description,
              suggestedParent: 'Root',
              confidence: candidate.confidence,
            },
          ],
          createdAt: '2026-07-17T08:00:00.000Z',
        },
      ],
    ])
    expect(mocks.send.mock.calls.every((call) => call.length === 2)).toBe(true)
  })

  it('publishes the complete non-applied analysis payload on analyzer failure', async () => {
    mocks.getDefaultModel.mockResolvedValue(null)

    const analysis = await analyzer.analyzeNode('node-1', {
      workspacePath: 'C:\\repo',
      trigger: 'reconcile',
    })

    expect(analysis).not.toBeNull()
    if (!analysis) throw new Error('Expected a failed analysis record')
    expect(analysis.applied).toBe(false)
    expect(analysis.error).toBeTruthy()
    expect(mocks.send).toHaveBeenCalledWith(JANUS_EVENT_CHANNELS.analysis, {
      blueprintId: 'bp-1',
      workspacePath: 'C:\\repo',
      nodeId: 'node-1',
      nodeTitle: node.title,
      applied: false,
      error: analysis.error,
      result: analysis.result,
      createdAt: analysis.createdAt,
    })
    expect(mocks.send).toHaveBeenCalledTimes(1)
    expect(mocks.upsertRequirementCandidates).not.toHaveBeenCalled()
  })

  it('skips legacy persistence on project graphs but still publishes the analysis', async () => {
    mocks.findNode.mockResolvedValue({ blueprintId: 'harness:project:deadbeef', node })
    mocks.generateObject.mockResolvedValue({
      object: {
        progress: 75,
        status: 'testing',
        summary: 'Typed boundary completed',
        confidence: 0.9,
        evidence: ['shared contract'],
        unresolved: [],
        discoveredRequirements: [
          {
            title: candidate.title,
            description: candidate.description,
            suggestedParent: 'Root',
            confidence: candidate.confidence,
          },
        ],
        featureUpdates: [],
        newFeatureRequirements: [],
      },
    })

    const analysis = await analyzer.analyzeNode('node-1', {
      workspacePath: 'C:\\repo',
      trigger: 'manual',
    })

    expect(analysis).not.toBeNull()
    expect(mocks.appendAnalysis).not.toHaveBeenCalled()
    expect(mocks.applyAnalysisPatch).not.toHaveBeenCalled()
    expect(mocks.upsertRequirementCandidates).not.toHaveBeenCalled()
    expect(mocks.setCursor).not.toHaveBeenCalled()
    expect(mocks.send).toHaveBeenCalledWith(JANUS_EVENT_CHANNELS.analysis, expect.objectContaining({
      blueprintId: 'harness:project:deadbeef',
      nodeId: 'node-1',
    }))
  })
})
