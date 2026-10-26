import { readFileViewState, saveFileViewState } from '@/lib/file-view-state'
import { useCallback, useEffect, useRef, useState } from 'react'
import Editor, { DiffEditor } from '@monaco-editor/react'
import type { Monaco } from '@monaco-editor/react'
import type { editor as MonacoEditor, IDisposable } from 'monaco-editor'
import { Uri } from 'monaco-editor/esm/vs/editor/editor.main'
import type { FindableEditor } from '@/lib/editor-find'
import { defineJanusxThemes, getMonacoThemeName } from '@/lib/monaco-theme'
import { useThemeDefinition, useThemeStore } from '@/stores/theme'
import { configureMonacoRuntime } from '@/lib/monaco-runtime'
import { useI18n } from '@/i18n/useI18n'
import { ChevronUp, ChevronDown } from 'lucide-react'
import { numberInlineDeletions } from '@/lib/monaco-diff-line-numbers'

const editorViewStates = new Map<string, MonacoEditor.ICodeEditorViewState>()

configureMonacoRuntime()

interface MonacoViewerProps {
  content: string
  language: string
  onChange: (value: string) => void
  readOnly?: boolean
  onEditorMount?: (editor: FindableEditor | null) => void
  originalContent?: string
  modelPath?: string
}

function LoadingIndicator() {
  // Note: 加载态与容器走 definition.ts 令牌管道，不写字面量 — .agents/notes/workbench/preview-editor-display-style.md
  return (
    <div className="flex items-center justify-center h-full w-full" style={{ background: 'var(--shell-canvas)' }}>
      <div className="flex items-center gap-2">
        <span style={{ color: 'var(--shell-dim)', fontSize: 12 }}>Loading</span>
        <span
          className="inline-block w-1.5 h-1.5 rounded-full"
          style={{
            background: 'var(--shell-accent)',
            animation: 'pulse-dot 1.2s ease-in-out infinite',
          }}
        />
      </div>
    </div>
  )
}

