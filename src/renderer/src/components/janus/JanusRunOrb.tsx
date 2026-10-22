import { useWorkspaceStore } from '@/stores/workspace'
import { useRunningStore, type WorkspaceRunInfo } from '@/stores/running'
import { useI18n } from '@/i18n/useI18n'
import { JanusRunOrbPopover } from './JanusRunOrbPopover'
import { ThemedTooltip } from '@/components/ui/ThemedTooltip'

export function formatOrbUptime(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  if (hours > 0) return `${hours}h ${minutes % 60}m`
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`
  return `${seconds}s`
}

export function orbConfigLabel(info: WorkspaceRunInfo): string {
  const first = info.projects[0]
  if (first?.configName) return first.configName
  const prefix = info.workspacePath ? `${info.workspacePath}::` : ''
  if (first && prefix && first.id.startsWith(prefix)) return first.id.slice(prefix.length).split('::')[0]
  return first?.name ?? ''
}

interface JanusRunOrbProps {
  info: WorkspaceRunInfo
  open: boolean
  leaving?: boolean
  focusScopePath?: string | null
  onOpenChange: (workspaceId: string | null, focusScope?: string | null) => void
}

// Note: .agents/notes/workbench/run-orb-budding.md — indicator previews; stopping lives inside its panel.
export function JanusRunOrb({ info, open, leaving = false, focusScopePath = null, onOpenChange }: JanusRunOrbProps) {
  const { t } = useI18n('janus')
  const stopping = useRunningStore(s => info.workspaceId in s.stoppingByWorkspace)
  const pulse = useRunningStore(s => s.pulseByWorkspace[info.workspaceId] ?? 0)
  const isActive = useWorkspaceStore(s => s.activeWorkspaceId === info.workspaceId)
  const uptime = info.projects.reduce((max, project) => Math.max(max, project.uptime), 0)
  return <div className="janus-run-orb-anchor">
    <ThemedTooltip placement="bottom" label={t('janus:island.runOrb.tooltip', { name: info.workspaceName, config: orbConfigLabel(info), count: info.projects.length, uptime: formatOrbUptime(uptime) })}>
      <button type="button"
      className={`janus-run-orb${open ? ' is-open' : ''}${isActive ? ' is-active' : ''}`}
      data-workspace-id={info.workspaceId}
      data-state={stopping ? 'stopping' : 'running'}
      data-leaving={leaving ? 'true' : undefined}
      disabled={leaving}
      aria-expanded={open}
      aria-haspopup="dialog"
      aria-label={t('janus:island.runOrb.orbAria', { name: info.workspaceName, count: info.projects.length })}
      onClick={() => {
        if (leaving) return
        if (!open && !isActive) useWorkspaceStore.getState().setActiveWorkspace(info.workspaceId)
        onOpenChange(open ? null : info.workspaceId)
      }}>
      <span key={pulse} className={`janus-run-orb-dot${pulse > 0 ? ' janus-run-orb-nudge' : ''}`} aria-hidden="true" />
      </button>
    </ThemedTooltip>
    {open && <JanusRunOrbPopover info={info} stopping={stopping} focusScopePath={focusScopePath} onClose={() => onOpenChange(null)} />}
  </div>
}
