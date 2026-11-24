import { Button as SettingsButton, Input as SettingsInput, InputGroup } from '@janusx/ui'
import { useEffect, useRef, useState, type ComponentProps } from 'react'
import { Check, ChevronRight, PackageSearch, RefreshCw, Search } from 'lucide-react'
import { useI18n } from '@/i18n/useI18n'
import { pluginRequest, refreshPlugins, usePluginSnapshot } from '@/extensions/plugin-runtime'
import styles from './PluginSettingsPanel.module.css'
import { PluginIcon } from './PluginIcon'
import { PluginCatalogDetail } from './PluginCatalogDetail'

export function PluginDistributionError({ code }: { code?: string }) {
  const { t } = useI18n('plugins')
  if (!code) return null
  const message = ['INVALID_SIGNATURE', 'INVALID_PACKAGE'].includes(code) ? t('plugins:downloadInvalid')
    : code === 'INCOMPATIBLE_PLUGIN' ? t('plugins:incompatible')
    : ['CATALOG_EXPIRED', 'CATALOG_ROLLBACK'].includes(code) ? t('plugins:catalogStale')
    : code === 'INSTALLATION_CANCELLED' ? t('plugins:downloadCancelled')
    : code === 'DOWNLOAD_NOT_FOUND' ? t('plugins:downloadNotFound')
    : code === 'DISTRIBUTION_NOT_CONFIGURED' ? t('plugins:catalogNotConfigured') : t('plugins:downloadFailed')
  return <p role="status" className={styles.error}>{message} <small>({code})</small></p>
}

type CatalogProps = Pick<ComponentProps<typeof PluginCatalogDetail>, 'onAuthorize' | 'onUninstall' | 'onManage' | 'onOpened' | 'children'> & {
  onNavigate(): void
  pending: boolean
}

export function PluginCatalog({ onNavigate, pending, ...detailActions }: CatalogProps) {
  const { t } = useI18n('plugins')
  const snapshot = usePluginSnapshot()
  const distribution = snapshot.distribution
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState('')
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string>()
  const lastTrigger = useRef<HTMLButtonElement | null>(null)
  const search = query.trim().toLocaleLowerCase()
  const summary = (id: string, fallback: string) => id.startsWith('official.')
    ? t('plugins:catalogSummary.' + id.slice('official.'.length), { defaultValue: fallback }) : fallback
  const entries = distribution?.entries.filter(entry => [entry.name, entry.description, entry.publisher, entry.id, summary(entry.id, entry.description)]
    .some(value => value.toLocaleLowerCase().includes(search))) ?? []
  const selected = entries.find(entry => entry.id === selectedId)
  const operation = distribution?.operation
  const locked = pending || busy || Boolean(operation)
  const closeDetail = () => {
    onNavigate()
    setSelectedId(undefined)
    requestAnimationFrame(() => lastTrigger.current?.focus())
  }
  const loaded = useRef(false)
  const refresh = async () => {
    setBusy(true); setFailure('')
    try { await pluginRequest({ type: 'catalogRefresh' }) }
    catch (cause) { setFailure(cause instanceof Error ? cause.message : 'CATALOG_UNAVAILABLE') }
    finally { await refreshPlugins().catch(() => {}); setBusy(false) }
  }
  useEffect(() => {
    if (loaded.current || !distribution?.configured) return
    loaded.current = true
    void refresh()
  }, [distribution?.configured])
  const install = async (id: string) => {
    setBusy(true); setFailure('')
    try { await pluginRequest({ type: 'installOfficial', id }) }
    catch (cause) { setFailure(cause instanceof Error ? cause.message : 'INSTALLATION_FAILED') }
    finally { await refreshPlugins().catch(() => {}); setBusy(false) }
  }
  return <div className={styles.root} data-plugin-catalog onKeyDown={event => {
    if (selected && event.key === 'Escape') { event.stopPropagation(); closeDetail() }
  }}>
    <div className={styles.marketToolbar}>
      <InputGroup as="label" className={styles.search}><Search size={15} aria-hidden="true" /><SettingsInput type="search" aria-label={t('plugins:searchCatalog')} placeholder={t('plugins:searchCatalog')} value={query}
        onChange={event => { setQuery(event.target.value); setSelectedId(undefined); onNavigate() }} /></InputGroup>
      <SettingsButton disabled={locked || !distribution?.configured} onClick={() => { void refresh() }}><RefreshCw size={14} aria-hidden="true" />{t('plugins:refreshCatalog')}</SettingsButton>
    </div>
    {!distribution?.configured && <div className={styles.emptyState} role="status"><PackageSearch size={28} aria-hidden="true" /><p>{t('plugins:catalogNotConfigured')}</p></div>}
    {distribution?.expired && <p role="status">{t('plugins:catalogStale')}</p>}
    <PluginDistributionError code={failure || distribution?.error} />
    {distribution?.configured && !entries.length && <div className={styles.emptyState} role="status"><PackageSearch size={28} aria-hidden="true" /><p>{distribution.entries.length ? t('plugins:noSearchResults') : busy ? t('plugins:catalogLoading') : t('plugins:catalogEmpty')}</p></div>}
    {entries.length > 0 && <div className={styles.catalogBrowser} data-detail={Boolean(selected)}>
      <div className={styles.catalogList}>
        <div className={styles.collectionHeading}><strong>{t('plugins:catalogCollection')}</strong><span>{entries.length}</span></div>
        <div className={styles.catalogGrid}>{entries.map(entry => {
          const installed = snapshot.plugins.find(plugin => plugin.manifest.id === entry.id)
          const downloading = operation?.id === entry.id
          return <button type="button" key={entry.id} className={styles.catalogItem} data-catalog-id={entry.id}
            aria-pressed={entry.id === selected?.id} onClick={event => {
              if (selected?.id !== entry.id) onNavigate()
              lastTrigger.current = event.currentTarget
              setSelectedId(entry.id)
            }}>
            <PluginIcon id={entry.id} name={entry.name} />
            <span className={styles.catalogCopy}><strong>{entry.name}</strong>
              <span className={styles.catalogSummary}>{summary(entry.id, entry.description)}</span>
              <span className={styles.catalogMeta}>{entry.publisher}
                {downloading ? <span>{t(operation.phase === 'downloading' ? 'plugins:downloading' : 'plugins:installing')} · {operation.percent}%</span>
                  : installed ? <span><Check aria-hidden="true" size={12} />{t('plugins:installed')}</span> : <span>v{entry.version}</span>}
              </span>
            </span>
            <ChevronRight size={14} className={styles.disclosure} aria-hidden="true" />
          </button>
        })}</div>
      </div>
      {selected && <PluginCatalogDetail {...detailActions} entry={selected} description={summary(selected.id, selected.description)} installed={snapshot.plugins.find(plugin => plugin.manifest.id === selected.id)}
        busy={locked} canInstall={Boolean(distribution?.configured && !distribution.expired)} developmentMode={snapshot.developmentMode}
        operation={operation?.id === selected.id ? operation : undefined}
        onBack={closeDetail} onInstall={() => { void install(selected.id) }}
        onCancel={() => { void pluginRequest({ type: 'installCancel' }).catch(() => setFailure('INSTALLATION_FAILED')) }} />}
    </div>}
  </div>
}
