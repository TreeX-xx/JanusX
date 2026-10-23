import { FileCode2 } from 'lucide-react'
import { useEditorStore } from '@/stores/editor'
import { useGlobalToolsStore } from '@/stores/global-tools'
import { useAuxiliaryPanelsStore } from '@/stores/auxiliary-panels'
import { useI18n } from '@/i18n/useI18n'
import { ToolboxIcon } from '../ui/ToolboxIcon'
import { ThemedTooltip } from '../ui/ThemedTooltip'
import styles from './RightDock.module.css'

export function AuxiliaryPanelButtons() {
  const { t } = useI18n()
  const hasTools = useGlobalToolsStore(s => s.paneTree !== null)
  const toolsCollapsed = useGlobalToolsStore(s => s.collapsed)
  const hasFiles = useEditorStore(s => s.isEmbedded && s.openFiles.length > 0)
  const editorVisible = useEditorStore(s => s.isVisible)
  const { toolsCompact, editorCompact } = useAuxiliaryPanelsStore()
  if (!hasTools && !hasFiles) return null
  const toolsOpen = !toolsCollapsed && !toolsCompact
  const editorOpen = editorVisible && !editorCompact
  return <div className={styles.auxiliaryTools} role="group" aria-label={t('common:toolGroup.auxiliaryPanels')}>
    {hasTools && <ThemedTooltip placement="left" label={t(toolsOpen ? 'common:toolGroup.collapseTools' : 'common:toolGroup.expandTools')}>
      <button type="button" className={styles.railButton} data-tools-toggle="" data-visual-active={toolsOpen}
        aria-label={t(toolsOpen ? 'common:toolGroup.collapseTools' : 'common:toolGroup.expandTools')} aria-expanded={toolsOpen}
        onClick={() => useGlobalToolsStore.getState().setCollapsed(toolsOpen)}>
        <ToolboxIcon size={16} aria-hidden="true" />
      </button>
    </ThemedTooltip>}
    {hasFiles && <ThemedTooltip placement="left" label={t(editorOpen ? 'editor:fileEditor.collapsePanel' : 'editor:fileEditor.expandPanel')}>
      <button type="button" className={styles.railButton} data-editor-toggle="" data-visual-active={editorOpen}
        aria-label={t(editorOpen ? 'editor:fileEditor.collapsePanel' : 'editor:fileEditor.expandPanel')} aria-expanded={editorOpen}
        onClick={() => editorOpen ? useEditorStore.getState().hidePanel() : useEditorStore.getState().showPanel()}>
        <FileCode2 size={16} strokeWidth={1.6} aria-hidden="true" />
      </button>
    </ThemedTooltip>}
  </div>
}
