// Note: model detail and display precision — see .agents/notes/terminal/requirements/usage-stats-custom-range-detail.md
import { Fragment, useId, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { useI18n } from '@/i18n/useI18n'
import { cacheSplitFor, formatUsageCount, formatUsageRate, type UsageModelRow } from '@/lib/usage-stats'
import { EXTERNAL_CLI_TOOL_META, type ExternalCliToolId } from '../../../shared/ipc/external-cli'
import { ThemedTooltip } from './ui/ThemedTooltip'
import styles from './UsageStatsPanel.module.css'

export function UsageModelBreakdown({ rows, total, refreshing }: { rows: UsageModelRow[]; total: number; refreshing: boolean }) {
  const { t, currentLanguage } = useI18n('settings')
  const id = useId()
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const exact = (value: number) => value.toLocaleString(currentLanguage)
  const toggle = (key: string) => setExpanded(previous => {
    const next = new Set(previous)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  })
  if (!rows.length) return null
  return (
    <section className={`${styles.breakdown}${refreshing ? ' ' + styles.dimmed : ''}`} aria-labelledby={`${id}-title`} aria-busy={refreshing}>
      <div className={styles.breakdownHeading}>
        <h4 id={`${id}-title`} className={styles.title}>{t('settings:usageStats.breakdown')}</h4>
        <span className={styles.label}>{t('settings:usageStats.sortedByUsage')}</span>
      </div>
      <table className={styles.modelTable} aria-labelledby={`${id}-title`}>
        <thead><tr>
          <th scope="col">{t('settings:usageStats.model')}</th>
          <th scope="col" className={styles.totalColumn} aria-sort="descending">{t('settings:usageStats.totalTokens')} ↓</th>
          <th scope="col" className={styles.modelIo}>{t('settings:usageStats.freshInput')}</th>
          <th scope="col" className={styles.modelIo}>{t('settings:usageStats.output')}</th>
          <th scope="col" className={styles.rateColumn}>{t('settings:usageStats.hitRate')}</th>
        </tr></thead>
        <tbody>{rows.map((row, index) => {
          const model = row.model ?? t('settings:usageStats.unknownModel')
          const engine = EXTERNAL_CLI_TOOL_META[row.preset as ExternalCliToolId]?.displayName ?? row.preset
          const color = `var(--usage-${row.preset}, var(--shell-dim))`
          const split = cacheSplitFor(row.cacheReadTokens, row.inputTokens, row.cacheWriteTokens, row.cacheKnown)
          const share = total > 0 ? row.totalTokens / total : 0
          const open = expanded.has(row.key)
          const detailId = `${id}-detail-${index}`
          const cacheStatus = row.cacheKnown ? t('settings:usageStats.cacheFormula')
            : t(row.cacheReported ? 'settings:usageStats.incompleteCacheData' : 'settings:usageStats.noCacheData')
          const facts = [
            [t('settings:usageStats.totalTokens'), exact(row.totalTokens)],
            [t('settings:usageStats.freshInput'), exact(row.inputTokens)],
            [t('settings:usageStats.output'), exact(row.outputTokens)],
            [t('settings:usageStats.cacheRead'), row.cacheKnown ? exact(row.cacheReadTokens) : '–'],
            [t('settings:usageStats.cacheWrite'), row.cacheWriteKnown ? exact(row.cacheWriteTokens) : '–'],
            [t('settings:usageStats.hitRate'), formatUsageRate(split.rate, 2)],
          ]
          return <Fragment key={row.key}>
            <tr className={styles.modelRow} data-testid="usage-model-row" data-expanded={open || undefined}>
              <th scope="row">
                <button type="button" className={styles.modelToggle} aria-expanded={open} aria-controls={detailId}
                  aria-label={t(open ? 'settings:usageStats.collapseModel' : 'settings:usageStats.expandModel', { model, engine })} onClick={() => toggle(row.key)}>
                  <ChevronRight size={14} className={styles.modelChevron} aria-hidden="true" />
                  <span className={styles.modelInfo}>
                    <span className={styles.modelName}>{model}</span>
                    <span className={styles.modelMeta}><i style={{ background: color }} aria-hidden="true" />{engine}<span>· {row.terminals} {t('settings:usageStats.terminals')}</span></span>
                  </span>
                </button>
              </th>
              <td className={styles.modelTotal}>
                <ThemedTooltip label={`${exact(row.totalTokens)} tokens`}><strong>{formatUsageCount(row.totalTokens)}</strong></ThemedTooltip>
                <span className={styles.modelShare}>{formatUsageRate(share)}<span className={styles.modelShareTrack} aria-hidden="true"><i style={{ width: `${share * 100}%`, background: color }} /></span></span>
              </td>
              <td className={`${styles.modelIo} ${styles.inputMetric}`}><strong>{formatUsageCount(row.inputTokens)}</strong></td>
              <td className={`${styles.modelIo} ${styles.outputMetric}`}><strong>{formatUsageCount(row.outputTokens)}</strong></td>
              <td className={styles.modelRate}>
                <ThemedTooltip label={`${formatUsageRate(split.rate, 2)} · ${cacheStatus}`}><span tabIndex={0}>{formatUsageRate(split.rate)}</span></ThemedTooltip>
              </td>
            </tr>
            <tr id={detailId} hidden={!open} className={styles.modelDetail}>
              <td colSpan={5}>
                <dl>{facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
                <p>{t('settings:usageStats.tokenComposition')}</p>
                <p>{cacheStatus}{!row.cacheWriteKnown && ` ${t('settings:usageStats.missingCacheWrite')}`}</p>
              </td>
            </tr>
          </Fragment>
        })}</tbody>
      </table>
    </section>
  )
}
