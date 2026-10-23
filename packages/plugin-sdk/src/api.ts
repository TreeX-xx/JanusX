import type { PluginContextRead, PluginDocumentContextCatalog, PluginDocumentContextResource } from './context.js'
import type { PluginErrorCode } from './errors.js'
import type { PluginIslandStatus } from './island.js'
import type { PluginDocument } from './documents.js'
import type { PluginConfiguration, PluginSettingValue } from './configuration.js'
import type { PluginNetworkRequest, PluginNetworkResult, PluginMessage, PluginPublicEvent, PluginTaskRun } from './background.js'

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }
export interface PluginCallOptions { signal?: AbortSignal }
export interface PluginContext {
  project: { projectId: string; rootId: string; name: string } | null
  revision: number
  active: boolean
  document?: PluginDocument
  /** This plugin declares user settings; SDK consumers may read/watch them. */
  configuration?: true
  /** This plugin opted into opening its host-owned settings. */
  configurationNavigation?: true
  /** Only a declared custom settings workbench may hand proposed edits to the host. */
  configurationEditor?: true
}
export interface PluginStoredValue { found: boolean; value?: JsonValue; revision: number }
export type PluginUnsubscribe = () => void
/** Public broker methods; available only through an authorized instance port. */
export interface PluginApi {
  tasks: {
    start(params: { task: string; input: PluginMessage }, options?: PluginCallOptions): Promise<{ id: string }>
    list(options?: PluginCallOptions): Promise<PluginTaskRun[]>
    cancel(params: { id: string }, options?: PluginCallOptions): Promise<{ cancelled: boolean }>
  }
  network: { fetch(params: PluginNetworkRequest, options?: PluginCallOptions): Promise<PluginNetworkResult> }
  events: {
    publish(params: { event: string; data: PluginMessage; cause?: string }, options?: PluginCallOptions): Promise<{ id: string }>
    subscribe(params: { plugin: string; event: string; version: number }, listener: (event: PluginPublicEvent) => void, options?: PluginCallOptions): Promise<PluginUnsubscribe>
  }
  services: {
    discover(options?: PluginCallOptions): Promise<Array<{ plugin: string; service: string; version: number; scope: 'application' | 'project' }>>
    call(params: { plugin: string; service: string; version: number; input: PluginMessage }, options?: PluginCallOptions): Promise<{ id: string }>
  }
  configuration: {
    /** Hands edits to the host form for review; success does not mean saved. */
    propose(params: { patch: Record<string, PluginSettingValue | null>; expectedRevision: string }, options?: PluginCallOptions): Promise<{ proposed: true }>
    /** Opens this plugin's host settings; requires configuration.open capability. */
    open(options?: PluginCallOptions): Promise<{ opened: true }>
    get(options?: PluginCallOptions): Promise<PluginConfiguration>
    watch(listener: (configuration: PluginConfiguration) => void, options?: PluginCallOptions): Promise<{ configuration: PluginConfiguration; unsubscribe: PluginUnsubscribe }>
  }
  /** Reads only the file bound by the host's viewer selection; accepts no path. */
  documents: {
    readText(options?: PluginCallOptions): Promise<{ path: string; text: string; bytes: number; version: string }>
    /** Hands a full-text draft to the host for review and saving; does not write to disk. */
    applyEdit(params: { text: string; expectedVersion: string }, options?: PluginCallOptions): Promise<{ applied: true }>
  }
  app: { getInfo(options?: PluginCallOptions): Promise<{ pluginApiVersion: string; capabilities: string[]; locale: string; theme: { id: string; tokens: Record<string, string> } }> }
  workspace: {
    getContext(options?: PluginCallOptions): Promise<PluginContext>
    readText(params: { path: string }, options?: PluginCallOptions): Promise<{ text: string; bytes: number }>
  }
  views: { open(params: { view: string }, options?: PluginCallOptions): Promise<{ instanceId: string }> }
  island: { update(params: { id: string; status: PluginIslandStatus | null }, options?: PluginCallOptions): Promise<{ updated: boolean }> }
  ui: { showToast(params: { message: string; level?: 'info' | 'warning' | 'error' }, options?: PluginCallOptions): Promise<{ shown: boolean }> }
  storage: {
    get(params: { key: string }, options?: PluginCallOptions): Promise<PluginStoredValue>
    set(params: { key: string; value: JsonValue; expectedRevision?: number }, options?: PluginCallOptions): Promise<{ revision: number }>
    delete(params: { key: string; expectedRevision?: number }, options?: PluginCallOptions): Promise<{ revision: number }>
    watch(params: { keys: string[] }, listener: (values: Record<string, PluginStoredValue>) => void, options?: PluginCallOptions): Promise<{ values: Record<string, PluginStoredValue>; unsubscribe: PluginUnsubscribe }>
  }
  context: {
    providers(options?: PluginCallOptions): Promise<PluginDocumentContextCatalog>
    read(params: PluginContextRead, options?: PluginCallOptions): Promise<PluginDocumentContextResource>
    subscribe(listener: (event: { active?: boolean; locale?: string; theme?: { id: string; tokens: Record<string, string> }; invalidated?: boolean }) => void, options?: PluginCallOptions): Promise<PluginUnsubscribe> }
}
export interface PluginRequest { protocol: 1; requestId: string; type: 'request'; method: string; params: unknown; contextRevision: number }
export type PluginResponse = { protocol: 1; requestId: string; type: 'response' } & (
  { ok: true; result: JsonValue } | { ok: false; error: { code: PluginErrorCode; message: string } }
)
