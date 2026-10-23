// Note: .agents/notes/workbench/plugin-contract-v1.md — default-model snapshot stays inside the host.
import { createHash } from 'node:crypto'
import { ProviderFactory } from '@janusx/llm-core'
import { llmService } from '../llm/LlmService'
import { resolveChatModelBudget } from '../llm/chat-model-budget'
import { streamText } from '../llm/ai-runtime'
import type { PluginModelBackend, PluginModelChunk } from './models'

const fingerprint = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
export const hostPluginModelBackend: PluginModelBackend = {
  async resolve() {
    const selected = await llmService.getDefaultModel()
    if (!selected || !['api-key', 'anthropic', 'none'].includes(selected.provider.authType)) return null
    const snapshot = structuredClone(selected)
    const digest = fingerprint(snapshot)
    const metadata = await llmService.resolveModelMetadata(snapshot.modelId)
    const budget = resolveChatModelBudget(snapshot.modelId, undefined, snapshot.provider.extra, metadata)
    if (!budget.resolved) return null
    const model = await ProviderFactory.getInstance().createLanguageModel(snapshot.provider, snapshot.modelId, { useCache: false })
    return {
      contextWindow: budget.contextWindow, maxOutputTokens: budget.maxOutputTokens,
      secrets: snapshot.provider.apiKey ? [snapshot.provider.apiKey] : [],
      current: async () => fingerprint(await llmService.getDefaultModel()) === digest,
      async *stream(instruction, prompt, maxTokens, signal): AsyncIterable<PluginModelChunk> {
        const result = await streamText({ model, system: instruction, prompt, maxTokens, maxRetries: 0, maxSteps: 1,
          abortSignal: signal })
        for await (const part of result.fullStream) {
          if (part.type === 'text-delta') yield { type: 'text', text: part.textDelta }
          if (part.type === 'finish') yield { type: 'finish', reason: part.finishReason, inputTokens: part.usage.promptTokens, outputTokens: part.usage.completionTokens }
          if (part.type === 'error') throw new Error('Model stream failed')
        }
      },
    }
  },
}
