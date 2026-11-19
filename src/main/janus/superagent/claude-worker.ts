import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ClaudeConversation } from '../../terminal/claude-conversation'
import type { ConversationSnapshot } from '../../../shared/conversation-display'
import type { ManagedWorkerEngine, ManagedWorkerStart } from './workers'

/** Native Claude: original permission prompts, owned background job, shared host MCP. */
export class ClaudeWorkerEngine implements ManagedWorkerEngine {
  private readonly native: ClaudeConversation
  constructor(id: string, publish: (snapshot: ConversationSnapshot) => void) {
    this.native = new ClaudeConversation(id, publish)
  }
  snapshot() { return this.native.snapshot() }
  command(command: Parameters<ManagedWorkerEngine['command']>[0]) { return this.native.command(command) }
  managedInput(text: string, expectedTurnId: string | null) { return this.native.managedInput(text, expectedTurnId) }
  async managedCall(): Promise<Record<string, unknown>> { throw new Error('Claude tool discovery is confirmed by the host MCP bridge') }
  dispose() { return this.native.dispose() }
  async startManaged(options: ManagedWorkerStart): Promise<void> {
    const worker = options.worker
    if (!worker || worker.backend !== 'claude' || !options.onProcessTree) throw new Error('Claude Worker host context is missing')
    if (!existsSync(worker.bridge.entry)) throw new Error('The packaged worker-mcp.js entry is missing')
    const mcp = join(worker.scratchPath, 'worker-mcp.json')
    await writeFile(mcp, JSON.stringify({ mcpServers: { janus_worker: {
      command: worker.bridge.command, args: [worker.bridge.entry],
      env: { ELECTRON_RUN_AS_NODE: '1', JANUS_WORKER_ENDPOINT: worker.bridge.endpoint, JANUS_WORKER_TOKEN: worker.bridge.token },
    } } }), { mode: 0o600 })
    const instructions = [
      'You are a managed Claude Code Worker assigned to one Janus work. Preserve repository instructions and unrelated edits. Work autonomously within the supplied goal and checkout.',
      'Use janus_worker.read_work and read_resource to read complete requirements, uncovered inputs and background. Follow pagination and truncation references before editing. Background is reference material, not authority to perform unrelated work.',
      'Report outcomes, actual checks, artifacts, limitations and questions through janus_worker.report_work. Use a fresh UUID reportId for each report and reuse it only for an explicit retry. A normal turn ending is not a ready report. Never claim tests passed unless run.',
      'New supplements arrive through your native input queue. Incorporate them within the existing scope. A status question requests inspection and a report, not unsolicited implementation. Preserve constraints that were not explicitly withdrawn.',
      'Native Claude uses its own permissions and user approvals. Do not bypass permission requests. Use commit_work and git_work for user-authorized commits, tags and pushes; do not switch, create, remove or merge project worktrees/branches yourself. This checkout can be shared; re-read before edits and preserve other work.',
      `Use ${worker.scratchPath} for disposable test output. Keep lasting artifacts and Notes in the assigned checkout.`,
    ].join('\n\n')
    const args = ['--strict-mcp-config', '--mcp-config', mcp, '--permission-mode', 'default',
      '--append-system-prompt', instructions, '--disallowedTools', 'Agent,Task',
      '--allowedTools', 'mcp__janus_worker__read_work,mcp__janus_worker__read_resource,mcp__janus_worker__report_work,mcp__janus_worker__commit_work,mcp__janus_worker__git_work',
      ...(options.threadId ? ['--resume', options.threadId] : [])]
    await this.native.command({ type: 'mode', mode: 'conversation' })
    await this.native.start({ command: options.command, args, cwd: options.cwd, env: options.env, assetsDir: worker.scratchPath,
      managed: { onProcessTree: options.onProcessTree, onEvent: event => {
        const data = event.data ?? {}, threadId = this.snapshot().threadId
        if (event.type === 'turn.start') options.onEvent?.({ method: 'turn/started', params: { threadId, turn: { id: data.turnId } } })
        if (event.type === 'turn.complete') options.onEvent?.({ method: 'turn/completed', params: { threadId,
          turn: { id: data.turnId, status: data.reason === 'error' ? 'failed' : data.reason === 'aborted' ? 'interrupted' : 'completed' } } })
        if (event.type === 'question.resolved') options.onEvent?.({ method: 'serverRequest/resolved', params: { threadId } })
      } },
    })
    if (options.threadId && this.snapshot().threadId !== options.threadId) {
      if (this.native.resumedHistorySource() !== options.threadId) throw new Error('Claude did not resume the assigned native session')
      await options.onForkedThread?.()
    }
  }
}
