import type { WorkerBackend } from './superagent'
export type { WorkerBackend } from './superagent'
/** Desktop preferences. Null keeps the selected engine's native default. */
export interface WorkerModelSettings {
  terminal: WorkerBackend
  model: string | null
  effort: string | null
}

export const DEFAULT_WORKER_MODEL_SETTINGS: WorkerModelSettings = { terminal: 'codex', model: null, effort: null }
export interface WorkerPolicy { defaultBackend: WorkerBackend; enabled: WorkerBackend[] }
export const DEFAULT_WORKER_POLICY: WorkerPolicy = { defaultBackend: 'codex', enabled: ['codex', 'claude'] }
export function parseWorkerPolicy(value: unknown): WorkerPolicy {
  if (!value || typeof value !== 'object') throw new Error('Invalid Worker policy')
  const row = value as WorkerPolicy
  if (Object.keys(row).some(key => !['defaultBackend', 'enabled'].includes(key))
    || !['codex', 'claude'].includes(row.defaultBackend) || !Array.isArray(row.enabled)
    || !row.enabled.length || row.enabled.some(backend => !['codex', 'claude'].includes(backend))
    || new Set(row.enabled).size !== row.enabled.length || !row.enabled.includes(row.defaultBackend)) throw new Error('Default Worker must be enabled')
  return { defaultBackend: row.defaultBackend, enabled: [...row.enabled] }
}
export function parseWorkerModelSettings(value: unknown): WorkerModelSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid Worker settings')
  const row = value as Record<string, unknown>
  if (Object.keys(row).some(key => !['terminal', 'model', 'effort'].includes(key)) || !['codex', 'claude'].includes(row.terminal as string)) {
    throw new Error('Unsupported Worker backend')
  }
  if (row.model !== null && (typeof row.model !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}$/.test(row.model))) {
    throw new Error('Invalid Worker model ID')
  }
  if (row.effort !== null && (typeof row.effort !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(row.effort))) {
    throw new Error('Invalid Worker reasoning effort')
  }
  return { terminal: row.terminal as WorkerBackend, model: row.model as string | null, effort: row.effort as string | null }
}

export interface WorkerSettingsIdentity { workspaceId: string; workId: string; executionId: string }
export interface WorkerSettingsState {
  selection: WorkerModelSettings
  inherited: boolean
  /** Cleared only after authoritative native settings readback matches the request. */
  pending: boolean
  error?: string
}

/** Global residency policy, independent of per-execution model selections. */
export const DEFAULT_WORKER_IDLE_MINUTES = 30
export const MAX_WORKER_IDLE_MINUTES = 10080
export function parseWorkerIdleMinutes(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > MAX_WORKER_IDLE_MINUTES) {
    throw new Error('Invalid Worker idle timeout')
  }
  return value
}
