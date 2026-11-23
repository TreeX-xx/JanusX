import { useId, useLayoutEffect, useRef, useState } from 'react'
import { SettingsRow } from '@janusx/ui'
import { RotateCcw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { normalizeEmphasisColor, useConversationPreferences } from '@/stores/conversation-preferences'
import { useThemeDefinition } from '@/stores/theme'
import settings from './AppSettingsModal.module.css'
import styles from './AnswerEmphasisSettings.module.css'

export function AnswerEmphasisSettings({ disabled = false }: { disabled?: boolean }) {
  const { t } = useTranslation('settings')
  const theme = useThemeDefinition()
  const custom = useConversationPreferences(state => state.emphasisColors[theme.id])
  const setColor = useConversationPreferences(state => state.setEmphasisColor)
  const [draft, setDraft] = useState('')
  const [invalid, setInvalid] = useState(false)
  const sample = useRef<HTMLElement>(null)
  const picker = useRef<HTMLInputElement>(null)
  const helpId = useId(), errorId = useId()

  useLayoutEffect(() => {
    if (!sample.current || !picker.current) return
    // Persisted values are available before the asynchronous theme initialization.
    let color = custom
    if (!color) {
      // Resolve the current palette's CSS color, including color-mix and runtime themes.
      const context = document.createElement('canvas').getContext('2d')
      if (!context) return
      context.fillStyle = getComputedStyle(sample.current).color
      context.fillRect(0, 0, 1, 1)
      color = '#' + [...context.getImageData(0, 0, 1, 1).data].slice(0, 3).map(value => value.toString(16).padStart(2, '0')).join('').toUpperCase()
    }
    picker.current.value = color
    setDraft(color)
    setInvalid(false)
  }, [custom, theme, disabled])

  const commit = () => {
    const color = normalizeEmphasisColor(draft)
    setInvalid(!color)
    if (color) {
      if (color !== picker.current?.value.toUpperCase()) setColor(theme.id, color)
      setDraft(color)
    }
  }

  return <SettingsRow className={`${settings.generalRow} ${styles.row}`}>
    <div className={settings.generalLabelCol}>
      <div className={settings.generalLabel}>{t('general.emphasis.label')}</div>
      <div id={helpId} className={settings.generalHelp}>{t('general.emphasis.help')}</div>
    </div>
    <fieldset className={styles.controls} disabled={disabled} aria-label={t('general.emphasis.label')}>
      <div className={styles.fields}>
        <div className={styles.colorControl} data-invalid={invalid}>
          <input ref={picker} className={styles.swatch} type="color" aria-label={t('general.emphasis.picker')} aria-describedby={helpId}
            onChange={event => { setColor(theme.id, event.currentTarget.value); setInvalid(false) }} />
          <input className={styles.hex} value={draft} aria-label={t('general.emphasis.hex')} aria-invalid={invalid}
            aria-describedby={invalid ? `${helpId} ${errorId}` : helpId} spellCheck={false} autoComplete="off" maxLength={7}
            onChange={event => { setDraft(event.currentTarget.value); setInvalid(false) }} onBlur={commit}
            onKeyDown={event => {
              if (event.key === 'Enter') { event.preventDefault(); commit() }
              if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setDraft(picker.current?.value.toUpperCase() ?? ''); setInvalid(false) }
            }} />
        </div>
        <button type="button" className={styles.reset} disabled={!custom && !invalid} onClick={() => {
          setColor(theme.id, null); setInvalid(false); setDraft(picker.current?.value.toUpperCase() ?? '')
        }}><RotateCcw size={13} aria-hidden="true" />{t('general.emphasis.reset')}</button>
      </div>
      <span className={styles.mode}>{t(custom ? 'general.emphasis.custom' : 'general.emphasis.automatic')}</span>
      {invalid && <span className={styles.error} id={errorId} role="alert">{t('general.emphasis.invalid')}</span>}
      <div className={styles.preview} role="group" aria-label={t('general.emphasis.previewLabel')}>
        <div><span>{t('general.emphasis.previewBefore')}</span><strong>{t('general.emphasis.previewStrong')}</strong></div>
        <div><span>{t('general.emphasis.previewAfter')}</span><code ref={sample}>{t('general.emphasis.previewCode')}</code></div>
      </div>
    </fieldset>
  </SettingsRow>
}
