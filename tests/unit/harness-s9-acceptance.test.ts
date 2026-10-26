import { SUPPORTED_HARNESS_PROFILE } from '@janus-agent/harness-node';
import { promises as fs } from 'fs'
import { tmpdir } from 'os'
import { join, sep } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BlueprintNoteService as HarnessNoteService, assertNoLocalLeak } from '../../plugins/blueprint/src/main/notes/service'
import { resolveProjectCheckout } from '../../plugins/blueprint/src/main/notes/maintenance-apply'
import {
  cancelTaskRun,
  closeoutTaskRun,
  getTaskRun,
  prepareTaskRun,
  startTaskRun,
  verifyTaskRun,
} from '../../src/main/harness/execution-adapter'

const REPO = '8fa19f17-c717-43a8-93a7-810a5e0cbc91'
const REQ_ID = '33333333-3333-4333-8333-333333333333'
const TASK_ID = '44444444-4444-4433-8433-444444444444'

const REQUIREMENT = [
  '---',
  'schema: harness-note/1',
  `id: ${REQ_ID}`,
  'kind: requirement',
  'lifecycle: proposed',
  'created: 2026-09-18',
  '---',
  '',
  '# Race target',
  '',
  '## Problem',
  '',
  'P.',
  '',
  '## Expected behavior',
  '',
  'E.',
  '',
  '## Scope',
  '',
  'S.',
  '',
  '## Acceptance criteria',
  '',
  '- [ ] AC-1: One.',
  '',
].join('\n')

function taskNote(): string {
  const uri = `note://${REPO}/${TASK_ID}`
  return [
    '---',
    'schema: harness-note/1',
    `id: ${TASK_ID}`,
    'kind: task',
    'lifecycle: accepted',
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
    '# S9 probe task',
    '',
    '## Scope',
    '',
    'Probe S9 acceptance from JanusX.',
    '',
    '## Acceptance criteria',
    '',
    '- [ ] AC-1: Runs refuse duplicates and land closeout gates.',
    '',
    '## Verification',
    '',
    'Manual review of the run record.',
    '',
  ].join('\n')
}

const roots: string[] = []

async function makeRoot(withTask: boolean): Promise<string> {
  const root = await fs.mkdtemp(join(tmpdir(), 'harness-s9-'))
  roots.push(root)
  await fs.mkdir(join(root, '.agents', 'notes'), { recursive: true })
  await fs.writeFile(
    join(root, '.agents', 'harness.json'),
    JSON.stringify({ schemaVersion: 1, repoId: REPO, name: 'S9', profile: SUPPORTED_HARNESS_PROFILE }),
  )
  await fs.writeFile(join(root, '.agents', 'notes', `2026-09-18-race--${REQ_ID.slice(0, 8)}.md`), REQUIREMENT)
  if (withTask) {
    await fs.writeFile(join(root, '.agents', 'notes', `2026-09-18-probe--${TASK_ID.slice(0, 8)}.md`), taskNote())
  }
  return root
}

afterEach(async () => {
  for (const root of roots.splice(0)) {
    new HarnessNoteService().unwatchAll()
    await fs.rm(root, { recursive: true, force: true })
  }
  vi.unstubAllGlobals()
})

