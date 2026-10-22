import { useRef, useState } from 'react'
import { LoaderCircle, Play } from 'lucide-react'
import { useWorkspaceStore } from '@/stores/workspace'
import { sameScopePath, useWorktreeStore } from '@/stores/worktree'
import { groupByWorkspace, isScopeRunning, nudgeRunOrb, useRunningStore } from '@/stores/running'
import { projectService } from '@/services/project'
import { useI18n } from '@/i18n/useI18n'
import { resolveScopeBranch, startScope } from './janus/useProjectRunning'
import { ModalFrame } from './shared/ModalFrame'
import { ModalCloseButton } from './ModalCloseButton'
import { ThemedTooltip } from './ui/ThemedTooltip'
import { ProjectLauncher } from './ProjectLauncher'
import styles from './TitlebarRunButton.module.css'

// Note: .agents/notes/workbench/run-orb-budding.md — one launcher, per-workspace run indicators.
export function TitlebarRunButton() {
  const { t } = useI18n()
  const workspace = useWorkspaceStore(s => s.workspaces.find(w => w.id === s.activeWorkspaceId))
  const scopePath = useWorktreeStore(s => workspace ? s.activePaths[workspace.id] ?? workspace.path : '')
  const worktrees = useWorktreeStore(s => workspace ? s.worktreesByWorkspace[workspace.id] : undefined)
  const branch = worktrees?.find(entry => sameScopePath(entry.path, scopePath))?.branch
  const [busy, setBusy] = useState(false)
  const pending = useRef(false)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [configTarget, setConfigTarget] = useState<{ workspaceId: string; root: string; path: string } | null>(null)
  const label = workspace
    ? t('janus:island.runOrb.runTarget', { name: workspace.name, target: branch || scopePath })
    : t('janus:island.runOrb.selectWorkspace')

  const run = async () => {
    if (!workspace || pending.current) return
    // Snapshot the scope before the first await; switching worktrees never redirects an in-flight launch.
    const target = { workspaceId: workspace.id, workspacePath: workspace.path, scopePath, branch: resolveScopeBranch(workspace.id, scopePath) }
    setFeedback(null)
    if (isScopeRunning(target.workspaceId, target.scopePath)) {
      nudgeRunOrb(target.workspaceId)
      setFeedback(t('janus:island.runOrb.alreadyRunning'))
      return
    }
    pending.current = true
    setBusy(true)
    try {
      const config = await projectService.readConfig(target.scopePath)
        ?? (target.scopePath === target.workspacePath ? null : await projectService.readConfig(target.workspacePath))
      if (!config?.configurations.length) {
        setConfigTarget({ workspaceId: target.workspaceId, root: target.workspacePath, path: target.scopePath })
        return
      }
      if (!await startScope(target)) throw new Error(t('janus:island.runOrb.startFailed'))
      const all = await projectService.list()
      useRunningStore.getState().setFromGrouped(groupByWorkspace(all, useWorkspaceStore.getState().workspaces))
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : String(error))
    } finally {
      pending.current = false
      setBusy(false)
    }
  }

  return <>
    <div className={styles.anchor}>
      <ThemedTooltip label={busy ? t('janus:island.runOrb.starting') : label} placement="bottom">
        <button type="button" className={styles.trigger} data-id="run-project" aria-label={label}
          aria-busy={busy} disabled={!workspace || busy} onClick={() => void run()}>
          {busy ? <LoaderCircle size={15} className={styles.spinner} aria-hidden="true" /> : <Play size={15} strokeWidth={1.6} aria-hidden="true" />}
        </button>
      </ThemedTooltip>
      {feedback && <div className={styles.feedback} role="status">
        <span>{feedback}</span>
        <button type="button" aria-label={t('janus:island.runOrb.panelClose')} onClick={() => setFeedback(null)}>×</button>
      </div>}
    </div>
    {configTarget && <ModalFrame label={t('common:workspace.launcherTitle')} onClose={() => setConfigTarget(null)} panelClassName="ws-config-modal">
      {({ requestClose }) => <>
        <div className="ws-config-head">
          <ModalCloseButton onClose={requestClose} />
          <span>{t('common:workspace.launcherTitle')}</span>
        </div>
        <div style={{ flex: 1, minHeight: 0 }}>
          <ProjectLauncher projectPath={configTarget.path} workspaceId={configTarget.workspaceId} workspaceRoot={configTarget.root} />
        </div>
      </>}
    </ModalFrame>}
  </>
}
