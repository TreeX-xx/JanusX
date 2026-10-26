import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { GitReviewScheduler } from '../../plugins/blueprint/src/main/blueprint/review/git-scheduler'
import { reviewContextKey } from '../../plugins/blueprint/src/main/blueprint/suggestions/store'
import { DEFAULT_BLUEPRINT_REVIEW_SETTINGS } from '../../plugins/blueprint/src/shared/blueprint-review-settings'
import type { ReviewContext, ReviewItem } from '../../plugins/blueprint/src/shared/blueprint-review'

let root: string, path: string, context: ReviewContext, scheduler: GitReviewScheduler
let saved: ReviewItem[], settings = structuredClone(DEFAULT_BLUEPRINT_REVIEW_SETTINGS)
const review = vi.fn()
const item = (noteId: string, fields = {}): ReviewItem => ({ noteId, reportRevision: 1, pending: false, error: null,
  availability: 'available', report: null, source: { path: '.agents/notes/' + noteId + '.md' }, ...fields } as ReviewItem)
function create() { return new GitReviewScheduler(path, { context: async () => context, settings: async () => settings,
  savedReviews: () => saved, review }) }
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'janusx-retry-ledger-')); path = join(root, 'state.json')
  context = { repoId: randomUUID(), workspacePath: root, branch: 'no-git' }
  saved = []; settings = structuredClone(DEFAULT_BLUEPRINT_REVIEW_SETTINGS); review.mockReset(); scheduler = create()
})
afterEach(async () => { await scheduler.shutdown(); await rm(root, { recursive: true, force: true }) })

it('imports real legacy failures, insufficient and interrupted results once, without invented commits or completion rounds', async () => {
  const ids = Array.from({ length: 5 }, () => randomUUID())
  saved = [item(ids[0], { error: 'Original failure', availability: 'deleted' }),
    item(ids[1], { report: { coverage: 'insufficient', findings: [] } }), item(ids[2], { pending: true }),
    item(ids[3], { reportRevision: 99 }), item(ids[4], { report: { coverage: 'complete', findings: [{ summary: 'Suggestion' }] } })]
  await scheduler.restoreRetries(context)
  expect(scheduler.activity(root)?.targets).toHaveLength(3)
  expect(scheduler.activity(root)?.targets?.map(target => target.state)).toEqual(['failed', 'incomplete', 'failed'])
  expect(scheduler.activity(root)?.targets?.every(target => target.commit === undefined && target.round === undefined)).toBe(true)
  expect(scheduler.activity(root)?.rounds).toEqual([])
  expect(scheduler.activity(root)?.targets?.[0]).toMatchObject({ noteId: ids[0], error: 'Original failure', path: saved[0].source?.path })
  await scheduler.shutdown(); scheduler = create(); saved = []
  await scheduler.tick(root)
  expect(scheduler.activity(root)?.phase).toBe('disabled')
  expect(scheduler.activity(root)?.targets).toHaveLength(3)
  settings.automatic.enabled = true; await scheduler.tick(root)
  expect(scheduler.activity(root)?.reason).toBe('no-git')
  expect(scheduler.activity(root)?.targets).toHaveLength(3)
  expect(review).not.toHaveBeenCalled()
})

it('deduplicates legacy reports against existing scheduler jobs and keeps their real error and provenance', async () => {
  const noteId = randomUUID(), commit = 'a'.repeat(40)
  saved = [item(noteId, { error: 'Old report failure' })]
  await writeFile(path, JSON.stringify({ version: 1, branches: { [reviewContextKey(context)]: { context, checkpoint: null, seen: null,
    enabled: false, jobs: [{ noteId, commit, attempts: 1, state: 'failed', error: 'Latest operation failed' }] } } }))
  await scheduler.restoreRetries(context)
  expect(scheduler.activity(root)?.targets).toMatchObject([{ noteId, commit, state: 'failed', error: 'Latest operation failed' }])
  expect(scheduler.activity(root)?.targets).toHaveLength(1)
})

