import type { PluginApi, JsonValue } from '@janusx/plugin-sdk'
export let api: PluginApi
let revision = 0
export function setRevision(value: number) { revision = value }
export function setApi(value: PluginApi) { api = value }
export async function call<T = void>(method: string, input: object = {}): Promise<T> {
  const issued = revision
  const response = await api.native.call({ method, input: { ...input, ...(['environment.read', 'environment.discover'].includes(method) ? {} : { revision: issued }) } as JsonValue }) as { ok: boolean; data: T; error: string }
  if (issued !== revision && !['environment.read', 'environment.discover'].includes(method)) throw new Error('docker-target-changed')
  if (!response.ok) throw new Error(response.error)
  return response.data
}
