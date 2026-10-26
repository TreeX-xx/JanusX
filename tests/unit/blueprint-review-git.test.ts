import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { SUPPORTED_HARNESS_PROFILE } from '@janus-agent/harness-node'
import { NoteService } from '@janus-agent/harness-node'
import { DEFAULT_BLUEPRINT_REVIEW_SETTINGS } from '../../plugins/blueprint/src/shared/blueprint-review-settings'
import { WorkspaceSuggestionSources } from '../../plugins/blueprint/src/main/blueprint/suggestions/sources'
import { WorkspaceSuggestions } from '../../plugins/blueprint/src/main/blueprint/suggestions/workspace-service'
import { ReviewStore } from '../../plugins/blueprint/src/main/blueprint/suggestions/store'
import { SuggestionService } from '../../plugins/blueprint/src/main/blueprint/suggestions/service'
import { NoteReviewEngine } from '../../plugins/blueprint/src/main/blueprint/review/engine'
import { GitReviewScheduler } from '../../plugins/blueprint/src/main/blueprint/review/git-scheduler'
import { GitReviewSources, git, gitHead } from '../../plugins/blueprint/src/main/blueprint/review/git-snapshot'
import { collectReviewEvidence, ReviewEvidenceSession } from '../../plugins/blueprint/src/main/blueprint/review/evidence'
import type { ReviewItem } from '../../plugins/blueprint/src/shared/blueprint-review'
import type { AutomaticReviewActivity } from '../../plugins/blueprint/src/shared/ipc/blueprint-review'

let root: string, workspace: string, repoId: string, noteId: string, sources: WorkspaceSuggestionSources
let settings = structuredClone(DEFAULT_BLUEPRINT_REVIEW_SETTINGS)
let scheduler: GitReviewScheduler
const review = vi.fn<(...args: unknown[]) => Promise<ReviewItem | undefined>>()
let updates: AutomaticReviewActivity[]
const document = (text: string) => '---\n' + JSON.stringify({ schema: 'harness-note/2', id: noteId, kind: 'module', role: 'project', lifecycle: 'accepted', moduleState: 'partial',
  created: '2026-10-10', updated: '2026-10-10T00:00:00Z', codeRefs: [{ repoId, path: 'code.ts', role: 'implementation' }] }) + '\n---\n# Module\n\n## Responsibility\n'+text+'\n'
async function commit(text?: string) {
  if (text) await writeFile(join(workspace, '.agents/notes/module.md'), document(text))
  await git(workspace, ['add', '.'])
  await git(workspace, ['commit', '--allow-empty', '-m', text ?? 'code-only'])
  return (await gitHead(workspace))!
}
function createScheduler() { return new GitReviewScheduler(join(root, 'git-state.json'), { context: path => sources.context(path), settings: async () => settings, review,
  activityChanged: path => { const activity = scheduler.activity(path); if (activity) updates.push(structuredClone(activity)) } }) }
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'janusx-git-review-')); workspace = join(root, 'workspace')
  await mkdir(join(workspace, '.agents/notes'), { recursive: true }); repoId = randomUUID(); noteId = randomUUID()
  await writeFile(join(workspace, '.agents/harness.json'), JSON.stringify({ schemaVersion: 1, repoId, name: 'Git review fixture', profile: SUPPORTED_HARNESS_PROFILE }))
  await writeFile(join(workspace, 'code.ts'), 'export const version = 1\n')
  await git(workspace, ['init', '-b', 'main']); await git(workspace, ['config', 'user.email', 'test@example.invalid'])
  await git(workspace, ['config', 'user.name', 'Review Test']); await git(workspace, ['config', 'core.autocrlf', 'false'])
  await commit('Initial responsibility')
  sources = new WorkspaceSuggestionSources(); review.mockReset(); review.mockResolvedValue(undefined)
  settings = structuredClone(DEFAULT_BLUEPRINT_REVIEW_SETTINGS); settings.automatic.enabled = true
  updates = []; scheduler = createScheduler()
})
afterEach(async () => { await scheduler.shutdown(); sources.notes.unwatchAll(); await rm(root, { recursive: true, force: true }) })

