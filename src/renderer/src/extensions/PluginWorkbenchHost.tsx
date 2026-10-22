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

export function PluginWorkbenchHost() {
  const { t } = useI18n('plugins')
  const active = useAppStore(s => s.activeWorkbench)
  const covered = useBrowserOcclusionStore(s => s.count > 0)
  const views = useExtensionViews()
  const projectId = useWorkspaceStore(s => s.activeWorkspaceId)
  const workspaces = useWorkspaceStore(s => s.workspaces)
  const workspace = workspaces.find(w => w.id === projectId)
  const path = useWorktreeStore(s => projectId ? s.activePaths[projectId] ?? workspace?.path ?? null : null)
  const view = views.find(v => v.id === active && v.location === 'workbench')
  const scope = view?.scope === 'project' ? JSON.stringify([projectId, path]) : 'application'
  const entered = useRef<{ id: string; scope: string; opener: Element | null } | null>(null)
  const returnButton = useRef<HTMLButtonElement>(null)
  const viewId = view?.id
  useLayoutEffect(() => {
    if (!active?.startsWith('extension:')) { entered.current = null; return }
    const previous = entered.current
    if (!view || (view.scope === 'project' && !projectId) || (previous?.id === active && previous.scope !== scope)) {
      useAppStore.getState().closePluginWorkbench()
      return
    }
    if (previous?.id !== active) entered.current = { id: active, scope, opener: document.activeElement }
  }, [active, view, projectId, scope])
  useLayoutEffect(() => {
    if (!viewId) return
    const opener = entered.current?.opener
    returnButton.current?.focus({ preventScroll: true })
    return () => { if (opener instanceof HTMLElement && opener.isConnected) opener.focus({ preventScroll: true }) }
  }, [viewId])
  if (!view || !active?.startsWith('extension:')) return null
  return createPortal(<section data-plugin-workbench={view.id} style={{ visibility: covered ? 'hidden' : undefined }} className="plugin-workbench fixed inset-x-0 bottom-0 top-[42px] z-[1500] flex flex-col">
    <header className="flex items-center justify-between border-b px-4 py-2">
      <span>{view.extensionId} · {view.title}</span>
      {view.scope === 'project' && <select aria-label={t('plugins:switchProject')} value={projectId ?? ''}
        onChange={event => useWorkspaceStore.getState().setActiveWorkspace(event.target.value)}>
        {workspaces.map(workspace => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}
      </select>}
      <button ref={returnButton} type="button" onClick={() => useAppStore.getState().closePluginWorkbench()}>{t('plugins:returnToWorkspace')}</button>
    </header>
    <div className="flex-1 min-h-0"><ExtensionViewHost viewId={view.id} location="workbench" active workspaceId={projectId} workspacePath={path} /></div>
  </section>, document.body)
}
