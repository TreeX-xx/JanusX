export const DEFAULT_CPA_MANAGEMENT_URL = 'http://127.0.0.1:8317/management.html'

export interface CpaSettings {
  managementUrl: string
  mode?: 'managed' | 'external'
  enabled?: boolean
  port?: number
  autoUpdate?: boolean
}
export interface CpaOAuthFallback {
  provider: 'codex' | 'claude' | 'antigravity'
  port: number
  reason: 'restricted' | 'occupied' | 'unavailable'
}
export interface CpaStatus {
  phase: 'not-installed' | 'stopped' | 'downloading' | 'starting' | 'running' | 'failed'
  version?: string
  pendingVersion?: string
  progress?: number
  error?: string
  updateError?: string
  pid?: number
  oauthFallback?: CpaOAuthFallback
  oauthBrowserError?: boolean
}
/** An optional write-only credential, never part of persisted settings or status. */
export function validateCpaManagementKey(input: unknown): string {
  if (typeof input !== 'string' || !/^[\x21-\x7e]{8,128}$/.test(input)) throw new Error('cpa-invalid-management-key')
  return input
}

export function normalizeCpaSettings(input: unknown): CpaSettings {
  const value = input as Partial<CpaSettings> | null
  const mode = value?.mode === 'managed' || !value ? 'managed' : 'external'
  const port = value?.port ?? 8317
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('cpa-invalid-port')
  return {
    mode, enabled: value?.enabled === true, port, autoUpdate: value?.autoUpdate !== false,
    managementUrl: mode === 'managed' ? `http://127.0.0.1:${port}/management.html`
      : normalizeCpaManagementUrl(value?.managementUrl),
  }
}

/** Store an address only; credentials belong to the management page's login. */
export function normalizeCpaManagementUrl(input: unknown): string {
  if (typeof input !== 'string' || input.length > 2048 || !input.trim()) throw new Error('invalid-cpa-url')
  const value = input.trim()
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value
    : /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i.test(value) ? `http://${value}` : `https://${value}`
  let url: URL
  try { url = new URL(candidate) } catch { throw new Error('invalid-cpa-url') }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password || url.search) {
    throw new Error('invalid-cpa-url')
  }
  if (url.pathname === '/') url.pathname = '/management.html'
  return url.href
}
