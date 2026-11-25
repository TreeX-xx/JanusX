// Engine-owned implementation. See .agents/notes/agent/ideas/superagent-harness-reliability.md
import { randomUUID } from 'node:crypto'
import { CodexConversation as NativeCodexConversation } from '@janus-agent/janus-agent/superagent/native/codex-conversation'
import type { CodexUpdatePrompt, CodexUpdateCommand, ConversationCommand, ConversationPlan, ConversationSnapshot } from '../../shared/conversation-display'
import type { ConversationHistoryRequest, ConversationHistoryResult } from '../../shared/conversation-history'
import { readCodexTurnPlans } from './codex-turn-plans'
import { CodexQuotaSession, officialLaunch } from './codex-quota'
import type { CodexRpc } from './codex-managed-transport'
import type { CodexQuotaEvent, QuotaReadReason } from '../../shared/codex-quota'

export * from '@janus-agent/janus-agent/superagent/native/codex-conversation'

/** Give the native adapter's live projection and its paged history the same final plans. */
export class DesktopCodexConversation extends NativeCodexConversation {
  onQuota?: (event: CodexQuotaEvent) => void
  private quotaCwd?: string
  private quotaThread?: string
  private settingsProvider?: string
  private readonly allowance = new CodexQuotaSession(this.id, (method, params) => this.call(method, params),
    (quota, recheck) => this.onQuota?.({ id: this.id, quota, recheck }))

  override start(options: Parameters<NativeCodexConversation['start']>[0]) {
    this.quotaCwd = officialLaunch(options.env) ? options.cwd : undefined
    return super.start(options)
  }

  syncQuotaThread(): void {
    const thread = this.state.connection === 'ready' && (this.settingsProvider ?? this.modelProvider) === 'openai' && this.quotaCwd
      ? this.state.threadId ?? undefined : undefined
    if (thread !== this.quotaThread) {
      this.quotaThread = thread
      this.allowance.invalidate(!!thread)
    }
  }

  async readQuota(reason: QuotaReadReason): Promise<void> {
    if (this.quotaThread && this.quotaCwd) await this.allowance.read(this.quotaCwd, reason)
    else this.onQuota?.({ id: this.id, quota: null })
  }

  protected override receive(message: CodexRpc, requestThreadId?: string): void {
    if (message.method === 'thread/settings/updated' && message.params?.threadId === this.state.threadId &&
        typeof message.params?.threadSettings?.modelProvider === 'string') {
      this.settingsProvider = message.params.threadSettings.modelProvider
      this.syncQuotaThread()
    } else if (message.method === 'account/updated' || message.method === 'account/gatewayOAuth/changed') {
      this.allowance.invalidate(!!this.quotaThread)
    } else if (message.method === 'account/rateLimits/updated') {
      this.allowance.push(message.params?.rateLimits)
    }
    super.receive(message, requestThreadId)
  }

  override dispose(): Promise<void> {
    this.quotaCwd = this.quotaThread = undefined
    this.allowance.invalidate()
    this.onQuota = undefined
    return super.dispose()
  }

  private readonly projectPlans: (snapshot: ConversationSnapshot) => ConversationSnapshot
  private readonly plansFor: (threadId: string, turnIds: Iterable<string>) => ConversationPlan[]
  private restoring: Promise<void> = Promise.resolve()

  private startupOutput = ''
  private updateMenu?: CodexUpdatePrompt