it('anchors first enable, counts all commits, checks cumulative Note changes and does not replay no-diff rounds', async () => {
  await commit('Existing history'); await scheduler.tick(workspace); expect(review).not.toHaveBeenCalled()
  await commit(); await commit('Changed on second commit'); await scheduler.tick(workspace)
  expect(scheduler.activity(workspace)).toMatchObject({ phase: 'waiting', commits: 2 })
  await commit(); await commit(); await commit(); await scheduler.tick(workspace)
  expect(review).toHaveBeenCalledTimes(1)
  const input = review.mock.calls[0] as unknown as [unknown, string, GitReviewSources]
  expect(input[1]).toBe(noteId)
  await scheduler.tick(workspace); expect(review).toHaveBeenCalledTimes(1)
  for (let i = 0; i < 5; i++) await commit()
  await scheduler.tick(workspace); expect(review).toHaveBeenCalledTimes(1)
  expect(scheduler.activity(workspace)?.commits).toBe(0)
})

it('retains per-branch counts and performs one ordinary-merge check before N, including an offline merge interval', async () => {
  await scheduler.tick(workspace); await commit(); await scheduler.tick(workspace)
  await git(workspace, ['checkout', '-b', 'feature']); await scheduler.tick(workspace)
  await commit('Feature responsibility'); await commit(); await scheduler.tick(workspace)
  await git(workspace, ['checkout', 'main']); await scheduler.tick(workspace)
  expect(scheduler.activity(workspace)?.commits).toBe(1)
  await git(workspace, ['merge', '--no-ff', 'feature', '-m', 'merge feature'])
  await commit() // Latest HEAD is no longer the merge; recovery must examine the interval.
  scheduler = createScheduler(); await scheduler.tick(workspace)
  expect(review).toHaveBeenCalledTimes(1)
  await scheduler.tick(workspace); expect(review).toHaveBeenCalledTimes(1)
})

it('counts fast-forward first-parent additions and coalesces offline intervals into the latest snapshot', async () => {
  settings.automatic.commits = 2; await scheduler.tick(workspace)
  await git(workspace, ['checkout', '-b', 'feature']); await commit('FF change'); await commit(); await commit()
  await git(workspace, ['checkout', 'main']); await git(workspace, ['merge', '--ff-only', 'feature'])
  const latest = await gitHead(workspace)
  scheduler = createScheduler(); await scheduler.tick(workspace)
  expect(review).toHaveBeenCalledTimes(1)
  expect((review.mock.calls[0] as unknown as [unknown, unknown, GitReviewSources])[2].commit).toBe(latest)
})

it('persists failed targets independently of checkpoints and retries a transient failure only once', async () => {
  settings.automatic.commits = 1; await scheduler.tick(workspace)
  review.mockRejectedValue(Object.assign(new Error('busy'), { code: 'TRANSIENT' }))
  await commit('Failed review'); await scheduler.tick(workspace)
  expect(review).toHaveBeenCalledTimes(2)
  expect(scheduler.activity(workspace)?.phase).toBe('failed')
  expect(scheduler.activity(workspace)?.targets).toMatchObject([{ noteId, title: 'Module', path: '.agents/notes/module.md', state: 'failed', stage: 'reading', error: 'busy' }])
  expect(scheduler.activity(workspace)?.lastRun).toMatchObject({ outcome: 'reviewed', reviewed: 0, failed: 1 })
  scheduler = createScheduler(); await scheduler.tick(workspace); await commit(); await scheduler.tick(workspace)
  expect(review).toHaveBeenCalledTimes(2)
  expect(Object.values(JSON.parse(await readFile(join(root, 'git-state.json'), 'utf8')).branches)[0]).toMatchObject({ jobs: [{ attempts: 2, state: 'failed' }] })
  settings.automatic.enabled = false; await scheduler.tick(workspace)
  expect(scheduler.activity(workspace)?.targets).toMatchObject([{ noteId, state: 'failed', error: 'busy', stage: 'reading' }])
  await scheduler.manualSucceeded(await sources.context(workspace), noteId)
  expect(scheduler.activity(workspace)?.targets).toMatchObject([{ noteId, state: 'reviewed' }])
  expect(updates.at(-1)?.targets).toMatchObject([{ noteId, state: 'reviewed' }])
})

