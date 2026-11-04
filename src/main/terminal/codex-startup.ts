import type { ConversationCommand, ConversationStartup } from '../../shared/conversation-display'

type Json = Record<string, any>
type StartupCommand = Extract<ConversationCommand, { type: 'startup' }>
const untrustedHooks = (result: Json): Json[] => (result.data?.[0]?.hooks ?? []).filter((hook: Json) => ['untrusted', 'modified'].includes(hook.trustStatus))

/** Mirrors the remote trust lookup in Codex 0.166 tui/config_update.rs.
 * Only native structured reads are gated; no terminal text or synthetic consent.
 * Design: .agents/notes/workbench/terminal-dialog-dual-mode.md
 */
export function codexTrustTarget(result: Json, cwd: string): string | undefined {
  const layers = (result.layers ?? []).filter((layer: Json) => layer.name?.type === 'project')
  const disabled = [...layers].reverse().find((layer: Json) => typeof layer.disabledReason === 'string')
  const projects = result.config?.projects ?? {}
  const windows = /^(?:[a-z]:[\\/]|\\\\)/i.test(cwd)
  const entry = (path: string): [string, Json] | undefined => Object.entries(projects).find(([key, value]) =>
    (key === path || (windows && key.toLowerCase() === path.toLowerCase())) && typeof (value as Json)?.trust_level === 'string') as [string, Json] | undefined
  const saved = entry(cwd)
  const reason = disabled?.disabledReason as string | undefined
  if (!saved && reason && Object.entries(projects).some(([path, project]) => (project as Json).trust_level === 'untrusted' && reason.startsWith(`${path} is marked as untrusted`))) return undefined
  const target = saved?.[0] ?? reason?.match(/, add (.+) as a trusted project in /)?.[1]
    ?? disabled?.name?.dotCodexFolder?.replace(/[\\/]\.codex$/, '') ?? cwd
  const level = entry(target)?.[1].trust_level
  // A saved restricted choice must not be silently upgraded to trust.
  if (level === 'trusted' || level === 'untrusted') return undefined
  if (!disabled && layers.some((layer: Json) => layer.disabledReason == null)) return undefined
  return target
}

export class CodexStartup {
  private requests = new Map<string | number, { method: string; params: Json }>()
  private held?: { request: { method: string; params: Json }; response: Json; forward: (message: Json) => void }
  private sequence = 0
  private loginId?: string
  private loginCompletion?: Json
  private disposed = false
  state?: ConversationStartup

  constructor(private call: (method: string, params: Json) => Promise<Json>, private publish: (state?: ConversationStartup) => void) {}

  observeRequest(message: Json): void {
    if (message.method === 'account/read' || message.method === 'hooks/list' || (message.method === 'config/read' && String(message.id).startsWith('tui-project-trust-read-'))) {
      this.requests.set(message.id, { method: message.method, params: message.params ?? {} })
    }
  }

  intercept(message: Json, forward: (message: Json) => void): boolean {
    const request = this.requests.get(message.id)
    if (!request || message.method) return false
    this.requests.delete(message.id)
    if (!message.result || this.held || this.disposed) return false
    const result = message.result
    const directory = request.method === 'config/read' && typeof request.params.cwd === 'string'
      ? codexTrustTarget(result, request.params.cwd) : undefined
    const login = request.method === 'account/read' && result.requiresOpenaiAuth === true && !result.account
    const hooks = request.method === 'hooks/list' ? untrustedHooks(result) : []
    if (!directory && !login && !hooks.length) return false
    this.held = { request, response: message, forward }
    this.set({ id: ++this.sequence, kind: login ? 'login' : hooks.length ? 'hooks' : 'trust', status: 'pending', ...(directory ? { directory } : {}),
      ...(hooks.length ? { hooks: hooks.map(hook => ({ key: hook.key, event: hook.eventName, source: hook.sourcePath,
        command: hook.handlerType === 'command' ? hook.command : hook.handlerType === 'mcpTool' ? `${hook.server}/${hook.tool}` : hook.handlerType })) } : {}) })
    return true
  }

  private set(state?: ConversationStartup): void {
    this.state = state
    if (!this.disposed) this.publish(state)
  }

