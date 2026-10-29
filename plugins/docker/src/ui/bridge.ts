import type { PluginApi, JsonValue } from '@janusx/plugin-sdk'
export let api: PluginApi
export function setApi(value: PluginApi) { api = value }
export async function call<T = void>(method: string, input: object = {}): Promise<T> {
  const response = await api.native.call({ method, input: input as JsonValue }) as { ok: boolean; data: T; error: string }
  if (!response.ok) throw new Error(response.error)
  return response.data
}