it('keeps an incomplete target until a manual review resolves its coverage', async () => {
  settings.automatic.commits = 1; await scheduler.tick(workspace)
  review.mockResolvedValue({ reportRevision: 1, report: { coverage: 'insufficient', findings: [] } } as ReviewItem)
  await commit('Incomplete review'); await scheduler.tick(workspace)
  expect(scheduler.activity(workspace)?.targets).toMatchObject([{ noteId, state: 'incomplete', reportRevision: 1 }])
  const context = await sources.context(workspace)
  await scheduler.manualFailed(context, noteId, new Error('New recovery failure'), 'verifying')
  expect(scheduler.activity(workspace)?.targets).toMatchObject([{ noteId, state: 'failed', stage: 'verifying', error: 'New recovery failure' }])
  await scheduler.manualSucceeded(context, noteId, { reportRevision: 2, report: { coverage: 'insufficient' } } as ReviewItem)
  expect(scheduler.activity(workspace)?.targets).toMatchObject([{ noteId, state: 'incomplete', reportRevision: 2 }])
  await scheduler.manualSucceeded(context, noteId, { reportRevision: 3, report: { coverage: 'complete' } } as ReviewItem)
  expect(scheduler.activity(workspace)?.targets).toMatchObject([{ noteId, state: 'reviewed' }])
  scheduler = createScheduler(); await scheduler.tick(workspace)
  expect(scheduler.activity(workspace)?.targets).toMatchObject([{ noteId, state: 'reviewed' }])
})

it('does not retry configuration errors or generate while disabled and re-anchors a disabled interval', async () => {
  settings.automatic.commits = 1; settings.automatic.enabled = false; await scheduler.tick(workspace)
  await commit('While disabled'); await scheduler.tick(workspace); expect(review).not.toHaveBeenCalled()
  settings.automatic.enabled = true; await scheduler.tick(workspace); expect(review).not.toHaveBeenCalled()
  review.mockRejectedValue(Object.assign(new Error('missing provider'), { code: 'MODEL_UNAVAILABLE' }))
  await commit('After enable'); await scheduler.tick(workspace); await scheduler.tick(workspace)
  expect(review).toHaveBeenCalledTimes(1)
})

it('reads Note and code from one immutable commit without switching or modifying the dirty checkout', async () => {
  const context = await sources.context(workspace), commitId = (await gitHead(workspace))!
  await writeFile(join(workspace, 'code.ts'), 'export const version = 2\n')
  await writeFile(join(workspace, '.agents/notes/module.md'), document('Uncommitted responsibility'))
  const pinned = await GitReviewSources.open(context, commitId)
  try {
    const input = await collectReviewEvidence(pinned, context, noteId)
    const evidence = new ReviewEvidenceSession(pinned, input)
    expect(input.commit).toBe(commitId)
    expect(input.materials).toEqual([])
    await evidence.read(input.target.path)
    expect((await evidence.paths('code.ts')).items).toContain('code.ts')
    expect((await evidence.search('version = 1')).items.some(item => item.includes('code.ts'))).toBe(true)
    await evidence.read('code.ts')
    await evidence.validate()
    expect(input.materials.find(item => item.path === 'code.ts')?.content).toContain('version = 1')
    expect(input.materials.find(item => item.path.endsWith('module.md'))?.content).toContain('Initial responsibility')
    expect(await readFile(join(workspace, 'code.ts'), 'utf8')).toContain('version = 2')
    expect(await gitHead(workspace)).toBe(commitId)
  } finally { await pinned.close() }
})

it('waits for the Note lock before opening an immutable review snapshot', async () => {
  const context = await sources.context(workspace), commitId = (await gitHead(workspace))!
  const readSnapshot = vi.spyOn(NoteService.prototype, 'readSnapshot')
  readSnapshot.mockImplementationOnce(() => { throw Object.assign(new Error('notes busy: lock held'), { code: 'BUSY' }) })
  const pinned = await GitReviewSources.open(context, commitId)
  await pinned.close()
  expect(readSnapshot).toHaveBeenCalledTimes(2)
})

