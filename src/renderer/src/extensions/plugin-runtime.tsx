// Note: .agents/notes/workbench/plugin-contract-v1.md — trusted shells only; plugin code stays in isolated native pages.
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { PluginHostEvent, PluginHostSnapshot, PluginManageRequest, PluginMount } from '../../../shared/ipc/plugins'
import type { ExtensionViewProps } from './types'
import { extensionRegistry } from './registry'
import { manifestContribution } from './manifest'
import { openExtensionView } from './workbench'
import { useWorkspaceStore } from '@/stores/workspace'
import { sameScopePath, useWorktreeStore } from '@/stores/worktree'
import { useGlobalToolsStore } from '@/stores/global-tools'
import { useRightToolStore } from '@/stores/right-tools'
import { getLeafPanes } from '@/lib/workspace-pane'
import { useThemeStore } from '@/stores/theme'
import i18n from '@/i18n'
import { useI18n } from '@/i18n/useI18n'
import { useBrowserOcclusionStore } from '@/stores/browser-occlusion'
import { syncPluginThemes } from '../../../shared/theme/plugin-themes'
import { useAppStore } from '@/stores/app'
import { useIslandStore } from '@/stores/island'
import type { PluginDocument, PluginDraft } from '@janusx/plugin-sdk'
import { openPluginConfiguration, reviewPluginAuthorization } from './plugin-configuration-navigation'
import type { PluginConfigurationTarget } from './plugin-configuration-navigation'

