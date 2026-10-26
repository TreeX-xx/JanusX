import { SUPPORTED_HARNESS_PROFILE } from '@janus-agent/harness-node';
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildArtifactBundle } from '../../src/main/roundtable/artifact-bundle'
import { adoptTask, readTaskDraft } from '../../src/main/harness/task-adoption'
import { projectChatContext } from '../../src/main/harness/chat-context'
import { BlueprintNoteService as HarnessNoteService } from '../../plugins/blueprint/src/main/notes/service'
import { prepareTaskRun, startTaskRun } from '../../src/main/harness/execution-adapter'
import { verifyTaskExecution } from '@janus-agent/janus-agent'
import { collectTaskBaseline, readTaskResult, runGit } from '@janus-agent/harness-node'
import type { RoundtableFact } from '../../src/shared/roundtable/events'
import type { HarnessTaskContractInput } from '../../src/shared/ipc/harness'

const REPO = '8fa19f17-c717-43a8-93a7-810a5e0cbc91'
const REQ = '44444444-4444-4333-8333-444444444444'
const TARGET = `note://${REPO}/${REQ}`
const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
function git(root: string, ...args: string[]) { const result = runGit(root, args); if (!result.ok) throw new Error(result.error); return result.stdout.trim() }

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'roundtable-task-'))
  roots.push(root)
  await mkdir(join(root, '.agents', 'notes'), { recursive: true })
  await mkdir(join(root, 'src'))
  await writeFile(join(root, '.agents', 'harness.json'), JSON.stringify({ name: 'Test', schemaVersion: 1, repoId: REPO, profile: SUPPORTED_HARNESS_PROFILE }))
  await writeFile(join(root, '.gitignore'), '.agents/.local/\n')
  await writeFile(join(root, 'src', 'value.txt'), '42')
  await writeFile(join(root, '.agents', 'notes', 'requirement.md'), [
    '---', 'schema: harness-note/1', `id: ${REQ}`, 'kind: requirement', 'lifecycle: accepted', 'created: 2026-09-18', '---',
    '# Value', '', '## Problem', 'Missing value.', '', '## Expected behavior', 'Value is 42.', '', '## Scope', 'src/value.txt', '', '## Acceptance criteria', '- [ ] AC-1: value is 42', '',
  ].join('\n'))
  const built = buildArtifactBundle({ sessionId: 'meeting', roundNumber: 1, repoId: REPO, items: [{ fact: { id: 'action', kind: 'action', title: 'Write value', content: 'Make value 42.', status: 'confirmed' } as RoundtableFact }] })
  expect(built.diagnostics).toEqual([])
  const service = new HarnessNoteService()
  await service.applyBundleChangeSet(root, built.bundle.changeSet, 'Save reviewed draft')
  const uri = built.bundle.changeSet.operations[0].uri
  const draft = await readTaskDraft(root, uri)
  const contract: HarnessTaskContractInput = {
    scope: 'Write and check src/value.txt.', criteria: [],
    work: { scope: [{ repoId: REPO, paths: ['src/'] }], acceptanceRefs: [{ uri: TARGET, criterionId: 'AC-1' }], verification: [{
      id: 'check', kind: 'command', required: true, repoId: REPO, cwd: '.', program: 'node',
      args: ['-e', "if(require('fs').readFileSync('src/value.txt','utf8')!=='42')process.exit(1)"],
    }] },
  }
  return { root, uri, draft, contract, service }
}