it('publishes a finding from a committed Note while the checkout has newer uncommitted content', async () => {
  await commit('The implementation uses version 2 today.')
  const context = await sources.context(workspace)
  const store = new ReviewStore(join(root, 'suggestions.sqlite'))
  try {
    const suggestions = new WorkspaceSuggestions(new SuggestionService(store), sources)
    const engine = new NoteReviewEngine(suggestions, sources, {
      generate: async (_settings, input, evidence) => {
        expect((await evidence.read(input.target.path)).content).toContain('version 2 today')
        await evidence.read('code.ts')
        return { findings: [{ id: randomUUID(), category: 'contradiction', summary: 'Implementation differs from the Note',
          explanation: 'The committed implementation still uses version 1.', suggestion: 'Update the Note to describe the committed implementation.',
          citations: [{ path: 'code.ts', quote: 'export const version = 1' }], verification: 'not-configured' }],
          coverage: 'complete', limitations: [], resolvedFindings: [] }
      },
      verify: async () => { throw new Error('JEV should be disabled') },
    })
    const committed = await gitHead(workspace)
    await writeFile(join(workspace, 'code.ts'), 'export const version = 2\n')
    await writeFile(join(workspace, '.agents/notes/module.md'), document('Uncommitted responsibility'))
    const pinned = await GitReviewSources.open(context, committed!)
    try {
      const result = await engine.review(context, noteId, { ...settings, generation: { providerId: 'test', modelId: 'test' } },
        new AbortController().signal, undefined, undefined, pinned)
      expect(result.report?.findings).toMatchObject([{ summary: 'Implementation differs from the Note', stale: true }])
      expect(result.report?.provenance?.commit).toBe(committed)
      expect(result.report?.stale).toBe(true)
      expect((await suggestions.read(context)).items.find(item => item.noteId === noteId)?.report?.findings).toHaveLength(1)
      expect(await readFile(join(workspace, 'code.ts'), 'utf8')).toBe('export const version = 2\n')
    } finally { await pinned.close() }
  } finally { store.close() }
})

it('runs the automatic Git review through generation, publication, and readable findings or an empty report', async () => {
  const secondId = randomUUID()
  settings.automatic.commits = 1
  settings.generation = { providerId: 'test', modelId: 'test' }
  const store = new ReviewStore(join(root, 'automatic-suggestions.sqlite'))
  const suggestions = new WorkspaceSuggestions(new SuggestionService(store), sources)
  const engine = new NoteReviewEngine(suggestions, sources, {
    generate: async (_settings, input, evidence) => {
      const target = await evidence.read(input.target.path)
      const code = await evidence.read('code.ts')
      expect(code.content).toContain('version = 1')
      if (input.target.noteId === secondId) return { findings: [], coverage: 'complete', limitations: [], resolvedFindings: [] }
      expect(target.content).toContain('version 2 today')
      return { findings: [{ id: randomUUID(), category: 'contradiction', summary: 'Documented version differs from implementation',
        explanation: 'The Note says version 2 while committed code uses version 1.', suggestion: 'Correct the current implementation claim.',
        citations: [{ path: input.target.path, quote: 'version 2 today' }, { path: 'code.ts', quote: 'version = 1' }],
        verification: 'not-configured' }], coverage: 'complete', limitations: [], resolvedFindings: [] }
    },
    verify: async () => { throw new Error('JEV should be disabled') },
  })
  scheduler = new GitReviewScheduler(join(root, 'pipeline-state.json'), {
    context: path => sources.context(path), settings: async () => settings,
    review: (context, id, pinned, signal) => engine.review(context, id, settings, signal, undefined,
      undefined, pinned),
  })
  try {
    await scheduler.tick(workspace)
    await writeFile(join(workspace, '.agents/notes/second.md'), document('Version 1 is currently implemented.').replace(noteId, secondId).replace('\"kind\":\"module\",\"role\":\"project\"', '\"kind\":\"requirement\",\"module\":\"note://' + repoId + '/' + noteId + '\"').replace(',"moduleState":"partial"', '').replace('# Module', '# Second').replace('## Responsibility', '## Expected behavior') + '\n## Acceptance criteria\n\n- [ ] AC-1: Preserve the described version.\n')
    await commit('The implementation uses version 2 today.')
    const committed = await gitHead(workspace)
    await writeFile(join(workspace, '.agents/notes/module.md'), document('Local draft says version 3.'))
    await writeFile(join(workspace, 'code.ts'), 'export const version = 3\n')
    await scheduler.tick(workspace)
    expect(scheduler.activity(workspace)?.lastRun).toMatchObject({ reviewed: 2, findings: 1, failed: 0, incomplete: 0 })
    const items = (await suggestions.read(await sources.context(workspace))).items
    expect(items.find(item => item.noteId === noteId)?.report).toMatchObject({
      provenance: { commit: committed }, stale: true, findings: [{ summary: 'Documented version differs from implementation', stale: true }],
    })
    expect(items.find(item => item.noteId === secondId)?.report).toMatchObject({ findings: [], coverage: 'complete' })
    expect(scheduler.activity(workspace)?.targets?.every(target => target.state === 'reviewed')).toBe(true)
  } finally { store.close() }
}, 40000)

