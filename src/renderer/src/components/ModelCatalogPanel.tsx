import { InputGroup } from '@janusx/ui'
import { Input as SettingsInput, Button as SettingsButton } from '@janusx/ui'
import { useEffect, useMemo, useState } from 'react'
import { ChevronRight, RefreshCw, Search } from 'lucide-react'
import type { AiModelRegistryEntry, ModelCatalogSnapshot } from '@janusx/llm-core'
import { getModelCatalog, refreshModelCatalog } from '../services/llm'
import { asRecord, buildCapabilityList, catalogEmptyState, formatList, groupModels, pricePerMillion, readModelPricing, TOKEN_PRICE_KEYS, UNKNOWN_VENDOR } from './modelCatalogPanelLogic'
import { useI18n } from '@/i18n/useI18n'
import styles from './ModelCatalogPanel.module.css'

export function ModelCatalogPanel() {
  const { t } = useI18n('model')
  const [catalog, setCatalog] = useState<ModelCatalogSnapshot | null>(null)
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => {
    let active = true
    getModelCatalog()
      .then((snapshot) => {
        if (!active) return
        setCatalog(snapshot)
        setLoadError(null)
      })
      .catch((error: unknown) => {
        if (!active) return
        setLoadError(error instanceof Error ? error.message : t('model:error.loadFailed'))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => { active = false }
  }, [t])

  const groups = useMemo(() => groupModels(catalog?.models ?? [], query), [catalog, query])
  const resultCount = groups.reduce((count, group) => count + group.models.length, 0)
  const hasSearch = Boolean(query.trim())
  const emptyState = catalogEmptyState(loading, catalog, loadError, resultCount, hasSearch)

  async function handleRefresh(): Promise<void> {
    setRefreshing(true)
    setMessage(null)
    try {
      const result = await refreshModelCatalog()
      setCatalog(result.catalog)
      setLoadError(null)
      setMessage(result.success
        ? { kind: 'success', text: t('model:message.updated', { count: result.catalog.models.length }) }
        : { kind: 'error', text: result.error ?? t('model:message.updateFailed') })
    } catch (error) {
      setMessage({
        kind: 'error',
        text: error instanceof Error ? error.message : t('model:message.updateFailed'),
      })
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <section className={styles.root} aria-busy={loading || refreshing}>
      <div className={styles.toolbar}>
        <InputGroup as="label" className={styles.searchField}>
          <span className={styles.srOnly}>{t('model:search.label')}</span>
          <Search className={styles.searchIcon} size={15} aria-hidden="true" />
          <SettingsInput
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('model:search.placeholder')}
            className={styles.searchInput}
          />
        </InputGroup>
        <SettingsButton
          type="button"
          className={styles.refreshButton}
          onClick={handleRefresh}
          disabled={refreshing}
        >
          <RefreshCw size={14} className={refreshing ? styles.spinning : ''} aria-hidden="true" />
          {refreshing ? t('model:refresh.updating') : loadError ? t('model:refresh.retry') : t('model:refresh.updateCatalog')}
        </SettingsButton>
      </div>

      <div className={styles.summary} aria-live="polite">
        <span>{loading ? t('model:summary.loading') : t('model:summary.count', { modelCount: resultCount, vendorCount: groups.length })}</span>
        {catalog && (
          <span>
            {catalog.source === 'cache' ? t('model:summary.sourceOnline') : t('model:summary.sourceBundled')} / {formatDate(catalog.updatedAt, t)}
            {catalog.isStale ? t('model:summary.stale') : ''}
          </span>
        )}
      </div>

      {message && (
        <div className={`${styles.message} ${message.kind === 'error' ? styles.messageError : styles.messageSuccess}`} role="status">
          {message.text}
        </div>
      )}

      {emptyState === 'load-error' && (
        <div className={styles.empty} role="alert">
          <strong>{t('model:error.loadFailedTitle')}</strong>
          <span>{loadError}</span>
          <SettingsButton type="button" className={styles.inlineButton} onClick={handleRefresh} disabled={refreshing}>
            {refreshing ? t('model:refresh.updating') : t('model:refresh.retryUpdate')}
          </SettingsButton>
        </div>
      )}

      {(emptyState === 'empty-catalog' || emptyState === 'no-results') && (
        <div className={styles.empty}>
          <strong>{emptyState === 'no-results' ? t('model:empty.noResultsTitle') : t('model:empty.emptyTitle')}</strong>
          <span>{emptyState === 'no-results' ? t('model:empty.noResultsHint') : t('model:empty.emptyHint')}</span>
        </div>
      )}

      <div className={styles.groups}>
        {groups.map((group, index) => (
          <details className={styles.vendorGroup} key={group.vendor} open={hasSearch || index === 0}>
            <summary className={styles.vendorHeader}>
              <span>{group.vendor === UNKNOWN_VENDOR ? t('model:vendor.unknown') : group.vendor}</span>
              <span className={styles.count}>{group.models.length}</span>
            </summary>
            <div className={styles.modelList}>
              {group.models.map((model) => <ModelItem key={model.id} model={model} />)}
            </div>
          </details>
        ))}
      </div>
    </section>
  )
}

function ModelItem({ model }: { model: AiModelRegistryEntry }) {
  const { t } = useI18n('model')
  const capabilities = buildCapabilityList(model)

  return (
    <details className={styles.modelItem}>
      <summary className={styles.modelSummary}>
        <span className={styles.modelIdentity}>
          <strong>{model.name}</strong>
          <code>{model.id}</code>
        </span>
        <span className={styles.modelQuickMeta}>
          {model.effectiveContextWindow ? formatTokens(model.effectiveContextWindow) : t('model:model.contextUnknown')}
          <ChevronRight size={14} className={styles.chevron} aria-hidden="true" />
        </span>
      </summary>
      <div className={styles.details}>
        <section className={styles.detailSection} aria-label={t('model:sections.capabilities')}>
          <h3>{t('model:sections.capabilities')}</h3>
          <div className={styles.capacityGrid}>
            <Metadata label={t('model:meta.context')} value={formatOptionalTokens(model.effectiveContextWindow, t)} />
            <Metadata label={t('model:meta.maxOutput')} value={formatOptionalTokens(model.maxOutputTokens, t)} />
          </div>
          <Metadata label={t('model:meta.input')} value={formatList(model.inputModalities)} />
          <Metadata label={t('model:meta.output')} value={formatList(model.outputModalities)} />
          <div className={styles.capabilities}>
            {capabilities.map(capability => <span key={capability}>{t(`model:capabilities.${capability}`, { defaultValue: capability.replaceAll('_', ' ') })}</span>)}
          </div>
        </section>
        <section className={styles.detailSection} aria-label={t('model:sections.pricing')}>
          <h3>{t('model:sections.pricing')}<span>USD / 1M tokens</span></h3>
          <PricingDetails pricing={readModelPricing(model)} />
          <p className={styles.priceHint}>{t('model:pricing.sourceHint')}</p>
        </section>
        {model.description && <p className={styles.description}>{model.description}</p>}
      </div>
    </details>
  )
}

function PricingDetails({ pricing, tier = false }: { pricing: Record<string, unknown>; tier?: boolean }) {
  const { t } = useI18n('model')
  const extra = Object.entries(pricing).filter(([key, value]) =>
    !TOKEN_PRICE_KEYS.includes(key as typeof TOKEN_PRICE_KEYS[number])
    && key !== 'overrides' && key !== 'min_prompt_tokens' && value !== undefined)
  const overrides = Array.isArray(pricing.overrides) ? pricing.overrides : []
  return <>
    <dl className={styles.priceList}>
      {TOKEN_PRICE_KEYS.filter(key => (!tier && ['prompt', 'completion', 'input_cache_read', 'input_cache_write'].includes(key)) || pricing[key] !== undefined).map(key => {
        const value = pricePerMillion(pricing[key])
        return <div key={key}><dt>{t(`model:pricing.${key}`)}</dt><dd className={value === undefined ? styles.unavailable : undefined}>{value === undefined ? t('model:pricing.unavailable') : `$${value}`}</dd></div>
      })}
    </dl>
    {overrides.map((rule, index) => {
      const entry = asRecord(rule)
      const threshold = entry.min_prompt_tokens
      return <details className={styles.specialRule} key={index}>
        <summary>{typeof threshold === 'number' && Number.isFinite(threshold)
          ? t('model:pricing.tierThreshold', { count: threshold.toLocaleString() })
          : t('model:pricing.specialRule', { index: index + 1 })}</summary>
        {typeof threshold === 'number' && Number.isFinite(threshold)
          ? <><p className={styles.priceHint}>{t('model:pricing.tierHint')}</p><PricingDetails pricing={entry} tier /></>
          : <pre>{JSON.stringify(rule, null, 2)}</pre>}
      </details>
    })}
    {(extra.length > 0 || (pricing.overrides !== undefined && !Array.isArray(pricing.overrides))) && <details className={styles.specialRule}>
      <summary>{t('model:pricing.otherCharges')}</summary>
      <p className={styles.priceHint}>{t('model:pricing.rawHint')}</p>
      <dl className={styles.priceList}>{extra.map(([key, value]) => <div key={key}><dt>{t(`model:pricing.${key}`, { defaultValue: key })}</dt><dd><code>{typeof value === 'object' ? JSON.stringify(value) : String(value)}</code></dd></div>)}</dl>
      {pricing.overrides !== undefined && !Array.isArray(pricing.overrides) && <pre>{JSON.stringify(pricing.overrides, null, 2)}</pre>}
    </details>}
  </>
}

function Metadata({ label, value }: { label: string; value?: string }) {
  if (!value) return null
  return <div className={styles.metadata}><span>{label}</span><strong>{value}</strong></div>
}

type TFunc = (key: string, opts?: Record<string, unknown>) => string

function formatTokens(value: number): string {
  return value >= 1_000_000 ? `${trimDecimal(value / 1_000_000)}M` : `${trimDecimal(value / 1_000)}K`
}

function formatOptionalTokens(value: number | undefined, t: TFunc): string | undefined {
  return value ? t('model:model.tokensSuffix', { value: formatTokens(value) }) : undefined
}

function formatDate(value: string, t: TFunc): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? t('model:model.updatedTimeUnknown') : date.toLocaleString()
}

function trimDecimal(value: number): string {
  return Number(value.toFixed(1)).toString()
}
