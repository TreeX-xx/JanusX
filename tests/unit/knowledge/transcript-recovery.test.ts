import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, mkdir, writeFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TranscriptRecovery, type TranscriptJob } from '../../../src/main/knowledge/transcript-recovery'
import type { Observation } from '../../../src/shared/knowledge'
import { sourceKey } from '../../../src/main/knowledge/observation-revocation-barrier'
vi.mock('electron', () => ({ app: { getPath: () => '/unused' } }))
let root: string
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'transcript-recovery-')); vi.stubEnv('JANUSX_KNOWLEDGE_ROOT', root) })
afterEach(async () => { vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }) })
describe('durable transcript rereads', () => {
  it('does not enqueue, read or persist when disabled before admission', async () => {
    const read = vi.fn(), submit = vi.fn()
    const recovery = new TranscriptRecovery({ read, submit, now: Date.now })
    expect(await recovery.submit({ path: 'private', engine: 'codex', end: {
      input: { workspaceId: 'project', workspacePath: root, source: 'agent-stream', type: 'system-event', content: 'private' },
      context: { speaker: 'unknown', sourceEventId: 'disabled' },
    } }, async () => false)).toEqual([])
    expect(await recovery.drain(async () => false)).toEqual([])
    expect(read).not.toHaveBeenCalled(); expect(submit).not.toHaveBeenCalled()
    expect(await readdir(root)).toEqual([])
  })
  it('persists before reading and resumes a not-yet-written answer after restart', async () => {
    let now = Date.now()
    const job: TranscriptJob = { path: join(root, 'conversation.jsonl'), engine: 'claude', prompt: 'Fix cache', end: {
      input: { workspaceId: 'project', workspacePath: root, source: 'agent-stream', type: 'system-event', content: 'completed',
        sessionId: 'session', correlationId: 'turn', agentId: 'claude', tags: ['turn-completed'] },
      context: { speaker: 'unknown', sourceEventId: 'completed-1', createdAt: new Date(now).toISOString() },
    } }
    const read = vi.fn().mockImplementation(async () => {
      expect(JSON.parse(await readFile(join(root, 'processing/transcript-recovery.json'), 'utf8'))).toHaveLength(1)
      return { messages: [], reason: 'transcript-answer-not-ready' }
    })
    const submit = vi.fn().mockImplementation(async entries => entries.map(entry => ({ ...entry.input, id: entry.context.sourceEventId }) as Observation))
    const deps = { read, submit, now: () => now }
    await new TranscriptRecovery(deps).submit(job)
    expect(await new TranscriptRecovery(deps).status('project')).toEqual({ pending: 1, lastError: 'transcript-answer-not-ready' })
    expect(submit.mock.calls[0][0][0].input.metadata.evidenceStatus).toBe('transcript-answer-not-ready')
    read.mockResolvedValue({ messages: [{ id: 'answer-1', speaker: 'assistant', content: 'Cache fix verified.' }] })
    now += 3000
    const recovered = await new TranscriptRecovery(deps).drain()
    expect(recovered).toHaveLength(2)
    expect(recovered[1].metadata?.evidenceStatus).toBe('complete')
    expect(read).toHaveBeenLastCalledWith(job.path, 'claude', 'session', 'Fix cache', job.end.context.createdAt, job.end.input.workspacePath)
    expect(await new TranscriptRecovery(deps).status('project')).toEqual({ pending: 0, lastError: undefined })
    expect(submit.mock.calls[1][0][1].context.sourceEventId).toBe('completed-1:transcript-complete')
  })
  it('retains failed delivery with backoff and does not retry before its deadline', async () => {
    const now = Date.now(), read = vi.fn().mockResolvedValue({ messages: [], reason: 'transcript-unavailable' })
    const submit = vi.fn().mockRejectedValue(new Error('disk-unavailable'))
    const recovery = new TranscriptRecovery({ read, submit, now: () => now })
    await expect(recovery.submit({ path: 'missing', engine: 'codex', end: { input: { workspaceId: 'project', workspacePath: root, source: 'agent-stream', type: 'system-event', content: 'completed' }, context: { speaker: 'unknown', sourceEventId: 'end', createdAt: new Date(now).toISOString() } } })).rejects.toThrow('disk-unavailable')
    await recovery.drain()
    expect(read).toHaveBeenCalledTimes(1)
    expect(await recovery.status('project')).toEqual({ pending: 1, lastError: 'disk-unavailable' })
  })
  it('does not reread or restore a turn after its parent observation is withdrawn', async () => {
    let now = Date.now()
    const read = vi.fn().mockResolvedValue({ messages: [], reason: 'transcript-answer-not-ready' })
    const submit = vi.fn().mockResolvedValue([{ id: 'pending-observation' }])
    const recovery = new TranscriptRecovery({ read, submit, now: () => now })
    await recovery.submit({ path: 'transcript.jsonl', engine: 'codex', end: {
      input: { workspaceId: 'project', workspacePath: root, source: 'agent-stream', type: 'system-event', content: 'completed' },
      context: { speaker: 'unknown', sourceEventId: 'end', createdAt: new Date(now).toISOString(), relatedObservationIds: ['original-request'] },
    } })
    await mkdir(join(root, 'observations'), { recursive: true })
    await writeFile(join(root, 'observations/revoked.json'), JSON.stringify({ version: 1, records: [{ source: sourceKey('project', 'original-request'), sourceHash: 'a'.repeat(64), revokedAt: new Date(now).toISOString(), facts: [], observations: [] }] }))
    now += 3000
    expect(await recovery.drain()).toEqual([])
    expect(read).toHaveBeenCalledTimes(1)
    expect(submit).toHaveBeenCalledTimes(1)
    expect((await recovery.status()).pending).toBe(0)
  })
  it('retains the pending task without capturing when knowledge is disabled during the read', async () => {
    let enabled = true
    const read = vi.fn().mockImplementation(async () => { enabled = false; return { messages: [{ id: 'answer', speaker: 'assistant', content: 'Completed.' }] } })
    const submit = vi.fn()
    const recovery = new TranscriptRecovery({ read, submit, now: Date.now })
    expect(await recovery.submit({ path: 'transcript.jsonl', engine: 'codex', end: {
      input: { workspaceId: 'project', workspacePath: root, source: 'agent-stream', type: 'system-event', content: 'completed' },
      context: { speaker: 'unknown', sourceEventId: 'end', createdAt: new Date().toISOString() },
    } }, async () => enabled)).toEqual([])
    expect(submit).not.toHaveBeenCalled()
    expect((await recovery.status()).pending).toBe(1)
  })
})
