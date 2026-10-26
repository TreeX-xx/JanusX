// Note: .agents/notes/workbench/plugin-contract-v1.md — one isolated root; underlying panes remain in place.
import { useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useAppStore } from '@/stores/app'
import { useWorkspaceStore } from '@/stores/workspace'
import { useWorktreeStore } from '@/stores/worktree'
import { useI18n } from '@/i18n/useI18n'
import { useBrowserOcclusionStore } from '@/stores/browser-occlusion'
import { useExtensionViews } from './react'
import { ExtensionViewHost } from './ExtensionViewHost'
import { useIslandStore } from '@/stores/island'
import './plugin-workbench.css'

export function PluginWorkbenchHost() {
  const { t } = useI18n('plugins')
  const active = useAppStore(s => s.activeWorkbench)
  const covered = useBrowserOcclusionStore(s => s.count > 0)
  const islandExpanded = useIslandStore(s => s.stage !== 'collapsed')
  const views = useExtensionViews()
  const projectId = useWorkspaceStore(s => s.activeWorkspaceId)
  const workspaces = useWorkspaceStore(s => s.workspaces)
  const workspace = workspaces.find(w => w.id === projectId)
  const path = useWorktreeStore(s => projectId ? s.activePaths[projectId] ?? workspace?.path ?? null : null)
  const view = views.find(v => v.id === active && v.location === 'workbench')
  const scope = view?.scope === 'project' ? JSON.stringify([projectId, path]) : 'application'
  const entered = useRef<{ id: string; scope: string; projectId: string | null; opener: Element | null } | null>(null)
  const returnButton = useRef<HTMLButtonElement>(null)
  const viewId = view?.id
  useLayoutEffect(() => {
    if (!active?.startsWith('extension:')) { entered.current = null; return }
    const previous = entered.current
    if (!view || (view.scope === 'project' && !projectId) || (previous?.id === active && previous.scope !== scope
      && (view.frame !== 'plugin' || previous.projectId !== projectId))) {
      useAppStore.getState().closePluginWorkbench()
      return
    }
    entered.current = { id: active, scope, projectId, opener: previous?.id === active ? previous.opener : document.activeElement }
  }, [active, view, projectId, scope])
  useLayoutEffect(() => {
    if (!viewId) return
    const opener = entered.current?.opener
    returnButton.current?.focus({ preventScroll: true })
    return () => { if (opener instanceof HTMLElement && opener.isConnected) opener.focus({ preventScroll: true }) }
  }, [viewId])
  if (!view || !active?.startsWith('extension:')) return null
  return createPortal(<section data-plugin-workbench={view.id} data-frame={view.frame} style={{ visibility: covered || islandExpanded ? 'hidden' : undefined }} className="plugin-workbench fixed inset-0 z-[12000] flex flex-col" aria-label={view.title}>
    {view.frame !== 'plugin' && <header className="plugin-workbench-topbar">
      <button ref={returnButton} type="button" className="plugin-workbench-close" aria-label={t('plugins:returnToWorkspace')} title={t('plugins:returnToWorkspace')} onClick={() => useAppStore.getState().closePluginWorkbench()}><span aria-hidden="true">×</span></button>
      {view.scope === 'project' && <select aria-label={t('plugins:switchProject')} value={projectId ?? ''}
        onChange={event => useWorkspaceStore.getState().setActiveWorkspace(event.target.value)}>
        {workspaces.map(workspace => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}
      </select>}
      <span>{view.title}</span>
    </header>}
    <div className="flex-1 min-h-0"><ExtensionViewHost key={scope} viewId={view.id} location="workbench" active workspaceId={projectId} workspacePath={path} /></div>
  </section>, document.body)
}
