import { useEffect } from 'react'
import { useAppStore } from '@/stores/app'
import { useWorkspaceStore } from '@/stores/workspace'
import { useExtensionViews } from '@/extensions/react'
import { openExtensionView } from '@/extensions/workbench'
import { Puzzle } from 'lucide-react'
import { useBlueprintStore } from '@/stores/blueprint'
import { useExperimentalStore } from '@/stores/experimental'
import { WorkbenchIcon } from '@/components/ui/WorkbenchIcon'
import { ThemedTooltip } from '@/components/ui/ThemedTooltip'
import { useI18n } from '@/i18n/useI18n'
import styles from './WorkbenchSwitcher.module.css'

type WorkbenchId = 'blueprint' | 'knowledge'

const WORKBENCHES: Array<{ id: WorkbenchId; labelKey: string }> = [
  { id: 'blueprint', labelKey: 'common:workbench.blueprint' },
  { id: 'knowledge', labelKey: 'common:workbench.knowledge' },
]

export function WorkbenchSwitcher() {
  const { t } = useI18n()
  const activeWorkbench = useAppStore((s) => s.activeWorkbench)
  const toggleWorkbench = useAppStore((s) => s.toggleWorkbench)
  const currentBlueprint = useBlueprintStore((s) => s.currentBlueprint)
  const activeSession = useBlueprintStore((s) => s.activeSession)
  const knowledgeEnabled = useExperimentalStore((s) => s.persona)
  const blueprintEnabled = useExperimentalStore((s) => s.blueprint)
  const loadExperimental = useExperimentalStore((s) => s.load)
  const projectOpen = useWorkspaceStore(s => Boolean(s.activeWorkspaceId))
  const pluginWorkbenches = useExtensionViews().filter(view => view.location === 'workbench' && (view.scope === 'application' || projectOpen))

  useEffect(() => {
    void loadExperimental()
  }, [loadExperimental])

  // 创新开关关闭知识库时，若工作台正开着则收起，避免悬空态。
  useEffect(() => {
    if (!knowledgeEnabled && useAppStore.getState().activeWorkbench === 'knowledge') {
      useAppStore.getState().setActiveWorkbench(null)
    }
  }, [knowledgeEnabled])

  // 创新开关关闭蓝图时，若工作台正开着则收起，避免悬空态。
  useEffect(() => {
    if (!blueprintEnabled && useAppStore.getState().activeWorkbench === 'blueprint') {
      useAppStore.getState().setActiveWorkbench(null)
    }
  }, [blueprintEnabled])

  const pendingCandidateCount =
    currentBlueprint?.requirementCandidates?.filter((candidate) => candidate.status === 'pending').length ?? 0
  const hasBlueprintAttention = pendingCandidateCount > 0 || !!activeSession

  const getButtonStatus = (itemId: WorkbenchId, isActive: boolean) => {
    if (itemId === 'blueprint' && hasBlueprintAttention) return 'attention'
    return isActive ? 'active' : 'idle'
  }

  const getButtonTitle = (itemId: WorkbenchId, labelKey: string, isActive: boolean) => {
    const action = isActive ? t('common:workbench.close') : t('common:workbench.open')
    const label = t(labelKey)
    if (itemId !== 'blueprint') return t('common:workbench.titleAction', { action, label })
    if (pendingCandidateCount > 0) return t('common:workbench.titleWithPending', { action, label, count: pendingCandidateCount })
    if (activeSession) return t('common:workbench.titleWithFocus', { action, label })
    return t('common:workbench.titleAction', { action, label })
  }

  const visibleWorkbenches = WORKBENCHES.filter((item) => {
    if (item.id === 'knowledge' && !knowledgeEnabled) return false
    if (item.id === 'blueprint' && !blueprintEnabled) return false
    return true
  })

  return (
    <div className={styles.switcher} data-open={activeWorkbench ?? 'none'} aria-label={t('common:workbench.switcherAria')}>
      {visibleWorkbenches.map((item) => {
        const isActive = activeWorkbench === item.id
        const status = getButtonStatus(item.id, isActive)
        const badge = item.id === 'blueprint' ? pendingCandidateCount : 0
        const title = getButtonTitle(item.id, item.labelKey, isActive)
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
            {badge > 0 ? <span className={styles.badge}>{badge > 9 ? '9+' : badge}</span> : null}
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
