// Note: .agents/notes/agent/superagent-plugin-migration.md
import { workflowCheckpoint } from '@janus-agent/janus-agent/superagent/workflow-checkpoint'
import type { SuperAgentService } from './service'
import type { NativePluginService } from '../../plugins/native-service'

export type RemovalChoice = 'wait' | 'stop' | 'cancel'
export type ChooseRemoval = (works: string[]) => Promise<RemovalChoice>

/** Each instance belongs to one activation. Native approvals and stop remain reachable while waiting. */
export class SuperAgentRemoval {
  private frozen = false
  private choosing = false
  readonly admission = new AbortController()
  constructor(private service: SuperAgentService, private activation: NativePluginService) {
    const { scheduler, workflows } = service
    scheduler?.setAdmissionGuard(async (workspace, work, launching) => {
      if (this.frozen || !activation.active) return false
      const snapshot = await workflows?.snapshot(workspace)
      if (snapshot?.diagnostic) throw new Error(snapshot.diagnostic)
      const flows = snapshot?.workflows ?? []
      const flow = flows.find(row => row.nodes.some(node => node.workId === work))
      const node = flow?.nodes.find(row => row.workId === work)
      let preparing = false
      if (!flow && flows.some(row => row.state === 'creating' || row.nodes.some(child => !child.workId))) {
        const { work: record } = await service.store.workDetail(workspace, work)
        preparing = flows.some(row => record.creationId?.startsWith(row.id + ':'))
      }
      const allowed = await activation.call('scheduler.admit', { version: 1, workspaceId: workspace, workId: work,
        launching: !!launching, live: !!service.workers?.snapshots(workspace).some(row => row.workId === work && !row.stopConfirmed),
        preparing, node: flow && node ? { flow: flow.state, state: node.state,
          dependencies: node.dependencies.map(key => flow.nodes.find(child => child.key === key)?.state ?? null) } : null })
      if (allowed !== true || this.frozen || !activation.active) return false
      if (launching && node?.checkpoint && (await workflowCheckpoint(node.checkpoint.path)).sha256 !== node.checkpoint.sha256)
        throw new Error('Handoff code changed while queued. Inspect the workflow before resuming.')
      return !this.frozen && activation.active
    })
  }
  freeze() { this.frozen = true; this.admission.abort() }
  assertAccepting() {
    if (this.frozen) throw new Error('SuperAgent is preparing to stop')
  }
  async prepare(choose: ChooseRemoval) {
    if (this.choosing) throw new Error('A SuperAgent lifecycle change is already in progress')
    this.choosing = this.frozen = true
    try {
      const { scheduler, workers, store } = this.service
      const entries = (await scheduler?.ledger.snapshot())?.entries ?? []
      const scopes = await store.workspaceIds()
      const live = () => scopes.flatMap(scope => workers?.snapshots(scope) ?? [])
        .filter(worker => !worker.restored && !worker.stopConfirmed && !worker.retiredAt)
      const busy = () => live().some(row => ['starting', 'running', 'waiting', 'stopping'].includes(row.phase))
      const pending = entries.filter(row => ['queued', 'paused', 'awaiting-approval', 'starting'].includes(row.status))
      const affected = new Map([...pending.map(row => [row.workId, { workspaceId: row.workspaceId, state: row.status }] as const),
        ...live().map(row => [row.workId, { workspaceId: row.workspaceId, state: row.phase }] as const)])
      if (affected.size) {
        const rows = await Promise.all([...affected].map(async ([id, row]) => {
          const { work } = await store.workDetail(row.workspaceId, id)
          return work.title + ' · ' + row.state
        }))
        const choice = await choose(rows)
        if (choice === 'cancel') return false
        this.activation.signal.throwIfAborted()
        this.admission.abort()
        if (choice === 'wait' && workers) {
          await new Promise<void>(resolve => {
            const done = () => { unsubscribe(); this.activation.signal.removeEventListener('abort', done); resolve() }
            const check = () => { if (!busy()) done() }
            const unsubscribe = workers.subscribe(check)
            this.activation.signal.addEventListener('abort', done, { once: true })
            if (this.activation.signal.aborted) done()
            else check()
          })
        }
        this.activation.signal.throwIfAborted()
        // Clearing queued intents while frozen prevents an explicit later enable from replaying them.
        if (pending.length) {
          const targets = pending.map(row => ({ workspaceId: row.workspaceId, workId: row.workId, closed: false }))
          await scheduler?.cancelMany(targets, async () => {
            for (const { workspaceId, workId } of targets) {
              const { work } = await store.workDetail(workspaceId, workId)
              if (work.closedAt === null) await store.controlWork(workspaceId, workId, work.revision, 'stop')
            }
          })
        }
      }
      this.admission.abort()
      return true
    } finally {
      this.choosing = false
      if (!this.admission.signal.aborted) {
        this.frozen = false
        if (this.activation.active) await this.service.scheduler?.kick()
      }
    }
  }
}