  constructor(id: string, private readonly publishSnapshot: (snapshot: ConversationSnapshot) => void, bind?: (threadId: string, transcriptPath?: string) => void) {
    let scope: string | undefined, source: string | undefined
    let restored = new Map<string, ConversationPlan>(), observedRevision = -1
    const observed = new Map<string, ConversationPlan>()
    const plansFor = (threadId: string, turnIds: Iterable<string>) => scope === threadId
      ? [...new Set(turnIds)].flatMap(turnId => {
        const plan = observed.get(turnId) ?? restored.get(turnId)
        return plan ? [plan] : []
      }) : []
    const project = (snapshot: ConversationSnapshot): ConversationSnapshot => {
      if (snapshot.connection !== 'starting' || snapshot.threadId || snapshot.startup) this.updateMenu = undefined
      if (this.updateMenu) return { ...snapshot, codexUpdatePrompt: { ...this.updateMenu } }
      if (!snapshot.threadId || scope !== snapshot.threadId) return snapshot
      const visible = new Set(snapshot.items.map(item => item.turnId))
      if (snapshot.turnId) visible.add(snapshot.turnId)
      if (snapshot.revision >= observedRevision) {
        observedRevision = snapshot.revision
        for (const plan of snapshot.plans ?? []) {
          if (visible.has(plan.turnId) && (plan.turnId === snapshot.turnId || plan.outcome !== 'running')) observed.set(plan.turnId, plan)
        }
        while (observed.size > 500) {
          const first = observed.keys().next()
          if (!first.done) observed.delete(first.value)
        }
      }
      return { ...snapshot, plans: plansFor(snapshot.threadId, visible) }
    }
    super(id, snapshot => publishSnapshot(project(snapshot)), (threadId, transcriptPath) => {
      this.settingsProvider = undefined
      bind?.(threadId, transcriptPath)
      if (scope !== threadId) {
        scope = threadId; source = undefined; restored.clear(); observed.clear(); observedRevision = -1
        this.restoring = Promise.resolve()
      }
      if (!transcriptPath || source === transcriptPath) return
      source = transcriptPath
      this.restoring = readCodexTurnPlans(transcriptPath, threadId).then(plans => {
        if (scope !== threadId || source !== transcriptPath || this.state.threadId !== threadId || this.state.connection !== 'ready') return
        restored = plans
        if (plans.size) publishSnapshot(this.snapshot())
      }).catch(() => {})
    })
    this.projectPlans = project
    this.plansFor = plansFor
  }

  observeStartupOutput(data: string): void {
    if (this.state.connection !== 'starting' || this.state.threadId || this.state.startup || this.updateMenu) return
    // Codex draws this menu before connecting its native client to app-server.
    // Keep raw chunks together because escape sequences and labels can be split across writes.
    this.startupOutput = (this.startupOutput + data).slice(-32768)
    const plain = this.startupOutput.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    const labels = plain.replace(/\s/g, '').toLowerCase()
    if (!labels.includes('updatenow') || !labels.includes('skipuntilnextversion')) return
    this.startupOutput = ''
    const versions = plain.match(/(\d+\.\d+\.\d+(?:-[\w.-]+)?)\s*→\s*(\d+\.\d+\.\d+(?:-[\w.-]+)?)/)
    this.updateMenu = { id: randomUUID(), ...(versions && { versions: { current: versions[1], latest: versions[2] } }) }
    this.state.revision++
    this.publishSnapshot(this.snapshot())
  }

  chooseUpdate(command: CodexUpdateCommand, write: (key: string) => void): ConversationSnapshot {
    const menu = this.updateMenu
    if (!menu || menu.id !== command.promptId || menu.choice || this.state.connection !== 'starting' ||
      this.state.threadId || this.state.startup || this.state.mode !== 'conversation' || this.state.controlEpoch !== command.controlEpoch) {
      throw new Error('This Codex update prompt is no longer active.')
    }
    const keys = new Map([['update', '1'], ['skip', '2'], ['dismiss', '3']])
    const key = keys.get(command.choice)
    if (!key) throw new Error('Unknown Codex update choice.')
    // Each numeric shortcut confirms its choice immediately. A trailing Enter
    // could confirm a subsequent workspace trust or hooks prompt.
    write(key)
    this.updateMenu = { ...menu, choice: command.choice }
    this.state.revision++
    const snapshot = this.snapshot()
    this.publishSnapshot(snapshot)
    return snapshot
  }

  override snapshot(): ConversationSnapshot {
    return this.projectPlans(super.snapshot())
  }

  override async command(command: ConversationCommand): Promise<ConversationSnapshot> {
    return this.projectPlans(await super.command(command))
  }

  override async readHistory(request: ConversationHistoryRequest): Promise<ConversationHistoryResult> {
    const epoch = this.state.controlEpoch
    const result = await super.readHistory(request)
    if (result.type !== 'page') return result
    await this.restoring
    if (this.state.threadId !== request.threadId || this.state.controlEpoch !== epoch) throw new Error('Native history session changed')
    return { ...result, plans: this.plansFor(result.threadId, result.items.map(item => item.turnId)) }
  }
}
