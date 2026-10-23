import { WindowControls } from './WindowControls'
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useEditorCloseDialog } from './EditorCloseDialog'
import { FileViewerContent } from '@/components/FileViewerContent'
import { SlidingSelection } from '@/components/shared/SlidingSelection'
import { DiffCounts } from '@/components/shared/DiffCounts'
import { invalidateEditorFileCache, useEditorStore } from '@/stores/editor'
import { useThemeStore } from '@/stores/theme'
import { GitCompareArrows, PanelRightOpen, PanelRightClose, X, Pin, PinOff, RefreshCw, Save, Search } from 'lucide-react'
import { isEditorDefinitionShortcut, isEditorFindShortcut, isMonacoKeyboardEvent, openEditorDefinition, openEditorFind, watchFindWidgetControls, type FindableEditor } from '@/lib/editor-find'
import { attachWheelScrollX, revealStripItem } from '@/lib/wheel-scroll-x'
import { useI18n } from '@/i18n/useI18n'
import type { DefinitionTarget } from '@/lib/monaco-definition'

interface EditorWindowParams {
  filePath: string
  workspacePath: string
}

function getEditorWindowParams(): EditorWindowParams | null {
  const params = new URLSearchParams(window.location.search)
  const filePath = params.get('editorFile')
  const workspacePath = params.get('workspacePath')
  if (!filePath || !workspacePath) return null
  return { filePath, workspacePath }
}