describe('roundtable task adoption', () => {
  it('adopts, runs a real command, restores formal coverage from a clone and rejects code drift', async () => {
    const f = await fixture()
    expect((await collectTaskBaseline(f.root, f.uri)).ok).toBe(false)
    const accepted = await adoptTask(f.root, f.uri, f.draft.hash, f.contract)
    expect(accepted).toMatchObject({ uri: f.uri, lifecycle: 'accepted', hasExecution: false, repoId: REPO })
    git(f.root, 'init'); git(f.root, 'config', 'core.autocrlf', 'false')
    git(f.root, 'config', 'user.name', 'test'); git(f.root, 'config', 'user.email', 'test@example.invalid')
    git(f.root, 'add', '.'); git(f.root, 'commit', '--no-gpg-sign', '-m', 'adopt task')
    const prepared = await prepareTaskRun(f.root, { taskRef: f.uri, mode: 'xdo', closeout: 'commit-required' })
    expect(prepared.errors).toEqual([])
    const started = await startTaskRun(f.root, prepared.data.runId, 'tester', { by: 'tester' })
    expect(started.errors).toEqual([])
    const result = await verifyTaskExecution(f.root, prepared.data.runId, started.run!.lease!.token, {
      command: async (step) => { execFileSync(step.program!, step.args!, { cwd: join(f.root, step.cwd), timeout: 5000 }); return { ok: true, exitCode: 0, summary: 'Checked actual value' } },
      review: async (input) => ({ review: { kind: 'self', verdict: 'approved', reviewedManifestHash: input.manifestHash, actor: 'tester' }, coverage: input.criteria.map((criterion) => ({ ...criterion, checkIds: ['check'] })) }),
    })
    expect(result.errors).toEqual([])
    expect(result.completed).toBe(true)
    git(f.root, 'add', '.agents/notes', '.agents/evidence'); git(f.root, 'commit', '--no-gpg-sign', '-m', 'complete task')
    const clone = await mkdtemp(join(tmpdir(), 'roundtable-clone-')); roots.push(clone)
    git(clone, 'clone', '--no-local', f.root, '.')
    expect(await readTaskResult(clone, f.uri, { closeout: true })).toMatchObject({ execution: { state: 'done' }, validity: 'valid', closeout: { satisfied: true } })
    expect((await new HarnessNoteService().projectView(clone)).blueprint.nodes[REQ].progress).toBe(100)
    await writeFile(join(clone, 'src', 'value.txt'), '0')
    expect((await readTaskResult(clone, f.uri)).validity).toBe('stale')
    expect((await new HarnessNoteService().projectView(clone)).blueprint.nodes[REQ].progress).toBe(0)
  })

  it('rejects incomplete contracts, bad references, escaping paths and stale revisions without writing', async () => {
    const f = await fixture()
    for (const contract of [
      { ...f.contract, scope: 'TBD' },
      { ...f.contract, criteria: [{ id: 'AC-1', text: 'TBD - confirm' }] },
      { ...f.contract, work: { ...f.contract.work, scope: [{ repoId: REPO, paths: ['../escape'] }] } },
      { ...f.contract, work: { ...f.contract.work, acceptanceRefs: [{ uri: TARGET, criterionId: 'AC-99' }] } },
      { ...f.contract, work: { ...f.contract.work, verification: [] } },
      { ...f.contract, work: { ...f.contract.work, scope: [null] } } as never,
      { ...f.contract, work: { ...f.contract.work, acceptanceRefs: [null] } } as never,
      { ...f.contract, work: { ...f.contract.work, verification: [null] } } as never,
    ]) await expect(adoptTask(f.root, f.uri, f.draft.hash, contract)).rejects.toHaveProperty('code')
    await expect(adoptTask(f.root, f.uri, '0'.repeat(64), f.contract)).rejects.toMatchObject({ code: 'CONFLICT' })
    expect((await readTaskDraft(f.root, f.uri)).hash).toBe(f.draft.hash)
    await adoptTask(f.root, f.uri, f.draft.hash, f.contract)
    await expect(adoptTask(f.root, f.uri, f.draft.hash, f.contract)).rejects.toMatchObject({ code: 'CONFLICT' })
  })

  it('resolves selected Note bytes from attached roots and rejects missing, stale and ambiguous selections', async () => {
    const f = await fixture()
    expect(await projectChatContext([f.root], [{ uri: f.uri, expectedHash: f.draft.hash }])).toContain('Make value 42.')
    await expect(projectChatContext([], [{ uri: f.uri }])).rejects.toThrow('PERMISSION_DENIED')
    await expect(projectChatContext([f.root], [{ uri: f.uri, expectedHash: '0'.repeat(64) }])).rejects.toThrow('STALE_BASELINE')
    await expect(projectChatContext([f.root], [{ uri: `note://${REPO}/99999999-9999-4999-8999-999999999999` }])).rejects.toThrow('NOT_FOUND')
    const other = await fixture()
    await expect(projectChatContext([f.root, other.root], [{ uri: TARGET }])).rejects.toThrow('CONFLICT')
    expect(await readFile(join(f.root, '.agents', 'notes', 'requirement.md'), 'utf8')).toContain('lifecycle: accepted')
  })
})
