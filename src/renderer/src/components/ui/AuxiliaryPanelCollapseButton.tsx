import { PanelRightClose } from 'lucide-react'
import { ThemedTooltip } from './ThemedTooltip'
import styles from './AuxiliaryPanelCollapseButton.module.css'

// Note: .agents/notes/workbench/requirements/auxiliary-panels-preview-controls.md
export function AuxiliaryPanelCollapseButton({ label, onCollapse }: {
  label: string
  onCollapse: () => void
}) {
  return <ThemedTooltip label={label}>
    <button type="button" className={styles.button} data-auxiliary-collapse=""
      aria-label={label} aria-expanded={true} onClick={onCollapse}>
      <PanelRightClose size={16} strokeWidth={1.6} aria-hidden="true" />
    </button>
  </ThemedTooltip>
}
