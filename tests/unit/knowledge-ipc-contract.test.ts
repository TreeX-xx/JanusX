import { afterEach, beforeAll, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import {
  KNOWLEDGE_CHANNELS,
  type KnowledgeAPI,
} from '../../src/shared/ipc/knowledge'
import type {
  AuditEvent,
  CaptureObservationInput,
  Observation,
  StructuredCloneValue,
} from '../../src/shared/knowledge'
import { installElectronApiFallback } from '../../src/renderer/src/lib/electron-api-fallback'

const mocks = vi.hoisted(() => ({
  expose: vi.fn(),
  handle: vi.fn(),
  invoke: vi.fn(),
  getKnowledgeSettings: vi.fn(),
  updateKnowledgeSettings: vi.fn(),
  knowledgeEnabled: true,
  auditPage: vi.fn(),
}))

let knowledgeApi: KnowledgeAPI

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: (_name: string, api: { knowledge: KnowledgeAPI }) => {
      knowledgeApi = api.knowledge
      mocks.expose(api)
    },
  },
  ipcMain: { handle: mocks.handle },
  ipcRenderer: {
    invoke: mocks.invoke,
    on: vi.fn(),
    removeListener: vi.fn(),
    send: vi.fn(),
  },
}))

vi.mock('../../src/main/knowledge/contract-service', () => ({ knowledgeContractService: {} }))
vi.mock('../../src/main/knowledge/audit-service', () => ({ knowledgeAuditService: { page: mocks.auditPage } }))
vi.mock('../../src/main/knowledge/observation-service', () => ({ knowledgeObservationService: {} }))
vi.mock('../../src/main/knowledge/extract-service', () => ({ knowledgeExtractService: {} }))
vi.mock('../../src/main/knowledge/review-service', () => ({ knowledgeReviewService: {} }))
vi.mock('../../src/main/knowledge/search-service', () => ({ knowledgeSearchService: {} }))
vi.mock('../../src/main/knowledge/truth-service', () => ({ knowledgeTruthService: {} }))
vi.mock('../../src/main/knowledge/context-service', () => ({ knowledgeContextService: {} }))
vi.mock('../../src/main/knowledge/operations-service', () => ({ knowledgeOperationsService: {} }))
vi.mock('../../src/main/knowledge/diagnostics-service', () => ({ knowledgeDiagnosticsService: {} }))
vi.mock('../../src/main/knowledge/processing-queue', () => ({ knowledgeProcessingQueue: {} }))
vi.mock('../../src/main/config/service', () => ({
  configService: {
    getKnowledgeSettings: mocks.getKnowledgeSettings,
    getExperimentalFeatures: async () => ({ knowledge: mocks.knowledgeEnabled }),
    updateKnowledgeSettings: mocks.updateKnowledgeSettings,
  },
}))
vi.mock('../../src/main/remote-notifications/dispatcher', () => ({ remoteNotificationDispatcher: {} }))