it('cancels active generation when disabled, reanchors on enable and clears failures after manual recovery', async () => {
  settings.automatic.commits = 1
  scheduler.watch(workspace); await scheduler.poll()
  await commit('Interrupted review')
  let started!: () => void
  const ready = new Promise<void>(resolve => { started = resolve })
  review.mockImplementationOnce(async (...args: unknown[]) => {
    const signal = args[3] as AbortSignal
    started()
    await new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }))
  })
  const pending = scheduler.poll(); await ready
  settings.automatic.enabled = false
  await scheduler.settingsChanged(); await pending
  expect(scheduler.activity(workspace)?.phase).toBe('disabled')
  await commit('Disabled interval')
  settings.automatic.enabled = true; await scheduler.settingsChanged(); await scheduler.poll()
  expect(review).toHaveBeenCalledTimes(1)
  expect(scheduler.activity(workspace)?.phase).toBe('failed')
  await scheduler.manualSucceeded(await sources.context(workspace), noteId)
  expect(scheduler.activity(workspace)?.phase).toBe('waiting')
  expect(Object.values(JSON.parse(await readFile(join(root, 'git-state.json'), 'utf8')).branches)[0]).toMatchObject({ jobs: [] })
})

it('resumes one interrupted job after shutdown without replaying its commit count', async () => {
  settings.automatic.commits = 1; await scheduler.tick(workspace); await commit('Restart review')
  let started!: () => void
  const ready = new Promise<void>(resolve => { started = resolve })
  review.mockImplementationOnce(async (...args: unknown[]) => {
    started()
    await new Promise((_resolve, reject) => (args[3] as AbortSignal).addEventListener('abort', () => reject(new Error('shutdown')), { once: true }))
  })
  const pending = scheduler.tick(workspace); await ready; await scheduler.shutdown(); await pending
  scheduler = createScheduler(); await scheduler.tick(workspace)
  expect(review).toHaveBeenCalledTimes(2)
  expect(scheduler.activity(workspace)).toMatchObject({ commits: 0, phase: 'waiting' })
  await scheduler.tick(workspace); expect(review).toHaveBeenCalledTimes(2)
})

it('does not exhaust the failure budget when two shutdowns interrupt the same Note', async () => {
  settings.automatic.commits = 1; await scheduler.tick(workspace); await commit('Repeated restart')
  for (let i = 0; i < 2; i++) {
    let started!: () => void
    const ready = new Promise<void>(resolve => { started = resolve })
    review.mockImplementationOnce(async (...args: unknown[]) => {
      started()
      await new Promise((_resolve, reject) => (args[3] as AbortSignal).addEventListener('abort', () => reject(Error('shutdown')), { once: true }))
    })
    const pending = scheduler.tick(workspace); await ready; await scheduler.shutdown(); await pending
    const branch = Object.values(JSON.parse(await readFile(join(root, 'git-state.json'), 'utf8')).branches)[0] as { jobs: Array<{ attempts: number }> }
    expect(branch.jobs[0].attempts).toBe(0)
    scheduler = createScheduler()
  }
  await scheduler.tick(workspace)
  expect(review).toHaveBeenCalledTimes(3)
  expect(scheduler.activity(workspace)?.targets).toMatchObject([{ state: 'reviewed' }])
})

it('keeps an immutable Note snapshot after its temporary materialization disappears', async () => {
  const context = await sources.context(workspace)
  const source = await GitReviewSources.open(context, (await gitHead(workspace))!)
  const snapshot = await source.snapshot(context)
  const bytes = await source.bytes(context, '.agents/notes/module.md')
  try {
    await source.close()
    expect(await source.snapshot(context)).toBe(snapshot)
    expect(await source.bytes(context, '.agents/notes/module.md')).toEqual(bytes)
  } finally { await source.close() }
})

