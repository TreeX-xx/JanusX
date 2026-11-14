import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { environmentFixture } from '../helpers/superagent-environment-fixture'
import { SuperAgentService } from '../../src/main/janus/superagent/service'
import { inspectCheckout } from '../../src/main/git/controlled-worktree'
import { preparePublish, executePublish } from '@janus-agent/janus-agent/superagent/git/controlled-publish'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })
async function setup() {
  const f = await environmentFixture(); cleanups.push(f.dispose)
  const service = new SuperAgentService(f.store, async () => f.repo, f.service)
  async function prepare(selection?: object) {
    const base = await f.work()
    const work = selection ? await f.store.selectEnvironment(f.workspace.workspaceId, base.id, base.revision, selection) : base
    const operation = await (service as any).prepareEnvironment(work)
    return { work, operation, environment: (await f.service.store.snapshot(f.workspace.workspaceId)).environments.find(row => row.workId === work.id && row.releasedAt === undefined) }
  }
  return { ...f, service, prepare }
}
describe('checkout selection and publish scope', () => {
  it('distinguishes equal committed HEADs from existing tracked and untracked workspace changes without mutations', async () => {
    const f = await setup(), path = join(f.root, 'isolated')
    await f.git(['worktree', 'add', '-b', 'janus-release', path])
    await writeFile(join(f.repo, 'feature.txt'), 'modified dev content')
    await writeFile(join(f.repo, 'new-feature.txt'), 'untracked dev content')
    const before = await f.git(['status', '--porcelain=v1', '--untracked-files=all'])
    const ledger = await f.service.environmentSnapshot(f.workspace.workspaceId)
    const result = await f.service.inspectEnvironments(f.workspace.workspaceId)
    expect(result.workspace).toMatchObject({ path: f.repo, branch: 'main', dirty: true })
    expect(result.checkouts).toEqual(expect.arrayContaining([
      expect.objectContaining({ path, branch: 'janus-release', head: result.workspace.head, dirty: false }),
    ]))
    expect(result.policy).toContain('Equal HEADs')
    expect(await f.git(['status', '--porcelain=v1', '--untracked-files=all'])).toBe(before)
    expect(await f.service.environmentSnapshot(f.workspace.workspaceId)).toEqual(ledger)
    await expect(f.service.inspectEnvironments(f.workspace.workspaceId, randomUUID())).rejects.toThrow('not found')
  })

  it('reassigns unqualified existing-change adoption from an old isolated checkout to the workspace', async () => {
    const f = await setup(), path = join(f.root, 'old-isolated')
    await f.git(['worktree', 'add', '-b', 'old-isolated', path])
    const first = await f.prepare({ path })
    await writeFile(join(f.repo, 'new-feature.txt'), 'user changes to adopt')
    const selection = { includeChanges: true }
    await f.service.environments!.validateSelection(f.workspace.workspaceId, first.work.id, selection)
    const work = await f.store.selectEnvironment(f.workspace.workspaceId, first.work.id, first.work.revision, selection)
    expect(await (f.service as any).prepareEnvironment(work)).toBeUndefined()
    const result = await f.service.inspectEnvironments(f.workspace.workspaceId, first.work.id)
    expect(result.assigned?.path).toBe(f.repo)
    expect(await readFile(join(f.repo, 'new-feature.txt'), 'utf8')).toBe('user changes to adopt')
    const rows = (await f.service.environmentSnapshot(f.workspace.workspaceId)).environments
    expect(rows[0]).toMatchObject({ releasedAt: expect.any(Number), removedAt: null })
    expect(rows[1].checkout.path).toBe(f.repo)
    expect(await f.git(['worktree', 'list', '--porcelain'])).toContain(path.replaceAll('\\', '/'))
  })

  it('blocks a persisted branch mismatch instead of launching the old assigned checkout', async () => {
    const f = await setup(), first = await f.prepare()
    const work = await f.store.selectEnvironment(f.workspace.workspaceId, first.work.id, first.work.revision, { branch: 'dev', includeChanges: true })
    await expect((f.service as any).prepareEnvironment(work)).rejects.toThrow('Assigned checkout does not match')
    expect((await f.service.inspectEnvironments(f.workspace.workspaceId, work.id)).assigned?.branch).toBe('main')
    expect((await f.service.environmentSnapshot(f.workspace.workspaceId)).operations).toEqual([])
  })

  it('uses the requested branch checkout and preserves explicitly adopted changes without creating a worktree', async () => {
    const f = await setup(), path = join(f.root, 'existing-dev')
    await f.git(['worktree', 'add', '-b', 'dev', path])
    await writeFile(join(path, 'feature.txt'), 'existing changes')
    const before = await f.git(['worktree', 'list', '--porcelain'])
    const result = await f.prepare({ branch: 'dev', includeChanges: true })
    expect(result.operation).toBeUndefined(); expect(result.environment?.checkout.path).toBe(path)
    expect(await readFile(join(path, 'feature.txt'), 'utf8')).toBe('existing changes')
    expect(await f.git(['worktree', 'list', '--porcelain'])).toBe(before)
  })
  it('does not substitute a worktree when an explicit target is busy or dirty', async () => {
    const f = await setup(); f.service.environments!.setExecutionGuard(async () => [f.repo])
    await expect(f.prepare({ path: f.repo })).rejects.toThrow('occupied')
    f.service.environments!.setExecutionGuard(async () => []); await writeFile(join(f.repo, 'feature.txt'), 'existing')
    await expect(f.prepare()).rejects.toThrow('includeChanges')
    expect((await f.service.environmentSnapshot(f.workspace.workspaceId)).operations).toEqual([])
  })
  it('finds an existing clean candidate when the current clean checkout is occupied', async () => {
    const f = await setup(), path = join(f.root, 'available')
    await f.git(['worktree', 'add', '-b', 'available', path]); f.service.environments!.setExecutionGuard(async () => [f.repo])
    const result = await f.prepare()
    expect(result.environment?.checkout.path).toBe(path); expect(result.operation).toBeUndefined()
  })
  it('reuses a closed assignment without deleting its checkout or history', async () => {
    const f = await setup(), first = await f.prepare()
    await f.store.controlWork(f.workspace.workspaceId, first.work.id, first.work.revision, 'close')
    const second = await f.prepare()
    expect(second.environment?.checkout.path).toBe(f.repo)
    const records = await f.service.environmentSnapshot(f.workspace.workspaceId)
    expect(records.environments[0]).toMatchObject({ removedAt: null, releasedAt: expect.any(Number) })
  })
  it('creates tags and non-force pushes only the pinned branch/tag, and detects changed destinations', async () => {
    const f = await setup(), remote = join(f.root, 'remote.git')
    await mkdir(remote); await f.git(['init', '--bare'], remote); await f.git(['remote', 'add', 'origin', remote])
    const checkout = await inspectCheckout(f.repo)
    const tag = await preparePublish(checkout, { requestId: randomUUID(), kind: 'tag', tag: 'v0.9.9' })
    await executePublish(checkout, tag)
    await expect(executePublish(checkout, tag)).rejects.toThrow('already exists')
    const branch = await preparePublish(checkout, { requestId: randomUUID(), kind: 'push' })
    await executePublish(checkout, branch)
    const pushTag = await preparePublish(checkout, { requestId: randomUUID(), kind: 'push', tag: 'v0.9.9' })
    await executePublish(checkout, pushTag)
    expect(await f.git(['rev-parse', 'refs/heads/main'], remote)).toBe(checkout.head)
    expect(await f.git(['rev-parse', 'refs/tags/v0.9.9'], remote)).toBe(checkout.head)
    await f.git(['remote', 'set-url', '--push', 'origin', join(f.root, 'other.git')])
    await expect(executePublish(checkout, branch)).rejects.toThrow('destination changed')
  })
})

it('reassigns an idle work explicitly while preserving its old directory and historical binding', async () => {
  const f = await setup(), first = await f.prepare(), path = join(f.root, 'alternate')
  await f.git(['worktree', 'add', '-b', 'alternate', path])
  await f.service.environments!.validateSelection(f.workspace.workspaceId, first.work.id, { path })
  const work = await f.store.selectEnvironment(f.workspace.workspaceId, first.work.id, first.work.revision, { path })
  await (f.service as any).prepareEnvironment(work)
  const rows = (await f.service.environmentSnapshot(f.workspace.workspaceId)).environments
  expect(rows[0]).toMatchObject({ releasedAt: expect.any(Number), removedAt: null })
  expect(rows[1].checkout.path).toBe(path)
  expect(await readFile(join(f.repo, 'feature.txt'), 'utf8')).toBe('initial\n')
})
