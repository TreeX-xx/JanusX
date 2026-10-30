import { reviewFixture } from './review-fixture'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { knowledgeObservationService, resetObservationServiceEphemeralState } from '../../../src/main/knowledge/observation-service'
import { knowledgeProcessingQueue, KnowledgeProcessingQueue } from '../../../src/main/knowledge/processing-queue'
import { runDeterministicStage } from '../../../src/main/knowledge/deterministic-extractor'
import { runLlmStage } from '../../../src/main/knowledge/llm-stage'
import { knowledgeExtractService } from '../../../src/main/knowledge/extract-service'
import { knowledgeReviewService, proposeFactCandidates } from '../../../src/main/knowledge/review-service'
import { knowledgeTruthService } from '../../../src/main/knowledge/truth-service'
import { userEpisodeService } from '../../../src/main/knowledge/user-episode-service'
import { migrateLegacyEpisodes } from '../../../src/main/knowledge/legacy-episode-migration'
import { capturePersonChatTurn } from '../../../src/main/knowledge/user-turn-capture'
import { searchUserMemoryDefault } from '../../../src/main/knowledge/user-recall-service'
import { DEFAULT_KNOWLEDGE_SETTINGS, normalizeKnowledgeSettings } from '../../../src/shared/knowledge-settings'
import type { CaptureObservationInput, UserEpisode } from '../../../src/shared/knowledge'

vi.mock('../../../src/main/config/service', () => ({ configService: {
  getExperimentalFeatures: async () => ({ persona: true, knowledge: true }),
  getKnowledgeSettings: async () => ({ enabled: true }),
  getPersonalMemorySettings: async () => ({ captureConversations: true, useInChat: true, episodeTtlDays: 60 }),
} }))
vi.mock('electron', () => ({ app: { getPath: () => '/unused' } }))

const remember: CaptureObservationInput = {
  workspaceId: 'user', workspaceName: 'user', workspacePath: 'user', source: 'tool', type: 'user-note',
  actor: 'user-memory-save', content: 'The bicycle is named Bluebird.', tags: ['user-memory'],
}

