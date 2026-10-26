import { z } from 'zod'
import { NativeServiceError, nativeValueSchema, type NativeHandler, type JsonValue } from '@janusx/plugin-sdk'
import type { InstalledPlugin } from '../../shared/ipc/plugins'
import { llmService } from '../llm/LlmService'
import { generateText } from '../llm/ai-runtime'
import { modelEndpoint, modelJsonRequest } from '../llm/model-json'
import { resolveChatModelBudget } from '../llm/chat-model-budget'

export interface NativeModelCredentials {
  read(slot: string, origin: string): Promise<string>
  status(slot: string, origin: string): Promise<boolean>
  set?(slot: string, origin: string, value: string): Promise<void>
}
/** Cancellation settles the host call even when a provider ignores its AbortSignal. */
export function nativeAbortable<T>(promise: PromiseLike<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new NativeServiceError('CANCELLED'))
    signal.addEventListener('abort', abort, { once: true })
    Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
    if (signal.aborted) abort()
  })
}
const selection = z.object({ providerId: z.string().min(1).max(256), modelId: z.string().min(1).max(256) }).strict()
const generation = selection.extend({ system: z.string().max(64_000), prompt: z.string().max(400_000), temperature: z.number().min(0).max(2).optional() }).strict()
const score = z.object({ slot: z.string().min(1).max(128), endpoint: z.string().url().max(2048), model: z.string().min(1).max(256),
  state: nativeValueSchema, question: z.string().min(1).max(100_000) }).strict()

