import type { PluginManifest, PluginContext, PluginIslandStatus, PluginDocument, JsonValue, PluginSettingValue, PluginConfiguration } from '@janusx/plugin-sdk'
import type { PluginTaskRun, PluginMessage } from '@janusx/plugin-sdk'

/** Host-only upgrade preview; no raw incompatible values leave storage. */
export interface PluginConfigurationState extends PluginConfiguration {
  migrations: Array<{ from: string; to: string; status: 'ready' | 'occupied' | 'incompatible' }>
}

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
  runtime?: { pages: number; connected: number; ready: number }
}
export interface PluginLog { time: string; pluginId?: string; instanceId?: string; method?: string; code: string; duration?: number }
export interface PluginIslandEntry {
  pluginId: string; id: string; instanceId: string; projectId: string | null; rootId: string | null
  status: PluginIslandStatus; createdAt: number
}
export interface PluginHostSnapshot { developmentMode: boolean; plugins: InstalledPlugin[]; logs: PluginLog[]; island?: PluginIslandEntry[]; tasks?: PluginTaskRun[] }
export interface PluginMount { instanceId: string; binding: string; url: string; context: PluginContext }
export interface PluginBounds { x: number; y: number; width: number; height: number }
export type PluginManageRequest =
  | { type: 'taskStart'; id: string; task: string; projectId: string | null; scopePath: string | null; input: PluginMessage }
  | { type: 'taskCancel'; runId: string }
  | { type: 'credentialStatus'; id: string; slot: string; projectId: string | null; scopePath: string | null }
  | { type: 'credentialSet'; id: string; slot: string; projectId: string | null; scopePath: string | null; value: string | null }
  | { type: 'windowOpen'; id: string; view: string; projectId: string | null; scopePath: string | null }
  | { type: 'windowCover'; covered: boolean }
  | { type: 'list' }
  | { type: 'development'; enabled: boolean }
  | { type: 'import'; kind: 'linked' | 'copied' }
  | { type: 'enable'; id: string; projects: string[] }
  | { type: 'disable' | 'reload' | 'uninstall' | 'deleteData'; id: string }
  | { type: 'context'; projectId: string | null; scopePath: string | null; locale: string; theme: { id: string; tokens: Record<string, string> } }
  | { type: 'mount'; id: string; view: string; projectId: string | null; scopePath: string | null; document?: PluginDocument }
  | { type: 'close' | 'devtools'; instanceId: string; binding: string }
  | { type: 'active'; instanceId: string; binding: string; active: boolean }
  | { type: 'bounds'; instanceId: string; binding: string; bounds: PluginBounds }
  | { type: 'call'; instanceId: string; binding: string; packet: unknown }
  | { type: 'documentEditResult'; instanceId: string; binding: string; editId: string; applied: boolean }
  | { type: 'configurationGet'; id: string; projectId: string | null; scopePath: string | null }
  | { type: 'configurationUpdate'; id: string; projectId: string | null; scopePath: string | null;
      expectedRevision: string; patch: Record<string, PluginSettingValue | null>; reset: boolean; migrate?: boolean }
  | { type: 'islandAction'; pluginId: string; id: string; instanceId: string; command: string }
export type PluginHostResult = { ok: true; data: unknown } | { ok: false; code: string; message: string }
export interface PluginHostEvent { instanceId: string; packet: JsonValue }
/** This management API belongs only to the trusted main-window top frame. */
export interface PluginHostAPI {
  request(input: PluginManageRequest): Promise<PluginHostResult>
  onChanged(callback: () => void): () => void
  onEvent(callback: (event: PluginHostEvent) => void): () => void
}
