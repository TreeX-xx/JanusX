import type { PluginManifest, PluginContext, JsonValue } from '@janusx/plugin-sdk'

export const PLUGIN_CHANNELS = { manage: 'plugins:manage', changed: 'plugins:changed', event: 'plugins:event' } as const
export interface InstalledPlugin {
  manifest: PluginManifest
  source: { kind: 'linked' | 'copied'; directory: string }
  digest: string
  enabled: boolean
  projects: string[]
  state: 'disabled' | 'blocked' | 'ready' | 'loading' | 'active' | 'error'
  error?: string
  failures: number
}
export interface PluginLog { time: string; pluginId?: string; instanceId?: string; method?: string; code: string; duration?: number }
export interface PluginHostSnapshot { developmentMode: boolean; plugins: InstalledPlugin[]; logs: PluginLog[] }
export interface PluginMount { instanceId: string; binding: string; url: string; context: PluginContext }
export interface PluginBounds { x: number; y: number; width: number; height: number }
export type PluginManageRequest =
  | { type: 'list' }
  | { type: 'development'; enabled: boolean }
  | { type: 'import'; kind: 'linked' | 'copied' }
  | { type: 'enable'; id: string; projects: string[] }
  | { type: 'disable' | 'reload' | 'uninstall' | 'deleteData'; id: string }
  | { type: 'context'; projectId: string | null; scopePath: string | null; locale: string; theme: { id: string; tokens: Record<string, string> } }
  | { type: 'mount'; id: string; view: string; projectId: string | null; scopePath: string | null }
  | { type: 'close' | 'devtools'; instanceId: string; binding: string }
  | { type: 'active'; instanceId: string; binding: string; active: boolean }
  | { type: 'bounds'; instanceId: string; binding: string; bounds: PluginBounds }
  | { type: 'call'; instanceId: string; binding: string; packet: unknown }
export type PluginHostResult = { ok: true; data: unknown } | { ok: false; code: string; message: string }
export interface PluginHostEvent { instanceId: string; packet: JsonValue }
/** This management API belongs only to the trusted main-window top frame. */
export interface PluginHostAPI {
  request(input: PluginManageRequest): Promise<PluginHostResult>
  onChanged(callback: () => void): () => void
  onEvent(callback: (event: PluginHostEvent) => void): () => void
}
