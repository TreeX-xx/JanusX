import { SuperAgentService } from './service'
import type { WorkerSettingsStore } from './worker-settings'
import type { WorkerBackend } from '../../../shared/superagent'

/** Desktop preference enforcement; scheduling and native delivery remain engine-owned. */
export class DesktopSuperAgentService extends SuperAgentService {
  workerPolicy?: WorkerSettingsStore
  override async createWorkflow(...args: Parameters<SuperAgentService['createWorkflow']>) {
    const [workspaceId, plan, signal] = args
    const nodes = await Promise.all(plan.nodes.map(async node => ({ ...node,
      workerBackend: this.workerPolicy ? await this.workerPolicy.resolveBackend(node.workerBackend) : node.workerBackend })))
    return super.createWorkflow(workspaceId, { ...plan, nodes }, signal)
  }
  async checkWorker(workspaceId: unknown, workId: unknown, requested?: WorkerBackend) {
    const detail = await this.workDetail(workspaceId, workId)
    const backend = detail.executions[0] ? detail.executions[0].backend ?? 'codex' : detail.work.workerBackend
    const resolved = this.workerPolicy ? await this.workerPolicy.resolveBackend(backend) : backend
    if (requested && resolved !== requested) throw new Error('Worker backend is fixed for this work')
    return resolved
  }
  override async routeDecision(...args: Parameters<SuperAgentService['routeDecision']>) {
    const [workspaceId, value, signal] = args
    // The engine still validates the complete route and current revision.
    if (value && typeof value === 'object' && 'action' in value) {
      const route = value as { action: string; workId?: string; workerBackend?: WorkerBackend }
      if (value.action === 'new' && this.workerPolicy) {
        const workerBackend = await this.workerPolicy.resolveBackend(route.workerBackend)
        const selected = { ...value, workerBackend }
        return super.routeDecision(workspaceId, selected, signal)
      }
      if (['continue', 'reopen'].includes(route.action) && route.workId) await this.checkWorker(workspaceId, route.workId, route.workerBackend)
    }
    return super.routeDecision(...args)
  }
  override async startWorker(...args: Parameters<SuperAgentService['startWorker']>) {
    await this.checkWorker(args[0], args[1])
    return super.startWorker(...args)
  }
  override async controlQueue(value: unknown) {
    if (value && typeof value === 'object' && 'action' in value && value.action === 'resume' && 'workspaceId' in value && 'workId' in value) {
      await this.checkWorker(value.workspaceId, value.workId)
    }
    return super.controlQueue(value)
  }
}
