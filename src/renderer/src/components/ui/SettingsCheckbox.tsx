import type { InputHTMLAttributes } from 'react'
import styles from './SettingsCheckbox.module.css'

// Note: .agents/notes/workbench/settings-layout.md — notification-style settings controls.
export function SettingsCheckbox({ className = '', ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  return <input {...props} type="checkbox" className={`${styles.control} ${className}`} />
}
