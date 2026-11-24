// Note: .agents/notes/workbench/settings-layout.md
import { Button as SettingsButton, Input as SettingsInput, InputGroup } from '@janusx/ui'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Boxes, Check, ChevronRight, Coins, Copy, Cpu, RefreshCw, Search, X } from 'lucide-react'
import openai from '@/assets/icons/codex.svg'
import anthropic from '@/assets/icons/claude.svg'
import deepseek from '@/assets/icons/providers/deepseek-color.svg'
import moonshot from '@/assets/icons/providers/moonshot.svg'
import qwen from '@/assets/icons/providers/qwen-color.svg'
import type { AiModelRegistryEntry, ModelCatalogSnapshot } from '@janusx/llm-core'
import { getModelCatalog, refreshModelCatalog } from '../services/llm'
import { asRecord, buildCapabilityList, catalogEmptyState, formatList, groupModels, pricePerMillion, readModelPricing, TOKEN_PRICE_KEYS, UNKNOWN_VENDOR } from './modelCatalogPanelLogic'
import { useI18n } from '@/i18n/useI18n'
import styles from './ModelCatalogPanel.module.css'

export function ModelCatalogPanel() {
  const { t, currentLanguage } = useI18n('model')
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

  const groups = useMemo(() => groupModels(catalog?.models ?? [], query, t('model:vendor.unknown')), [catalog, query, t])
  const resultCount = groups.reduce((count, group) => count + group.models.length, 0)
  const hasSearch = Boolean(query.trim())
  const emptyState = catalogEmptyState(loading, catalog, loadError, resultCount, hasSearch)

  const searchInput = useRef<HTMLInputElement>(null)
  const scrollBookmark = useRef<{ element: Element; top: number } | null>(null)
  const [browseOpen, setBrowseOpen] = useState<Record<string, boolean>>({})
  const [searchOpen, setSearchOpen] = useState<Record<string, boolean>>({})
  const open = hasSearch ? searchOpen : browseOpen
  const setOpen = hasSearch ? setSearchOpen : setBrowseOpen

  function changeQuery(next: string) {
    if (!hasSearch && next.trim()) {
      let parent = searchInput.current?.parentElement
      while (parent && !/auto|scroll/.test(getComputedStyle(parent).overflowY)) parent = parent.parentElement
      const element = parent ?? document.scrollingElement
      if (element) scrollBookmark.current = { element, top: element.scrollTop }
    }
    setSearchOpen({})
    setQuery(next)
  }

  useLayoutEffect(() => {
    const bookmark = scrollBookmark.current
    if (!bookmark) return
    bookmark.element.scrollTop = hasSearch ? 0 : bookmark.top
    if (!hasSearch) scrollBookmark.current = null
  }, [hasSearch])

  function clearSearch() {
    searchInput.current?.focus({ preventScroll: true })
    changeQuery('')
  }

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
        <InputGroup className={styles.searchField}>
          <Search className={styles.searchIcon} size={15} aria-hidden="true" />
          <SettingsInput
            ref={searchInput}
            aria-label={t('model:search.label')}
            type="search"
            value={query}
            onChange={(event) => changeQuery(event.target.value)}
            placeholder={t('model:search.placeholder')}
            className={styles.searchInput}
          />
          {query && <SettingsButton size="icon" variant="ghost" aria-label={t('model:search.clear')} onClick={clearSearch}><X size={14} /></SettingsButton>}
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

      {(loading || catalog) && (
        <div className={styles.summary} aria-live="polite">
          {loading && <span>{t('model:summary.loading')}</span>}
          {!loading && resultCount > 0 && <span>{t('model:summary.count', { modelCount: resultCount, vendorCount: groups.length })}</span>}
          {catalog && (
            <span>
              {catalog.source === 'cache' ? t('model:summary.sourceOnline') : t('model:summary.sourceBundled')} / {formatDate(catalog.updatedAt, currentLanguage, t)}
              {catalog.isStale ? t('model:summary.stale') : ''}
            </span>
          )}
        </div>
      )}

      {message && (
        <div className={`${styles.message} ${message.kind === 'error' ? styles.messageError : styles.messageSuccess}`} role="status">
          {message.text}
        </div>
      )}

      <div className={styles.groups}>
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
          <div className={styles.empty} role="status">
            <strong>{emptyState === 'no-results' ? t('model:empty.noResultsTitle') : t('model:empty.emptyTitle')}</strong>
            <span>{emptyState === 'no-results' ? t('model:empty.noResultsHint') : t('model:empty.emptyHint')}</span>
            {emptyState === 'no-results' && <SettingsButton size="small" onClick={clearSearch}>{t('model:search.clear')}</SettingsButton>}
          </div>
        )}

        {groups.map(group => {
          const key = 'vendor:' + group.vendor
          const expanded = open[key] ?? hasSearch
          const logo = vendorLogos.get(group.vendor.toLowerCase().replace(/^~/, ''))
          return <div className={styles.vendorGroup} key={key}>
            <SettingsButton variant="plain" className={styles.vendorHeader} aria-expanded={expanded}
              onClick={() => setOpen(previous => ({ ...previous, [key]: !expanded }))}>
              <ChevronRight className={styles.chevron} size={14} aria-hidden="true" />
              <span className={styles.vendorIcon} aria-hidden="true">
                {logo ? <img src={logo} alt="" /> : group.vendor === UNKNOWN_VENDOR ? <Boxes size={15} /> : group.vendor.replace(/^~/, '').slice(0, 2).toUpperCase()}
              </span>
              <span>{group.vendor === UNKNOWN_VENDOR ? t('model:vendor.unknown') : group.vendor}</span>
              <span className={styles.count}>{group.models.length}</span>
            </SettingsButton>
            {expanded && <div className={styles.modelList}>
              {group.models.map(model => {
                const modelKey = 'model:' + model.id
                return <ModelItem key={model.id} model={model} expanded={!!open[modelKey]}
                  onToggle={() => setOpen(previous => ({ ...previous, [modelKey]: !previous[modelKey] }))} />
              })}
            </div>}
          </div>
        })}
      </div>
    </section>
  )
}

