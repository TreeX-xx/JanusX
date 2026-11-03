import { SettingsSurface, SettingsSection, SettingsRow, Input as SettingsInput, Button as SettingsButton, SettingsFooter, Textarea as SettingsTextarea } from '@janusx/ui'
import { SettingsCheckbox } from './ui/SettingsCheckbox'
import { Select } from './ui/Select'
import { useEffect, useState } from 'react'
import {
  getNotificationSettings,
  getFeishuControlStatus,
  testFeishuNotification,
  updateNotificationSettings,
  type AgentNotificationSettings,
  type FeishuRemoteProviderConfig,
  type RemoteNotificationSettings,
} from '@/services/notification-settings'
import {
  DEFAULT_AGENT_NOTIFICATION_SETTINGS,
  FEISHU_CONTROL_LIMITS,
  type FeishuControlStatus,
} from '../../../shared/notifications'
import { RefreshIconButton } from './ui/RefreshIconButton'
import { useI18n } from '@/i18n/useI18n'
import { settingsStyles as styles } from '@janusx/ui'

type StatusState = 'idle' | 'loading' | 'saving' | 'saved' | 'error'
type TestStatusState = 'idle' | 'testing' | 'success' | 'error'

export function NotificationSettingsPanel() {
  const { t } = useI18n('settings')
  const [settings, setSettings] = useState<AgentNotificationSettings>(
    DEFAULT_AGENT_NOTIFICATION_SETTINGS,
  )
  const [draft, setDraft] = useState<AgentNotificationSettings>(
    DEFAULT_AGENT_NOTIFICATION_SETTINGS,
  )
  const [status, setStatus] = useState<StatusState>('loading')
  const [testStatus, setTestStatus] = useState<TestStatusState>('idle')
  const [error, setError] = useState('')
  const [testMessage, setTestMessage] = useState('')
  const [controlStatus, setControlStatus] = useState<FeishuControlStatus | null>(null)
  const [statusRefreshing, setStatusRefreshing] = useState(false)

  const refreshControlStatus = async () => {
    setStatusRefreshing(true)
    try {
      setControlStatus(await getFeishuControlStatus())
    } catch {
      setControlStatus({
        state: 'error',
        enabled: false,
        configured: false,
        error: t('settings:notification.error.controlUnavailable'),
        updatedAt: Date.now(),
      })
    } finally {
      setStatusRefreshing(false)
    }
  }

  useEffect(() => {
    let cancelled = false

    setStatus('loading')
    getNotificationSettings()
      .then((next) => {
        if (cancelled) return
        setSettings(next)
        setDraft(next)
        setStatus('idle')
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : t('settings:notification.error.load'))
        setStatus('error')
      })
    void refreshControlStatus()

    return () => {
      cancelled = true
    }
  }, [])

  const updateDraft = <K extends keyof AgentNotificationSettings>(
    key: K,
    value: AgentNotificationSettings[K],
  ) => {
    setDraft((current) => ({ ...current, [key]: value }))
    if (status === 'saved' || status === 'error') {
      setStatus('idle')
      setError('')
    }
    if (testStatus !== 'idle') {
      setTestStatus('idle')
      setTestMessage('')
    }
  }

  const updateRemoteDraft = <K extends keyof RemoteNotificationSettings>(
    key: K,
    value: RemoteNotificationSettings[K],
  ) => {
    updateDraft('remote', { ...draft.remote, [key]: value })
  }

  const updateFeishuDraft = <K extends keyof FeishuRemoteProviderConfig>(
    key: K,
    value: FeishuRemoteProviderConfig[K],
  ) => {
    updateRemoteDraft('providers', {
      ...draft.remote.providers,
      feishu: {
        ...draft.remote.providers.feishu,
        [key]: value,
      },
    })
  }

  const handleNumberChange = (
    key: 'minDurationSeconds' | 'errorMessageMaxLength',
    value: string,
  ) => {
    updateDraft(key, Number(value))
  }

  const handleRemoteNumberChange = (
    key: 'minDurationSeconds' | 'dedupeWindowSeconds' | 'timeoutSeconds',
    value: string,
  ) => {
    updateRemoteDraft(key, Number(value))
  }

  const handleFeishuNumberChange = (
    key: 'bindingTtlMinutes' | 'actionTokenTtlMinutes' | 'auditRetentionDays' | 'maxPromptLength',
    value: string,
  ) => updateFeishuDraft(key, Number(value))

  const handleFeishuModeChange = (mode: 'webhook' | 'app') => {
    updateRemoteDraft('providers', {
      ...draft.remote.providers,
      feishu: {
        ...draft.remote.providers.feishu,
        mode,
        ...(mode === 'webhook' ? { inboundControlEnabled: false } : {}),
      },
    })
  }

  const handleReset = () => {
    setDraft(settings)
    setStatus('idle')
    setError('')
    setTestStatus('idle')
    setTestMessage('')
  }

  const handleSave = async () => {
    setStatus('saving')
    setError('')
    try {
      const next = await updateNotificationSettings(draft)
      setSettings(next)
      setDraft(next)
      setStatus('saved')
      void refreshControlStatus()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('settings:notification.error.save'))
      setStatus('error')
    }
  }

  const handleTestFeishu = async () => {
    setTestStatus('testing')
    setTestMessage('')
    try {
      const result = await testFeishuNotification(draft.remote)
      if (result.ok) {
        setTestStatus('success')
        setTestMessage(t('settings:notification.test.success'))
      } else {
        setTestStatus('error')
        setTestMessage(result.reason ?? t('settings:notification.test.failure'))
      }
    } catch (err) {
      setTestStatus('error')
      setTestMessage(err instanceof Error ? err.message : t('settings:notification.test.failure'))
    }
  }

  const isDirty = JSON.stringify(draft) !== JSON.stringify(settings)
  const isBusy = status === 'loading' || status === 'saving'
  const isTesting = testStatus === 'testing'
  const statusClass =
    status === 'error'
      ? `${styles.status} ${styles.statusError}`
      : status === 'saved'
        ? `${styles.status} ${styles.statusSuccess}`
        : styles.status

  return (
    <SettingsSurface className={styles.panel}>
      <SettingsSection className={styles.section}>
        <h3 className={styles.sectionTitle}>{t('settings:notification.section.desktop')}</h3>
        <SettingSwitch
          label={t('settings:notification.toggle.desktop.label')}
          hint={t('settings:notification.toggle.desktop.hint')}
          checked={draft.desktopEnabled}
          disabled={isBusy}
          onChange={(checked) => updateDraft('desktopEnabled', checked)}
        />
        <SettingSwitch
          label={t('settings:notification.toggle.onComplete.label')}
          hint={t('settings:notification.toggle.onComplete.hint')}
          checked={draft.notifyOnSuccess}
          disabled={isBusy || !draft.desktopEnabled}
          onChange={(checked) => updateDraft('notifyOnSuccess', checked)}
        />
        <SettingSwitch
          label={t('settings:notification.toggle.onFailure.label')}
          hint={t('settings:notification.toggle.onFailure.hint')}
          checked={draft.notifyOnFailure}
          disabled={isBusy || !draft.desktopEnabled}
          onChange={(checked) => updateDraft('notifyOnFailure', checked)}
        />
      </SettingsSection>

      <SettingsSection className={styles.section}>
        <h3 className={styles.sectionTitle}>{t('settings:notification.section.runtime')}</h3>
        <SettingsRow className={styles.row}>
          <div className={styles.label}>
            <span className={styles.labelText}>{t('settings:notification.row.completeThreshold.label')}</span>
            <span className={styles.hint}>{t('settings:notification.row.completeThreshold.hint')}</span>
          </div>
          <div className={styles.numberControl}>
            <SettingsInput
              className={styles.input}
              type="number"
              min={0}
              max={86400}
              step={5}
              value={draft.minDurationSeconds}
              disabled={isBusy || !draft.desktopEnabled}
              onChange={(event) => handleNumberChange('minDurationSeconds', event.target.value)}
            />
            <span className={styles.unit}>{t('settings:notification.unit.sec')}</span>
          </div>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection className={styles.section}>
        <h3 className={styles.sectionTitle}>{t('settings:notification.section.failure')}</h3>
        <SettingSwitch
          label={t('settings:notification.toggle.includeErrorMessage.label')}
          hint={t('settings:notification.toggle.includeErrorMessage.hint')}
          checked={draft.includeErrorMessage}
          disabled={isBusy || !draft.desktopEnabled || !draft.notifyOnFailure}
          onChange={(checked) => updateDraft('includeErrorMessage', checked)}
        />
        <SettingsRow className={styles.row}>
          <div className={styles.label}>
            <span className={styles.labelText}>{t('settings:notification.row.errorMessageLength.label')}</span>
            <span className={styles.hint}>{t('settings:notification.row.errorMessageLength.hint')}</span>
          </div>
          <div className={styles.numberControl}>
            <SettingsInput
              className={styles.input}
              type="number"
              min={40}
              max={500}
              step={10}
              value={draft.errorMessageMaxLength}
              disabled={
                isBusy ||
                !draft.desktopEnabled ||
                !draft.notifyOnFailure ||
                !draft.includeErrorMessage
              }
              onChange={(event) => handleNumberChange('errorMessageMaxLength', event.target.value)}
            />
            <span className={styles.unit}>{t('settings:notification.unit.chars')}</span>
          </div>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection className={styles.section}>
        <h3 className={styles.sectionTitle}>{t('settings:notification.section.remote')}</h3>
        <SettingSwitch
          label={t('settings:notification.toggle.remote.label')}
          hint={t('settings:notification.toggle.remote.hint')}
          checked={draft.remote.enabled}
          disabled={isBusy}
          onChange={(checked) => updateRemoteDraft('enabled', checked)}
        />
        {draft.remote.enabled && (
          <>
            <SettingSwitch
              label={t('settings:notification.toggle.remoteComplete.label')}
              hint={t('settings:notification.toggle.remoteComplete.hint')}
              checked={draft.remote.notifyOnCompleted}
              disabled={isBusy || !draft.remote.enabled}
              onChange={(checked) => updateRemoteDraft('notifyOnCompleted', checked)}
            />
            <SettingSwitch
              label={t('settings:notification.toggle.remoteFailure.label')}
              hint={t('settings:notification.toggle.remoteFailure.hint')}
              checked={draft.remote.notifyOnFailed}
              disabled={isBusy || !draft.remote.enabled}
              onChange={(checked) => updateRemoteDraft('notifyOnFailed', checked)}
            />
            <SettingSwitch
              label={t('settings:notification.toggle.remoteAttention.label')}
              hint={t('settings:notification.toggle.remoteAttention.hint')}
              checked={draft.remote.notifyOnAttention}
              disabled={isBusy || !draft.remote.enabled}
              onChange={(checked) => updateRemoteDraft('notifyOnAttention', checked)}
            />
            <SettingSwitch
              label={t('settings:notification.toggle.remoteApproval.label')}
              hint={t('settings:notification.toggle.remoteApproval.hint')}
              checked={draft.remote.notifyOnApproval}
              disabled={isBusy || !draft.remote.enabled}
              onChange={(checked) => updateRemoteDraft('notifyOnApproval', checked)}
            />
            <SettingsRow className={styles.row}>
              <div className={styles.label}>
                <span className={styles.labelText}>{t('settings:notification.row.remoteCompleteThreshold.label')}</span>
                <span className={styles.hint}>{t('settings:notification.row.remoteCompleteThreshold.hint')}</span>
              </div>
              <div className={styles.numberControl}>
                <SettingsInput
                  className={styles.input}
                  type="number"
                  min={0}
                  max={86400}
                  step={5}
                  value={draft.remote.minDurationSeconds}
                  disabled={isBusy || !draft.remote.enabled}
                  onChange={(event) => handleRemoteNumberChange('minDurationSeconds', event.target.value)}
                />
                <span className={styles.unit}>{t('settings:notification.unit.sec')}</span>
              </div>
            </SettingsRow>
            <details className={styles.advanced}>
              <summary>{t('settings:notification.advanced')}</summary>
              <div className={styles.dependentFields}>
                <SettingsRow className={styles.row}>
                  <div className={styles.label}>
                    <span className={styles.labelText}>{t('settings:notification.row.dedupeWindow.label')}</span>
                    <span className={styles.hint}>{t('settings:notification.row.dedupeWindow.hint')}</span>
                  </div>
                  <div className={styles.numberControl}>
                    <SettingsInput
                      className={styles.input}
                      type="number"
                      min={0}
                      max={86400}
                      step={30}
                      value={draft.remote.dedupeWindowSeconds}
                      disabled={isBusy || !draft.remote.enabled}
                      onChange={(event) => handleRemoteNumberChange('dedupeWindowSeconds', event.target.value)}
                    />
                    <span className={styles.unit}>{t('settings:notification.unit.sec')}</span>
                  </div>
                </SettingsRow>
                <SettingsRow className={styles.row}>
                  <div className={styles.label}>
                    <span className={styles.labelText}>{t('settings:notification.row.sendTimeout.label')}</span>
                    <span className={styles.hint}>{t('settings:notification.row.sendTimeout.hint')}</span>
                  </div>
                  <div className={styles.numberControl}>
                    <SettingsInput
                      className={styles.input}
                      type="number"
                      min={1}
                      max={120}
                      step={1}
                      value={draft.remote.timeoutSeconds}
                      disabled={isBusy || !draft.remote.enabled}
                      onChange={(event) => handleRemoteNumberChange('timeoutSeconds', event.target.value)}
                    />
                    <span className={styles.unit}>{t('settings:notification.unit.sec')}</span>
                  </div>
                </SettingsRow>
              </div>
            </details>
          </>
        )}
      </SettingsSection>

      {draft.remote.enabled && (
        <SettingsSection className={styles.section}>
          <h3 className={styles.sectionTitle}>{t('settings:notification.section.feishu')}</h3>
          <SettingSwitch
            label={t('settings:notification.toggle.feishu.label')}
            hint={t('settings:notification.toggle.feishu.hint')}
            checked={draft.remote.providers.feishu.enabled}
            disabled={isBusy || !draft.remote.enabled}
            onChange={(checked) => updateFeishuDraft('enabled', checked)}
          />
          {draft.remote.providers.feishu.enabled && (
            <>
              <SettingsRow className={styles.row}>
                <div className={styles.label}>
                  <span className={styles.labelText}>{t('settings:notification.row.feishuMode.label')}</span>
                  <span className={styles.hint}>{t('settings:notification.row.feishuMode.hint')}</span>
                </div>
                <Select
                  ariaLabel={t('settings:notification.row.feishuMode.label')}
                  className={styles.select}
                  value={draft.remote.providers.feishu.mode}
                  disabled={isBusy || !draft.remote.enabled || !draft.remote.providers.feishu.enabled}
                  onChange={value => handleFeishuModeChange(value === 'app' ? 'app' : 'webhook')}
                  options={[{ value: 'webhook', label: t('settings:notification.option.webhook') }, { value: 'app', label: t('settings:notification.option.app') }]}
                />
              </SettingsRow>
              {draft.remote.providers.feishu.mode === 'webhook' ? (
                <TextInputRow
                  label={t('settings:notification.row.webhookUrl.label')}
                  hint={t('settings:notification.row.webhookUrl.hint')}
                  value={draft.remote.providers.feishu.webhookUrl}
                  disabled={isBusy || !draft.remote.enabled || !draft.remote.providers.feishu.enabled}
                  onChange={(value) => updateFeishuDraft('webhookUrl', value)}
                />
              ) : (
                <>
                  <TextInputRow
                    label={t('settings:notification.row.appId.label')}
                    hint={t('settings:notification.row.appId.hint')}
                    value={draft.remote.providers.feishu.appId}
                    disabled={isBusy || !draft.remote.enabled || !draft.remote.providers.feishu.enabled}
                    onChange={(value) => updateFeishuDraft('appId', value)}
                  />
                  <TextInputRow
                    label={t('settings:notification.row.appSecret.label')}
                    hint={t('settings:notification.row.appSecret.hint')}
                    type="password"
                    value={draft.remote.providers.feishu.appSecret}
                    disabled={isBusy || !draft.remote.enabled || !draft.remote.providers.feishu.enabled}
                    onChange={(value) => updateFeishuDraft('appSecret', value)}
                  />
                  <SettingsRow className={styles.row}>
                    <div className={styles.label}>
                      <span className={styles.labelText}>{t('settings:notification.row.receiveIdType.label')}</span>
                      <span className={styles.hint}>{t('settings:notification.row.receiveIdType.hint')}</span>
                    </div>
                    <Select
                      ariaLabel={t('settings:notification.row.receiveIdType.label')}
                      className={styles.select}
                      value={draft.remote.providers.feishu.receiveIdType}
                      disabled={isBusy || !draft.remote.enabled || !draft.remote.providers.feishu.enabled}
                      onChange={value =>
                        updateFeishuDraft(
                          'receiveIdType',
                          value === 'open_id' ? 'open_id' : 'chat_id',
                        )
                      }
                      options={[{ value: 'chat_id', label: t('settings:notification.option.chatId') }, { value: 'open_id', label: t('settings:notification.option.openId') }]}
                    />
                  </SettingsRow>
                  <TextInputRow
                    label={t('settings:notification.row.receiveId.label')}
                    hint={t('settings:notification.row.receiveId.hint')}
                    value={draft.remote.providers.feishu.receiveId}
                    disabled={isBusy || !draft.remote.enabled || !draft.remote.providers.feishu.enabled}
                    onChange={(value) => updateFeishuDraft('receiveId', value)}
                  />
                  <SettingSwitch
                    label={t('settings:notification.toggle.feishuControl.label')}
                    hint={t('settings:notification.toggle.feishuControl.hint')}
                    checked={draft.remote.providers.feishu.inboundControlEnabled}
                    disabled={isBusy || !draft.remote.enabled || !draft.remote.providers.feishu.enabled}
                    onChange={(checked) => updateFeishuDraft('inboundControlEnabled', checked)}
                  />
                  <TextAreaRow
                    label={t('settings:notification.row.allowedOpenIds.label')}
                    hint={t('settings:notification.row.allowedOpenIds.hint')}
                    value={draft.remote.providers.feishu.allowedOpenIds.join('\n')}
                    disabled={isBusy || !draft.remote.providers.feishu.enabled}
                    onChange={(value) => updateFeishuDraft(
                      'allowedOpenIds',
                      value.split(/[\s,]+/).filter(Boolean),
                  )}
                />
                <TextInputRow
                  label={t('settings:notification.row.groupPromptPrefix.label')}
                  hint={t('settings:notification.row.groupPromptPrefix.hint')}
                  value={draft.remote.providers.feishu.groupPromptPrefix}
                  disabled={isBusy || !draft.remote.providers.feishu.inboundControlEnabled}
                  onChange={(value) => updateFeishuDraft('groupPromptPrefix', value)}
                />
                <ControlNumberRow
                  label={t('settings:notification.row.bindingTtl.label')}
                  hint={t('settings:notification.row.bindingTtl.hint')}
                  value={draft.remote.providers.feishu.bindingTtlMinutes}
                  min={FEISHU_CONTROL_LIMITS.bindingTtlMinutes.min}
                  max={FEISHU_CONTROL_LIMITS.bindingTtlMinutes.max}
                  unit={t('settings:notification.unit.min')}
                  disabled={isBusy || !draft.remote.providers.feishu.inboundControlEnabled}
                  onChange={(value) => handleFeishuNumberChange('bindingTtlMinutes', value)}
                />
                <ControlNumberRow
                  label={t('settings:notification.row.cardActionTtl.label')}
                  hint={t('settings:notification.row.cardActionTtl.hint')}
                  value={draft.remote.providers.feishu.actionTokenTtlMinutes}
                  min={FEISHU_CONTROL_LIMITS.actionTokenTtlMinutes.min}
                  max={FEISHU_CONTROL_LIMITS.actionTokenTtlMinutes.max}
                  unit={t('settings:notification.unit.min')}
                  disabled={isBusy || !draft.remote.providers.feishu.inboundControlEnabled}
                  onChange={(value) => handleFeishuNumberChange('actionTokenTtlMinutes', value)}
                />
                <ControlNumberRow
                  label={t('settings:notification.row.auditRetentionDays.label')}
                  hint={t('settings:notification.row.auditRetentionDays.hint')}
                  value={draft.remote.providers.feishu.auditRetentionDays}
                  min={FEISHU_CONTROL_LIMITS.auditRetentionDays.min}
                  max={FEISHU_CONTROL_LIMITS.auditRetentionDays.max}
                  unit={t('settings:notification.unit.days')}
                  disabled={isBusy || !draft.remote.providers.feishu.inboundControlEnabled}
                  onChange={(value) => handleFeishuNumberChange('auditRetentionDays', value)}
                />
                <ControlNumberRow
                  label={t('settings:notification.row.maxFollowUpLength.label')}
                  hint={t('settings:notification.row.maxFollowUpLength.hint')}
                  value={draft.remote.providers.feishu.maxPromptLength}
                  min={FEISHU_CONTROL_LIMITS.maxPromptLength.min}
                  max={FEISHU_CONTROL_LIMITS.maxPromptLength.max}
                  unit={t('settings:notification.unit.chars')}
                  disabled={isBusy || !draft.remote.providers.feishu.inboundControlEnabled}
                  onChange={(value) => handleFeishuNumberChange('maxPromptLength', value)}
                />
                <div className={styles.controlStatus}>
                  <div className={styles.label}>
                    <span className={styles.labelText}>{t('settings:notification.row.controlStatus.label')}</span>
                    <span className={styles.hint}>
                      {controlStatus
                        ? `${controlStatus.state} / ${controlStatus.configured ? 'configured' : 'not configured'} / ${new Date(controlStatus.updatedAt).toLocaleString()}`
                        : t('settings:notification.row.controlStatus.unavailable')}
                    </span>
                    {controlStatus?.error && <span className={styles.statusError}>{controlStatus.error}</span>}
                  </div>
                  <RefreshIconButton
                    accent="blue"
                    label={t('settings:notification.action.refreshFeishu')}
                    loading={statusRefreshing}
                    onClick={() => { void refreshControlStatus() }}
                  />
                </div>
                <p className={styles.controlNotice}>
                  {t('settings:notification.controlNotice')}
                </p>
              </>
            )}
            <div className={styles.testRow}>
              <SettingsButton variant="ghost"
                type="button"

                onClick={handleTestFeishu}
                disabled={isBusy || isTesting || !draft.remote.providers.feishu.enabled}
              >
                {isTesting ? t('settings:notification.action.testing') : t('settings:notification.action.testFeishu')}
              </SettingsButton>
              <span
                className={
                  testStatus === 'error'
                    ? `${styles.status} ${styles.statusError}`
                    : testStatus === 'success'
                      ? `${styles.status} ${styles.statusSuccess}`
                      : styles.status
                }
              >
                {testMessage}
              </span>
            </div>
            </>
          )}
        </SettingsSection>
      )}

      <SettingsFooter className={styles.footer}>
        <div className={statusClass} role="status">
          {status === 'loading' && t('settings:footer.loading')}
          {status === 'saving' && t('settings:footer.saving')}
          {status === 'saved' && t('settings:footer.saved')}
          {status === 'idle' && isDirty && t('settings:footer.unsaved')}
          {status === 'error' && error}
        </div>
        <div className={styles.actions}>
          <SettingsButton variant="ghost"
            type="button"

            onClick={handleReset}
            disabled={isBusy || !isDirty}
          >
            {t('settings:footer.reset')}
          </SettingsButton>
          <SettingsButton variant="primary"
            type="button"

            onClick={handleSave}
            disabled={isBusy || !isDirty}
          >
            {t('settings:footer.save')}
          </SettingsButton>
        </div>
      </SettingsFooter>
    </SettingsSurface>
  )
}