function replaceChangeSet(id: string, uri: string, expectedHash: string, title: string, base: string) {
  return {
    id,
    revision: 1,
    source: { type: 'harness' as const, id: 's9-test', revision: 1 },
    operations: [
      {
        operationId: `op-${id}`,
        type: 'replace' as const,
        uri,
        expectedHash,
        afterMarkdown: base.replace(/^# .*$/m, `# ${title}`),
      },
    ],
  }
}

describe('S9 acceptance, JanusX slice', () => {
  it('F03: concurrent same-hash replaces land exactly once with no lost bytes', async () => {
    const root = await makeRoot(false)
    const svc = new HarnessNoteService()
    const uri = `note://${REPO}/${REQ_ID}`
    const { sha256 } = await svc.readNote(root, REQ_ID)
    const attempt = (id: string, title: string) =>
      svc.applyBundleChangeSet(root, replaceChangeSet(id, uri, sha256, title, REQUIREMENT), 's9 race')
    const [first, second] = await Promise.allSettled([attempt('tx-a', 'Winner A'), attempt('tx-b', 'Winner B')])
    const fulfilled = [first, second].filter((r) => r.status === 'fulfilled')
    const rejected = [first, second].filter((r) => r.status === 'rejected')
    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    const reason = (rejected[0] as PromiseRejectedResult).reason as { code?: string }
    expect(['BUSY', 'CONFLICT', 'HARNESS_CONFLICT']).toContain(reason.code)
    // Loser retries against the fresh hash: nothing was lost or half-written.
    const fresh = await svc.readNote(root, REQ_ID)
    const retry = await svc.applyBundleChangeSet(
      root,
      replaceChangeSet('tx-retry', uri, fresh.sha256, 'Loser retry', fresh.raw),
      's9 race retry',
    )
    expect(retry.applied).toHaveLength(1)
    const final = await svc.readNote(root, REQ_ID)
    expect(final.raw).toContain('# Loser retry')
  })

  it('F09: double start never duplicates execution; verify parks the run', async () => {
    const root = await makeRoot(true)
    const taskUri = `note://${REPO}/${TASK_ID}`
    const prepared = await prepareTaskRun(root, { taskRef: taskUri, mode: 'xdo', closeout: 'commit-required' })
    expect(prepared.ok).toBe(true)
    const first = await startTaskRun(root, prepared.data.runId, 's9', { by: 's9' })
    expect(first.ok).toBe(true)
    const second = await startTaskRun(root, prepared.data.runId, 's9', { by: 's9' })
    expect(second.ok).toBe(false)
    const loaded = await getTaskRun(root, prepared.data.runId)
    expect(loaded.run?.state).toBe('running')
    expect(loaded.run?.attempt).toBe(1)
    const token = loaded.run?.lease?.token as string
    expect(await verifyTaskRun(root, prepared.data.runId, token, [])).toMatchObject({ ok: true })
    expect((await getTaskRun(root, prepared.data.runId)).run?.state).toBe('verifying')
    expect(await cancelTaskRun(root, prepared.data.runId, token)).toMatchObject({ ok: true })
  })

  it('F07: closeout without a receipt refuses instead of passing vacuous', async () => {
    const root = await makeRoot(true)
    const taskUri = `note://${REPO}/${TASK_ID}`
    const prepared = await prepareTaskRun(root, { taskRef: taskUri, mode: 'xdo', closeout: 'commit-required' })
    expect(prepared.ok).toBe(true)
    const started = await startTaskRun(root, prepared.data.runId, 's9', { by: 's9' })
    expect(started.ok).toBe(true)
    const report = await closeoutTaskRun(root, prepared.data.runId, { repoRoot: root })
    expect(report.ok).toBe(false)
    expect(report.errors.some((error) => error.code === 'NOT_READY')).toBe(true)
  })

  it('F10: rescans rebuild the same projection without a persistent index', async () => {
    const root = await makeRoot(true)
    const svc = new HarnessNoteService()
    const before = await svc.projectView(root)
    const ids = Object.keys(before.blueprint.nodes).sort()
    expect(ids).toHaveLength(2)
    const again = await svc.rescan(root)
    expect(again.rev).toBe(before.rev + 1)
    const after = await svc.projectView(root)
    expect(Object.keys(after.blueprint.nodes).sort()).toEqual(ids)
    // External terminal edits surface on rescan without any watcher event.
    const rel = (await fs.readdir(join(root, '.agents', 'notes'))).find((name) => name.includes(REQ_ID.slice(0, 8))) as string
    const file = join(root, '.agents', 'notes', rel)
    await fs.writeFile(file, (await fs.readFile(file, 'utf8')).replace('# Race target', '# Terminal edit'))
    const refreshed = await svc.projectView(root)
    expect(Object.keys(refreshed.blueprint.nodes).sort()).toEqual(ids)
    const edited = await svc.readNote(root, REQ_ID)
    expect(edited.raw).toContain('# Terminal edit')
  })

  it('F11: degraded renderer APIs reject instead of faking success', async () => {
    vi.stubGlobal('window', {})
    vi.stubGlobal('navigator', { platform: 'Win32' })
    const { installElectronApiFallback } = await import('../../src/renderer/src/lib/electron-api-fallback')
    installElectronApiFallback()
    const api = (globalThis as unknown as { window: { electron: { harness: Record<string, () => Promise<unknown>> } } }).window.electron.harness
    await expect(api.runPrepare()).rejects.toThrow('unavailable')
    await expect(api.runList()).rejects.toThrow('unavailable')
    await expect(api.runStatus()).rejects.toThrow('unavailable')
  })

  it('F12: share exports never leak local state; twin checkouts demand explicit binding', async () => {
    const rootA = await makeRoot(false)
    const svc = new HarnessNoteService()
    await fs.mkdir(join(rootA, '.agents', '.local', 'ui'), { recursive: true })
    await fs.writeFile(join(rootA, '.agents', '.local', 'ui', 'project.json'), JSON.stringify({ canvasLayout: {} }))
    const outPath = join(rootA, '.agents', '.local', 'share-test.json')
    const exported = await svc.exportSnapshot(rootA, {}, outPath)
    expect(exported.notes).toBe(1)
    const text = await fs.readFile(outPath, 'utf8')
    expect(text).not.toContain('.local/')
    expect(text).not.toContain(rootA)
    expect(assertNoLocalLeak(rootA, `see ${rootA} now`)).toMatchObject([{ code: 'PERMISSION_DENIED' }])

    const rootB = await fs.mkdtemp(join(tmpdir(), 'harness-s9-twin-'))
    roots.push(rootB)
    await fs.mkdir(join(rootB, '.agents', 'notes'), { recursive: true })
    await fs.writeFile(join(rootB, '.agents', 'harness.json'), JSON.stringify({ schemaVersion: 1, repoId: REPO, name: 'S9-twin', profile: SUPPORTED_HARNESS_PROFILE }))
    await fs.writeFile(join(rootB, '.agents', 'notes', `2026-09-18-race--${REQ_ID.slice(0, 8)}.md`), REQUIREMENT)
    const blueprintId = (await svc.projectView(rootA)).blueprint.id
    // E0-1: graph ids are checkout-scoped rootKey hashes, so twin checkouts
    // of one repo project to different ids; cross-checkout ambiguity is
    // impossible by id scan. The multiple-checkout guard stays as
    // defense-in-depth for one checkout listed twice under different path
    // spellings, and a wrong explicit binding still refuses to fall through.
    expect((await svc.projectView(rootB)).blueprint.id).not.toBe(blueprintId)
    await expect(
      resolveProjectCheckout(svc, blueprintId, undefined, async () => [rootA, rootA + sep]),
    ).rejects.toThrow(/多个本机 checkout/)
    await expect(resolveProjectCheckout(svc, blueprintId, rootB)).rejects.toThrow(/绑定目录不可用或不匹配/)
  })
})
