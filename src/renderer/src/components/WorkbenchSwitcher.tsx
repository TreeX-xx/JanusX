import { useEffect } from 'react'
import { useAppStore } from '@/stores/app'
import { useWorkspaceStore } from '@/stores/workspace'
import { useToolbarWorkbenches } from '@/extensions/react'
import { openExtensionView } from '@/extensions/workbench'
import { Puzzle } from 'lucide-react'
import { useExperimentalStore } from '@/stores/experimental'
import { WorkbenchIcon } from '@/components/ui/WorkbenchIcon'
import { ThemedTooltip } from '@/components/ui/ThemedTooltip'
import { useI18n } from '@/i18n/useI18n'
import styles from './WorkbenchSwitcher.module.css'

type WorkbenchId = 'knowledge'

const WORKBENCHES: Array<{ id: WorkbenchId; labelKey: string }> = [
  { id: 'knowledge', labelKey: 'common:workbench.knowledge' },
]

export function WorkbenchSwitcher() {
  const { t } = useI18n()
  const activeWorkbench = useAppStore((s) => s.activeWorkbench)
  const toggleWorkbench = useAppStore((s) => s.toggleWorkbench)
  const knowledgeEnabled = useExperimentalStore((s) => s.persona)
  const loadExperimental = useExperimentalStore((s) => s.load)
  const projectOpen = useWorkspaceStore(s => Boolean(s.activeWorkspaceId))
  const pluginWorkbenches = useToolbarWorkbenches(projectOpen)

  useEffect(() => {
    void loadExperimental()
  }, [loadExperimental])

  // 创新开关关闭知识库时，若工作台正开着则收起，避免悬空态。
  useEffect(() => {
    if (!knowledgeEnabled && useAppStore.getState().activeWorkbench === 'knowledge') {
      useAppStore.getState().setActiveWorkbench(null)
    }
  }, [knowledgeEnabled])

  const visibleWorkbenches = WORKBENCHES.filter((item) => {
    if (item.id === 'knowledge' && !knowledgeEnabled) return false
    return true
  })

  return (
    <div className={styles.switcher} data-open={activeWorkbench ?? 'none'} aria-label={t('common:workbench.switcherAria')}>
      {visibleWorkbenches.map((item) => {
        const isActive = activeWorkbench === item.id
        const status = isActive ? 'active' : 'idle'
        const title = t('common:workbench.titleAction', { action: t(isActive ? 'common:workbench.close' : 'common:workbench.open'), label: t(item.labelKey) })
        return (
          <ThemedTooltip key={item.id} label={title}>
          <button
            type="button"
            className={styles.button}
            data-id={item.id}
            data-status={status}
            aria-pressed={isActive}
            aria-label={title}
            onClick={() => toggleWorkbench(item.id)}
          >
            <WorkbenchIcon id={item.id} className={styles.icon} />
            <span className={styles.led} aria-hidden="true" />
          </button>
          </ThemedTooltip>
        )
      })}
      {pluginWorkbenches.map(view => {
        const Icon = view.icon ?? Puzzle
        return <ThemedTooltip key={view.id} label={`${view.extensionId} · ${view.title}`}>
          <button type="button" className={styles.button} data-id={view.id}
            data-status={activeWorkbench === view.id ? 'active' : 'idle'} aria-pressed={activeWorkbench === view.id}
            aria-label={`${view.extensionId} · ${view.title}`}
            onClick={() => activeWorkbench === view.id ? useAppStore.getState().closePluginWorkbench() : openExtensionView(view.id)}>
            <Icon className={styles.icon} /><span className={styles.led} aria-hidden="true" />
          </button>
        </ThemedTooltip>
      })}
    </div>
  )
}