const vendorLogos = new Map([
  ['openai', openai], ['anthropic', anthropic], ['deepseek', deepseek],
  ['qwen', qwen], ['moonshotai', moonshot], ['moonshot', moonshot],
])
const primaryCapabilities = new Set(['tools', 'reasoning', 'structured_outputs'])

function ModelItem({ model, expanded, onToggle }: { model: AiModelRegistryEntry; expanded: boolean; onToggle: () => void }) {
  const { t } = useI18n('model')
  const parameters = buildCapabilityList(model)
  const features = parameters.filter(key => primaryCapabilities.has(key))
  if (model.inputModalities?.includes('image')) features.unshift('imageInput')
  const otherParameters = parameters.filter(key => !primaryCapabilities.has(key))
  const modalityList = (values?: string[]) => formatList(values?.map(value => t('model:modalities.' + value, { defaultValue: value })))
  const label = (key: string) => t(`model:capabilities.${key}`, { defaultValue: key.replaceAll('_', ' ') })
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'copyFailed'>('idle')
  useEffect(() => {
    if (copyState === 'idle') return
    const timer = window.setTimeout(() => setCopyState('idle'), 2200)
    return () => window.clearTimeout(timer)
  }, [copyState])

  async function copyId() {
    try {
      await navigator.clipboard.writeText(model.id)
      setCopyState('copied')
    } catch {
      setCopyState('copyFailed')
    }
  }

  return (
    <div className={styles.modelItem}>
      <div className={styles.modelRow}>
        <SettingsButton variant="plain" className={styles.modelSummary} aria-expanded={expanded} onClick={onToggle}>
          <ChevronRight size={14} className={styles.chevron} aria-hidden="true" />
          <span className={styles.modelIdentity}>
            <strong>{model.name}</strong>
            <code>{model.id}</code>
          </span>
          <span className={styles.modelQuickMeta}>
            <span>{model.effectiveContextWindow ? t('model:model.contextValue', { value: formatTokens(model.effectiveContextWindow) }) : t('model:model.contextUnknown')}</span>
            {features.length > 0 && <span className={styles.quickFeatures}>{features.slice(0, 2).map(label).join(' · ')}</span>}
          </span>
        </SettingsButton>
        <SettingsButton size="icon" variant="ghost" aria-label={t('model:model.copyId', { id: model.id })}
          title={t('model:model.copyId', { id: model.id })} onClick={copyId}>
          {copyState === 'copied' ? <Check size={14} /> : <Copy size={14} />}
        </SettingsButton>
        <span role="status" className={styles.copyFeedback}>{copyState !== 'idle' && t('model:model.' + copyState)}</span>
      </div>
      {expanded && <div className={styles.details}>
        <section className={styles.detailSection} aria-label={t('model:sections.capabilities')}>
          <h3><Cpu size={15} aria-hidden="true" />{t('model:sections.capabilities')}</h3>
          <div className={styles.capacityGrid}>
            <Metadata label={t('model:meta.context')} value={formatOptionalTokens(model.effectiveContextWindow, t)} />
            <Metadata label={t('model:meta.maxOutput')} value={formatOptionalTokens(model.maxOutputTokens, t)} />
          </div>
          <Metadata label={t('model:meta.input')} value={modalityList(model.inputModalities)} />
          <Metadata label={t('model:meta.output')} value={modalityList(model.outputModalities)} />
          {features.length > 0 && <div className={styles.capabilities}>
            {features.map(key => <span key={key}>{label(key)}</span>)}
          </div>}
          {otherParameters.length > 0 && <details className={styles.specialRule}>
            <summary>{t('model:sections.parameters')}</summary>
            <div className={styles.capabilities}>{otherParameters.map(key => <span key={key}>{label(key)}</span>)}</div>
          </details>}
        </section>
        <section className={styles.detailSection} aria-label={t('model:sections.pricing')}>
          <h3><Coins size={15} aria-hidden="true" />{t('model:sections.pricing')}<span>USD / 1M tokens</span></h3>
          <PricingDetails pricing={readModelPricing(model)} />
          <p className={styles.priceHint}>{t('model:pricing.sourceHint')}</p>
        </section>
        {model.description && <p className={styles.description}>{model.description}</p>}
      </div>}
    </div>
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

function formatDate(value: string, language: string, t: TFunc): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? t('model:model.updatedTimeUnknown') : date.toLocaleString(language)
}

function trimDecimal(value: number): string {
  return Number(value.toFixed(1)).toString()
}
