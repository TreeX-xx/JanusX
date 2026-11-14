import { useId, useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import styles from './SuperAgentWork.module.css'

export function WorkerDisclosure({ label, children }: { label: string; children: ReactNode }) {
  const [expanded, setExpanded] = useState(false), id = useId()
  return <>
    <button type="button" className={styles.recordToggle} aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded(value => !value)}>
      <span>{label}</span><ChevronDown size={12} aria-hidden="true" />
    </button>
    <div ref={node => { if (node) node.inert = !expanded }} id={id} className={styles.recordBody} data-expanded={expanded} aria-hidden={!expanded}>
      <div className={styles.recordClip}>{children}</div>
    </div>
  </>
}
