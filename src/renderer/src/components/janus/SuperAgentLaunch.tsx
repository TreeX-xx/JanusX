import { useSuperAgentEnabled } from '@/lib/superagent-plugin'
import { useTranslation } from 'react-i18next'
import { openSuperAgent } from '@/lib/superagent-navigation'
import { JanusIcon } from '../ui/JanusIcon'
import styles from './SuperAgentWorkspace.module.css'

export function SuperAgentLaunch({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation('janus')
  const enabled = useSuperAgentEnabled()
  if (!enabled) return null
  return <button type="button" aria-label={t('superagent.open')} className={compact ? styles.launchCompact : styles.launch} onClick={openSuperAgent}>
    <JanusIcon size={compact ? 16 : 22} />
    <span><strong>{t('superagent.open')}</strong>{!compact && <small>{t('superagent.launchHint')}</small>}</span>
  </button>
}
