import { randomUUID } from 'node:crypto'
import type { ConversationSnapshot } from '../../src/shared/conversation-display'
import { conversationState } from '../../src/main/terminal/conversation-session'
import type { ManagedWorkerEngine } from '../../src/main/janus/superagent/workers'
import { callWorkerHost } from '../../src/main/janus/superagent/worker-mcp'
import { ManagedInputDeferred } from '../../src/main/terminal/codex-conversation'

export class ManagedEngineFixture implements ManagedWorkerEngine {
  state = conversationState(randomUUID(), 'codex')
  options?: Parameters<ManagedWorkerEngine['startManaged']>[0]
  config: any
  grant!: { JANUS_WORKER_ENDPOINT: string; JANUS_WORKER_TOKEN: string }
  inputs: Array<{ text: string; turn: string | null }> = []
  deliveryError = false
  deferInput = false
  exit: () => Promise<void> = async () => {}
  constructor(private publish: (state: ConversationSnapshot) => void) {}
  snapshot() { return structuredClone(this.state) }
  changed() { this.publish(this.snapshot()) }
  async startManaged(options: Parameters<ManagedWorkerEngine['startManaged']>[0]) {
    this.options = options
    if (options.worker?.backend === 'claude') {
      this.state.engine = 'claude'
      this.grant = { JANUS_WORKER_ENDPOINT: options.worker.bridge.endpoint, JANUS_WORKER_TOKEN: options.worker.bridge.token }
      await this.tool('__tools_discovered')
    } else {
    this.config = await options.configure({ config: { projects: { [options.cwd]: { trust_level: 'trusted' } }, mcp_servers: { inherited: { command: 'must-not-run' } } } })
    this.grant = this.config.config.mcp_servers.janus_worker.env
    }
    this.state.threadId = options.threadId ?? randomUUID(); this.state.connection = 'ready'; this.state.mode = 'conversation'; this.changed()
  }
  async managedCall() { return { data: [{ name: 'janus_worker', tools: { report_work: {} } }] } }
  async managedInput(text: string, turn: string | null) {
    if (this.deferInput) {
      this.deferInput = false
      this.state.approvals = [{ id: 'late-approval', kind: 'command', description: 'Native decision arrived before send' }]; this.changed()
      throw new ManagedInputDeferred('waiting')
    }
    this.inputs.push({ text, turn })
    if (this.deliveryError) throw new Error('RPC receipt lost')
    this.state.turnId = turn ?? randomUUID(); this.changed()
    this.options?.onEvent?.({ method: 'turn/started', params: { threadId: this.state.threadId, turn: { id: this.state.turnId } } })
    return { turnId: this.state.turnId }
  }
  async command() { this.state.approvals = []; this.state.questions = []; this.changed(); return this.snapshot() }
  async dispose() { await this.exit(); this.state.connection = 'closed'; this.state.turnId = null; this.changed() }
  end() {
    const id = this.state.turnId; this.state.turnId = null; this.changed()
    this.options?.onEvent?.({ method: 'turn/completed', params: { threadId: this.state.threadId, turn: { id, status: 'completed' } } })
  }
  tool(name: string, args: unknown = {}) { return callWorkerHost(this.grant.JANUS_WORKER_ENDPOINT, this.grant.JANUS_WORKER_TOKEN, name, args) }
}

