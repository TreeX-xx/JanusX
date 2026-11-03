import { EXTERNAL_CLI_TOOL_ICONS } from './cli-icons'

// Neutral strokes follow the theme; multicolor logos retain their brand accents.
export function CliIcon({ client }: { client: string }) {
  if (client === 'opencode') return (
    <svg viewBox="0 0 512 512" fill="none" aria-hidden="true">
      <path d="M320 224V352H192V224H320Z" fill="var(--shell-dim)" />
      <path fillRule="evenodd" clipRule="evenodd" d="M384 416H128V96H384V416ZM320 160H192V352H320V160Z" fill="currentColor" />
    </svg>
  )
  if (client === 'janus') return (
    <svg viewBox="0 0 200 200" fill="none" strokeWidth="18" strokeLinecap="round" aria-hidden="true">
      <path d="M42 152L78 48M100 98L118 152" stroke="var(--shell-muted)" />
      <path d="M78 48L100 98L60 114" stroke="currentColor" strokeLinejoin="round" />
      <path d="M152 48V152" stroke="var(--shell-accent)" />
    </svg>
  )
  return <img src={EXTERNAL_CLI_TOOL_ICONS[client === 'claude-code' ? 'claude' : client]} alt="" draggable={false} style={client === 'codex' ? { filter: 'var(--sidebar-codex-filter)' } : undefined} />
}
