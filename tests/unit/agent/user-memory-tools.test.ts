import { readPersonalForgettingBarrier } from '../../../src/main/knowledge/personal-forgetting-barrier'
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceAgentRuntime } from '@janus-agent/agent-core'
import { approveToolRequests } from './tool-approval.fixture'
import { registerUserMemoryTools } from '../../../src/main/agent/runtime/tools/user-memory-tools'
import { userEpisodeService } from '../../../src/main/knowledge/user-episode-service'
import { searchUserMemoryDefault } from '../../../src/main/knowledge/user-recall-service'
import type { MemoryFact } from '../../../src/shared/knowledge'
import { KnowledgeProcessingQueue } from '../../../src/main/knowledge/processing-queue'
import { knowledgeObservationService } from '../../../src/main/knowledge/observation-service'
import { reviewedFactHash } from '../../../src/main/knowledge/profile-projection'
import { runDeterministicStage } from '../../../src/main/knowledge/deterministic-extractor'

vi.mock('electron', () => ({ app: { getPath: () => '/unused' } }))

const temporaryDirectories: string[] = []
const previousKnowledgeRoot = process.env.JANUSX_KNOWLEDGE_ROOT
let knowledgeRoot = ''

function factProvenance(workspaceId: string) {
  return {
    workspaceId,
    workspaceName: workspaceId,
    workspacePath: workspaceId === 'user' ? '' : `C:/${workspaceId}`,
    source: 'manual' as const,
    sourceObservationIds: [`obs-${workspaceId}`],
    fileRefs: [],
    actor: 'tester',
    createdAt: '2026-09-10T00:00:00.000Z',
  }
}

function userFact(id: string, content: string): MemoryFact {
  return {
    id,
    content,
    concepts: [],
    files: [],
    tags: ['habit'],
    confidence: 0.8,
    version: 1,
    status: 'active',
    kind: 'preference',
    scope: 'user',
    habitStrength: 0.7,
    lastSeenAt: '2026-09-14T00:00:00.000Z',
    provenance: factProvenance('user'),
  }
}

function projectFact(id: string, content: string): MemoryFact {
  return {
    id,
    content,
    concepts: ['build'],
    files: [],
    tags: [],
    confidence: 0.9,
    version: 1,
    status: 'active',
    kind: 'fact',
    provenance: factProvenance('ws-a'),
  }
}

async function seedFacts(facts: MemoryFact[]): Promise<void> {
  const file = join(knowledgeRoot, 'facts', 'facts.jsonl')
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, facts.map((fact) => JSON.stringify(fact)).join('\n') + '\n', 'utf8')
}

async function readJsonlLines(relativePath: string): Promise<unknown[]> {
  try {
    const content = await readFile(join(knowledgeRoot, relativePath), 'utf8')
    return content.split('\n').filter((line) => line.trim()).map((line) => JSON.parse(line) as unknown)
  } catch {
    return []
  }
}

async function createRuntime(autoApprove: boolean) {
  const root = await mkdtemp(join(tmpdir(), 'janusx-user-tools-'))
  temporaryDirectories.push(root)
  const runtime = new WorkspaceAgentRuntime(async () => root)
  registerUserMemoryTools(runtime.registry)
  if (autoApprove) approveToolRequests(runtime)
  const session = await runtime.createSession({ workspaceId: 'workspace-1', workspaceRoot: root })
  return { runtime, session }
}

function preview(summary: string) {
  return { summary, paths: [] as string[], truncated: false }
}

