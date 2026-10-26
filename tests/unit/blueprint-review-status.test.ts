import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdtemp, rm, realpath, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DEFAULT_BLUEPRINT_REVIEW_SETTINGS } from '../../plugins/blueprint/src/shared/blueprint-review-settings'
import { BlueprintReviewRuntime } from '../../src/main/blueprint/review/runtime'
import { WorkspaceSuggestionSources } from '../../plugins/blueprint/src/main/blueprint/suggestions/sources'
import { SUPPORTED_HARNESS_PROFILE } from '@janus-agent/harness-node'

vi.mock('electron', () => ({ app: { getPath: () => 'unused' } }))
vi.mock('../../src/main/blueprint/review/models', () => ({ blueprintReviewModels: {} }))
let directory: string, runtime: BlueprintReviewRuntime
beforeEach(async () => { directory = await realpath(await mkdtemp(join(tmpdir(), 'janus-status-'))); runtime = new BlueprintReviewRuntime(directory, { generate: async () => { throw new Error('Not configured') }, verify: async () => { throw new Error('Not configured') } }) })
afterEach(async () => { await runtime.shutdown(); await rm(directory, { recursive: true, force: true }) })

it('returns persisted enablement while a Note read is blocked, without starting a review', async () => {
  await runtime.settings.update({ ...DEFAULT_BLUEPRINT_REVIEW_SETTINGS, automatic: { enabled: true, commits: 3 } })
  let release!: (value: never) => void
  const context = vi.spyOn(runtime.sources, 'context').mockImplementation(() => new Promise(resolve => { release = resolve }))
  const scan = vi.spyOn(runtime.sources, 'capture'), review = vi.spyOn(runtime.engine, 'review'), watch = vi.spyOn(runtime.automatic, 'watch')
  const blocked = runtime.read(directory).catch(() => {})
  try {
    const result = await Promise.race([runtime.activityRead(directory), new Promise<never>((_, reject) => { const timer = setTimeout(() => reject(Error('status waited for Note loading')), 1000); timer.unref() })])
    expect(result).toMatchObject({ automaticSettings: { enabled: true, commits: 3 }, activities: [] })
    expect(context).toHaveBeenCalledTimes(1)
    expect(scan).not.toHaveBeenCalled(); expect(review).not.toHaveBeenCalled(); expect(watch).not.toHaveBeenCalled()
  } finally { release(undefined as never); await blocked }
})

it('broadcasts persisted configuration before scheduler work and versions delayed status snapshots', async () => {
  await runtime.activityRead(directory)
  let release!: (value: typeof DEFAULT_BLUEPRINT_REVIEW_SETTINGS) => void
  const read = vi.spyOn(runtime.settings, 'read').mockImplementation(() => new Promise(resolve => { release = resolve }))
  const pending = runtime.activityRead(directory)
  await vi.waitFor(() => expect(read).toHaveBeenCalled())
  const listener = vi.fn(); runtime.onActivityChanged(listener)
  const enabled = { ...DEFAULT_BLUEPRINT_REVIEW_SETTINGS, automatic: { enabled: true, commits: 3 } }
  runtime.configurationChanged(enabled)
  expect(listener).toHaveBeenCalledWith(expect.objectContaining({ automaticSettings: enabled.automatic, root: directory }))
  release(DEFAULT_BLUEPRINT_REVIEW_SETTINGS)
  const stale = await pending
  expect(stale.revision).toBeLessThan(listener.mock.calls[0][0].revision)
  expect(stale.automaticSettings?.enabled).toBe(false)
})