export function MonacoViewer({ content, language, onChange, readOnly = false, onEditorMount, originalContent, modelPath }: MonacoViewerProps) {
  // Note: one number per pane keeps the preview readable — see .agents/notes/terminal/monaco-diff-single-line-number.md
  const { t } = useI18n('editor')
  const containerRef = useRef<HTMLDivElement>(null)
  const diffEditorRef = useRef<MonacoEditor.IStandaloneDiffEditor | null>(null)
  const [wide, setWide] = useState(false)
  const [diffLayout, setDiffLayout] = useState<'inline' | 'split' | null>(() => {
    try {
      const saved = localStorage.getItem('janusx:diff-layout')
      return saved === 'inline' || saved === 'split' ? saved : null
    } catch { return null }
  })
  const [hasChanges, setHasChanges] = useState(false)
  const sideBySide = diffLayout ? diffLayout === 'split' : wide
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const observer = new ResizeObserver(([entry]) => setWide(entry.contentRect.width >= 800))
    observer.observe(container)
    return () => observer.disconnect()
  }, [])
  const chooseDiffLayout = (layout: 'inline' | 'split') => {
    setDiffLayout(layout)
    try { localStorage.setItem('janusx:diff-layout', layout) } catch { /* Storage may be unavailable. */ }
  }
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null)
  const contentRef = useRef(content)
  const diffChangeSubscriptionRef = useRef<{ dispose(): void } | null>(null)
  const viewStateSubscriptionRef = useRef<{ dispose(): void } | null>(null)
  const diffIndicatorRef = useRef<{
    original: MonacoEditor.IEditorDecorationsCollection
    modified: MonacoEditor.IEditorDecorationsCollection
    subscription: IDisposable
    numbering: IDisposable
  } | null>(null)
  contentRef.current = content
  const handleChange = useCallback(
    (value: string | undefined) => {
      onChange(value || '')
    },
    [onChange],
  )

  const handleBeforeMount = useCallback((monaco: any) => {
    defineJanusxThemes(monaco)
    // 文件窗口无工程上下文：TS/JS 语义校验只产生假错误（导入解析/JSX 类型全线标红），只留语法校验
    const diagnostics = { noSemanticValidation: true, noSyntaxValidation: false }
    monaco.languages.typescript?.typescriptDefaults.setDiagnosticsOptions(diagnostics)
    monaco.languages.typescript?.javascriptDefaults.setDiagnosticsOptions(diagnostics)
  }, [])

  const appTheme = useThemeDefinition().id
  const monacoThemeName = getMonacoThemeName(appTheme)

  useEffect(() => {
    void useThemeStore.getState().load()
  }, [])

  const handleMount = useCallback((editor: MonacoEditor.IStandaloneCodeEditor) => {
    editorRef.current = editor
    onEditorMount?.(editor)
    viewStateSubscriptionRef.current?.dispose()
    if (modelPath) {
      const saveViewState = () => {
        const viewState = editor.saveViewState()
        if (viewState) editorViewStates.set(modelPath, viewState)
        saveFileViewState(modelPath, { scrollTop: editor.getScrollTop(), scrollLeft: editor.getScrollLeft(), cursor: editor.getPosition() ?? undefined })
      }
      const subscriptions = [editor.onDidScrollChange(saveViewState), editor.onDidChangeCursorPosition(saveViewState)]
      viewStateSubscriptionRef.current = { dispose: () => subscriptions.forEach((subscription) => subscription.dispose()) }
    }
    if (modelPath) {
      const viewState = editorViewStates.get(modelPath)
      if (viewState) {
        window.requestAnimationFrame(() => {
          editor.layout()
          editor.restoreViewState(viewState)
        })
      }
    }
    const state = readFileViewState(modelPath)
    if (state.cursor) editor.setPosition(state.cursor)
    if (state.scrollTop !== undefined) editor.setScrollTop(state.scrollTop)
    if (state.scrollLeft !== undefined) editor.setScrollLeft(state.scrollLeft)
    const model = editor.getModel()
    if (model && model.getValue() !== contentRef.current) model.setValue(contentRef.current)
  }, [modelPath, onEditorMount])

  const handleDiffMount = useCallback((editor: MonacoEditor.IStandaloneDiffEditor, monaco: Monaco) => {
    diffEditorRef.current = editor
    const modifiedEditor = editor.getModifiedEditor()
    handleMount(modifiedEditor)
    diffChangeSubscriptionRef.current?.dispose()
    diffChangeSubscriptionRef.current = modifiedEditor.onDidChangeModelContent(() => {
      const value = modifiedEditor.getValue()
      if (value !== contentRef.current) onChange(value)
    })
    // Note: 行号染色走 decoration；竖条经视觉复核撤除 — .agents/notes/workbench/preview-editor-display-style.md
    diffIndicatorRef.current?.subscription.dispose()
    diffIndicatorRef.current?.numbering.dispose()
    diffIndicatorRef.current?.original.clear()
    diffIndicatorRef.current?.modified.clear()
    const originalIndicators = editor.getOriginalEditor().createDecorationsCollection([])
    const modifiedIndicators = modifiedEditor.createDecorationsCollection([])
    const updateDiffIndicators = () => {
      setHasChanges(Boolean(editor.getLineChanges()?.length))
      const originalDecorations: MonacoEditor.IModelDeltaDecoration[] = []
      const modifiedDecorations: MonacoEditor.IModelDeltaDecoration[] = []
      for (const change of editor.getLineChanges() ?? []) {
        if (change.originalEndLineNumber >= change.originalStartLineNumber && change.originalEndLineNumber > 0) {
          for (let line = change.originalStartLineNumber; line <= change.originalEndLineNumber; line += 1) {
            originalDecorations.push({
              range: { startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: 1 },
              options: { isWholeLine: true, lineNumberClassName: 'diff-num-del' },
            })
          }
        }
        if (change.modifiedEndLineNumber >= change.modifiedStartLineNumber && change.modifiedEndLineNumber > 0) {
          for (let line = change.modifiedStartLineNumber; line <= change.modifiedEndLineNumber; line += 1) {
            modifiedDecorations.push({
              range: { startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: 1 },
              options: { isWholeLine: true, lineNumberClassName: 'diff-num-add' },
            })
          }
        }
      }
      originalIndicators.set(originalDecorations)
      modifiedIndicators.set(modifiedDecorations)
    }
    updateDiffIndicators()
    diffIndicatorRef.current = {
      original: originalIndicators,
      modified: modifiedIndicators,
      subscription: editor.onDidUpdateDiff(updateDiffIndicators),
      numbering: numberInlineDeletions(editor, monaco),
    }
  }, [handleMount, onChange])

  // 模型在 diff 退出后仍被复用：主动清掉装饰，避免行号染色残留在普通预览。
  useEffect(() => {
    if (originalContent !== undefined) return
    diffIndicatorRef.current?.subscription.dispose()
    diffIndicatorRef.current?.numbering.dispose()
    diffIndicatorRef.current?.original.clear()
    diffIndicatorRef.current?.modified.clear()
    diffIndicatorRef.current = null
    diffEditorRef.current = null
  }, [originalContent])

  useEffect(() => () => {
    diffChangeSubscriptionRef.current?.dispose()
    viewStateSubscriptionRef.current?.dispose()
    diffIndicatorRef.current?.subscription.dispose()
    diffIndicatorRef.current?.numbering.dispose()
    diffIndicatorRef.current?.original.clear()
    diffIndicatorRef.current?.modified.clear()
    diffIndicatorRef.current = null
    diffEditorRef.current = null
    if (editorRef.current) {
      if (modelPath) {
        const viewState = editorRef.current.saveViewState()
        if (viewState) editorViewStates.set(modelPath, viewState)
      }
      onEditorMount?.(null)
    }
  }, [modelPath, onEditorMount])

  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    const currentValue = editor.getValue()
    if (currentValue !== content) {
      const position = editor.getPosition()
      editor.getModel()?.setValue(content)
      if (position) editor.setPosition(position)
    }
  }, [content])


  // Note: 排版与折叠对齐 opencode —— .agents/notes/workbench/preview-editor-display-style.md
  const commonOptions = {
    fontSize: 13,
    fontFamily: "'Cascadia Code', 'JetBrains Mono', 'Fira Code', monospace",
    lineHeight: 24,
    tabSize: 2,
    detectIndentation: false,
    minimap: { enabled: false },
    // 竖线零容忍：缩进/括号参考线与 overview ruler 一律不画
    guides: { indentation: false, bracketPairs: false, bracketPairsHorizontal: false, highlightActiveIndentation: false, highlightActiveBracketPair: false },
    renderOverviewRuler: false,
    // 黄框清零：Unicode 可疑字符高亮按字节给全角标点套金色边框盒
    // （editorUnicodeHighlight.border 默认= warning 金），中文字符串/文档满篇中枪。
    // 文件窗口无工程上下文，不需要防同形攻击提示；locale 豁免（zh-CN≠zh-hans）在
    // standalone Monaco 也修不动，整项关闭。
    unicodeHighlight: { nonBasicASCII: false, invisibleCharacters: false, ambiguousCharacters: false },
    scrollBeyondLastLine: false,
    wordWrap: 'on' as const,
    lineNumbers: 'on' as const,
    renderLineHighlight: 'line' as const,
    padding: { top: 12, bottom: 12 },
  }

  const diffOptions = {
    ...commonOptions,
    lineNumbersMinChars: 3,
    glyphMargin: false,
    folding: false,
    renderIndicators: true,
    renderMarginRevertIcon: false,
    renderOverviewRuler: false,
    automaticLayout: true,
    renderSideBySide: sideBySide,
    useInlineViewWhenSpaceIsLimited: false,
    // Compact mode removes the old-number pane; true inline merges word edits into
    // one row, so keep ordinary inline rows to show the original above the edit.
    compactMode: !sideBySide,
    experimental: { useTrueInlineView: false },
    hideUnchangedRegions: { enabled: true, revealLineCount: 20, minimumLineCount: 20, contextLineCount: 20 },
  }

  return (
    <div ref={containerRef} className="relative flex h-full w-full flex-col overflow-hidden" style={{ background: 'var(--shell-canvas)' }}>
      {originalContent !== undefined && (
        <div className="flex shrink-0 items-center justify-between gap-2 px-2 py-1 text-[11px]" style={{ color: 'var(--shell-muted)', background: 'var(--shell-pane-chrome)' }}>
          <div role="group" aria-label={t('editor:fileEditor.diffLayout')} className="flex gap-1">
            {(['inline', 'split'] as const).map(layout => (
              <button key={layout} type="button" aria-pressed={(layout === 'split') === sideBySide}
                onClick={() => chooseDiffLayout(layout)}
                className="shell-icon-btn h-7 rounded px-2"
                data-on={(layout === 'split') === sideBySide ? 'true' : undefined}
                style={{ color: (layout === 'split') === sideBySide ? 'var(--shell-accent-strong)' : 'var(--shell-muted)' }}>
                {t(layout === 'inline' ? 'editor:fileEditor.diffInline' : 'editor:fileEditor.diffSplit')}
              </button>
            ))}
          </div>
          <div className="flex gap-1">
            {(['previous', 'next'] as const).map(direction => (
              <button key={direction} type="button" disabled={!hasChanges}
                aria-label={t(direction === 'previous' ? 'editor:fileEditor.previousChange' : 'editor:fileEditor.nextChange')}
                title={t(direction === 'previous' ? 'editor:fileEditor.previousChange' : 'editor:fileEditor.nextChange')}
                onClick={() => diffEditorRef.current?.goToDiff(direction)}
                className="shell-icon-btn flex h-7 w-7 items-center justify-center rounded disabled:opacity-35">
                {direction === 'previous' ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>
            ))}
          </div>
        </div>
      )}
      {originalContent !== undefined && sideBySide && (
        <div className="grid shrink-0 grid-cols-2 px-3 py-1 text-[10px]" style={{ color: 'var(--shell-dim)' }}>
          <span>{t('editor:fileEditor.diffOriginal')}</span>
          <span>{t('editor:fileEditor.diffModified')}</span>
        </div>
      )}
      <div className="min-h-0 flex-1">
      {originalContent !== undefined ? (
        <DiffEditor
          height="100%"
          language={language}
          original={originalContent}
          modified={content}
          originalModelPath={modelPath ? `${monacoFileUri(modelPath)}?janusx-original=git` : undefined}
          modifiedModelPath={modelPath ? monacoFileUri(modelPath) : undefined}
          theme={monacoThemeName}
          loading={<LoadingIndicator />}
          options={{ ...diffOptions, readOnly, originalEditable: false, domReadOnly: readOnly }}
          beforeMount={handleBeforeMount}
          onMount={handleDiffMount}
        />
      ) : (
        <Editor
          height="100%"
          language={language}
          value={content}
          path={modelPath ? monacoFileUri(modelPath) : undefined}
          onChange={handleChange}
          theme={monacoThemeName}
          loading={<LoadingIndicator />}
          options={{ ...commonOptions, readOnly, domReadOnly: readOnly }}
          beforeMount={handleBeforeMount}
          onMount={handleMount}
        />
      )}
      </div>
    </div>
  )
}

function monacoFileUri(filePath: string): string {
  if (filePath.startsWith('janusx-workspace://')) return Uri.parse(filePath).toString()
  return Uri.file(filePath).toString()
}
