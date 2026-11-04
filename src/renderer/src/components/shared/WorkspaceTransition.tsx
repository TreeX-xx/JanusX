import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useI18n } from '@/i18n/useI18n'
import styles from './WorkspaceTransition.module.css'

type Phase = 'idle' | 'covering' | 'waiting' | 'revealing'

interface WorkspaceTransitionProps {
  scopeKey: string | null
  pending: boolean
  active: boolean
  name?: string
  children: ReactNode
}

// Note: .agents/notes/workbench/file-tree-reveal-race.md — data readiness and
// presentation have separate lifetimes; background refreshes never replay motion.
export function WorkspaceTransition({ scopeKey, pending, active, name, children }: WorkspaceTransitionProps) {
  const { t } = useI18n('common')
  const [transition, setTransition] = useState<{ key: string | null; phase: Phase }>({ key: scopeKey, phase: active && pending ? 'covering' : 'idle' })
  const previousContent = useRef(children)
  const previouslyActive = useRef(active)
  const [showStatus, setShowStatus] = useState(false)
  const enabled = active && scopeKey !== null
  const changed = transition.key !== scopeKey
  const entering = !previouslyActive.current && active && pending
  const phase: Phase = !enabled ? 'idle'
    : changed || entering ? 'covering' : transition.phase
  const busy = phase !== 'idle'
  const holding = phase === 'covering' || phase === 'waiting'

  useLayoutEffect(() => {
    if (!enabled) {
      setTransition(current => current.key === scopeKey && current.phase === 'idle'
        ? current : { key: scopeKey, phase: 'idle' })
    } else if (changed || entering) {
      setTransition({ key: scopeKey, phase: 'covering' })
    }
    previouslyActive.current = active
  }, [enabled, changed, entering, scopeKey, active])

  useLayoutEffect(() => {
    if (!holding) previousContent.current = children
  }, [children, holding])

  useEffect(() => {
    if (!enabled) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (phase === 'covering') {
      const timer = window.setTimeout(() => setTransition({ key: scopeKey, phase: 'waiting' }), reduced ? 0 : 120)
      return () => window.clearTimeout(timer)
    }
    if (phase === 'revealing') {
      // Timer cleanup also covers hidden panels, interrupted transitions and
      // rapid A → B → A switches; animationend is never a readiness signal.
      const timer = window.setTimeout(() => setTransition({ key: scopeKey, phase: 'idle' }), reduced ? 0 : 220)
      return () => window.clearTimeout(timer)
    }
  }, [enabled, scopeKey, phase])

  useEffect(() => {
    if (enabled && phase === 'waiting' && !pending) setTransition({ key: scopeKey, phase: 'revealing' })
  }, [enabled, scopeKey, phase, pending])

  useEffect(() => {
    setShowStatus(false)
    if (!busy) return
    const timer = window.setTimeout(() => setShowStatus(true), 600)
    return () => window.clearTimeout(timer)
  }, [busy, scopeKey])

  return (
    <div className={styles.surface} data-workspace-transition={phase} aria-busy={busy}>
      <div className={styles.content} {...(busy ? { inert: '' } : {})}>
        {holding ? previousContent.current : children}
      </div>
      <div className={styles.glass} aria-hidden="true" />
      {showStatus && holding && (
        <div className={styles.status} role="status">
          {name ? t('common:workspace.switching', { name }) : t('common:status.loading')}
        </div>
      )}
    </div>
  )
}
