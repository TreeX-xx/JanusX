import { SUPPORTED_HARNESS_PROFILE } from '@janus-agent/harness-node';
import { promises as fs } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  cancelTaskRun,
  closeTaskThread,
  finishTaskRun,
  getTaskRun,
  getTaskRunState,
  listTaskRunStates,
  listTaskThreads,
  handoffTaskRun,
  listTaskRuns,
  openTaskThread,
  prepareTaskRun,
  readTaskHandoff,
  recordTaskReceipt,
  startTaskRun,
  verifyTaskRun,
  type PrepareTaskRunInput,
} from '../../src/main/harness/execution-adapter'
import { codeManifestHash, type Receipt } from '@janus-agent/harness-core'
import { collectLiveSnapshot } from '@janus-agent/harness-node'
import { BlueprintNoteService as HarnessNoteService } from '../../plugins/blueprint/src/main/notes/service'

const REPO = '8fa19f17-c717-43a8-93a7-810a5e0cbc91'
const TASK_ID = '11111111-1111-4111-8111-111111111111'
const DRAFT_ID = '22222222-2222-4222-8222-222222222222'

function taskNote(id: string, lifecycle: string): string {
  const uri = `note://${REPO}/${id}`
  return [
    '---',
    'schema: harness-note/1',
    `id: ${id}`,
    'kind: task',
    `lifecycle: ${lifecycle}`,
    'created: 2026-09-18',
    'work:',
    '  scope:',
    `    - repoId: ${REPO}`,
    "      paths: ['./']",
    '  acceptanceRefs:',
    `    - uri: ${uri}`,
    '      criterionId: AC-1',
    '  verification:',
    '    - id: V-1',
    '      kind: manual',
    '      required: true',
    `      repoId: ${REPO}`,
    '      cwd: .',
    '      description: Review the run record.',
    '---',
    '',
    '# Adapter probe task',
    '',
    '## Scope',
    '',
    'Probe the shared dispatch kernel from JanusX.',
    '',
    '## Acceptance criteria',
    '',
    '- [ ] AC-1: Prepare opens a queued run.',
    '',
    '## Verification',
    '',
    'Manual review of the run record.',
    '',
  ].join('\n')
}

async function makeRoot(withIdentity = true): Promise<string> {
  const root = await fs.mkdtemp(join(tmpdir(), 'harness-exec-'))
  roots.push(root)
  await fs.mkdir(join(root, '.agents', 'notes'), { recursive: true })
  if (withIdentity) {
    await fs.writeFile(
      join(root, '.agents', 'harness.json'),
      JSON.stringify({ schemaVersion: 1, repoId: REPO, name: 'Exec', profile: SUPPORTED_HARNESS_PROFILE }),
    )
  }
  await fs.writeFile(join(root, '.agents', 'notes', `2026-09-18-probe--${TASK_ID.slice(0, 8)}.md`), taskNote(TASK_ID, 'accepted'))
  await fs.writeFile(join(root, '.agents', 'notes', `2026-09-18-draft--${DRAFT_ID.slice(0, 8)}.md`), taskNote(DRAFT_ID, 'draft'))
  return root
}

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true })
})

const TASK_URI = `note://${REPO}/${TASK_ID}`
const BASE: PrepareTaskRunInput = { taskRef: TASK_URI, mode: 'xdo', closeout: 'commit-required' }

async function startedRun(): Promise<{ root: string; runId: string; token: string }> {
  const root = await makeRoot()
  const prepared = await prepareTaskRun(root, BASE)
  expect(prepared.ok).toBe(true)
  const runId = prepared.data.runId
  const started = await startTaskRun(root, runId, 'janusx-test', { by: 'tester' })
  expect(started.ok).toBe(true)
  const loaded = await getTaskRun(root, runId)
  const token = loaded.run?.lease?.token
  expect(token).toBeTruthy()
  return { root, runId, token: token as string }
}

