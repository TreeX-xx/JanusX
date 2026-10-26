// Note: independent review configuration — see .agents/notes/blueprint/maintenance/note-content-review.md
import { z } from 'zod'

export const blueprintReviewSettingsSchema = z.object({
  generation: z.object({ providerId: z.string().max(500), modelId: z.string().max(500) }).strict(),
  jev: z.object({ enabled: z.boolean(), endpoint: z.string().max(2000), model: z.string().max(500) }).strict(),
  automatic: z.object({ enabled: z.boolean(), commits: z.number().int().min(1).max(10000) }).strict(),
}).strict()
export type BlueprintReviewSettings = z.infer<typeof blueprintReviewSettingsSchema>
export type BlueprintSettingsSnapshot = { value: BlueprintReviewSettings; revision: string }
export const DEFAULT_BLUEPRINT_REVIEW_SETTINGS: BlueprintReviewSettings = {
  generation: { providerId: '', modelId: '' },
  jev: { enabled: false, endpoint: 'https://api.typesafe.ai/v1/systemone', model: 'jev-1.13.0' },
  automatic: { enabled: false, commits: 5 },
}
export type ReviewConnectionFailure = 'not-configured' | 'provider-unavailable' | 'authentication' | 'forbidden' | 'model-not-found' | 'rate-limit' | 'provider-error' | 'invalid-request' | 'timeout' | 'network' | 'truncated' | 'empty-response' | 'blocked' | 'model-setup' | 'model-capacity' | 'context-limit' | 'unknown'
export interface ReviewConfigurationStatus {
  generation: { status: 'ready' | 'missing' | 'failed'; message?: string; reason?: ReviewConnectionFailure; httpStatus?: number }
  jev: { status: 'ready' | 'disabled' | 'missing' | 'failed'; message?: string }
}