beforeAll(async () => {
  await import('../../src/preload/index')
  const { registerKnowledgeHandlers } = await import('../../src/main/ipc/knowledge-handlers')
  const { registerSettingsHandlers } = await import('../../src/main/ipc/settings-handlers')
  registerKnowledgeHandlers()
  registerSettingsHandlers()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Knowledge IPC contract', () => {
  it('forwards the audit page query and preserves its event snapshots and cursor', async () => {
    const query = { domain: 'engineering', workspaceId: 'project', cursor: 'opaque', limit: 30 }
    const result = { items: [{ id: 'audit-event', before: { content: 'old' }, after: { content: 'new' } }], total: 35, nextCursor: 'next', byAction: {}, workspaces: [] }
    mocks.auditPage.mockResolvedValueOnce(result)
    const handler = mocks.handle.mock.calls.find(([channel]) => channel === KNOWLEDGE_CHANNELS.auditPage)![1]
    expect(await handler({}, query)).toBe(result)
    expect(mocks.auditPage).toHaveBeenCalledWith(query)
  })
  beforeEach(() => {
    mocks.invoke.mockReset()
    mocks.invoke.mockResolvedValue(undefined)
    mocks.getKnowledgeSettings.mockReset()
    mocks.updateKnowledgeSettings.mockReset()
    mocks.knowledgeEnabled = true
  })

  it('defines and registers exactly the public channel set without maintenance exposure', () => {
    const channels = Object.values(KNOWLEDGE_CHANNELS)
    // Phase 5: `knowledge:extract` direct IPC removed (queue-owned LLM stage).
    // Post-Phase 5: +2 external-MCP registration channels (status/register).
    // User memory M4: +1 workspace-free glance channel (user-memory:overview).
    // R3 note wiki: +4 note-wiki channels (pages/prepare/propose/statuses).
    // Laya retirement: remove its runtime control channel.
    expect(channels).toHaveLength(33)
    expect(new Set(channels).size).toBe(channels.length)
    expect(mocks.handle.mock.calls.map(([channel]) => channel)).toEqual(expect.arrayContaining(channels))
    expect(channels).not.toEqual(expect.arrayContaining([
      'knowledge:observations:auto-prune',
      'knowledge:observations:archive',
      'knowledge:observations:compact',
    ]))
  })

  it('routes all typed operations with their existing argument order', async () => {
    const observation = { id: 'observation-1' } as Observation
    const captureInput = {
      workspacePath: 'C:\\work',
      source: 'manual' as const,
      type: 'user-note' as const,
      content: 'note',
    }
    const reviewInput = { type: 'fact' as const, id: 'candidate-1', candidateHash: 'a'.repeat(64) }
    const feedbackInput = {
      action: 'open' as const,
      resultKind: 'fact' as const,
      workspaceId: 'workspace-1',
      outcome: 'success' as const,
    }

    await knowledgeApi.contracts()
    await knowledgeApi.bootstrap('C:\\work')
    await knowledgeApi.observe(captureInput)
    await knowledgeApi.listObservations({ scope: 'global', limit: 10 })
    await knowledgeApi.pruneObservations({ scope: 'workspace', confirm: true })
    await knowledgeApi.autoPruneObservations(123)
    await knowledgeApi.resolveObservationContent(observation)
    await knowledgeApi.retentionStats()
    await knowledgeApi.listAudit({ limit: 5 })
    await knowledgeApi.auditPage({ domain: 'engineering', limit: 30, cursor: 'cursor' })
    await knowledgeApi.auditStats()
    await knowledgeApi.auditStats({ domain: 'engineering', workspaceId: 'workspace-1' })
    await knowledgeApi.listCandidates()
    await knowledgeApi.rejectCandidate(reviewInput)
    await knowledgeApi.applyCandidate(reviewInput)
    await knowledgeApi.factReviewContext(reviewInput)
    await knowledgeApi.listTruth()
    await knowledgeApi.processNow({ workspaceId: 'workspace-1' })
    await knowledgeApi.processingStats()
    await knowledgeApi.userMemoryOverview()
    await knowledgeApi.personalProfileEditContext()
    await knowledgeApi.savePersonalProfile({ expectedHash: 'a'.repeat(64), overrides: { identity: 'Tree' } })
    await knowledgeApi.importLegacyPersonalMemory()
    await knowledgeApi.migrateLegacyEpisodes({ expectedHash: 'b'.repeat(64) })
    await knowledgeApi.candidateAction({candidateId: 'c', candidateHash: 'a'.repeat(64), action: 'score'})
    await knowledgeApi.forgetPersonalMemory({ targetId: 'old', targetHash: 'hash', kind: 'episode' })
    await knowledgeApi.proposePersonalMemoryCorrection({ targetId: 'old', targetHash: 'hash', content: 'new' })
    await knowledgeApi.getSettings()
    await knowledgeApi.updateSettings({ enabled: false })

    expect(mocks.invoke.mock.calls).toEqual([
      [KNOWLEDGE_CHANNELS.contracts],
      [KNOWLEDGE_CHANNELS.bootstrap, 'C:\\work'],
      [KNOWLEDGE_CHANNELS.observe, captureInput],
      [KNOWLEDGE_CHANNELS.listObservations, { scope: 'global', limit: 10 }],
      [KNOWLEDGE_CHANNELS.pruneObservations, { scope: 'workspace', confirm: true }],
      [KNOWLEDGE_CHANNELS.autoPruneObservations, 123],
      [KNOWLEDGE_CHANNELS.resolveObservationContent, observation],
      [KNOWLEDGE_CHANNELS.retentionStats],
      [KNOWLEDGE_CHANNELS.listAudit, { limit: 5 }],
      [KNOWLEDGE_CHANNELS.auditPage, { domain: 'engineering', limit: 30, cursor: 'cursor' }],
      [KNOWLEDGE_CHANNELS.auditStats],
      [KNOWLEDGE_CHANNELS.auditStats, { domain: 'engineering', workspaceId: 'workspace-1' }],
      [KNOWLEDGE_CHANNELS.listCandidates],
      [KNOWLEDGE_CHANNELS.rejectCandidate, reviewInput],
      [KNOWLEDGE_CHANNELS.applyCandidate, reviewInput],
      [KNOWLEDGE_CHANNELS.factReviewContext, reviewInput],
      [KNOWLEDGE_CHANNELS.listTruth],
      [KNOWLEDGE_CHANNELS.processNow, { workspaceId: 'workspace-1' }],
      [KNOWLEDGE_CHANNELS.processingStats],
      [KNOWLEDGE_CHANNELS.userMemoryOverview],
      [KNOWLEDGE_CHANNELS.personalProfileEditContext],
      [KNOWLEDGE_CHANNELS.savePersonalProfile, { expectedHash: 'a'.repeat(64), overrides: { identity: 'Tree' } }],
      [KNOWLEDGE_CHANNELS.importLegacyPersonalMemory],
      [KNOWLEDGE_CHANNELS.migrateLegacyEpisodes, { expectedHash: 'b'.repeat(64) }],
      [KNOWLEDGE_CHANNELS.candidateAction, {candidateId: 'c', candidateHash: 'a'.repeat(64), action: 'score'}],
      [KNOWLEDGE_CHANNELS.forgetPersonalMemory, { targetId: 'old', targetHash: 'hash', kind: 'episode' }],
      [KNOWLEDGE_CHANNELS.proposePersonalMemoryCorrection, { targetId: 'old', targetHash: 'hash', content: 'new' }],
      [KNOWLEDGE_CHANNELS.getSettings],
      [KNOWLEDGE_CHANNELS.updateSettings, { enabled: false }],
    ])
  })

  it('binds source withdrawal to the workspace and reviewed source snapshot', async () => {
    const target = { id: 'source', workspaceId: 'workspace' }
    await knowledgeApi.observationRevocationContext(target)
    await knowledgeApi.revokeObservation({ ...target, sourceHash: 'a'.repeat(64) })
    await knowledgeApi.observationRevocations({ offset: 20, limit: 20 })
    expect(mocks.invoke.mock.calls).toEqual([
      [KNOWLEDGE_CHANNELS.observationRevocationContext, target],
      [KNOWLEDGE_CHANNELS.revokeObservation, { ...target, sourceHash: 'a'.repeat(64) }],
      [KNOWLEDGE_CHANNELS.observationRevocations, { offset: 20, limit: 20 }],
    ])
  })

  it('does not expose a generic bridge', () => {
    expect(mocks.expose.mock.calls[0]?.[0]).not.toHaveProperty('invoke')
  })

  it('does not expose or register the retired knowledge model deployment API', () => {
    for (const method of ['stopLocalModel', 'configureLocalModel', 'installLocalResources', 'localResourcesStatus']) {
      expect(knowledgeApi).not.toHaveProperty(method)
    }
    expect(mocks.handle.mock.calls.map(([channel]) => channel).filter(channel => channel.startsWith('knowledge:local-model:'))).toEqual([])
  })

  it('delegates Settings handler defaults, partial updates, raw returns, and failures', async () => {
    const getHandler = mocks.handle.mock.calls.find(([channel]) => channel === KNOWLEDGE_CHANNELS.getSettings)?.[1]
    const updateHandler = mocks.handle.mock.calls.find(([channel]) => channel === KNOWLEDGE_CHANNELS.updateSettings)?.[1]
    const raw = { enabled: false }
    mocks.getKnowledgeSettings.mockResolvedValue(raw)
    mocks.updateKnowledgeSettings.mockResolvedValue(raw)

    await expect(getHandler({})).resolves.toBe(raw)
    await expect(updateHandler({}, undefined)).resolves.toBe(raw)
    expect(mocks.updateKnowledgeSettings).toHaveBeenLastCalledWith({})
    await expect(updateHandler({}, { enabled: false })).resolves.toBe(raw)
    expect(mocks.updateKnowledgeSettings).toHaveBeenLastCalledWith({ enabled: false, automation: undefined })

    const failure = new Error('config unavailable')
    mocks.getKnowledgeSettings.mockRejectedValueOnce(failure)
    mocks.updateKnowledgeSettings.mockRejectedValueOnce(failure)
    await expect(getHandler({})).rejects.toBe(failure)
    await expect(updateHandler({}, { enabled: true })).rejects.toBe(failure)
  })

  it('constrains public extensible values to structured-clone-safe data', () => {
    const metadata: StructuredCloneValue = {
      nested: ['text', 1, true, null, { optional: undefined }],
    }
    const observation: CaptureObservationInput = {
      workspacePath: 'C:\\work',
      source: 'manual',
      type: 'user-note',
      content: 'clone-safe',
      metadata: { value: metadata },
    }
    const audit: AuditEvent = {
      id: 'audit',
      action: 'capture',
      targetType: 'observation',
      targetId: 'observation',
      before: { value: metadata },
      after: { saved: true },
      provenance: {
        workspaceId: 'workspace',
        workspaceName: 'Workspace',
        workspacePath: 'C:\\work',
        source: 'manual',
        sourceObservationIds: [],
        fileRefs: [],
        actor: 'tester',
        createdAt: '2026-07-17T00:00:00.000Z',
      },
    }
    type MetadataValue = NonNullable<CaptureObservationInput['metadata']>[string]

    expect(structuredClone({ observation, audit })).toEqual({ observation, audit })
    expectTypeOf<() => void>().not.toMatchTypeOf<MetadataValue>()
    expectTypeOf<symbol>().not.toMatchTypeOf<MetadataValue>()
    expectTypeOf<Date>().not.toMatchTypeOf<MetadataValue>()
  })

  it('installs all Knowledge methods in browser fallback and rejects every call', async () => {
    vi.stubGlobal('window', {})
    vi.stubGlobal('navigator', { platform: 'Win32' })

    installElectronApiFallback()

    const observation: Observation = {
      id: 'observation',
      workspaceId: 'workspace',
      workspaceName: 'Workspace',
      workspacePath: 'C:\\work',
      source: 'manual',
      type: 'user-note',
      content: 'content',
      fileRefs: [],
      tags: [],
      visibility: 'workspace',
      actor: 'tester',
      createdAt: '2026-07-17T00:00:00.000Z',
      retentionClass: 'evidence',
      contentHash: 'a'.repeat(64),
      dedupeKey: 'b'.repeat(64),
      contentLength: 7,
      compactionStatus: 'active',
    }
    const api = window.electron.knowledge
    const calls = Object.values(api).map(method => () => (method as () => Promise<unknown>)())
    expect(Object.keys(api)).toHaveLength(33)
    expect(calls).toHaveLength(33)
    for (const call of calls) {
      await expect(call()).rejects.toThrow('Electron knowledge API is unavailable')
    }
  })
})
