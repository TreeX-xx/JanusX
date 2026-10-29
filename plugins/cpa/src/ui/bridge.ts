import type { JsonValue, PluginApi } from '@janusx/plugin-sdk'
import type { CpaSettings, CpaStatus } from '../shared/cpa'
export let api: PluginApi
export function setApi(value: PluginApi): void { api = value }
export async function call<T = void>(method: string, input: object = {}): Promise<T> {
  const result = await api.native.call({ method, input: input as JsonValue }) as {ok: boolean; data?: T; error?: string}
  if (!result.ok) throw new Error(result.error ?? 'cpa-operation-failed')
  return result.data as T
}
export type RuntimeStatus = CpaStatus & { busy: boolean; operationError?: string; revision: number }
async function completed(): Promise<void> {
  for (;;) {
    const status = await call<RuntimeStatus>('runtime.status')
    if (!status.busy) { if (status.operationError) throw new Error(status.operationError); return }
    await new Promise(resolve => setTimeout(resolve, 500))
  }
}
export const cpa = {
  getSettings: () => call<CpaSettings>('settings.read'),
  async saveSettings(settings: CpaSettings, key?: string): Promise<CpaSettings> {
    await call('settings.save', { settings, ...(key ? { key } : {}) })
    // Downloads and startup are application jobs, not a single page request with a 30s timeout.
    await completed()
    return cpa.getSettings()
  },
  status: () => call<RuntimeStatus>('runtime.status'),
  start: () => call('runtime.start'), stop: () => call('runtime.stop'),
  async restart() { await call('runtime.restart'); await completed() },
  async update() { await call('runtime.update'); await completed() },
  copyManagementKey: () => call('runtime.copy-key'), openLogs: () => call('runtime.logs'),
}
