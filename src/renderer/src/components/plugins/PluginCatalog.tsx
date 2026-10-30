import { useEffect, useRef, useState } from 'react'
import semver from 'semver'
import { Check, Download, PackageSearch, RefreshCw, Search } from 'lucide-react'
import { useI18n } from '@/i18n/useI18n'
import { pluginRequest, refreshPlugins, usePluginSnapshot } from '@/extensions/plugin-runtime'
import styles from './PluginSettingsPanel.module.css'

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

export function PluginCatalog({ onUninstall }: { onUninstall?: (id: string) => void }) {
  const { t } = useI18n('plugins')
  const snapshot = usePluginSnapshot()
  const distribution = snapshot.distribution
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState('')
  const [query, setQuery] = useState('')
  const search = query.trim().toLocaleLowerCase()
  const entries = distribution?.entries.filter(entry => [entry.name, entry.description, entry.publisher, entry.id].some(value => value.toLocaleLowerCase().includes(search))) ?? []
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
  return <div className={styles.root} data-plugin-catalog>
    <div className={styles.marketToolbar}>
      <label className={styles.search}><Search size={15} aria-hidden="true" /><input type="search" aria-label={t('plugins:searchCatalog')} placeholder={t('plugins:searchCatalog')} value={query} onChange={event => setQuery(event.target.value)} /></label>
      <button disabled={busy || Boolean(distribution?.operation) || !distribution?.configured} onClick={() => { void refresh() }}><RefreshCw size={14} aria-hidden="true" />{t('plugins:refreshCatalog')}</button>
    </div>
    <div className={styles.collectionHeading}><strong>{t('plugins:catalogCollection')}</strong><span>{entries.length}</span></div>
    <p className={styles.hint}>{t('plugins:catalogHint')}</p>
    {!distribution?.configured && <div className={styles.emptyState} role="status"><PackageSearch size={28} aria-hidden="true" /><strong>{t('plugins:catalogCollection')}</strong><p>{t('plugins:catalogNotConfigured')}</p></div>}
    {distribution?.expired && <p role="status">{t('plugins:catalogStale')}</p>}
    <PluginDistributionError code={failure || distribution?.error} />
    {distribution?.configured && !entries.length && <div className={styles.emptyState} role="status"><PackageSearch size={28} aria-hidden="true" /><p>{distribution.entries.length ? t('plugins:noSearchResults') : busy ? t('plugins:catalogLoading') : t('plugins:catalogEmpty')}</p></div>}
    <div className={styles.marketGrid}>
    {entries.map(entry => {
      const installed = snapshot.plugins.find(plugin => plugin.manifest.id === entry.id)
      const update = installed && semver.gt(entry.version, installed.manifest.version)
      const operation = distribution?.operation?.id === entry.id ? distribution.operation : undefined
      const disabled = busy || Boolean(distribution?.operation) || !entry.compatible || Boolean(installed && (!update || installed.enabled || installed.source.kind !== 'official'))
      return <section key={entry.id} className={`${styles.card} ${styles.marketCard}`} data-catalog-id={entry.id}>
        <div className={styles.cardHeader}>
          <span className={styles.avatar} aria-hidden="true">{entry.name.trim().charAt(0).toUpperCase() || '?'}</span>
          <div className={styles.cardTitle}>
            <strong>{entry.name}</strong>
            <span className={styles.meta}>{entry.publisher}</span>
          </div>
          <span className={styles.badge}><Check size={11} aria-hidden="true" />{t('plugins:official')}</span>
        </div>
        <p className={styles.description}>{entry.description}</p>
        {!entry.compatible && <p>{t('plugins:incompatible')}</p>}
        {update && installed.enabled && <p>{t('plugins:stopBeforeUpdate')}</p>}
        <div className={styles.cardFooter}><span className={styles.meta}>v{entry.version} · {(entry.bytes / 1024 / 1024).toFixed(1)} MB</span><div className={styles.actions}><button className={installed && !update ? undefined : styles.primary} disabled={disabled} onClick={() => { void install(entry.id) }}>{installed && !update ? <Check size={13} aria-hidden="true" /> : <Download size={13} aria-hidden="true" />}{installed ? update ? t('plugins:update') : t('plugins:installed') : t('plugins:install')}</button>
          {installed && onUninstall && <button className={styles.danger} disabled={busy || Boolean(distribution?.operation)} onClick={() => onUninstall(entry.id)}>{t('plugins:uninstall')}</button>}
        </div></div>
        {operation && <div role="status" aria-live="polite">
          <label>{t(operation.phase === 'installing' ? 'plugins:installing' : 'plugins:downloading')} · {operation.percent}%
            <progress max={100} value={operation.percent} /></label>
          {operation.phase === 'downloading' && <button onClick={() => { void pluginRequest({ type: 'installCancel' }).catch(() => setFailure('INSTALLATION_FAILED')) }}>{t('plugins:cancel')}</button>}
        </div>}
        {installed && !update && <p className={styles.hint}>{t('plugins:installedHint')}</p>}
      </section>
    })}
    </div>
  </div>
}
