import type { PluginErrorCode } from './errors.js'

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }
export interface PluginCallOptions { signal?: AbortSignal }
export interface PluginContext {
  project: { projectId: string; rootId: string; name: string } | null
  revision: number
  active: boolean
}
export interface PluginStoredValue { found: boolean; value?: JsonValue; revision: number }
export type PluginUnsubscribe = () => void
/** P1 public types. An authorized P2 transport must supply the implementation. */
export interface PluginApi {
  app: { getInfo(options?: PluginCallOptions): Promise<{ pluginApiVersion: string; capabilities: string[]; locale: string; theme: { id: string; tokens: Record<string, string> } }> }
  workspace: {
    getContext(options?: PluginCallOptions): Promise<PluginContext>
    readText(params: { path: string }, options?: PluginCallOptions): Promise<{ text: string; bytes: number }>
  }
  views: { open(params: { view: string }, options?: PluginCallOptions): Promise<{ instanceId: string }> }
  ui: { showToast(params: { message: string; level?: 'info' | 'warning' | 'error' }, options?: PluginCallOptions): Promise<{ shown: boolean }> }
  storage: {
    get(params: { key: string }, options?: PluginCallOptions): Promise<PluginStoredValue>
    set(params: { key: string; value: JsonValue; expectedRevision?: number }, options?: PluginCallOptions): Promise<{ revision: number }>
    delete(params: { key: string; expectedRevision?: number }, options?: PluginCallOptions): Promise<{ revision: number }>
    watch(params: { keys: string[] }, listener: (values: Record<string, PluginStoredValue>) => void, options?: PluginCallOptions): Promise<{ values: Record<string, PluginStoredValue>; unsubscribe: PluginUnsubscribe }>
  }
  context: { subscribe(listener: (event: { active?: boolean; locale?: string; theme?: { id: string; tokens: Record<string, string> }; invalidated?: boolean }) => void, options?: PluginCallOptions): Promise<PluginUnsubscribe> }
}
export interface PluginRequest { protocol: 1; requestId: string; type: 'request'; method: string; params: unknown; contextRevision: number }
export type PluginResponse = { protocol: 1; requestId: string; type: 'response' } & (
  { ok: true; result: JsonValue } | { ok: false; error: { code: PluginErrorCode; message: string } }
)
