import { readFileViewState, saveFileViewState } from '@/lib/file-view-state'
import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ViewerToolbar } from './ViewerToolbar'
import { Link2 } from 'lucide-react'
import { ThemedTooltip } from '../ui/ThemedTooltip'
import { PreviewModeToggle, type PreviewMode } from './PreviewModeToggle'
import { FILE_MARKDOWN_COMPONENTS } from './markdown-components'
import { MarkdownAssetContext } from './local-asset'
import { dirnameOfAbsolutePath } from '@/lib/local-asset-resolver'
import { MonacoViewer } from './MonacoViewer'
import { PreviewScrollArea } from './PreviewScrollArea'
import type { FindableEditor } from '@/lib/editor-find'
import type { editor as MonacoEditor } from 'monaco-editor'
import { scrollingMarkdownPlugins, previewUrlTransform } from '@/lib/markdown-preview'
import { useMarkdownScrollSync } from './useMarkdownScrollSync'
import { useI18n } from '@/i18n/useI18n'

interface MarkdownViewerProps {
  content: string
  originalContent?: string
  onChange: (value: string) => void
  onEditorMount?: (editor: FindableEditor | null) => void
  modelPath?: string
  workspacePath?: string
  documentPath?: string
}

export function MarkdownViewer({ content, originalContent, onChange, onEditorMount, modelPath, workspacePath, documentPath }: MarkdownViewerProps) {
  const { t } = useI18n('editor')
  const [syncScroll, setSyncScroll] = useState(true)
  const [editor, setEditor] = useState<MonacoEditor.IStandaloneCodeEditor | null>(null)
  const handleEditorMount = useCallback((instance: FindableEditor | null) => {
    setEditor(instance as MonacoEditor.IStandaloneCodeEditor | null)
    onEditorMount?.(instance)
  }, [onEditorMount])
  const [splitRatio, setSplitRatio] = useState(50)
  const [previewMode, setPreviewMode] = useState<PreviewMode>(() => readFileViewState(modelPath).previewMode ?? 'preview')
  const documentDir = useMemo(
    () => dirnameOfAbsolutePath(documentPath ?? modelPath),
    [documentPath, modelPath],
  )
  const assetScope = useMemo(
    () => ({ workspacePath, documentDir }),
    [workspacePath, documentDir],
  )
  const isDragging = useRef(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const handleDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    isDragging.current = true
  }, [])

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current || !containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      const x = e.clientX - rect.left
      const pct = (x / rect.width) * 100
      setSplitRatio(Math.max(20, Math.min(80, pct)))
    }

    const handleMouseUp = () => {
      isDragging.current = false
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [])

  const showEditor = previewMode !== 'preview'
  const showPreview = previewMode !== 'editor'
  const isSplit = previewMode === 'split'
  useMarkdownScrollSync(containerRef, editor, syncScroll && isSplit, content)

  return (
    <div ref={containerRef} className="flex h-full min-w-0 flex-1 flex-col overflow-hidden" style={{ background: 'var(--shell-void)' }}>
      <ViewerToolbar>
        <PreviewModeToggle value={previewMode} onChange={mode => { setPreviewMode(mode); saveFileViewState(modelPath, { previewMode: mode }) }} />
        {isSplit && <ThemedTooltip label={t('editor:fileEditor.syncScroll')}>
          <button type="button" className="shell-icon-btn viewer-icon" aria-label={t('editor:fileEditor.syncScroll')}
            aria-pressed={syncScroll} data-on={syncScroll ? 'true' : undefined} onClick={() => setSyncScroll(value => !value)}>
            <Link2 size={15} aria-hidden="true" />
          </button>
        </ThemedTooltip>}
      </ViewerToolbar>
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {showEditor && <div aria-label={t('editor:previewMode.code')} className="min-w-0 overflow-hidden" style={{ width: isSplit ? splitRatio + '%' : '100%' }}>
          <MonacoViewer content={content} language="markdown" originalContent={originalContent} modelPath={modelPath}
            onChange={onChange} onEditorMount={handleEditorMount} />
        </div>}
        {isSplit && <div className="viewer-divider shrink-0 h-full" style={{ width: 3, cursor: 'col-resize', background: 'var(--shell-border-soft)' }} onMouseDown={handleDividerMouseDown} />}
        {showPreview && <div aria-label={t('editor:previewMode.preview')} className="flex min-w-0 flex-col overflow-hidden" style={{ width: isSplit ? (100 - splitRatio) + '%' : '100%' }}>
        <PreviewScrollArea>
        <div
          className="flex-1"
          style={{
            padding: 16,
            background: 'var(--shell-void)',
            color: 'var(--shell-text)',
            minHeight: '100%',
          }}
        >
          <div className="markdown-preview">
            <MarkdownAssetContext.Provider value={assetScope}>
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={scrollingMarkdownPlugins}
                urlTransform={previewUrlTransform}
                components={FILE_MARKDOWN_COMPONENTS}
              >
                {content}
              </ReactMarkdown>
            </MarkdownAssetContext.Provider>
          </div>
        </div>
        </PreviewScrollArea>
        </div>}
      </div>
    </div>
  )
}
