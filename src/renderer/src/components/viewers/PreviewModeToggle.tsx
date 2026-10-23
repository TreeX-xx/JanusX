import { useI18n } from '@/i18n/useI18n'
import { useRef } from 'react'
import { CodeXml, Columns2, Eye } from 'lucide-react'
import { ThemedTooltip } from '../ui/ThemedTooltip'
import './viewer-controls.css'

export type PreviewMode = 'editor' | 'split' | 'preview'

interface PreviewModeToggleProps {
  value: PreviewMode
  onChange: (value: PreviewMode) => void
}

export function PreviewModeToggle({ value, onChange }: PreviewModeToggleProps) {
  const { t } = useI18n('editor')
  const group = useRef<HTMLDivElement>(null)
  const modes = [
    { value: 'editor' as const, label: t('editor:previewMode.code'), icon: CodeXml },
    { value: 'split' as const, label: t('editor:previewMode.split'), icon: Columns2 },
    { value: 'preview' as const, label: t('editor:previewMode.preview'), icon: Eye },
  ]
  return (
    <div ref={group} className="viewer-mode-group" role="radiogroup" aria-label={t('editor:previewMode.label')}
      onKeyDown={event => {
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
        event.preventDefault()
        event.stopPropagation()
        const index = modes.findIndex(mode => mode.value === value)
        const previous = event.key === 'ArrowLeft' || event.key === 'ArrowUp'
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? 2 : (index + (previous ? 2 : 1)) % 3
        onChange(modes[next].value)
        group.current?.querySelector<HTMLButtonElement>(`[data-preview-mode="${modes[next].value}"]`)?.focus()
      }}>
      {modes.map((mode) => {
        const active = mode.value === value
        const Icon = mode.icon
        return (
          <ThemedTooltip key={mode.value} label={mode.label}>
          <button
            type="button"
            role="radio"
            data-preview-mode={mode.value}
            aria-label={mode.label}
            aria-checked={active}
            data-on={active ? 'true' : undefined}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(mode.value)}
            className="shell-icon-btn viewer-icon"
          >
            <Icon size={15} strokeWidth={1.8} aria-hidden="true" />
          </button>
          </ThemedTooltip>
        )
      })}
    </div>
  )
}