it('publishes current Note and completed counts, preserves one summary on restart, and replaces it on a no-change round', async () => {
  settings.automatic.commits = 1
  const secondId = randomUUID()
  await writeFile(join(workspace, '.agents/notes/second.md'), document('Second initial').replace(noteId, secondId).replace('# Module', '# Second module'))
  await commit('Two initial Notes'); await scheduler.tick(workspace)
  await writeFile(join(workspace, '.agents/notes/second.md'), document('Second changed').replace(noteId, secondId).replace('# Module', '# Second module'))
  await commit('First changed')
  let started!: () => void, finish!: () => void
  const ready = new Promise<void>(resolve => { started = resolve })
  const held = new Promise<void>(resolve => { finish = resolve })
  let calls = 0
  review.mockImplementation(async () => {
    calls++
    if (calls === 2) { started(); await held }
    return { report: { findings: calls === 1 ? [{}, {}] : [], coverage: calls === 1 ? 'complete' : 'insufficient' } } as ReviewItem
  })
  const pending = scheduler.tick(workspace); await ready
  expect(scheduler.activity(workspace)).toMatchObject({ phase: 'reviewing', total: 2, completed: 1, remaining: 1 })
  expect(scheduler.activity(workspace)?.currentNote?.title).toBeTruthy()
  finish(); await pending
  const summary = scheduler.activity(workspace)?.lastRun
  const targets = scheduler.activity(workspace)?.targets
  expect(targets?.map(target => target.state)).toEqual(['reviewed', 'incomplete'])
  expect(targets?.map(target => target.noteId).sort()).toEqual([noteId, secondId].sort())
  expect(summary).toMatchObject({ outcome: 'reviewed', reviewed: 2, findings: 2, incomplete: 1, failed: 0 })
  expect(updates.some(update => update.phase === 'checking')).toBe(true)
  expect(updates.some(update => update.phase === 'reviewing' && update.completed === 0 && update.currentNote)).toBe(true)
  scheduler = createScheduler(); await scheduler.tick(workspace)
  expect(scheduler.activity(workspace)?.lastRun).toEqual(summary)
  expect(scheduler.activity(workspace)?.targets).toEqual(targets)
  await commit(); await scheduler.tick(workspace)
  expect(scheduler.activity(workspace)?.lastRun).toMatchObject({ outcome: 'no-changes', reviewed: 0, findings: 0 })
  expect(review).toHaveBeenCalledTimes(2)
})

it('reports detached and empty repositories as unavailable instead of waiting for a review', async () => {
  await git(workspace, ['checkout', '--detach'])
  await scheduler.tick(workspace)
  expect(scheduler.activity(workspace)).toMatchObject({ phase: 'unavailable', reason: 'detached' })
  await git(workspace, ['checkout', '--orphan', 'empty'])
  await scheduler.tick(workspace)
  expect(scheduler.activity(workspace)).toMatchObject({ phase: 'unavailable', reason: 'no-commits' })
  expect(review).not.toHaveBeenCalled()
})

it('enables feedback for a Note workspace without Git without failing settings persistence', async () => {
  const noGit = join(root, 'no-git')
  await mkdir(join(noGit, '.agents/notes'), { recursive: true })
  await writeFile(join(noGit, '.agents/harness.json'), JSON.stringify({ schemaVersion: 1, repoId, profile: SUPPORTED_HARNESS_PROFILE }))
  await writeFile(join(noGit, '.agents/notes/module.md'), document('Non-Git workspace'))
  settings.automatic.enabled = false
  scheduler.watch(noGit); await scheduler.poll()
  settings.automatic.enabled = true
  await scheduler.settingsChanged()
  expect(scheduler.activity(noGit)).toMatchObject({ phase: 'unavailable', reason: 'no-git' })
  expect(review).not.toHaveBeenCalled()
})


