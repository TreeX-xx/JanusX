// Note: effort activation on the composer — see .agents/notes/workbench/terminal-dialog-dual-mode.md
import { useEffect, useState, type CSSProperties } from 'react'
import styles from './ReasoningEffort.module.css'

const levels: Record<string, number> = { none: 0, minimal: 0.5, low: 1, medium: 2, high: 3, xhigh: 4, max: 5, ultra: 6 }

export function effortVisualLevel(effort?: string | null): number | undefined {
  return effort && Object.hasOwn(levels, effort) ? levels[effort] : undefined
}

/** Shared by the picker, persistent control and activation, including native snapshot updates. */
export function effortToneClass(effort?: string | null): string {
  return effort === 'minimal' ? styles.toneMinimal : styles[`tone${effortVisualLevel(effort) ?? 0}`]
}

export function EffortGlyph({ effort }: { effort?: string | null }) {
  const level = effortVisualLevel(effort)
  return <svg className={styles.glyph} width="18" height="16" viewBox="0 0 18 16" aria-hidden="true" data-effort={effort ?? 'unknown'}>
    {[4, 6, 8, 10, 12, 14].map((height, index) => <rect key={height} x={index * 3} y={15 - (level === undefined ? 8 : height)} width="2" height={level === undefined ? 8 : height} rx=".7" fill="currentColor"
      style={{ opacity: level === undefined ? 0.45 : 0.2 + 0.8 * Math.max(0, Math.min(1, level - index)) }} />)}
  </svg>
}

const kinds = ['quiet', 'spark', 'pulse', 'sweep', 'surge', 'corona', 'supernova'] as const

/** A successful change lights the composer itself; the overlay never captures input. */
export function EffortActivation({ effort, label, status, suppressed }: { effort?: string | null; label: string; status: string; suppressed: boolean }) {
  const [visible, setVisible] = useState(true)
  const tier = Math.ceil(effortVisualLevel(effort) ?? 0)
  const duration = 900 + tier * 250
  const particles = tier < 4 ? 0 : (tier - 3) * 8
  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(false), duration)
    return () => window.clearTimeout(timer)
  }, [duration])
  useEffect(() => { if (suppressed) setVisible(false) }, [suppressed])
  if (!visible || suppressed) return null
  return <div className={`${styles.activation} ${effortToneClass(effort)}`} data-effort-activation={effort ?? 'default'} data-activation-kind={kinds[tier]}
    style={{ '--activation-duration': `${duration}ms` } as CSSProperties} role="status">
    <span className={styles.announcement}>{status}: {label}</span>
    <span className={styles.surface} data-effort-surface="" aria-hidden="true" />
    {tier >= 2 && <span className={styles.wave} aria-hidden="true" />}
    {tier >= 4 && <span className={`${styles.wave} ${styles.waveOuter}`} aria-hidden="true" />}
    {tier >= 3 && <span className={styles.wash} aria-hidden="true"><i /></span>}
    {particles > 0 && <span className={styles.particles} aria-hidden="true"><span className={styles.particleField}>
      {Array.from({ length: particles }, (_, index) => {
        const side = Math.floor(index * 4 / particles)
        const along = (index * 4 / particles % 1) * 80 + 10
        return <i key={index} className={styles.particle} style={{
          left: `${side === 0 ? along : side === 1 ? 100 : side === 2 ? 100 - along : 0}%`,
          top: `${side === 0 ? 0 : side === 1 ? along : side === 2 ? 100 : 100 - along}%`,
          '--drift-x': `${side === 1 ? 8 : side === 3 ? -8 : (index % 3 - 1) * 12}px`,
          '--drift-y': `${side === 0 ? -8 : side === 2 ? 8 : (index % 3 - 1) * 12}px`,
          '--particle-delay': `${160 + index % 4 * 95}ms`,
        } as CSSProperties} />
      })}
    </span></span>}
    {tier === 6 && <span className={styles.flares} aria-hidden="true"><i /><i /><i /><i /></span>}
  </div>
}
