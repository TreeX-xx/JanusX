import { Button as SettingsButton } from '@janusx/ui'
import { useId, useState } from 'react'
import { ChevronDown, ExternalLink, RotateCw } from 'lucide-react'
import { useI18n } from '@/i18n/useI18n'
import { useWorkflowXStore } from '@/stores/workflowx'
import { useWorkspaceStore } from '@/stores/workspace'
import { ThemedTooltip } from '../ui/ThemedTooltip'
import styles from './WorkflowXMonitor.module.css'

export function WorkflowXMonitor() {
  return <WorkflowXStatus />
}

// Note: settings and Island share detection state and actions — see .agents/notes/blueprint/workspaces/requirements/workflowx-onboarding.md
export function WorkflowXStatus({ surface = 'island' }: { surface?: 'island' | 'settings' }) {
  const { t } = useI18n('janus')
  const { snapshot, checking, check } = useWorkflowXStore()
  const workspaceId = useWorkspaceStore(state => state.activeWorkspaceId)
  const workspaceName = useWorkspaceStore(state => state.workspaces.find(workspace => workspace.id === state.activeWorkspaceId)?.name)
  const [open, setOpen] = useState(false)
  const detailsId = useId()
  const [linkFailed, setLinkFailed] = useState(false)
  const current = snapshot?.workspaceId === workspaceId ? snapshot : null
  const status = current?.status ?? 'checking'
  const isSettings = surface === 'settings'
  const sourceSummary = [...new Set(current?.sources.filter(source => source.status === 'detected')
    .map(source => `${t(`workflowx.${source.scope}`)} · ${source.format === 'claude' ? 'Claude' : 'Codex'}`) ?? [])].join(' / ')
  const hint = sourceSummary ? null
    : current?.unavailable ? t('workflowx.unavailable')
      : status === 'missing' ? t('workflowx.missingHint')
        : null
  const statusLabel = <span className={styles.state} data-status={status}>
    <i aria-hidden="true" />{t(`workflowx.status.${status}`)}
  </span>
  const actions = <div className={styles.actions}>
    {isSettings && <ThemedTooltip label={t('workflowx.sources')}>
      <SettingsButton variant="ghost" size="icon" type="button" aria-label={t('workflowx.sources')} aria-expanded={open} aria-controls={open ? detailsId : undefined} onClick={() => setOpen(value => !value)}>
        <ChevronDown size={16} aria-hidden="true" />
      </SettingsButton>
    </ThemedTooltip>}
    <ThemedTooltip label={t(checking ? 'workflowx.status.checking' : 'workflowx.refresh')} disabled={!isSettings}>
      <SettingsButton variant="ghost" size="icon" type="button" aria-label={t('workflowx.refresh')} disabled={checking} onClick={() => void check(workspaceId, true)}>
        <RotateCw size={isSettings ? 16 : 12} aria-hidden="true" />{!isSettings && t(checking ? 'workflowx.status.checking' : 'workflowx.refresh')}
      </SettingsButton>
    </ThemedTooltip>
    <ThemedTooltip label={t('workflowx.repository')} disabled={!isSettings}>
      <SettingsButton variant="ghost" size="icon" type="button" aria-label={t('workflowx.repository')} onClick={() => {
        setLinkFailed(false)
        void window.electron.workflowx.openRepository().then(ok => setLinkFailed(!ok)).catch(() => setLinkFailed(true))
      }}><ExternalLink size={isSettings ? 16 : 12} aria-hidden="true" />{!isSettings && t('workflowx.repository')}</SettingsButton>
    </ThemedTooltip>
  </div>
  return (
    <div className={`${styles.root} ${isSettings ? styles.settings : ''}`} data-testid={isSettings ? 'workflowx-settings' : 'workflowx-monitor'} onKeyDown={event => { if (event.key === 'Escape' && open) { event.stopPropagation(); setOpen(false) } }}>
      {isSettings ? <>
        <div className={styles.header}>
          <div className={styles.heading}><span className={styles.title}>WorkflowX</span>{statusLabel}</div>
          {actions}
        </div>
        <p className={styles.help}>{t('workflowx.settingsHelp')}</p>
        <p className={styles.target}>{workspaceId ? t('workflowx.currentWorkspace', { name: workspaceName ?? t('workflowx.workspace') }) : t('workflowx.globalEnvironment')}</p>
        {sourceSummary && <p className={styles.sourceSummary}>
          <span className={styles.summaryKey}>{t('workflowx.sourcesLabel')}</span>
          <span className={styles.summaryValue} data-testid="workflowx-sources">{sourceSummary}</span>
        </p>}
        {hint && <p className={styles.sourceSummary}><span className={styles.summaryValue}>{hint}</span></p>}
        {linkFailed && <p className={styles.feedback} role="alert">{t('workflowx.linkFailed')}</p>}
      </> : <SettingsButton variant="plain" type="button" className={styles.summary} aria-expanded={open} aria-controls={detailsId}
        aria-label={t('workflowx.sources')} onClick={() => setOpen(value => !value)}>
        <span>WorkflowX</span>
        <span className={styles.state} data-status={status}>
          <i aria-hidden="true" />{t(`workflowx.status.${status}`)}<ChevronDown size={12} aria-hidden="true" />
        </span>
      </SettingsButton>}
      {open && <div id={detailsId} className={styles.details}>
        <p>{t(workspaceId ? 'workflowx.scope' : 'workflowx.globalScope')}</p>
        <p>{t(current?.unavailable ? 'workflowx.unavailable' : status === 'missing' ? 'workflowx.missingHint' : 'workflowx.limits')}</p>
        {current && current.sources.length > 0 && <ul>
          {current.sources.map(source => <li key={`${source.format}:${source.path}:${source.reason}`}>
            <span>{source.format === 'claude' ? 'Claude' : 'Codex'} · {t(`workflowx.${source.scope}`)} · {t(`workflowx.reason.${source.reason}`)}</span>
            <code>{source.path}</code>
          </li>)}
        </ul>}
        {!isSettings && actions}
        {!isSettings && linkFailed && <p>{t('workflowx.linkFailed')}</p>}
      </div>}
    </div>
  )
}
