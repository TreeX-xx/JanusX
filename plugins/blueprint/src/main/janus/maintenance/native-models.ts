import { z } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'
import type { NativePeer } from '@janusx/plugin-sdk/native'
import { json } from '../../blueprint/review/native-models'
import type { MaintenanceModelPort } from './ports'

const selection = z.object({ providerId: z.string(), modelId: z.string(), contextWindow: z.number().positive(), maxOutputTokens: z.number().positive() })
export function nativeMaintenanceModels(host: Pick<NativePeer, 'call'>): MaintenanceModelPort {
  return {
    async select(providerId, modelId) { return selection.parse(await host.call('models.select', json({ providerId, modelId }))) },
    async generate(input) {
      const response = z.object({ text: z.string() }).parse(await host.call('models.generate', {
        providerId: input.model.providerId, modelId: input.model.modelId, temperature: input.temperature,
        system: input.system + '\nReturn only a JSON object matching this schema: ' + JSON.stringify(zodToJsonSchema(input.schema)),
        prompt: input.messages.map(message => message.content).join('\n\n'),
      }, input.abortSignal, 125_000))
      input.abortSignal.throwIfAborted()
      return { object: input.schema.parse(JSON.parse(response.text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''))) }
    },
  }
}
