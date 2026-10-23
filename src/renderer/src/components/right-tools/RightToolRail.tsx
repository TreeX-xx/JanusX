import { useRef } from 'react'
import { useAssistantPendingCount } from '@/components/knowledge/useAssistantPendingCount'
// Note: rail-only is the normal empty state with no panel toggle — see .agents/notes/workbench/right-rail-toggle-motion.md
import { Puzzle } from 'lucide-react'
import { getRightToolDefinitions, isRightToolEnabled, rightToolLabel } from '@/right-tools/registry'
import type { RightToolDefinition, RightToolId } from '@/right-tools/types'
import { useExtensionViews } from '@/extensions/react'
import { extensionRegistry } from '@/extensions/registry'
import { useWorkspaceStore } from '@/stores/workspace'
import { useExperimentalStore } from '@/stores/experimental'
import { useI18n } from '@/i18n/useI18n'
import { ThemedTooltip } from '@/components/ui/ThemedTooltip'
import { SlidingSelection } from '@/components/shared/SlidingSelection'
import { usePendingToolActivation } from './usePendingToolActivation'
import styles from './RightDock.module.css'
import { AuxiliaryPanelButtons } from './AuxiliaryPanelButtons'

interface RightToolRailProps {
  openToolIds: readonly RightToolId[]
  activeToolId: RightToolId | null
  onToggleTool: (toolId: RightToolId) => void
  collapsed?: boolean
  forcedCollapsed?: boolean
  previewToolId?: RightToolId | null
  onPreview?: (toolId: RightToolId) => void
  onPreviewLeave?: () => void
}

export function RightToolRail({
  openToolIds,
  activeToolId,
  onToggleTool,
  collapsed = false,
  forcedCollapsed = false,
  previewToolId = null,
  onPreview,
  onPreviewLeave,
}: RightToolRailProps) {
  const { t } = useI18n('common')
  useExtensionViews()
  const workspaceId = useWorkspaceStore((state) => state.activeWorkspaceId)
  const personaEnabled = useExperimentalStore((s) => s.persona)
  const knowledgeEnabled = useExperimentalStore((s) => s.knowledge)
  const sessionsEnabled = useExperimentalStore((s) => s.sessions)
  const pending = useAssistantPendingCount()
  const visibleTools = getRightToolDefinitions().filter((tool) => isRightToolEnabled(tool.id, { persona: personaEnabled, knowledge: knowledgeEnabled, sessions: sessionsEnabled })
    && (extensionRegistry.getView(tool.id)?.scope !== 'project' || workspaceId))
  const toolsRef = useRef<HTMLDivElement>(null)
  const { pendingToolId, visualToolId, requestActivate } = usePendingToolActivation({
    activeToolId, validToolIds: visibleTools.map((tool) => tool.id), onActivate: onToggleTool,
    resetKey: `${collapsed}:${forcedCollapsed}:${workspaceId}:${openToolIds.join(',')}`, toggleCurrent: true,
  })
  return (
    <div className={styles.rail} role="toolbar" aria-busy={pendingToolId !== null} aria-label={t('common:rightTool.railAria')}>
      <div ref={toolsRef} className={styles.railTools}>
        <SlidingSelection containerRef={toolsRef} activeId={previewToolId ?? (!collapsed ? visualToolId : null)} itemAttribute="data-rail-tool"
          layoutKey={visibleTools.map((tool) => tool.id).join(',')} className={styles.railIndicator}
          testId="right-tool-rail-indicator" />
        {visibleTools.map((tool) => {
          const state = activeToolId === tool.id ? 'active' : openToolIds.includes(tool.id) ? 'open' : 'closed'
          const stateLabel = state === 'active'
            ? t('common:rightTool.railStateActive')
            : state === 'open'
              ? t('common:rightTool.railStateOpen')
              : t('common:rightTool.railStateClosed')
          return (
            <ThemedTooltip key={tool.id} label={rightToolLabel(tool, t)} placement="left" disabled={collapsed}>
            <button
              id={`right-tool-rail-${tool.id}`}
              type="button"
              className={styles.railButton}
              data-state={state}
              data-rail-tool={tool.id}
              data-visual-active={(previewToolId ?? (!collapsed ? visualToolId : null)) === tool.id}
              data-pending={pendingToolId === tool.id}
              data-onboarding={tool.id === 'files' ? 'files' : undefined}
              aria-label={t('common:rightTool.railButtonAria', { label: rightToolLabel(tool, t, 'ariaLabel'), state: stateLabel })}
              aria-pressed={!collapsed && state === 'active'}
              aria-controls={`right-tool-panel-${tool.id}`}
              aria-expanded={previewToolId === tool.id || (!collapsed && state === 'active')}
              onPointerEnter={(event) => { if (event.pointerType !== 'touch') onPreview?.(tool.id) }}
              onPointerLeave={onPreviewLeave}
              onFocus={() => onPreview?.(tool.id)}
              onClick={() => { onPreviewLeave?.(); requestActivate(tool.id) }}
            >
              <ToolIcon tool={tool} />
              {tool.id === 'assist' && pending !== null && pending > 0 && <span className={styles.railBadge}>{pending > 99 ? '99+' : pending}</span>}
            </button>
            </ThemedTooltip>
          )
        })}
      </div>
      <AuxiliaryPanelButtons />
    </div>
  )
}

function ToolIcon({ tool }: { tool: RightToolDefinition }) {
  const Icon = tool.iconComponent ?? Puzzle
  return <Icon className={styles.railIcon} size={16} strokeWidth={1.6} aria-hidden="true" />
}