let snapshot: PluginHostSnapshot = { developmentMode: false, plugins: [], logs: [] }
const listeners = new Set<() => void>()
const mounted = new Map<string, { digest: string; unregister: () => void }>()
let refreshSequence = 0
let started = false
export async function pluginRequest<T = unknown>(input: PluginManageRequest): Promise<T> {
  if (!window.electron.plugins) throw new Error('DESKTOP_REQUIRED')
  const result = await window.electron.plugins.request(input)
  if (!result.ok) throw new Error(result.code)
  return result.data as T
}
export function usePluginSnapshot(): PluginHostSnapshot {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => listeners.delete(listener) }, () => snapshot, () => snapshot)
}
export async function refreshPlugins(): Promise<void> {
  const sequence = ++refreshSequence
  const next = await pluginRequest<PluginHostSnapshot>({ type: 'list' })
  if (sequence !== refreshSequence) return
  snapshot = next
  const sourceAllowed = (record: PluginHostSnapshot['plugins'][number]) => record.source.kind === 'official' || next.developmentMode
  syncPluginThemes(next.plugins.filter(record => record.enabled && sourceAllowed(record)
    && (['ready', 'loading', 'active'].includes(record.state) || record.state === 'error' && record.error === 'VIEW_LOAD_FAILED')).map(record => record.manifest))
  useThemeStore.getState().applyExternal(useThemeStore.getState().theme)
  for (const [id, entry] of mounted) {
    const record = next.plugins.find(record => record.manifest.id === id)
    if (!record || !record.enabled || !sourceAllowed(record) || !['ready', 'loading', 'active', 'error'].includes(record.state)
      || (record.state === 'error' && record.error !== 'VIEW_LOAD_FAILED') || record.digest !== entry.digest) {
      entry.unregister(); mounted.delete(id)
    }
  }
  for (const record of next.plugins) if (record.enabled && sourceAllowed(record) && ['ready', 'loading', 'active', 'error'].includes(record.state)
    && (record.state !== 'error' || record.error === 'VIEW_LOAD_FAILED') && !mounted.has(record.manifest.id)) {
    const id = record.manifest.id
    const definition = manifestContribution(record.manifest, view => props => <PluginViewShell {...props} pluginId={id} localViewId={view.id} />)
    mounted.set(id, { digest: record.digest, unregister: extensionRegistry.register(definition) })
  }
  for (const listener of listeners) listener()
  void syncPluginContext().catch(console.error)
}
function publicTheme() {
  const tokens: Record<string, string> = {}
  const style = getComputedStyle(document.documentElement)
  for (const token of ['shell-canvas', 'shell-text', 'shell-muted', 'shell-card', 'shell-border', 'shell-accent',
    'shell-border-soft', 'shell-chrome', 'shell-chrome-raised', 'shell-dim', 'shell-hover', 'shell-accent-border',
    'shell-accent-soft', 'shell-diff-del', 'shell-diff-add', 'shell-pane', 'control-border', 'control-h',
    'popover-background', 'popover-shadow', 'popover-hover', 'so-field', 'so-radius', 'so-control-h']) {
    const value = style.getPropertyValue(`--${token}`).trim()
    if (value) tokens[`--${token}`] = value
  }
  return { id: document.documentElement.dataset.pluginTheme || document.documentElement.dataset.theme || '', tokens }
}
export function syncPluginContext(): Promise<void> {
  const state = useWorkspaceStore.getState()
  const id = state.activeWorkspaceId
  const workspace = state.workspaces.find(workspace => workspace.id === id)
  const scopePath = id ? useWorktreeStore.getState().activePaths[id] ?? workspace?.path ?? null : null
  return pluginRequest({ type: 'context', projectId: id, scopePath, locale: i18n.language ?? 'en', theme: publicTheme() })
}
function openViews(): Array<{ id: string; instanceKey?: string }> {
  const trees = [useWorkspaceStore.getState().paneTree, useGlobalToolsStore.getState().paneTree]
  return [...trees.flatMap(tree => getLeafPanes(tree).flatMap(leaf => leaf.tabs.flatMap(tab => tab.type === 'extension' ? [{ id: tab.viewId, instanceKey: tab.instanceKey }] : []))),
    ...[...new Set([
    ...useRightToolStore.getState().openToolIds.filter(id => id.startsWith('extension:')),
    ...[useAppStore.getState().activeWorkbench].filter((id): id is `extension:${string}/${string}` => Boolean(id?.startsWith('extension:'))),
    ...(useIslandStore.getState().stage === 'expanded' && useIslandStore.getState().activePluginViewId ? [useIslandStore.getState().activePluginViewId!] : [])])].map(id => ({ id }))]
}
export function initializePluginRuntime(): void {
  if (started || !window.electron.plugins) return
  started = true
  const coverWindows = () => {
    void pluginRequest({ type: 'windowCover', covered: useBrowserOcclusionStore.getState().count > 0 }).catch(console.error)
    void syncPluginContext().catch(console.error)
  }
  useBrowserOcclusionStore.subscribe(coverWindows); coverWindows()
  window.addEventListener('janusx:plugin-window-open', event => {
    const id = (event as CustomEvent<string>).detail
    const view = extensionRegistry.getView(id)
    if (!view || view.location !== 'window') return
    const state = useWorkspaceStore.getState()
    const projectId = view.scope === 'project' ? state.activeWorkspaceId : null
    const path = projectId ? useWorktreeStore.getState().activePaths[projectId] ?? state.workspaces.find(item => item.id === projectId)?.path ?? null : null
    void syncPluginContext().then(() => pluginRequest({ type: 'windowOpen', id: view.extensionId, view: id.slice(id.lastIndexOf('/') + 1), projectId, scopePath: path }))
      .catch(cause => window.dispatchEvent(new CustomEvent('janusx:plugin-toast', { detail: { source: view.extensionId, message: cause.message } })))
  })
  window.electron.plugins.onChanged(() => {
    const opened = openViews().map(entry => ({ ...entry, digest: mounted.get(extensionRegistry.getView(entry.id)?.extensionId ?? '')?.digest }))
    void refreshPlugins().then(() => {
      for (const entry of opened) {
        const view = extensionRegistry.getView(entry.id)
        if (view && entry.digest !== mounted.get(view.extensionId)?.digest) openExtensionView(entry.id as `extension:${string}/${string}`, entry.instanceKey)
      }
    }).catch(console.error)
  })
  window.electron.plugins.onEvent(({ packet }: PluginHostEvent) => {
    if (!packet || typeof packet !== 'object' || Array.isArray(packet)) return
    if (packet.type === 'workbenchAction' && typeof packet.pluginId === 'string' && typeof packet.viewId === 'string') {
      const id = `extension:${packet.pluginId}/${packet.viewId}`
      const workspace = useWorkspaceStore.getState().workspaces.find(workspace => workspace.id === packet.currentProjectId)
      const activePath = workspace ? useWorktreeStore.getState().activePaths[workspace.id] ?? workspace.path : null
      if (useAppStore.getState().activeWorkbench !== id || packet.currentProjectId !== null
        && (useWorkspaceStore.getState().activeWorkspaceId !== packet.currentProjectId || typeof packet.root !== 'string' || !activePath || !sameScopePath(activePath, packet.root))) return
      if (packet.action === 'close') useAppStore.getState().closePluginWorkbench()
      if (packet.action === 'selectProject' && typeof packet.projectId === 'string'
        && useWorkspaceStore.getState().workspaces.some(workspace => workspace.id === packet.projectId)) useWorkspaceStore.getState().setActiveWorkspace(packet.projectId)
      if (packet.action === 'selectWorktree' && workspace && typeof packet.scopePath === 'string') {
        useWorktreeStore.getState().setActivePath(workspace.id, packet.scopePath)
      }
    }
    if (packet.type === 'openView' && typeof packet.pluginId === 'string' && typeof packet.viewId === 'string') openExtensionView(`extension:${packet.pluginId}/${packet.viewId}`, typeof packet.instanceKey === 'string' ? packet.instanceKey : undefined)
    if (packet.type === 'openConfiguration' && typeof packet.pluginId === 'string'
      && (packet.scope === 'application' || packet.scope === 'project')) openPluginConfiguration({ pluginId: packet.pluginId, scope: packet.scope })
    if (packet.type === 'configurationProposal' && typeof packet.pluginId === 'string' && packet.proposal && typeof packet.proposal === 'object'
      && (packet.scope === 'application' || packet.scope === 'project')) openPluginConfiguration({ pluginId: packet.pluginId, scope: packet.scope,
        proposal: packet.proposal as unknown as PluginConfigurationTarget['proposal'] })
    if (packet.type === 'toast' && typeof packet.pluginId === 'string' && typeof packet.message === 'string') {
      // A host-rendered text notification always retains the plugin's identity.
      window.dispatchEvent(new CustomEvent('janusx:plugin-toast', { detail: { source: packet.pluginId, message: packet.message } }))
    }
  })
  let contextKey = ''
  const sync = () => {
    const state = useWorkspaceStore.getState()
    const key = JSON.stringify([state.activeWorkspaceId, state.workspaces.find(workspace => workspace.id === state.activeWorkspaceId)?.path,
      useWorktreeStore.getState().activePaths, publicTheme(), i18n.language])
    if (key === contextKey) return
    contextKey = key
    void syncPluginContext().catch(console.error)
  }
  useWorkspaceStore.subscribe(sync); useWorktreeStore.subscribe(sync); useThemeStore.subscribe(() => requestAnimationFrame(sync)); i18n.on('languageChanged', sync)
  sync()
  void refreshPlugins().catch(console.error)
}