export function StandaloneFileEditor({ embedded = false }: { embedded?: boolean }) {
  const { t } = useI18n('editor')
  const findEditorRef = useRef<FindableEditor | null>(null)
  const tabStripRef = useRef<HTMLDivElement | null>(null)
  const scope = useEditorStore(state => state.workspacePath)
  const initialParams = useMemo(() => getEditorWindowParams(), [])
  const editorParams = useMemo(() => embedded ? (scope ? { filePath: '', workspacePath: scope } : null) : initialParams, [embedded, scope, initialParams])
  const [transferring, setTransferring] = useState(false)
  const [transferError, setTransferError] = useState<string | null>(null)
  const [pluginReadOnly, setPluginReadOnly] = useState(false)
  const openFiles = useEditorStore((state) => state.openFiles)
  const activeFileId = useEditorStore((state) => state.activeFileId)
  const openFile = useEditorStore((state) => state.openFile)
  const setActiveFile = useEditorStore((state) => state.setActiveFile)
  const closeFile = useEditorStore((state) => state.closeFile)
  const updateContent = useEditorStore((state) => state.updateContent)
  const saveFile = useEditorStore((state) => state.saveFile)
  const reloadOpenFile = useEditorStore((state) => state.reloadOpenFile)
  const openFileAt = useEditorStore((state) => state.openFileAt)
  const navigationTarget = useEditorStore((state) => state.navigationTarget)
  const consumeNavigationTarget = useEditorStore((state) => state.consumeNavigationTarget)
  const activeFile = openFiles.find((file) => file.id === activeFileId) ?? null
  const { confirmClose, closeDialog } = useEditorCloseDialog()
  const [diffFileId, setDiffFileId] = useState<string | null>(null)
  const [baselineStatus, setBaselineStatus] = useState<'loading' | 'unavailable' | null>(null)
  const [baselineContent, setBaselineContent] = useState<string | undefined>(undefined)
  const [baselineFileId, setBaselineFileId] = useState<string | null>(null)
  const [isPinned, setIsPinned] = useState(false)
  const viewedPath = activeFile && !activeFile.isLoading && !activeFile.error && activeFile.viewType !== 'binary'
    ? activeFile.absolutePath : null
  // Note: report only successfully loaded, viewable files to the main workbench — see .agents/notes/workbench/first-run-learning.md
  useEffect(() => {
    if (!editorParams || !viewedPath) return
    window.electron.window.reportEditorViewed({ filePath: viewedPath, workspacePath: editorParams.workspacePath })
  }, [viewedPath, editorParams])
  const unwatchFindControlsRef = useRef<(() => void) | null>(null)
  // 正式入口在 React 挂载前加载主题；保留幂等调用，供直接挂载组件的宿主初始化。
  // Note: .agents/notes/workbench/standalone-editor-initial-theme.md
  useEffect(() => {
    void useThemeStore.getState().load()
  }, [])
  const handleEditorMount = useCallback((editor: FindableEditor | null) => {
    findEditorRef.current = editor
    unwatchFindControlsRef.current?.()
    unwatchFindControlsRef.current = editor ? watchFindWidgetControls(editor.getDomNode?.()) : null
  }, [])

  useEffect(() => () => unwatchFindControlsRef.current?.(), [])

  // Note: 标签条横向滚动条隐藏，竖向滚轮换轴横向滚、选中 tab 自动入视口 — .agents/notes/workbench/preview-editor-display-style.md
  useEffect(() => {
    const strip = tabStripRef.current
    return strip ? attachWheelScrollX(strip) : undefined
  }, [])
  useEffect(() => {
    const strip = tabStripRef.current
    if (strip) revealStripItem(strip, 'data-tab-id', activeFileId)
  }, [activeFileId, openFiles])

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!isEditorDefinitionShortcut(event) || !findEditorRef.current || !isMonacoKeyboardEvent(event)) return
      event.preventDefault()
      event.stopPropagation()
      void openEditorDefinition(findEditorRef.current)
    }
    document.addEventListener('keydown', handler, true)
    return () => document.removeEventListener('keydown', handler, true)
  }, [])

  useEffect(() => {
    if (embedded || !editorParams) return
    void openFile(editorParams.filePath, editorParams.workspacePath)
    const unsubscribe = window.electron.window.onEditorRefresh(async (payload) => {
      try {
        await useEditorStore.getState().acceptDelivery(payload)
        if (payload.requestId) window.electron.window.editorReceived(payload.requestId, true)
      } catch {
        if (payload.requestId) window.electron.window.editorReceived(payload.requestId, false)
      }
    })
    window.electron.window.editorReady()
    return unsubscribe
  }, [editorParams, openFile, embedded])

  // Note: standalone editors auto-refresh clean tabs on external disk changes — see .agents/notes/workbench/standalone-editor-auto-refresh.md
  useEffect(() => {
    if (embedded || !editorParams) return
    const workspacePath = editorParams.workspacePath
    return window.electron.fileTree.onChanged((payload) => {
      if (payload.workspacePath !== workspacePath) return
      invalidateEditorFileCache(workspacePath)
      void useEditorStore.getState().reloadOpenFiles(workspacePath, payload.changedFilePath ?? null)
    })
  }, [editorParams, embedded])

  // Note: +N/−N 徽标取 git 变更统计，零隐藏，与会话侧同源 — .agents/notes/workbench/preview-editor-display-style.md
  const [changeStats, setChangeStats] = useState<ReadonlyMap<string, { additions: number; deletions: number }>>(new Map())
  const refreshChangeStats = useCallback(() => {
    const workspacePath = editorParams?.workspacePath
    if (!workspacePath) { setChangeStats(new Map()); return }
    void window.electron.git.status(workspacePath).then((status) => {
      const next = new Map<string, { additions: number; deletions: number }>()
      for (const change of status.changes) {
        const additions = change.additions ?? 0
        const deletions = change.deletions ?? 0
        if (additions > 0 || deletions > 0) next.set(change.path, { additions, deletions })
      }
      setChangeStats(next)
    }).catch(() => setChangeStats(new Map()))
  }, [editorParams?.workspacePath])
  useEffect(() => { refreshChangeStats() }, [refreshChangeStats])
  useEffect(() => window.electron.fileTree.onChanged(() => { refreshChangeStats() }), [refreshChangeStats])

  const closeWindow = useCallback(() => {
    if (embedded) useEditorStore.getState().closePanel()
    else void window.electron.window.confirmEditorClose()
  }, [embedded])

  const handleWindowClose = useCallback(() => {
    if (transferring) return
    confirmClose(useEditorStore.getState().openFiles.map(file => file.id), closeWindow)
  }, [confirmClose, closeWindow, transferring])

  useEffect(() => embedded ? undefined : window.electron.window.onEditorCloseRequested(handleWindowClose), [handleWindowClose, embedded])

  useEffect(() => {
    let cancelled = false
    const file = useEditorStore.getState().openFiles.find(item => item.id === activeFileId)
    if (!file || !editorParams || diffFileId !== file.id) return
    setBaselineStatus('loading')
    setBaselineFileId(null)
    void window.electron.git.fileBaseline(editorParams.workspacePath, file.path)
      .then(baseline => {
        if (cancelled) return
        setBaselineContent(baseline?.available ? baseline.content : undefined)
        setBaselineFileId(file.id)
        setBaselineStatus(baseline?.available ? null : 'unavailable')
      })
      .catch(() => { if (!cancelled) setBaselineStatus('unavailable') })
    return () => { cancelled = true }
  }, [activeFileId, activeFile?.mtime, diffFileId, editorParams])

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (isEditorFindShortcut(event) && findEditorRef.current && !isMonacoKeyboardEvent(event)) {
        event.preventDefault()
        void openEditorFind(findEditorRef.current)
        return
      }
      if (transferring) return
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        if (activeFileId && !pluginReadOnly) void saveFile(activeFileId)
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [activeFileId, saveFile, transferring, pluginReadOnly])

  useEffect(() => { findEditorRef.current = null }, [activeFileId])

  useEffect(() => {
    if (embedded) return
    document.title = activeFile ? t('editor:fileEditor.documentTitle', { prefix: activeFile.isDirty ? '* ' : '', name: activeFile.name }) : t('editor:fileEditor.windowTitle')
  }, [activeFile, t, embedded])

  const handleDefinitionNavigate = useCallback((target: DefinitionTarget) => {
    if (editorParams) void openFileAt(target.absolutePath, editorParams.workspacePath, target.selection)
  }, [editorParams, openFileAt])

  const togglePinned = useCallback(async () => {
    const result = await window.electron.window.setAlwaysOnTop(!isPinned)
    setIsPinned(result.value)
  }, [isPinned])

  const moveSession = useCallback(async () => {
    if (!activeFile || !editorParams || transferring) return
    setTransferring(true)
    setTransferError(null)
    try {
      const payload = { filePath: activeFile.absolutePath, workspacePath: editorParams.workspacePath, session: useEditorStore.getState().exportSession() }
      const result = embedded
        ? await window.electron.window.openEditor({ ...payload, floating: true })
        : await window.electron.window.embedEditor(payload)
      if (!result.success) throw new Error(result.error)
      if (embedded) useEditorStore.getState().releaseScope(editorParams.workspacePath)
    } catch {
      setTransferError(t('editor:fileEditor.transferFailed'))
    } finally { setTransferring(false) }
  }, [activeFile, editorParams, embedded, transferring, t])

  const titlebarDrag = embedded ? {} : { WebkitAppRegion: 'drag' } as CSSProperties
  const noDrag = { WebkitAppRegion: 'no-drag' } as CSSProperties
  const diffEnabled = Boolean(activeFile && diffFileId === activeFile.id)
  const activeBaselineContent = diffEnabled && baselineFileId === activeFile?.id ? baselineContent : undefined
  const canSave = Boolean(!pluginReadOnly && activeFile && activeFile.viewType !== 'image' && activeFile.viewType !== 'binary')
  const canFind = !pluginReadOnly && (activeFile?.viewType === 'code' || activeFile?.viewType === 'markdown' || activeFile?.viewType === 'html')

  return (
    <div data-editor-window-state="ready" data-editor-host={embedded ? 'embedded' : 'floating'} aria-busy={transferring} className={`${embedded ? 'h-full' : 'h-screen'} flex flex-col overflow-hidden`} style={{ background: 'var(--shell-canvas)', color: 'var(--shell-text)' }}>
      <div
        {...(transferring ? { inert: '' } : {})}
        className="relative h-[38px] shrink-0 flex items-center gap-3 px-3 select-none"
        style={{
          ...titlebarDrag,
          background: 'var(--shell-pane-chrome)',
          borderBottom: '1px solid var(--shell-border)',
        }}
      >
        {!embedded && <div
          data-editor-window-drag-strip
          className="absolute inset-x-0 top-0 z-20 h-2"
          style={titlebarDrag}
          aria-hidden="true"
        />}
        {!embedded && <WindowControls onClose={handleWindowClose} />}
        {/*-- Note: 外壳标签收敛到工作台滑动指示块体系 — .agents/notes/workbench/preview-editor-display-style.md --*/}
        <div
          data-editor-drag-region
          ref={tabStripRef}
          className="filetab-strip relative flex min-w-0 flex-1 self-stretch items-center gap-1 overflow-x-auto"
          style={titlebarDrag}
        >
          <SlidingSelection containerRef={tabStripRef} activeId={activeFileId} itemAttribute="data-tab-id"
            layoutKey={openFiles.map((file) => file.id).join(',')} className="filetab-indicator" testId="editor-tab-indicator" />
          {openFiles.map((file) => {
            const isActive = file.id === activeFileId
            return (
              <div
                key={file.id}
                data-editor-tab={file.absolutePath}
                data-tab-id={file.id}
                data-active={isActive ? 'true' : 'false'}
                className="filetab relative flex h-[31px] max-w-[180px] shrink-0 cursor-pointer items-center gap-1.5 rounded-[7px] px-3 font-mono text-[11px]"
                style={noDrag}
                onClick={() => setActiveFile(file.id)}
              >
                {file.isDirty ? <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: 'var(--shell-accent)' }} /> : null}
                {file.externalChanged ? (
                  <button
                    type="button"
                    className="shrink-0 border-0 bg-transparent p-0 hover:opacity-80"
                    style={{ color: 'var(--shell-accent-strong)' }}
                    title="Disk version changed ? click to reload"
                    onClick={(event) => { event.stopPropagation(); void reloadOpenFile(file.absolutePath) }}
                  >
                    <RefreshCw size={11} strokeWidth={2} />
                  </button>
                ) : null}
                <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{file.name}</span>
                <DiffCounts additions={changeStats.get(file.path)?.additions ?? 0} deletions={changeStats.get(file.path)?.deletions ?? 0} />
                <button
                  type="button"
                  aria-label={t('editor:fileEditor.closeTab', { name: file.name })}
                  className="filetab-close ml-1 shrink-0 border-0 p-0"
                  onClick={(event) => {
                    event.stopPropagation()
                    confirmClose([file.id], () => {
                      closeFile(file.id)
                      if (useEditorStore.getState().openFiles.length === 0) closeWindow()
                    })
                  }}
                >
                  <X size={12} strokeWidth={2} aria-hidden="true" />
                </button>
              </div>
            )
          })}
        </div>
        <div className="relative z-10 flex shrink-0 items-center gap-1.5" style={noDrag}>
          <DiffCounts additions={activeFile ? changeStats.get(activeFile.path)?.additions ?? 0 : 0}
            deletions={activeFile ? changeStats.get(activeFile.path)?.deletions ?? 0 : 0} />
          {canFind && <button type="button" aria-pressed={diffEnabled} data-on={diffEnabled ? 'true' : undefined}
            aria-label={t('editor:fileEditor.compareHead')} title={t('editor:fileEditor.compareHead')}
            onClick={() => setDiffFileId(diffEnabled ? null : activeFileId)}
            className="shell-icon-btn flex h-7 w-7 items-center justify-center rounded-md border border-[var(--control-border)] transition-colors"
            style={{ color: diffEnabled ? 'var(--shell-accent-strong)' : 'var(--shell-muted)' }}>
            <GitCompareArrows size={14} strokeWidth={1.8} />
          </button>}
          {canFind && (
            <button
              type="button"
              aria-label={t('editor:fileEditor.find')}
              title={t('editor:fileEditor.findTitle')}
              onClick={() => void openEditorFind(findEditorRef.current)}
              onMouseDown={(event) => event.stopPropagation()}
              className="shell-icon-btn flex h-7 w-7 items-center justify-center rounded-md border border-[var(--control-border)] bg-transparent text-[var(--shell-muted)] transition-colors hover:border-[var(--shell-accent-border)] hover:text-[var(--shell-text)]"
            >
              <Search size={14} strokeWidth={1.8} />
            </button>
          )}
          {!embedded && <button
            type="button"
            aria-pressed={isPinned} data-on={isPinned ? 'true' : undefined}
            aria-label={isPinned ? t('editor:fileEditor.unpinWindow') : t('editor:fileEditor.pinWindow')}
            title={isPinned ? t('editor:fileEditor.unpinWindow') : t('editor:fileEditor.pinWindow')}
            onClick={() => void togglePinned()}
            onMouseDown={(event) => event.stopPropagation()}
            className="shell-icon-btn relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[var(--control-border)] transition-colors"
            style={{ color: isPinned ? 'var(--shell-accent-strong)' : 'var(--shell-muted)' }}
          >
            {isPinned ? <PinOff size={14} strokeWidth={1.8} /> : <Pin size={14} strokeWidth={1.8} />}
          </button>}
          <button
            type="button"
            aria-label={t(embedded ? 'editor:fileEditor.detachToFloat' : 'editor:fileEditor.embedToMain')}
            title={t(embedded ? 'editor:fileEditor.detachToFloat' : 'editor:fileEditor.embedToMain')}
            disabled={!activeFile || !editorParams || transferring || openFiles.some(file => file.isLoading)}
            onClick={() => void moveSession()}
            onMouseDown={(event) => event.stopPropagation()}
            className="shell-icon-btn flex h-7 w-7 items-center justify-center rounded-md border border-[var(--control-border)] bg-transparent text-[var(--shell-muted)] transition-colors enabled:hover:border-[var(--shell-accent-border)] enabled:hover:text-[var(--shell-text)] disabled:cursor-not-allowed disabled:opacity-35"
          >
            {embedded ? <PanelRightClose size={14} strokeWidth={1.8} /> : <PanelRightOpen size={14} strokeWidth={1.8} />}
          </button>
        </div>
        {embedded && <button type="button" aria-label={t('editor:fileEditor.collapsePanel')} title={t('editor:fileEditor.collapsePanel')} onClick={() => useEditorStore.getState().hidePanel()} className="shell-icon-btn flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--shell-muted)]"><X size={14} /></button>}
        {canSave && (
          <button
            type="button"
            onClick={() => activeFileId && void saveFile(activeFileId)}
            aria-label={t('editor:fileEditor.save')}
            title={t('editor:fileEditor.save')}
            data-on={activeFile?.isDirty ? 'true' : undefined}
            onMouseDown={(event) => event.stopPropagation()}
            className="shell-icon-btn flex h-7 w-7 items-center justify-center rounded-md border border-[var(--control-border)] transition-colors"
            style={{
              ...noDrag,
              color: activeFile?.isDirty ? 'var(--shell-accent-strong)' : 'var(--shell-dim)',
            }}
          >
            <Save size={14} strokeWidth={1.8} />
          </button>
        )}
      </div>
      {transferError && <div role="alert" className="px-3 py-1 text-xs text-[var(--shell-diff-del)]">{transferError}</div>}
      {diffEnabled && baselineStatus && <div role="status" className="px-3 py-1 text-xs" style={{ color: 'var(--shell-muted)' }}>
        {t(baselineStatus === 'loading' ? 'editor:fileEditor.diffLoading' : 'editor:fileEditor.diffUnavailable')}
      </div>}
      <div {...(transferring ? { inert: '' } : {})} className="relative flex-1 overflow-hidden" style={{ minHeight: 0 }}>
        {activeFile ? (
          <FileViewerContent
            pluginViewers={embedded}
            onReadOnlyChange={setPluginReadOnly}
            key={`${activeFile.id}:${activeFile.absolutePath}`}
            file={activeFile}
            workspacePath={editorParams?.workspacePath}
            navigationTarget={navigationTarget}
            onDefinitionNavigate={handleDefinitionNavigate}
            onNavigationComplete={consumeNavigationTarget}
            definitionActionLabel={t('editor:fileEditor.goToDefinition')}
            definitionErrorMessage={t('editor:fileEditor.cppDefinitionUnavailable')}
            diffOriginalContent={activeBaselineContent}
            onContentChange={(content) => updateContent(activeFile.id, content)}
            onEditorMount={handleEditorMount}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-xs" style={{ color: 'var(--shell-dim)' }}>
            {t('editor:fileEditor.missingFileInfo')}
          </div>
        )}
      </div>
      {closeDialog}
    </div>
  )
}