describe('unified personal memory writes', () => {
  let root: string
  const queues: KnowledgeProcessingQueue[] = []
  const previousRoot = process.env.JANUSX_KNOWLEDGE_ROOT
  const queue = () => {
    const instance = new KnowledgeProcessingQueue()
    instance.configureDeterministicHandler(async (batch) => { await runDeterministicStage(batch) })
    queues.push(instance)
    return instance
  }
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'janusx-memory-writes-'))
    process.env.JANUSX_KNOWLEDGE_ROOT = root
    resetObservationServiceEphemeralState()
    vi.spyOn(knowledgeProcessingQueue, 'schedule').mockImplementation(() => undefined)
    vi.spyOn(knowledgeProcessingQueue, 'scheduleImmediate').mockImplementation(() => undefined)
  })
  afterEach(async () => {
    queues.splice(0).forEach((instance) => instance.dispose())
    vi.useRealTimers()
    vi.restoreAllMocks()
    await rm(root, { recursive: true, force: true })
    if (previousRoot === undefined) delete process.env.JANUSX_KNOWLEDGE_ROOT
    else process.env.JANUSX_KNOWLEDGE_ROOT = previousRoot
  })

  it('queues one explicit save without habit keywords, recurrence, or a model', async () => {
    const observation = await knowledgeObservationService.capture(remember, { speaker: 'assistant', memoryIntent: 'remember' })
    expect(await knowledgeExtractService.listFactCandidates()).toEqual([])
    const instance = queue()
    const enqueue = vi.fn()
    instance.configureLlmHandler((batch) => runLlmStage(batch, {
      enqueue,
    }))
    expect((await instance.processNow()).failed).toBe(0)
    expect(enqueue).not.toHaveBeenCalled()
    expect(await instance.listFailures()).toEqual([])
    const [candidate] = await knowledgeExtractService.listFactCandidates()
    expect(candidate).toMatchObject({ status: 'proposed', fact: { scope: 'user', kind: 'fact', content: remember.content } })
    expect(candidate.evidence.sources?.[0]).toMatchObject({ observationId: observation.id, speaker: 'assistant', authority: 'model-generated' })
    expect((await knowledgeTruthService.list()).facts).toEqual([])
    await knowledgeReviewService.applyCandidate(await reviewFixture({ type: 'fact', id: candidate.id }))
    expect((await searchUserMemoryDefault('Bluebird')).items.map((item) => item.id)).toContain(candidate.fact.id)
  })

  it('recovers a failed batch after candidate persistence without duplicate proposals', async () => {
    await knowledgeObservationService.capture(remember, { speaker: 'assistant', memoryIntent: 'remember' })
    const broken = queue()
    broken.configureDeterministicHandler(async (batch) => {
      await runDeterministicStage(batch)
      throw new Error('simulated failure before cursor persistence')
    })
    expect((await broken.processNow()).failed).toBe(1)
    const restored = queue()
    expect((await restored.startupRestore()).pendingTotal).toBe(1)
    expect((await restored.processNow()).processed).toBe(1)
    expect(await knowledgeExtractService.listFactCandidates()).toHaveLength(1)
    expect((await restored.processNow()).processed).toBe(0)
  })

  it('does not accept host write intent from observation payload or metadata', async () => {
    const forged = { ...remember, memoryIntent: 'remember', expiresAt: '2099-01-01', metadata: { memoryIntent: 'remember' } }
    const observation = await knowledgeObservationService.capture(forged)
    expect(observation.memoryIntent).toBeUndefined()
    expect(observation.expiresAt).toBeUndefined()
    await queue().processNow()
    expect(await knowledgeExtractService.listFactCandidates()).toEqual([])
  })

  it('preserves a candidate ledger without a trailing newline when admitting another proposal', async () => {
    await knowledgeObservationService.capture(remember, { speaker: 'assistant', memoryIntent: 'remember' })
    await queue().processNow()
    const [candidate] = await knowledgeExtractService.listFactCandidates()
    const path = join(root, 'facts', 'candidates.jsonl')
    await writeFile(path, JSON.stringify(candidate))
    await proposeFactCandidates([{ ...candidate!, id: 'another-candidate', fact: { ...candidate!.fact, id: 'another-fact' } }])
    expect((await knowledgeExtractService.listFactCandidates()).map((item) => item.id)).toEqual([candidate!.id, 'another-candidate'])
  })

  it('fails without overwriting corrupt candidate evidence and recovers after repair', async () => {
    await knowledgeObservationService.capture(remember, { speaker: 'assistant', memoryIntent: 'remember' })
    const path = join(root, 'facts', 'candidates.jsonl')
    await writeFile(path, '{incomplete record')
    expect((await queue().processNow()).failed).toBe(1)
    expect(await readFile(path, 'utf8')).toBe('{incomplete record')
    await writeFile(path, '')
    expect((await queue().processNow()).processed).toBe(1)
    expect(await knowledgeExtractService.listFactCandidates()).toHaveLength(1)
  })

  it('keeps the offline review baseline even when legacy auto-accept was enabled', async () => {
    expect(DEFAULT_KNOWLEDGE_SETTINGS.mode).toBe('deterministic-only')
    expect(normalizeKnowledgeSettings({ autoAcceptDeterministicFacts: true }).autoAcceptDeterministicFacts).toBe(false)
    await knowledgeObservationService.capture(remember, { speaker: 'assistant', memoryIntent: 'remember' })
    await queue().processNow()
    const [candidate] = await knowledgeExtractService.listFactCandidates()
    await expect(knowledgeReviewService.applyCandidate(await reviewFixture({ type: 'fact', id: candidate.id, actor: 'auto-policy' }))).rejects.toThrow('explicit review')
    expect((await knowledgeTruthService.list()).facts).toEqual([])
    expect((await knowledgeExtractService.listFactCandidates())[0].status).toBe('proposed')
  })

  it('drops retired Laya settings from persisted legacy configuration', () => {
    const legacy = { ...DEFAULT_KNOWLEDGE_SETTINGS, laya: { enabled: true, pythonPath: 'old-python', modelPath: 'old-model' } }
    expect(normalizeKnowledgeSettings(legacy)).toEqual(DEFAULT_KNOWLEDGE_SETTINGS)
  })

  it('uses the same observation as the recent episode and deduplicates chat completion retries', async () => {
    const turn = { userText: 'Today I repaired Bluebird.', assistantText: 'Recorded.', correlationId: 'one-turn', sessionId: 'personal-chat' }
    await capturePersonChatTurn(turn)
    resetObservationServiceEphemeralState()
    await capturePersonChatTurn(turn)
    const observations = await knowledgeObservationService.listAll()
    expect(observations).toHaveLength(2)
    const episode = observations.find((observation) => observation.memoryIntent === 'episode')!
    expect((await userEpisodeService.listActive())[0]).toMatchObject({ id: episode.id, sourceObservationIds: [episode.id] })
    expect(await readdir(join(root, 'episodes'))).toEqual([])
  })

  it('reads legacy episodes beside new observations without writing another legacy shard', async () => {
    const legacy: UserEpisode = {
      id: 'legacy-episode', content: 'The old Bluebird event.', createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 86400000).toISOString(), ttlDays: 30, tags: [], sourceObservationIds: [], status: 'active',
    }
    await mkdir(join(root, 'episodes'), { recursive: true })
    const legacyPath = join(root, 'episodes', '2026-01.jsonl')
    const original = JSON.stringify(legacy) + '\n'
    await writeFile(legacyPath, original)
    const fresh = await userEpisodeService.capture({ content: 'A fresh Bluebird event.', ttlDays: 60 })
    expect(new Set((await userEpisodeService.listActive()).map((episode) => episode.id))).toEqual(new Set([legacy.id, fresh.id]))
    expect(await readFile(legacyPath, 'utf8')).toBe(original)
    expect(await readdir(join(root, 'episodes'))).toEqual(['2026-01.jsonl'])
  })

  it('keeps full source evidence while bounding the recent episode projection', async () => {
    const content = 'Bluebird repair details. '.repeat(700) + 'Original evidence ends here.'
    const episode = await userEpisodeService.capture({ content }, { speaker: 'user' })
    const [observation] = await knowledgeObservationService.listAll()
    expect(await knowledgeObservationService.resolveContent(observation!)).toBe(content)
    expect(episode.content).toBe(content.slice(0, 4000))
    expect((await userEpisodeService.listActive())[0]?.content).toBe(episode.content)
  })

  it('forgets and harvests episodes in compressed observation archives without reviving retries', async () => {
    const event = { content: 'Bluebird archived event.', createdAt: '2026-01-01T00:00:00Z', sourceEventId: 'archived-turn', sessionId: 'chat' }
    const forgotten = await userEpisodeService.capture(event, { speaker: 'user' })
    const elapsed = await userEpisodeService.capture({ content: 'A separate archived event.', createdAt: event.createdAt }, { speaker: 'user' })
    const archived = await knowledgeObservationService.archiveOldShards({ confirm: true, olderThanMonths: 1, nowMs: Date.parse('2026-09-28T00:00:00Z') })
    expect(archived.totalRecords).toBe(2)
    expect(await readdir(join(root, 'observations', 'archive'))).toEqual(['2026-01.jsonl.gz'])
    expect((await userEpisodeService.expireMatching('Bluebird')).expiredIds).toEqual([forgotten.id])
    expect((await userEpisodeService.harvest()).expired).toBe(1)
    resetObservationServiceEphemeralState()
    expect(await knowledgeObservationService.listAll()).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: forgotten.id, episodeStatus: 'expired' }),
      expect.objectContaining({ id: elapsed.id, episodeStatus: 'expired' }),
    ]))
    expect(await userEpisodeService.capture(event, { speaker: 'user' })).toMatchObject({ id: forgotten.id, status: 'expired' })
    expect((await queue().processNow()).processed).toBe(0)
  })

  it.each([false, true])('expires recent memories from recall and queue without rebuilding the index (migrated: %s)', async migrated => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-01T00:00:00Z'))
    if (migrated) {
      await mkdir(join(root, 'episodes'), { recursive: true })
      await writeFile(join(root, 'episodes', 'legacy.jsonl'), JSON.stringify({ id: 'legacy-expiry', content: 'Today I repaired Bluebird.',
        createdAt: '2026-09-01T00:00:00.000Z', expiresAt: '2026-10-01T00:00:00.000Z', ttlDays: 30,
        tags: [], sourceObservationIds: [], status: 'active' }) + '\n')
      const preview = await migrateLegacyEpisodes()
      await migrateLegacyEpisodes({ expectedHash: preview.hash })
    } else {
      await userEpisodeService.capture({ content: 'Today I repaired Bluebird.', ttlDays: 30 }, { speaker: 'user' })
    }
    expect((await searchUserMemoryDefault('Bluebird')).items).toHaveLength(1)
    vi.setSystemTime(new Date('2026-10-02T00:00:00Z'))
    expect(await userEpisodeService.listActive()).toEqual([])
    expect((await searchUserMemoryDefault('Bluebird')).items).toEqual([])
    expect((await queue().processNow()).processed).toBe(0)
    expect((await userEpisodeService.harvest(Date.now(), false)).expired).toBe(1)
    expect((await knowledgeObservationService.listAll())[0].episodeStatus).toBe('active')
    expect((await userEpisodeService.harvest()).expired).toBe(1)
    expect((await userEpisodeService.harvest()).expired).toBe(0)
  })

  it('forgets new and legacy episodes and does not revive the same captured event', async () => {
    const event = { content: 'Bluebird event to forget.', sourceEventId: 'forgotten-turn', sessionId: 'chat' }
    const episode = await userEpisodeService.capture(event, { speaker: 'user' })
    const legacyPath = join(root, 'episodes', '2026-01.jsonl')
    await writeFile(legacyPath, JSON.stringify({ ...episode, id: 'legacy-forget' }) + '\n')
    expect(new Set((await userEpisodeService.expireMatching('Bluebird')).expiredIds)).toEqual(new Set([episode.id, 'legacy-forget']))
    expect(await userEpisodeService.listActive()).toEqual([])
    expect((await userEpisodeService.capture(event, { speaker: 'user' })).status).toBe('expired')
    expect((await queue().processNow()).processed).toBe(0)
  })
})