it('publishes a real review independently of a foreground index timeout', async () => {
  const repoId = '00000000-0000-4000-8000-000000000001', noteId = '00000000-0000-4000-8000-000000000002'
  await mkdir(join(directory, '.agents/notes'), { recursive: true })
  await writeFile(join(directory, '.agents/harness.json'), JSON.stringify({ schemaVersion: 1, repoId, name: 'Publication isolation fixture', profile: SUPPORTED_HARNESS_PROFILE }))
  await writeFile(join(directory, '.agents/notes/module.md'), '---\n' + JSON.stringify({ schema: 'harness-note/2', id: noteId, kind: 'module', role: 'project', moduleState: 'partial', lifecycle: 'accepted', created: '2026-10-10', updated: '2026-10-10T00:00:00Z' }) + '\n---\n# Module\n\n## Responsibility\n\nTest review publication.\n')
  await runtime.shutdown()
  const foreground = new WorkspaceSuggestionSources()
  const timeout = vi.spyOn(foreground, 'snapshot').mockRejectedValue(Error('BLUEPRINT_SYNC_TIMEOUT'))
  runtime = new BlueprintReviewRuntime(directory, {
    generate: async (_settings, input, evidence) => { await evidence.read(input.target.path); return { findings: [], coverage: 'complete', limitations: [] } },
    verify: vi.fn(),
  }, foreground)
  await runtime.settings.update({ ...DEFAULT_BLUEPRINT_REVIEW_SETTINGS, generation: { providerId: 'fixture', modelId: 'fixture' } })
  const result = await runtime.run(directory, noteId)
  expect(result.report?.coverage).toBe('complete')
  expect(result.pending).toBeNull()
  expect(timeout).not.toHaveBeenCalled()
})


it('restores legacy failures before source synchronization clears their report error', async () => {
  const context = { repoId: '00000000-0000-4000-8000-000000000001', workspacePath: directory, branch: 'no-git' }
  const noteId = '00000000-0000-4000-8000-000000000002'
  vi.spyOn(runtime.sources, 'context').mockResolvedValue(context)
  vi.spyOn(runtime.automatic, 'watch').mockImplementation(() => {})
  runtime.store.mutate(context, state => { state.items.push({ noteId, reportRevision: 3, error: 'Historical failure', availability: 'available',
    report: null, pending: false, generation: 'old', missingSince: null } as any) })
  vi.spyOn(runtime.suggestions, 'readWithSnapshot').mockImplementation(async () => {
    runtime.store.mutate(context, state => { state.items[0].error = null })
    return { ...runtime.store.read(context), sourceComplete: true, snapshot: { structure: { complete: true, issues: [] } } } as any
  })
  vi.spyOn(runtime.reading, 'read').mockResolvedValue({ context, revision: 0, ready: true, complete: true, entries: [] })
  const review = vi.spyOn(runtime.engine, 'review')
  const view = await runtime.read(directory)
  expect(view.items[0].error).toBeNull()
  expect(view.automatic?.targets).toMatchObject([{ noteId, state: 'failed', error: 'Historical failure' }])
  expect(review).not.toHaveBeenCalled()
})

it('resolves repository identity without scanning the Note corpus', async () => {
  const repoId = '00000000-0000-4000-8000-000000000001'
  await mkdir(join(directory, '.agents'))
  await writeFile(join(directory, '.agents/harness.json'), JSON.stringify({ schemaVersion: 1, repoId, name: 'Fixture', profile: SUPPORTED_HARNESS_PROFILE }))
  const sources = new WorkspaceSuggestionSources()
  const scan = vi.spyOn(sources.notes, 'readSnapshot').mockRejectedValue(Error('Must not scan for identity'))
  expect(await sources.context(directory)).toMatchObject({ repoId, workspacePath: directory, branch: 'no-git' })
  expect(scan).not.toHaveBeenCalled()
})

it('restores current targets without waiting for the automatic execution queue', async () => {
  const context = { repoId: '00000000-0000-4000-8000-000000000001', workspacePath: directory, branch: 'no-git' }
  vi.spyOn(runtime.sources, 'context').mockResolvedValue(context)
  let release!: (value: typeof DEFAULT_BLUEPRINT_REVIEW_SETTINGS) => void
  const read = vi.spyOn(runtime.settings, 'read').mockImplementationOnce(() => new Promise(resolve => { release = resolve })).mockResolvedValue(DEFAULT_BLUEPRINT_REVIEW_SETTINGS)
  const occupied = runtime.automatic.tick(directory)
  try {
    await vi.waitFor(() => expect(read).toHaveBeenCalledOnce())
    await Promise.race([runtime.automatic.restoreRetries(context), new Promise<never>((_, reject) => {
      const timer = setTimeout(() => reject(Error('List restoration waited for automatic work')), 1000); timer.unref()
    })])
    expect(runtime.automatic.activity(directory)).toMatchObject({ context, phase: 'disabled', targets: [] })
  } finally { release(DEFAULT_BLUEPRINT_REVIEW_SETTINGS); await occupied }
})

