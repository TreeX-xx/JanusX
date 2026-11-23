import { Zap } from 'lucide-react'
import styles from './ResponseSpeed.module.css'

export function speedLevel(tier?: string | null) {
  if (tier === 'ultrafast') return 'ultrafast'
  if (tier === 'fast' || tier === 'priority') return 'fast'
  return 'standard'
}

export type SpeedLevel = ReturnType<typeof speedLevel>
type SpeedPhase = 'pending' | 'confirmed'

export function SpeedGlyph({ tier, phase }: { tier: SpeedLevel; phase: SpeedPhase | null }) {
  return <span className={styles.glyph} data-speed-icon={tier} data-phase={phase ?? undefined} aria-hidden="true">
    {tier === 'ultrafast' && <Zap className={styles.echo} strokeWidth={1.6} />}
    <Zap className={styles.front} strokeWidth={1.8} />
    {phase && tier === 'fast' && <Zap className={styles.charge} strokeWidth={1.8} />}
  </span>
}

export function SpeedTrace({ tier, phase }: { tier: SpeedLevel; phase: SpeedPhase }) {
  return <svg className={styles.trace} data-speed-trace={tier} data-phase={phase} aria-hidden="true">
    <rect className={styles.outbound} pathLength="100" x="1" y="1" />
    {tier === 'ultrafast' && <rect className={styles.returnTrace} pathLength="100" x="1" y="1" />}
  </svg>
}
