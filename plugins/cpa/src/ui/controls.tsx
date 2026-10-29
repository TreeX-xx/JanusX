import type { ReactNode } from 'react'
export function ThemedTooltip({ label, children }: {label: string; children: ReactNode}) { return <span title={label}>{children}</span> }
export function Select({ value, onChange, options, ariaLabel, disabled, className }: {
  value: string; onChange(value: string): void; options: {value: string; label: string}[]; ariaLabel: string; disabled?: boolean; className?: string; role?: string
}) {
  return <select value={value} onChange={event => onChange(event.target.value)} aria-label={ariaLabel} disabled={disabled} className={className}>
    {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
  </select>
}
