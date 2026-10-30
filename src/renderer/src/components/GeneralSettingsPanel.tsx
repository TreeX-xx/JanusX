import { useEffect, useState } from 'react'
import { useI18n } from '@/i18n/useI18n'
import { SUPPORTED_LANGUAGES, LANGUAGE_LABELS } from '@/i18n/config'
import { Select } from './ui/Select'
import { WorkflowXStatus } from './janus/WorkflowXMonitor'
import { useThemeStore } from '@/stores/theme'
import { ThemePreviewPicker } from './ThemePreviewPicker'
import { DEFAULT_APP_THEME } from '../../../shared/ipc/theme'
import type { AppTheme } from '../../../shared/ipc/theme'
import styles from './AppSettingsModal.module.css'
import { WorkspaceStoragePanel } from './WorkspaceStoragePanel'

export function GeneralSettingsPanel() {
  const { t, currentLanguage, setLanguage } = useI18n('settings')
  const theme = useThemeStore((s) => s.theme)
  const themeLoaded = useThemeStore((s) => s.loaded)
  const loadTheme = useThemeStore((s) => s.load)
  const setTheme = useThemeStore((s) => s.setTheme)
  const [themeError, setThemeError] = useState<string | null>(null)
  const [themeSaving, setThemeSaving] = useState(false)

  useEffect(() => {
    void loadTheme()
  }, [loadTheme])

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
    <div className={styles.generalPanel}>
      <section className={styles.generalSection}>
        <h3 className={styles.generalSectionTitle}>{t('settings:general.section.preferences')}</h3>
        <div className={`${styles.generalRow} ${styles.themeRow}`}>
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
        <div className={styles.generalRow}>
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
        </div>
        <div className={styles.generalHelp}>{t('settings:general.autoSave')}</div>
      </section>

      <section className={styles.generalSection}>
        <h3 className={styles.generalSectionTitle}>{t('settings:general.section.environment')}</h3>
        <div className={`${styles.generalRow} ${styles.generalRowWide}`}>
          <WorkflowXStatus surface="settings" />
        </div>
      </section>
      <WorkspaceStoragePanel />
    </div>
  )
}
