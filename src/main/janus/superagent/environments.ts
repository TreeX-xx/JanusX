import { randomUUID } from 'node:crypto'
import { basename, dirname, join } from 'node:path'
import { SerialQueue } from '../../lib/atomic-file'
import { createWorktree, removeWorktree, slugifyWorktreeName } from '../../git/worktrees'
import {
  absentTarget, canonicalDirectory, controlledGit, inspectCheckout, mergeControlledWorktree,
  overlaps, resolveCommit, sameLocation, validateNewBranch,
} from '../../git/controlled-worktree'
import type { SuperAgentCheckout, SuperAgentEnvironment, SuperAgentGitOperation, SuperAgentGitPlan } from '../../../shared/superagent-environment'
import type { SuperAgentWork } from '../../../shared/superagent'
import { createEnvironmentSchema, environmentDecisionSchema, reuseEnvironmentSchema } from './environment-schema'
import { SuperAgentEnvironmentStore } from './environment-store'
import { SuperAgentStore } from './store'
import { identity } from './schema'

const APPROVAL_LIFETIME_MS = 15 * 60 * 1000
/** A different environment may be proposed for a real ownership/occupancy conflict, never for arbitrary I/O failures. */
export class SuperAgentEnvironmentUnavailable extends Error {}
export interface SuperAgentEnvironmentLease {
  id: string
  workspaceId: string
  workId: string
  workspacePath: string
  environmentId: string
  checkout: SuperAgentCheckout
}

export interface SuperAgentGitEffects {
  create(root: string, targetPath: string, branch: string, baseCommit: string): Promise<void>
  merge(source: SuperAgentCheckout, target: SuperAgentCheckout): Promise<void>
  remove(root: string, targetPath: string): Promise<void>
}
const gitEffects: SuperAgentGitEffects = {
  create: async (root, targetPath, branch, baseCommit) => {
    await createWorktree(root, { name: branch, branch, startFrom: baseCommit }, undefined, { mode: 'isolated', targetPath })
  },
  merge: mergeControlledWorktree,
  remove: async (root, targetPath) => { await removeWorktree(root, targetPath, false, null, { mode: 'worktree-only' }) },
}

function assertUsable(checkout: SuperAgentCheckout): void {
  if (checkout.locked || checkout.operationInProgress) throw new Error('Environment is locked or has an unfinished Git operation')
}
function assertIdentity(expected: SuperAgentCheckout, actual: SuperAgentCheckout): void {
  if (!sameLocation(expected.path, actual.path) || !sameLocation(expected.commonDir, actual.commonDir)
    || !sameLocation(expected.gitDir, actual.gitDir) || expected.repositoryIdentity !== actual.repositoryIdentity
    || expected.directoryIdentity !== actual.directoryIdentity || expected.branch !== actual.branch) {
    throw new Error('Environment repository, directory or branch changed; reassignment requires an explicit decision')
  }
  assertUsable(actual)
}

/** Host-only planner. Approval is a separate renderer decision about the exact persisted plan. */
export class SuperAgentEnvironments {
  private readonly queue = new SerialQueue()
  private readonly leases = new Map<string, SuperAgentEnvironmentLease>()
  private readonly invalidLeases = new Set<string>()
  private closing = false
  private executionGuard?: () => Promise<readonly string[]>

  constructor(
    readonly store: SuperAgentEnvironmentStore,
    private readonly works: SuperAgentStore,
    private readonly resolveWorkspaceRoot: (workspaceId: string) => Promise<string | undefined>,
    private readonly occupiedPaths: () => readonly string[] = () => [],
    private readonly now = Date.now,
    private readonly effects: SuperAgentGitEffects = gitEffects,
  ) {}

  setExecutionGuard(read: () => Promise<readonly string[]>): void { this.executionGuard = read }

