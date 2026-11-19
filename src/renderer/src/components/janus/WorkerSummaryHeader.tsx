import { Workflow } from 'lucide-react'
import type { ReactNode } from 'react'
import { TerminalPresetIcon } from '../ui/TerminalPresetIcon'
import { WorkerMonitorGlyph } from './WorkerMonitor'
import styles from './SuperAgentWork.module.css'

/** One visual grammar for an independent Worker, a workflow child and its parent. */
export function WorkerSummaryHeader({ title, subtitle, status, running = false, engine, expanded, controlsId, toggle, actions }: {
  title: string; subtitle: string; status: string; running?: boolean; engine?: 'codex' | 'claude'; expanded: boolean; controlsId: string; toggle(): void; actions?: ReactNode
}) {
  return <div className={styles.summaryHeader} data-worker-header="" data-open={expanded}>
    <span className={styles.engineIcon}>{engine ? <TerminalPresetIcon preset={engine} style={{ width: 18, height: 18 }} /> : <Workflow size={18} />}</span>
    <button type="button" className={styles.summaryToggle} aria-expanded={expanded} aria-controls={controlsId} onClick={toggle} title={title}>
      <strong title={title}>{title}</strong><span className={styles.summaryMeta}><span>{subtitle}</span><span className={styles.workerStatus} data-worker-status="" data-running={running} role="status">{status}</span></span>
    </button>
    {actions}<button type="button" className={`${styles.iconAction} ${styles.monitorSwitch}`} aria-label={title} aria-expanded={expanded} aria-controls={controlsId} onClick={toggle}><WorkerMonitorGlyph expanded={expanded} /></button>
  </div>
}
