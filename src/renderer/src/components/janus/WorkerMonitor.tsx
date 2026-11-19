import type { ReactNode } from 'react'
import styles from './SuperAgentWork.module.css'

/** The two halves separate like a monitor shutter; no rotation or fake progress. */
export function WorkerMonitorGlyph({ expanded }: { expanded: boolean }) {
  return <svg className={styles.monitorGlyph} data-open={expanded} width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.25" aria-hidden="true">
    <path className={styles.monitorUpper} d="M4 8V5H16V8" />
    <path className={styles.monitorLower} d="M4 12V15H16V12" />
    <path className={styles.monitorSignal} d="M7 10H13" />
  </svg>
}

/** Keep mounted content and its local disclosures intact when the viewport shuts. */
export function WorkerMonitorBody({ id, expanded, children }: { id: string; expanded: boolean; children: ReactNode }) {
  return <div id={id} className={styles.monitorBody} data-worker-monitor="" data-open={expanded} aria-hidden={!expanded}
    ref={node => {
      if (!node) return
      if (!expanded && node.contains(document.activeElement)) {
        node.closest('article')?.querySelector<HTMLButtonElement>('[data-worker-header] button')?.focus({ preventScroll: true })
      }
      node.inert = !expanded
    }}>
    <div className={styles.monitorClip}><div className={styles.monitorContent}>{children}</div></div>
  </div>
}