it('shares concurrent list reads and releases a failed read for retry', async () => {
  const context = { repoId: '00000000-0000-4000-8000-000000000001', workspacePath: directory, branch: 'no-git' }
  const resolveContext = vi.spyOn(runtime.sources, 'context').mockResolvedValue(context)
  vi.spyOn(runtime.automatic, 'watch').mockImplementation(() => {})
  const value = { context, revision: 1, items: [], sourceComplete: true, snapshot: { context, complete: true, notes: [], evidence: {}, structure: { complete: true, issues: [] } } } as any
  let release!: (value: any) => void
  const read = vi.spyOn(runtime.suggestions, 'readWithSnapshot').mockImplementationOnce(() => new Promise(resolve => { release = resolve })).mockResolvedValue(value)
  vi.spyOn(runtime.reading, 'read').mockResolvedValue({ revision: 1, ready: true, complete: true, entries: [] })
  const first = runtime.read(directory), second = runtime.read(directory + '/')
  await vi.waitFor(() => expect(read).toHaveBeenCalledOnce())
  expect(resolveContext).toHaveBeenCalledOnce()
  release(value)
  expect(await Promise.all([first, second])).toEqual([expect.objectContaining({ revision: 1 }), expect.objectContaining({ revision: 1 })])
  read.mockRejectedValueOnce(Error('Source offline'))
  await expect(runtime.read(directory)).rejects.toThrow('Source offline')
  expect(await runtime.read(directory)).toMatchObject({ revision: 1 })
  expect(read).toHaveBeenCalledTimes(3)
})

it('does not replace newer branch activity with a delayed status restoration', async () => {
  const context = { repoId: '00000000-0000-4000-8000-000000000001', workspacePath: directory, branch: 'no-git' }
  const newerContext = { ...context, branch: 'detached:' + 'a'.repeat(40) }
  let release!: (value: typeof DEFAULT_BLUEPRINT_REVIEW_SETTINGS) => void
  const read = vi.spyOn(runtime.settings, 'read').mockImplementationOnce(() => new Promise(resolve => { release = resolve })).mockResolvedValue(DEFAULT_BLUEPRINT_REVIEW_SETTINGS)
  vi.spyOn(runtime.sources, 'context').mockResolvedValue(newerContext)
  const restoring = runtime.automatic.restoreRetries(context)
  try {
    await vi.waitFor(() => expect(read).toHaveBeenCalledOnce())
    await runtime.automatic.tick(directory)
  } finally { release(DEFAULT_BLUEPRINT_REVIEW_SETTINGS); await restoring }
  expect(runtime.automatic.activity(directory)?.context).toEqual(newerContext)
})

it('loads saved discovery records while source synchronization is blocked and isolates branches', async () => {
  const context = { repoId: '00000000-0000-4000-8000-000000000001', workspacePath: directory, branch: 'no-git' }
  const noteId = '00000000-0000-4000-8000-000000000002'
  vi.spyOn(runtime.sources, 'context').mockResolvedValue(context)
  vi.spyOn(runtime.automatic, 'watch').mockImplementation(() => {})
  const snapshot = { context, complete: true, notes: [{ noteId, hash: 'a'.repeat(64), path: '.agents/notes/module.md', kind: 'module', lifecycle: 'accepted' }], evidence: {} } as any
  await runtime.reading.read(context, snapshot)
  snapshot.notes[0].hash = 'b'.repeat(64)
  await runtime.reading.read(context, snapshot)
  runtime.store.mutate(context, state => { state.items.push({ noteId, reportRevision: 1, report: { findings: [{ summary: 'Saved suggestion' }] } } as any) })
  let release!: (value: any) => void
  const read = vi.spyOn(runtime.suggestions, 'readWithSnapshot').mockImplementation(() => new Promise(resolve => { release = resolve }))
  const scan = vi.spyOn(runtime.sources, 'capture')
  const active = runtime.read(directory)
  try {
    await vi.waitFor(() => expect(read).toHaveBeenCalledOnce())
    const saved = await runtime.readSaved(directory)
    expect(saved).toMatchObject({ sourcesPending: true, sourceComplete: false, updates: { ready: true, complete: false, entries: [{ noteId, unread: true }] } })
    expect(saved.items[0].report?.findings[0].summary).toBe('Saved suggestion')
    vi.mocked(runtime.sources.context).mockResolvedValue({ ...context, branch: 'other' })
    expect(await runtime.readSaved(directory)).toMatchObject({ items: [], updates: { ready: false, entries: [] } })
    expect(scan).not.toHaveBeenCalled()
  } finally {
    release({ ...runtime.store.read(context), sourceComplete: true, snapshot })
    await active
  }
})

