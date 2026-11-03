// Note: effort preview and confirmation — see .agents/notes/workbench/terminal-dialog-dual-mode.md
import { useEffect, useState, type CSSProperties } from 'react'
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

const kinds = ['quiet', 'spark', 'pulse', 'orbit', 'vortex', 'corona', 'supernova'] as const

function visualTier(effort?: string | null): number {
  return Math.ceil(effortVisualLevel(effort) ?? 0)
}

function EffortReactor({ effort, burst = false }: { effort?: string | null; burst?: boolean }) {
  const tier = visualTier(effort)
  const rings = tier < 2 ? 0 : tier - 1
  const particles = tier < 3 ? 0 : [0, 0, 0, 4, 8, 16, 24][tier]
  return <span className={styles.reactor} data-reactor={kinds[tier]} data-burst={burst || undefined} aria-hidden="true">
    <span className={styles.aura} />
    {tier >= 2 && <span className={styles.wave} />}
    {tier >= 5 && <span className={`${styles.wave} ${styles.waveOuter}`} />}
    {Array.from({ length: rings }, (_, index) => <span key={index} className={styles.orbitPlane} style={{ '--orbit-angle': `${index * 57 - 28}deg`, '--orbit-size': `${58 + index * 12}px`, '--orbit-delay': `${index * 65}ms` } as CSSProperties}>
      <i className={styles.orbit} />
    </span>)}
    {tier >= 5 && <span className={styles.corona}>{Array.from({ length: tier === 6 ? 20 : 12 }, (_, index) => <i key={index} className={styles.ray} style={{ '--angle': `${index * 360 / (tier === 6 ? 20 : 12)}deg` } as CSSProperties} />)}</span>}
    <span className={styles.particles}>{Array.from({ length: particles }, (_, index) => <i key={index} className={styles.particle} style={{ '--angle': `${index * 360 / particles + 15}deg`, '--distance': `${44 + index % 3 * 10}px`, '--particle-delay': `${index % 4 * 45}ms` } as CSSProperties} />)}</span>
    <span className={styles.core} data-energy-core="" />
    {tier === 6 && <span className={styles.flare} />}
  </span>
}

export function ReasoningEffortPreview({ effort, label, status }: { effort: string; label: string; status: string }) {
  const level = effortVisualLevel(effort)
  return <div className={styles.preview} data-effort-preview={effort} data-effort-level={level ?? 'neutral'}>
    <div className={styles.readout} aria-live="polite" aria-atomic="true"><span>{status}</span><strong>{label}</strong></div>
    <EffortReactor key={effort} effort={effort} />
  </div>
}

/** An accepted selection gets its own stage after the picker closes, without delaying application. */
export function EffortActivation({ effort, label, status, suppressed }: { effort?: string | null; label: string; status: string; suppressed: boolean }) {
  const [visible, setVisible] = useState(true)
  const tier = visualTier(effort)
  const duration = 900 + tier * 220
  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(false), duration)
    return () => window.clearTimeout(timer)
  }, [duration])
  useEffect(() => { if (suppressed) setVisible(false) }, [suppressed])
  if (!visible || suppressed) return null
  return <div className={styles.activation} data-effort-activation={effort ?? 'default'} data-activation-kind={kinds[tier]}
    style={{ '--activation-duration': `${duration}ms` } as CSSProperties} role="status">
    <div className={styles.readout}><span>{status}</span><strong>{label}</strong></div>
    <EffortReactor effort={effort} burst />
  </div>
}