it('keeps failed or insufficient manual retries, removes completed results with findings, and never resurrects a stale report', async () => {
  const noteId = randomUUID()
  saved = [item(noteId, { report: { coverage: 'insufficient', findings: [] } })]
  await scheduler.restoreRetries(context)
  await scheduler.manualFailed(context, noteId, new Error('Retry failed'), 'verifying', saved[0].source)
  expect(scheduler.activity(root)?.targets).toMatchObject([{ noteId, state: 'failed', error: 'Retry failed', stage: 'verifying' }])
  await scheduler.manualSucceeded(context, noteId, item(noteId, { reportRevision: 2, report: { coverage: 'insufficient' } }))
  expect(scheduler.activity(root)?.targets).toMatchObject([{ noteId, state: 'incomplete', reportRevision: 2 }])
  await scheduler.manualSucceeded(context, noteId, item(noteId, { reportRevision: 3, report: { coverage: 'complete', findings: [{ summary: 'Actionable suggestion' }] } }))
  expect(scheduler.activity(root)?.targets).toEqual([])
  await scheduler.shutdown(); scheduler = create(); await scheduler.restoreRetries(context)
  expect(scheduler.activity(root)?.targets).toEqual([])
  expect(scheduler.activity(root)?.rounds).toEqual([])
  expect(review).not.toHaveBeenCalled()
})

it('records new manual failures after migration and isolates workspace and branch retries', async () => {
  await scheduler.restoreRetries(context)
  const noteId = randomUUID(), original = { ...context }
  await scheduler.manualFailed(context, noteId, new Error('First manual failure'), 'structure')
  context = { ...context, branch: 'other' }; await scheduler.restoreRetries(context)
  expect(scheduler.activity(root)?.targets).toEqual([])
  await scheduler.manualFailed(context, noteId, new Error('Other branch failure'), 'reading')
  context = { ...original, workspacePath: root + '/other' }; await scheduler.restoreRetries(context)
  expect(scheduler.activity(context.workspacePath)?.targets).toEqual([])
  context = original; await scheduler.restoreRetries(context)
  expect(scheduler.activity(root)?.targets).toMatchObject([{ noteId, error: 'First manual failure' }])
})

it('updates a reviewed target on another successful manual review and keeps a later insufficient result discoverable', async () => {
  const noteId = randomUUID(), commit = 'a'.repeat(40)
  // A read-only empty restoration no longer creates a checkpoint file.
  await scheduler.tick(root)
  const state = JSON.parse(await readFile(path, 'utf8')), branch = state.branches[reviewContextKey(context)]
  branch.nextRound = 1; branch.completedRounds = [1]; branch.targets = [{ noteId, commit, round: 1, state: 'reviewed', reportRevision: 1 }]
  await writeFile(path, JSON.stringify(state))
  await scheduler.manualSucceeded(context, noteId, item(noteId, { reportRevision: 2, report: { coverage: 'complete' } }))
  expect(scheduler.activity(root)?.targets).toMatchObject([{ noteId, state: 'reviewed', round: 1, reportRevision: 2 }])
  await scheduler.manualSucceeded(context, noteId, item(noteId, { reportRevision: 3, report: { coverage: 'insufficient' } }))
  expect(scheduler.activity(root)?.targets).toMatchObject([{ noteId, state: 'incomplete', reportRevision: 3 }])
})


it('keeps enablement and unrelated Git reasons when recovering independent retries', async () => {
  settings.automatic.enabled = true
  const noteId = randomUUID(); await scheduler.tick(root)
  expect(scheduler.activity(root)?.reason).toBe('no-git')
  await scheduler.manualFailed(context, noteId, new Error('Manual failure'), 'reading')
  expect(scheduler.activity(root)?.phase).toBe('failed')
  await scheduler.tick(root)
  await scheduler.manualSucceeded(context, noteId, item(noteId, { report: { coverage: 'complete' } }))
  expect(scheduler.activity(root)).toMatchObject({ phase: 'unavailable', reason: 'no-git', targets: [] })
})


it('imports a real unfinished current report even when an older completion target exists', async () => {
  const noteId = randomUUID(), commit = 'a'.repeat(40)
  saved = [item(noteId, { error: 'Later manual failure', reportRevision: 9 })]
  await writeFile(path, JSON.stringify({ version: 1, branches: { [reviewContextKey(context)]: { context, checkpoint: null, seen: null,
    enabled: false, jobs: [], targets: [{ noteId, commit, state: 'reviewed', reportRevision: 4 }] } } }))
  await scheduler.restoreRetries(context)
  expect(scheduler.activity(root)?.targets).toHaveLength(1)
  expect(scheduler.activity(root)?.targets).toMatchObject([{ noteId, state: 'failed', error: 'Later manual failure', reportRevision: 9 }])
})