it('publishes committed review results before scheduler completion without another source read', async () => {
  const context = { repoId: '00000000-0000-4000-8000-000000000001', workspacePath: directory, branch: 'no-git' }
  const noteId = '00000000-0000-4000-8000-000000000002'
  vi.spyOn(runtime.sources, 'context').mockResolvedValue(context)
  const scan = vi.spyOn(runtime.sources, 'capture')
  const item = { noteId, reportRevision: 2, report: { coverage: 'complete', findings: [] } } as any
  vi.spyOn(runtime.engine, 'review').mockImplementation(async () => {
    runtime.store.mutate(context, state => { state.items = [item] })
    return item
  })
  let release!: () => void
  const scheduler = vi.spyOn(runtime.automatic, 'manualSucceeded').mockImplementation(() => new Promise(resolve => { release = resolve }))
  const listener = vi.fn(), stop = runtime.onResultsChanged(listener)
  const running = runtime.run(directory, noteId)
  try {
    await vi.waitFor(() => expect(scheduler).toHaveBeenCalledOnce())
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ context, revision: 1, items: [item] }))
    expect(scan).not.toHaveBeenCalled()
    // Subscribers cannot mutate the persisted review state through a pushed object.
    listener.mock.calls[0][0].items.length = 0
    expect(runtime.store.read(context).items).toHaveLength(1)
  } finally { release(); await running; stop() }
})


it('expires a blocked backend observation, retries immediately and rejects its late persisted updates', async () => {
  const context = { repoId: '00000000-0000-4000-8000-000000000001', workspacePath: directory, branch: 'no-git' }
  vi.spyOn(runtime.sources, 'context').mockResolvedValue(context)
  vi.spyOn(runtime.automatic, 'restoreRetries').mockResolvedValue()
  vi.spyOn(runtime.automatic, 'watch').mockImplementation(() => {})
  const fresh = { context, complete: true, notes: [], evidence: {} } as any
  let release!: (value: any) => void
  const capture = vi.spyOn(runtime.sources, 'capture').mockImplementationOnce(() => new Promise(resolve => { release = resolve })).mockResolvedValue(fresh)
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  try {
    const failed = runtime.read(directory).catch(error => error.message)
    await vi.waitFor(() => expect(capture).toHaveBeenCalledOnce())
    await vi.advanceTimersByTimeAsync(12001)
    expect(await failed).toBe('BLUEPRINT_SYNC_TIMEOUT')
    expect(await runtime.read(directory)).toMatchObject({ sourceComplete: true, items: [], updates: { entries: [] } })
    const revision = runtime.store.read(context).revision
    const reading = await runtime.reading.readSaved(context)
    release({ ...fresh, notes: [{ noteId: '00000000-0000-4000-8000-000000000002', path: '.agents/notes/obsolete.md', hash: 'a'.repeat(64), kind: 'module', lifecycle: 'accepted' }] })
    await Promise.resolve(); await Promise.resolve()
    expect(runtime.store.read(context).revision).toBe(revision)
    expect(await runtime.reading.readSaved(context)).toEqual(reading)
    expect(capture).toHaveBeenCalledTimes(2)
  } finally { vi.useRealTimers(); release?.(fresh) }
})
