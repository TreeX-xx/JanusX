import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { environmentFixture } from '../helpers/superagent-environment-fixture'
import { writeRecordAtomic } from '../../src/main/janus/superagent/persistence'
import { createWorktree, removeWorktree } from '../../src/main/git/worktrees'
import type { SuperAgentGitOperation } from '../../src/shared/superagent-environment'

describe('SuperAgent controlled work environments', () => {
  let fixture: Awaited<ReturnType<typeof environmentFixture>>
  const scope = 'workspace-p2'
  beforeEach(async () => { fixture = await environmentFixture() })
  afterEach(async () => { vi.restoreAllMocks(); await fixture.dispose() })
  const decide = (operation: SuperAgentGitOperation, approved = true) => fixture.service.decide({ workspaceId: scope, operationId: operation.id, approved })
  it('reuses a parent checkout while preserving nested worktrees as protected paths', async () => {
    const nested = join(fixture.repo, 'artifacts', 'nested')
    await fixture.git(['worktree', 'add', '-b', 'nested', nested])
    const work = await fixture.work()
    await fixture.service.reuse(scope, { workId: work.id, path: fixture.repo, branch: 'main', includeChanges: true })
    const lease = await fixture.service.acquire(scope, work.id)
    expect(lease.checkout.path).toBe(fixture.repo)
    expect(lease.checkout.protectedPaths).toContain(nested)
    expect(await readFile(join(nested, 'feature.txt'), 'utf8')).toBe('initial\n')
  })
  async function assigned() {
    const work = await fixture.work()
    const plan = await fixture.service.proposeCreate(scope, { workId: work.id })
    expect((await decide(plan)).status).toBe('succeeded')
    const binding = (await fixture.service.store.snapshot(scope)).environments.find(row => row.workId === work.id)!
    return { work, binding }
  }

  it('creates only after a concrete approval, pins HEAD, and does not copy secrets or share dependencies', async () => {
    await writeFile(join(fixture.repo, '.env'), 'LOCAL_FIXTURE_SECRET')
    await mkdir(join(fixture.repo, 'node_modules'))
    const work = await fixture.work(), head = await fixture.git(['rev-parse', 'HEAD'])
    const operation = await fixture.service.proposeCreate(scope, { workId: work.id })
    expect(operation.plan).toMatchObject({ kind: 'create', baseRef: 'main', baseCommit: head, setup: 'isolated' })
    expect((await fixture.git(['worktree', 'list', '--porcelain'])).match(/worktree /g)).toHaveLength(1)
    expect((await fixture.service.store.snapshot(scope)).environments).toEqual([])
    const [first, duplicate] = await Promise.all([decide(operation), decide(operation)])
    expect(first.status).toBe('succeeded')
    expect(duplicate).toEqual(first)
    const { environments } = await fixture.service.store.snapshot(scope)
    expect(environments).toHaveLength(1)
    expect(environments[0].checkout.head).toBe(head)
    const files = await readdir(environments[0].checkout.path)
    for (const name of ['.env', 'node_modules']) expect(files).not.toContain(name)
    expect(await fixture.git(['symbolic-ref', '--short', 'HEAD'])).toBe('main')
    expect((await fixture.createService().store.snapshot(scope)).environments).toEqual(environments)
    expect((await fixture.store.workDetail(scope, work.id)).work).toMatchObject({ id: work.id, closedAt: null })
  })

  it('does nothing after rejection, including repeated or conflicting later decisions', async () => {
    const work = await fixture.work()
    const operation = await fixture.service.proposeCreate(scope, { workId: work.id })
    expect((await decide(operation, false)).status).toBe('rejected')
    expect((await decide(operation)).status).toBe('rejected')
    expect((await fixture.git(['worktree', 'list', '--porcelain'])).match(/worktree /g)).toHaveLength(1)
  })

  it.each(['expired', 'head', 'target', 'revision'])('requires a new approval when %s changes', async change => {
    const work = await fixture.work()
    const operation = await fixture.service.proposeCreate(scope, { workId: work.id })
    if (operation.plan.kind !== 'create') throw new Error('Expected create plan')
    if (change === 'expired') fixture.advance(15 * 60 * 1000)
    if (change === 'head') await fixture.commit(fixture.repo, 'Changed base\n')
    if (change === 'target') await mkdir(operation.plan.targetPath)
    if (change === 'revision') {
      const { input } = await fixture.store.receiveInput(fixture.workspace, { eventId: randomUUID(), workspaceId: scope, conversationId: 'chat', text: 'Supplement' })
      await fixture.store.routeInput(scope, input.id, work.id)
    }
    expect((await decide(operation)).status).toBe('stale')
    expect((await fixture.git(['worktree', 'list', '--porcelain'])).match(/worktree /g)).toHaveLength(1)
    expect((await fixture.service.store.snapshot(scope)).environments).toHaveLength(0)
  })

  it('does not silently select a different path when two approvals target the same branch', async () => {
    const [a, b] = await Promise.all([fixture.work(), fixture.work()])
    const plans = await Promise.all([a, b].map(work => fixture.service.proposeCreate(scope, { workId: work.id, branch: 'feature/shared' })))
    const results = await Promise.all(plans.map(plan => decide(plan)))
    expect(results.map(row => row.status)).toEqual(['succeeded', 'stale'])
    expect((await fixture.service.store.snapshot(scope)).environments).toHaveLength(1)
  })

  it('allocates distinct worktrees concurrently and never leases one checkout twice', async () => {
    const [a, b] = await Promise.all([fixture.work(), fixture.work()])
    const plans = await Promise.all([a, b].map(work => fixture.service.proposeCreate(scope, { workId: work.id })))
    expect((await Promise.all(plans.map(plan => decide(plan)))).every(row => row.status === 'succeeded')).toBe(true)
    const leases = await Promise.all([a, b].map(work => fixture.service.acquire(scope, work.id)))
    expect(leases[0].checkout.path).not.toBe(leases[1].checkout.path)
    await expect(fixture.service.acquire(scope, a.id)).rejects.toThrow('occupied')
    for (const lease of leases) await fixture.service.release(lease.id)
  })

  it('reuses only a matching clean unassigned checkout and preserves later changes belonging to that work', async () => {
    const path = join(fixture.root, 'existing')
    await fixture.git(['worktree', 'add', '-b', 'existing', path])
    const [a, b] = await Promise.all([fixture.work(), fixture.work()])
    await writeFile(join(path, 'unowned.txt'), 'unowned')
    await expect(fixture.service.reuse(scope, { workId: a.id, path, branch: 'existing' })).rejects.toThrow('uncommitted')
    await rm(join(path, 'unowned.txt'))
    const binding = await fixture.service.reuse(scope, { workId: a.id, path, branch: 'existing' })
    await writeFile(join(path, 'my-work.txt'), 'retained')
    expect(await fixture.service.reuse(scope, { workId: a.id, path, branch: 'existing' })).toEqual(binding)
    await expect(fixture.service.reuse(scope, { workId: b.id, path, branch: 'existing' })).resolves.toMatchObject({ workId: b.id })
    expect(await readFile(join(path, 'my-work.txt'), 'utf8')).toBe('retained')
    await expect(fixture.service.reuse(scope, { workId: a.id, path, branch: 'main' })).rejects.toThrow('does not match')
  })

  it('blocks known terminal occupancy and rechecks it after approval has been proposed', async () => {
    const { work, binding } = await assigned()
    const operation = await fixture.service.proposeRemove(scope, work.id)
    const alias = join(fixture.root, 'terminal-alias')
    await symlink(binding.checkout.path, alias, process.platform === 'win32' ? 'junction' : 'dir')
    fixture.occupied.push(alias)
    const lease = await fixture.service.acquire(scope, work.id)
    await fixture.service.release(lease.id)
    expect((await decide(operation)).status).toBe('stale')
    expect(await readFile(join(binding.checkout.path, 'feature.txt'), 'utf8')).toBe('initial\n')
  })

  it('rejects branch changes during execution and keeps the lease invalid even if the old branch returns', async () => {
    const { work, binding } = await assigned()
    const lease = await fixture.service.acquire(scope, work.id)
    await fixture.git(['checkout', '-b', 'changed'], binding.checkout.path)
    await expect(fixture.service.validateLease(lease.id)).rejects.toThrow('branch changed')
    await fixture.git(['checkout', binding.checkout.branch], binding.checkout.path)
    await expect(fixture.service.validateLease(lease.id)).rejects.toThrow('unavailable')
    await expect(fixture.service.acquire(scope, work.id)).rejects.toThrow('occupied')
    await fixture.service.release(lease.id)
    expect((await fixture.service.acquire(scope, work.id)).id).not.toBe(lease.id)
  })

  it('does not restore runtime leases or execute pending approvals when reopened', async () => {
    const { work } = await assigned()
    await fixture.service.acquire(scope, work.id)
    const other = await fixture.work()
    const pending = await fixture.service.proposeCreate(scope, { workId: other.id })
    await fixture.service.close()
    const reloaded = fixture.createService()
    expect((await reloaded.store.snapshot(scope)).operations.find(row => row.id === pending.id)?.status).toBe('pending')
    expect((await reloaded.acquire(scope, work.id)).workId).toBe(work.id)
    expect((await fixture.git(['worktree', 'list', '--porcelain'])).match(/worktree /g)).toHaveLength(2)
  })

  it('merges the reviewed commit into the reviewed branch without removing the source checkout', async () => {
    const { work, binding } = await assigned()
    await fixture.commit(binding.checkout.path, 'feature complete\n')
    const operation = await fixture.service.proposeMerge(scope, work.id)
    expect(operation.plan).toMatchObject({ kind: 'merge', target: { branch: 'main' }, source: { branch: binding.checkout.branch } })
    expect(await readFile(join(fixture.repo, 'feature.txt'), 'utf8')).toBe('initial\n')
    expect((await decide(operation)).status).toBe('succeeded')
    expect(await readFile(join(fixture.repo, 'feature.txt'), 'utf8')).toBe('feature complete\n')
    expect(await readFile(join(binding.checkout.path, 'feature.txt'), 'utf8')).toBe('feature complete\n')
  })

  it('retains unmerged branches and work history when an approved checkout is removed', async () => {
    const { work, binding } = await assigned()
    await fixture.commit(binding.checkout.path, 'unmerged feature\n')
    const operation = await fixture.service.proposeRemove(scope, work.id)
    expect(operation.plan).toMatchObject({ kind: 'remove', preserveBranch: true, force: false, unmergedCommits: 1 })
    expect((await decide(operation)).status).toBe('succeeded')
    expect(await fixture.git(['show', `${binding.checkout.branch}:feature.txt`])).toBe('unmerged feature')
    expect((await fixture.service.store.snapshot(scope)).environments[0].removedAt).not.toBeNull()
    expect((await fixture.store.workDetail(scope, work.id)).inputs).toHaveLength(1)
    expect((await decide(operation)).status).toBe('succeeded')
    await expect(fixture.service.acquire(scope, work.id)).rejects.toThrow('Assign an environment')
  })

  it('refuses dirty removal, active worker management and deletion of the workspace checkout', async () => {
    const { work, binding } = await assigned()
    const lease = await fixture.service.acquire(scope, work.id)
    await expect(fixture.service.proposeRemove(scope, work.id)).rejects.toThrow('occupied')
    await fixture.service.release(lease.id)
    await writeFile(join(binding.checkout.path, 'unsaved.txt'), 'do not discard')
    await expect(fixture.service.proposeRemove(scope, work.id)).rejects.toThrow('uncommitted')
    const mainWork = await fixture.work()
    await fixture.service.reuse(scope, { workId: mainWork.id, path: fixture.repo, branch: 'main' })
    await expect(fixture.service.proposeRemove(scope, mainWork.id)).rejects.toThrow('distinct worktree')
  })

  it('records merge conflicts without silently aborting or retrying', async () => {
    const { work, binding } = await assigned()
    await fixture.commit(binding.checkout.path, 'feature-side\n')
    await fixture.commit(fixture.repo, 'main-side\n')
    const operation = await fixture.service.proposeMerge(scope, work.id)
    expect((await decide(operation)).status).toBe('failed')
    expect(await fixture.git(['diff', '--name-only', '--diff-filter=U'])).toBe('feature.txt')
    expect((await decide(operation)).status).toBe('failed')
    await expect(fixture.service.proposeMerge(scope, work.id)).rejects.toThrow('unfinished Git')
  })

  it('rejects cross-workspace decisions, forged targets and moved workspace registrations', async () => {
    const work = await fixture.work()
    const operation = await fixture.service.proposeCreate(scope, { workId: work.id })
    await expect(fixture.service.decide({ workspaceId: 'other', operationId: operation.id, approved: true })).rejects.toThrow('not found')
    await expect(fixture.service.decide({ workspaceId: scope, operationId: operation.id, approved: true, targetPath: fixture.root })).rejects.toThrow()
    fixture.registeredPath(fixture.root)
    expect((await decide(operation)).status).toBe('stale')
  })

  it('never executes Git when saving the approval fails', async () => {
    let writes = 0
    const effects = { create: vi.fn(), merge: vi.fn(), remove: vi.fn() }
    const service = fixture.createService(async (path, text) => {
      if (++writes === 2) throw new Error('disk full')
      await writeRecordAtomic(path, text)
    }, effects)
    const work = await fixture.work()
    const operation = await service.proposeCreate(scope, { workId: work.id })
    await expect(service.decide({ workspaceId: scope, operationId: operation.id, approved: true })).rejects.toThrow('disk full')
    expect(effects.create).not.toHaveBeenCalled()
    expect((await service.store.snapshot(scope)).operations[0].status).toBe('pending')
  })

  it('preserves uncertain post-Git results across reopening and never replays approval', async () => {
    let writes = 0
    const service = fixture.createService(async (path, text) => {
      if (++writes === 3) throw new Error('result persistence failed')
      await writeRecordAtomic(path, text)
    })
    const work = await fixture.work()
    const operation = await service.proposeCreate(scope, { workId: work.id })
    await expect(service.decide({ workspaceId: scope, operationId: operation.id, approved: true })).rejects.toThrow('result persistence failed')
    await service.close()
    const reloaded = fixture.createService()
    expect((await reloaded.store.snapshot(scope)).operations[0].status).toBe('unknown')
    expect((await reloaded.decide({ workspaceId: scope, operationId: operation.id, approved: true })).status).toBe('unknown')
    expect((await fixture.git(['worktree', 'list', '--porcelain'])).match(/worktree /g)).toHaveLength(2)
    expect((await reloaded.store.snapshot(scope)).environments).toEqual([])
  })

  it('adds isolated options without changing legacy manual dependency sharing and branch deletion', async () => {
    await mkdir(join(fixture.repo, 'node_modules'))
    await writeFile(join(fixture.repo, '.env'), 'manual fixture config')
    const created = await createWorktree(fixture.repo, { name: 'manual', branch: 'manual', startFrom: 'HEAD' })
    expect(created.shared).toContain('node_modules')
    expect(created.copied).toContain('.env')
    const removed = await removeWorktree(fixture.repo, created.worktree.path)
    expect(removed.branchDeleted).toBe(true)
  })

  it('preserves damaged or future-version environment records without executing or resetting them', async () => {
    const work = await fixture.work()
    await fixture.service.proposeCreate(scope, { workId: work.id })
    await fixture.service.close()
    const original = JSON.parse(await readFile(fixture.service.store.path, 'utf8'))
    const broken = JSON.stringify({ ...original, version: 999 })
    await writeFile(fixture.service.store.path, broken)
    const service = fixture.createService()
    await expect(service.store.snapshot(scope)).rejects.toThrow('original preserved')
    await expect(service.proposeCreate(scope, { workId: work.id })).rejects.toThrow('original preserved')
    expect(await readFile(fixture.service.store.path, 'utf8')).toBe(broken)
  })

  it('rejects nested directory ownership in persisted bindings', async () => {
    const { binding } = await assigned()
    await fixture.service.close()
    const data = JSON.parse(await readFile(fixture.service.store.path, 'utf8'))
    data.environments.push({ ...binding, id: randomUUID(), workId: randomUUID(), checkout: { ...binding.checkout, path: join(binding.checkout.path, 'nested') } })
    await writeFile(fixture.service.store.path, JSON.stringify(data))
    await expect(fixture.createService().store.snapshot(scope)).rejects.toThrow('original preserved')
  })

  it('revalidates the reviewed source commit before merging and shows ignored files before removal', async () => {
    const { work, binding } = await assigned()
    await fixture.commit(binding.checkout.path, 'first result\n')
    const merge = await fixture.service.proposeMerge(scope, work.id)
    await fixture.commit(binding.checkout.path, 'second result\n')
    expect((await decide(merge)).status).toBe('stale')
    expect(await readFile(join(fixture.repo, 'feature.txt'), 'utf8')).toBe('initial\n')
    await writeFile(join(binding.checkout.path, '.env'), 'private local configuration')
    const removal = await fixture.service.proposeRemove(scope, work.id)
    expect(removal.plan.source.ignoredEntries).toContain('.env')
    expect((await decide(removal, false)).status).toBe('rejected')
    expect(await readFile(join(binding.checkout.path, '.env'), 'utf8')).toBe('private local configuration')
  })

  it('does not follow a workspace alias retargeted to another checkout of the same repository', async () => {
    const alias = join(fixture.root, 'workspace-alias')
    const linkType = process.platform === 'win32' ? 'junction' : 'dir'
    await symlink(fixture.repo, alias, linkType)
    fixture.workspace.workspacePath = alias
    fixture.registeredPath(alias)
    const { work, binding } = await assigned()
    expect(binding.workspacePath).toBe(fixture.repo)
    await rename(alias, join(fixture.root, 'original-alias'))
    await symlink(binding.checkout.path, alias, linkType)
    await expect(fixture.service.acquire(scope, work.id)).rejects.toThrow('Workspace directory changed')
    await expect(fixture.service.proposeMerge(scope, work.id)).rejects.toThrow('Workspace directory changed')
  })
})
