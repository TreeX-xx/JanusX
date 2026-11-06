import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { SuperAgentContext } from '../../src/main/janus/superagent/context'
import { SuperAgentLifecycleStore } from '../../src/main/janus/superagent/lifecycle-store'
import { environmentFixture } from '../helpers/superagent-environment-fixture'

describe('work-card environment evidence', () => {
  it('blocks real checkout reuse after restart until a durable owned stop is confirmed', async () => {
    const f = await environmentFixture(), scope = f.workspace.workspaceId
    try {
      const work = await f.work(), other = await f.work(), executionId = randomUUID()
      await f.service.reuse(scope, { workId: work.id, path: f.repo, branch: 'main' })
      const before = await f.git(['rev-parse', 'HEAD']), lifecycle = new SuperAgentLifecycleStore(f.root)
      await lifecycle.begin({ workspaceId: scope, workId: work.id, executionId, instanceId: randomUUID(), conversationId: 'chat', cwd: f.repo,
        phase: 'running', stopConfirmed: false, updatedAt: 1000 })
      const reopened = new SuperAgentLifecycleStore(f.root), environments = f.createService()
      environments.setExecutionGuard(async () => (await reopened.snapshot()).filter(row => !row.stopConfirmed).map(row => row.cwd))
      await expect(environments.acquire(scope, work.id)).rejects.toThrow('no confirmed stop')
      await expect(environments.reuse(scope, { workId: other.id, path: f.repo, branch: 'main' })).rejects.toThrow('already assigned')
      // This is the explicit process-receipt seam; production only writes it after owned tree settlement.
      await reopened.update(work.id, executionId, { phase: 'stopped', stopConfirmed: true, updatedAt: 2000 })
      const lease = await environments.acquire(scope, work.id); await environments.release(lease.id)
      expect(await f.git(['rev-parse', 'HEAD'])).toBe(before)
      expect((await f.store.workDetail(scope, work.id)).work.closedAt).toBeNull()
    } finally { await f.dispose() }
  })

  it('reads the actual branch and HEAD without rewriting historical bindings or treating old code evidence as current', async () => {
    const f = await environmentFixture(), scope = f.workspace.workspaceId
    try {
      const work = await f.work(), context = new SuperAgentContext(f.store, f.service)
      await f.service.reuse(scope, { workId: work.id, path: f.repo, branch: 'main' })
      const before = await context.card(scope, work.id)
      await f.git(['checkout', '-b', 'current-version']); await f.commit(f.repo, 'Current code\n')
      const after = await context.card(scope, work.id)
      expect(after.checkout.recorded).toEqual(before.checkout.recorded)
      expect(after.checkout.current).toMatchObject({ status: 'available', branch: 'current-version', head: await f.git(['rev-parse', 'HEAD']) })
      expect(after.checkout.current.head).not.toBe(after.checkout.recorded?.head)
      expect(after.environment?.checkout.branch).toBe('main')
      expect((await f.store.workDetail(scope, work.id)).executions).toEqual([])
      await context.close()
    } finally { await f.dispose() }
  })
})
