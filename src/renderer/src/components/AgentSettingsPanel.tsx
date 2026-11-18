import { SettingsSurface, SettingsSection, SettingsRow, SettingsFooter, Button as SettingsButton } from '@janusx/ui'
import { SettingsCheckbox } from './ui/SettingsCheckbox'
import { useEffect, useState } from 'react'
import { useI18n } from '@/i18n/useI18n'
import { Select } from './ui/Select'
import { getAgentSettings, normalizeAgentMaxStepsInput, normalizeSafeCompileAutoAllowInput, updateAgentSettings, type AgentSettings } from '@/services/agent-settings'
import { normalizeAgentApprovalMode, type AgentApprovalMode } from '../../../shared/ipc/agent-runtime'
import { settingsStyles as styles } from '@janusx/ui'
import { ShieldCheck } from 'lucide-react'
import { useSuperAgentUIStore } from '@/stores/superagent-ui'
import { WorkerDefaultsSettings } from './WorkerDefaultsSettings'
import { WorkerCapacitySettings } from './WorkerCapacitySettings'

type StatusState = 'idle' | 'loading' | 'saving' | 'saved' | 'error'
const DEFAULT_SETTINGS: AgentSettings = { approvalMode: 'per-action', agentMaxSteps: 40, safeCompileAutoAllow: true }

export function AgentSettingsPanel() {
  const { t } = useI18n('settings')
  const showWorkerSettings = useSuperAgentUIStore(state => state.started || state.agentMode === 'superagent')
  const [settings, setSettings] = useState<AgentSettings>(DEFAULT_SETTINGS)
  const [draft, setDraft] = useState<AgentSettings>(DEFAULT_SETTINGS)
  const [status, setStatus] = useState<StatusState>('loading')
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    getAgentSettings().then((next) => {
      if (cancelled) return
      const normalized: AgentSettings = {
        approvalMode: normalizeAgentApprovalMode(next.approvalMode),
        agentMaxSteps: normalizeAgentMaxStepsInput(next.agentMaxSteps),
        safeCompileAutoAllow: normalizeSafeCompileAutoAllowInput(next.safeCompileAutoAllow),
      }
      setSettings(normalized); setDraft(normalized); setStatus('idle')
    }).catch((err) => {
      if (cancelled) return
      setError(err instanceof Error ? err.message : t('settings:agent.error.load')); setStatus('error')
    })
    return () => { cancelled = true }
  }, [t])

  const updateDraft = (approvalMode: AgentApprovalMode) => {
    setDraft((current) => ({ ...current, approvalMode }))
    if (status === 'saved' || status === 'error') { setStatus('idle'); setError('') }
  }

  const handleSafeCompileChange = (checked: boolean) => {
    setDraft((current) => ({ ...current, safeCompileAutoAllow: checked }))
    if (status === 'saved' || status === 'error') { setStatus('idle'); setError('') }
  }

  const handleSave = async () => {
    setStatus('saving'); setError('')
    try {
      const next = await updateAgentSettings({
        approvalMode: draft.approvalMode,
        agentMaxSteps: normalizeAgentMaxStepsInput(draft.agentMaxSteps),
        safeCompileAutoAllow: draft.safeCompileAutoAllow,
      })
      const normalized: AgentSettings = {
        approvalMode: normalizeAgentApprovalMode(next.approvalMode),
        agentMaxSteps: normalizeAgentMaxStepsInput(next.agentMaxSteps),
        safeCompileAutoAllow: normalizeSafeCompileAutoAllowInput(next.safeCompileAutoAllow),
      }
      setSettings(normalized); setDraft(normalized); setStatus('saved')
    } catch (err) {
      setError(err instanceof Error ? err.message : t('settings:agent.error.save')); setStatus('error')
    }
  }

  const isDirty = draft.approvalMode !== settings.approvalMode || draft.agentMaxSteps !== settings.agentMaxSteps || draft.safeCompileAutoAllow !== settings.safeCompileAutoAllow
  const isBusy = status === 'loading' || status === 'saving'
  const statusClass = status === 'error' ? `${styles.status} ${styles.statusError}` : status === 'saved' ? `${styles.status} ${styles.statusSuccess}` : styles.status
  const options = [
    { value: 'per-action', label: t('settings:agent.default.mode.perAction') },
    { value: 'auto-run', label: t('settings:agent.default.mode.autoRun') },
    { value: 'plan', label: t('settings:agent.default.mode.plan') },
  ]

  return <SettingsSurface className={styles.panel}>
    <SettingsSection className={styles.section} aria-label={t('settings:agent.section.permissions')}>
      <h3 className={styles.sectionTitle}><ShieldCheck size={18} aria-hidden="true" />{t('settings:agent.section.permissions')}</h3>
      <SettingsRow className={styles.row}>
        <div className={styles.label}>
          <span className={styles.labelText}>{t('settings:agent.default.label')}</span>
        </div>
        <Select
          value={draft.approvalMode}
          disabled={isBusy}
          onChange={(value) => updateDraft(normalizeAgentApprovalMode(value))}
          options={options}
          ariaLabel={t('settings:agent.default.label')}
        />
      </SettingsRow>
      <SettingSwitch
        label={t('settings:agent.safeCompile.label')}
        hint={t('settings:agent.safeCompile.hint')}
        checked={draft.safeCompileAutoAllow}
        disabled={isBusy}
        onChange={handleSafeCompileChange}
      />
    <SettingsFooter className={styles.footer} sticky={false}>
      <div className={statusClass} role="status">{status === 'loading' && t('settings:footer.loading')}{status === 'saving' && t('settings:footer.saving')}{status === 'saved' && t('settings:footer.saved')}{status === 'idle' && isDirty && t('settings:footer.unsaved')}{status === 'error' && error}</div>
      <div className={styles.actions}>
        <SettingsButton variant="ghost" type="button"  onClick={() => { setDraft(settings); setStatus('idle'); setError('') }} disabled={isBusy || !isDirty}>{t('settings:footer.reset')}</SettingsButton>
        <SettingsButton variant="primary" type="button"  onClick={() => void handleSave()} disabled={isBusy || !isDirty}>{t('settings:footer.save')}</SettingsButton>
      </div>
    </SettingsFooter>
    </SettingsSection>
    {showWorkerSettings && window.electron?.superAgent && <>
      <WorkerCapacitySettings />
      <WorkerDefaultsSettings />
    </>}
  </SettingsSurface>
}

function SettingSwitch({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string
  hint: string
  checked: boolean
  disabled?: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <SettingsRow className={styles.row}>
      <div className={styles.label} title={hint}>
        <span className={styles.labelText}>{label}</span>
      </div>
      <SettingsCheckbox
          aria-label={label}
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
        />
    </SettingsRow>
  )
}
