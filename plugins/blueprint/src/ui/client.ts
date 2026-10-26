import { connectPlugin, type PluginApi } from '@janusx/plugin-sdk'
import type { BlueprintJob } from '../shared/native-contract'
import { t } from './i18n'
import { paceBlueprintApi } from './request-budget'

let api: PluginApi
const messages: Record<string, string> = {
  RESOURCE_CHANGED: '内容或设置已在其它页面修改。当前草稿已保留，请重新读取后核对。',
  STORAGE_CONFLICT: '草稿已在其它页面修改，请先重新读取。',
  PATH_NOT_GRANTED: '当前项目未授权，请到插件设置中检查项目范围。',
  RATE_LIMITED: '已有任务正在运行或请求过于频繁，请稍后重试。',
  CONTEXT_LIMIT: '讨论已达到容量限制，请保存需要的内容并开始新讨论。',
  SOURCE_UNAVAILABLE: '蓝图后台未运行，请在插件设置中重新启用。',
  TIMEOUT: '请求超时，请检查连接后重试。',
  SERVICE_STOPPED: '蓝图后台已停止，请重新打开插件。',
  BLUEPRINT_OPERATION_FAILED: '操作未完成，请刷新当前文档和任务状态后重试。',
}
function failure(code: string) { return new Error(messages[code] ? `${t(messages[code])} (${code})` : code) }
export async function connect() { api = paceBlueprintApi(await connectPlugin()); return api }
export function plugin() { return api }
export async function call<T>(method: string, input: unknown = null, signal?: AbortSignal): Promise<T> {
  try { return await api.native.call({ method, input: JSON.parse(JSON.stringify(input)) }, { signal }) as T }
  catch (cause) { const code = (cause as { code?: string }).code; if (code && messages[code]) throw failure(code); throw cause }
}
export async function job<T>(method: string, input: unknown, signal: AbortSignal, progress?: (job: BlueprintJob) => void): Promise<T> {
  const { id } = await call<{ id: string }>(method, input, signal)
  const cancel = () => { void call('jobs.cancel', id).catch(() => {}) }
  signal.addEventListener('abort', cancel, { once: true })
  if (signal.aborted) cancel()
  try {
    for (;;) {
      signal.throwIfAborted()
      const state = await call<BlueprintJob>('jobs.read', id, signal)
      progress?.(state)
      if (state.status === 'completed') return state.result as T
      if (state.status !== 'running') throw failure(state.error ?? state.status)
      await new Promise<void>((resolve, reject) => {
        const abort = () => { clearTimeout(timer); reject(signal.reason) }
        const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve() }, 500)
        signal.addEventListener('abort', abort, { once: true })
      })
    }
  } finally { signal.removeEventListener('abort', cancel) }
}