describe('harness execution adapter (S8-JanusX)', () => {
  it('prepares a queued run pinned to the collected baseline', async () => {
    const root = await makeRoot()
    const prepared = await prepareTaskRun(root, BASE)
    expect(prepared.ok).toBe(true)
    expect(prepared.data.runId).toBeTruthy()
    expect(prepared.run?.state).toBe('queued')
    expect(prepared.run?.baseline.taskContractHash).toMatch(/^[0-9a-f]{64}$/)
    const listed = await listTaskRuns(root)
    expect(listed.errors).toEqual([])
    expect(listed.runs.map((run) => run.runId)).toContain(prepared.data.runId)
  })

  it('refuses unaccepted, unknown, identity-less, and unauthorized tasks (F09)', async () => {
    const root = await makeRoot()
    const draft = await prepareTaskRun(root, { ...BASE, taskRef: `note://${REPO}/${DRAFT_ID}` })
    expect(draft.ok).toBe(false)
    expect(draft.errors.some((error) => error.code === 'NOT_READY')).toBe(true)

    const unknown = await prepareTaskRun(root, { ...BASE, taskRef: `note://${REPO}/99999999-9999-4999-8999-999999999999` })
    expect(unknown.ok).toBe(false)
    expect(unknown.errors.some((error) => error.code === 'NOT_FOUND')).toBe(true)

    const bare = await makeRoot(false)
    const noIdentity = await prepareTaskRun(bare, BASE)
    expect(noIdentity.ok).toBe(false)
    expect(noIdentity.errors.some((error) => error.code === 'NOT_READY')).toBe(true)

    const noAuth = await prepareTaskRun(root, { ...BASE, closeout: 'working-tree-authorized' })
    expect(noAuth.ok).toBe(false)
    expect(noAuth.errors.some((error) => error.code === 'APPROVAL_REQUIRED')).toBe(true)
  })

  it('blocks the start when the contract moved after prepare', async () => {
    const root = await makeRoot()
    const prepared = await prepareTaskRun(root, BASE)
    expect(prepared.ok).toBe(true)

    // External terminal edit moves the contract: the queued run must not
    // execute against the stale pin.
    const rel = (await fs.readdir(join(root, '.agents', 'notes'))).find((name) => name.includes(TASK_ID.slice(0, 8))) as string
    const file = join(root, '.agents', 'notes', rel)
    await fs.writeFile(file, (await fs.readFile(file, 'utf8')).replace('Probe the shared', 'Probe the moved'))
    const blocked = await startTaskRun(root, prepared.data.runId, 'janusx-test', { by: 'tester' })
    expect(blocked.ok).toBe(false)
    expect(blocked.errors.some((error) => error.code === 'STALE_BASELINE')).toBe(true)
    expect((await getTaskRun(root, prepared.data.runId)).run?.state).toBe('queued')
  })

  it('assembles a live snapshot matching the pinned baseline', async () => {
    const root = await makeRoot()
    const prepared = await prepareTaskRun(root, BASE)
    expect(prepared.ok).toBe(true)
    const snapshot = await collectLiveSnapshot(root, TASK_URI, 'tester', [])
    expect(snapshot.ok).toBe(true)
    if (!snapshot.ok) return
    expect(snapshot.live.taskContractHash).toBe(prepared.run?.baseline.taskContractHash)
    const criteria = snapshot.live.criterionHashes.find(([uri]) => uri === TASK_URI)
    expect(criteria?.[1].map(([id]) => id)).toContain('AC-1')
  })

  it('wires verify, receipt shape checks, unknown receipts, cancel, and handoff', async () => {
    const { root, runId, token } = await startedRun()
    const verified = await verifyTaskRun(root, runId, token, [])
    expect(verified.ok).toBe(true)

    const malformed = await recordTaskReceipt(root, runId, token, { id: 'r1' } as unknown as Receipt)
    expect(malformed.ok).toBe(false)
    expect(malformed.errors.length).toBeGreaterThan(0)

    const snapshot = await collectLiveSnapshot(root, TASK_URI, 'tester', [])
    expect(snapshot.ok).toBe(true)
    if (!snapshot.ok) return
    const missing = await finishTaskRun(root, runId, token, 'no-such-receipt', snapshot.live)
    expect(missing.ok).toBe(false)

    const handoff = await handoffTaskRun(root, runId)
    expect(handoff.ok).toBe(true)
    await expect(fs.access(handoff.data.path)).resolves.toBeUndefined()

    const cancelled = await cancelTaskRun(root, runId, token)
    expect(cancelled.ok).toBe(true)
    expect((await getTaskRun(root, runId)).run?.state).toBe('cancelled')
  })

  it('reads written handoffs and refuses missing ones without inventing content', async () => {
    const { root, runId } = await startedRun()
    const unread = await readTaskHandoff(root, runId)
    expect(unread.ok).toBe(false)
    expect(unread.errors.some((error) => error.code === 'NOT_FOUND')).toBe(true)

    const written = await handoffTaskRun(root, runId)
    expect(written.ok).toBe(true)
    const read = await readTaskHandoff(root, runId)
    expect(read.ok).toBe(true)
    expect(read.data.path).toBe(written.data.path)
    expect(read.data.markdown).toContain(TASK_URI)
    expect(read.data.markdown).toContain('Fixed baseline')

    const gone = await readTaskHandoff(root, '01234567-89ab-4def-8123-456789abcdef')
    expect(gone.ok).toBe(false)
    expect(gone.errors.length).toBeGreaterThan(0)
  })
  it('reports missing runs without throwing', async () => {
    const root = await makeRoot()
    const missing = await getTaskRun(root, '01234567-89ab-4def-8123-456789abcdef')
    expect(missing.run).toBeNull()
    expect(missing.errors.length).toBeGreaterThan(0)
    const empty = await listTaskRuns(root)
    expect(empty).toMatchObject({ runs: [], errors: [] })
  })

  it('lists threadless runs, opens threads on activation, and closes only idle ones', async () => {
    const { root, runId } = await startedRun()
    const otherId = '44444444-4444-4333-8333-444444444444'
    await fs.writeFile(join(root, '.agents', 'notes', `2026-09-18-second--${otherId.slice(0, 8)}.md`), taskNote(otherId, 'accepted').replaceAll(TASK_ID, otherId))
    const second = await prepareTaskRun(root, { ...BASE, taskRef: `note://${REPO}/${otherId}` })
    expect(second.ok).toBe(true)
    const runId2 = second.data.runId

    const listed = await listTaskThreads(root)
    expect(listed.errors).toEqual([])
    expect(listed.threads).toHaveLength(2)
    expect(listed.threads.find((item) => item.runId === runId)).toMatchObject({ hasThread: false, attempts: 0 })

    const opened = await openTaskThread(root, runId2)
    expect(opened.ok).toBe(true)
    expect(opened.data).toMatchObject({ runId: runId2, hasThread: true, history: [] })
    expect((await listTaskThreads(root)).threads.find((item) => item.runId === runId2)).toMatchObject({ hasThread: true })

    const busy = await closeTaskThread(root, runId)
    expect(busy.ok).toBe(false)
    expect(busy.errors.some((error) => error.code === 'BUSY')).toBe(true)

    const { beginTaskTranscript, readTaskTranscript } = await import('../../src/main/harness/task-transcript')
    const transcript = await beginTaskTranscript(root, runId2, { taskUri: `note://${REPO}/${otherId}`, attempt: 1, baselineHash: 'test', providerId: 'test', modelId: 'test' })
    expect((await closeTaskThread(root, runId2)).errors[0].code).toBe('BUSY')
    await transcript.finish('completed', { text: 'An observation', toolTraces: [] })
    const closed = await closeTaskThread(root, runId2)
    expect(closed).toMatchObject({ ok: true, data: { closed: true } })
    expect((await listTaskThreads(root)).threads.find((item) => item.runId === runId2)).toMatchObject({ hasThread: false })
    expect((await readTaskTranscript(root, runId2)).turns).toEqual([])
    expect((await getTaskRun(root, runId2)).run).not.toBeNull()
    const gone = await closeTaskThread(root, runId2)
    expect(gone.ok).toBe(false)
    expect(gone.errors.some((error) => error.code === 'NOT_FOUND')).toBe(true)
  })

  it('finishes only when one receipt covers the task checks and acceptance refs', async () => {
    const { root, runId, token } = await startedRun()
    await verifyTaskRun(root, runId, token, [])
    const snapshot = await collectLiveSnapshot(root, TASK_URI, 'tester', [])
    expect(snapshot.ok).toBe(true)
    if (!snapshot.ok) return
    expect(snapshot.live.acceptanceRefs).toEqual([{ uri: TASK_URI, criterionId: 'AC-1' }])
    expect(snapshot.live.verification[0].id).toBe('V-1')
    const receipt: Receipt = {
      schema: 'harness-receipt/1', id: 'incomplete', taskUri: TASK_URI,
      mode: 'xdo', attempt: 1, taskContractHash: snapshot.live.taskContractHash,
      inputs: [], codeManifest: [],
      checks: [{ id: 'V-1', kind: 'manual', required: true, status: 'passed', repoId: REPO, summary: 'Observed the prepared run.', performedBy: 'tester' }],
      coverage: [], review: { kind: 'self', verdict: 'approved', reviewedManifestHash: codeManifestHash([]), actor: 'tester' },
      createdAt: new Date().toISOString(), actor: 'tester',
    }
    expect((await recordTaskReceipt(root, runId, token, receipt)).ok).toBe(true)
    const refused = await finishTaskRun(root, runId, token, receipt.id, snapshot.live)
    expect(refused.ok).toBe(false)
    expect(refused.errors.some((error) => error.path === 'coverage')).toBe(true)
    expect((await getTaskRun(root, runId)).run?.state).toBe('verifying')
    const criterion = snapshot.live.criterionHashes.find(([uri]) => uri === TASK_URI)?.[1][0][1] as string
    const complete: Receipt = { ...receipt, id: 'complete', coverage: [{ uri: TASK_URI, criterionId: 'AC-1', criterionHash: criterion, checkIds: ['V-1'] }] }
    expect((await recordTaskReceipt(root, runId, token, complete)).ok).toBe(true)
    expect((await finishTaskRun(root, runId, token, complete.id, snapshot.live)).ok).toBe(true)
    expect((await getTaskRun(root, runId)).run?.state).toBe('done')
    const local = await getTaskRunState(root, runId)
    expect(local).toMatchObject({ local: true, state: 'done', validity: 'valid' })
    await fs.rm(join(root, '.agents', '.local'), { recursive: true, force: true })
    const portable = await listTaskRunStates(root)
    expect(portable).toMatchObject([{ runId: TASK_URI, local: false, state: 'done', validity: 'valid' }])
    const service = new HarnessNoteService()
    expect((await service.projectView(root)).blueprint.nodes[TASK_ID].status).toBe('done')
    const share = await service.shareSnapshot(root)
    expect(share.evidence.map((item) => item.id)).toEqual(['incomplete', 'complete'])
    expect(JSON.stringify(share)).not.toContain(runId)
    expect(JSON.stringify(share)).not.toContain('.local')
    const file = join(root, '.agents', 'notes', '2026-09-18-probe--11111111.md')
    await fs.writeFile(file, (await fs.readFile(file, 'utf8')).replace('AC-1: Prepare opens a queued run.', 'AC-1: Changed acceptance.'))
    expect((await getTaskRunState(root, TASK_URI)).validity).toBe('stale')
    await service.rescan(root)
    expect((await service.projectView(root)).blueprint.nodes[TASK_ID].status).not.toBe('done')
  })
})