  private run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.closing) return Promise.reject(new Error('SuperAgent environments are closing'))
    return this.queue.run(operation)
  }

  private async work(workspaceId: string, workId: string, revision?: number): Promise<SuperAgentWork> {
    const { work } = await this.works.workDetail(identity.parse(workspaceId), identity.parse(workId))
    if (work.closedAt !== null || (revision !== undefined && work.revision !== revision)) throw new Error('Work changed or closed; propose the operation again')
    const registered = await this.resolveWorkspaceRoot(workspaceId)
    if (!registered || !sameLocation(await canonicalDirectory(registered), await canonicalDirectory(work.workspacePath))) {
      throw new Error('Registered workspace no longer matches the work origin')
    }
    return work
  }

  private async idle(path: string): Promise<void> {
    const occupiedPaths = await Promise.all(this.occupiedPaths().map(async occupied => {
      try { return await canonicalDirectory(occupied) } catch { return occupied }
    }))
    const guarded = await this.executionGuard?.() ?? []
    if (guarded.some(occupied => overlaps(occupied, path))) throw new SuperAgentEnvironmentUnavailable('A previous managed execution has no confirmed stop; this environment remains occupied')
    if ([...this.leases.values()].some(lease => overlaps(lease.checkout.path, path))
      || occupiedPaths.some(occupied => overlaps(occupied, path))) throw new SuperAgentEnvironmentUnavailable('Environment is occupied by an active worker or terminal')
  }

  private async available(path: string, workId: string): Promise<void> {
    const data = await this.store.read()
    if (data.environments.some(row => row.removedAt === null && row.workId !== workId && overlaps(row.checkout.path, path))) {
      throw new SuperAgentEnvironmentUnavailable('Environment is already assigned to another work')
    }
    await this.idle(path)
  }

  private async binding(workspaceId: string, workId: string): Promise<SuperAgentEnvironment | undefined> {
    return (await this.store.read()).environments.find(row => row.workspaceId === workspaceId && row.workId === workId && row.removedAt === null)
  }

  private environment(work: SuperAgentWork, checkout: SuperAgentCheckout, baseRef: string, baseCommit: string, workspacePath: string): SuperAgentEnvironment {
    return { id: randomUUID(), workspaceId: work.workspaceId, workId: work.id, workspacePath,
      checkout, baseRef, baseCommit, createdAt: this.now(), removedAt: null }
  }

  async reuse(workspaceId: string, value: unknown): Promise<SuperAgentEnvironment> {
    const scope = identity.parse(workspaceId), input = reuseEnvironmentSchema.parse(value)
    return this.run(async () => {
      const work = await this.work(scope, input.workId)
      const [origin, checkout, existing] = await Promise.all([inspectCheckout(work.workspacePath), inspectCheckout(input.path), this.binding(scope, work.id)])
      if (checkout.repositoryIdentity !== origin.repositoryIdentity || checkout.branch !== input.branch) throw new Error('Checkout does not match the requested repository and branch')
      assertUsable(checkout)
      if (existing) {
        if (!sameLocation(existing.workspacePath, origin.path)) throw new Error('Workspace directory changed after environment assignment')
        assertIdentity(existing.checkout, checkout)
        // Existing work keeps its own uncommitted files; no reset, copy or checkout is performed.
        return existing
      }
      if (checkout.dirty) throw new Error('Unassigned checkout has uncommitted files; resolve ownership before reuse')
      await this.available(checkout.path, work.id)
      await this.work(scope, work.id, work.revision)
      const environment = this.environment(work, checkout, checkout.branch, checkout.head, origin.path)
      return this.store.update(scope, draft => { draft.environments.push(environment); return environment })
    })
  }

  async proposeCreate(workspaceId: string, value: unknown): Promise<SuperAgentGitOperation> {
    const scope = identity.parse(workspaceId), input = createEnvironmentSchema.parse(value)
    return this.run(async () => {
      const work = await this.work(scope, input.workId)
      if (await this.binding(scope, work.id)) throw new Error('Work already has an environment; reuse it')
      const source = await inspectCheckout(work.workspacePath)
      assertUsable(source)
      const branch = input.branch ?? `janus/${work.id.slice(0, 8)}`
      const baseRef = input.baseRef ?? source.branch
      const baseCommit = await resolveCommit(source.path, baseRef)
      await validateNewBranch(source.path, branch)
      // One concrete path. A collision requires a new proposal, never an unapproved numeric suffix.
      const targetPath = await absentTarget(join(dirname(source.path), `${basename(source.path)}-${slugifyWorktreeName(branch).replaceAll('/', '-')}`))
      await this.available(targetPath, work.id)
      return this.proposal(work, { kind: 'create', source, targetPath, branch, baseRef, baseCommit, setup: 'isolated' })
    })
  }

  async proposeMerge(workspaceId: string, workId: string): Promise<SuperAgentGitOperation> {
    return this.proposeExisting(workspaceId, workId, 'merge')
  }

  async proposeRemove(workspaceId: string, workId: string): Promise<SuperAgentGitOperation> {
    return this.proposeExisting(workspaceId, workId, 'remove')
  }

  private proposeExisting(workspaceId: string, workId: string, kind: 'merge' | 'remove') {
    const scope = identity.parse(workspaceId), id = identity.parse(workId)
    return this.run(async () => {
      const work = await this.work(scope, id), environment = await this.binding(scope, id)
      if (!environment) throw new Error('Work has no assigned environment')
      const source = await inspectCheckout(environment.checkout.path), target = await inspectCheckout(work.workspacePath)
      if (!sameLocation(environment.workspacePath, target.path)) throw new Error('Workspace directory changed after environment assignment')
      assertIdentity(environment.checkout, source)
      assertUsable(target)
      if (source.repositoryIdentity !== target.repositoryIdentity || sameLocation(source.path, target.path) || source.branch === target.branch) {
        throw new Error('Operation requires a distinct worktree in the work repository')
      }
      await this.idle(source.path)
      if (source.dirty) throw new Error('Worktree has uncommitted files; resolve them before this operation')
      if (kind === 'merge') {
        await this.idle(target.path)
        if (target.dirty) throw new Error('Merge target has uncommitted files')
        return this.proposal(work, { kind, source, target, environmentId: environment.id, strategy: 'no-ff' })
      }
      const count = Number((await controlledGit(target.path, ['rev-list', '--count', `${target.head}..${source.head}`])).trim())
      return this.proposal(work, { kind, source, target, environmentId: environment.id, unmergedCommits: count, preserveBranch: true, force: false })
    })
  }

  private async proposal(work: SuperAgentWork, plan: SuperAgentGitPlan): Promise<SuperAgentGitOperation> {
    await this.work(work.workspaceId, work.id, work.revision)
    const operation: SuperAgentGitOperation = { id: randomUUID(), workspaceId: work.workspaceId, workId: work.id,
      workRevision: work.revision, plan, createdAt: this.now(), expiresAt: this.now() + APPROVAL_LIFETIME_MS,
      status: 'pending', decidedAt: null, finishedAt: null, message: null }
    return this.store.update(work.workspaceId, draft => { draft.operations.push(operation); return operation })
  }

  private async revalidate(operation: SuperAgentGitOperation): Promise<SuperAgentWork> {
    if (this.now() >= operation.expiresAt) throw new Error('Approval expired; propose the operation again')
    const work = await this.work(operation.workspaceId, operation.workId, operation.workRevision)
    const plan = operation.plan, source = await inspectCheckout(plan.source.path)
    if (JSON.stringify(source) !== JSON.stringify(plan.source)) throw new Error('Reviewed repository state changed; propose the operation again')
    if (plan.kind === 'create') {
      if (await this.binding(work.workspaceId, work.id)) throw new Error('Work already has an environment')
      if (!sameLocation(await canonicalDirectory(work.workspacePath), source.path)) throw new Error('Workspace target changed')
      if (!sameLocation(await absentTarget(plan.targetPath), plan.targetPath)) throw new Error('Target parent changed')
      if (await resolveCommit(source.path, plan.baseRef) !== plan.baseCommit) throw new Error('Base reference moved')
      await validateNewBranch(source.path, plan.branch)
      await this.available(plan.targetPath, work.id)
    } else {
      const environment = await this.binding(work.workspaceId, work.id)
      if (!environment || environment.id !== plan.environmentId) throw new Error('Environment binding changed')
      assertIdentity(environment.checkout, source)
      const target = await inspectCheckout(plan.target.path)
      if (!sameLocation(await canonicalDirectory(work.workspacePath), target.path) || JSON.stringify(target) !== JSON.stringify(plan.target)) {
        throw new Error('Reviewed target changed; propose the operation again')
      }
      await this.idle(source.path)
      if (plan.kind === 'merge') await this.idle(target.path)
    }
    return work
  }

  /** Accept only an operation identity and a user decision; never a replacement path or branch. */
  async decide(value: unknown): Promise<SuperAgentGitOperation> {
    const input = environmentDecisionSchema.parse(value)
    return this.run(async () => {
      const operation = (await this.store.read()).operations.find(row => row.id === input.operationId && row.workspaceId === input.workspaceId)
      if (!operation) throw new Error('Git operation not found in workspace')
      if (operation.status !== 'pending') return operation
      const finish = (status: SuperAgentGitOperation['status'], message: string | null = null) => this.store.update(input.workspaceId, draft => {
        const record = draft.operations.find(row => row.id === operation.id)!
        Object.assign(record, { status, decidedAt: this.now(), finishedAt: this.now(), message })
        return record
      })
      if (!input.approved) return finish('rejected')
      let work: SuperAgentWork
      try { work = await this.revalidate(operation) } catch (error) { return finish('stale', String(error)) }
      // Commit the user decision BEFORE Git. A crash is uncertain, never permission to replay.
      await this.store.update(input.workspaceId, draft => {
        const record = draft.operations.find(row => row.id === operation.id)!
        record.status = 'executing'; record.decidedAt = this.now()
      })
      const plan = operation.plan
      let environment: SuperAgentEnvironment | undefined
      try {
        if (plan.kind === 'create') {
          await this.effects.create(plan.source.path, plan.targetPath, plan.branch, plan.baseCommit)
          const checkout = await inspectCheckout(plan.targetPath)
          if (checkout.repositoryIdentity !== plan.source.repositoryIdentity || checkout.branch !== plan.branch || checkout.head !== plan.baseCommit) {
            throw new Error('Created environment does not match the approved plan; inspect it before continuing')
          }
          environment = this.environment(work, checkout, plan.baseRef, plan.baseCommit, plan.source.path)
        } else if (plan.kind === 'merge') await this.effects.merge(plan.source, plan.target)
        else await this.effects.remove(plan.target.path, plan.source.path)
      } catch (error) {
        return finish('failed', `Git operation did not complete cleanly. Inspect the repository; no automatic retry or rollback. ${String(error)}`)
      }
      // If this write fails, retain executing/unknown; never undo a completed Git operation implicitly.
      return this.store.update(input.workspaceId, draft => {
        if (environment) draft.environments.push(environment)
        if (plan.kind === 'remove') draft.environments.find(row => row.id === plan.environmentId)!.removedAt = this.now()
        const record = draft.operations.find(row => row.id === operation.id)!
        record.status = 'succeeded'; record.finishedAt = this.now()
        return record
      })
    })
  }

  async acquire(workspaceId: string, workId: string): Promise<SuperAgentEnvironmentLease> {
    const scope = identity.parse(workspaceId), id = identity.parse(workId)
    return this.run(async () => {
      const work = await this.work(scope, id)
      const binding = await this.binding(scope, id)
      if (!binding) throw new Error('Assign an environment before starting a worker')
      if (!sameLocation(await canonicalDirectory(work.workspacePath), binding.workspacePath)) throw new Error('Workspace directory changed after environment assignment')
      const checkout = await inspectCheckout(binding.checkout.path)
      assertIdentity(binding.checkout, checkout)
      await this.available(checkout.path, id)
      await this.work(scope, id, work.revision)
      const lease = { id: randomUUID(), workspaceId: scope, workspacePath: binding.workspacePath, workId: id, environmentId: binding.id, checkout }
      this.leases.set(lease.id, lease)
      return structuredClone(lease)
    })
  }

  validateLease(leaseId: string): Promise<SuperAgentEnvironmentLease> {
    return this.run(async () => {
      const lease = this.leases.get(identity.parse(leaseId))
      if (!lease || this.invalidLeases.has(leaseId)) throw new Error('Environment lease is unavailable; do not continue the worker')
      try {
        const work = await this.work(lease.workspaceId, lease.workId)
        if (!sameLocation(await canonicalDirectory(work.workspacePath), lease.workspacePath)) throw new Error('Workspace directory changed during execution')
        const checkout = await inspectCheckout(lease.checkout.path)
        assertIdentity(lease.checkout, checkout)
        if (checkout.head !== lease.checkout.head) throw new Error('Branch HEAD changed during execution; stop before continuing')
        return structuredClone(lease)
      } catch (error) {
        this.invalidLeases.add(leaseId)
        throw error
      }
    })
  }

  release(leaseId: string): Promise<void> {
    return this.queue.run(async () => { this.leases.delete(identity.parse(leaseId)); this.invalidLeases.delete(leaseId) })
  }

  /** Serializes an approved host commit with identity monitoring; Workers still cannot write Git metadata. */
  commit(leaseId: string, expectedHead: string, perform: (checkout: SuperAgentCheckout) => Promise<string>): Promise<string> {
    return this.run(async () => {
      const lease = this.leases.get(identity.parse(leaseId))
      if (!lease || this.invalidLeases.has(leaseId)) throw new Error('Commit execution is no longer active')
      const work = await this.work(lease.workspaceId, lease.workId)
      if (!sameLocation(await canonicalDirectory(work.workspacePath), lease.workspacePath)) throw new Error('Commit workspace changed')
      const checkout = await inspectCheckout(lease.checkout.path)
      assertIdentity(lease.checkout, checkout)
      if (checkout.head !== expectedHead || checkout.head !== lease.checkout.head) throw new Error('Commit HEAD changed after review')
      try {
        const commit = await perform(checkout)
        const updated = await inspectCheckout(checkout.path)
        assertIdentity(checkout, updated)
        if (updated.head !== commit) throw new Error('Commit outcome changed before it could be confirmed')
        lease.checkout = updated
        return commit
      } catch (error) {
        // Preserve occupancy after any uncertain write; explicit stop is always available.
        const current = await inspectCheckout(checkout.path).catch(() => undefined)
        if (!current || current.head !== expectedHead) this.invalidLeases.add(leaseId)
        throw error
      }
    })
  }

  close(): Promise<void> {
    this.closing = true
    return this.queue.run(async () => { this.leases.clear(); this.invalidLeases.clear(); await this.store.drain() })
  }
}
