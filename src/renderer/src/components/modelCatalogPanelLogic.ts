import type { AiModelRegistryEntry, ModelCatalogSnapshot } from '@janusx/llm-core'

export const UNKNOWN_VENDOR = '__unknown_vendor__'

export interface ModelCatalogGroup {
  vendor: string
  models: AiModelRegistryEntry[]
}

export type ModelCatalogEmptyState = 'load-error' | 'empty-catalog' | 'no-results' | null

export function groupModels(models: AiModelRegistryEntry[], rawQuery: string, unknownLabel = ''): ModelCatalogGroup[] {
  const query = rawQuery.trim().toLocaleLowerCase()
  const groups = new Map<string, AiModelRegistryEntry[]>()

  for (const model of models) {
    const vendor = model.providerAuthor?.trim() || UNKNOWN_VENDOR
    const vendorLabel = vendor === UNKNOWN_VENDOR ? unknownLabel : vendor
    if (query && !vendorLabel.toLocaleLowerCase().includes(query) && !model.name.toLocaleLowerCase().includes(query) && !model.id.toLocaleLowerCase().includes(query)) {
      continue
    }

    const group = groups.get(vendor) ?? []
    group.push(model)
    groups.set(vendor, group)
  }

  return Array.from(groups, ([vendor, groupedModels]) => ({
    vendor,
    models: groupedModels.sort((a, b) => a.name.localeCompare(b.name)),
  })).sort((a, b) => {
    if (a.vendor === UNKNOWN_VENDOR) return 1
    if (b.vendor === UNKNOWN_VENDOR) return -1
    return a.vendor.localeCompare(b.vendor)
  })
}

export function buildCapabilityList(model: AiModelRegistryEntry): string[] {
  return dedupe(model.supportedParameters ?? [])
}

export function catalogEmptyState(
  loading: boolean,
  catalog: ModelCatalogSnapshot | null,
  loadError: string | null,
  resultCount: number,
  hasQuery: boolean,
): ModelCatalogEmptyState {
  if (loading) return null
  if (loadError && !catalog) return 'load-error'
  if (!catalog || catalog.models.length === 0) return 'empty-catalog'
  return resultCount === 0 && hasQuery ? 'no-results' : null
}

export function formatList(value?: string[]): string | undefined {
  return value?.length ? dedupe(value).join(' / ') : undefined
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)))
}

export const TOKEN_PRICE_KEYS = [
  'prompt', 'completion', 'input_cache_read', 'input_cache_write',
  'input_cache_write_1h', 'input_audio_cache', 'internal_reasoning',
] as const

export function readModelPricing(model: AiModelRegistryEntry): Record<string, unknown> {
  return {
    prompt: model.promptPricePerToken,
    completion: model.completionPricePerToken,
    ...asRecord(asRecord(model.raw).pricing),
    ...asRecord(model.pricing),
  }
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {}
}

// Unknown and malformed prices must never become a free rate.
export function pricePerMillion(value: unknown): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined
  if (typeof value === 'string' && !value.trim()) return undefined
  const amount = Number(value)
  if (!Number.isFinite(amount) || amount < 0 || !Number.isFinite(amount * 1_000_000)) return undefined
  return (amount * 1_000_000).toLocaleString(undefined, { maximumSignificantDigits: 10 })
}
