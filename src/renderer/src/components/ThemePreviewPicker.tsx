import { useId, useSyncExternalStore, type CSSProperties } from 'react'
import { Check } from 'lucide-react'
import { getThemeDefinition, listThemeDefinitions, subscribeThemeRegistry, themeRegistryRevision } from '../../../shared/theme/registry'
import styles from './ThemePreviewPicker.module.css'

interface ThemePreviewPickerProps {
  value: string
  label: string
  disabled?: boolean
  getLabel: (id: string, fallback: string) => string
  onChange: (id: string) => void
}

export function ThemePreviewPicker({ value, label, disabled, getLabel, onChange }: ThemePreviewPickerProps) {
  const name = useId()
  useSyncExternalStore(subscribeThemeRegistry, themeRegistryRevision)
  return (
    <fieldset className={styles.picker} aria-label={label} disabled={disabled} aria-busy={disabled}>
      {listThemeDefinitions().map((definition) => (
        <label key={definition.id} className={styles.card} data-selected={getThemeDefinition(value).id === definition.id}>
          <input
            className={styles.radio}
            type="radio"
            name={name}
            value={definition.id}
            checked={getThemeDefinition(value).id === definition.id}
            onChange={() => onChange(definition.id)}
          />
          <span
            className={styles.preview}
            data-theme-preview={definition.id}
            aria-hidden="true"
            style={Object.fromEntries(Object.entries(definition.tokens).map(([key, color]) => [`--${key}`, color])) as CSSProperties}
          >
            <span className={styles.titlebar}><i /><i /><i /><span /></span>
            <span className={styles.workbench}>
              <span className={styles.sidebar}>
                <i className={styles.sideHeading} /><i className={styles.sideActive} /><i /><i />
              </span>
              <span className={styles.workspace}>
                <span className={styles.tabs}><i /><i /></span>
                <span className={styles.content}><i /><i /><i /><i className={styles.cursor} /></span>
                <span className={styles.footer}><i /><i /></span>
              </span>
            </span>
          </span>
          <span className={styles.caption}>
            <span>{getLabel(definition.id, definition.label)}</span>
            <Check size={14} strokeWidth={2} className={styles.check} aria-hidden="true" />
          </span>
        </label>
      ))}
    </fieldset>
  )
}
