import { useEffect, useId, useState } from 'react'
import { Plug, RefreshCw } from 'lucide-react'
import { useI18n } from '@/i18n/useI18n'
import { EXTERNAL_CLI_TOOL_ICONS } from '@/lib/cli-tool-icons'
import type { NoteMcpChange, NoteMcpProbe, NoteMcpStatus } from '../../../../../plugins/blueprint/src/shared/note-mcp'
import settingsStyles from '../KnowledgeSettingsPanel.module.css'
import styles from './BlueprintSettingsPanel.module.css'
import { NoteMcpHelp } from './NoteMcpHelp'

export function NoteMcpSettings() {
  const { t } = useI18n('blueprint')
  const id = useId()
  const [status, setStatus] = useState<NoteMcpStatus>()
  const [probe, setProbe] = useState<NoteMcpProbe>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    const read = () => { void window.electron.blueprintReview.mcpStatus().then(value => { if (active) setStatus(value) }).catch(() => { if (active) setError(t('blueprint:review.mcpReadFailed')) }) }
    read(); window.addEventListener('focus', read)
    return () => { active = false; window.removeEventListener('focus', read) }
  }, [t])
  const change = async (input: NoteMcpChange) => {
    setBusy(true); setError('')
    try { await window.electron.blueprintReview.mcpChange(input) }
    catch (reason) { setError(String(reason)) }
    finally {
      try { setStatus(await window.electron.blueprintReview.mcpStatus()) } catch { setError(t('blueprint:review.mcpReadFailed')) }
      setBusy(false)
    }
  }
  const test = async () => {
    setBusy(true); setError('')
    try { setProbe(await window.electron.blueprintReview.mcpProbe()) }
    catch { setError(t('blueprint:review.mcpProbeFailed')) }
    finally { setBusy(false) }
  }
  return (
    <fieldset className={`${settingsStyles.section} ${styles.section}`} disabled={busy} aria-labelledby={`${id}-mcp`} aria-busy={busy}>
      <div className={settingsStyles.sectionTitle}>
        <h3 className={styles.mcpTitle} id={`${id}-mcp`}><Plug size={14} aria-hidden="true" />{t('blueprint:review.mcp')}</h3>
        <NoteMcpHelp />
      </div>
      <p className={settingsStyles.hint}>{t('blueprint:review.mcpIntro')}</p>
      {error && <p className={`${settingsStyles.hint} ${settingsStyles.statusError}`} role="alert">{error}</p>}
      {status && !status.available && <p className={settingsStyles.hint}>{t('blueprint:review.mcpUnavailable')}</p>}
      <div className={styles.clientList}>
        {status?.clients.map(client => (
          <div key={client.id} className={styles.client} role="group" aria-label={client.label}>
            <div className={settingsStyles.clientIdentity}>
              <span className={settingsStyles.clientIcon} data-client={client.id} aria-hidden="true">
                <img src={EXTERNAL_CLI_TOOL_ICONS[client.id === 'claude-code' ? 'claude' : client.id]} alt="" draggable={false} />
              </span>
              <div className={styles.clientInfo}>
                <div className={styles.clientHeading}>
                  <strong>{client.label}</strong>
                  <span className={`${settingsStyles.status} ${client.state === 'current' ? settingsStyles.statusSuccess : ['conflict', 'unreadable'].includes(client.state) ? settingsStyles.statusError : ''}`}>{t(`blueprint:review.mcpState.${client.state}`)}</span>
                </div>
                {client.path && <code className={styles.clientPath}>{client.path}</code>}
                {client.id === 'pi' && <p className={settingsStyles.hint}>{t('blueprint:review.mcpPiExtension')}</p>}
                {client.id === 'janus' && <p className={settingsStyles.hint}>{t('blueprint:review.mcpJanusVersion')}</p>}
              </div>
            </div>
            {['absent', 'outdated', 'current'].includes(client.state) && <div className={`${settingsStyles.actions} ${styles.clientActions}`}>
              <button className={`${settingsStyles.button} ${settingsStyles.primaryButton}`} type="button" disabled={!status.available || client.state === 'current'} onClick={() => void change({ client: client.id, expectedHash: client.hash, action: 'import' })}>{t(client.state === 'absent' ? 'blueprint:review.mcpImport' : 'blueprint:review.mcpUpdate')}</button>
              {client.state !== 'absent' && <button className={`${settingsStyles.button} ${settingsStyles.ghostButton}`} type="button" onClick={() => void change({ client: client.id, expectedHash: client.hash, action: 'remove' })}>{t('blueprint:review.mcpRemove')}</button>}
            </div>}
          </div>
        ))}
      </div>
      <div className={styles.feedback}>
        <div className={styles.feedbackText}>
          {probe && <p className={`${settingsStyles.hint} ${probe.ok ? settingsStyles.statusSuccess : settingsStyles.statusError}`} role="status">{t(probe.ok ? 'blueprint:review.mcpProbePassed' : 'blueprint:review.mcpProbeFailed')}</p>}
        </div>
        <button className={settingsStyles.button} type="button" disabled={!status?.available} onClick={() => void test()}>
          <RefreshCw size={12} aria-hidden="true" />{t('blueprint:review.mcpTest')}
        </button>
      </div>
    </fieldset>
  )
}