it('retains only two actual rounds, keeps unresolved Notes, deduplicates and records successful recovery as a new round', async () => {
  settings.automatic.commits = 1
  await scheduler.tick(workspace)
  const failedId = randomUUID(), incompleteId = randomUUID()
  const writeNote = async (id: string, text: string) => writeFile(join(workspace, '.agents/notes/' + id + '.md'), document(text).replace(noteId, id))
  await writeNote(failedId, 'Failed input'); await writeNote(incompleteId, 'Incomplete input')
  review.mockImplementation(async (...args) => {
    if (args[1] === failedId) throw new Error('Unavailable model')
    return { reportRevision: 1, report: { findings: [], coverage: args[1] === incompleteId ? 'insufficient' : 'complete' } } as ReviewItem
  })
  await commit('Round one'); await scheduler.tick(workspace)
  const secondId = randomUUID(), thirdId = randomUUID()
  await writeNote(secondId, 'Round two'); await commit(); await scheduler.tick(workspace)
  // Empty checks do not consume the two-round window.
  await commit(); await scheduler.tick(workspace); await scheduler.tick(workspace)
  expect(scheduler.activity(workspace)?.targets?.find(target => target.noteId === noteId)?.state).toBe('reviewed')
  await writeNote(thirdId, 'Round three'); await commit(); await scheduler.tick(workspace)
  expect(scheduler.activity(workspace)?.targets?.map(target => target.noteId).sort()).toEqual([failedId, incompleteId, secondId, thirdId].sort())
  const rounds = scheduler.activity(workspace)?.rounds
  expect(rounds).toHaveLength(2)
  expect(rounds?.every(round => round.finishedAt && Number.isFinite(Date.parse(round.finishedAt)))).toBe(true)
  await scheduler.shutdown(); scheduler = createScheduler(); await scheduler.tick(workspace)
  expect(scheduler.activity(workspace)?.rounds).toEqual(rounds)
  settings.automatic.enabled = false; await scheduler.tick(workspace)
  expect(scheduler.activity(workspace)?.rounds).toEqual(rounds)
  expect(scheduler.activity(workspace)?.targets?.filter(target => target.state !== 'reviewed')).toHaveLength(2)
  await scheduler.manualSucceeded(await sources.context(workspace), failedId, { reportRevision: 2, report: { coverage: 'complete' } } as ReviewItem)
  expect(scheduler.activity(workspace)?.targets?.map(target => target.noteId).sort()).toEqual([failedId, incompleteId, thirdId].sort())
  await scheduler.manualSucceeded(await sources.context(workspace), incompleteId, { reportRevision: 2, report: { coverage: 'insufficient' } } as ReviewItem)
  expect(scheduler.activity(workspace)?.targets?.find(target => target.noteId === incompleteId)?.state).toBe('incomplete')
  settings.automatic.enabled = true; await scheduler.tick(workspace)
  await writeNote(failedId, 'Latest automatic review'); await commit(); await scheduler.tick(workspace)
  // A newer failure overrides its older completion; no duplicate Note rows.
  expect(scheduler.activity(workspace)?.targets?.filter(target => target.noteId === failedId)).toMatchObject([{ state: 'failed' }])
  expect(scheduler.activity(workspace)?.targets?.map(target => target.noteId).sort()).toEqual([failedId, incompleteId, thirdId].sort())
}, 60000)

it('migrates old targets as one retained round without treating ordinary revisions as reviews', async () => {
  await scheduler.tick(workspace)
  const path = join(root, 'git-state.json'), state = JSON.parse(await readFile(path, 'utf8'))
  const branch = Object.values(state.branches)[0] as any
  delete branch.nextRound; delete branch.completedRounds
  branch.targets = [{ noteId, commit: await gitHead(workspace), state: 'reviewed', reportRevision: 7 }]
  await writeFile(path, JSON.stringify(state))
  await scheduler.shutdown(); scheduler = createScheduler(); await scheduler.tick(workspace)
  expect(scheduler.activity(workspace)?.targets).toMatchObject([{ noteId, state: 'reviewed' }])
  expect(review).not.toHaveBeenCalled()
})



it('retains retry records after committed deletion or excluded type until completed recovery', async () => {
  settings.automatic.commits = 1; await scheduler.tick(workspace)
  review.mockRejectedValue(new Error('Missing configuration'))
  const targetId = randomUUID(), path = join(workspace, '.agents/notes/target.md')
  const text = (kind: 'note' | 'requirement') => '---\n' + JSON.stringify({ schema: 'harness-note/2', id: targetId, kind, lifecycle: 'accepted',
    module: 'note://' + repoId + '/' + noteId, created: '2026-10-10', updated: '2026-10-10T00:00:00Z' }) + '\n---\n# Target\n\n## Expected behavior\nCurrent input.\n\n## Acceptance criteria\n- [ ] AC-1: Preserve recovery records.\n'
  await writeFile(path, text('requirement')); await commit(); await scheduler.tick(workspace)
  expect(scheduler.activity(workspace)?.targets).toMatchObject([{ noteId: targetId, state: 'failed' }])
  await writeFile(path, text('note')); await commit(); await scheduler.tick(workspace)
  expect(scheduler.activity(workspace)?.targets).toMatchObject([{ noteId: targetId, state: 'failed' }])
  expect(review).toHaveBeenCalledTimes(1)
  await writeFile(path, text('requirement')); await commit(); await scheduler.tick(workspace)
  await rm(path); await commit(); await scheduler.tick(workspace)
  expect(scheduler.activity(workspace)?.targets).toMatchObject([{ noteId: targetId, state: 'failed' }])
  expect(review).toHaveBeenCalledTimes(2)
})

