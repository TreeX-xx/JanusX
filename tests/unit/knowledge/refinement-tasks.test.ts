import { archiveFixtureFact } from './review-fixture'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CandidateFact, MemoryFact, Observation } from '../../../src/shared/knowledge'
import { DEFAULT_KNOWLEDGE_SETTINGS, type KnowledgeSettings } from '../../../src/shared/knowledge-settings'
import { candidateDecisionHash, DECISION_TEMPLATE_VERSION } from '../../../src/main/knowledge/decision-scorer'
import { refinementContextHash, refinementEvidenceHash, refinementHash } from '../../../src/main/knowledge/refinement-snapshot'
import { RefinementTaskService, type RefinementTaskDeps } from '../../../src/main/knowledge/refinement-tasks'
import { KnowledgeProcessingQueue } from '../../../src/main/knowledge/processing-queue'
import { runLlmStage } from '../../../src/main/knowledge/llm-stage'
import { sourceEvidence } from '../../../src/main/knowledge/memory-evidence'
import { writeFileAtomic } from '../../../src/main/lib/atomic-file'
import { forgettingPath, memoryKey } from '../../../src/main/knowledge/personal-forgetting-barrier'

vi.mock('electron', () => ({ app: { getPath: () => '/unused' } }))

describe('durable refinement tasks', () => {
  let root: string
  let now: number
  let candidates: CandidateFact[]
  let observations: Observation[]
  let truths: MemoryFact[]
  let settings: KnowledgeSettings
  let available: boolean
  let identity: { provider: string; modelRevision: string; templateVersion: string; calibrationId: string | null }
  let deps: RefinementTaskDeps
  const previousRoot = process.env.JANUSX_KNOWLEDGE_ROOT
  const extract = vi.fn<RefinementTaskDeps['extract']>()
  const journal = () => join(root, 'processing', 'refinement-tasks.json')
  const plan = () => ({ observations, candidateHashes: Object.fromEntries(candidates.map((candidate) => [candidate.id, candidateDecisionHash(candidate)])) })

  function seed(count = 1, contentLength = 100) {
    observations = Array.from({ length: count }, (_, i): Observation => ({
      id: `observation-${i}`, workspaceId: 'project', workspaceName: 'project', workspacePath: 'C:/work',
      scope: 'project', source: 'manual', type: 'user-note', content: `Evidence ${i}: ` + 'x'.repeat(contentLength - `Evidence ${i}: `.length),
      fileRefs: [], tags: [], visibility: 'workspace', actor: 'user', createdAt: new Date(now).toISOString(), retentionClass: 'evidence',
    }))
    candidates = observations.map((observation, i): CandidateFact => {
      const candidate: CandidateFact = {
        id: `candidate-${i}`, type: 'fact', status: 'proposed', derivation: 'deterministic', evidence: { observationIds: [observation.id] },
        fact: { id: `fact-${i}`, content: `Candidate claim ${i}`, concepts: [], files: [], tags: [], confidence: 0.8,
          version: 1, status: 'proposed', scope: 'project', kind: 'decision', provenance: {
            workspaceId: 'project', workspaceName: 'project', workspacePath: 'C:/work', source: 'manual',
            sourceObservationIds: [observation.id], fileRefs: [], actor: 'user', createdAt: observation.createdAt,
          } },
      }
      candidate.decision = {
        version: 1, scorer: { ...identity }, inputHash: refinementHash(['decision', i]), candidateHash: candidateDecisionHash(candidate),
        createdAt: observation.createdAt, status: 'ready', route: 'refine', reason: 'needs-refinement', answers: [],
        evidenceRanges: [{ observationId: observation.id, start: 0, end: observation.content.length }], relatedFactIds: [], truncated: false,
        evidenceHashes: { [observation.id]: refinementEvidenceHash(observation, observation.content) },
        contextHash: refinementContextHash(truths, 'project', 'project', now),
      }
      return candidate
    })
  }

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'janusx-refinement-'))
    process.env.JANUSX_KNOWLEDGE_ROOT = root
    now = Date.parse('2026-09-28T00:00:00Z')
    truths = []
    settings = { ...DEFAULT_KNOWLEDGE_SETTINGS, mode: 'auto' }
    available = true
    identity = { provider: 'test-scorer', modelRevision: 'pinned', templateVersion: DECISION_TEMPLATE_VERSION, calibrationId: null }
    extract.mockReset().mockResolvedValue(undefined)
    deps = { listCandidates: async () => candidates, listObservations: async () => observations, listTruth: async () => truths,
      resolveContent: async (observation) => observation.content, settings: async () => settings, hasModel: async () => available,
      scorerIdentity: () => identity, extract, nowMs: () => now }
    seed()
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
    if (previousRoot === undefined) delete process.env.JANUSX_KNOWLEDGE_ROOT
    else process.env.JANUSX_KNOWLEDGE_ROOT = previousRoot
  })

  it.each(['revoke', 'expire', 'review', 'evidence'] as const)('exposes %s invalidation while disabled and persists cancellation on the next run', async change => {
    truths = [{ ...candidates[0]!.fact, status: 'active' }]
    seed()
    const service = new RefinementTaskService(deps)
    await service.enqueue(plan())
    const before = await readFile(journal(), 'utf8')
    if (change === 'revoke') truths[0]!.status = 'archived'
    if (change === 'expire') truths[0]!.ttl = new Date(now - 1).toISOString()
    if (change === 'review') candidates[0]!.status = 'rejected'
    if (change === 'evidence') observations[0]!.content += ' withdrawn'
    settings.enabled = false
    available = false
    expect(await service.stats()).toMatchObject({ cancelled: 1, pending: 0 })
    expect(await readFile(journal(), 'utf8')).toBe(before)
    expect(await service.runDue()).toMatchObject({ cancelled: 1, processed: 0 })
    expect(JSON.parse(await readFile(journal(), 'utf8')).tasks[0].status).toBe('cancelled')
    expect((await new RefinementTaskService(deps).list())[0]!.status).toBe('cancelled')
    expect(extract).not.toHaveBeenCalled()
  })

  it('propagates a real fact revocation into durable task cancellation', async () => {
    const truth = { ...candidates[0]!.fact, status: 'active' }
    await mkdir(join(root, 'facts'))
    await writeFile(join(root, 'facts/facts.jsonl'), JSON.stringify(truth) + '\n')
    deps.listTruth = async () => (await readFile(join(root, 'facts/facts.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line))
    const service = new RefinementTaskService(deps)
    await service.enqueueManual(candidates[0]!.id, candidateDecisionHash(candidates[0]!))
    await archiveFixtureFact(truth.id)
    expect(await service.stats()).toMatchObject({ pending: 0, cancelled: 1 })
    expect(await service.runDue()).toMatchObject({ cancelled: 1 })
    expect(extract).not.toHaveBeenCalled()
  })

  it('rechecks candidate review while the provider is running', async () => {
    const service = new RefinementTaskService(deps)
    await service.enqueue(plan())
    extract.mockImplementation(async (_observations, _hashes, validate) => {
      expect(await validate!()).toBe(true)
      candidates[0]!.status = 'rejected'
      expect(await service.stats()).toMatchObject({ cancelled: 1, running: 0 })
      expect(await validate!()).toBe(false)
    })
    expect(await service.runDue()).toMatchObject({ cancelled: 1, processed: 0 })
  })

  it('does not mask unreadable source state in task diagnostics', async () => {
    const service = new RefinementTaskService(deps)
    await service.enqueue(plan())
    const before = await readFile(journal(), 'utf8')
    deps.listTruth = async () => { throw new Error('truth unreadable') }
    await expect(service.stats()).rejects.toThrow('truth unreadable')
    expect(await readFile(journal(), 'utf8')).toBe(before)
  })

  it('deduplicates concurrent submissions and stores hashes without copied private text', async () => {
    const first = new RefinementTaskService(deps)
    const second = new RefinementTaskService(deps)
    expect((await Promise.all([first.enqueue(plan()), second.enqueue(plan())])).sort()).toEqual([0, 1])
    expect(await second.list()).toHaveLength(1)
    const text = await readFile(journal(), 'utf8')
    expect(text).not.toContain(observations[0]!.content)
    expect(text).not.toContain(candidates[0]!.fact.content)
  })

  it('runs explicit manual refinement with no scorer and automatic refinement off', async () => {
    identity.provider = 'noop'
    settings.mode = 'deterministic-only'
    delete candidates[0]!.decision
    const service = new RefinementTaskService(deps)
    const hash = candidateDecisionHash(candidates[0]!)
    expect(await service.enqueueManual(candidates[0]!.id, hash)).toBe(1)
    expect(await service.enqueueManual(candidates[0]!.id, hash)).toBe(0)
    expect((await service.list())[0]).toMatchObject({ trigger: 'manual', scorer: { provider: 'manual' } })
    available = false
    expect(await service.runDue()).toMatchObject({ deferred: 1 })
    expect((await service.list())[0]!.attempts).toBe(0)
    available = true
    expect(await service.runDue()).toMatchObject({ processed: 1 })
    expect(extract).toHaveBeenCalledExactlyOnceWith(observations, { [candidates[0]!.id]: hash }, expect.any(Function))
    expect(candidates[0]!.status).toBe('proposed')
  })

  it('revalidates evidence after model work and cancels stale manual output', async () => {
    const service = new RefinementTaskService(deps)
    await service.enqueueManual(candidates[0]!.id, candidateDecisionHash(candidates[0]!))
    extract.mockImplementation(async (_observations, _hashes, validate) => {
      expect(await validate!()).toBe(true)
      observations[0]!.content += ' withdrawn'
      expect(await validate!()).toBe(false)
    })
    expect(await service.runDue()).toMatchObject({ cancelled: 1, processed: 0 })
  })

  it.each(['candidate', 'evidence', 'context', 'review'] as const)('cancels manual refinement after %s changes', async change => {
    const service = new RefinementTaskService(deps)
    await service.enqueueManual(candidates[0]!.id, candidateDecisionHash(candidates[0]!))
    if (change === 'candidate') candidates[0]!.fact.content += ' changed'
    if (change === 'evidence') observations[0]!.content += ' changed'
    if (change === 'context') truths.push({ ...candidates[0]!.fact, status: 'active' })
    if (change === 'review') candidates[0]!.status = 'rejected'
    expect(await service.runDue()).toMatchObject({ cancelled: 1 })
    expect(extract).not.toHaveBeenCalled()
  })

  it.each(['remember', 'owner', 'scope', 'expired', 'stale'] as const)('rejects manual submission with %s evidence', async change => {
    const service = new RefinementTaskService(deps)
    const hash = candidateDecisionHash(candidates[0]!)
    if (change === 'remember') observations[0]!.memoryIntent = 'remember'
    if (change === 'owner') observations[0]!.workspaceId = 'other'
    if (change === 'scope') observations[0]!.scope = 'user'
    if (change === 'expired') observations[0]!.expiresAt = new Date(now - 1).toISOString()
    if (change === 'stale') candidates[0]!.fact.content += ' changed'
    await expect(service.enqueueManual(candidates[0]!.id, hash)).rejects.toThrow()
    expect(await service.list()).toEqual([])
  })

  it('recovers independently of observation cursors with persisted exponential retry', async () => {
    const service = new RefinementTaskService(deps)
    await service.enqueue(plan())
    extract.mockRejectedValueOnce(new Error('sensitive provider detail'))
    expect(await service.runDue()).toMatchObject({ failed: 1 })
    expect((await service.list())[0]).toMatchObject({ status: 'pending', attempts: 1, nextRetryAt: now + 60000 })
    expect(await readFile(journal(), 'utf8')).not.toContain('sensitive provider detail')
    const restarted = new RefinementTaskService(deps)
    const queue = new KnowledgeProcessingQueue({ listAllObservations: async () => [], recordAudit: async () => undefined, nowMs: () => now })
    queue.configureDeterministicHandler(async () => {})
    queue.configureRefinementHandler((workspaceId) => restarted.runDue(workspaceId))
    try {
      await queue.processNow()
      expect(extract).toHaveBeenCalledTimes(1)
      now += 60000
      expect((await queue.processNow()).processed).toBe(0)
      expect(extract).toHaveBeenCalledTimes(2)
      expect((await restarted.list())[0]).toMatchObject({ status: 'succeeded', attempts: 2 })
      await queue.processRefinementsNow()
      expect(extract).toHaveBeenCalledTimes(2)
    } finally { queue.dispose() }
  })

  it('defers disabled, model-less, and scorer-less tasks without consuming attempts', async () => {
    const service = new RefinementTaskService(deps)
    await service.enqueue(plan())
    settings.enabled = false
    expect(await service.runDue()).toMatchObject({ deferred: 1 })
    settings.enabled = true
    settings.mode = 'deterministic-only'
    expect(await service.runDue()).toMatchObject({ deferred: 1 })
    settings.mode = 'auto'; available = false
    expect(await service.runDue()).toMatchObject({ deferred: 1 })
    available = true
    const original = identity
    identity = { ...identity, provider: 'noop' }
    expect(await service.runDue()).toMatchObject({ deferred: 1 })
    expect((await service.list())[0]?.attempts).toBe(0)
    expect(extract).not.toHaveBeenCalled()
    identity = original
    expect(await service.runDue()).toMatchObject({ processed: 1 })
  })

  it('recovers an interrupted running task with a bounded new attempt', async () => {
    const service = new RefinementTaskService(deps)
    await service.enqueue(plan())
    const tasks = await service.list()
    tasks[0]!.status = 'running'; tasks[0]!.attempts = 1
    await writeFile(journal(), JSON.stringify({ version: 1, tasks }))
    expect(await new RefinementTaskService(deps).runDue()).toMatchObject({ processed: 1 })
    expect((await service.list())[0]).toMatchObject({ status: 'succeeded', attempts: 2 })
  })

  it.each(['approved', 'rejected', 'candidate', 'expired', 'evidence', 'truth', 'scorer', 'scope'] as const)('cancels obsolete %s snapshots without invoking the model', async (change) => {
    const service = new RefinementTaskService(deps)
    await service.enqueue(plan())
    if (change === 'approved') candidates[0]!.status = 'applied'
    if (change === 'rejected') candidates[0]!.status = 'rejected'
    if (change === 'candidate') candidates[0]!.fact.content = 'New claim'
    if (change === 'expired') observations[0]!.expiresAt = new Date(now - 1).toISOString()
    if (change === 'evidence') observations[0]!.content = 'Corrected source'
    if (change === 'truth') truths = [{ ...candidates[0]!.fact, status: 'active' }]
    if (change === 'scorer') identity = { ...identity, modelRevision: 'different' }
    if (change === 'scope') observations[0]!.scope = 'user'
    expect(await new RefinementTaskService(deps).runDue()).toMatchObject({ cancelled: 1 })
    expect(extract).not.toHaveBeenCalled()
    expect((await service.list())[0]?.status).toBe('cancelled')
  })

  it('does not repeat model work after candidate commit but before task completion persistence', async () => {
    const service = new RefinementTaskService(deps)
    await service.enqueue(plan())
    const tasks = await service.list()
    tasks[0]!.status = 'running'; tasks[0]!.attempts = 1
    await writeFile(journal(), JSON.stringify({ version: 1, tasks }))
    candidates[0]!.derivation = 'merged'
    expect(await new RefinementTaskService(deps).runDue()).toMatchObject({ cancelled: 1 })
    expect(extract).not.toHaveBeenCalled()
  })

  it('keeps overflow tasks pending and completes them on a later budget', async () => {
    seed(15, 5000)
    const service = new RefinementTaskService(deps)
    expect(await service.enqueue(plan())).toBe(15)
    expect(await service.runDue()).toMatchObject({ processed: 12, deferred: 3 })
    expect((await service.list()).filter((task) => task.status === 'pending')).toHaveLength(3)
    expect(await new RefinementTaskService(deps).runDue()).toMatchObject({ processed: 3 })
    expect(extract).toHaveBeenCalledTimes(15)
  })

  it('stops after three failed calls and never implicitly revives the terminal task', async () => {
    const service = new RefinementTaskService(deps)
    await service.enqueue(plan())
    extract.mockRejectedValue(new Error('offline'))
    await service.runDue()
    now += 60000
    await service.runDue()
    now += 120000
    await service.runDue()
    expect((await service.list())[0]).toMatchObject({ status: 'failed', attempts: 3 })
    expect(await service.enqueue(plan())).toBe(0)
    now += 86400000
    await service.runDue()
    expect(extract).toHaveBeenCalledTimes(3)
  })

  it('fails closed on corrupt journals without overwriting the bytes', async () => {
    const service = new RefinementTaskService(deps)
    await service.enqueue(plan())
    await writeFile(journal(), '{damaged')
    await expect(service.runDue()).rejects.toThrow()
    await expect(service.enqueue(plan())).rejects.toThrow()
    expect(await readFile(journal(), 'utf8')).toBe('{damaged')
    expect(extract).not.toHaveBeenCalled()
  })

  it('retains the observation for retry if the task journal cannot be written', async () => {
    const service = new RefinementTaskService(deps)
    await service.enqueue(plan())
    await writeFile(journal(), '{damaged')
    const queue = new KnowledgeProcessingQueue({ listAllObservations: async () => observations, recordAudit: async () => undefined, nowMs: () => now })
    queue.configureDeterministicHandler(async () => {})
    queue.configureLlmHandler((batch) => runLlmStage(batch, { selectRefinement: async () => plan(), enqueue: (input) => service.enqueue(input) }))
    try {
      expect(await queue.processNow()).toMatchObject({ processed: 0, failed: 1 })
      expect(await queue.startupRestore()).toMatchObject({ pendingTotal: 1 })
      await writeFile(journal(), JSON.stringify({ version: 1, tasks: [] }))
      expect(await queue.processNow()).toMatchObject({ processed: 1, failed: 0 })
      expect(await service.list()).toHaveLength(1)
    } finally { queue.dispose() }
  })

  it('keeps workspace-targeted recovery within its owner', async () => {
    const service = new RefinementTaskService(deps)
    await service.enqueue(plan())
    expect(await service.runDue('other-project')).toMatchObject({ processed: 0 })
    expect(extract).not.toHaveBeenCalled()
    expect((await service.list())[0]?.status).toBe('pending')
  })

  it('ignores ranking-only changes to related facts when restoring a task', async () => {
    truths = [{ ...candidates[0]!.fact, status: 'active', habitStrength: 0.5 }]
    seed()
    const service = new RefinementTaskService(deps)
    await service.enqueue(plan())
    truths[0]!.habitStrength = 0.9
    truths[0]!.lastSeenAt = new Date(now + 1).toISOString()
    expect(await service.runDue()).toMatchObject({ processed: 1, cancelled: 0 })
  })

  it('exposes running diagnostics without waiting for the active model request', async () => {
    const service = new RefinementTaskService(deps)
    await service.enqueue(plan())
    let release!: () => void
    extract.mockImplementation(() => new Promise<void>((resolve) => { release = resolve }))
    const running = service.runDue()
    await vi.waitFor(() => expect(extract).toHaveBeenCalledOnce())
    expect(await service.stats()).toMatchObject({ running: 1, pending: 0 })
    release()
    await running
    expect(await service.stats()).toMatchObject({ running: 0, succeeded: 1 })
  })

  it('cancels a running personal refinement durably without waiting for its model response', async () => {
    const observation = observations[0]!
    observation.scope = 'user'
    observation.sourceEvidence = { ...sourceEvidence(observation), scope: 'user', speaker: 'user', authority: 'user-stated' }
    const candidate = candidates[0]!
    candidate.fact.scope = 'user'
    candidate.decision!.candidateHash = candidateDecisionHash(candidate)
    candidate.decision!.evidenceHashes = { [observation.id]: refinementEvidenceHash(observation, observation.content) }
    candidate.decision!.contextHash = refinementContextHash([], 'user', 'project', now)
    const service = new RefinementTaskService(deps)
    await service.enqueue(plan())
    let release!: () => void
    extract.mockImplementation(() => new Promise<void>(resolve => { release = resolve }))
    const running = service.runDue()
    await vi.waitFor(() => expect(extract).toHaveBeenCalledOnce())
    await writeFileAtomic(forgettingPath(), JSON.stringify({ version: 1, records: [{ target: memoryKey('target'), targetHash: memoryKey('content'),
      createdAt: new Date(now).toISOString(), facts: [], candidates: [memoryKey(candidate.id)], observations: [memoryKey(observation.id)], contents: [] }] }))
    expect(await service.stats()).toMatchObject({ cancelled: 1, running: 0 })
    release()
    expect(await running).toMatchObject({ cancelled: 1, processed: 0 })
    expect(JSON.parse(await readFile(journal(), 'utf8')).tasks[0].status).toBe('cancelled')
    const restarted = new RefinementTaskService(deps)
    await restarted.runDue()
    expect(extract).toHaveBeenCalledOnce()
  })
})