  async command(command: StartupCommand): Promise<void> {
    const state = this.state
    if (this.disposed || !state || !this.held || state.id !== command.startupId) throw new Error('Startup confirmation is no longer pending')
    if (state.status === 'busy') throw new Error('Startup confirmation is busy')
    if (command.action === 'resume') {
      if (state.status !== 'cancelled') throw new Error('Startup is not paused')
      this.set({ ...state, status: 'pending', error: undefined }); return
    }
    if (command.action === 'cancel') {
      const loginId = this.loginId
      this.loginId = undefined
      this.set({ ...state, status: 'cancelled', authUrl: undefined, error: undefined })
      if (loginId) await this.call('account/login/cancel', { loginId })
      return
    }
    if (state.status === 'cancelled') throw new Error('Resume startup before confirming')
    if (state.kind !== 'login' ? command.action !== 'trust' : !['login', 'apiKey', 'check'].includes(command.action)) throw new Error('Invalid startup action')
    if (command.action === 'apiKey' && (typeof command.apiKey !== 'string' || !command.apiKey.trim() || command.apiKey.length > 16384)) throw new Error('Enter an API key')
    if (state.status === 'waiting' && command.action !== 'check') throw new Error('A login is already pending')
    this.set({ ...state, status: 'busy', error: undefined })
    try {
      if (command.action === 'trust') {
        const edit = state.kind === 'hooks'
          ? { keyPath: 'hooks.state', value: Object.fromEntries(untrustedHooks(this.held.response.result).map(hook => [hook.key, { trusted_hash: hook.currentHash }])), mergeStrategy: 'upsert' }
          : { keyPath: `projects.${JSON.stringify(state.directory)}.trust_level`, value: 'trusted', mergeStrategy: 'replace' }
        await this.call('config/batchWrite', { edits: [edit], reloadUserConfig: true })
      } else if (command.action === 'login' || command.action === 'apiKey') {
        this.loginCompletion = undefined
        const result = await this.call('account/login/start', command.action === 'apiKey' ? { type: 'apiKey', apiKey: command.apiKey!.trim() } : { type: 'chatgpt' })
        if (this.disposed) return
        if (command.action === 'login') {
          const url = new URL(result.authUrl)
          if (url.protocol !== 'https:' || !['auth.openai.com', 'chatgpt.com', 'auth0.openai.com'].includes(url.hostname)) throw new Error('Codex returned an unsupported login URL')
          this.loginId = result.loginId
          this.set({ ...state, status: 'waiting', authUrl: url.href })
          if (this.loginCompletion) await this.receive(this.loginCompletion)
          return
        }
      }
      await this.refresh()
    } catch (error) {
      if (!this.disposed && this.state?.id === state.id) {
        // Never publish API-key errors: upstream diagnostics may echo input.
        this.set({ ...state, status: this.loginId ? 'waiting' : 'pending', error: command.action === 'apiKey' ? 'API key sign-in failed. Check the key and try again.' : String(error).slice(0, 2000) })
      }
    }
  }

  async receive(message: Json): Promise<void> {
    if (message.method === 'account/login/completed' && this.state?.kind === 'login' && this.state.status === 'busy') {
      this.loginCompletion = message
    }
    if (message.method !== 'account/login/completed' || !this.loginId || message.params?.loginId !== this.loginId || this.state?.status !== 'waiting') return
    this.loginId = undefined
    if (!message.params.success) { this.set({ ...this.state, status: 'pending', authUrl: undefined, error: 'Sign-in did not complete. Please try again.' }); return }
    this.set({ ...this.state, status: 'busy' })
    try { await this.refresh() }
    catch (error) { if (this.state && !this.disposed) this.set({ ...this.state, status: 'pending', error: String(error).slice(0, 2000) }) }
  }

  private async refresh(): Promise<void> {
    const held = this.held
    if (!held) return
    const result = await this.call(held.request.method, held.request.params)
    if (this.disposed || this.held !== held) return
    if (this.state?.kind === 'login' && result.requiresOpenaiAuth && !result.account) throw new Error('Sign-in is still required')
    if (this.state?.kind === 'trust' && codexTrustTarget(result, held.request.params.cwd)) throw new Error('Folder trust could not be confirmed')
    if (this.state?.kind === 'hooks' && untrustedHooks(result).length) throw new Error('Hook trust could not be confirmed. The hook configuration may have changed; restart the conversation to review it again.')
    this.held = undefined; this.loginId = undefined; this.set(undefined)
    held.forward({ ...held.response, result })
  }

  dispose(): void { this.disposed = true; this.requests.clear(); this.held = undefined; this.state = undefined; this.loginId = undefined; this.loginCompletion = undefined }
}
