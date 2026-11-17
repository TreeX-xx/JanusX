import { useTranslation } from 'react-i18next'
import { useSuperAgentUIStore } from '@/stores/superagent-ui'
import styles from './AgentModeSelect.module.css'

/** Shared preference, sampled by the chat controller for the next message. */
export function AgentModeSelect({ disabled }: { disabled: boolean }) {
  const { t } = useTranslation('janus')
  const mode = useSuperAgentUIStore(state => state.agentMode)
  const setMode = useSuperAgentUIStore(state => state.setAgentMode)
  return <select className={styles.select} aria-label={t('superagent.agentMode')} value={mode} disabled={disabled}
    onChange={event => setMode(event.target.value === 'ordinary' ? 'ordinary' : 'superagent')}>
    <option value="ordinary">{t('superagent.ordinaryMode')}</option>
    <option value="superagent">{t('superagent.open')}</option>
  </select>
}
