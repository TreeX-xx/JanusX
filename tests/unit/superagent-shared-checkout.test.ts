import { expect, it } from 'vitest'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { environmentFixture } from '../helpers/superagent-environment-fixture'

it('shares a checkout with terminals and peer leases, preserves edits and coordinates host commits', async () => {
  const f = await environmentFixture(), scope = f.workspace.workspaceId
  try {
    const a = await f.work(), b = await f.work()
    f.occupied.push(f.repo)
    await f.service.reuse(scope, { workId: a.id, path: f.repo, branch: 'main' })
    const first = await f.service.acquire(scope, a.id)
    await writeFile(join(f.repo, 'peer.txt'), 'preserve peer changes')
    await f.service.reuse(scope, { workId: b.id, path: f.repo, branch: 'main' })
    const second = await f.service.acquire(scope, b.id)
    expect((await f.service.store.snapshot(scope)).environments).toHaveLength(2)
    await expect(f.service.acquire(scope, a.id)).rejects.toThrow('occupied')
    const head = await f.service.commit(first.id, first.checkout.head, async () => {
      await f.git(['add', 'peer.txt']); await f.git(['commit', '-m', 'shared commit fixture'])
      return f.git(['rev-parse', 'HEAD'])
    })
    expect((await f.service.validateLease(second.id)).checkout.head).toBe(head)
    f.service.setExecutionGuard(async () => [f.repo])
    const c = await f.work()
    await expect(f.service.reuse(scope, { workId: c.id, path: f.repo, branch: 'main' })).rejects.toThrow('no confirmed stop')
  } finally { await f.dispose() }
}, 30000)
