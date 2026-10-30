import { useId } from 'react'
import { CircleHelp } from 'lucide-react'
import { ThemedTooltip } from './ui/ThemedTooltip'
import styles from './WorkspaceStoragePanel.module.css'

/** Storage explanations stay available on hover, keyboard focus and to screen readers. */
export function StorageHelp({ label, paragraphs }: { label: string; paragraphs: string[] }) {
  const descriptionId = useId()
  return <>
    <ThemedTooltip placement="bottom" variant="panel" label={
      <div className={styles.helpContent}>{paragraphs.map(paragraph => <p key={paragraph}>{paragraph}</p>)}</div>
    }>
      <button type="button" className={styles.helpButton} aria-label={label} aria-describedby={descriptionId}>
        <CircleHelp size={14} strokeWidth={1.6} aria-hidden="true" />
      </button>
    </ThemedTooltip>
    <span id={descriptionId} className={styles.screenReaderOnly}>{paragraphs.join('\n\n')}</span>
  </>
}