export function PluginViewShell({ pluginId, localViewId, workspaceId, workspacePath, active, location, instanceKey, document: boundDocument, onFailure, onDocumentEdit, onDocumentDraft }: ExtensionViewProps & {
  pluginId: string; localViewId: string; document?: PluginDocument; onFailure?: (code: string) => void
  onDocumentEdit?: (baseText: string, text: string, version: string) => boolean
  onDocumentDraft?: (baseText: string, version: string, update?: { text: string; expectedRevision: number }) => PluginDraft | null
}) {
  const { t } = useI18n('plugins')
  const pluginSnapshot = usePluginSnapshot()
  const record = pluginSnapshot.plugins.find(record => record.manifest.id === pluginId)
  const projectGranted = Boolean(workspaceId && record?.projects.includes(workspaceId))
  const body = useRef<HTMLDivElement>(null)
  // The settings dialog owns one cover lease; additional dialogs still cover its native page.
  const covered = useBrowserOcclusionStore(state => state.count > (location === 'settings' ? 1 : 0))
  const dragging = useWorkspaceStore(state => state.tabDragInFlight)
  const workbench = useAppStore(state => state.activeWorkbench)
  const islandStage = useIslandStore(state => state.stage)
  const activeScope = useWorktreeStore(state => workspaceId ? state.activePaths[workspaceId] ?? workspacePath : null)
  const selectedProject = useWorkspaceStore(state => workspaceId ? state.activeWorkspaceId : null)
  const [mount, setMount] = useState<PluginMount | null>(null)
  const [failure, setFailure] = useState('')
  const [retry, setRetry] = useState(0)
  const needsProjectGrant = Boolean(workspaceId && !projectGranted && (failure === 'PATH_NOT_GRANTED' || failure === 'CONTEXT_UNAVAILABLE'))
  const documentViewer = boundDocument?.viewer
  const documentPath = boundDocument?.path
  const visible = active && !covered && !dragging && !failure
    && (location === 'settings' ? true : location === 'workbench' ? workbench === `extension:${pluginId}/${localViewId}` && islandStage === 'collapsed'
      : location === 'island' ? (!workbench || workbench.startsWith('extension:')) && islandStage === 'expanded' : !workbench && islandStage === 'collapsed')
  useEffect(() => {
    let cancelled = false
    let current: PluginMount | undefined
    setMount(null); setFailure('')
    if (workspaceId && selectedProject !== workspaceId) return
    void syncPluginContext().then(() => cancelled ? undefined : pluginRequest<PluginMount>({ type: 'mount', id: pluginId, view: localViewId, projectId: workspaceId, scopePath: activeScope,
      ...(instanceKey ? { instanceKey } : {}),
      ...(documentViewer && documentPath ? { document: { viewer: documentViewer, path: documentPath } } : {}) }))
      .then(result => {
        if (!result) return
        current = result
        if (cancelled) void pluginRequest({ type: 'close', instanceId: result.instanceId, binding: result.binding })
        else setMount(result)
      }).catch(cause => { if (!cancelled) setFailure(String(cause.message)) })
    return () => {
      cancelled = true
      if (current) void pluginRequest({ type: 'close', instanceId: current.instanceId, binding: current.binding }).catch(() => {})
    }
  }, [pluginId, localViewId, workspaceId, selectedProject, activeScope, retry, documentViewer, documentPath, instanceKey, projectGranted])
  useEffect(() => { if (failure) onFailure?.(failure) }, [failure, onFailure])
  useEffect(() => {
    if (!mount) return
    void pluginRequest({ type: 'active', instanceId: mount.instanceId, binding: mount.binding, active: Boolean(visible) }).catch(() => {})
  }, [visible, mount])
  useEffect(() => {
    if (!mount || !window.electron.plugins) return
    return window.electron.plugins.onEvent(event => {
      if (event.instanceId !== mount.instanceId) return
      const packet = event.packet
      if (packet && typeof packet === 'object' && !Array.isArray(packet) && packet.type === 'documentDraft'
        && packet.path === documentPath && typeof packet.editId === 'string' && typeof packet.baseText === 'string' && typeof packet.version === 'string') {
        const update = typeof packet.text === 'string' && typeof packet.expectedRevision === 'number' ? { text: packet.text, expectedRevision: packet.expectedRevision } : undefined
        const draft = onDocumentDraft?.(packet.baseText, packet.version, update) ?? null
        void pluginRequest({ type: 'documentDraftResult', instanceId: mount.instanceId, binding: mount.binding, editId: packet.editId, draft }).catch(() => {})
      }
      if (packet && typeof packet === 'object' && !Array.isArray(packet) && packet.type === 'documentEdit'
        && packet.path === documentPath && typeof packet.editId === 'string' && typeof packet.baseText === 'string'
        && typeof packet.text === 'string' && typeof packet.version === 'string') {
        const applied = Boolean(onDocumentEdit?.(packet.baseText, packet.text, packet.version))
        void pluginRequest({ type: 'documentEditResult', instanceId: mount.instanceId, binding: mount.binding, editId: packet.editId, applied }).catch(() => {})
      }
      if (packet && typeof packet === 'object' && !Array.isArray(packet) && packet.event === 'invalidated') {
        if (packet.reason === 'reload') setRetry(value => value + 1)
        else setFailure('INSTANCE_CLOSED')
      }
    })
  }, [mount, documentPath, onDocumentEdit, onDocumentDraft])
  useLayoutEffect(() => {
    if (!mount || !body.current) return
    const element = body.current
    let animation = 0
    const hide = () => pluginRequest({ type: 'bounds', instanceId: mount.instanceId, binding: mount.binding, bounds: { x: 0, y: 0, width: 0, height: 0 } }).catch(() => {})
    const update = () => {
      cancelAnimationFrame(animation)
      animation = requestAnimationFrame(() => {
        const rect = element.getBoundingClientRect()
        const bounds = visible ? { x: rect.left, y: rect.top, width: rect.width, height: rect.height } : { x: 0, y: 0, width: 0, height: 0 }
        void pluginRequest({ type: 'bounds', instanceId: mount.instanceId, binding: mount.binding, bounds }).catch(() => {})
      })
    }
    if (!visible) void hide()
    const observer = new ResizeObserver(update); observer.observe(element)
    window.addEventListener('resize', update); window.addEventListener('scroll', update, true); document.addEventListener('transitionend', update); document.addEventListener('animationend', update)
    update()
    return () => {
      observer.disconnect(); cancelAnimationFrame(animation)
      window.removeEventListener('resize', update); window.removeEventListener('scroll', update, true); document.removeEventListener('transitionend', update); document.removeEventListener('animationend', update)
      void hide()
    }
  }, [mount, visible])
  return <div className="h-full min-h-0 w-full flex flex-col" data-plugin-view={`${pluginId}/${localViewId}`}>
    {snapshot.plugins.some(record => record.manifest.id === pluginId && record.manifest.contributes.settings?.length) && <button type="button" className="self-end text-xs px-2 py-1"
      onClick={() => openPluginConfiguration({ pluginId, scope: mount?.context.project ? 'project' : 'application' })}>{t('plugins:configuration')}</button>}
    {mount && snapshot.developmentMode && !failure && <button type="button" className="self-end text-xs px-2 py-1" aria-label={t('plugins:devtools')}
      onClick={() => { void pluginRequest({ type: 'devtools', instanceId: mount.instanceId, binding: mount.binding }).catch(cause => setFailure(cause.message)) }}>{t('plugins:devtools')}</button>}
    {failure ? <div role="alert" className="m-3 rounded-lg border border-[var(--shell-border)] bg-[var(--shell-card)] p-4 text-sm text-[var(--shell-text)]">
      <p className="mb-2">{needsProjectGrant ? t('plugins:projectGrantRequired') : failure}</p>
      {needsProjectGrant && workspaceId && <button type="button" className="px-2 py-1"
        onClick={() => reviewPluginAuthorization({ pluginId, projectId: workspaceId })}>{t('plugins:authorize')}</button>}
      <button type="button" className="px-2 py-1" aria-label={t('plugins:retry')} onClick={() => setRetry(value => value + 1)}>↻</button>
      {location === 'workbench' && <button type="button" className="px-2 py-1" onClick={() => useAppStore.getState().closePluginWorkbench()}>{t('plugins:returnToWorkspace')}</button>}
    </div>
      : mount ? <div ref={body} className="flex-1 min-h-0" data-plugin-native={mount.instanceId} /> : <span role="status">…</span>}
  </div>
}