it('keeps an interrupted round completion when newer input replaces its remaining job', async () => {
  settings.automatic.commits = 1
  const completedId = randomUUID()
  await writeFile(join(workspace, '.agents/notes/completed.md'), document('Previously completed').replace(noteId, completedId))
  await commit(); await scheduler.tick(workspace)
  const path = join(root, 'git-state.json'), state = JSON.parse(await readFile(path, 'utf8'))
  const branch = Object.values(state.branches)[0] as any
  branch.nextRound = 1; branch.completedRounds = []
  branch.targets = [{ noteId: completedId, commit: branch.checkpoint, state: 'reviewed', round: 1 }]
  branch.jobs = [{ noteId, commit: branch.checkpoint, state: 'pending', attempts: 1, round: 1 }]
  await writeFile(path, JSON.stringify(state))
  await scheduler.shutdown(); scheduler = createScheduler()
  await commit('Newer remaining input'); await scheduler.tick(workspace)
  expect(scheduler.activity(workspace)?.targets?.map(target => target.noteId).sort()).toEqual([completedId, noteId].sort())
  expect(review).toHaveBeenCalledTimes(1)
  expect(Object.values(JSON.parse(await readFile(path, 'utf8')).branches)[0]).toMatchObject({ completedRounds: [1, 2] })
})


it('keeps an unresolved Note discoverable while an automatic retry reviews newer input', async () => {
  settings.automatic.commits = 1; await scheduler.tick(workspace)
  review.mockRejectedValueOnce(new Error('First failure'))
  await commit('Failed input'); await scheduler.tick(workspace)
  await commit('Retry newer input')
  let started!: () => void, finish!: () => void
  const ready = new Promise<void>(resolve => { started = resolve })
  const held = new Promise<void>(resolve => { finish = resolve })
  review.mockImplementationOnce(async () => { started(); await held; return { reportRevision: 2, report: { coverage: 'complete', findings: [] } } as ReviewItem })
  const retry = scheduler.tick(workspace); await ready
  expect(scheduler.activity(workspace)?.targets).toMatchObject([{ noteId, state: 'reviewing', retrying: true }])
  let restored = false
  const restoring = scheduler.restoreRetries(await sources.context(workspace)).then(() => { restored = true })
  await new Promise(resolve => setImmediate(resolve))
  const restoredDuringReview = restored
  finish(); await retry; await restoring
  expect(restoredDuringReview).toBe(true)
  expect(scheduler.activity(workspace)?.targets).toMatchObject([{ noteId, state: 'reviewed' }])
  expect(scheduler.activity(workspace)?.targets?.[0].retrying).toBeUndefined()
})


it('replaces an imported historical retry after an automatic complete result with suggestions', async () => {
  await scheduler.shutdown()
  scheduler = new GitReviewScheduler(join(root, 'git-state.json'), { context: path => sources.context(path), settings: async () => settings, review,
    savedReviews: () => [{ noteId, reportRevision: 1, availability: 'available', error: 'Historical manual failure' } as ReviewItem] })
  settings.automatic.commits = 1; await scheduler.tick(workspace)
  expect(scheduler.activity(workspace)?.targets).toMatchObject([{ noteId, state: 'failed' }])
  review.mockResolvedValue({ reportRevision: 2, report: { coverage: 'complete', findings: [{ summary: 'Suggestion' }] } } as ReviewItem)
  await commit('Recover historical retry'); await scheduler.tick(workspace)
  expect(scheduler.activity(workspace)?.targets).toMatchObject([{ noteId, state: 'reviewed', reportRevision: 2 }])
  expect(scheduler.activity(workspace)?.targets).toHaveLength(1)
  expect(Object.values(JSON.parse(await readFile(join(root, 'git-state.json'), 'utf8')).branches)[0]).toMatchObject({ retries: [] })
})
