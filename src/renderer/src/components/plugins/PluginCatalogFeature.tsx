import { ArrowRight, Sparkles } from 'lucide-react'
import type { PluginCatalogEntry } from '../../../../shared/ipc/plugins'
import { useI18n } from '@/i18n/useI18n'
import blueprintCover from '@/assets/plugins/blueprint-feature.jpg'
import superAgentCover from '@/assets/plugins/superagent-feature.jpg'
import styles from './PluginSettingsPanel.module.css'

const covers = [
  { id: 'official.blueprint', image: blueprintCover, copy: 'plugins:featureBlueprint' },
  { id: 'official.superagent', image: superAgentCover, copy: 'plugins:featureSuperAgent' },
] as const

interface FeatureProps {
  entries: PluginCatalogEntry[]
  activeId?: string
  onSwitch(id: string): void
  onOpen(id: string, trigger: HTMLButtonElement): void
}

export function PluginCatalogFeature({ entries, activeId, onSwitch, onOpen }: FeatureProps) {
  const { t } = useI18n('plugins')
  const available = covers.flatMap(cover => {
    const entry = entries.find(item => item.id === cover.id)
    return entry ? [{ ...cover, name: entry.name }] : []
  })
  const active = available.find(cover => cover.id === activeId) ?? available[0]
  if (!active) return null

  return <section className={styles.feature} aria-label={t('plugins:featured')} data-catalog-feature={active.id}>
    <div className={styles.featureArt}>
      <img src={active.image} width={1100} height={550} alt="" draggable={false} />
      {available.length > 1 && <div role="group" aria-label={t('plugins:featured')} className={styles.featureSwitcher}>
        {available.map(cover => <button key={cover.id} type="button" aria-pressed={cover.id === active.id}
          onClick={() => onSwitch(cover.id)}>{cover.name}</button>)}
      </div>}
    </div>
    <div className={styles.featureStory}>
      <span className={styles.featureLabel}><Sparkles size={13} aria-hidden="true" />{t('plugins:featured')}</span>
      <h3>{active.name}</h3>
      <p>{t(active.copy)}</p>
      <button id="plugin-feature-details" type="button" className={styles.featureLink}
        aria-label={t('plugins:featureDetailsFor', { name: active.name })}
        onClick={event => onOpen(active.id, event.currentTarget)}>{t('plugins:featureDetails')}<ArrowRight size={14} aria-hidden="true" /></button>
    </div>
  </section>
}
