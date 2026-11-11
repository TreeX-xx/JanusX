/**
 * @file AI model registry
 * @description Loads generated model metadata and provides lookup helpers.
 */

import generatedRegistry from './models.openrouter.generated.json' with { type: 'json' }
import modelOverrides from './models.overrides.json' with { type: 'json' }
import legacyOverrides from './models.legacy-overrides.json' with { type: 'json' }
import type { ModelInfo } from '../core/types'
import type {
  AiModelMatchConfidence,
  AiModelMatchResult,
  AiModelRegistryDocument,
  AiModelRegistryEntry,
  AiModelRegistryOverride,
  AiModelRegistryOverridesDocument,
  OpenRouterModelRecord
} from './model-types'
import {
  buildModelAliases,
  buildNormalizedKeys,
  compactModelKey,
  normalizeModelKey,
  providerAuthorFromId,
  tokenizeModelName
} from './model-normalize'

/**
 * OpenRouter "always points at newest" alias entries:
 * - `~provider/...` dynamic latest namespace
 * - ids ending in `-latest` / `:latest` (e.g. `openai/gpt-chat-latest`)
 */
export function isOpenRouterLatestAlias(model: { id?: string }): boolean {
  const id = model.id
  if (!id) return false
  if (id.startsWith('~')) return true
  return /[:/-]latest$/i.test(id)
}

export function openRouterRecordToRegistryEntry(record: OpenRouterModelRecord): AiModelRegistryEntry | null {
  if (!record.id || !record.name) return null
  if (isOpenRouterLatestAlias(record)) return null

  const providerContextLength = readPositiveNumber(record.top_provider?.context_length)
  const contextLength = readPositiveNumber(record.context_length)
  const effectiveContextWindow = providerContextLength ?? contextLength
  const aliases = buildModelAliases(record.id, record.name)

  return {
    id: record.id,
    canonicalSlug: record.id.replace(/:free$/u, ''),
    name: record.name,
    description: record.description,
    source: 'openrouter',
    providerAuthor: providerAuthorFromId(record.id),
    createdAt: typeof record.created === 'number'
      ? new Date(record.created * 1000).toISOString()
      : undefined,
    createdUnix: readPositiveNumber(record.created),
    contextLength,
    providerContextLength,
    effectiveContextWindow,
    maxOutputTokens: readPositiveNumber(record.top_provider?.max_completion_tokens),
    inputModalities: record.architecture?.input_modalities,
    outputModalities: record.architecture?.output_modalities,
    tokenizer: record.architecture?.tokenizer,
    supportedParameters: record.supported_parameters,
    pricing: record.pricing,
    promptPricePerToken: record.pricing?.prompt,
    completionPricePerToken: record.pricing?.completion,
    aliases,
    normalizedKeys: buildNormalizedKeys(record.id, record.name, aliases),
    raw: record
  }
}

