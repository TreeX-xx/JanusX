// Note: .agents/notes/workbench/plugin-contract-v1.md — embedded editor viewer selection and fallback.
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useWorkspaceStore } from '@/stores/workspace'
import { useWorktreeStore } from '@/stores/worktree'
import { useEditorStore } from '@/stores/editor'
import { useI18n } from '@/i18n/useI18n'
import type { OpenFile } from '../../../shared/editor'
import { PluginViewShell, usePluginSnapshot } from './plugin-runtime'
import { documentViewerCandidates, readDocumentViewerDefault, saveDocumentViewerDefault } from './document-viewers'

export function DocumentViewerHost({ file, workspacePath, children, forceBuiltin, onReadOnlyChange }: {
  file: OpenFile; workspacePath?: string; children: ReactNode; forceBuiltin: boolean; onReadOnlyChange?: (value: boolean) => void
}) {
  const { t } = useI18n('plugins')
  const snapshot = usePluginSnapshot()
  const projectId = useWorkspaceStore(state => state.activeWorkspaceId)
  const project = useWorkspaceStore(state => state.workspaces.find(item => item.id === state.activeWorkspaceId))
  const root = useWorktreeStore(state => projectId ? state.activePaths[projectId] ?? project?.path : undefined)
  const [preferred, setPreferred] = useState(() => readDocumentViewerDefault(file.path))
  const [failure, setFailure] = useState('')
  const [failedViewer, setFailedViewer] = useState('')
  const candidates = root === workspacePath && projectId ? documentViewerCandidates(snapshot, projectId, file.path.replaceAll('\\', '/')) : []
  const selectedId = file.viewState?.viewerId ?? preferred
  const selected = candidates.find(viewer => viewer.key === selectedId)
  const identity = selected ? `${selected.key}:${selected.digest}` : ''
  const showPlugin = selected && !file.isDirty && !forceBuiltin && failedViewer !== identity
  const pluginVisible = Boolean(showPlugin)
  useEffect(() => { onReadOnlyChange?.(pluginVisible); return () => onReadOnlyChange?.(false) }, [pluginVisible, onReadOnlyChange])
  const onFailure = useCallback((code: string) => { setFailedViewer(identity); setFailure(code) }, [identity])
  const choose = (viewerId: string) => {
    setFailedViewer(''); setFailure('')
    useEditorStore.getState().updateViewState(file.id, { viewerId })
  }
  if (!candidates.length && selectedId === 'builtin' && !failure) return <>{children}</>
  return <div className="flex h-full min-h-0 flex-col" data-document-viewer={showPlugin ? selected.key : 'builtin'}>
    <div className="flex flex-wrap shrink-0 items-center gap-2 px-3 py-1 text-xs text-[var(--shell-muted)]">
      <label>{t('plugins:documentViewer')} <select aria-label={t('plugins:documentViewer')} value={selected?.key ?? 'builtin'}
        disabled={file.isDirty || forceBuiltin} onChange={event => choose(event.target.value)} className="max-w-[14rem] bg-[var(--shell-card)] text-[var(--shell-text)]">
        <option value="builtin">{t('plugins:builtinViewer')}</option>
        {candidates.map(viewer => <option key={viewer.key} value={viewer.key}>{viewer.title} · {viewer.pluginName}</option>)}
      </select></label>
      <button type="button" disabled={file.isDirty || forceBuiltin} onClick={() => {
        try { saveDocumentViewerDefault(file.path, selected?.key ?? 'builtin'); setPreferred(selected?.key ?? 'builtin'); setFailure('') }
        catch { setFailure('STORAGE_UNAVAILABLE') }
      }}>{t('plugins:defaultViewer')}</button>
      {selected && <button type="button" disabled={file.isDirty || forceBuiltin} onClick={() => { choose('builtin'); try { saveDocumentViewerDefault(file.path, 'builtin'); setPreferred('builtin') } catch { setFailure('STORAGE_UNAVAILABLE') } }}>{t('plugins:resetViewer')}</button>}
    </div>
    {file.isDirty && <p className="px-3 text-xs">{t('plugins:viewerDirty')}</p>}
    {(failure || !selected && selectedId !== 'builtin') && <p role="status" className="px-3 text-xs">{t('plugins:viewerFallback')} {failure}</p>}
    <div className="relative flex-1 min-h-0 overflow-hidden">
      {showPlugin ? <PluginViewShell key={`${identity}:${file.absolutePath}:${file.mtime}`} pluginId={selected.pluginId} localViewId={selected.view}
        viewId={`extension:${selected.pluginId}/${selected.view}`} location="workspace" active workspaceId={projectId} workspacePath={workspacePath ?? null}
        document={{ viewer: selected.id, path: file.path.replaceAll('\\', '/') }} onFailure={onFailure} /> : children}
    </div>
  </div>
}
