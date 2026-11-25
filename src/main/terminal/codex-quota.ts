// Note: .agents/notes/workbench/runtime-drawer-cards-resize.md
import { QUOTA_DETAILS_MS, QUOTA_FRESH_MS, QUOTA_MANUAL_MS, type CodexQuota,
  type CodexQuotaWindow, type QuotaReadReason } from '../../shared/codex-quota'
import type { CodexRpc } from './codex-managed-transport'

type RpcCall = (method: string, params: CodexRpc) => Promise<CodexRpc>
const slots = ['primary', 'secondary'] as const
const blank = (): CodexQuota => ({ source: 'account', primary: null, secondary: null, updatedAt: null, blocked: false, unavailable: false })

function officialEndpoint(value: unknown): boolean {
  if (value == null || value === '') return true
  if (typeof value !== 'string') return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.port && !url.username && !url.password &&
      (url.hostname === 'api.openai.com' || url.hostname === 'chat.openai.com' || url.hostname === 'chatgpt.com' || url.hostname.endsWith('.chatgpt.com'))
  } catch { return false }
}

type Route = 'official' | 'local' | 'unsupported'
function endpointRoute(values: unknown[]): Route {
  let route: Route = 'official'
  for (const value of values) {
    if (officialEndpoint(value)) continue
    if (typeof value !== 'string' || !URL.canParse(value)) return 'unsupported'
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      !/^(?:localhost|127\.\d+\.\d+\.\d+|\[::1\])$/.test(url.hostname)) return 'unsupported'
    route = 'local'
  }
  return route
}

export function quotaLaunchRoute(env: NodeJS.ProcessEnv): Route {
  return endpointRoute([env.OPENAI_BASE_URL, env.CHATGPT_BASE_URL, env.CODEX_CHATGPT_BASE_URL])
}

function configRoute(config: CodexRpc | undefined, provider: string, launch: Route): Route {
  if (!config || launch === 'unsupported') return 'unsupported'
  const profile = config.profile ? config.profiles?.[config.profile] : undefined
  if ((profile?.model_provider ?? config.model_provider ?? provider) !== provider) return 'unsupported'
  const base = profile?.model_providers?.[provider]?.base_url ?? config.model_providers?.[provider]?.base_url
  if (provider !== 'openai') return endpointRoute([base]) === 'local' ? 'local' : 'unsupported'
  const route = endpointRoute([base, profile?.openai_base_url ?? config.openai_base_url, profile?.chatgpt_base_url ?? config.chatgpt_base_url])
  return route === 'official' ? launch : route
}

function quotaWindow(raw: CodexRpc | null, now: number): CodexQuotaWindow | null {
  if (!raw || typeof raw.usedPercent !== 'number' || !Number.isFinite(raw.usedPercent)) return null
  return {
    used: Math.max(0, Math.min(100, raw.usedPercent)),
    minutes: Number.isFinite(raw.windowDurationMins) && raw.windowDurationMins > 0 ? raw.windowDurationMins : null,
    resetsAt: Number.isFinite(raw.resetsAt) && raw.resetsAt > 0 ? raw.resetsAt * 1000 : null,
    updatedAt: now,
  }
}

function retryDelay(error: unknown, now: number): number {
  const err = error as { code?: number; data?: CodexRpc; message?: string } | null
  const data = err?.data
  const header = data?.headers?.['retry-after'] ?? data?.headers?.['Retry-After'] ?? data?.retryAfterSeconds ?? data?.retry_after_seconds
    ?? err?.message?.match(/retry-after[:=]\s*([\d.]+)/i)?.[1]
  const ms = header == null ? NaN : Number.isFinite(Number(header)) ? Number(header) * 1000 : Date.parse(String(header)) - now
  if (Number.isFinite(ms)) return Math.max(QUOTA_MANUAL_MS, ms)
  return err?.code === 429 || data?.status === 429 || /\b429\b/.test(err?.message ?? '') ? QUOTA_FRESH_MS : QUOTA_MANUAL_MS
}