export function matchAiModel(
  query: string,
  models = getAllAiModels()
): AiModelMatchResult {
  const trimmed = query.trim()
  if (!trimmed) {
    return { match: null, confidence: 'none', candidates: [] }
  }

  const exact = models.find(model => model.id === trimmed || model.canonicalSlug === trimmed)
  if (exact) {
    return { match: exact, confidence: 'exact', candidates: [exact] }
  }

  const normalized = normalizeModelKey(trimmed)
  const compact = compactModelKey(trimmed)
  const normalizedExact = models.find(model =>
    model.normalizedKeys.includes(normalized) || model.normalizedKeys.includes(compact)
  )
  if (normalizedExact) {
    return { match: normalizedExact, confidence: 'high', candidates: [normalizedExact] }
  }

  const scored = models
    .map(model => ({ model, score: scoreModelMatch(trimmed, model) }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)

  const candidates = scored.slice(0, 5).map(item => item.model)
  const best = scored[0]
  if (!best) {
    return { match: null, confidence: 'none', candidates: [] }
  }

  const second = scored[1]?.score ?? 0
  const confidence = confidenceFromScore(best.score, second)
  return {
    match: confidence === 'low' ? null : best.model,
    confidence,
    candidates
  }
}

export function applyModelMetadata(model: ModelInfo): ModelInfo {
  const match = matchAiModel(model.id)
  if (!match.match || match.confidence === 'low' || match.confidence === 'none') {
    return model
  }

  const registryModel = match.match
  const supportsVision = registryModel.inputModalities?.includes('image')
    || registryModel.inputModalities?.includes('file')
    || model.supportsVision
  const supportsFunctionCalling = registryModel.supportedParameters?.includes('tools')
    || registryModel.supportedParameters?.includes('tool_choice')
    || model.supportsFunctionCalling

  return {
    ...model,
    name: model.name || registryModel.name,
    contextWindow: registryModel.effectiveContextWindow ?? model.contextWindow,
    maxOutputTokens: registryModel.maxOutputTokens ?? model.maxOutputTokens,
    inputPricing: parseTokenPricePerMillion(registryModel.promptPricePerToken) ?? model.inputPricing,
    outputPricing: parseTokenPricePerMillion(registryModel.completionPricePerToken) ?? model.outputPricing,
    supportsVision,
    supportsFunctionCalling,
    description: model.description || registryModel.description
  }
}

export function registryEntryToModelInfo(
  entry: AiModelRegistryEntry,
  providerId: string = entry.source
): ModelInfo {
  const inputModalities = entry.inputModalities ?? []
  const supportedParameters = entry.supportedParameters ?? []

  return {
    id: entry.id,
    name: entry.name,
    providerId,
    capabilities: {
      chat: true,
      completion: true,
      embedding: inputModalities.includes('text') && entry.outputModalities?.includes('embedding')
    },
    contextWindow: entry.effectiveContextWindow,
    maxOutputTokens: entry.maxOutputTokens,
    inputPricing: parseTokenPricePerMillion(entry.promptPricePerToken),
    outputPricing: parseTokenPricePerMillion(entry.completionPricePerToken),
    supportsFunctionCalling: supportedParameters.includes('tools')
      || supportedParameters.includes('tool_choice'),
    supportsVision: inputModalities.includes('image') || inputModalities.includes('file'),
    description: entry.description
  }
}

export function getOpenRouterModelInfos(providerId = 'openrouter'): ModelInfo[] {
  return registryModels.map(model => registryEntryToModelInfo(model, providerId))
}

export function getAllAiModels(): AiModelRegistryEntry[] {
  return registryModels
}

export function getAiModelRegistryMetadata(): Omit<AiModelRegistryDocument, 'models'> {
  return {
    schemaVersion: generated.schemaVersion,
    source: generated.source,
    updatedAt: generated.updatedAt,
    cutoffCreatedAt: generated.cutoffCreatedAt,
    modelCount: registryModels.length
  }
}

function scoreModelMatch(query: string, model: AiModelRegistryEntry): number {
  const queryTokens = tokenizeModelName(query)
  if (queryTokens.length === 0) return 0

  const queryCompact = queryTokens.join('')
  let best = 0

  for (const key of model.normalizedKeys) {
    const keyCompact = key.replace(/\s+/gu, '')
    if (key === queryCompact || key === queryTokens.join(' ')) best = Math.max(best, 0.96)
    if (keyCompact === queryCompact) best = Math.max(best, 0.94)

    const keyTokens = key.split(/\s+/u).filter(Boolean)
    const overlap = queryTokens.filter(token => keyTokens.includes(token)).length
    const coverage = overlap / Math.max(queryTokens.length, keyTokens.length)
    best = Math.max(best, coverage)
  }

  return best
}

function confidenceFromScore(score: number, secondScore: number): AiModelMatchConfidence {
  const margin = score - secondScore
  if (score >= 0.95) return 'high'
  if (score >= 0.8 && margin >= 0.15) return 'high'
  if (score >= 0.65 && margin >= 0.15) return 'medium'
  return 'low'
}

function mergeOverrides(
  models: AiModelRegistryEntry[],
  overrides: AiModelRegistryOverride[]
): AiModelRegistryEntry[] {
  const byId = new Map(models.map(model => [model.id, model]))

  for (const override of overrides) {
    const existing = byId.get(override.id)
    const aliases = buildModelAliases(
      override.id,
      override.name ?? existing?.name ?? override.id,
      [...(existing?.aliases ?? []), ...(override.aliases ?? [])]
    )

    const merged: AiModelRegistryEntry = {
      ...(existing ?? {
        id: override.id,
        name: override.name ?? override.id,
        source: override.source ?? 'openrouter',
        aliases: [],
        normalizedKeys: []
      }),
      ...override,
      source: override.source ?? existing?.source ?? 'openrouter',
      aliases,
      effectiveContextWindow: override.effectiveContextWindow
        ?? override.providerContextLength
        ?? override.contextLength
        ?? existing?.effectiveContextWindow,
      normalizedKeys: buildNormalizedKeys(
        override.id,
        override.name ?? existing?.name ?? override.id,
        aliases
      )
    }

    byId.set(override.id, merged)
  }

  return Array.from(byId.values()).sort((a, b) => a.id.localeCompare(b.id))
}

function readPositiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
}

function parseTokenPricePerMillion(value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return undefined
  return parsed * 1_000_000
}

const generated = generatedRegistry as AiModelRegistryDocument
const overrides = modelOverrides as AiModelRegistryOverridesDocument
const legacy = legacyOverrides as AiModelRegistryOverridesDocument

const registryModels = mergeOverrides(
  generated.models,
  [...overrides.overrides, ...legacy.overrides]
).filter((model) => !isOpenRouterLatestAlias(model))
