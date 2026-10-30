import { normalizeKnowledgeAutomation, type KnowledgeAutomationSettings } from './knowledge-automation'
/** Rules always run. Legacy auto/llm-preferred enable scorer-gated refinement only. */
export type KnowledgeProcessingMode = 'auto' | 'deterministic-only' | 'llm-preferred'

export interface KnowledgeSettings {
  enabled: boolean
  mode: KnowledgeProcessingMode
  /** Legacy setting, normalized to false; candidates require explicit review. */
  autoAcceptDeterministicFacts: boolean
  automation?: KnowledgeAutomationSettings
}

const PROCESSING_MODES: ReadonlySet<KnowledgeProcessingMode> = new Set([
  'auto',
  'deterministic-only',
  'llm-preferred',
])

export const DEFAULT_KNOWLEDGE_SETTINGS: KnowledgeSettings = {
  enabled: true,
  mode: 'deterministic-only',
  autoAcceptDeterministicFacts: false,
}

export function normalizeKnowledgeSettings(
  input?: Partial<KnowledgeSettings> | null,
): KnowledgeSettings {
  const source = input ?? {}
  return {
    enabled:
      typeof source.enabled === 'boolean'
        ? source.enabled
        : DEFAULT_KNOWLEDGE_SETTINGS.enabled,
    mode:
      typeof source.mode === 'string' && PROCESSING_MODES.has(source.mode as KnowledgeProcessingMode)
        ? (source.mode as KnowledgeProcessingMode)
        : DEFAULT_KNOWLEDGE_SETTINGS.mode,
    autoAcceptDeterministicFacts: false,
    ...(source.automation ? { automation: normalizeKnowledgeAutomation(source.automation) } : {}),
  }
}
