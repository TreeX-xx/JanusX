// Note: .agents/notes/desktop/browser-computer-use.md
export interface ControlSettings {
  browser: { enabled: boolean; timeoutMs: number }
  computer: { executable: string }
}
export interface ControlStatus {
  browser: { enabled: boolean; provider: 'chrome-devtools-mcp'; version: string; state: 'ready' | 'unavailable'; error?: string; active: boolean }
  computer: { provider: 'cua-driver'; configured: boolean; connected: false }
}
export const DEFAULT_CONTROL_SETTINGS: ControlSettings = {
  browser: { enabled: true, timeoutMs: 15000 }, computer: { executable: '' },
}
export function normalizeControlSettings(value: unknown): ControlSettings {
  const input = (value ?? {}) as Partial<ControlSettings>
  const timeout = input.browser?.timeoutMs
  return {
    browser: { enabled: typeof input.browser?.enabled === 'boolean' ? input.browser.enabled : true,
      timeoutMs: typeof timeout === 'number' && Number.isFinite(timeout) ? Math.min(60000, Math.max(3000, Math.round(timeout))) : 15000 },
    computer: { executable: typeof input.computer?.executable === 'string' ? input.computer.executable.trim().slice(0, 4096) : '' },
  }
}
export const CONTROL_CHANNELS = {
  get: 'control:settings:get', update: 'control:settings:update', status: 'control:status', stop: 'control:stop',
  checkComputer: 'control:computer:check',
  clients: 'control:browser:clients', changeClient: 'control:browser:client:change', probeClient: 'control:browser:client:probe',
} as const
export const BROWSER_CLIENTS = ['claude', 'codex', 'opencode', 'janus', 'pi', 'dsh'] as const
export type BrowserClient = typeof BROWSER_CLIENTS[number]
export interface BrowserClientStatus {
  id: BrowserClient; label: string; path: string; revision: string
  state: 'absent' | 'configured' | 'conflict' | 'unavailable'
}
export interface BrowserClientChange { client: BrowserClient; expectedRevision: string; action: 'import' | 'remove' }
export interface ControlAPI {
  get(): Promise<ControlSettings>
  update(settings: Partial<ControlSettings>): Promise<ControlSettings>
  status(): Promise<ControlStatus>
  stop(): Promise<void>
  checkComputer(): Promise<{ available: boolean; version?: string; error?: string }>
  clients(): Promise<BrowserClientStatus[]>
  changeClient(input: BrowserClientChange): Promise<void>
  probeClient(client: BrowserClient, expectedRevision: string): Promise<{ ok: boolean; tools?: number; error?: string }>
}