describe('user memory agent tools (M3)', () => {
  beforeEach(async () => {
    knowledgeRoot = await mkdtemp(join(tmpdir(), 'janusx-user-tools-kb-'))
    temporaryDirectories.push(knowledgeRoot)
    process.env.JANUSX_KNOWLEDGE_ROOT = knowledgeRoot
  })

  afterEach(async () => {
    if (previousKnowledgeRoot === undefined) delete process.env.JANUSX_KNOWLEDGE_ROOT
    else process.env.JANUSX_KNOWLEDGE_ROOT = previousKnowledgeRoot
    await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
  })

  it('registers exactly three person-scoped tools behind read/write/delete risks', async () => {
    const { runtime } = await createRuntime(false)
    const tools = runtime.registry.list().filter((tool) => tool.name.startsWith('user-memory.'))
    expect(tools.map((tool) => `${tool.name}:${tool.actionRisk}`).sort()).toEqual([
      'user-memory.forget:delete',
      'user-memory.save:write',
      'user-memory.search:read',
    ])
  })

  it('searches with cited matches and no approval roundtrip', async () => {
    const reviewed = userFact('fact-u1', '我习惯用 pnpm 而不用 npm')
    reviewed.confirmation = { kind: 'human-review', contentHash: reviewedFactHash(reviewed), confirmedAt: '2026-09-28T00:00:00.000Z' }
    await seedFacts([reviewed])
    const { runtime, session } = await createRuntime(false)
    const result = await runtime.executeTool({
      sessionId: session.id,
      call: { toolName: 'user-memory.search', input: { query: 'pnpm' } },
    })
    expect(result.status).toBe('completed')
    const output = result.output as { matches: Array<{ id: string; citations: { factIds: string[]; observationIds: string[] } }> }
    expect(output.matches.map((match) => match.id)).toEqual(['fact-u1'])
    expect(output.matches[0]!.citations.factIds).toEqual(['fact-u1'])
    expect(output.matches[0]!.citations.observationIds).toEqual(['obs-user'])
  })

  it('saves candidate-only with redaction and audit, never touching truth', async () => {
    await seedFacts([projectFact('fact-p1', '项目构建使用 pnpm workspace')])
    const { runtime, session } = await createRuntime(true)
    const result = await runtime.executeTool({
      sessionId: session.id,
      call: {
        toolName: 'user-memory.save',
        input: { content: '部署密钥 sk-abcdefghijklmnopqrstuvwx 存放在保险库', tags: ['deploy'] },
        preview: preview('Propose user memory'),
      },
    })
    expect(result.status).toBe('completed')
    const output = result.output as { observationId: string; status: string; redacted: boolean }
    expect(output.status).toBe('queued')
    expect(output.redacted).toBe(true)
    expect((await readJsonlLines(join('facts', 'candidates.jsonl')))).toHaveLength(0)
    const observations = await knowledgeObservationService.listAll()
    expect(observations[0]).toMatchObject({ id: output.observationId, memoryIntent: 'remember', scope: 'user' })
    const queue = new KnowledgeProcessingQueue()
    queue.configureDeterministicHandler(async (batch) => { await runDeterministicStage(batch) })
    try {
      expect((await queue.processNow()).failed).toBe(0)
    } finally {
      queue.dispose()
    }

    const truth = await readJsonlLines(join('facts', 'facts.jsonl'))
    expect(truth).toHaveLength(1)
    const candidates = await readJsonlLines(join('facts', 'candidates.jsonl')) as Array<{ id: string; status: string; fact: MemoryFact }>
    expect(candidates).toHaveLength(1)
    expect(candidates[0]!.status).toBe('proposed')
    expect(candidates[0]!.fact.scope).toBe('user')
    expect(candidates[0]!.fact.provenance.source).toBe('tool')
    expect(candidates[0]!.fact.provenance.sourceEvidence?.[0]).toMatchObject({ observationId: output.observationId, authority: 'model-generated' })
    expect(candidates[0]!.fact.content).toContain('[REDACTED]')
    expect(candidates[0]!.fact.content).not.toContain('sk-abcdefghijklmnopqrstuvwx')
    const audits = await readJsonlLines(join('audit', 'audit.jsonl')) as Array<{ action: string; targetId: string }>
    expect(audits.some((event) => event.action === 'capture' && event.targetId === output.observationId)).toBe(true)
    expect(audits.some((event) => event.action === 'candidate_proposed')).toBe(true)
  })

  it('forgets user memory with audit while project knowledge survives', async () => {
    await seedFacts([
      userFact('fact-u1', '我习惯用 pnpm 而不用 npm'),
      projectFact('fact-p1', '项目构建使用 pnpm workspace'),
    ])
    await userEpisodeService.capture({ content: '昨天用 pnpm 发布了新版本', ttlDays: 90 })
    const { runtime, session } = await createRuntime(true)
    const result = await runtime.executeTool({
      sessionId: session.id,
      call: { toolName: 'user-memory.forget', input: { query: 'pnpm', confirm: true }, preview: preview('Forget pnpm memory') },
    })
    expect(result.status).toBe('completed')
    const output = result.output as { archivedFactIds: string[]; expiredEpisodeIds: string[]; silent: boolean }
    expect(output.archivedFactIds).toEqual(['fact-u1'])
    expect(output.expiredEpisodeIds).toHaveLength(1)
    expect(output.silent).toBe(true)

    const truth = await readJsonlLines(join('facts', 'facts.jsonl')) as MemoryFact[]
    expect(truth.find((fact) => fact.id === 'fact-u1')!.status).toBe('active')
    expect((await readPersonalForgettingBarrier()).blocksFact(truth.find(fact => fact.id === 'fact-u1')!)).toBe(true)
    expect(truth.find((fact) => fact.id === 'fact-p1')!.status).toBe('active')
    const silent = await searchUserMemoryDefault('pnpm')
    expect(silent.items).toEqual([])
    expect((await readPersonalForgettingBarrier()).records).toHaveLength(1)
  })

  it('refuses forget without confirm, with broad queries, and with no match', async () => {
    await seedFacts([userFact('fact-u1', '我习惯用 pnpm 而不用 npm')])
    const { runtime, session } = await createRuntime(true)
    const withoutConfirm = await runtime.executeTool({
      sessionId: session.id,
      call: { toolName: 'user-memory.forget', input: { query: 'pnpm', confirm: false }, preview: preview('Forget') },
    })
    expect(withoutConfirm.status).toBe('failed')

    const broad = await runtime.executeTool({
      sessionId: session.id,
      call: { toolName: 'user-memory.forget', input: { query: '是', confirm: true }, preview: preview('Forget') },
    })
    expect(broad.status).toBe('failed')

    const noMatch = await runtime.executeTool({
      sessionId: session.id,
      call: { toolName: 'user-memory.forget', input: { query: '不存在的记忆内容 zebra', confirm: true }, preview: preview('Forget') },
    })
    expect(noMatch.status).toBe('failed')
    const truth = await readJsonlLines(join('facts', 'facts.jsonl')) as MemoryFact[]
    expect(truth.find((fact) => fact.id === 'fact-u1')!.status).toBe('active')
  })
})