class AccountReading {
  quota = blank()
  private pending?: Promise<boolean>
  retryAt = 0
  lastAttempt = -Infinity
  readonly listeners = new Set<() => void>()
  private pushed = { primary: 0, secondary: 0, credits: 0, restriction: 0 }
  private hasCredits = false
  private restricted = false

  notify(): void { for (const listener of this.listeners) listener() }

  push(raw: CodexRpc): void {
    if (raw.limitId && raw.limitId !== 'codex') return
    const now = Date.now()
    const next = { ...this.quota }
    let changed = false
    for (const slot of slots) {
      const window = quotaWindow(raw[slot], now)
      if (window) { next[slot] = window; this.pushed[slot]++; changed = true }
    }
    if (raw.credits) {
      this.hasCredits = raw.credits.hasCredits === true || raw.credits.unlimited === true
      this.pushed.credits++
      changed = true
    }
    if (raw.rateLimitReachedType) {
      this.restricted = true
      this.pushed.restriction++
      changed = true
    }
    if (changed) {
      this.quota = { ...next, blocked: this.restricted && !this.hasCredits, updatedAt: now }
      this.notify()
    }
  }

  async read(reason: QuotaReadReason, fetch: () => Promise<CodexRpc>, current: () => boolean): Promise<void> {
    if (this.pending) {
      const applied = await this.pending
      if (!applied && current()) await this.read(reason, fetch, current)
      return
    }
    const now = Date.now()
    if (now < this.retryAt) return
    const windows = slots.map(slot => this.quota[slot]).filter(w => w !== null)
    const freshAt = windows.length ? Math.min(...windows.map(w => w.updatedAt)) : this.quota.updatedAt
    const resetDue = windows.some(w => w.resetsAt !== null && w.updatedAt < w.resetsAt && w.resetsAt <= now)
    if (reason === 'manual' ? now - this.lastAttempt < QUOTA_MANUAL_MS :
      !resetDue && !this.quota.unavailable && freshAt !== null && now - freshAt < (reason === 'details' ? QUOTA_DETAILS_MS : QUOTA_FRESH_MS)) return
    this.lastAttempt = now
    const versions = { ...this.pushed }
    this.pending = fetch().then(result => {
      if (!current()) return false
      const raw = result.rateLimitsByLimitId?.codex ?? result.rateLimits
      if (!raw || raw.limitId && raw.limitId !== 'codex') throw new Error('No Codex allowance')
      const updatedAt = Date.now()
      const next = { ...this.quota, updatedAt, unavailable: false }
      if (versions.credits === this.pushed.credits && raw.credits) {
        this.hasCredits = raw.credits.hasCredits === true || raw.credits.unlimited === true
      }
      if (versions.restriction === this.pushed.restriction) {
        if (typeof result.ordinaryUsageAllowed === 'boolean') this.restricted = !result.ordinaryUsageAllowed
        else if (raw.rateLimitReachedType) this.restricted = true
      }
      next.blocked = this.restricted && !this.hasCredits
      for (const slot of slots) {
        if (versions[slot] === this.pushed[slot]) next[slot] = quotaWindow(raw[slot], updatedAt)
      }
      this.quota = next
      return true
    }).catch(error => {
      if (!current()) return false
      this.retryAt = Date.now() + retryDelay(error, Date.now())
      this.quota = { ...this.quota, unavailable: true }
      return true
    }).then(applied => {
      if (!applied) this.lastAttempt = -Infinity
      return applied
    }).finally(() => { this.pending = undefined; this.notify() })
    await this.pending
  }
}

const accounts = new Map<string, AccountReading>()
type Binding = { source: 'session' } | { source: 'account'; key: string; accountId?: string }

