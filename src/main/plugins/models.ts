// Note: .agents/notes/workbench/plugin-contract-v1.md — P6 bounded host model mediation.
import { PluginError, pluginModelStepSchema, type PluginManifest, type PluginModelResult } from '@janusx/plugin-sdk'

export type PluginModelChunk = { type: 'text'; text: string }
  | { type: 'finish'; reason: string; inputTokens?: number; outputTokens?: number }
/** Private host port. Model handles, route configuration and secrets never cross the plugin bridge. */
export interface PluginModelRoute {
  contextWindow: number; maxOutputTokens: number; secrets: string[]
  current(): Promise<boolean>
  stream(instruction: string, prompt: string, maxTokens: number, signal: AbortSignal): AsyncIterable<PluginModelChunk>
}
export interface PluginModelBackend { resolve(): Promise<PluginModelRoute | null> }

function abortable<T>(value: PromiseLike<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new PluginError('CANCELLED', 'Model request stopped.'))
    signal.addEventListener('abort', abort, { once: true })
    Promise.resolve(value).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
    if (signal.aborted) abort()
  })
}

export class PluginModels {
  private attempts = new Map<string, number[]>()
  private active = new Set<string>()
  constructor(private backend?: PluginModelBackend) {}
  async generate(manifest: PluginManifest, step: unknown, prompt: unknown, valid: () => void, signal: AbortSignal): Promise<PluginModelResult> {
    valid()
    if (!manifest.permissions.some(item => item.name === 'models.generate') || !manifest.capabilities.required.includes('models.generate')) throw new PluginError('PERMISSION_DENIED', 'Model permission is missing.')
    const parsed = pluginModelStepSchema.safeParse(step)
    if (!parsed.success || typeof prompt !== 'string' || !prompt.trim() || prompt.length > 4096) throw new PluginError('INVALID_REQUEST', 'Model input is invalid.')
    if (signal.aborted) throw new PluginError('CANCELLED', 'Model request stopped.')
    if (!this.backend) throw new PluginError('MODEL_UNAVAILABLE', 'Host model is unavailable.')
    const now = Date.now()
    for (const [id, times] of this.attempts) {
      const recent = times.filter(time => now - time < 60_000)
      if (recent.length) this.attempts.set(id, recent); else this.attempts.delete(id)
    }
    const own = this.attempts.get(manifest.id) ?? []
    if (this.active.has(manifest.id) || this.active.size >= 2 || own.length >= 2 || [...this.attempts.values()].reduce((sum, times) => sum + times.length, 0) >= 8) throw new PluginError('RATE_LIMITED', 'Model budget reached.')
    this.attempts.set(manifest.id, [...own, now]); this.active.add(manifest.id)
    const controller = new AbortController(); const abort = () => controller.abort()
    signal.addEventListener('abort', abort, { once: true })
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; controller.abort() }, 30_000)
    const check = () => { valid(); if (controller.signal.aborted) throw new PluginError('CANCELLED', 'Model request stopped.') }
    let iterator: AsyncIterator<PluginModelChunk> | undefined
    try {
      if (signal.aborted) controller.abort()
      const route = await abortable(this.backend.resolve(), controller.signal); check()
      const request = parsed.data
      const promptBytes = Buffer.byteLength(prompt) + Buffer.byteLength(request.instruction)
      if (!route || !Number.isSafeInteger(route.contextWindow) || !Number.isSafeInteger(route.maxOutputTokens)
        || request.maxOutputTokens > route.maxOutputTokens || promptBytes + request.maxOutputTokens + 512 > route.contextWindow) throw new PluginError('MODEL_UNAVAILABLE', 'Model capacity is unavailable or insufficient.')
      if (!await abortable(route.current(), controller.signal)) throw new PluginError('MODEL_UNAVAILABLE', 'Host model changed.')
      check()
      iterator = route.stream(request.instruction, prompt, request.maxOutputTokens, controller.signal)[Symbol.asyncIterator]()
      let text = ''; let bytes = 0; let chunks = 0; let finish: Extract<PluginModelChunk, { type: 'finish' }> | undefined
      while (true) {
        const next = await abortable(iterator.next(), controller.signal); check()
        if (next.done) break
        if (++chunks > 4096) throw new PluginError('RATE_LIMITED', 'Model stream budget reached.')
        if (next.value.type === 'text') {
          bytes += Buffer.byteLength(next.value.text)
          if (bytes > 16 * 1024) throw new PluginError('RATE_LIMITED', 'Model output budget reached.')
          text += next.value.text
        } else finish = next.value
      }
      const tokenCount = (value?: number) => Number.isSafeInteger(value) && value! >= 0 ? value! : null
      if (!finish) throw new PluginError('MODEL_UNAVAILABLE', 'Incomplete model response.')
      const outputTokens = tokenCount(finish.outputTokens)
      if (outputTokens !== null && outputTokens > request.maxOutputTokens) throw new PluginError('RATE_LIMITED', 'Model output budget reached.')
      if (route.secrets.some(secret => secret && text.includes(secret))) throw new PluginError('MODEL_UNAVAILABLE', 'Model response was withheld.')
      if (!await abortable(route.current(), controller.signal)) throw new PluginError('MODEL_UNAVAILABLE', 'Host model changed.')
      check()
      return { text, finishReason: finish.reason === 'stop' || finish.reason === 'length' ? finish.reason : 'other',
        usage: { inputTokens: tokenCount(finish.inputTokens), outputTokens } }
    } catch (cause) {
      if (timedOut) throw new PluginError('TIMEOUT', 'Model request timed out.')
      if (signal.aborted) throw new PluginError('CANCELLED', 'Model request stopped.')
      if (cause instanceof PluginError) throw cause
      throw new PluginError('MODEL_UNAVAILABLE', 'Host model request failed.')
    } finally {
      controller.abort(); clearTimeout(timer); signal.removeEventListener('abort', abort); this.active.delete(manifest.id)
      // A provider that ignores cancellation must not hold the host task open.
      void iterator?.return?.().catch(() => {})
    }
  }
}
