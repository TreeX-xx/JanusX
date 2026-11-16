import { SettingsSurface, SettingsSection, SettingsRow } from '@janusx/ui'
import { useEffect, useRef, useState } from 'react'
import { useI18n } from '@/i18n/useI18n'
import { SUPPORTED_LANGUAGES, LANGUAGE_LABELS } from '@/i18n/config'
import { Select } from './ui/Select'
import { SettingsCheckbox } from './ui/SettingsCheckbox'
import { WorkflowXStatus } from './janus/WorkflowXMonitor'
import { useThemeStore } from '@/stores/theme'
import { ThemePreviewPicker } from './ThemePreviewPicker'
import { AnswerEmphasisSettings } from './AnswerEmphasisSettings'
import { DEFAULT_APP_THEME } from '../../../shared/ipc/theme'
import type { AppTheme } from '../../../shared/ipc/theme'
import styles from './AppSettingsModal.module.css'
import { useConversationPreferences } from '@/stores/conversation-preferences'
import { useExperimentalStore } from '@/stores/experimental'
import { updateExperimentalFeatures } from '@/services/experimental-features'

// Note: .agents/notes/desktop/workspace-state-storage.md
export function GeneralSettingsPanel({ view = 'general' }: { view?: 'general' | 'appearance' }) {
  const { t, currentLanguage, setLanguage } = useI18n('settings')
  const theme = useThemeStore((s) => s.theme)
  const themeLoaded = useThemeStore((s) => s.loaded)
  const loadTheme = useThemeStore((s) => s.load)
  const setTheme = useThemeStore((s) => s.setTheme)
  const [themeError, setThemeError] = useState<string | null>(null)
  const [themeSaving, setThemeSaving] = useState(false)
  const initialView = useConversationPreferences(s => s.initialView)
  const setInitialView = useConversationPreferences(s => s.setInitialView)
  // Note: .agents/notes/remote/android-pairing-handshake.md — opt-in exposes the rail control; pairing starts separately.
  const remoteEnabled = useExperimentalStore(s => s.remoteControl)
  const featuresLoaded = useExperimentalStore(s => s.loaded)
  const loadFeatures = useExperimentalStore(s => s.load)
  const [remoteSaving, setRemoteSaving] = useState(false)
  const [remoteError, setRemoteError] = useState(false)
  const remoteSavingRef = useRef(false)

  useEffect(() => {
    void loadTheme()
  }, [loadTheme])
  useEffect(() => { if (view === 'general') void loadFeatures() }, [loadFeatures, view])

  const setRemoteEnabled = async () => {
    if (remoteSavingRef.current || !featuresLoaded) return
    remoteSavingRef.current = true
    setRemoteSaving(true)
    setRemoteError(false)
    try {
      const features = await updateExperimentalFeatures({ remoteControl: !remoteEnabled })
      useExperimentalStore.getState().apply(features)
    } catch { setRemoteError(true) }
    finally { remoteSavingRef.current = false; setRemoteSaving(false) }
  }

  const languageOptions = SUPPORTED_LANGUAGES.map((lang) => ({
    value: lang,
    label: LANGUAGE_LABELS[lang],
  }))

  const handleThemeChange = (value: string) => {
    if (themeSaving) return
    setThemeError(null)
    setThemeSaving(true)
    void setTheme(value as AppTheme).catch(() => {
      setThemeError(t('settings:general.theme.saveError'))
    }).finally(() => setThemeSaving(false))
  }

  return (
    <SettingsSurface className={styles.generalPanel}>
      <SettingsSection className={styles.generalSection}>
        <h3 className={styles.generalSectionTitle}>{t(view === 'appearance' ? 'settings:general.theme.label' : 'settings:general.section.preferences')}</h3>
        {view === 'appearance' && <><div className={`${styles.generalRow} ${styles.themeRow}`}>
          <div className={styles.generalLabelCol}>
            <div className={styles.generalLabel}>{t('settings:general.theme.label')}</div>
            <div className={styles.generalHelp}>{t('settings:general.theme.help')}</div>
            {themeError && <div className={styles.generalHelp} role="alert">{themeError}</div>}
          </div>
          <div className={styles.generalControlCol}>
            <ThemePreviewPicker
              value={themeLoaded ? theme : DEFAULT_APP_THEME}
              onChange={handleThemeChange}
              disabled={!themeLoaded || themeSaving}
              label={t('settings:general.theme.label')}
              getLabel={(id, fallback) => t(`settings:general.theme.${id}`, { defaultValue: fallback })}
            />
          </div>
        </div>
        <AnswerEmphasisSettings disabled={!themeLoaded || themeSaving} /></>}
        {view === 'general' && <SettingsRow className={styles.generalRow}>
          <div className={styles.generalLabelCol}>
            <div className={styles.generalLabel}>{t('settings:general.language.label')}</div>
            <div className={styles.generalHelp}>{t('settings:general.language.help')}</div>
          </div>
          <div className={styles.generalControlCol}>
            <Select
              value={currentLanguage}
              onChange={(value) => setLanguage(value as typeof SUPPORTED_LANGUAGES[number])}
              options={languageOptions}
              className={styles.generalSelect}
              ariaLabel={t('settings:general.language.label')}
            />
          </div>
        </SettingsRow>}
        <div className={styles.generalHelp}>{t('settings:general.autoSave')}</div>
      </SettingsSection>

      {view === 'general' && <><SettingsSection className={styles.generalSection}>
        <h3 className={styles.generalSectionTitle}>{t('settings:general.session.section')}</h3>
        <SettingsRow className={styles.generalRow}>
          <div className={styles.generalLabelCol}>
            <div className={styles.generalLabel}>{t('settings:general.session.label')}</div>
            <div className={styles.generalHelp}>{t('settings:general.session.help')}</div>
          </div>
          <div className={styles.generalControlCol}>
            <Select value={initialView} onChange={value => setInitialView(value === 'conversation' ? 'conversation' : 'terminal')}
              options={['terminal', 'conversation'].map(value => ({ value, label: t(`settings:general.session.${value}`) }))}
              className={styles.generalSelect} ariaLabel={t('settings:general.session.label')} />
          </div>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection className={styles.generalSection}>
        <h3 className={styles.generalSectionTitle}>{t('settings:general.remote.label')}</h3>
        <SettingsRow className={`${styles.generalRow} ${styles.generalToggleRow}`}>
          <div className={styles.generalLabelCol}>
            <div className={styles.generalLabel}>{t('settings:general.remote.enable')}</div>
            <div id="remote-control-help" className={styles.generalHelp}>{t('settings:general.remote.help')}</div>
            {remoteError && <div className={styles.generalHelp} role="alert">{t('settings:general.remote.saveError')}</div>}
          </div>
          <SettingsCheckbox role="switch" aria-label={t('settings:general.remote.enable')} aria-describedby="remote-control-help"
            checked={remoteEnabled} disabled={!featuresLoaded || remoteSaving} onChange={() => void setRemoteEnabled()} />
        </SettingsRow>
      </SettingsSection>

      <details className={styles.environmentSection}>
        <summary>{t('settings:general.section.environment')}</summary>
        <div className={`${styles.generalRow} ${styles.generalRowWide}`}>
          <WorkflowXStatus surface="settings" />
        </div>
      </details></>}
    </SettingsSurface>
  )
}