/** Public metadata and fixed response schemas only. Provider configuration and keys stay here. */
export function nativeModelsHost(record: InstalledPlugin, credentials: NativeModelCredentials): NativeHandler {
  let active = 0
  const attempts: number[] = []
  return async (method, value, signal): Promise<JsonValue> => {
    if (!record.manifest.permissions.some(permission => permission.name === 'models.generate')) throw new NativeServiceError('PERMISSION_DENIED')
    // Write-only credential editing for a declared slot; existing keys never leave the host.
    if (method === 'models.credential-status' || method === 'models.credential-set') {
      const parsed = (method === 'models.credential-set'
        ? z.object({ slot: z.string().min(1).max(128), value: z.string().max(4096).regex(/^[\x21-\x7e]*$/) }).strict()
        : z.object({ slot: z.string().min(1).max(128) }).strict()).safeParse(value)
      if (!parsed.success) throw new NativeServiceError('INVALID_REQUEST')
      const input = parsed.data
      const slot = record.manifest.contributes.credentials?.find(slot => slot.id === input.slot)
      if (!slot || !record.manifest.permissions.some(permission => permission.name === 'credentials.use')) throw new NativeServiceError('PERMISSION_DENIED')
      signal.throwIfAborted()
      if ('value' in input) {
        if (!credentials.set) throw new NativeServiceError('UNKNOWN_METHOD')
        await credentials.set(slot.id, slot.origin, input.value as string)
      }
      return { configured: await credentials.status(slot.id, slot.origin) }
    }
    const now = Date.now()
    while (attempts.length && now - attempts[0] > 60_000) attempts.shift()
    if (active >= 2 || attempts.length >= 24) throw new NativeServiceError('RATE_LIMITED')
    active++; attempts.push(now)
    const boundedSignal = AbortSignal.any([signal, AbortSignal.timeout(method === 'models.generate' ? 120_000 : 25_000)])
    try {
      if (method === 'models.catalog') {
        const providers = await nativeAbortable(llmService.getTerminalProviders('janus'), boundedSignal)
        return await nativeAbortable(Promise.all(providers.filter(provider => provider.enabled !== false).map(async provider => ({
          id: provider.id, name: provider.name,
          models: (await llmService.listModels('janus', provider.id)).map(model => ({ id: model.id, name: model.name ?? model.id })),
        }))), boundedSignal)
      }
      if (method === 'models.probe') {
        const input = selection.parse(value)
        const model = await nativeAbortable(llmService.getLanguageModel('janus', input.providerId, input.modelId), boundedSignal)
        const result = await nativeAbortable(generateText({ model, prompt: 'Connection test. Reply with OK.', maxTokens: 1024, maxRetries: 0, abortSignal: boundedSignal }), boundedSignal)
        if (result.finishReason !== 'stop' || !result.text.trim()) throw new NativeServiceError('MODEL_UNAVAILABLE')
        return { ready: true }
      }
      if (method === 'models.select') {
        const input = z.object({ providerId: z.string().max(256), modelId: z.string().max(256).optional() }).strict().parse(value)
        const selected = input.providerId ? { provider: { id: input.providerId }, modelId: input.modelId ?? '' } : await nativeAbortable(llmService.getDefaultModel(), boundedSignal)
        if (!selected || !selected.modelId) throw new NativeServiceError('MODEL_UNAVAILABLE')
        const provider = await nativeAbortable(llmService.getProviderSettings('janus', selected.provider.id), boundedSignal)
        if (!provider || provider.enabled === false) throw new NativeServiceError('MODEL_UNAVAILABLE')
        const metadata = await nativeAbortable(llmService.resolveModelMetadata(selected.modelId), boundedSignal)
        const budget = resolveChatModelBudget(selected.modelId, undefined, provider.extra, metadata)
        if (!budget.resolved) throw new NativeServiceError('MODEL_UNAVAILABLE')
        return { providerId: selected.provider.id, modelId: selected.modelId, contextWindow: budget.contextWindow, maxOutputTokens: budget.maxOutputTokens }
      }
      if (method === 'models.generate') {
        const input = generation.parse(value)
        const provider = await nativeAbortable(llmService.getProviderSettings('janus', input.providerId), boundedSignal)
        if (!provider || provider.enabled === false) throw new NativeServiceError('MODEL_UNAVAILABLE')
        const metadata = await nativeAbortable(llmService.resolveModelMetadata(input.modelId), boundedSignal)
        const budget = resolveChatModelBudget(input.modelId, undefined, provider.extra, metadata)
        if (!budget.resolved) throw new NativeServiceError('MODEL_UNAVAILABLE')
        const model = await nativeAbortable(llmService.getLanguageModel('janus', input.providerId, input.modelId), boundedSignal)
        const result = await nativeAbortable(generateText({ model, system: input.system, prompt: input.prompt, maxTokens: budget.maxOutputTokens,
          temperature: input.temperature, maxRetries: 0, abortSignal: boundedSignal }), boundedSignal)
        if (result.finishReason !== 'stop' || !result.text.trim() || provider.apiKey && result.text.includes(provider.apiKey)) throw new NativeServiceError('MODEL_UNAVAILABLE')
        return { text: result.text }
      }
      if (method === 'models.verify') {
        const input = score.parse(value), url = modelEndpoint(input.endpoint)
        const network = record.manifest.permissions.find(permission => permission.name === 'network.fetch')
        const slot = record.manifest.contributes.credentials?.find(slot => slot.id === input.slot && slot.origin === url.origin)
        if (!network?.origins.includes(url.origin) || !slot || !record.manifest.permissions.some(permission => permission.name === 'credentials.use')) throw new NativeServiceError('PERMISSION_DENIED')
        const key = await nativeAbortable(credentials.read(slot.id, slot.origin), boundedSignal)
        await nativeAbortable(llmService.initialize(), boundedSignal)
        const raw = await nativeAbortable(modelJsonRequest(url, { model: input.model, state: JSON.stringify(input.state),
          questions: { support: { type: 'noul', instructions: input.question } } }, boundedSignal, key, 64 * 1024), boundedSignal)
        // Return the declared score only, never a credentialed response body or provider error.
        const response = z.object({ model: z.literal(input.model), answers: z.object({ support: z.object({ type: z.literal('noul'), noul: z.number().min(0).max(1) }).strict() }).strict() }).parse(raw)
        return { model: input.model, score: response.answers.support.noul }
      }
      throw new NativeServiceError('UNKNOWN_METHOD')
    } catch (cause) {
      if (signal.aborted) throw new NativeServiceError('CANCELLED')
      if (boundedSignal.aborted) throw new NativeServiceError('TIMEOUT')
      if (cause instanceof NativeServiceError) throw cause
      if (cause instanceof z.ZodError) throw new NativeServiceError('INVALID_REQUEST')
      throw new NativeServiceError('MODEL_UNAVAILABLE')
    } finally { active-- }
  }
}
