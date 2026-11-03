// Note: effort preview and confirmation — see .agents/notes/workbench/terminal-dialog-dual-mode.md
import type { CSSProperties } from 'react'
import styles from './ReasoningEffort.module.css'

const levels: Record<string, number> = { none: 0, minimal: 0.5, low: 1, medium: 2, high: 3, xhigh: 4, max: 5, ultra: 6 }

export function effortVisualLevel(effort?: string | null): number | undefined {
  return effort && Object.hasOwn(levels, effort) ? levels[effort] : undefined
}

export function EffortGlyph({ effort }: { effort?: string | null }) {
  const level = effortVisualLevel(effort)
  return <svg className={styles.glyph} width="18" height="16" viewBox="0 0 18 16" aria-hidden="true" data-effort={effort ?? 'unknown'}>
    {[4, 6, 8, 10, 12, 14].map((height, index) => <rect key={height} x={index * 3} y={15 - (level === undefined ? 8 : height)} width="2" height={level === undefined ? 8 : height} rx=".7" fill="currentColor"
      style={{ opacity: level === undefined ? 0.45 : 0.2 + 0.8 * Math.max(0, Math.min(1, level - index)) }} />)}
  </svg>
}

export function ReasoningEffortPreview({ effort, label, status }: { effort: string; label: string; status: string }) {
  const level = effortVisualLevel(effort)
  return <div className={styles.preview} data-effort-preview={effort} data-effort-level={level ?? 'neutral'}>
    <div className={styles.readout} aria-live="polite" aria-atomic="true"><span>{status}</span><strong>{label}</strong></div>
    <div className={styles.meter} aria-hidden="true">
      {Array.from({ length: 24 }, (_, index) => {
        const filled = level !== undefined && index < level * 4
        return <i key={index} data-filled={filled} style={{
          '--effort-delay': `${index * 7}ms`,
          '--effort-height': level === undefined ? 0.25 : 0.18 + (level / 6) * (0.32 + 0.5 * index / 23),
        } as CSSProperties} />
      })}
    </div>
  </div>
}