function TextInputRow({
  label,
  hint,
  value,
  type = 'text',
  disabled,
  onChange,
}: {
  label: string
  hint: string
  value: string
  type?: 'text' | 'password'
  disabled?: boolean
  onChange: (value: string) => void
}) {
  return (
    <SettingsRow className={styles.row}>
      <div className={styles.label}>
        <span className={styles.labelText}>{label}</span>
        <span className={styles.hint}>{hint}</span>
      </div>
      <SettingsInput
        className={`${styles.input} ${styles.textInput}`}
        type={type}
        aria-label={label}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
    </SettingsRow>
  )
}

function TextAreaRow({
  label,
  hint,
  value,
  disabled,
  onChange,
}: {
  label: string
  hint: string
  value: string
  disabled?: boolean
  onChange: (value: string) => void
}) {
  return (
    <SettingsRow className={styles.row}>
      <div className={styles.label}>
        <span className={styles.labelText}>{label}</span>
        <span className={styles.hint}>{hint}</span>
      </div>
      <SettingsTextarea
        className={`${styles.input} ${styles.textArea}`}
        rows={3}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
    </SettingsRow>
  )
}

function ControlNumberRow({
  label,
  hint,
  value,
  min,
  max,
  unit,
  disabled,
  onChange,
}: {
  label: string
  hint: string
  value: number
  min: number
  max: number
  unit: string
  disabled?: boolean
  onChange: (value: string) => void
}) {
  return (
    <SettingsRow className={styles.row}>
      <div className={styles.label}>
        <span className={styles.labelText}>{label}</span>
        <span className={styles.hint}>{hint}</span>
      </div>
      <div className={styles.numberControl}>
        <SettingsInput
          className={styles.input}
          type="number"
          min={min}
          max={max}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        />
        <span className={styles.unit}>{unit}</span>
      </div>
    </SettingsRow>
  )
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
      <div className={styles.label}>
        <span className={styles.labelText}>{label}</span>
        <span className={styles.hint}>{hint}</span>
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
