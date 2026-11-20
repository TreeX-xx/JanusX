export const HISTORY_ENGINES = ['claude', 'codex', 'pi', 'opencode', 'dsh'] as const
export type HistoryEngine = typeof HISTORY_ENGINES[number]
export interface HistoryLocation { engine: HistoryEngine; path: string; enabled: boolean }
export interface HistorySourceSettings { disabledAutomatic: HistoryEngine[]; locations: HistoryLocation[] }
export interface HistorySource extends HistoryLocation { automatic: boolean; namespace: string }
export interface HistorySourceStatus extends HistorySource {
  status: 'ready' | 'missing' | 'unreadable' | 'empty' | 'invalid'
  /** Readable native history does not imply that the original CLI can resume it. */
  resume: 'native-layout' | 'active-store' | 'read-only'
}
export interface HistorySourcesView { settings: HistorySourceSettings; sources: HistorySourceStatus[]; refreshWarning?: string }
export const HISTORY_SOURCE_CHANNELS = {
  get: 'history-sources:get', save: 'history-sources:save', pick: 'history-sources:pick',
} as const
export function normalizeHistorySourceSettings(value: unknown): HistorySourceSettings {
  const input = value as Partial<HistorySourceSettings> | null
  const engine = (value: unknown): value is HistoryEngine => HISTORY_ENGINES.includes(value as HistoryEngine)
  return {
    disabledAutomatic: Array.isArray(input?.disabledAutomatic) ? [...new Set(input.disabledAutomatic.filter(engine))] : [],
    locations: Array.isArray(input?.locations) ? input.locations.slice(0, 32).flatMap(item =>
      item && engine(item.engine) && typeof item.path === 'string' && item.path.trim() && item.path.length < 4096
        ? [{ engine: item.engine, path: item.path.trim(), enabled: item.enabled !== false }] : []) : [],
  }
}
