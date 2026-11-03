import { SquareTerminal } from 'lucide-react'
import type { CSSProperties } from 'react'
import type { TerminalPreset } from '@/types'
import { EXTERNAL_CLI_TOOL_ICONS } from '@/lib/cli-tool-icons'

export interface TerminalPresetIconProps {
  preset: TerminalPreset
  /** 尺寸由 className / style 决定（沿用各调用点原有的 h-3.5 w-3.5 等写法）。 */
  className?: string
  style?: CSSProperties
  /** 需要给读屏用户的名称；省略即视为装饰性图标。 */
  alt?: string
  onError?: () => void
}

// Shared by terminal surfaces, settings, usage and notifications. Neutral strokes
// follow the theme here, so consumers never need their own inversion/background.
// Note: .agents/notes/workbench/theme-system.md
export function TerminalPresetIcon({ preset, className, style, alt, onError }: TerminalPresetIconProps) {
  const vectorProps = {
    className, style, 'data-preset': preset,
    role: alt ? 'img' as const : undefined,
    'aria-label': alt, 'aria-hidden': alt ? undefined : true,
  }
  if (preset === 'shell') {
    return <SquareTerminal strokeWidth={1.75} {...vectorProps} />
  }
  if (preset === 'opencode') return (
    <svg viewBox="0 0 512 512" fill="none" {...vectorProps}>
      <path d="M320 224V352H192V224H320Z" fill="var(--shell-dim)" />
      <path fillRule="evenodd" clipRule="evenodd" d="M384 416H128V96H384V416ZM320 160H192V352H320V160Z" fill="currentColor" />
    </svg>
  )
  if (preset === 'janus') return (
    <svg viewBox="0 0 200 200" fill="none" strokeWidth="18" strokeLinecap="round" {...vectorProps}>
      <path d="M42 152L78 48M100 98L118 152" stroke="var(--shell-muted)" />
      <path d="M78 48L100 98L60 114" stroke="currentColor" strokeLinejoin="round" />
      <path d="M152 48V152" stroke="var(--shell-accent)" />
    </svg>
  )
  const src = EXTERNAL_CLI_TOOL_ICONS[preset]
  if (!src) return null
  return (
    <img
      src={src}
      alt={alt ?? ''}
      aria-hidden={alt ? undefined : 'true'}
      data-preset={preset}
      className={className}
      style={preset === 'codex' ? { filter: 'var(--sidebar-codex-filter)', ...style } : style}
      draggable={false}
      onError={onError}
    />
  )
}
