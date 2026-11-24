// Note: .agents/notes/workbench/plugin-contract-v1.md
import { Button } from '@janusx/ui'
import { ArrowLeft, ArrowUpRight, Download, ShieldCheck } from 'lucide-react'
import { useEffect, useRef, type ReactNode } from 'react'
import semver from 'semver'
import type { InstalledPlugin, PluginCatalogEntry, PluginDistributionSnapshot } from '../../../../shared/ipc/plugins'
import { openExtensionView } from '@/extensions/workbench'
import { useExtensionViews } from '@/extensions/react'
import { useI18n } from '@/i18n/useI18n'
import { useWorkspaceStore } from '@/stores/workspace'
import blueprintPreview from '../../../../../docs/assets/readme/blueprint-workbench.png'
import { PluginIcon } from './PluginIcon'
import styles from './PluginSettingsPanel.module.css'

const usageKeys: Record<string, string> = {
  'official.blueprint': 'usageBlueprint', 'official.cpa': 'usageCpa',
  'official.docker': 'usageDocker', 'official.superagent': 'usageSuperAgent',
}

interface DetailProps {
  entry: PluginCatalogEntry
  description: string
  installed?: InstalledPlugin
  operation?: PluginDistributionSnapshot['operation']
  busy: boolean
  canInstall: boolean
  developmentMode: boolean
  onBack(): void
  onInstall(): void
  onCancel(): void
  onAuthorize(record: InstalledPlugin): void
  onUninstall(id: string): void
  onManage(id: string): void
  onOpened?(): void
  children: ReactNode
}

export function PluginCatalogDetail({ entry, description, installed, operation, busy, canInstall, developmentMode,
  onBack, onInstall, onCancel, onAuthorize, onUninstall, onManage, onOpened, children }: DetailProps) {
  const { t, currentLanguage } = useI18n('plugins')
  const back = useRef<HTMLButtonElement>(null)
  const actions = useRef<HTMLDivElement>(null)
  useEffect(() => { back.current?.focus() }, [entry.id])
  useEffect(() => {
    if (!busy && !children && document.activeElement === document.body) {
      actions.current?.querySelector<HTMLButtonElement>('button:enabled')?.focus({ preventScroll: true })
    }
  }, [busy, children, installed])
  const project = useWorkspaceStore(state => state.activeWorkspaceId)
  const views = useExtensionViews().filter(view => view.extensionId === entry.id && (view.scope === 'application' || project))
  const launch = views.find(view => view.location === 'workbench' || view.location === 'workspace') ?? views.find(view => view.location === 'settings')
  const update = installed?.source.kind === 'official' && semver.gt(entry.version, installed.manifest.version)
  const usage = usageKeys[entry.id]
  const smallPackage = entry.bytes < 1_000_000
  const size = new Intl.NumberFormat(currentLanguage, {
    maximumFractionDigits: 1, style: 'unit', unit: smallPackage ? 'kilobyte' : 'megabyte',
  }).format(entry.bytes / (smallPackage ? 1000 : 1_000_000))

  return <section className={styles.catalogDetail} aria-labelledby="catalog-detail-title" data-catalog-detail={entry.id}>
    <button ref={back} type="button" className={styles.backLink} onClick={onBack}><ArrowLeft aria-hidden="true" size={14} />{t('plugins:catalogCollection')}</button>
    <div className={styles.detailTitle}><PluginIcon id={entry.id} name={entry.name} /><div>
      <span className={styles.publisher}><ShieldCheck aria-hidden="true" size={13} />{entry.publisher} · {t('plugins:official')}</span>
      <h3 id="catalog-detail-title">{entry.name}</h3>
    </div></div>
    <p className={styles.description}>{description}</p>
    {children || <div ref={actions} className={styles.actions}>
      {(!installed || update) && <Button variant={installed ? 'secondary' : 'primary'} disabled={busy || !canInstall || !entry.compatible || Boolean(installed?.enabled)} onClick={onInstall}>
        <Download aria-hidden="true" size={14} />{t(update ? 'plugins:update' : 'plugins:install')}
      </Button>}
      {installed && !installed.enabled && <Button variant="primary" disabled={busy || installed.source.kind !== 'official' && !developmentMode}
        onClick={() => onAuthorize(installed)}><ShieldCheck aria-hidden="true" size={14} />{t('plugins:authorize')}</Button>}
      {installed?.enabled && launch && <Button variant="primary" disabled={busy} onClick={() => {
        if (openExtensionView(launch.id) && launch.location !== 'settings') onOpened?.()
      }}>{t(launch.location === 'settings' ? 'plugins:openSettings' : 'plugins:open')}<ArrowUpRight aria-hidden="true" size={14} /></Button>}
      {installed && <Button disabled={busy} onClick={() => onManage(entry.id)}>{t('plugins:managePlugin')}</Button>}
    </div>}
    {operation && <div role="status"><label>{t(operation.phase === 'downloading' ? 'plugins:downloading' : 'plugins:installing')} · {operation.percent}%
      <progress value={operation.percent} max={100} /></label>{operation.phase === 'downloading' && <Button onClick={onCancel}>{t('plugins:cancel')}</Button>}</div>}
    {!entry.compatible && <p role="status">{t('plugins:incompatible')}</p>}
    {update && installed.enabled && <p role="status">{t('plugins:stopBeforeUpdate')}</p>}
    {usage && <section className={styles.usage}><h4>{t('plugins:tryPlugin')}</h4><p>{t('plugins:' + usage)}</p>
      {entry.id === 'official.blueprint' && <img width={1760} height={940} src={blueprintPreview} alt={t('plugins:blueprintPreview')} />}
    </section>}
    <dl className={styles.releaseInfo}>
      <div><dt>{t('plugins:releaseVersion')}</dt><dd>v{entry.version}</dd></div>
      <div><dt>{t('plugins:packageSize')}</dt><dd>{size}</dd></div>
      {installed && <div><dt>{t('plugins:installed')}</dt><dd>v{installed.manifest.version} · {t(`plugins:state.${installed.state}`)}</dd></div>}
    </dl>
    {installed && !children && <button type="button" className={styles.removeLink} disabled={busy} onClick={() => onUninstall(entry.id)}>{t('plugins:uninstall')}</button>}
  </section>
}