/** A binding belongs to one live Codex connection. Only sanitized windows leave the main process. */
export class CodexQuotaSession {
  private generation = 0
  private key?: string
  private account?: AccountReading
  private verifying?: Promise<Binding | null>
  private reported?: CodexQuota | null
  private reportRevision = 0
  private readonly publish = () => this.emit(this.account?.quota ?? null)
  constructor(private readonly id: string, private readonly call: RpcCall, private readonly emit: (q: CodexQuota | null, recheck?: boolean) => void) {}

  invalidate(recheck = false): void {
    this.generation++
    this.verifying = undefined
    this.reported = undefined
    this.detach()
    this.emit(null, recheck)
  }

  private detach(): void {
    this.account?.listeners.delete(this.publish)
    if (this.key && this.account?.listeners.size === 0) accounts.delete(this.key)
    this.key = undefined
    this.account = undefined
  }

  private async identity(cwd: string, provider: string, launch: Route): Promise<Binding | null> {
    const { config } = await this.call('config/read', { cwd, includeLayers: false })
    const route = configRoute(config, provider, launch)
    if (route === 'local') return { source: 'session' }
    if (route !== 'official') return null
    const result = await this.call('account/read', { refreshToken: false })
    if (result.account?.type !== 'chatgpt' || result.requiresOpenaiAuth === false || !officialEndpoint(result.workspaceRouting?.backendOrigin)) return null
    // The account type also covers externally supplied ChatGPT tokens. Ask for the mode only.
    const status = await this.call('getAuthStatus', { includeToken: false, refreshToken: false })
    if (status.authMethod !== 'chatgpt') return null
    let accountId: string | undefined = result.workspaceRouting?.chatgptAccountId
    const user = result.userId || result.account.email
    if (!accountId && user) {
      // Older CLIs omit routing metadata. Use an exact active workspace when available.
      const list = await this.call('accountSession/list', { refreshWorkspaceMetadata: false }).catch(() => null)
      const active = list?.sessions?.find((s: CodexRpc) => s.isActive && s.sessionId === list.activeSessionId &&
        (result.userId ? s.userId === result.userId : s.email === user))
      accountId = active?.selectedWorkspaceAccountId ?? undefined
    }
    // Never share by email or workspace display name alone.
    const key = accountId && user ? [accountId, user] : ['terminal', this.id, user, accountId, result.account.workspaceName]
    return { source: 'account', key: JSON.stringify(key), accountId }
  }

  async read(cwd: string, reason: QuotaReadReason, provider = 'openai', launch: Route = 'official',
    readReport?: () => Promise<CodexQuota | null>): Promise<void> {
    const epoch = this.generation
    const revision = ++this.reportRevision
    const verifying = this.verifying ??= this.identity(cwd, provider, launch).catch(() => null)
    const identity = await verifying
    if (epoch !== this.generation) return
    if (this.verifying === verifying) this.verifying = undefined
    if (!identity) { this.invalidate(); return }
    if (identity.source === 'session') {
      if (this.account) this.emit(null)
      this.detach()
      this.reported ??= null
      const report = await readReport?.()
      if (epoch === this.generation && revision === this.reportRevision) {
        this.reported = report ?? null
        this.emit(this.reported)
      }
      return
    }
    this.reported = undefined
    if (this.key !== identity.key) {
      this.detach()
      this.key = identity.key
      this.account = accounts.get(this.key) ?? new AccountReading()
      accounts.set(this.key, this.account)
      this.account.listeners.add(this.publish)
    }
    const account = this.account!
    this.publish()
    const current = () => epoch === this.generation && this.account === account
    await account.read(reason, async () => {
      const result = await this.call('account/rateLimits/read', { excludeResetCreditDetails: true })
      if (current() && identity.accountId && result.accountId && result.accountId !== identity.accountId) this.invalidate()
      return result
    }, current)
  }

  push(raw?: CodexRpc): void { if (raw) this.account?.push(raw) }

  get usesReportedQuota(): boolean { return this.reported !== undefined }

  recheckReport(): void {
    if (this.reported !== undefined) this.emit(this.reported, true)
  }
}
