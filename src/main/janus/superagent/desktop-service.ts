import type { NativePluginService } from '../../plugins/native-service'
import { SuperAgentService } from './service'
import type { WorkerSettingsStore } from './worker-settings'
import type { WorkerBackend } from '../../../shared/superagent'

/** Desktop preference enforcement; scheduling and native delivery remain engine-owned. */
export class DesktopSuperAgentService extends SuperAgentService {
  activation?: Pick<NativePluginService, 'signal' | 'call' | 'active'>
  removal?: import('./removal').SuperAgentRemoval
  workerPolicy?: WorkerSettingsStore
  requireBackend?: (backend: WorkerBackend) => Promise<void>
  private async select(backend?: WorkerBackend) {
    const selected = this.workerPolicy ? await this.workerPolicy.resolveBackend(backend) : backend
    if (selected) await this.requireBackend?.(selected)
    return selected
  }
  override async prepareWorker(...args: Parameters<SuperAgentService['prepareWorker']>) {
    await this.select()
    return super.prepareWorker(...args)
  }
  override async continueWorker(...args: Parameters<SuperAgentService['continueWorker']>) {
    await this.checkWorker(args[0].workspaceId, args[0].workId)
    return super.continueWorker(...args)
  }
  override async createWorkflow(...args: Parameters<SuperAgentService['createWorkflow']>) {
    this.removal?.assertAccepting()
    const [workspaceId, plan, signal] = args
    const nodes = await Promise.all(plan.nodes.map(async node => ({ ...node,
      workerBackend: await this.select(node.workerBackend) })))
    return super.createWorkflow(workspaceId, { ...plan, nodes }, signal)
  }
  async checkWorker(workspaceId: unknown, workId: unknown, requested?: WorkerBackend) {
    const detail = await this.workDetail(workspaceId, workId)
    const backend = detail.executions[0] ? detail.executions[0].backend ?? 'codex' : detail.work.workerBackend
    const resolved = await this.select(backend)
    if (requested && resolved !== requested) throw new Error('Worker backend is fixed for this work')
    return resolved
  }
  override async routeDecision(...args: Parameters<SuperAgentService['routeDecision']>) {
    const [workspaceId, value, signal] = args
    // The engine still validates the complete route and current revision.
    if (value && typeof value === 'object' && 'action' in value) {
      const route = value as { action: string; workId?: string; workerBackend?: WorkerBackend }
      if (['continue', 'new', 'reopen'].includes(route.action)) this.removal?.assertAccepting()
      if (value.action === 'new' && this.workerPolicy) {
        const workerBackend = await this.select(route.workerBackend)
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
