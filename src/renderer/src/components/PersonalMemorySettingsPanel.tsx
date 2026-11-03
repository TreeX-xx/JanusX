import { SettingsSurface, SettingsSection, SettingsLabel } from '@janusx/ui'
import { SettingsCheckbox } from './ui/SettingsCheckbox'
import { Select } from './ui/Select'
import { useEffect, useState } from 'react'
import { Clock3, MessageSquare, UserRound } from 'lucide-react'
import type { PersonalMemorySettings } from '../../../shared/personal-memory-settings'
import { useI18n } from '@/i18n/useI18n'
import { settingsStyles as styles } from '@janusx/ui'

export function PersonalMemorySettingsPanel() {
  const { t } = useI18n('knowledge')
  const [settings, setSettings] = useState<PersonalMemorySettings | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    window.electron.knowledge.getPersonalSettings().then(value => { if (active) setSettings(value) })
      .catch(() => { if (active) setError(t('knowledge:error.loadFailed')) })
    return () => { active = false }
  }, [t])
  const update = async (partial: Partial<PersonalMemorySettings>) => {
    if (busy) return
    setBusy(true); setError('')
    try { setSettings(await window.electron.knowledge.updatePersonalSettings(partial)) }
    catch { setError(t('knowledge:review.failed')) }
    finally { setBusy(false) }
  }
  return <SettingsSurface className={styles.panel}>
    <p className={styles.hint}>{t('knowledge:memorySettings.description')}</p>
    {error && <p role="alert" className={styles.statusError}>{error}</p>}
    {!settings && !error && <p role="status">{t('knowledge:state.loading.title')}</p>}
    {settings && <>
      {[{ title: 'capture', icon: UserRound, keys: ['captureConversations', 'inferEngineeringHabits'] as const },
        { title: 'recall', icon: MessageSquare, keys: ['useInChat'] as const }].map(group => <SettingsSection key={group.title} className={styles.section} aria-busy={busy}>
        <h3 className={styles.sectionTitle}><group.icon size={14} aria-hidden />{t(`knowledge:memorySettings.groups.${group.title}`)}</h3>
      {group.keys.map(key =>
        <SettingsLabel key={key} className={styles.row}>
          <span className={styles.label}><span className={styles.labelText}>{t(`knowledge:memorySettings.${key}`)}</span>
            <span className={styles.hint}>{t(`knowledge:memorySettings.${key}Hint`)}</span></span>
          <SettingsCheckbox checked={settings[key]} disabled={busy}
            onChange={event => void update({ [key]: event.target.checked })} />
        </SettingsLabel>)}
      </SettingsSection>)}
      <SettingsSection className={styles.section} aria-busy={busy}>
      <h3 className={styles.sectionTitle}><Clock3 size={14} aria-hidden />{t('knowledge:memorySettings.groups.retention')}</h3>
      <SettingsLabel className={styles.row}><span className={styles.label}>
        <span className={styles.labelText}>{t('knowledge:memorySettings.retention')}</span>
        <span className={styles.hint}>{t('knowledge:memorySettings.retentionHint')}</span></span>
        <Select ariaLabel={t('knowledge:memorySettings.retention')} value={String(settings.episodeTtlDays)} disabled={busy}
          onChange={value => void update({ episodeTtlDays: Number(value) })}
          options={[...new Set([30, 60, 90, settings.episodeTtlDays])].sort((a, b) => a - b).map(days => ({ value: String(days), label: t('knowledge:memorySettings.days', { count: days }) }))} />
      </SettingsLabel>
      </SettingsSection>
    </>}
    <p className={styles.hint}>{t('knowledge:memorySettings.savedImmediately')}</p>
  </SettingsSurface>
}
